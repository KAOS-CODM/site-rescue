import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateTarget, fetchSafe, probePath } from './scanner/fetchPage.js';
import { parseHtml } from './scanner/parseHtml.js';
import { runChecks } from './scanner/checks.js';

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

app.listen(PORT, () => {
  console.log(`Site Rescue running at http://localhost:${PORT}`);
});
