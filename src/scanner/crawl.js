// crawl — bounded same-origin page discovery (Final Review revision).
// BFS from the seed page over discovered links under hard rules:
//   - at most MAX_CRAWLED_PAGES REQUESTED pages per scan, seed included
//     (robots-blocked / duplicate / external / never-requested URLs do NOT
//     consume the budget);
//   - STRICT origin: only URLs on the exact normalized origin of the
//     SUBMITTED seed URL are ever requested (www and non-www are different
//     origins and are never interchangeable); redirect hops on crawled pages
//     that would leave that origin are refused before any off-origin request;
//   - robots.txt Disallow rules gate DISCOVERED URLs (reuses matchRobotsTxt
//     from checks.js); blocked URLs are honestly recorded as skipped;
//   - loops and duplicate URLs are prevented by one `seen` set (hash-stripped
//     normalized URLs);
//   - failures (network, timeout, >2 MB response, invalid URL) are recorded
//     as crawl failures with the real reason — NEVER as findings, never
//     silently dropped;
//   - obvious non-page resources (.pdf/.jpg/.png/.css/.js/fonts/archives/…)
//     are never queued as crawl candidates — extensionless HTML routes always
//     are. The extension pre-filter only saves budget: the response's
//     Content-Type remains authoritative for how a fetched URL is treated;
//   - only HTML responses are checked and used for discovery (runPageChecks):
//     a fetched non-HTML response is recorded as `non_html` with its HTTP
//     status and an honest reason — never HTML findings, never a link source;
//   - progress events are factual counts only — no invented percentages.
// Spec ref: spec.md > Scanner > crawl (Final Review revision).

import { fetchSafe } from './fetchPage.js';
import { runPageChecks, matchRobotsTxt } from './checks.js';
import { REQUEST_TIMEOUT_MS, MAX_CRAWLED_PAGES } from '../checkConfig.js';

/** File extensions of obvious NON-PAGE resources — never queued as crawl
 *  candidates. This is only a budget pre-filter; it runs AFTER origin and
 *  duplicate checks, and Content-Type of a fetched response stays
 *  authoritative (an extensionless URL serving a PDF is caught there).
 *  Deliberately excludes page extensions (.html/.htm/.php/.asp/.aspx/.jsp/…)
 *  and never touches extensionless routes — those always stay scannable. */
const NON_PAGE_EXTENSIONS = new Set([
  // documents / archives
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'rtf',
  'zip', 'rar', '7z', 'gz', 'tar', 'bz2',
  // images
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg', 'ico', 'tif', 'tiff',
  // styles / scripts / data (assets, not pages)
  'css', 'js', 'mjs', 'cjs', 'map', 'json', 'xml', 'txt', 'csv',
  // fonts
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  // audio / video
  'mp3', 'wav', 'ogg', 'm4a', 'mp4', 'webm', 'mov', 'avi', 'mkv',
  // executables / installers
  'exe', 'dmg', 'apk', 'deb', 'rpm', 'iso', 'bin', 'wasm',
]);

/**
 * True when a normalized same-origin URL is a plausible PAGE to crawl.
 * Extension check runs on the PATHNAME only (query strings like
 * `/download?format=pdf` never disqualify a route) and extensionless URLs are
 * always candidates.
 */
export function isCrawlCandidate(urlStr) {
  let pathname;
  try {
    pathname = new URL(urlStr).pathname;
  } catch {
    return false;
  }
  const lastSegment = pathname.split('/').pop() || '';
  const dot = lastSegment.lastIndexOf('.');
  if (dot <= 0) return true; // no extension, or a leading-dot segment (.well-known)
  return !NON_PAGE_EXTENSIONS.has(lastSegment.slice(dot + 1).toLowerCase());
}

/**
 * Normalize a discovered href to an absolute, hash-stripped http(s) URL.
 * Returns null for unusable hrefs (empty, unparseable, mailto:/tel:/
 * javascript:/data: etc.) — those are never crawl candidates.
 */
