---
doc: scope
status: approved
---
<!-- `status` is the progress state every skill reads. `draft` until the learner approves the displayed plan. -->

# Site Rescue

Paste a website URL, get a prioritized, evidence-backed rescue plan: what to fix, why it matters, in what order — ending in developer-ready tasks.

## The Unique Kernel

Audit tools dump a huge list of warnings; Site Rescue turns **verified scan evidence into decisions**. Every priority lands in Fix now / Fix next / Improve later, with a plain-English explanation, why it matters, and a concrete developer task — "here are the things you should actually fix, in this order." AI explains and prioritizes, but the evidence comes from the scan; it never invents problems.

**AI/evidence boundary (clarified by the learner):** The scanner is the source of truth for website findings. The AI receives only the structured findings and evidence produced by the scanner and is responsible for explaining, prioritizing, and converting them into developer tasks. It must not be responsible for discovering or inventing findings.

Identity line against the learner's other project: *Site Scout finds and measures problems; Site Rescue turns evidence into decisions and actionable work.* Built from scratch as an original project, not a renamed Site Scout.

## Who It's For

**Primary (the PoC is proved for them): a developer who needs to understand what's wrong with a website and what to work on next.** They'd use the evidence + task detail to start working immediately. Today they get a traditional audit: a huge warning list with no order and no tasks.

**Secondary (not built in the PoC): a non-technical small business owner** who wants to understand what's wrong and why it matters. The plain-English explanations stay in the PoC because they're cheap and matter to the learner — but there's no second, dedicated experience yet.

## The Core Loop

Open the app → paste a real public URL → start the scan → the app inspects that site and produces actual findings with evidence → AI turns the verified findings into the rescue plan → the screen shows findings grouped **Fix now / Fix next / Improve later**, each important one showing evidence, plain-English explanation, why it matters, priority, and a concrete developer task.

The user comes back because it answers the question audit tools leave open: *what should I fix next?*

## Inspiration & Identity

A **control room for fixing a website** — a clear list of what to fix now, what to fix next, and what can wait. Decisive and actionable rather than an alarming wall of warnings: "someone looked at the audit and said, here's what you should actually fix, in this order."

## Why This Matters to the Learner

Their stated learning goal: *"how to turn an idea into a clear technical plan before letting the agent build it"* — this project is the vehicle for practicing that. Personal stake in the product too: *"I don't just want to tell users what's wrong. I want to tell them what to fix, why it matters, how urgent it is, and what work should be done next."* Also a chance to build a genuinely new, original project in an empty folder, separate from Site Scout.

## What "Working" Looks Like

Open the locally running app, enter a real public website URL, run a scan, and watch the full transition: **raw website evidence → prioritized rescue plan → developer tasks**, end-to-end.

- Real findings the app actually observed on that site (not canned data)
- Findings grouped into Fix now / Fix next / Improve later
- Each important finding shows: scan evidence, plain-English explanation, why it matters, priority, and a concrete developer task with enough detail to act on
- The AI's plan is built from those verified findings — it doesn't invent website problems

The "oh, that's cool" beat: the moment raw evidence turns into an ordered, actionable plan on screen. No deployment — a local app is fine as long as another person can follow setup instructions from the public repository and reproduce it. The demo video shows this flow in about a minute.

## The POC Boundary

In, stated tightly:

- One reliable end-to-end flow: **real URL → real scan findings → AI prioritization/explanation → actionable rescue plan → developer tasks**
- Developer-first output per finding: evidence, plain-English explanation, why it matters, priority, concrete task
- Three priority buckets: Fix now / Fix next / Improve later
- A focused, small set of scan checks across the categories they named (SEO, technical, performance, UX, accessibility, basic structure) — enough to prove the flow, not exhaustive
- Local run + reproducible setup from the public repo

## Later

- Dedicated business-owner view: strips technical detail, focuses on business impact
- More and deeper audit checks
- Deployment / SaaS platform concerns (accounts, billing, multi-site history)

## Explicitly Cut

- **Two separate audience experiences per finding** — dual output would quietly double the work; the developer path proves the kernel first. Plain-English explanations stay.
- **A huge number of audit checks** — "the finish line is not a huge number of audit checks"; breadth doesn't prove prioritization.
- **Deployment** — demo video + local app + repo setup instructions are enough for the submission.
- **Full SaaS platform** — accounts/infrastructure don't prove the core loop.
- **Reusing or renaming Site Scout code** — Site Rescue must be an original implementation in this new folder, per the learner's explicit requirement.
