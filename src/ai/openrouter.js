// openrouter.js — default AI provider implementation, env-configured.
// OpenAI-compatible chat completions via OpenRouter.
// Provider tested 2026-09-24 (independently, in Thunder Client) with
// Novita / inclusionai/ling-3.0-flash-fin:free: normal JSON generation and
// Site Rescue plan JSON both passed.
//   Endpoint : POST {AI_BASE_URL}/chat/completions
//              https://openrouter.ai/api/v1/chat/completions
//   Auth     : Authorization: Bearer {AI_API_KEY}
//   Messages : [{ role: "system", content: systemInstruction },
//               { role: "user",   content: userPrompt }]
//   Body     : model + messages + temperature 0. Deliberately NO
//              response_format: the Novita-served free model does not
//              support structured outputs — schema conformance comes from
//              the system instruction, and application-code validation
//              (validatePlan.js) is the real fence either way.
//   Response : choices[0].message.content (string → trim → strip a Markdown
//              fence ONLY if it surrounds the whole value → JSON.parse;
//              reasoning/reasoning_details fields are never read)
// NO tools are ever sent — no browsing, no URL context (spec > AI adapter:
// the AI gets no browsing abilities).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_MODEL = 'inclusionai/ling-3.0-flash-fin:free';
const REQUEST_TIMEOUT_MS = 30000; // derived: bounded wait so /api/plan can't hang

/** Every AI-layer failure is this error type; the route maps it to ai_failed. */
export class AiError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AiError';
  }
}

// Minimal .env reader (no dependency, per spec > stack). Existing
// process.env values win, so CLI flags can override the file. Never logged.
const loadEnvFile = () => {
  try {
    const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.env');
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    /* no .env file — env vars / defaults apply */
  }
};
loadEnvFile();

/**
 * Call the OpenAI-compatible chat-completions endpoint and return the
 * UNVALIDATED raw plan object. Throws AiError on every failure mode
 * (misconfiguration, network, timeout, HTTP status, unreadable/empty/
 * invalid-JSON response) — the adapter runs validatePlan before anything
 * reaches the UI.
 */
export async function generateRawPlan(systemInstruction, userPrompt) {
  // Configured-provider guard: fail honestly instead of silently half-working.
  const provider = (process.env.AI_PROVIDER || '').trim().toLowerCase();
  if (provider && provider !== 'openrouter') {
    throw new AiError(`Unsupported AI_PROVIDER "${provider.slice(0, 30)}".`);
  }
  const baseUrl = (process.env.AI_BASE_URL || '').trim() || DEFAULT_BASE_URL;
  const model = (process.env.AI_MODEL || '').trim() || DEFAULT_MODEL;
  const apiKey = (process.env.AI_API_KEY || '').trim();
  if (!apiKey) {
    throw new AiError('AI credentials are not configured (AI_API_KEY is missing).');
  }

  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${apiKey}`, // key travels only in this header, never logged
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0,
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

  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    // e.g. filtered/empty response — still ai_failed, no fallback content
    throw new AiError('The AI provider returned no message content.');
  }

  // Tolerate harmless formatting only: trim, then remove a Markdown fence
  // ONLY if it surrounds the entire value (```json … ``` or ``` … ```).
  // Prose, inner fences, and unclosed fences are left untouched and fail
  // JSON.parse honestly. Only message.content reaches this point —
  // reasoning/reasoning_details are ignored by construction.
  let text = content.trim();
  const fenced = text.match(/^```(?:json)?[ \t]*\r?\n?([\s\S]*?)\r?\n?[ \t]*```$/);
  if (fenced) text = fenced[1].trim();

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AiError('The AI returned output that is not valid JSON.');
  }

  // Whatever parsed goes to validatePlan UNCHANGED — including a top-level
  // array, which validatePlan already inspects and rejects ('plan is not an
  // object'). No envelope is synthesized and no field is invented here:
  // the validator stays the final authority over acceptance.
  return parsed;
}
