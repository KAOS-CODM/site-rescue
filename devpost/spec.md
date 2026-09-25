---
doc: spec
status: approved
---
<!-- `status`: `draft` until the learner approves; "looks good" counts as approval. -->

# Site Rescue — Technical Spec

## How This Works, In Plain Language

Site Rescue is **two small programs in one**: a **scanner** that looks at a real website, and an **AI planning layer** that reads what the scanner found.

1. You type a URL into a web page running on your laptop. That page asks the **Express server** (the backend program) to scan it.
2. The **scanner** downloads the seed page's HTML and its response headers — like saving a webpage to a file and reading it — measures how long the response took, and also probes two small extras: `robots.txt` and `/favicon.ico`. It then follows links **on that site's own origin** to check up to **10 pages total per scan**; robots.txt-disallowed or off-origin links are skipped without ever being requested.
3. The scanner runs **16 fixed checks** (missing title, missing alt text, slow response, an HTTP 4xx/5xx status, and so on) against exactly what it downloaded from each page. Each check that fires produces a **finding**: a stable type ID (like `seo.title.missing`), **structured evidence** — the actual HTML snippet or header value that proves it — and the **page URL** that produced it. The scanner is the source of truth; it only reports what it saw.
4. Those findings — **and only those findings** — are sent to the **AI layer** through a small adapter module. The AI gets no tools, no ability to browse, and doesn't even get sent off to look at the site. Its whole job: explain each finding in plain English, say why it matters, pick a priority (Fix now / Fix next / Improve later), and write the developer task.
5. The server checks the AI's answer against the rules before showing it: valid shape, and **every finding ID in the answer must be one we actually sent** — if the AI invents a finding or garbles the output, we throw it away and show the "AI step failed, retry" state instead.
6. The web page shows the **rescue plan**: summary on top, three priority columns, expandable finding cards.

Why this shape instead of something bigger: no database (results live in the page until you refresh), no queues or background workers (everything happens in two short requests you can watch), no headless browser (plain HTML + headers prove every check). Each of those would add setup and failure modes without proving the kernel — and the kernel *is* the pipeline: **real evidence → AI decisions → developer tasks**, with the AI fenced off from inventing anything.

## The Core Journey Through the System

PRD ref: `prd.md > The Core Journey`.

