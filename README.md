# Site Rescue

**Find what's broken. Fix what matters.**

Paste a website URL, get an evidence-backed rescue plan: what the scan found across the site (up to 10 of its own pages), what to fix first, and a concrete developer task for every issue — end to end.

Site Rescue is two small programs in one:

- **The scanner — source of truth.** A bounded same-origin crawl — the seed page plus up to **10 pages per scan** (robots.txt honored, 2 MB response cap, loops/duplicates prevented) behind strict SSRF guards, `robots.txt` and `/favicon.ico` probes, and **16 fixed checks** (including HTTP 4xx/5xx status findings). Every finding carries a stable type ID (`seo.meta_description.missing`, `accessibility.link_text.generic`, …), the structured evidence that proves it, and the **page URL** that produced it. The scanner only reports what it actually observed.
- **The AI decision layer.** Sends *only* the scanner's findings to an OpenAI-compatible model via **OpenRouter** (no tools, no browsing) to explain, prioritize (**Fix now / Fix next / Improve later**), and write developer tasks. The server validates every response: a plan that references any finding the scanner didn't produce — or drops/duplicates one — is rejected outright.

If the AI step fails (free-tier rate limit, provider outage), the scan results stay on screen and **Retry rescue plan** re-runs only the plan step — the site is never re-scanned, and no plan is ever fabricated.

## Prerequisites

- **Node.js 20+** (developed and verified on Node 22)
- **Network access** — scanning fetches real public sites; the plan step calls OpenRouter
- **An OpenRouter API key** — [get one at openrouter.ai/keys](https://openrouter.ai/keys) (the default model is a free `:free` variant)

## Quick start

```bash
git clone https://github.com/KAOS-CODM/site-rescue site-rescue
cd site-rescue
npm install
cp .env.example .env      # Windows: copy .env.example .env
# Edit .env and set:  AI_API_KEY=your-key-here
npm start
```

Open **http://localhost:3000**, paste a **public** website URL, press **Scan website**.

> Your key lives only in `.env`, which is git-ignored. Never commit it, never paste it into chat or code.

Scanning works even before the key is added; without a key only the rescue-plan step fails — honestly, with a Retry button.

## What you'll see

1. **Start** — URL input with client-side validation; invalid input never fires a request.
2. **Scanning** — three honest phases tied to the real requests: *Scanning website → Analyzing findings → Building rescue plan*, plus streamed crawl progress in real counters (*4 pages scanned · 8 URLs discovered · max 10 pages*). No invented percentages.
3. **Results** — scanned URL, HTTP status, time-to-first-byte, unique scanner findings, and pages scanned — with **Rescan this site** / **New scan** actions (no refresh needed); the rescue plan in three priority sections. Each compact, expandable card keeps the layers apart:
   - **Scanner** — what was observed, **which page it came from** (`pageUrl` badge), human-readable evidence ("Meta description element: not found"), with the full JSON evidence one expansion deeper;
   - **AI** — explanation, why it matters, developer task (+ acceptance criteria when provided).

Honesty rules are product requirements: partial scans (a probe couldn't run, a discovered page couldn't be fetched) are labeled as partial with the real reason — "not checked" is never shown as "passed"; URLs skipped by robots.txt or the origin boundary are listed separately (policy, not missing evidence); a clean scan renders a deterministic empty plan **without calling the AI**.

## Install as an app (PWA)

Site Rescue is an installable Progressive Web App — the same web app, no separate mobile codebase:

- **Install:** in Chrome/Edge, click the install icon in the address bar (or menu → *Install Site Rescue*); on mobile, *Add to Home screen*. It launches in its own window as **Site Rescue** with the app icon.
- **Offline:** the app shell (start screen, styles, scripts, icons) is cached by a small service worker, so the app opens without network.
- **Scans always need network.** The service worker never caches API responses — a scan or rescue-plan step attempted offline fails honestly with the normal error message. No stale or fabricated results, ever.

## Configuration

`.env` (copied from `.env.example`):

| Variable | Default | Purpose |
|---|---|---|
| `AI_PROVIDER` | `openrouter` | must be `openrouter` or empty — anything else fails honestly |
| `AI_BASE_URL` | `https://openrouter.ai/api/v1` | OpenAI-compatible chat-completions endpoint |
| `AI_API_KEY` | *(your key)* | required only for the rescue-plan step |
| `AI_MODEL` | `inclusionai/ling-3.0-flash-fin:free` | free chat model served via Novita |

## HTTP API

| Endpoint | Body | Success | Errors |
|---|---|---|---|
| `POST /api/scan` | `{ url }` | streamed `text/event-stream`: `{type:'progress', …}` events → one `{type:'result', result:{ url, finalUrl, status, ttfbMs, findings[], unavailableChecks?, partial?, pages[], discovered, skipped[], crawlFailures[], limit }}` | pre-stream JSON: `400 invalid_url` · `502 unreachable` · `500 scan_failed` |
| `POST /api/plan` | `{ findings }` | `{ summary, results[] }` | `400 invalid_request` · `502 ai_failed` |

- Non-public URLs (localhost, private IP ranges, …) are rejected **before any request is attempted**, and every redirect hop is re-validated under the same rules.
- The crawl stays on the seed's exact origin (no www/non-www mixing): robots.txt-disallowed, off-origin, duplicate, and failed URLs never count against the 10-page budget; failures and skips are listed in the result, never hidden.
- Empty `findings` returns the deterministic empty plan — **no AI request is made**.

## Commands

| Command | What it does |
|---|---|
| `npm start` | run the server on http://localhost:3000 (override with the `PORT` env var) |
| `npm run build:css` | compile Tailwind → `public/styles.css` |
| `npm run watch:css` | recompile on change while restyling |

## Scope (deliberately out)

No database, accounts, scan history, or headless browser — a deliberately bounded same-origin crawl (≤ 10 pages per scan), two requests with streamed progress, in-memory results (a refresh resets to the start screen). See [`devpost/prd.md`](devpost/prd.md) for the full product requirements and [`devpost/spec.md`](devpost/spec.md) for the technical design.

---

Docs: [OpenRouter API](https://openrouter.ai/docs)
