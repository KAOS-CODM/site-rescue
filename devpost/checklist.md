---
doc: checklist
status: approved
---
<!-- `status`: `draft` until the learner approves the plan ("looks good" counts). -->

# Build Checklist

Build mode: [learn or fast — record once chosen; carry forward on resume]

## Slices

- [x] **1. Start screen and project scaffold**
  Becomes usable: Site Rescue runs locally at http://localhost:3000 — the control-room start screen (header + tagline, headline, explanation, URL input, Scan website button, Scan → Prioritize → Fix hint) with working client-side URL validation. Nothing scanned yet.
  Why now: bootstrapping lives inside slice one; the repo baseline, static serving, and first real behavior get committed together so every later slice has somewhere to land. Includes the pending **Tailwind delivery verification** (official docs → simplest reproducible vanilla approach) before any styling is written.
  PRD ref: `prd.md > Starting a scan` (first + third criteria), `prd.md > Screens and Layout` (start screen), `prd.md > Look and Feel`
  Spec ref: `spec.md > Stack`, `spec.md > File Structure`, `spec.md > Look and Feel`, `spec.md > Where It Runs and How Someone Tries It`
  Build: Verify current Tailwind setup and choose the approach; create `package.json` + skeleton file tree per spec; `server.js` with static serving of `public/`; start-screen `index.html` styled per Look and Feel (amber accent shown at review); client-side empty/invalid URL validation with inline highlight + message (no request fired).
  Verify (mechanical): `npm start` boots with no errors; `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000` returns 200; response HTML contains the input, button, and step hint; no `/api` routes exist yet; Tailwind output present in page.
  Learner check: Open http://localhost:3000 — does the start screen match the control-room picture (and do you approve the amber accent)? Submit an empty/garbage URL — you should see the inline highlight and message, with no scan starting.
  Commit: `Add project scaffold and control-room start screen`

- [ ] **2. Scanner: SSRF-guarded fetch, parse, and 15 checks**
  Becomes usable: `POST /api/scan` returns real, evidence-backed findings (stable type IDs) for any public URL — and refuses private/internal targets before connecting. The scanner-as-source-of-truth half of the kernel, proven over HTTP.
  Why now: risk-first — manual redirect validation and SSRF rules are the trickiest logic in the spec; finding problems now is cheap. Also the kernel's evidence half, which must exist before any AI sees findings.
  PRD ref: `prd.md > Starting a scan` (criteria 3), `prd.md > Rescue plan results` (findings-are-real criterion), `prd.md > States and Boundaries` (invalid / unreachable / partial)
  Spec ref: `spec.md > POST /api/scan`, `spec.md > Scanner: fetchPage → parseHtml → checks`, `spec.md > checkConfig.js` (in File Structure), `spec.md > Important Failure Modes`
  Build: SSRF validator (http/https only, DNS pre-resolve, non-public IP rejection, manual redirect re-validation per hop); `fetchPage` (TTFB, 10s timeout, headers, final URL); robots.txt + favicon probes with `unavailableChecks`/`partial`; `parseHtml` with cheerio; the 15 checks with exact thresholds and stable type IDs; the four-part robots evidence model; wire `POST /api/scan` error contract.
  Verify (mechanical): curl a real public URL → valid findings JSON with structured evidence; curl `http://localhost:3000` and a private-IP URL → `invalid_url` with no request attempted (confirmed via server logs); a nonexistent domain → `unreachable`; run `parseHtml` + `checks` directly against inline fixture HTML (via `node -e`, no framework) and confirm representative checks fire and `alt=""` does not.
  Learner check: Run the provided curl command against a real site you know, read one finding's `evidence` block, and tell me whether it actually proves the problem it claims.
  Commit: `Add SSRF-guarded scanner with 15 evidence-backed checks`