export function normalizeCrawlUrl(href, baseUrl) {
  if (typeof href !== 'string' || !href.trim()) return null;
  let url;
  try {
    url = new URL(href.trim(), baseUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  url.hash = '';
  return url.href;
}

/** STRICT origin equality (scheme + host + port, exact — no www tolerance). */
export function isSameOrigin(urlStr, origin) {
  try {
    return new URL(urlStr).origin === origin;
  } catch {
    return false;
  }
}

/**
 * Run the bounded crawl AFTER the seed page has been fetched and checked.
 *
 * @param input.seedTarget    validateTarget() result for the submitted URL
 * @param input.seedPage      fetchSafe() result for the seed page
 * @param input.seedSignals   HTML signals for the seed page (parseHtml result
 *                            when the seed is HTML; { anchors: [] } otherwise —
 *                            a non-HTML seed is never a link source)
 * @param input.seedRecord    { url, finalUrl, status, state: 'seed', findings }
 *                            ledger entry for the already-checked seed page
 * @param input.probes        { robots, favicon } for CRAWLED pages (usually
 *                            the seed's probes — same origin in the normal case)
 * @param input.robotsGateBody robots.txt BODY of the crawled origin, or null
 *                            (absent/unreadable robots.txt never blocks)
 * @param input.factory       shared finding factory (global f_N per scan)
 * @param input.onProgress    (data) => void — factual progress events
 * @param input.fetchPage     injectable fetch (tests): async (target, originLimit) => page
 * @returns { findings, unavailableChecks, pages, crawlFailures,
 *            requested, discovered, limit }
 */
export async function crawlSite({
  seedTarget,
  seedPage,
  seedSignals,
  seedRecord,
  probes,
  robotsGateBody,
  factory,
  onProgress = () => {},
  fetchPage,
}) {
  const origin = seedTarget.url.origin;
  const limit = MAX_CRAWLED_PAGES;
  const fetch =
    fetchPage ??
    ((target, originLimit) => fetchSafe(target, REQUEST_TIMEOUT_MS, originLimit));

  const pages = [seedRecord];
  const findings = [];
  const unavailableChecks = [];
  const crawlFailures = [];
  const seen = new Set();
  const queue = [];
  let requested = 1; // the seed page was already requested

  // Seed URLs are known, never re-queued (loop/duplicate prevention).
  for (const raw of [seedTarget.url.href, seedPage.finalUrl]) {
    const normalized = normalizeCrawlUrl(raw, raw);
    if (normalized && isSameOrigin(normalized, origin)) seen.add(normalized);
  }

  const discover = (anchors, baseUrl) => {
    for (const anchor of anchors || []) {
      const normalized = normalizeCrawlUrl(anchor?.href, baseUrl);
      if (!normalized || !isSameOrigin(normalized, origin) || seen.has(normalized)) {
        continue; // external origin / duplicate / unusable — never queued
      }
      if (!isCrawlCandidate(normalized)) {
        continue; // obvious asset (pdf/image/css/js/font/…) — not a page, no budget spent
      }
      seen.add(normalized);
      queue.push(normalized);
    }
  };

  const snapshot = (fetching = null) => ({
    scanned: pages.filter((p) => p.state === 'seed' || p.state === 'scanned').length,
    discovered: seen.size,
    requested,
    limit,
    fetching,
    pages,
  });

  // Initial discovery from the seed page, then the first honest event.
  discover(seedSignals.anchors, seedPage.finalUrl);
  onProgress(snapshot(null));

  while (queue.length > 0 && requested < limit) {
    const url = queue.shift();

    // Robots gating applies to DISCOVERED URLs only (the seed is explicitly
    // user-requested). A blocked URL is skipped WITHOUT consuming budget.
    if (robotsGateBody) {
      let match = null;
      try {
        match = matchRobotsTxt(robotsGateBody, new URL(url).pathname);
      } catch {
        match = null;
      }
      if (match?.adverse) {
        pages.push({
          url,
          state: 'skipped_robots',
          reason: `robots.txt rule "${match.matchedRule}" disallows this path`,
        });
        onProgress(snapshot(null));
        continue;
      }
    }

    requested += 1;
    onProgress(snapshot(url));
    try {
      // Same strict origin ⇒ same host the seed already validated: reuse the
      // seed's pinned destination (socket stays on the validated IP).
      const target = { ...seedTarget, url: new URL(url) };
      const page = await fetch(target, origin);
      // Content gate: HTML responses get the full catalog; anything else
      // (Content-Type authoritative) gets only its factual HTTP status plus
      // an honest unavailableChecks reason — never HTML findings.
      const run = runPageChecks({ requestedUrl: url, page, probes, factory });
      findings.push(...run.findings);
      for (const entry of run.unavailableChecks) {
        if (
          !unavailableChecks.some((u) => u.type === entry.type && u.reason === entry.reason)
        ) {
          unavailableChecks.push(entry);
        }
      }
      pages.push({
        url,
        finalUrl: page.finalUrl,
        status: page.status,
        state: run.state, // 'scanned' (HTML) | 'non_html' (any other content type)
        findings: run.findings.length,
        ...(run.contentType && { contentType: run.contentType }),
      });
      // Only HTML pages feed discovery: runPageChecks returns empty anchors
      // for non-HTML content, so a PDF/image/CSS/JS payload can never be used
      // as a link source. Error pages (4xx/5xx) with parseable HTML still
      // feed discovery — their status is a finding, their links discoverable.
      discover(run.signals.anchors, page.finalUrl);
    } catch (err) {
      const reason = err?.message || 'The page could not be fetched.';
      if (err?.code === 'off_origin_redirect') {
        pages.push({ url, state: 'skipped_redirect', reason });
      } else {
        pages.push({ url, state: 'failed', reason });
        crawlFailures.push({ url, reason });
      }
    }
    onProgress(snapshot(null));
  }

  return {
    findings,
    unavailableChecks,
    pages,
    crawlFailures,
    requested,
    discovered: seen.size,
    limit,
  };
}
