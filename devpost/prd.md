---
doc: prd
status: approved
---
<!-- `status`: `draft` until the learner approves; "looks good" counts as approval. -->

# Site Rescue — Product Requirements

Paste a website URL, get a prioritized, evidence-backed rescue plan ending in concrete developer tasks — for **developers who need to know what's wrong with a site and what to fix first**.
Source: `scope.md > The Unique Kernel`, `Who It's For`.

## The Core Journey

Source: `scope.md > The Core Loop`, `What "Working" Looks Like`.

1. The user opens the locally running Site Rescue and lands on the start screen: small header (product name + tagline "Find what's broken. Fix what matters."), headline, a short explanation of what Site Rescue does, a prominent URL input with a **Scan website** button, and a small Scan → Prioritize → Fix hint. Nothing else.
2. They paste a public website URL and click **Scan website**. (Empty or invalid input: they stay on the start screen with the input highlighted and a short message that a valid public URL is required — no scan starts.)
3. The screen transitions to a focused scanning state: the URL being analyzed and an honest step sequence — *Scanning website → Analyzing findings → Building rescue plan* — with no fake precise percentages.
4. The scan finishes and the results screen becomes the main **rescue plan**: the scanned URL and a short summary including how many findings were identified — the count refers to **unique findings produced by the scanner**, not AI-generated recommendations (clarified by the learner).
5. Findings are grouped into three sections: **Fix now**, **Fix next**, **Improve later** — most important in Fix now.
6. Each finding is a card separating the problem from the action: short problem title, priority, affected URL / scan evidence, plain-English explanation, why it matters, a concrete developer task, and enough technical evidence for a developer to trace where it came from. Cards scan quickly; extra detail expands on demand — no wall of text.
7. The screen answers three questions immediately: *What did the scan find? What should I fix first? What exactly should I do about it?*
8. The demo's success moment: the visible transition from **raw website evidence → prioritized rescue plan → developer tasks**, end-to-end on a real public site, in about a minute.

Failure branches (step 2/3/4) are specified under States and Boundaries.

## Screens and Layout

One page with three states — no navigation, no accounts, no other surfaces.

1. **Start screen** — top-to-bottom: header (name + tagline), headline ("Turn a website audit into a rescue plan" character), short explanation ("paste a URL → scan → real issues → prioritized list of what to fix next"), prominent URL input + **Scan website** button (input makes clear a *public* website URL is needed), small Scan → Prioritize → Fix hint. Deliberately empty of statistics, settings, navigation, and accounts: an entrance to a focused tool, not a marketing site.
2. **Scanning state** — replaces the main content: the URL under analysis + step sequence (*Scanning website → Analyzing findings → Building rescue plan*). Communicates activity honestly without claiming measurable progress.
3. **Results / rescue plan screen** — top: scanned URL + short scan summary (finding count). Below: the three priority sections stacked, each containing finding cards; empty sections state that nothing is currently assigned to that priority rather than showing filler.

Movement between screens is state-driven by the user's actions (submit URL → scanning → results; errors return them to the input or offer retry).

## Look and Feel

Source: `scope.md > Inspiration & Identity`, refined in this interview.

- **Mood:** a focused technical control room — confident, precise, calm, slightly industrial. "Calm diagnosis followed by decisive action": the user should feel they're looking at a situation that's been analyzed and turned into a plan.
- **Dark-first:** near-black / deep charcoal background, strong off-white text.
- **One restrained accent color** for actions and important states — no rainbow of status colors. Priority sections get subtle visual distinctions while the interface stays cohesive. (Specific hue not chosen yet — `4-spec` may propose one.)
- **Typography:** clean, modern, slightly technical character. Strong headings, compact labels, highly readable body text. Professional developer tool, not an AI chatbot.
- **Structure:** information-dense but organized — structured panels, clear hierarchy, compact metadata, evidence blocks, expandable cards. Reference: modern developer tools and observability dashboards.
- **Explicitly avoid:** purple-gradient "AI app" styling, excessive glassmorphism, huge decorative hero sections, excessive rounded cards, neon cyberpunk/hacker aesthetics, and a wall of red warnings that makes everything look broken.

## Features and Behavior

### Starting a scan

The user enters a URL and starts the scan from the start screen.

- [ ] Start screen shows header, headline, explanation, URL input, Scan website button, and the Scan → Prioritize → Fix hint — and no statistics, settings, navigation, or accounts.
- [ ] Clicking **Scan website** with a valid URL transitions to the scanning state showing that URL.
- [ ] Empty or invalid input does not start a scan: user stays on the start screen, input is highlighted, short message explains a valid public website URL is required.

### Scanning in progress

- [ ] Scanning state shows the URL being analyzed and the step sequence *Scanning website → Analyzing findings → Building rescue plan*.
- [ ] Progress presentation is honest — no invented precise percentages.
- [ ] On success, the results screen appears with the scanned URL and a summary including the number of findings identified.

### Rescue plan results

- [ ] Findings are grouped into exactly three sections: **Fix now**, **Fix next**, **Improve later**, with the most important in Fix now.
- [ ] A section with no findings says nothing is currently assigned to that priority — never fabricated filler.
- [ ] The screen answers all three questions at a glance: what did the scan find, what should I fix first, what exactly should I do about it.
- [ ] Findings are actual observations from scanning the site, not canned data — the scanner's evidence is the source of truth for every finding.

### Finding cards

Each card separates the problem from the action and contains:

- [ ] Short problem title and its priority.
- [ ] The affected URL / relevant scan evidence.
- [ ] A plain-English explanation of what is wrong.
- [ ] Why the problem matters.
- [ ] A concrete developer task describing what should be done, with enough detail for a developer to act on.
- [ ] Enough technical evidence to trace where the finding came from.
- [ ] Cards are compact for fast scanning, with additional detail available by expanding — not a giant wall of text.

### AI rescue-plan layer

Per `scope.md > The Unique Kernel` (learner's clarification): the scanner is the source of truth; the AI receives only structured findings and evidence from the scanner, and explains, prioritizes, and converts them into developer tasks. It must not discover or invent findings.

- [ ] Every AI-generated explanation/task traces to a scanner finding — the plan is visibly a decision-layer over the evidence, never new problems.
- [ ] Explanations stay plain-English so a non-technical reader can follow the basics, even though the primary output targets developers.

## States and Boundaries

The learner's general rule: **never fabricate results, never silently fail, always give the user a clear next action** (*Try again*, *Enter another URL*, or *Review partial results*).

- **First use** — start screen exactly as described; nothing to load, no onboarding.
- **Empty or invalid URL** — no scan starts; stay on the start screen, highlight the input, short message that a valid public website URL is required.
- **Valid URL but website unreachable** — scan stops; clear error state explaining Site Rescue could not access the website; user can return to the input and try another site.
- **Blocked / timeout / partial load** — be honest. If enough evidence was collected, show a partial-scan warning and clearly mark that the rescue plan is based on incomplete evidence. Missing information is never presented as successfully checked. If not enough evidence, treat as a failure with a clear next action.
- **Unexpected internal error** — simple message that the scan could not be completed, with the option to try again.
- **AI step fails after a successful scan** — do not lose the scan results: show the collected findings, explain the rescue-plan step could not be completed, and offer a retry of the AI step.
- **AI provider/model** — deliberately unspecified at the PRD level (clarified by the learner); the choice belongs to `4-spec`, based on what is practical for the hackathon.
- **Empty priority section** — states nothing is currently assigned to that priority.
- **Persistence** — none in the PoC: no accounts, no scan history. Restarting the app returns to the start screen; results live in the current session only.

## Product Decisions

- **Developer-first, one experience** (`scope.md > Who It's For`) — prove the PoC for developers; plain-English explanations stay because they're cheap, but no second audience view yet.
- **Three named priority buckets** — Fix now / Fix next / Improve later, chosen over a sorted error list because it's easier to act on.
- **Scanner is source of truth; AI is decision layer only** — the learner's explicit boundary: AI must not discover or invent findings.
- **Honesty rule over polish** — no fake progress percentages, no fabricated findings, no silent failures, partial evidence labeled as partial.
- **Failure keeps evidence** — an AI-step failure shows the scan findings rather than discarding completed work.
- **Focused start screen** — entrance to a tool, not a marketing site: no stats, settings, navigation, or accounts.
- **Dark control-room aesthetic** with an explicit avoid-list (purple gradients, glassmorphism, hero sections, heavy rounding, neon, red-warning walls).
- **No auth, saved history, background jobs, or complex recovery flows** — outside the PoC.

## What We're Building

Everything the proof of concept must do to be complete:

- Start screen that gets a user from open → URL entered immediately.
- URL validation with clear inline feedback.
- An honest, staged scanning state for a real public URL.
- A real scan that produces evidence-backed findings across the named categories (SEO, technical, performance, UX, accessibility, basic structure) — a focused small set of checks, not exhaustive.
- An AI step that turns those verified findings into explanations, priorities, and developer tasks.
- The rescue-plan results screen: summary + three priority sections + expandable finding cards with all fields specified above.
- The full failure handling listed under States and Boundaries.
- The specified control-room look and feel.
- Runs locally; reproducible by another person from the public repository's setup instructions.

## Deferred From the POC

- **Dedicated business-owner view** (`scope.md > Later`) — would double the per-finding output; the developer path proves the kernel first.
- **Authentication / accounts** — no infrastructure cost should compete with proving the loop.
- **Saved scan history** — persistence across sessions isn't needed to demonstrate the flow.
- **Background jobs / long-running scan infrastructure** — a synchronous in-session scan is enough.
- **Complex recovery flows** — every failure only needs one clear next action, not resumable workflows.
- **Deployment** — demo video + local app + repo setup instructions satisfy the submission.

## Possible Later Enhancements

- Business-owner presentation layer focused on business impact.
- More and deeper audit checks; more categories.
- Scan history and comparing rescans over time.
- Deployment / SaaS concerns (accounts, billing, multi-site).

## Non-Goals

- **Two separate audience experiences per finding** — would double the work; developer-first proves the kernel. (`scope.md > Explicitly Cut`)
- **A huge number of audit checks** — the finish line is one reliable flow, not breadth. (`scope.md > Explicitly Cut`)
- **A full SaaS platform** — accounts/infrastructure don't prove the core loop. (`scope.md > Explicitly Cut`)
- **Reusing or renaming Site Scout code** — must be an original implementation in this new folder. (`scope.md > Explicitly Cut`)
- **A generic AI-app or marketing-site look** — see the Look and Feel avoid-list.

## Open Questions

- **Exact catalog of scan checks** (categories are named; the specific checks are not) — does not block this PRD; must be pinned in `4-spec` as a small starter catalog sized for the build.
- **Accent color hue** — not chosen; `4-spec` may propose one for the learner's agreement.
- **AI provider/model choice** — intentionally deferred by the learner to `4-spec`, to be decided based on what is practical for the hackathon.
