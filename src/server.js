import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateTarget, fetchSafe, probePath } from './scanner/fetchPage.js';
import { runPageChecks } from './scanner/checks.js';
import { createFindingFactory } from './scanner/findingTypes.js';
import { crawlSite } from './scanner/crawl.js';
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
//
// Two phases (Final Review revision):
//   1. PRE-STREAM — validation, seed fetch, probes, seed checks. Any failure
//      here keeps the ORIGINAL JSON error contract untouched: 400 invalid_url,
//      502 unreachable, 500 scan_failed — sent before a single stream byte.
//   2. STREAM — SSE-style `data: {json}\n\n` events over the same POST
//      response: factual progress events ({type:'progress', scanned,
//      discovered, requested, limit, fetching, pages}) while the bounded
//      same-origin crawl runs, then EXACTLY ONE terminal event —
//      {type:'result', result:{...}} or {type:'error', ...}. No fake
//      percentages: every number streamed is a real counter.
app.post('/api/scan', async (req, res) => {
  // ---------------- Phase 1: pre-stream (failure contract unchanged) ----------
  let seed;
  try {
    const target = await validateTarget(req.body?.url);
    const page = await fetchSafe(target);

    // Probe the FINAL origin (the site actually scanned after redirects).
    const finalOrigin = new URL(page.finalUrl).origin;
    const [robots, favicon] = await Promise.all([
      probePath(finalOrigin, '/robots.txt'),
      probePath(finalOrigin, '/favicon.ico'),
    ]);

    // Crawled pages live on the STRICT origin of the SUBMITTED URL (crawl.js).
    // Normally that is the final origin and the probes above serve both roles;
    // only a cross-origin seed redirect needs its own probe pair + robots gate
    // so crawl gating never borrows another origin's robots.txt.
    const crawlOrigin = target.url.origin;
    let crawlProbes = { robots, favicon };
    let robotsGateBody = robots.checked && robots.ok ? robots.body : null;
    if (crawlOrigin !== finalOrigin) {
      const [crawlRobots, crawlFavicon] = await Promise.all([
        probePath(crawlOrigin, '/robots.txt'),
        probePath(crawlOrigin, '/favicon.ico'),
      ]);
      crawlProbes = { robots: crawlRobots, favicon: crawlFavicon };
      robotsGateBody = crawlRobots.checked && crawlRobots.ok
        ? crawlRobots.body
        : null;
    }

    // One factory per scan: seed + crawled pages share the global f_N counter.
    const factory = createFindingFactory();
    // Content gate (content-aware scanning): the response's Content-Type is
    // authoritative. HTML → the full check catalog; anything else (PDF, image,
    // CSS, JS, …) → only its factual HTTP status plus an honest unavailable
    // reason. HTML checks never run against a non-HTML payload, so no HTML
    // findings can be fabricated for one.
    const seedRun = runPageChecks({
      requestedUrl: target.url.href,
      page,
      probes: { robots, favicon },
      factory,
    });
    const signals = seedRun.signals; // anchors [] when the seed is not HTML

    seed = { target, page, robots, favicon, crawlProbes, robotsGateBody, factory, signals, seedRun, finalOrigin };
  } catch (err) {
    // Pre-stream contract — byte-for-byte the original error shape.
    if (err?.code === 'invalid_url') {
      return res.status(400).json({ error: 'invalid_url', message: err.message });
    }
    if (err?.code === 'unreachable') {
      return res.status(502).json({ error: 'unreachable', message: err.message });
    }
    console.error('scan_failed:', err);
    return res.status(500).json({ error: 'scan_failed', message: 'The scan could not be completed.' });
  }

  // ---------------- Phase 2: progress stream ---------------------------------
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.on('error', () => {}); // a client that disconnects mid-stream must not crash the process

  const send = (event) => {
    if (res.destroyed || res.writableEnded) return; // client gone — stop writing
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch {
      // stream closed underneath us — nothing left to do
    }
  };

  const { target, page, crawlProbes, robotsGateBody, factory, signals, seedRun } = seed;
  const seedRecord = {
    url: target.url.href,
    finalUrl: page.finalUrl,
    status: page.status,
    // 'seed' for HTML pages; a non-HTML seed is honestly `non_html` so it is
    // never presented as a scanned HTML page ("pages scanned" stays truthful).
    state: seedRun.state === 'scanned' ? 'seed' : seedRun.state,
    findings: seedRun.findings.length,
    ...(seedRun.contentType && { contentType: seedRun.contentType }),
  };

  let crawl;
  try {
    crawl = await crawlSite({
      seedTarget: target,
      seedPage: page,
      seedSignals: signals,
      seedRecord,
      probes: crawlProbes,
      robotsGateBody,
      factory,
      onProgress: (snapshot) => send({ type: 'progress', ...snapshot }),
    });
  } catch (err) {
    // Mid-stream failure: honest error event, never a fabricated result.
    console.error('scan_failed:', err);
    send({ type: 'error', error: 'scan_failed', message: 'The scan could not be completed.' });
    res.end();
    return;
  }

  // Merge seed + crawl evidence (global factory already made ids unique) and
  // de-duplicate identical probe failures across pages (same probes → same
  // type+reason).
  const findings = [...seedRun.findings, ...crawl.findings];
  const unavailableChecks = [];
  for (const entry of [...seedRun.unavailableChecks, ...crawl.unavailableChecks]) {
    if (!unavailableChecks.some((u) => u.type === entry.type && u.reason === entry.reason)) {
      unavailableChecks.push(entry);
    }
  }
  const crawlFailures = crawl.crawlFailures;
  const skipped = crawl.pages
    .filter((p) => p.state === 'skipped_robots' || p.state === 'skipped_redirect')
    .map(({ url, reason }) => ({ url, reason }));
  // Partial = evidence the plan is missing: checks that could not run OR
  // discovered pages that could not be fetched. Robots/origin skips are policy,
  // not missing evidence — they live in `skipped`, never in `partial`.
  const partial = unavailableChecks.length > 0 || crawlFailures.length > 0;

  send({
    type: 'result',
    result: {
      url: target.url.href,
      finalUrl: page.finalUrl,
      status: page.status,
      ttfbMs: page.ttfbMs,
      findings,
      ...(unavailableChecks.length > 0 && { unavailableChecks }),
      ...(partial && { partial: true }),
      pages: crawl.pages,
      discovered: crawl.discovered,
      skipped,
      crawlFailures,
      limit: crawl.limit,
    },
  });
  res.end();
});

// POST /api/plan (spec > Components): scanner findings in → AI rescue plan out.
// Every AI-layer failure (bad/missing credentials, provider non-2xx, invalid
// JSON, invented/missing/duplicate finding ids) maps to ai_failed — never to
// fabricated fallback content.  Response contract and ai_failed/retry mapping
// UNCHANGED; the request body gains an OPTIONAL `pages` ledger (additive) so
// the AI can describe the real scope of multi-page scans instead of guessing.
app.post('/api/plan', async (req, res) => {
  const findings = req.body?.findings;
  const pages = req.body?.pages;
  if (!Array.isArray(findings)) {
    return res.status(400).json({ error: 'invalid_request', message: 'Expected { findings: [...] }.' });
  }
  if (pages !== undefined && !Array.isArray(pages)) {
    return res.status(400).json({ error: 'invalid_request', message: 'Expected { findings: [...], pages?: [...] }.' });
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
    const plan = await generatePlan(findings, pages);
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
