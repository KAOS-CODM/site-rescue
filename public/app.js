// Site Rescue — three-state journey machine: start → scanning → results.
// (spec > Frontend; prd.md > Screens and Layout)
//
// - State lives in memory only: refresh resets to the start screen.
// - Phases reflect REAL request phases: step 1 active while /api/scan is in
//   flight; steps 2+3 active while /api/plan is in flight. No percentages,
//   no invented progress — the honesty rule (prd.md > Look and Feel).
// - Scanner findings and the AI plan are kept distinct: findings[] is the
//   source of truth, plan.results joins by findingId and only ever adds
//   prioritization/explanation/tasks. On AI failure the findings are shown
//   as-is and Retry re-calls /api/plan only — the site is never re-scanned.
// - All page/AI text is inserted via textContent (untrusted data — never HTML).
// - Evidence rendering is presentation-only: concise human-readable lines are
//   derived from the scanner's structured evidence fields (never invented);
//   the full scanner JSON always stays one expansion deeper.

const form = document.getElementById('scan-form');
const input = document.getElementById('url-input');
const errorEl = document.getElementById('url-error');
const submitBtn = form.querySelector('button[type="submit"]');

const screens = {
  start: document.getElementById('screen-start'),
  scanning: document.getElementById('screen-scanning'),
  results: document.getElementById('screen-results'),
};

const steps = [
  document.querySelector('[data-step="1"]'),
  document.querySelector('[data-step="2"]'),
  document.querySelector('[data-step="3"]'),
];
const STEP_STATE_TEXT = { pending: 'waiting', active: 'in progress', done: 'done' };

// Result-screen hooks.
const scanningUrl = document.getElementById('scanning-url');
const resultsUrl = document.getElementById('results-url');
const resultsRedirect = document.getElementById('results-redirect');
const scanFacts = document.getElementById('scan-facts');
const partialWarning = document.getElementById('partial-warning');
const partialList = document.getElementById('partial-list');
const aiFailure = document.getElementById('ai-failure');
const retryBtn = document.getElementById('retry-plan');
const startOverBtn = document.getElementById('start-over');
const retryStatus = document.getElementById('retry-status');
const planSummaryBlock = document.getElementById('plan-summary-block');
const planSummary = document.getElementById('plan-summary');
const findingsRaw = document.getElementById('findings-raw');
const findingsRawList = document.getElementById('findings-raw-list');
const planSections = document.getElementById('plan-sections');

const PRIORITIES = [
  { key: 'fix_now', chip: 'chip-fix_now', label: 'Fix now' },
  { key: 'fix_next', chip: 'chip-fix_next', label: 'Fix next' },
  { key: 'improve_later', chip: 'chip-improve_later', label: 'Improve later' },
];

// Journey state (in-memory only — nothing survives a refresh).
let scan = null; // last /api/scan response
let plan = null; // last validated /api/plan response (null = AI step failed)
let journeyActive = false; // guards duplicate submissions while a scan runs
let retryActive = false; // guards duplicate plan retries

/* ---------------- start screen: client-side validation ---------------- */

const MESSAGES = {
  empty: 'Enter a public website URL to scan.',
  unparseable: "That doesn't look like a URL. Try something like https://example.com",
  scheme: 'Only http:// or https:// URLs can be scanned.',
  notPublic: 'Enter a valid public website URL (like example.com).',
};

/**
 * Returns an error message for invalid input, or null when the value is
 * acceptable to submit. Deliberately lightweight: the server re-validates
 * everything (including non-public destinations) as defense in depth.
 */
function validateUrl(value) {
  const trimmed = value.trim();
  if (!trimmed) return MESSAGES.empty;

  // Normalize: allow bare domains like "example.com".
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return MESSAGES.unparseable;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return MESSAGES.scheme;
  }

  // A public website URL has a dotted hostname (rejects "abc", "localhost", etc.).
  const host = parsed.hostname;
  if (!host.includes('.') || host.endsWith('.')) return MESSAGES.notPublic;

  return null;
}

