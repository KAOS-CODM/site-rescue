---
doc: spec
status: approved
---
<!-- `status`: `draft` until the learner approves; "looks good" counts as approval. -->

# Site Rescue — Technical Spec

## How This Works, In Plain Language

Site Rescue is **two small programs in one**: a **scanner** that looks at a real website, and an **AI planning layer** that reads what the scanner found.

1. You type a URL into a web page running on your laptop. That page asks the **Express server** (the backend program) to scan it.
2. The **scanner** downloads the page's HTML and its response headers — like saving a webpage to a file and reading it — measures how long the response took, and also probes two small extras: `robots.txt` and `/favicon.ico`.
3. The scanner runs **15 fixed checks** (missing title, missing alt text, slow response, and so on) against exactly what it downloaded. Each check that fires produces a **finding**: a stable type ID (like `seo.title.missing`) plus **structured evidence** — the actual HTML snippet or header value that proves it. The scanner is the source of truth; it only reports what it saw.
4. Those findings — **and only those findings** — are sent to the **AI layer** through a small adapter module. The AI gets no tools, no ability to browse, and doesn't even get sent off to look at the site. Its whole job: explain each finding in plain English, say why it matters, pick a priority (Fix now / Fix next / Improve later), and write the developer task.
5. The server checks the AI's answer against the rules before showing it: valid shape, and **every finding ID in the answer must be one we actually sent** — if the AI invents a finding or garbles the output, we throw it away and show the "AI step failed, retry" state instead.
6. The web page shows the **rescue plan**: summary on top, three priority columns, expandable finding cards.

Why this shape instead of something bigger: no database (results live in the page until you refresh), no queues or background workers (everything happens in two short requests you can watch), no headless browser (plain HTML + headers prove every check). Each of those would add setup and failure modes without proving the kernel — and the kernel *is* the pipeline: **real evidence → AI decisions → developer tasks**, with the AI fenced off from inventing anything.

## The Core Journey Through the System

PRD ref: `prd.md > The Core Journey`.

