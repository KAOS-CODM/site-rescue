# Site Rescue

**Find what's broken. Fix what matters.**

Paste a website URL, get an evidence-backed rescue plan: what the scan found, what to fix first, and a concrete developer task for every issue — one page, end to end.

Site Rescue is two small programs in one:

- **The scanner — source of truth.** A single-page fetch (HTML + headers) behind strict SSRF guards, `robots.txt` and `/favicon.ico` probes, and **15 fixed checks**. Every finding carries a stable type ID (`seo.meta_description.missing`, `accessibility.link_text.generic`, …) and the structured evidence that proves it. The scanner only reports what it actually observed.
- **The AI decision layer.** Sends *only* the scanner's findings to Gemini Flash (no tools, no browsing) to explain, prioritize (**Fix now / Fix next / Improve later**), and write developer tasks. The server validates every response: a plan that references any finding the scanner didn't produce — or drops/duplicates one — is rejected outright.

If the AI step fails (free-tier rate limit, provider outage), the scan results stay on screen and **Retry rescue plan** re-runs only the plan step — the site is never re-scanned, and no plan is ever fabricated.

## Prerequisites

- **Node.js 20+** (developed and verified on Node 22)
- **Network access** — scanning fetches real public sites; the plan step calls the Gemini API
- **A free Gemini API key** — [get one at AI Studio](https://aistudio.google.com/apikey) (free tier, no card needed)

## Quick start

```bash
git clone <repo-url> site-rescue
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
2. **Scanning** — three honest phases tied to the real requests: *Scanning website → Analyzing findings → Building rescue plan*. No invented percentages.
3. **Results** — scanned URL, HTTP status, time-to-first-byte, and the count of **unique scanner findings**; the rescue plan in three priority sections. Each compact, expandable card keeps the layers apart:
   - **Scanner** — what was observed, human-readable evidence ("Meta description element: not found"), with the full JSON evidence one expansion deeper;
   - **AI** — explanation, why it matters, developer task (+ acceptance criteria when provided).

Honesty rules are product requirements: partial scans (a probe couldn't run) are labeled as partial — "not checked" is never shown as "passed"; a clean scan renders a deterministic empty plan **without calling the AI**.

## Configuration

`.env` (copied from `.env.example`):

| Variable | Default | Purpose |
|---|---|---|
| `AI_BASE_URL` | *(empty → Gemini v1beta)* | AI endpoint — leave empty for the default provider |
| `AI_API_KEY` | *(your key)* | required only for the rescue-plan step |
| `AI_MODEL` | `gemini-3.8-flash` | model with JSON-schema structured output |

## HTTP API

| Endpoint | Body | Success | Errors |
|---|---|---|---|
| `POST /api/scan` | `{ url }` | `{ url, finalUrl, status, ttfbMs, findings[], unavailableChecks?, partial? }` | `400 invalid_url` · `502 unreachable` · `500 scan_failed` |
| `POST /api/plan` | `{ findings }` | `{ summary, results[] }` | `400 invalid_request` · `502 ai_failed` |

- Non-public URLs (localhost, private IP ranges, …) are rejected **before any request is attempted**, and every redirect hop is re-validated under the same rules.
- Empty `findings` returns the deterministic empty plan — **no AI request is made**.

## Commands

| Command | What it does |
|---|---|
| `npm start` | run the server on http://localhost:3000 (override with the `PORT` env var) |
| `npm run build:css` | compile Tailwind → `public/styles.css` |
| `npm run watch:css` | recompile on change while restyling |

## Scope (deliberately out)

No database, accounts, scan history, crawling, or headless browser — one page, two requests, in-memory results (a refresh resets to the start screen). See [`devpost/prd.md`](devpost/prd.md) for the full product requirements and [`devpost/spec.md`](devpost/spec.md) for the technical design.

---

Docs: [Gemini API](https://ai.google.dev/gemini-api/docs) · [Structured outputs](https://ai.google.dev/gemini-api/docs/structured-output)