function showError(message) {
  errorEl.textContent = message;
  errorEl.classList.remove('hidden');
  input.classList.add('input-error');
  input.setAttribute('aria-invalid', 'true');
}

function clearError() {
  errorEl.classList.add('hidden');
  errorEl.textContent = '';
  input.classList.remove('input-error');
  input.removeAttribute('aria-invalid');
}

/* ---------------- screen + phase helpers ---------------- */

function showScreen(name) {
  for (const [key, node] of Object.entries(screens)) {
    node.classList.toggle('hidden', key !== name);
  }
}

function setSteps(states) {
  states.forEach((state, i) => {
    steps[i].dataset.state = state;
    steps[i].querySelector('.step-state').textContent = STEP_STATE_TEXT[state];
  });
}

function resetJourney() {
  scan = null;
  plan = null;
  journeyActive = false;
  retryActive = false;
  submitBtn.disabled = false;
  retryBtn.disabled = false;
  retryStatus.textContent = '';
  setSteps(['pending', 'pending', 'pending']);
}

/* ---------------- API ---------------- */

class RequestError extends Error {
  constructor(status, code) {
    super(code || `http_${status}`);
    this.status = status;
    this.code = code || `http_${status}`;
  }
}

async function postJson(pathname, body) {
  let res;
  try {
    res = await fetch(pathname, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new RequestError(0, 'network_error');
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    // non-JSON body — handled below via status
  }
  if (!res.ok) throw new RequestError(res.status, data?.error);
  return data;
}

// Fixed client copy per error code — server/provider internals and API keys
// are never shown to the user (prd.md > States and Boundaries).
function scanErrorMessage(err) {
  if (err?.code === 'invalid_url') return MESSAGES.notPublic;
  if (err?.code === 'unreachable') {
    return 'Site Rescue could not access that website. Check the URL, or try another site.';
  }
  return 'The scan could not be completed. Try again.';
}

/* ---------------- the journey ---------------- */

form.addEventListener('submit', async (event) => {
  // Always prevent the default navigation — nothing reloads.
  event.preventDefault();

  // Duplicate-submission guard: one journey at a time.
  if (journeyActive) return;

  const message = validateUrl(input.value);
  if (message) {
    showError(message);
    return; // Stay on the start screen; no request of any kind is made.
  }
  clearError();

  journeyActive = true;
  submitBtn.disabled = true;
  scan = null;
  plan = null;

  const rawUrl = input.value.trim();
  scanningUrl.textContent = rawUrl;
  showScreen('scanning');
  setSteps(['active', 'pending', 'pending']); // phase 1 = /api/scan in flight

  let scanRes;
  try {
    scanRes = await postJson('/api/scan', { url: rawUrl });
  } catch (err) {
    // Scan failed: return to the input with one clear next action.
    journeyActive = false;
    submitBtn.disabled = false;
    showScreen('start');
    setSteps(['pending', 'pending', 'pending']);
    showError(scanErrorMessage(err));
    input.focus();
    return;
  }

  scan = scanRes;
  // Plan phase: steps "Analyzing findings → Building rescue plan" are the
  // real phases while /api/plan is in flight (spec > Core Journey step 4-5).
  setSteps(['done', 'active', 'active']);
  await requestPlan();

  journeyActive = false;
  submitBtn.disabled = false;
});

// Request the plan from the stored findings. Used by the initial journey AND
// by Retry — it never calls /api/scan, so a retry never re-scans the website.
// The server returns the deterministic empty plan when findings are empty
// (no AI request is made server-side in that case).
async function requestPlan() {
  try {
    plan = await postJson('/api/plan', { findings: scan.findings });
    setSteps(['done', 'done', 'done']);
  } catch {
    plan = null; // AI step failed: never fabricate a plan; findings stay intact
  }
  renderResults();
}

retryBtn.addEventListener('click', async () => {
  if (retryActive || !scan) return;
  retryActive = true;
  retryBtn.disabled = true;
  retryStatus.textContent = 'Retrying the rescue-plan step — the website will not be re-scanned.';
  await requestPlan();
  retryActive = false;
  retryBtn.disabled = false;
});

startOverBtn.addEventListener('click', () => {
  resetJourney();
  showScreen('start');
  clearError();
  input.focus();
});

/* ---------------- rendering ---------------- */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function evidencePre(data) {
  let json;
  try {
    json = JSON.stringify(data, null, 2);
  } catch {
    json = String(data);
  }
  if (json === undefined) json = String(data);
  return el('pre', 'evidence-pre', json);
}

/* ---------------- evidence presentation layer ----------------
   Converts KNOWN structured scanner evidence into concise human-readable
   lines (slice 5). Hard rules (honesty + scanner-as-source-of-truth):
   - only echoes fields the scanner actually recorded — never invents URLs,
     selectors, counts, or evidence;
   - a null/absent/empty field is labeled as such, not papered over;
   - unknown evidence shapes fall back to the raw JSON block, so technical
     evidence is never hidden — the full scanner JSON always stays one
     expansion deeper even when human-readable lines are shown. */

function presenceLine(label, value) {
  if (value === null || value === undefined) return { label, value: 'not found', absent: true };
  const text = String(value);
  if (text.trim() === '') return { label, value: 'empty', absent: true };
  return { label, value: text };
}

const EVIDENCE_VIEWS = {
  'seo.title.missing': (e) => [presenceLine('Title element', e.title)],

  'seo.title.too_long': (e) => {
    const lines = [presenceLine('Title', e.title)];
    if (typeof e.length === 'number' && typeof e.threshold === 'number') {
      lines.push({ label: 'Length', value: `${e.length} characters (limit ${e.threshold})` });
    }
    return lines;
  },

  'seo.meta_description.missing': (e) => [presenceLine('Meta description element', e.metaDescription)],

  'seo.viewport.missing': (e) => [presenceLine('Viewport meta element', e.viewportMeta)],

  'accessibility.img_alt.missing': (e) => {
    const lines = [];
    if (typeof e.missingCount === 'number') {
      lines.push({ label: 'Images without alt', value: String(e.missingCount) });
    }
    const examples = Array.isArray(e.examples) ? e.examples : [];
    examples.forEach((img, i) => {
      const src = img && img.src !== null && img.src !== undefined && img.src !== ''
        ? `src="${img.src}"`
        : '(no src attribute)';
      lines.push({ label: `Example ${i + 1}`, value: src });
    });
    if (typeof e.decorativeExcluded === 'number') {
      lines.push({ label: 'Decorative excluded', value: `${e.decorativeExcluded} image(s) with alt=""` });
    }
    return lines;
  },

  'seo.h1.missing': (e) => {
    const lines = [];
    if (typeof e.h1Count === 'number') lines.push({ label: 'H1 elements', value: String(e.h1Count) });
    if (typeof e.headingCount === 'number') lines.push({ label: 'Total headings', value: String(e.headingCount) });
    return lines;
  },

  'seo.h1.multiple': (e) => {
    const lines = [];
    if (typeof e.h1Count === 'number') lines.push({ label: 'H1 elements', value: String(e.h1Count) });
    (Array.isArray(e.h1Texts) ? e.h1Texts : []).forEach((text, i) => {
      lines.push({ label: `H1 #${i + 1}`, value: String(text) });
    });
    return lines;
  },

  'seo.heading_levels.skipped': (e) => (Array.isArray(e.skips) ? e.skips : [])
    .filter((skip) => skip && typeof skip === 'object')
    .map((skip, i) => ({
      label: `Skip ${i + 1}`,
      value: skip.text ? `${skip.from} → ${skip.to}: "${skip.text}"` : `${skip.from} → ${skip.to}`,
    })),

  'accessibility.lang.missing': (e) => [presenceLine('HTML lang attribute', e.langAttribute)],

  'seo.canonical.missing': (e) => [presenceLine('Canonical link', e.canonical)],

  'technical.favicon.missing': (e) => {
    const lines = [];
    if (e.htmlIconLink === false) lines.push({ label: 'Icon link in HTML', value: 'not found', absent: true });
    if (e.rootProbe && e.rootProbe.path !== undefined && e.rootProbe.path !== null) {
      lines.push({ label: 'Root probe', value: `${e.rootProbe.path} → HTTP ${e.rootProbe.status}` });
    }
    return lines;
  },

  'accessibility.link_text.generic': (e) => {
    const lines = [];
    if (typeof e.matchedCount === 'number') {
      lines.push({ label: 'Links with generic text', value: String(e.matchedCount) });
    }
    const examples = Array.isArray(e.examples) ? e.examples : [];
    examples.forEach((anchor, i) => {
      const text = anchor && anchor.text;
      const shown = (text === null || text === undefined || text === '')
        ? '(empty text)'
        : `"${text}"`;
      lines.push({
        label: `Link ${i + 1}`,
        value: anchor && anchor.href ? `${shown} → ${anchor.href}` : shown,
      });
    });
    return lines;
  },

  'technical.https.missing': (e) => [
    presenceLine('Requested URL', e.requestedUrl),
    presenceLine('Final URL', e.finalUrl),
  ],

  'perf.slow_response': (e) => {
    const lines = [];
    if (typeof e.ttfbMs === 'number') {
      lines.push({
        label: 'Time to first byte',
        value: typeof e.thresholdMs === 'number'
          ? `${e.ttfbMs} ms (limit ${e.thresholdMs} ms)`
          : `${e.ttfbMs} ms`,
      });
    }
    return lines;
  },

  'seo.robots.signals': (e) => {
    const lines = [];
    const rawSignal = (label, signal) => {
      if (!signal || typeof signal !== 'object') return;
      if (signal.present !== true) {
        lines.push({ label, value: 'not present', absent: true });
        return;
      }
      const raw = signal.raw;
      if (raw === null || raw === undefined || String(raw).trim() === '') {
        lines.push({ label, value: 'present — empty value', absent: true });
        return;
      }
      lines.push({ label, value: String(raw) });
    };
    rawSignal('Meta robots', e.metaRobots);
    rawSignal('X-Robots-Tag', e.xRobotsTag);

    const robots = e.robotsTxt;
    if (robots && typeof robots === 'object') {
      if (robots.checked !== true) {
        lines.push({
          label: 'robots.txt',
          value: robots.reason ? `not checked — ${robots.reason}` : 'not checked',
          absent: true,
        });
      } else if (robots.exists !== true) {
        lines.push({ label: 'robots.txt', value: 'not found', absent: true });
      } else if (robots.matchedRule) {
        lines.push({ label: 'robots.txt rule', value: String(robots.matchedRule) });
      } else if (robots.applicable === false) {
        lines.push({ label: 'robots.txt', value: 'checked — no rules apply to this path' });
      } else {
        lines.push({ label: 'robots.txt', value: 'checked — no rule matched this path' });
      }
    }

    // Scanner's derived conclusion — clearly labeled as derived; the raw
    // signals above stay separate (spec > robots evidence model).
    const interp = e.interpretation;
    if (interp && interp.derived === true) {
      const indexing = interp.indexing && Array.isArray(interp.indexing.because) ? interp.indexing.because : [];
      const crawling = interp.crawling && Array.isArray(interp.crawling.because) ? interp.crawling.because : [];
      for (const cause of indexing) lines.push({ label: 'Indexing (derived)', value: String(cause) });
      for (const cause of crawling) lines.push({ label: 'Crawling (derived)', value: String(cause) });
    }
    return lines;
  },
};

/** Concise human-readable lines for a finding, or null when the evidence
 *  shape is unknown — in which case the caller shows the raw JSON only. */
function evidenceLines(finding) {
  const evidence = finding && finding.evidence;
  if (!evidence || typeof evidence !== 'object') return null;
  const build = EVIDENCE_VIEWS[finding.type];
  if (!build) return null;
  let lines;
  try {
    lines = build(evidence);
  } catch {
    return null;
  }
  if (!Array.isArray(lines)) return null;
  const usable = lines.filter(
    (line) => line && typeof line.label === 'string' && typeof line.value === 'string',
  );
  return usable.length > 0 ? usable : null;
}

// Evidence block: human-readable lines first (presentation over the scanner's
// own fields), full scanner JSON in a collapsed <details> underneath — the
// technical tier is never hidden, never replaced, never AI-generated.
function evidenceBlock(finding, labelPrefix) {
  const block = el('div', 'card-block');
  block.append(el('p', 'micro-label', `${labelPrefix} (${finding.type})`));

  const lines = evidenceLines(finding);
  if (lines) {
    const human = el('div', 'evidence-human');
    for (const line of lines) {
      const row = el('div', 'evidence-line');
      row.append(el('span', 'evidence-key', line.label));
      row.append(
        el('span', line.absent ? 'evidence-val evidence-val-absent' : 'evidence-val', line.value),
      );
      human.append(row);
    }
    block.append(human);

    const raw = el('details', 'evidence-raw');
    raw.append(el('summary', 'evidence-raw-summary', 'Technical evidence (JSON)'));
    raw.append(evidencePre(finding.evidence));
    block.append(raw);
  } else {
    // Unknown/absent shape: fall back to the raw JSON, shown directly.
    block.append(evidencePre(finding.evidence));
  }
  return block;
}

function renderResults() {
  showScreen('results');
  retryStatus.textContent = '';

  // Scanned URL; show the requested URL too when redirects changed it.
  resultsUrl.textContent = scan.finalUrl || scan.url;
  if (scan.finalUrl && scan.finalUrl !== scan.url) {
    resultsRedirect.textContent = `requested ${scan.url}`;
    resultsRedirect.classList.remove('hidden');
  } else {
    resultsRedirect.classList.add('hidden');
  }

  // Scanner facts — the finding count is the SCANNER's unique finding count.
  scanFacts.replaceChildren(
    el('span', null, `${scan.findings.length} findings`),
    el('span', null, `HTTP ${scan.status}`),
    el('span', null, `${scan.ttfbMs} ms TTFB`),
  );

  // Partial-scan warning (unavailableChecks / partial — honest labeling).
  const unavailable = Array.isArray(scan.unavailableChecks) ? scan.unavailableChecks : [];
  if (scan.partial === true || unavailable.length > 0) {
    partialList.replaceChildren(
      ...unavailable.map((u) => el('li', null, `${u.type} — ${u.reason}`)),
    );
    partialWarning.classList.remove('hidden');
  } else {
    partialWarning.classList.add('hidden');
    partialList.replaceChildren();
  }

  if (plan) {
    // Validated plan exists: priority sections + AI summary.
    aiFailure.classList.add('hidden');
    findingsRaw.classList.add('hidden');
    planSummaryBlock.classList.remove('hidden');
    planSummary.textContent = plan.summary;
    renderPlanSections();
    planSections.classList.remove('hidden');
  } else {
    // AI failed: keep scan results visible, show the failure state, and do
    // NOT show priority sections (no plan = no priorities — never faked).
    planSummaryBlock.classList.add('hidden');
    planSections.classList.add('hidden');
    aiFailure.classList.remove('hidden');
    findingsRaw.classList.remove('hidden');
    renderRawFindings();
  }
}

function renderPlanSections() {
  const byPriority = { fix_now: [], fix_next: [], improve_later: [] };
  for (const result of plan.results) {
    if (byPriority[result.priority]) byPriority[result.priority].push(result);
  }
  const findingById = new Map(scan.findings.map((f) => [f.id, f]));

  for (const priority of PRIORITIES) {
    const list = document.getElementById(`list-${priority.key}`);
    const count = document.getElementById(`count-${priority.key}`);
    const empty = document.getElementById(`empty-${priority.key}`);
    const entries = byPriority[priority.key];
    count.textContent = String(entries.length);
    empty.classList.toggle('hidden', entries.length > 0);
    list.replaceChildren(
      ...entries.map((result) => planCard(result, findingById.get(result.findingId), priority)),
    );
  }
}

function field(label, text) {
  const wrap = el('div', 'field');
  wrap.append(el('p', 'field-label', label));
  wrap.append(el('p', 'field-text', text));
  return wrap;
}

// Finding card: compact summary row, details expand on demand (no wall of text).
// Blocks are labeled SCANNER vs AI so the decision layer is visibly separate
// from the evidence (prd.md > AI rescue-plan layer).
function planCard(result, finding, priority) {
  const card = el('details', 'finding-card');

  const summary = el('summary', 'card-summary');
  summary.append(el('span', `chip ${priority.chip}`, priority.label));
  summary.append(el('span', 'card-title', result.problemTitle));
  summary.append(el('span', 'card-type', finding ? finding.type : result.findingId));
  card.append(summary);

  const body = el('div', 'card-body');

  // Scanner: what was observed.
  const observed = el('div', 'card-block');
  observed.append(el('p', 'micro-label', 'Scanner · what was observed'));
  observed.append(el('p', 'card-note', finding ? finding.note : 'Finding unavailable.'));
  body.append(observed);

  // AI: decision-layer fields.
  const aiBlock = el('div', 'card-block');
  aiBlock.append(el('p', 'micro-label micro-label-accent', 'AI · rescue plan'));
  aiBlock.append(field('Explanation', result.explanation));
  aiBlock.append(field('Why it matters', result.whyItMatters));
  aiBlock.append(field('Developer task', result.developerTask));
  if (Array.isArray(result.acceptanceCriteria) && result.acceptanceCriteria.length > 0) {
    const wrap = el('div', 'field');
    wrap.append(el('p', 'field-label', 'Acceptance criteria'));
    const list = el('ul', 'criteria-list');
    for (const criterion of result.acceptanceCriteria) list.append(el('li', null, criterion));
    wrap.append(list);
    aiBlock.append(wrap);
  }
  body.append(aiBlock);

  // Scanner: evidence for traceability — human-readable lines first
  // (presentation over the scanner's own fields), full JSON one expansion
  // deeper (never hidden, never replaced).
  if (finding) {
    body.append(evidenceBlock(finding, 'Scanner · evidence'));
  }

  card.append(body);
  return card;
}

// Scanner-only cards shown when the AI step failed: evidence stays visible,
// no priorities/titles/tasks are invented.
function renderRawFindings() {
  if (scan.findings.length === 0) {
    findingsRawList.replaceChildren(
      el('p', 'empty-note', 'The scanner found no issues on this page.'),
    );
    return;
  }
  findingsRawList.replaceChildren(...scan.findings.map(rawCard));
}

function rawCard(finding) {
  const card = el('details', 'finding-card');

  const summary = el('summary', 'card-summary');
  summary.append(el('span', 'chip chip-neutral', 'scanner'));
  summary.append(el('span', 'card-title', finding.note));
  summary.append(el('span', 'card-type', finding.type));
  card.append(summary);

  const body = el('div', 'card-body');
  body.append(evidenceBlock(finding, 'Evidence'));
  card.append(body);
  return card;
}

// Clear the inline error as soon as the user starts fixing the input.
input.addEventListener('input', () => {
  if (input.hasAttribute('aria-invalid')) clearError();
});