1. **User opens the start screen** → Express serves `public/index.html` (static files; no API call yet). They see header, headline, explanation, URL input, Scan button, Scan → Prioritize → Fix hint.
2. **User clicks Scan website** → frontend validates non-empty, shows the scanning state, and calls **`POST /api/scan`** with the URL.
3. **Server scans** → validates the URL (scheme + pre-resolve IP check, **SSRF rules below** — non-public destinations rejected before any request) → fetches the seed (timeout, 2 MB response cap, measured time-to-first-byte, every redirect hop re-validated) → reads response headers → parses HTML with cheerio → probes `robots.txt` and `/favicon.ico` → runs the 16 checks → **streams factual progress events** while it crawls same-origin links (max 10 pages per scan) → the terminal result carries `{ findings[], pages[], discovered, skipped[], crawlFailures[] }`. *(Invalid URL / unreachable site / internal error **before the stream opens** → the original error responses mapped to the PRD's error states; a discovered page that fails mid-crawl → honestly listed in `crawlFailures`, never fabricated as a finding.)*
4. **Frontend shows "Scanning website" complete, moves to "Analyzing findings → Building rescue plan"** → calls **`POST /api/plan`** with the findings it just received **plus the scan's page ledger (`pages`) so the AI knows the scan's real multi-page scope**.
5. **Server calls the AI adapter** → adapter sends the bounded findings (each including its `pageUrl`) to an OpenRouter chat-completions model (config via `AI_BASE_URL`/`AI_API_KEY`/`AI_MODEL`, defaults set for OpenRouter) → response is parsed and validated (shape + finding-ID cross-check) → returns the plan. *(AI failure / invalid output → `{ error: 'ai_failed' }`; the frontend keeps the findings, shows the PRD's AI-failure state with a Retry button that re-calls only `/api/plan` — the scan is never repeated.)*
6. **Frontend renders the rescue plan** → URL + summary (count = unique scanner findings), three priority sections, expandable cards: title, priority, evidence (from scanner), explanation, why it matters, developer task (+ acceptance criteria when the AI gives them). Empty sections say so. Results are held in the page's memory only.

```
Browser (public/)                Express (server.js)              Outside world
┌──────────────┐  POST /api/scan   ┌─────────────┐   fetch      ┌──────────────┐
│ start screen │ ────────────────→ │  scanner/   │ ───────────→ │ target site  │
│ scanning     │ ←──────────────── │  fetchPage  │ ←─────────── │ HTML+headers │
│ state        │   progress events │  crawl       │  robots.txt  │ /favicon.ico │
│ results      │   findings[]      │  parseHtml  │  (≤10 pages) └──────────────┘
│              │                   │  checks     │
│ (in-memory)  │  POST /api/plan   ├─────────────┤  HTTPS+JSON   ┌──────────────┐
│              │ ────────────────→ │  ai/        │ ───────────→ │ OpenRouter   │
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
| **OpenRouter via plain HTTPS (OpenAI-compatible chat completions)** — default model **`inclusionai/ling-3.0-flash-fin:free`**, `temperature: 0`, **no `response_format`** (the served free model does not support structured outputs — `validatePlan` is the final authority instead) | Provider migration recorded in `checklist.md > Revisions`: free tier, no card needed, OpenAI-compatible shape keeps the adapter a thin boundary. | https://openrouter.ai/docs |
| **Git/GitHub** | Your pick for version control. | https://git-scm.com/doc |

Provider coupling is deliberately broken at one point: the AI is reached **only** through `src/ai/adapter.js`, configured by `.env`:

```
AI_BASE_URL=https://openrouter.ai/api/v1
AI_API_KEY=            # you fill this in locally — never commit, never paste in chat
AI_MODEL=inclusionai/ling-3.0-flash-fin:free   # free chat model served via Novita (no response_format is sent)
```
`.env` is already git-ignored; `.env.example` ships with placeholders.

## Where It Runs and How Someone Tries It

- **Runtime:** one local Node process. No hosting, no deployment (per `prd.md > Deferred From the POC`).
- **Needs:** Node 20+, network access (to scan real sites and call the AI), one OpenRouter API key in `.env`.
- **Start it:** `npm install` → copy `.env.example` to `.env` and add the key → `npm start` → open **http://localhost:3000**.
- **Install it (optional):** the running app is an installable PWA — the browser's install affordance (Chrome/Edge address-bar install icon; *Add to Home screen* on mobile) adds it to the launcher as **Site Rescue** with the app icon, opening in its own standalone window. The app **shell** (start screen, styles, script, icons) caches for offline launch; **scanning and AI plans always require network** — offline they fail through the existing honest error states, never fabricated results.
- **Demo recording:** the required short demo video shows that exact flow on a real public URL. The required public GitHub repo must let another person reproduce it from README setup steps — README will document the start commands and the free OpenRouter key signup link (no key in the repo).
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
Contract (Final Review revision — streamed): body `{ url: string }`.
**Pre-stream** (URL validation, seed fetch, probes, seed checks): failures respond as plain JSON exactly as before — `4xx/5xx { error: 'invalid_url' | 'unreachable' | 'scan_failed', message }` (PRD error states unchanged).
**On success the200 response is `text/event-stream`** — `data: {json}\n\n` events: first factual progress (`{type:'progress', scanned, discovered, requested, limit, fetching, pages}` — real counters only, never invented percentages), then exactly ONE terminal event:
`{type:'result', result:{ url, finalUrl, status, ttfbMs, findings: Finding[], unavailableChecks?, partial?, pages: Page[], discovered, skipped: [{url, reason}], crawlFailures: [{url, reason}], limit }}` or `{type:'error', error, message}`.
Validates/normalizes the input URL first (invalid → `invalid_url`, nothing fetched). Fetch timeout 10s; a response larger than **2 MB** fails as `unreachable` with a clear size reason — an oversize body is never partially parsed and never yields findings. Also probes `robots.txt` and `/favicon.ico`.
Crawl rules (`scanner/crawl.js`): **max 10 requested pages per scan including the seed** (the budget counts *requested* URLs only — robots-blocked, rejected, duplicate and external URLs are never requested, so they don't consume it); STRICT origin = the exact normalized origin of the submitted URL (no www/non-www interchangeability); robots.txt `Disallow` gates discovered URLs (blocked = recorded skip); one `seen` set prevents loops and duplicates; every crawl fetch runs through the same `fetchSafe` path — per-hop SSRF validation unchanged, plus an origin gate that refuses any redirect leaving the submitted origin. Failed fetches are recorded in `crawlFailures` with their real reason — never as findings, never silently dropped.

**SSRF protection (required — learner's explicit correction):** all of the following are checked **before any request is attempted**, and any rejection returns `invalid_url` **without attempting the request**:
- Accept only `http:` / `https:` schemes.
- Reject non-public destinations: localhost, loopback (`127.0.0.0/8`, `::1`), private RFC1918 (`10/8`, `172.16/12`, `192.168/16`), IPv6 ULA/link-local (`fc00::/7`, `fe80::/10`), link-local `169.254/16`, multicast/reserved/bogon ranges, and any other non-public destination.
- **Resolve the hostname before connecting** (DNS lookup) and reject if **any** resolved IP is non-public; the connection must go to the validated address.
- **Validate every redirect destination with the same rules** — redirects are followed manually, each hop re-checked (scheme + resolved IP) — so a public URL cannot redirect into an internal/private destination.

PRD ref: `prd.md > Starting a scan`, `States and Boundaries` (invalid / unreachable / internal error).

### Scanner: fetchPage → parseHtml → checks (per page, inside a bounded crawl)
- **fetchPage** — fetches the URL, records **time-to-first-byte** (threshold: > 3.0 s → slow-response finding), keeps status code + response headers, follows redirects **manually with each hop validated under the SSRF rules plus (on crawl redirects) an origin gate that refuses leaving the submitted origin**, and records the **final URL after redirects**. Network failure, timeout, or a response larger than **2 MB** → `unreachable` with a real reason — an oversize body is never partially parsed and yields no findings. HTTPS detection uses that final URL: final `https://` = no finding; final `http://` = finding; `http://` → `https://` upgrade redirect = no finding.
- **parseHtml** — cheerio parse; extracts the raw signals the checks need (titles, meta tags, headings, imgs, anchors, `<html lang>`, canonical, favicon links, meta robots).
- **content gate (`runPageChecks`)** — the response's **Content-Type is authoritative** before any HTML scanning: `text/html` / `application/xhtml+xml` → the full catalog and link discovery run (when the header is entirely absent, an HTML-looking body decides). Any other content type (PDF, image, CSS, JS, fonts, archives…) → **no HTML checks and no link discovery**: only the factual HTTP status may become a finding (`http.error_status` when ≥ 400), plus one honest `unavailableChecks` entry (`html.checks` — *"<url> responded <content-type> — not HTML, so SEO/accessibility checks were not run"*) — so a non-HTML resource is never presented as a checked HTML page and no HTML finding is ever fabricated for it. The page ledger records it as `state: 'non_html'` with its `contentType`, excluded from the "pages scanned" count.
- **crawl** — bounded same-origin crawl (`scanner/crawl.js`): strict origin = the submitted URL's exact normalized origin; max **10 requested pages per scan** including the seed; robots.txt `Disallow` gate (blocked = recorded skip, no budget); one `seen` set for loops/duplicates; discovered links harvested in document order; per-page fetch → parse → checks sharing ONE finding factory (global `f_N` ids across all pages); factual progress snapshots streamed to the UI; failures recorded as `crawlFailures`, policy skips as `skipped`. Error pages with parseable HTML are still run through the checks — a 404 seed yields factual findings, including `http.error_status`. **Candidate filter:** discovered links to obvious non-page resources (`.pdf`, images, `.css`, `.js`, fonts, archives — pathname extension only, so extensionless routes and query-string URLs remain candidates) are never queued as crawl pages and cost no budget; the extension is only a pre-filter — the fetched response's Content-Type (content gate above) decides how a page is treated.
- **checks** — the **16-condition catalog** (16 conditions, each with its own separate stable type ID — `seo.h1.missing` and `seo.h1.multiple` are distinct types), each with the exact thresholds agreed in this spec:

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
| `http.error_status` | final HTTP status of the scanned page is an error | status ≥ **400** (4xx/5xx from the page fetch; favicon/robots probes excluded — they are recorded as `unavailableChecks`, never as this finding) |

**Robots — evidence preserved separately** (per your instruction): the finding's `evidence` carries four distinctly-labeled parts — `metaRobots` (raw value + directives found), `xRobotsTag` (raw value + directives), `robotsTxt` (whether checked, which rule matched, raw line), and `interpretation` (scanner's derived conclusion, **clearly labeled as derived, never merged with the raw signals**). The interpretation explicitly **distinguishes indexing from crawling**: `noindex` (meta robots / `X-Robots-Tag`) means the page will not be indexed — that is an indexing signal; `nofollow` and robots.txt disallow rules are **crawling/link-following signals only**. **`nofollow` is never equated with `noindex` and is never reported as "this page will not be indexed."** Fires only if at least one adverse signal exists; absent `robots.txt` alone never fires. Raw evidence and interpretation travel to the AI side by side so it can prioritize from facts.
- **Duplicate title: dropped** (the Final Review catalog revision added only `http.error_status` as check 16; cross-page duplicate-title detection stays → Later).

**Finding model** (scanner output — the AI's only input):
```
{ id: "f_1",              // instance id, assigned per scan (global across all crawled pages)
  type: "seo.title.missing", // stable type ID — the AI may only reference these
  pageUrl: "https://…",   // which page of the site produced this evidence (Final Review revision)
  note: "…factual one-liner of what was observed…",
  evidence: { …structured, check-specific: snippet/header value/thresholds actually measured… } }
```

### AI adapter (`src/ai/adapter.js` + `openrouter.js`)
Implements `generatePlan(findings, pages?) → plan`. **Small boundary: the scanner and UI never know which provider is used.** Sends: system instruction ("explain, prioritize, write tasks — use ONLY the provided findings; every result maps to exactly one input `findingId`; each finding carries a `pageUrl` — you may reference it and note when the same problem repeats across pages, but never invent pages, URLs, or findings; **the summary must describe the scan scope exactly as the provided page ledger and pageUrls show — never claim findings are on a single page when they come from several pages**"), a structured context object (`scan: { pageCount, pages[] }` — the bounded page ledger — plus the bounded findings JSON `id`, `type`, `note`, `evidence`, `pageUrl` — every page-derived string control-character-stripped and length-capped), `temperature: 0`, `POST {AI_BASE_URL}/chat/completions` with Bearer auth. **No tools, no browsing, no `response_format`** (the default free model does not support structured outputs — `validatePlan.js` is the final authority; response `reasoning` fields are ignored; only a Markdown fence surrounding the whole value is stripped). The AI is never given the site URL as anything it could act on — URLs appear only as data inside evidence it cannot fetch. No retry, no fallback, no second model: any failure → `ai_failed`.
Defaults: `AI_BASE_URL` = `https://openrouter.ai/api/v1`, `AI_MODEL` = `inclusionai/ling-3.0-flash-fin:free`, key from `.env`, `AI_PROVIDER` must be `openrouter` (or empty).
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
A three-state machine (start → scanning → results) with sections toggled in the DOM; **current state reflects the real request phase** (the `/api/scan` stream in flight = "Scanning website", with the progress panel showing factual streamed counts + current fetch; `/api/plan` in flight = "Analyzing findings → Building rescue plan"). Reads the SSE-style scan response (progress events → one terminal result) and holds `findings` and `plan` in memory only. Maps every failure to its PRD state (inline URL validation, unreachable message + try another, partial-scan warning listing `unavailableChecks` AND `crawlFailures`, a separate panel for `skipped` URLs that is policy — not missing evidence, AI-failure panel with Retry). **Rescan this site** re-runs the same URL and **New scan** returns to the start screen — both without a refresh. Renders summary (count = scanner findings, pages scanned), three sections (empty = "nothing currently assigned"), expandable cards each carrying a `pageUrl` badge (page-level attribution). Carries the PWA installability metadata (manifest link, `theme-color`, favicon + apple-touch-icon links, standalone web-app metas) and registers the service worker with one guarded line at the end of `app.js` (feature-detected, so non-browser environments are unaffected).
PRD ref: `prd.md > Screens and Layout`, `Features and Behavior`, all of `States and Boundaries`.

### PWA layer (`public/manifest.webmanifest`, `public/sw.js`, `public/icons/`)
Installable Progressive Web App packaging of the same web app — no second codebase, no framework, no new features:
- **Manifest** — `name`/`short_name` `Site Rescue`, `start_url` `/`, `scope` `/`, `display: standalone`, `theme_color`/`background_color` `#0a0a0a`, icons 192×192 and 512×512 (`image/png`, `purpose: any maskable`).
- **Icons** — generated app artwork (amber "SR" monogram on neutral-950, sized inside the maskable safe zone): `public/icons/icon-192.png`, `public/icons/icon-512.png`, `public/icons/apple-touch-icon.png` (180×180). No placeholder assets.
- **Service worker (`public/sw.js`)** — simplest honest architecture: precaches ONLY the static shell (`/`, `styles.css`, `app.js`, `manifest.webmanifest`, the three icons); network-first for shell files with cache fallback; versioned cache purged on activate. Everything else — **`/api/*` above all — passes straight through to the network and is never cached**. No background sync, no queueing, no offline results: offline the shell still opens, and a scan fails through the existing `network_error` → honest error state, so the installed app never implies scans work without network.
- **Registration** — `navigator.serviceWorker.register('/sw.js')` at the end of `public/app.js`, guarded by feature detection.
PRD ref: `prd.md > What We're Building` (delivery layer for the existing flow — scope unchanged).

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
│   │   ├── fetchPage.js     # HTTP fetch, TTFB timing, headers, 10s timeout, 2 MB cap, robots.txt + favicon probes
│   │   ├── parseHtml.js     # cheerio parse → raw signals
│   │   ├── crawl.js         # bounded same-origin BFS: ≤10 requested pages, robots gate, origin gate, progress
│   │   ├── checks.js        # the 16 checks, exact thresholds
│   │   └── findingTypes.js  # stable type IDs + finding/findingId helpers (+ pageUrl)
│   ├── ai/
│   │   ├── adapter.js       # provider boundary: generatePlan(findings)
│   │   ├── openrouter.js    # default implementation (env-configured chat/completions)
│   │   ├── planSchema.js    # response shape (shared by request + validation)
│   │   └── validatePlan.js  # shape + finding-ID cross-check; rejects invented IDs
│   └── checkConfig.js       # thresholds & generic-link list (single source of truth)
├── public/
│   ├── index.html           # three-state UI + PWA installability metadata
│   ├── app.js               # state machine, API calls, error mapping, rendering, SW registration
│   ├── styles.css           # Tailwind entry/compiled styles
│   ├── manifest.webmanifest # install manifest: standalone, theme colors, 192+512 icons
│   ├── sw.js                # app-shell cache only — /api/* never cached (scans need network)
│   └── icons/               # generated app icons: 192, 512, apple-touch-icon 180
├── .env                     # your key — git-ignored
├── .env.example             # placeholders + signup pointer — committed
├── package.json
├── README.md                # reproduction steps for the public repo
├── .gitignore               # already ignores /devpost/learner-profile.md, .env*
├── devpost/                 # learning workspace (canonical plan docs)
└── skills curriculum files (.agents/, agent/, etc.)
```

## External Services and Dependencies

- **OpenRouter** (only external service) — `POST {AI_BASE_URL}/chat/completions`, Bearer auth, endpoint per `AI_BASE_URL` (default `https://openrouter.ai/api/v1`), key via `AI_API_KEY`, model via `AI_MODEL` (default `inclusionai/ling-3.0-flash-fin:free`). `temperature: 0`, **no `response_format`** (free model doesn't support structured outputs — `validatePlan` is the authority), no retry/fallback/second model. Docs: https://openrouter.ai/docs · Keys: https://openrouter.ai/keys (free, no card). Cost: $0 on the free `:free` model at PoC volume. Verified end-to-end post-migration (provider change recorded in `checklist.md > Revisions`).
- **npm packages:** express, cheerio, tailwind (delivery TBD). Doc links in Stack.
- **The scanned websites themselves** — public HTTP(S) GETs only; robots.txt honored both as a *signal source* and as a crawl gate: `Disallow`ed URLs are recorded as skipped, never requested.
- No database, no hosting, no other APIs. Keys: exactly one (`AI_API_KEY`), never committed, never requested in chat.

## Important Failure Modes

The PRD's honesty rule governs all of these: never fabricate, never silently fail, always one clear next action.

- **Target site unreachable / 10s timeout / response larger than 2 MB** → `unreachable` response → PRD error state: "could not access the website" + *Enter another URL*. Scanner never returns placeholder findings; an oversize body is never partially parsed.
- **Secondary probes fail** (`robots.txt`/favicon network error while main HTML fine) → check lands in `unavailableChecks`, `partial: true` → UI shows the **partial-scan warning** — "not checked" is never dressed up as "checked and fine".
- **A discovered page fails mid-crawl** (network, timeout, oversize, redirect leaving the origin) → recorded in `crawlFailures` with the real reason, `partial: true`, listed in the warning — never fabricated as a finding, never silently dropped. URLs skipped by *policy* (robots.txt disallow, off-origin boundary) go to `skipped` and are listed separately — policy, not missing evidence, so they never mark the scan partial.
- **AI fails: 4xx/5xx/429, malformed JSON, or validation rejects it** (invented/missing finding IDs) → `ai_failed` → UI **keeps the findings**, explains the rescue-plan step couldn't complete, **Retry** re-calls `/api/plan` only. This is the failure we most expect (rate limits, model quirks), so it gets the smoothest path.
- **Input URL garbage/empty, or a non-public destination** (localhost, loopback, RFC1918 private, link-local, multicast/reserved — including any redirect hop pointing there) → rejected as `invalid_url` **before any request is attempted**: in-browser first (inline highlight + message), server-side SSRF check (scheme + pre-resolve IP validation) as defense in depth.

## What Was Simplified and Why

- **No database** (in-memory results) — persistence proves nothing about the kernel; a DB adds setup, schema, and cleanup. Refresh-loses-everything is *specified behavior*, not an accident.
- **No headless browser / Puppeteer** (fetch + cheerio only) — agreed this session: every check is provable from raw HTML + headers; a browser binary is a large dependency and a new failure surface. Render-dependent checks → Later.
- ~~**No crawl**~~ **superseded by the Final Review bounded-crawl revision** — the scan now follows same-origin links over a strict budget (seed + ≤ 10 requested pages, robots-gated, no headless browser, SSRF per hop); duplicate-title check still dropped, cross-page checks beyond that → Later.
- ~~**Two endpoints instead of live streaming progress**~~ **superseded**: `/api/scan` now streams factual progress events over the same POST (still two endpoints, still one scan request; pre-stream error contract untouched); retry-AI-without-rescan still falls out for free.
- **Synchronous AI call instead of queue/worker** — the PRD cut background jobs; one HTTP round-trip is honest and visible.
- **Single AI provider behind one adapter module instead of multi-provider support** — full abstraction is infrastructure the PoC doesn't need; the adapter keeps a future swap to a one-file change while we build against OpenRouter's free tier (post-migration).
- **Validation by explicit checks instead of a schema-validation library** — the response shape is small; fewer dependencies, same guarantee.

## Decisions and Open Issues

**Learner decisions (from this interview):**
- Node + Express, vanilla frontend (React evaluated and rejected: no material PoC benefit, adds build/debug surface), Tailwind, Git — reliability and speed prioritized, "a small amount of learning" allowed.
- Strictly single-page pipeline; **no Puppeteer/Playwright**; **duplicate title dropped**; catalog = the 15 checks with my thresholds **accepted verbatim** (60 chars / 3.0 s / fixed generic-link list / four robots signals with separately-preserved raw evidence). *(Single-page part superseded by the Final Review bounded-crawl revision — see Revision record below; no-Puppeteer and the original 15 thresholds stand.)*
- **Final spec corrections (learner's):** (a) **SSRF protection on `/api/scan`** — http/https only; localhost, loopback, RFC1918 private, link-local, multicast/reserved and other non-public destinations rejected; hostname resolved and validated before connecting; every redirect destination re-validated; all treated as `invalid_url` without attempting the request. (b) **`AI_MODEL=gemini-3.8-flash` set explicitly** (stable GA model ID per Google's current official docs; implementation-level API field verification remains a build task). *(Provider since migrated to OpenRouter — see Revision record below.)* (c) **HTTPS detection on the final post-redirect URL** — final https = no finding, final http = finding, http→https upgrade = no finding. (d) **`seo.robots.signals` stays one type**, but its derived interpretation distinguishes **indexing from crawling** — `nofollow` is never equated with `noindex` — with raw meta robots / `X-Robots-Tag` / robots.txt evidence preserved separately. (e) **Catalog count made internally consistent**: 15 conditions, with `seo.h1.missing` and `seo.h1.multiple` as separate explicit stable type IDs.
- **Gemini Flash** chosen for runtime **after the learner required live verification first** (Nigeria availability, free tier, JSON-schema support, Node ease, rate limits, current model) — provider must stay swappable via `AI_BASE_URL`/`AI_API_KEY`/`AI_MODEL`; no tools, no URL-as-browsable-input; validate output in app code and **reject any AI finding ID not produced by the scanner**. *(Since migrated to OpenRouter — the boundary conditions above all still hold; see Revision record below.)*
- No DB/auth/queues/workers; original implementation only — **no Site Scout code**.

**The "useful unknown" for the record:** the AI provider choice was the genuine uncertainty — the learner explicitly didn't want to guess and delegated it ("recommend the simplest reliable choice… but verify first"). *What clarified it:* the six-criterion verification pass above — resolved by choosing Gemini Flash behind an env-configured adapter, with live-quota/model-alias confirmation flagged as the first build step so the assumption gets checked against reality immediately. *(The provider question later reopened once — the recorded Gemini → OpenRouter migration below — and is settled end-to-end.)*

**Revision record (post-approval, from the completed build + Final Review).** Earlier statements above record the original approved decisions; this record states what the build does now:
- **Provider: Gemini → OpenRouter** (rationale + evidence in `checklist.md > Revisions`): the free Novita-served default model doesn't support structured outputs, so the adapter sends **no `response_format`** — `validatePlan.js` remains the final authority; `temperature: 0`; whole-value Markdown-fence stripping only; `reasoning` fields ignored; no retry/fallback/second model. Boundary conditions unchanged: env-configured via `AI_BASE_URL`/`AI_API_KEY`/`AI_MODEL` (+ `AI_PROVIDER` must be `openrouter` or empty), no tools/browsing, invented/missing/duplicate finding IDs rejected.
- **Scan: single-page → bounded same-origin crawl** (the learner's 7 Final Review decisions): seed + max **10 requested pages per scan** — robots-blocked, duplicate, external and never-requested URLs don't consume the budget; STRICT origin = the submitted URL's exact normalized origin (no www/non-www interchangeability); robots.txt `Disallow` honored as recorded skips; **2 MB** response cap (oversize = failed fetch with a clear reason, no findings from it); **`http.error_status` added as check 16** (4xx/5xx factual findings with status evidence; favicon/robots probes excluded); every finding carries **`pageUrl`** attribution, visible in the UI; `/api/scan` streams factual progress (`text/event-stream` over the same POST — pre-stream `400 invalid_url` / `502 unreachable` JSON contract untouched) ending in exactly one terminal result/error event; UI gains the progress panel, page badges, separate skipped/failure disclosure, and **Rescan / New scan** actions. `/api/plan`, `validatePlan.js`, SSRF guards, and the 15 original checks are unchanged.
- **Documentation:** `scope.md`, `prd.md`, `spec.md` and `README.md` aligned to both revisions (this file included).

**Implementation details derived from learner decisions (not learner choices):** cheerio as the parser, the two-route API shape, `validatePlan` as a separate module, in-memory frontend state, file layout above.

**Open (none block approval):**
- ~~⚠️ Live free-tier quota — confirm at AI Studio on build day one~~ **closed** — provider migrated to OpenRouter; the free `:free` model verified end-to-end (see Revision record).
- ⚠️ Tailwind delivery method (browser build vs CLI) — decide at build; no design impact. *(Settled during build: CLI.)*
- ~~⚠️ Exact Gemini structured-output request field name (`responseSchema` vs `responseJsonSchema`)~~ **moot** — the OpenRouter path sends no `response_format`; parsing + `validatePlan` own correctness.
- **Accent color: amber/orange proposed above for Look and Feel** — your nod or change at review.
- Carried from PRD and now **resolved:** check catalog (**now 16 checks** — `http.error_status` added per the Final Review revision), AI provider (**OpenRouter**, post-migration), model (`inclusionai/ling-3.0-flash-fin:free`).
