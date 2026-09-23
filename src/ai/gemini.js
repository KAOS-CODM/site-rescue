// gemini.js — default AI provider implementation, env-configured.
// Docs-verified 2026-09 (NOT from memory):
//   Endpoint : POST {AI_BASE_URL}/models/{AI_MODEL}:generateContent
//              https://ai.google.dev/api/generate-content (method generateContent)
//   Auth     : x-goog-api-key header
//   Instruct. : top-level systemInstruction { parts: [{ text }] } (request-body
//               schema: "Developer set system instruction(s)… text only")
//   Structured output:
//              generationConfig.responseMimeType = "application/json"
//              generationConfig.responseSchema   = PLAN_RESPONSE_SCHEMA
//              (docs reference both this pair and a newer
//               responseFormat.text.{mimeType,schema} form; the newer form
//               was rejected by the live API on 2026-09-23 with
//               INVALID_ARGUMENT on mime_type — this pair is accepted by the
//               live API and matches the official JSON-mode reference.)
//   Response : candidates[0].content.parts[].text
// NO tools are ever sent — no Google Search, no URL Context, no code
// execution (spec > AI adapter: the AI gets no browsing abilities).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLAN_RESPONSE_SCHEMA } from './planSchema.js';

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_MODEL = 'gemini-3.8-flash';
const REQUEST_TIMEOUT_MS = 30000; // derived: bounded wait so /api/plan can't hang

/** Every AI-layer failure is this error type; the route maps it to ai_failed. */
export class AiError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AiError';
  }
}

// Minimal .env reader (no dependency, per spec's no-extra-libs stance).
// KEY=VALUE lines into process.env without overwriting existing values.
// Runs at import (= server start). .env itself is git-ignored; never logged.
function loadEnvFile() {
  try {
    const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.env');
    const text = fs.readFileSync(envPath, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
      if (!m) continue; // comments/blank lines
      let value = m[2].trim();
      if (
        (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
        (value.startsWith("'") && value.endsWith("'") && value.length > 1)
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[m[1]] === undefined) process.env[m[1]] = value;
    }
  } catch {
    // no .env on disk — environment variables only (fresh clone / tests)
  }
}
loadEnvFile();

/**
 * Call the provider and return the parsed plan object (unvalidated — the
 * adapter validates). Throws AiError for missing credentials, network
 * problems, non-2xx provider responses, and unparseable output.
 */
export async function generateRawPlan(systemInstruction, userPrompt) {
  const baseUrl = (process.env.AI_BASE_URL || '').trim() || DEFAULT_BASE_URL;
  const model = (process.env.AI_MODEL || '').trim() || DEFAULT_MODEL;
  const apiKey = (process.env.AI_API_KEY || '').trim();
  if (!apiKey) {
    throw new AiError('AI credentials are not configured (AI_API_KEY is missing).');
  }

  const url = `${baseUrl.replace(/\/+$/, '')}/models/${encodeURIComponent(model)}:generateContent`;

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': apiKey, // key travels only in this header, never logged
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: PLAN_RESPONSE_SCHEMA,
        },
        // deliberately NO "tools" — no search, no URL context, no browsing.
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw new AiError('The AI request timed out.');
    }
    throw new AiError('Could not reach the AI provider.');
  }

  if (!res.ok) {
    // 401 bad key, 404 unknown model, 429 rate limit, 5xx provider errors —
    // status only: the body is never echoed and the key is never logged.
    throw new AiError(`The AI provider returned HTTP ${res.status}.`);
  }

  let data;
  try {
    data = await res.json();
  } catch {
    throw new AiError('The AI provider returned unreadable JSON.');
  }

  const parts = data?.candidates?.[0]?.content?.parts;
  const text = Array.isArray(parts)
    ? parts.map((p) => (typeof p?.text === 'string' ? p.text : '')).join('')
    : '';
  if (!text.trim()) {
    // e.g. blocked candidate / empty response — still ai_failed, no fallback content
    throw new AiError('The AI provider returned no text candidate.');
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new AiError('The AI returned output that is not valid JSON.');
  }
}
