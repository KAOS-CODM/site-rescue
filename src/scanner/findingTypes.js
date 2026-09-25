// Stable finding type IDs — the complete and only scanner vocabulary.
// 16 conditions, 16 stable types (spec.md > Scanner > checks table).
// The AI layer may only ever reference IDs from this list.

export const FINDING_TYPES = Object.freeze([
  'seo.title.missing',
  'seo.title.too_long',
  'seo.meta_description.missing',
  'seo.viewport.missing',
  'accessibility.img_alt.missing',
  'seo.h1.missing',
  'seo.h1.multiple',
  'seo.heading_levels.skipped',
  'accessibility.lang.missing',
  'seo.canonical.missing',
  'technical.favicon.missing',
  'accessibility.link_text.generic',
  'technical.https.missing',
  'perf.slow_response',
  'seo.robots.signals',
  'http.error_status',
]);

/**
 * Finding factory (spec.md > Finding model).
 * One finding per fired condition per scan; instance ids are per-scan
 * (f_1, f_2, ...) while `type` stays stable across scans. One factory per
 * scan keeps ids unique across crawled pages. Every finding carries
 * `pageUrl` — the URL whose fetched content produced the evidence
 * (page-level attribution, Final Review revision).
 */
export function createFindingFactory() {
  let count = 0;
  return function makeFinding(type, note, evidence, pageUrl) {
    if (!FINDING_TYPES.includes(type)) {
      throw new Error(`Unknown finding type: ${type}`);
    }
    count += 1;
    return { id: `f_${count}`, type, note, evidence, pageUrl: pageUrl ?? null };
  };
}
