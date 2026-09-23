import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateTarget, fetchSafe, probePath } from './scanner/fetchPage.js';
import { parseHtml } from './scanner/parseHtml.js';
import { runChecks } from './scanner/checks.js';
import { generatePlan } from './ai/adapter.js';
import { NO_FINDINGS_SUMMARY } from './ai/planSchema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;

// Serve the vanilla frontend from public/ (spec > Components > Express server).
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(express.json());

// POST /api/scan (spec > Components > POST /api/scan): SSRF validation first —
// rejection happens before any request is attempted.
app.post('/api/scan', async (req, res) => {
  try {
    const target = await validateTarget(req.body?.url);
    const page = await fetchSafe(target);

    // Probe the FINAL origin (the site actually scanned after redirects).
    const origin = new URL(page.finalUrl).origin;
    const [robots, favicon] = await Promise.all([
      probePath(origin, '/robots.txt'),
      probePath(origin, '/favicon.ico'),
    ]);

    const signals = parseHtml(page.body);
    const { findings, unavailableChecks, partial } = runChecks({
      requestedUrl: target.url.href,
      page: { finalUrl: page.finalUrl, status: page.status, ttfbMs: page.ttfbMs, headers: page.headers },
      signals,
      probes: { robots, favicon },
    });

    res.json({
      url: target.url.href,
      finalUrl: page.finalUrl,
      status: page.status,
      ttfbMs: page.ttfbMs,
      findings,
      ...(unavailableChecks.length > 0 && { unavailableChecks }),
      ...(partial && { partial: true }),
    });
  } catch (err) {
    if (err?.code === 'invalid_url') {
      return res.status(400).json({ error: 'invalid_url', message: err.message });
    }
    if (err?.code === 'unreachable') {
      return res.status(502).json({ error: 'unreachable', message: err.message });
    }
    console.error('scan_failed:', err);
    res.status(500).json({ error: 'scan_failed', message: 'The scan could not be completed.' });
  }
});

// POST /api/plan (spec > Components): scanner findings in → AI rescue plan out.
// Every AI-layer failure (bad/missing credentials, provider non-2xx, invalid
// JSON, invented/missing/duplicate finding ids) maps to ai_failed — never to
// fabricated fallback content.
app.post('/api/plan', async (req, res) => {
  const findings = req.body?.findings;
  if (!Array.isArray(findings)) {
    return res.status(400).json({ error: 'invalid_request', message: 'Expected { findings: [...] }.' });
  }
  // Request-shape guard so the exactly-once cross-check has clean ids to work
  // with (the scanner never produces these states — clients can).
  const ids = [];
  for (const f of findings) {
    if (!f || typeof f !== 'object' || typeof f.id !== 'string' || !f.id.trim()) {
      return res.status(400).json({ error: 'invalid_request', message: 'Every finding must have a non-empty id.' });
    }
    ids.push(f.id);
  }
  if (new Set(ids).size !== ids.length) {
    return res.status(400).json({ error: 'invalid_request', message: 'Finding ids must be unique.' });
  }

  // Deterministic no-findings case: an empty valid plan, all three priority
  // groups empty — the AI is NEVER asked to invent a plan for zero findings.
  if (findings.length === 0) {
    return res.json({ summary: NO_FINDINGS_SUMMARY, results: [] });
  }

  try {
    const plan = await generatePlan(findings);
    res.json(plan);
  } catch (err) {
    // message only — credentials and payloads are never logged
    console.error('ai_failed:', err?.message);
    res.status(502).json({
      error: 'ai_failed',
      message: 'The rescue-plan step could not be completed. Try again.',
    });
  }
});

app.listen(PORT, () => {
  console.log(`Site Rescue running at http://localhost:${PORT}`);
});