1. **User opens the start screen** → Express serves `public/index.html` (static files; no API call yet). They see header, headline, explanation, URL input, Scan button, Scan → Prioritize → Fix hint.
2. **User clicks Scan website** → frontend validates non-empty, shows the scanning state, and calls **`POST /api/scan`** with the URL.
3. **Server scans** → validates the URL (scheme + pre-resolve IP check, **SSRF rules below** — non-public destinations rejected before any request) → fetches it (timeout + measured time-to-first-byte, every redirect hop re-validated) → reads response headers → parses HTML with cheerio → probes `robots.txt` and `/favicon.ico` → runs the 15 checks → returns `{ findings[] }`. *(Invalid URL / unreachable site / internal error → error responses mapped to the PRD's error states.)*
4. **Frontend shows "Scanning website" complete, moves to "Analyzing findings → Building rescue plan"** → calls **`POST /api/plan`** with the findings it just received.
5. **Server calls the AI adapter** → adapter sends findings + evidence + JSON Schema to Gemini Flash (config via `AI_BASE_URL`/`AI_API_KEY`/`AI_MODEL`, defaults set for Gemini) → response is parsed and validated (shape + finding-ID cross-check) → returns the plan. *(AI failure / invalid output → `{ error: 'ai_failed' }`; the frontend keeps the findings, shows the PRD's AI-failure state with a Retry button that re-calls only `/api/plan` — the scan is never repeated.)*
6. **Frontend renders the rescue plan** → URL + summary (count = unique scanner findings), three priority sections, expandable cards: title, priority, evidence (from scanner), explanation, why it matters, developer task (+ acceptance criteria when the AI gives them). Empty sections say so. Results are held in the page's memory only.

```
Browser (public/)                Express (server.js)              Outside world
┌──────────────┐  POST /api/scan   ┌─────────────┐   fetch      ┌──────────────┐
│ start screen │ ────────────────→ │  scanner/   │ ───────────→ │ target site  │
│ scanning     │ ←──────────────── │  fetchPage  │ ←─────────── │ HTML+headers │
│ state        │   findings[]      │  parseHtml  │  robots.txt  │ /favicon.ico │
│ results      │                   │  checks     │              └──────────────┘
│              │  POST /api/plan   ├─────────────┤   HTTPS+JSON  ┌──────────────┐
│ (in-memory)  │ ────────────────→ │  ai/        │ ────────────→ │ Gemini Flash │
│              │ ←──────────────── │  adapter    │ ←──────────── │ (no tools)   │
└──────────────┘   plan (validated)└─────────────┘               └──────────────┘
```

## Stack

| Choice | Why | Docs |
|---|---|---|
| **Node.js 20+ (LTS recommended)** | Your familiar ground; has `fetch` built in — no extra HTTP library. *(Node 18+ works; verify installed version early.)* | https://nodejs.org/docs/latest/api/ |
| **Express** (backend) | Your pick; serves the static frontend and the two API routes. | https://expressjs.com/ |
| **Vanilla HTML/CSS/JS** (frontend) | Your pick, agreed here: one page, three states — React would add build tooling and debugging surface for no PoC benefit. | https://developer.mozilla.org/en-US/docs/Web |
| **Tailwind CSS** | Your pick for the control-room styling. *Delivery method (browser build vs. CLI-compiled CSS) unverified — decide at build time; both fine for a no-framework page.* ⚠️ verify | https://tailwindcss.com/ |
| **cheerio** (derived from your "HTML parsing" decision) | The standard way to search parsed HTML in Node (`$('title')` etc.). No built-in HTML parser exists in Node, so a library is required. | https://cheerio.js.org/ |
| **Gemini Flash via plain HTTPS** — **`AI_MODEL=gemini-3.8-flash`**, set explicitly: the stable GA model ID in Google's current official docs, with structured-output support (confirmed by the learner; implementation-level API field verification remains a build task) | Your accepted recommendation after verification; free tier, JSON-Schema structured output, no card needed from Nigeria. | https://ai.google.dev/gemini-api/docs |
| **Git/GitHub** | Your pick for version control. | https://git-scm.com/doc |

Provider coupling is deliberately broken at one point: the AI is reached **only** through `src/ai/adapter.js`, configured by `.env`:

```
AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta
AI_API_KEY=            # you fill this in locally — never commit, never paste in chat
AI_MODEL=gemini-3.8-flash   # stable GA model ID per Google's current official docs (structured-output support)
```
`.env` is already git-ignored; `.env.example` ships with placeholders.

## Where It Runs and How Someone Tries It

- **Runtime:** one local Node process. No hosting, no deployment (per `prd.md > Deferred From the POC`).
- **Needs:** Node 20+, network access (to scan real sites and call the AI), one Gemini API key in `.env`.
- **Start it:** `npm install` → copy `.env.example` to `.env` and add the key → `npm start` → open **http://localhost:3000**.
- **Demo recording:** the required short demo video shows that exact flow on a real public URL. The required public GitHub repo must let another person reproduce it from README setup steps — README will document the start commands and the free Gemini key signup link (no key in the repo).
- Deployment: none chosen; `6-ship` may revisit as optional extras. It never replaces the video or repo.

## Look and Feel

Carried from `prd.md > Look and Feel` (settled — not re-interviewed), in build-actionable terms:

- **Palette:** near-black/deep-charcoal background, off-white text, **one accent color — my proposal for your sign-off at review: amber/orange** (industrial control-room warmth; decisive without alarm). Priority sections differ by *structure, not rainbow*: Fix now gets the accent border/label emphasis, Fix next a quieter version, Improve later muted neutral. Never a wall of red.
- **Typography:** clean modern sans for text; **monospace for metadata and evidence blocks** (type IDs, header values, snippets) — reads as a developer tool, not a chatbot.
- **Density:** structured panels, compact labels, expandable cards — information-dense but hierarchical. No hero sections, no glassmorphism, no purple gradients, no heavy rounding, no neon.
- **Copy tone:** calm diagnosis → decisive action. The scanning state shows the real step sequence (tied to actual request phases), never fake percentages.
- **Stack caveat:** Tailwind can honor all of this; the specific delivery method is the one open styling detail (see Stack).

## Components

### Express server
`src/server.js` — serves `public/` statically and mounts the two routes below. No other responsibilities.
PRD ref: `prd.md > Screens and Layout` (states are driven by these routes).

### `POST /api/scan`
Contract: body `{ url: string }` → `200 { url, status, ttfbMs, findings: Finding[], unavailableChecks?: [{type, reason}], partial?: true }` or `4xx/5xx { error: 'invalid_url' | 'unreachable' | 'scan_failed', message }`.
Validates/normalizes the input URL first (invalid → `invalid_url`, nothing fetched). Fetch timeout 10s. Also probes `robots.txt` and `/favicon.ico`.

**SSRF protection (required — learner's explicit correction):** all of the following are checked **before any request is attempted**, and any rejection returns `invalid_url` **without attempting the request**:
- Accept only `http:` / `https:` schemes.
- Reject non-public destinations: localhost, loopback (`127.0.0.0/8`, `::1`), private RFC1918 (`10/8`, `172.16/12`, `192.168/16`), IPv6 ULA/link-local (`fc00::/7`, `fe80::/10`), link-local `169.254/16`, multicast/reserved/bogon ranges, and any other non-public destination.
- **Resolve the hostname before connecting** (DNS lookup) and reject if **any** resolved IP is non-public; the connection must go to the validated address.
- **Validate every redirect destination with the same rules** — redirects are followed manually, each hop re-checked (scheme + resolved IP) — so a public URL cannot redirect into an internal/private destination.

PRD ref: `prd.md > Starting a scan`, `States and Boundaries` (invalid / unreachable / internal error).

### Scanner: fetchPage → parseHtml → checks
- **fetchPage** — fetches the URL, records **time-to-first-byte** (threshold: > 3.0 s → slow-response finding), keeps status code + response headers, follows redirects **manually with each hop validated under the SSRF rules above**, and records the **final URL after redirects**. Network failure → `unreachable`. HTTPS detection uses that final URL: final `https://` = no finding; final `http://` = finding; `http://` → `https://` upgrade redirect = no finding.
- **parseHtml** — cheerio parse; extracts the raw signals the checks need (titles, meta tags, headings, imgs, anchors, `<html lang>`, canonical, favicon links, meta robots).
- **checks** — the **15-condition catalog** (15 conditions, each with its own separate stable type ID — `seo.h1.missing` and `seo.h1.multiple` are distinct types), each with the exact thresholds agreed in this spec:

| type ID | Fires when | Threshold (exact) |
|---|---|---|
| `seo.title.missing` | no/empty `<title>` | trimmed empty |
| `seo.title.too_long` | title too long | **> 60 chars** trimmed |
| `seo.meta_description.missing` | no/empty meta description | trimmed empty |
| `seo.viewport.missing` | no viewport meta | element absent |
| `accessibility.img_alt.missing` | `<img>` with no `alt` attribute | **`alt=""` is decorative → never fires**; whitespace-only `alt` counts as missing |
| `seo.h1.missing` | zero `<h1>` elements | exact count = 0 |
| `seo.h1.multiple` | more than one `<h1>` | exact count > 1 |
| `seo.heading_levels.skipped` | heading jumps a level | e.g. h2→h4 with no h3 |
| `accessibility.lang.missing` | `<html>` lacks `lang` | attribute absent |
| `seo.canonical.missing` | no canonical link | presence only |
| `technical.favicon.missing` | no favicon link **and** `/favicon.ico` not found | 404 = missing (finding); network error = `unavailableChecks` (not a finding) |
| `accessibility.link_text.generic` | anchor text is generic | trimmed+lowercased ∈ fixed list: `click here, read more, learn more, more, here, this, this link, link, read this, details` — **or** single char/number, bare URL, or empty with no `aria-label`/`title` |
| `technical.https.missing` | final URL after redirects is `http://` | final `https://` = no finding; `http://`→`https://` redirect = no finding; final `http://` = finding |
| `perf.slow_response` | TTFB too slow | **> 3.0 s** |
| `seo.robots.signals` | any adverse signal — indexing or crawling | see below |

**Robots — evidence preserved separately** (per your instruction): the finding's `evidence` carries four distinctly-labeled parts — `metaRobots` (raw value + directives found), `xRobotsTag` (raw value + directives), `robotsTxt` (whether checked, which rule matched, raw line), and `interpretation` (scanner's derived conclusion, **clearly labeled as derived, never merged with the raw signals**). The interpretation explicitly **distinguishes indexing from crawling**: `noindex` (meta robots / `X-Robots-Tag`) means the page will not be indexed — that is an indexing signal; `nofollow` and robots.txt disallow rules are **crawling/link-following signals only**. **`nofollow` is never equated with `noindex` and is never reported as "this page will not be indexed."** Fires only if at least one adverse signal exists; absent `robots.txt` alone never fires. Raw evidence and interpretation travel to the AI side by side so it can prioritize from facts.
- **Duplicate title: dropped** (no crawl; later enhancement if bounded crawling ever exists).

**Finding model** (scanner output — the AI's only input):
```
{ id: "f_1",              // instance id, assigned per scan
  type: "seo.title.missing", // stable type ID — the AI may only reference these
  note: "…factual one-liner of what was observed…",
  evidence: { …structured, check-specific: snippet/header value/thresholds actually measured… } }
```

### AI adapter (`src/ai/adapter.js` + `gemini.js`)
Implements `generatePlan(findings) → plan`. **Small boundary: the scanner and UI never know which provider is used.** Sends: system instruction ("explain, prioritize, write tasks — use ONLY the findings provided; do not introduce findings not present"), the findings JSON, and the **response JSON Schema** (`responseFormat`/`responseSchema` — exact field name ⚠️ verify against current Gemini docs at build). **No tools enabled: no Google Search, no URL Context, no browsing.** The AI is never given the site URL as anything it could act on — URLs appear only as data inside evidence it cannot fetch.
Defaults: `AI_BASE_URL` = Gemini v1beta, `AI_MODEL` = current Flash, key from `.env`.
PRD ref: `prd.md > AI rescue-plan layer`; `scope.md > The Unique Kernel` boundary.

**Response schema (conceptual):**
```
{ summary: string,                    // scan summary line
  results: [ { findingId: string,     // MUST equal an input finding id
    priority: "fix_now" | "fix_next" | "improve_later",
    problemTitle, explanation, whyItMatters, developerTask: string,
    acceptanceCriteria?: string[] } ] }   // one entry per input finding — no more, no fewer
```

### Plan validator (`src/ai/validatePlan.js`)
Application-code checks **after** parsing, regardless of what the API promised: (1) structural shape of every field; (2) priority is one of the three buckets; (3) **every `findingId` exists in the scanner's input, and every input finding appears exactly once** — invented, missing, or duplicated IDs → reject the whole plan → `ai_failed` response. No extra validation library; explicit checks against this small shape.
PRD ref: `prd.md > States and Boundaries > AI step fails` (findings preserved, Retry re-calls `/api/plan` only).

### Frontend (`public/index.html` + `app.js`)
A three-state machine (start → scanning → results) with sections toggled in the DOM; **current state reflects the real request phase** (scan call in flight = "Scanning website"; plan call in flight = "Analyzing findings → Building rescue plan"). Holds `findings` and `plan` in memory only. Maps every error response to its PRD state (inline URL validation, unreachable message + try another, partial-scan warning using `unavailableChecks`/`partial`, AI-failure panel with Retry). Renders summary (count = scanner findings), three sections (empty = "nothing currently assigned"), expandable cards.
PRD ref: `prd.md > Screens and Layout`, `Features and Behavior`, all of `States and Boundaries`.

## Data Model

No database. Every piece of data, answered plainly:

| Data | Where it lives | How it's updated | Leave and come back |
|---|---|---|---|
| `Finding[]` | Produced fresh by the scanner per request; **held in browser memory** after `/api/scan` returns | Never — one scan, immutable evidence | Refresh → gone → start screen (PRD: session only) |
| Rescue `plan` | Browser memory after `/api/plan` | Only via AI retry | Refresh → gone |
| AI config | `.env` on disk, read at server start | Edit file, restart server | Persists (it's configuration, not product data) |
| Check thresholds/URL list | Constants in `checkConfig.js` | Code change | Persists |

**Data flow:** originates at (a) the target website (HTML/headers) and (b) your URL input → lives only in transit → transformed by checks into findings → transformed by AI into plan → rendered. Nothing is written to disk by the app.

## File Structure

```
site-rescue/
├── src/
│   ├── server.js            # Express: static + /api/scan + /api/plan
│   ├── scanner/
│   │   ├── fetchPage.js     # HTTP fetch, TTFB timing, headers, 10s timeout, robots.txt + favicon probes
│   │   ├── parseHtml.js     # cheerio parse → raw signals
│   │   ├── checks.js        # the 15 checks, exact thresholds
│   │   └── findingTypes.js  # stable type IDs + finding/findingId helpers
│   ├── ai/
│   │   ├── adapter.js       # provider boundary: generatePlan(findings)
│   │   ├── gemini.js        # default implementation (env-configured)
│   │   ├── planSchema.js    # response JSON Schema (shared by request + validation)
│   │   └── validatePlan.js  # shape + finding-ID cross-check; rejects invented IDs
│   └── checkConfig.js       # thresholds & generic-link list (single source of truth)
├── public/
│   ├── index.html           # three-state UI
│   ├── app.js               # state machine, API calls, error mapping, rendering
│   └── styles.css           # Tailwind entry/compiled styles
├── .env                     # your key — git-ignored
├── .env.example             # placeholders + signup pointer — committed
├── package.json
├── README.md                # reproduction steps for the public repo
├── .gitignore               # already ignores /devpost/learner-profile.md, .env*
├── devpost/                 # learning workspace (canonical plan docs)
└── skills curriculum files (.agents/, agent/, etc.)
```

## External Services and Dependencies

- **Gemini API** (only external service) — endpoint per `AI_BASE_URL` (default `https://generativelanguage.googleapis.com/v1beta`), key via `AI_API_KEY`, model via `AI_MODEL`. Docs: https://ai.google.dev/gemini-api/docs · Structured outputs: https://ai.google.dev/gemini-api/docs/structured-output · Free-tier signup: https://aistudio.google.com/apikey (Nigeria confirmed supported). Cost: $0 on the free tier at PoC volume; rate limits ~10–15 req/min tier — far above a demo's ~1–2 AI calls. Model ID settled: `gemini-3.8-flash`. ⚠️ *Confirm the live free-tier quota in AI Studio on day one of the build (limits move).*"
- **npm packages:** express, cheerio, tailwind (delivery TBD). Doc links in Stack.
- **The scanned websites themselves** — public HTTP(S) GETs only; robots.txt honored as a *signal source* (we read it, we don't crawl).
- No database, no hosting, no other APIs. Keys: exactly one (`AI_API_KEY`), never committed, never requested in chat.

## Important Failure Modes

The PRD's honesty rule governs all of these: never fabricate, never silently fail, always one clear next action.

- **Target site unreachable / 10s timeout** → `unreachable` response → PRD error state: "could not access the website" + *Enter another URL*. Scanner never returns placeholder findings.
- **Secondary probes fail** (`robots.txt`/favicon network error while main HTML fine) → check lands in `unavailableChecks`, `partial: true` → UI shows the **partial-scan warning** — "not checked" is never dressed up as "checked and fine".
- **AI fails: 4xx/5xx/429, malformed JSON, or validation rejects it** (invented/missing finding IDs) → `ai_failed` → UI **keeps the findings**, explains the rescue-plan step couldn't complete, **Retry** re-calls `/api/plan` only. This is the failure we most expect (rate limits, model quirks), so it gets the smoothest path.
- **Input URL garbage/empty, or a non-public destination** (localhost, loopback, RFC1918 private, link-local, multicast/reserved — including any redirect hop pointing there) → rejected as `invalid_url` **before any request is attempted**: in-browser first (inline highlight + message), server-side SSRF check (scheme + pre-resolve IP validation) as defense in depth.

## What Was Simplified and Why

- **No database** (in-memory results) — persistence proves nothing about the kernel; a DB adds setup, schema, and cleanup. Refresh-loses-everything is *specified behavior*, not an accident.
- **No headless browser / Puppeteer** (fetch + cheerio only) — agreed this session: every check is provable from raw HTML + headers; a browser binary is a large dependency and a new failure surface. Render-dependent checks → Later.
- **No crawl** (strictly single-page; duplicate-title check dropped) — a crawl for one check isn't proportionate to a 2–4 h PoC; cross-page checks → Later.
- **Two endpoints instead of live streaming progress** — real phase-based steps with zero streaming complexity; retry-AI-without-rescan falls out for free.
- **Synchronous AI call instead of queue/worker** — the PRD cut background jobs; one HTTP round-trip is honest and visible.
- **Single AI provider behind one adapter module instead of multi-provider support** — full abstraction is infrastructure the PoC doesn't need; the adapter keeps a future swap to a one-file change while we build against Gemini's free tier today.
- **Validation by explicit checks instead of a schema-validation library** — the response shape is small; fewer dependencies, same guarantee.

## Decisions and Open Issues

**Learner decisions (from this interview):**
- Node + Express, vanilla frontend (React evaluated and rejected: no material PoC benefit, adds build/debug surface), Tailwind, Git — reliability and speed prioritized, "a small amount of learning" allowed.
- Strictly single-page pipeline; **no Puppeteer/Playwright**; **duplicate title dropped**; catalog = the 15 checks with my thresholds **accepted verbatim** (60 chars / 3.0 s / fixed generic-link list / four robots signals with separately-preserved raw evidence).
- **Final spec corrections (learner's):** (a) **SSRF protection on `/api/scan`** — http/https only; localhost, loopback, RFC1918 private, link-local, multicast/reserved and other non-public destinations rejected; hostname resolved and validated before connecting; every redirect destination re-validated; all treated as `invalid_url` without attempting the request. (b) **`AI_MODEL=gemini-3.8-flash` set explicitly** (stable GA model ID per Google's current official docs; implementation-level API field verification remains a build task). (c) **HTTPS detection on the final post-redirect URL** — final https = no finding, final http = finding, http→https upgrade = no finding. (d) **`seo.robots.signals` stays one type**, but its derived interpretation distinguishes **indexing from crawling** — `nofollow` is never equated with `noindex` — with raw meta robots / `X-Robots-Tag` / robots.txt evidence preserved separately. (e) **Catalog count made internally consistent**: 15 conditions, with `seo.h1.missing` and `seo.h1.multiple` as separate explicit stable type IDs.
- **Gemini Flash** chosen for runtime **after the learner required live verification first** (Nigeria availability, free tier, JSON-schema support, Node ease, rate limits, current model) — provider must stay swappable via `AI_BASE_URL`/`AI_API_KEY`/`AI_MODEL`; no tools, no URL-as-browsable-input; validate output in app code and **reject any AI finding ID not produced by the scanner**.
- No DB/auth/queues/workers; original implementation only — **no Site Scout code**.

**The "useful unknown" for the record:** the AI provider choice was the genuine uncertainty — the learner explicitly didn't want to guess and delegated it ("recommend the simplest reliable choice… but verify first"). *What clarified it:* the six-criterion verification pass above — resolved by choosing Gemini Flash behind an env-configured adapter, with live-quota/model-alias confirmation flagged as the first build step so the assumption gets checked against reality immediately.

**Implementation details derived from learner decisions (not learner choices):** cheerio as the parser, the two-route API shape, `validatePlan` as a separate module, in-memory frontend state, file layout above.

**Open (none block approval):**
- ⚠️ Live free-tier quota — confirm at AI Studio on build day one. *(Model ID is no longer open: settled as `gemini-3.8-flash`.)*
- ⚠️ Tailwind delivery method (browser build vs CLI) — decide at build; no design impact.
- ⚠️ Exact Gemini structured-output request field name (`responseSchema` vs `responseJsonSchema`) — verify against current docs when implementing the adapter.
- **Accent color: amber/orange proposed above for Look and Feel** — your nod or change at review.
- Carried from PRD and now **resolved:** check catalog (15 checks above), AI provider (Gemini Flash), model ID (`gemini-3.8-flash`).
