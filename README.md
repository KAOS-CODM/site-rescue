# Site Rescue

**Find what's broken. Fix what matters.**

Paste a website URL, get an evidence-backed rescue plan: what the scan found across the site (up to 10 pages per scan), what to fix first, and a concrete developer task for every issue, end to end.

## Live Demo

Try Site Rescue: **https://site-rescue.onrender.com/**

## Submission Documents

- [Project Scope](devpost/scope.md) (`devpost/scope.md`)
- [Product Requirements](devpost/prd.md) (`devpost/prd.md`)
- [Technical Specification](devpost/spec.md) (`devpost/spec.md`)

## How It Works

Site Rescue is two small programs in one:

- **The scanner: source of truth.** A bounded same-origin crawl of up to 10 pages per scan, with `robots.txt` honored, a 2 MB response cap, and loops and duplicates prevented. Strict SSRF guards protect the scanner. It also probes `robots.txt` and `/favicon.ico` and runs 16 fixed checks, including HTTP 4xx/5xx status findings. Every finding carries a stable type ID (`seo.meta_description.missing`, `accessibility.link_text.generic`, and others), structured evidence, and the page URL that produced it. The scanner only reports what it actually observed.
- **The AI decision layer.** Sends only the scanner's findings to an OpenAI-compatible model via OpenRouter, with no tools or browsing. The model explains and prioritizes issues as **Fix now**, **Fix next**, or **Improve later**, and writes developer tasks. The server validates every response: a plan that references a finding the scanner didn't produce, or drops or duplicates one, is rejected outright.

If the AI step fails because of a rate limit or provider outage, scan results stay on screen. **Retry rescue plan** reruns only the plan step. The site is never rescanned, and no plan is fabricated.

## Prerequisites

- **Node.js 20+** (developed and verified on Node 22)
- **Network access:** scanning fetches real public sites, and the plan step calls OpenRouter.
- **An OpenRouter API key:** [Get one at openrouter.ai/keys](https://openrouter.ai/keys). The default model, `inclusionai/ling-3.0-flash`, is served via Novita and may require OpenRouter credits.

## Quick Start

```bash
git clone https://github.com/KAOS-CODM/site-rescue site-rescue
cd site-rescue
npm install
cp .env.example .env
# Windows: copy .env.example .env
# Edit .env and set: AI_API_KEY=your-key-here
npm start
```

Open [http://localhost:3000](http://localhost:3000), paste a public website URL, and press **Scan website**.

> **Your key lives only in `.env`, which is git-ignored. Never commit it or paste it into chat or code.**

Scanning works even before the key is added. Without a key, only the rescue-plan step fails, with a **Retry** button.

## What You'll See

1. **Start:** URL input with client-side validation. Invalid input never fires a request.
2. **Scanning:** Three honest phases tied to real requests: *Scanning website → Analyzing findings → Building rescue plan*, plus streamed crawl progress in real counters, such as *4 pages scanned · 8 URLs discovered · max 10 pages*. No invented percentages.
3. **Results:** The scanned URL, HTTP status, time-to-first-byte, unique scanner findings, and pages scanned, with **Rescan this site** and **New scan** actions that work without a refresh. The rescue plan appears in three priority sections. Each compact, expandable card keeps the layers apart:
   - **Scanner:** What was observed, which page it came from (`pageUrl` badge), and human-readable evidence, such as "Meta description element: not found." Full JSON evidence is available one expansion deeper.
   - **AI:** Explanation, why the issue matters, and a developer task, including acceptance criteria when provided.

Honesty rules are product requirements. Partial scans, such as when a probe cannot run or a discovered page cannot be fetched, are labeled as partial with the real reason. "Not checked" is never shown as "passed." URLs skipped by `robots.txt` or the origin boundary are listed separately because these are policy decisions, not missing evidence. A clean scan renders a deterministic empty plan without calling the AI.

## Install as an App (PWA)

Site Rescue is an installable Progressive Web App: the same web app, with no separate mobile codebase.

- **Install:** In Chrome or Edge, click the install icon in the address bar or select **Install Site Rescue** from the menu. On mobile, choose **Add to Home screen**. It launches in its own window as **Site Rescue** with the app icon.
- **Offline:** The app shell, including the start screen, styles, scripts, and icons, is cached by a small service worker so the app can open without a network connection.
- **Scans require a network connection.** The service worker never caches API responses. A scan or rescue-plan step attempted offline fails honestly with the normal error message. No stale or fabricated results.

## Configuration

Copy `.env.example` to `.env` and configure the variables below.

| Variable | Default | Purpose |
|---|---|---|
| `AI_PROVIDER` | `openrouter` | Must be `openrouter` or empty. Other values fail honestly. |
| `AI_BASE_URL` | `https://openrouter.ai/api/v1` | OpenAI-compatible chat-completions endpoint. |
| `AI_API_KEY` | *(your key)* | Required only for the rescue-plan step. |
| `AI_MODEL` | `inclusionai/ling-3.0-flash` | Chat model served via Novita. It costs a fraction of a cent per scan and may require OpenRouter credits. The previously pinned `:free` variant was delisted in October 2026. To try another free model, see the [OpenRouter models list](https://openrouter.ai/models/?max_price=0). Free `:free` routes can be rate-limited or return invalid JSON. The app has no automatic fallback or retry by design. |

## HTTP API

The application exposes HTTP endpoints for website scanning and rescue-plan generation. See the source code and technical specification for implementation details.

## Scope (Deliberately Out)

No database, accounts, scan history, or headless browser. Site Rescue uses a deliberately bounded same-origin crawl of up to 10 pages per scan, two requests with streamed progress, and in-memory results. Refreshing resets the interface to the start screen.

See the [Product Requirements](devpost/prd.md), [Technical Specification](devpost/spec.md), and [Project Scope](devpost/scope.md).

---

Docs: [OpenRouter API](https://openrouter.ai/docs)  
Source code: [KAOS-CODM/site-rescue](https://github.com/KAOS-CODM/site-rescue)
