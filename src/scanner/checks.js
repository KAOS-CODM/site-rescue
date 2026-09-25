// checks — the complete 16-condition catalog with the exact approved
// thresholds. Facts only: every fired check produces one finding carrying
// structured evidence; unavailable probes become unavailableChecks and are
// NEVER converted into findings or silent passes.
// Content gate (content-aware scanning revision): runChecks assumes the page
// IS HTML. runPageChecks is the content-type-aware entry point both the seed
// and the crawl use — HTML responses get this catalog, any other content type
// (PDF, image, CSS, JS, fonts, archives…) gets only its factual HTTP status
// plus an honest unavailableChecks entry. No HTML check ever runs against a
// non-HTML payload, and no HTML findings are ever fabricated for one.
// Spec ref: spec.md > Scanner > checks (thresholds table + robots evidence).

import {
  TITLE_MAX_LENGTH,
  TTFB_THRESHOLD_MS,
  GENERIC_LINK_PHRASES,
} from '../checkConfig.js';
import { createFindingFactory } from './findingTypes.js';
import { parseHtml } from './parseHtml.js';
import { isHtmlResponse, responseContentType } from './fetchPage.js';

/* ---------------- robots.txt matching (UA: * only, longest match wins) --- */

function patternToRegex(pattern) {
  let body = pattern;
  let endAnchor = false;
  if (body.endsWith('$')) {
    endAnchor = true;
    body = body.slice(0, -1);
  }
  const escaped = body
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${escaped}${endAnchor ? '$' : ''}`);
}

/** Returns { applicable, matchedRule, raw, adverse } for path under UA "*". */
export function matchRobotsTxt(robotsBody, path) {
  const lines = robotsBody.split(/\r?\n/).map((l) => l.split('#')[0].trim());

  // Split into groups: one or more user-agent lines, then rule lines.
  const groups = [];
  let currentGroup = null;
  let sawRule = false;
  for (const line of lines) {
    if (!line) continue;
    const [rawKey, ...rest] = line.split(':');
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(':').trim();
    if (key === 'user-agent') {
      if (!currentGroup || sawRule) {
        currentGroup = { agents: [], rules: [] };
        groups.push(currentGroup);
        sawRule = false;
      }
      currentGroup.agents.push(value.toLowerCase());
    } else if (key === 'allow' || key === 'disallow') {
      if (!currentGroup) continue; // rules before any user-agent line: ignore
      currentGroup.rules.push({ type: key, path: value, raw: line });
      sawRule = true;
    }
    // sitemap/host/other keys: ignored
  }

  const rules = groups
    .filter((g) => g.agents.includes('*'))
    .flatMap((g) => g.rules)
    .filter((r) => r.path !== ''); // empty Disallow = allow everything

  if (rules.length === 0) return { applicable: false, matchedRule: null, raw: null, adverse: false };

  let best = null;
  for (const rule of rules) {
    let matched = false;
    try {
      matched = patternToRegex(rule.path).test(path);
    } catch {
      matched = false;
    }
    if (!matched) continue;
    const len = rule.path.length;
    if (!best || len > best.len || (len === best.len && rule.type === 'allow')) {
      best = { rule, len };
    }
  }

  if (!best) return { applicable: true, matchedRule: null, raw: null, adverse: false };
  return {
    applicable: true,
    matchedRule: `${best.rule.type === 'allow' ? 'Allow' : 'Disallow'}: ${best.rule.path}`,
    raw: best.rule.raw,
    adverse: best.rule.type === 'disallow',
  };
}

/* ---------------- directive parsing (meta robots / X-Robots-Tag) --------- */

function parseDirectiveTokens(raw) {
  if (!raw) return [];
  return raw
    .toLowerCase()
    .split(/[,\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function hasNoindex(tokens) {
  return tokens.includes('noindex') || tokens.includes('none');
}
function hasNofollow(tokens) {
  return tokens.includes('nofollow') || tokens.includes('none');
}

/* ---------------- the 16 checks ------------------------------------------ */

/**
 * Run all 16 conditions.
 * @param input.requestedUrl  normalized URL the user asked to scan
 * @param input.page          { finalUrl, status, ttfbMs, headers }
 * @param input.signals       parseHtml output
 * @param input.probes        { robots, favicon } probe results
 * @param input.factory       optional shared finding factory (one per scan,
 *                            keeps f_N ids unique across crawled pages)
 * @returns { findings, unavailableChecks, partial }
 */
export function runChecks({ requestedUrl, page, signals, probes, factory }) {
  const sharedFactory = factory ?? createFindingFactory();
  // Page attribution: evidence came from the content at the final URL.
  const make = (type, note, evidence) =>
    sharedFactory(type, note, evidence, page.finalUrl);
  const findings = [];
  const unavailableChecks = [];

  /* 1 — seo.title.missing */
  if (signals.title === null || signals.title === '') {
    findings.push(
      make('seo.title.missing', 'The page has no usable <title> element.', {
        title: signals.title ?? null,
        source: '<title> element (trimmed)',
      }),
    );
  }

  /* 2 — seo.title.too_long */
  if (signals.title && signals.title.length > TITLE_MAX_LENGTH) {
    findings.push(
      make('seo.title.too_long', 'The page title is longer than the approved length threshold.', {
        title: signals.title,
        length: signals.title.length,
        threshold: TITLE_MAX_LENGTH,
        measured: 'trimmed character count',
      }),
    );
  }

  /* 3 — seo.meta_description.missing */
  const desc = signals.metaDescriptionContent;
  if (desc === null || desc.trim() === '') {
    findings.push(
      make('seo.meta_description.missing', 'The page has no meta description with content.', {
        metaDescription: desc,
        source: '<meta name="description"> content attribute',
      }),
    );
  }

  /* 4 — seo.viewport.missing */
  if (!signals.hasViewport) {
    findings.push(
      make('seo.viewport.missing', 'The page declares no viewport meta element.', {
        viewportMeta: null,
        source: '<meta name="viewport"> presence',
      }),
    );
  }

  /* 5 — accessibility.img_alt.missing
     Fires only for <img> with NO alt attribute or whitespace-only alt;
     alt="" (exactly empty) is decorative and never fires. */
  const missingAlt = signals.images.filter(
    (img) => !img.hasAlt || (img.altValue !== '' && img.altValue.trim() === ''),
  );
  const decorative = signals.images.filter((img) => img.hasAlt && img.altValue === '');
  if (missingAlt.length > 0) {
    findings.push(
      make(
        'accessibility.img_alt.missing',
        `${missingAlt.length} image(s) lack a usable alt attribute.`,
        {
          missingCount: missingAlt.length,
          examples: missingAlt.slice(0, 10).map((img) => ({ src: img.src })),
          decorativeExcluded: decorative.length,
          rule: 'no alt attribute, or whitespace-only alt; alt="" decorative images excluded',
        },
      ),
    );
  }

  /* 6/7 — seo.h1.missing / seo.h1.multiple */
  const h1s = signals.headings.filter((h) => h.level === 1);
  if (h1s.length === 0) {
    findings.push(
      make('seo.h1.missing', 'The page contains no <h1> element.', {
        h1Count: 0,
        headingCount: signals.headings.length,
      }),
    );
  } else if (h1s.length > 1) {
    findings.push(
      make('seo.h1.multiple', `The page contains ${h1s.length} <h1> elements.`, {
        h1Count: h1s.length,
        h1Texts: h1s.map((h) => h.text),
      }),
    );
  }

  /* 8 — seo.heading_levels.skipped */
  const skips = [];
  for (let i = 1; i < signals.headings.length; i += 1) {
    const prev = signals.headings[i - 1];
    const cur = signals.headings[i];
    if (cur.level > prev.level + 1) {
      skips.push({ from: `h${prev.level}`, to: `h${cur.level}`, text: cur.text.slice(0, 80) });
    }
  }
  if (skips.length > 0) {
    findings.push(
      make('seo.heading_levels.skipped', `Heading levels skip ${skips.length} level(s).`, {
        skips,
        rule: 'a heading follows a lower level with no intervening level (e.g. h2 -> h4)',
      }),
    );
  }

  /* 9 — accessibility.lang.missing */
  if (!signals.htmlLangPresent) {
    findings.push(
      make('accessibility.lang.missing', 'The <html> element has no lang attribute.', {
        langAttribute: null,
        source: '<html lang> attribute presence',
      }),
    );
  }

  /* 10 — seo.canonical.missing */
  if (!signals.canonicalPresent) {
    findings.push(
      make('seo.canonical.missing', 'The page declares no canonical link element.', {
        canonical: null,
        source: '<link rel="canonical"> presence only',
      }),
    );
  }

  /* 12 — accessibility.link_text.generic
     (favicon check is #11 but runs after its probe result is known — see below) */
  const isGenericText = (text) => {
    const t = text.trim().toLowerCase();
    if (GENERIC_LINK_PHRASES.includes(t)) return true;
    if (text.trim().length === 1) return true; // single char/number
    if (/^https?:\/\//i.test(text.trim()) || /^www\./i.test(text.trim())) return true; // bare URL
    return false;
  };
  const genericLinks = (signals.anchors || []).filter((a) => {
    if (!a.href) return false; // not a link (no href) — nothing to describe
    const hasFallback = Boolean(a.ariaLabel?.trim() || a.titleAttr?.trim());
    if (a.text === '' || a.text === null) return !hasFallback; // empty without fallback
    return isGenericText(a.text);
  });
  if (genericLinks.length > 0) {
    findings.push(
      make(
        'accessibility.link_text.generic',
        `${genericLinks.length} link(s) use non-descriptive text.`,
        {
          matchedCount: genericLinks.length,
          examples: genericLinks.slice(0, 10).map((a) => ({ text: a.text, href: a.href })),
          phraseList: GENERIC_LINK_PHRASES,
          rule: 'fixed phrase list, single char/number, bare URL, or empty without aria-label/title',
        },
      ),
    );
  }

  /* 13 — technical.https.missing (final URL after redirects) */
  if (page.finalUrl.startsWith('http://')) {
    findings.push(
      make('technical.https.missing', 'The final URL after redirects is not HTTPS.', {
        requestedUrl,
        finalUrl: page.finalUrl,
        rule: 'final https:// = no finding; http:// -> https:// redirect = no finding; final http:// = finding',
      }),
    );
  }

  /* 14 — perf.slow_response */
  if (page.ttfbMs > TTFB_THRESHOLD_MS) {
    findings.push(
      make('perf.slow_response', 'Response headers took longer than the approved threshold.', {
        ttfbMs: page.ttfbMs,
        thresholdMs: TTFB_THRESHOLD_MS,
        measured: 'request start until response headers received',
      }),
    );
  }

  /* 15 — seo.robots.signals (raw evidence kept separate from interpretation) */
  const metaTokens = parseDirectiveTokens(signals.metaRobotsContent);
  const xRobotsRaw = Array.isArray(page.headers['x-robots-tag'])
    ? page.headers['x-robots-tag'].join(', ')
    : page.headers['x-robots-tag'] || null;
  const xTokens = parseDirectiveTokens(xRobotsRaw);

  const robotsProbe = probes.robots;
  let robotsTxtEvidence;
  let robotsMatch = null;
  if (!robotsProbe.checked) {
    robotsTxtEvidence = { checked: false, reason: robotsProbe.reason };
    unavailableChecks.push({
      type: 'seo.robots.signals',
      reason: `robots.txt could not be checked: ${robotsProbe.reason}`,
    });
  } else if (!robotsProbe.ok) {
    robotsTxtEvidence = { checked: true, exists: false, matchedRule: null, raw: null };
  } else {
    robotsMatch = matchRobotsTxt(robotsProbe.body, new URL(page.finalUrl).pathname);
    robotsTxtEvidence = {
      checked: true,
      exists: true,
      matchedRule: robotsMatch.matchedRule,
      raw: robotsMatch.raw,
      applicable: robotsMatch.applicable,
    };
  }

  const indexingCauses = [];
  if (hasNoindex(metaTokens)) {
    indexingCauses.push('meta robots content declares "noindex" — an indexing directive');
  }
  if (hasNoindex(xTokens)) {
    indexingCauses.push('X-Robots-Tag header declares "noindex" — an indexing directive');
  }
  const crawlingCauses = [];
  if (hasNofollow(metaTokens)) {
    crawlingCauses.push('meta robots content declares "nofollow" — a link-following directive, not an indexing directive');
  }
  if (hasNofollow(xTokens)) {
    crawlingCauses.push('X-Robots-Tag header declares "nofollow" — a link-following directive, not an indexing directive');
  }
  if (robotsMatch && robotsMatch.adverse) {
    crawlingCauses.push(`robots.txt rule "${robotsMatch.matchedRule}" disallows this path for user-agent *`);
  }

  if (indexingCauses.length > 0 || crawlingCauses.length > 0) {
    findings.push(
      make('seo.robots.signals', 'The page carries adverse indexing or crawling signals.', {
        metaRobots: {
          present: signals.metaRobotsContent !== null,
          raw: signals.metaRobotsContent,
          directives: metaTokens,
        },
        xRobotsTag: {
          present: xRobotsRaw !== null,
          raw: xRobotsRaw,
          directives: xTokens,
        },
        robotsTxt: robotsTxtEvidence,
        // Derived conclusion — labeled, never merged with the raw signals.
        // nofollow never implies noindex: indexing and crawling stay separate.
        interpretation: {
          derived: true,
          indexing: {
            willNotBeIndexed: indexingCauses.length > 0,
            because: indexingCauses,
          },
          crawling: {
            restricted: crawlingCauses.length > 0,
            because: crawlingCauses,
          },
        },
      }),
    );
  }

  /* 11 — technical.favicon.missing
     Fires only when: no icon link in HTML AND /favicon.ico returned 404/410.
     Probe network error → unavailable (never a finding, never a pass). */
  const faviconProbe = probes.favicon;
  if (!signals.iconLinksPresent) {
    if (!faviconProbe.checked) {
      unavailableChecks.push({
        type: 'technical.favicon.missing',
        reason: `favicon probe could not be checked: ${faviconProbe.reason}`,
      });
    } else if (faviconProbe.status === 404 || faviconProbe.status === 410) {
      findings.push(
        make('technical.favicon.missing', 'No favicon: no icon link and /favicon.ico returns 404.', {
          htmlIconLink: false,
          rootProbe: { path: '/favicon.ico', status: faviconProbe.status },
        }),
      );
    }
    // Any other completed status (200, 403, 405, 500...) = the server has the
    // resource; we do not claim "missing" we cannot prove (honesty rule).
  }

  /* 16 — http.error_status (factual status-code finding; probe responses and
     favicon/robots probes are EXCLUDED — this reads only the scanned page's
     own final HTTP status). */
  if (page.status >= 400) {
    findings.push(
      make('http.error_status', `The server responded with HTTP ${page.status} for this page.`, {
        requestedUrl,
        finalUrl: page.finalUrl,
        status: page.status,
        rule: 'final HTTP status >= 400 on the scanned page itself (probes excluded)',
      }),
    );
  }

  return {
    findings,
    unavailableChecks,
    partial: unavailableChecks.length > 0,
  };
}

/**
 * Content-type-aware page check — the ONE entry point for checking a fetched
 * page (seed or crawled). Content-Type from the response is authoritative:
 *
 *  - HTML response  → parse + the full 16-check catalog (runChecks) and its
 *                     anchors feed link discovery;
 *  - anything else  → NO HTML checks, NO link discovery. Only the factual
 *                     HTTP status may be recorded: a >= 400 response still
 *                     produces http.error_status (the server's own answer is
 *                     a fact), and an honest unavailableChecks entry records
 *                     WHY the HTML checks did not run. Zero findings otherwise.
 *
 * Returns { findings, unavailableChecks, partial, signals, contentType,
 *           state: 'scanned' | 'non_html' } — `signals.anchors` is empty for
 * non-HTML content so callers can never discover links from a PDF/image/CSS/JS
 * payload.
 */
export function runPageChecks({ requestedUrl, page, probes, factory }) {
  const contentType = responseContentType(page);

  if (isHtmlResponse(page)) {
    const signals = parseHtml(page.body);
    const run = runChecks({ requestedUrl, page, signals, probes, factory });
    return { ...run, signals, contentType, state: 'scanned' };
  }

  // Non-HTML response: the HTTP status is still a fact worth recording, but
  // every HTML-specific check is inapplicable — never fabricated, never a pass.
  const findings = [];
  if (page.status >= 400) {
    findings.push(
      factory('http.error_status', `The server responded with HTTP ${page.status} for this page.`, {
        requestedUrl,
        finalUrl: page.finalUrl,
        status: page.status,
        rule: 'final HTTP status >= 400 on the scanned page itself (probes excluded)',
      }, page.finalUrl),
    );
  }
  return {
    findings,
    unavailableChecks: [{
      type: 'html.checks',
      reason: `${requestedUrl} responded ${contentType || 'without a Content-Type'} — not HTML, so SEO/accessibility checks were not run.`,
    }],
    partial: true,
    signals: { anchors: [] }, // non-HTML content is never a link source
    contentType,
    state: 'non_html',
  };
}