- [ ] **3. AI adapter and /api/plan with strict validation**
  Becomes usable: `POST /api/plan` converts scanner findings into a validated rescue plan (summary + Fix now / Fix next / Improve later + developer tasks). The complete backend pipeline — evidence in, decisions out — works over HTTP.
  Why now: completes the kernel server-side (the AI-decisions half) before any results-screen UI, so the UI in slice 4 lands on a working pipeline. Includes the pending **Gemini structured-output verification** (official docs → exact request field format) before the adapter is written.
  PRD ref: `prd.md > AI rescue-plan layer`, `prd.md > States and Boundaries` (AI step fails → findings kept, retryable)
  Spec ref: `spec.md > AI adapter`, `spec.md > Plan validator`, `spec.md > External Services and Dependencies`, `spec.md > .env` block (in Stack)
  Build: Verify current official Gemini structured-output request format and record it; `planSchema.js`; `gemini.js` (env-configured: `AI_BASE_URL`/`AI_API_KEY`/`AI_MODEL`, no tools enabled, findings-only input); `adapter.js` boundary; `validatePlan.js` (shape + exactly-once finding-ID cross-check); `POST /api/plan` mapping every failure to `ai_failed`; `.env.example`.
  Verify (mechanical): with a key in your local `.env` (yours to add — never shown to me): run `generatePlan` on sample findings → structurally valid plan; run `validatePlan` against fixture outputs containing an invented ID, a missing ID, and a duplicate ID → all three rejected; missing key / non-200 → `ai_failed` response shape confirmed.
  Learner check: Add your free Gemini key to `.env`, run the provided curl against `/api/plan` with sample findings, and confirm the plan JSON prioritizes only the findings you sent. (You'll also confirm your live free-tier quota here — the build-day check from the spec.)
  Commit: `Add Gemini adapter with strict plan validation`

- [ ] **4. Full journey: scanning state → rescue plan results**
  Becomes usable: the complete PoC happy path on screen — type a real URL → honest step sequence → rescue plan with summary count, three priority sections, and expandable finding cards. This is the demo moment: raw evidence → prioritized plan → developer tasks.
  Why now: the kernel halves (scanner, AI) were proven separately; this joins them into one product the moment feedback can still shape the remaining polish.
  PRD ref: `prd.md > The Core Journey` (steps 2–7), `prd.md > Screens and Layout` (scanning + results), `prd.md > Finding cards`, `prd.md > Rescue plan results`
  Spec ref: `spec.md > Frontend`, `spec.md > The Core Journey Through the System`, `spec.md > Look and Feel`
  Build: `app.js` three-state machine (start → scanning → results); `/api/scan` then `/api/plan` calls with the step sequence tied to real request phases; render URL + summary (count = scanner findings); three sections with empty-section messages; expandable cards (title, priority, evidence + type ID, explanation, why it matters, developer task, acceptance criteria when present); partial-scan warning display.
  Verify (mechanical): scripted end-to-end run (node script driving the same two calls the frontend makes against a real public URL) → plan data shape matches the render contract (every card field populated, findings ↔ plan IDs align); server logs clean.
  Learner check: **(early checkpoint)** Run a real URL end to end in the browser and tell me: what did you notice, and what would you change? — your feedback shapes slices 5–6.
  Commit: `Wire end-to-end rescue plan journey`

- [ ] **5. Failure states and control-room polish**
  Becomes usable: every PRD failure path behaves honestly end-to-end (invalid URL, unreachable, internal error, partial-scan warning, AI-failure panel with working Retry) and the look-and-feel gets its final pass.
  Why now: the honesty rule is a product requirement, not garnish — harden it after the happy path exists and before the repo is dressed for shipping.
  PRD ref: `prd.md > States and Boundaries` (all states), `prd.md > Look and Feel`, `prd.md > Starting a scan` (criteria 3)
  Spec ref: `spec.md > Important Failure Modes`, `spec.md > Look and Feel`, `spec.md > Frontend`
  Build: map each API error to its specified UI state; AI-failure panel that keeps findings and re-calls only `/api/plan` on Retry; partial warning driven by `unavailableChecks`/`partial`; internal-error message with try-again; final visual pass (monospace evidence blocks, panel density, amber accent, avoid-list honored).
  Verify (mechanical): scripted fault runs — invalid URL, unreachable host, and a forced `ai_failed` (e.g., unset key) — each returns the exact spec'd error JSON; UI state classes confirmed present for each; re-verify slice 2's SSRF rejections still pass (regression).
  Learner check: Deliberately break it — bad URL, a dead host, then remove your key and retry the plan step — and confirm each screen tells the truth and offers one clear next action.
  Commit: `Handle all failure states with honest recovery`

- [ ] **6. README and reproduction pass**
  Becomes usable: a stranger can clone the repo, follow the README (install → `.env` → start → open), and run Site Rescue — the public-repo requirement of the submission, and the final integrated check.
  Why now: last slice, because a reproduction pass is only meaningful once every behavior it documents exists.
  PRD ref: `prd.md > What We're Building` (reproducible locally via setup instructions)
  Spec ref: `spec.md > Where It Runs and How Someone Tries It`, `spec.md > External Services and Dependencies`
  Build: README (what it does, prerequisites, exact start commands, free Gemini key signup link — no key in repo); finalize `.env.example`; `npm start` script; repo hygiene audit (no secrets, learner-profile ignored, only intended files staged).
  Verify (mechanical): simulate a fresh clone (copy working tree without `node_modules`/`.env` to a temp dir → `npm install` → `npm start` → 200 on `/`); grep the tree for key patterns and confirm `.env` absent; `git status` clean after commit.
  Learner check: Follow your own README top to bottom as if you'd never seen the project and confirm it gets you running — flag anything a stranger would trip on.
  Commit: `Add README and reproduction setup`

## Hands-on Checkpoints

- [ ] Early usable behavior explored — after slice 4 (first full end-to-end journey; feedback shapes slices 5–6)
- [ ] Final kick-the-tires exploration and feedback completed — after slice 6

## Final Review

- [ ] Final review complete — feedback resolved and learner confirms ready to ship

## Code Tour and App Map

- [ ] Learning activity complete — guided route, focused alternative, prior practice connected, or brief recap
- [ ] Optional edit and transfer reflection addressed — offered/declined/already covered/not applicable as appropriate
- [ ] `devpost/app-map.html` generated from finished code, checked, and shown, including a project-grounded practice to reuse

Activity and evidence: 
Route and stops: 
Edit outcome: 
Reflection: 
Activity mode: 

## Revisions
