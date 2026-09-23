// Single source of truth for check thresholds and fixed lists.
// Spec ref: spec.md > Scanner > checks (exact thresholds table).

export const TITLE_MAX_LENGTH = 60;      // seo.title.too_long: trimmed length > 60
export const TTFB_THRESHOLD_MS = 3000;   // perf.slow_response: headers received > 3.0s
export const REQUEST_TIMEOUT_MS = 10000; // spec: 10s fetch timeout (page and probes)

// accessibility.link_text.generic: fixed list — no fuzzy guessing.
export const GENERIC_LINK_PHRASES = [
  'click here',
  'read more',
  'learn more',
  'more',
  'here',
  'this',
  'this link',
  'link',
  'read this',
  'details',
];
