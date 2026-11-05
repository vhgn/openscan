# openscan — product spec

> **openscan** (always lowercase) is an AI security reviewer for GitHub repositories. It reads your code like an attacker would and briefs you like a CISO: what matters, what is risky, what to do next.
>
> This file holds **what we want to build** (product requirements and decisions). The original customer brief is in [TASK.md](./TASK.md). How to run it is in [README.md](./README.md).

## Audience

Visitors are **engineering team leads and CTOs**. They don't want a 400-row scanner CSV. They want a short, ranked, defensible plan, and evidence (a PoC) when a finding is serious.

## Requirements (from the product owner)

1. **Installable GitHub App.** Read-only access to the repositories the user picks.
2. **Landing page + `/design`.** `/design` showed **landing page options** for the owner to pick from; the chosen one (Essay) is `/`, with a clear call to action ("Connect GitHub").
3. **Sign-in and onboarding:**
   1. Log in with GitHub (GitHub App user authorization).
   2. Onboarding: select repositories, or update the GitHub App's repository selection on github.com and come back.
   3. Log in with ChatGPT ([opencoredev/login-with-chatgpt](https://github.com/opencoredev/login-with-chatgpt)). Inference runs on the user's own ChatGPT plan. **The agent work runs as Codex Cloud tasks** in the user's Codex environment for each repo (via the user's ChatGPT session). Repos without an environment fall back to direct ChatGPT review.
   4. As soon as ChatGPT is connected, the AI **starts reading the selected repos** and **prepares questions**. It answers its own questions when later files settle them.
   5. **In parallel**, onboarding asks the user about **report frequency**, whether reports need **research behind them with a PoC**, focus areas, severity threshold, audience, and product context. These are saved as **user preferences**.
4. **After onboarding**, the user waits for the AI to finish reading (if it hasn't already), with visible progress.
5. **Very minimalist dashboard:** previous scans, previous findings, and **questions** (raised by the AI during reading or by later scans) that it couldn't answer by itself.

6. **Products.** Several repositories can be scanned as one **product**. The product has a **unified memory** so agents don't check the same things every time: shared facts and answers, files already reviewed at the same version, and validator verdicts on unchanged code.

## Design: Essay (chosen)

The owner reviewed six directions over three rounds on `/design` (Aurora; Signal, Ledger, Redline; Console, Essay, Guilloche) and chose **Essay**: text is the product.

- **Landing (`/`):** a short argument addressed to engineering leaders, set as a long read with margin notes and a sample brief inline. CTA: "Connect GitHub".
- **Signed-in pages:** the same system everywhere. The dashboard is *the brief* (a one-sentence headline, questions, open findings, products, earlier briefs). A scan report reads as a typeset document: headline, risk in a sentence, what matters, numbered next actions with effort in the margin, findings in fix order with the validator's note beside each, set-aside findings, questions, and a colophon of the methods used.
- **Look:** paper `#fbfbf9` and ink `#141414`; Newsreader for reading, Instrument Serif for display, Inter for labels and controls, JetBrains Mono for code. Emphasis is a cream wavy underline, never a highlighter fill. Severity is a word in small caps.
- `/design` now shows the chosen style and a sample brief (also linked from the landing page as "See a sample brief"). Screenshots are in [`docs/design/`](./docs/design) and [`docs/screens/`](./docs/screens).
- **Rendering:** only `/` is server-rendered; signed-in pages render in the browser.

## User flow

```
landing (/) ──CTA──▶ GitHub OAuth ──▶ onboarding
                                      1. repositories ──(install app / update selection on GitHub ↺)
                                      2. ChatGPT login ──▶ starts "understand" scans in background
                                      3. preferences   ◀── live panel: reading progress + AI questions
                                                          (AI self-answers; the user answers the rest)
                                      4. reading       ──▶ first security report auto-queued per repo
                                   ──▶ dashboard (the brief): questions · findings · products · earlier briefs
                                         ├─▶ /scans/:id: risk, what matters, next actions, findings, PoC, live log
                                         ├─▶ /products/:id: repositories and product memory
                                         └─▶ /settings: repositories, ChatGPT, Codex environments, preferences
```

## Preferences (saved per user)

Asked during onboarding and editable any time on `/settings`.

| Preference | Values | Effect |
| --- | --- | --- |
| `frequency` | on_push · daily · weekly · monthly · manual | Cron and webhook scheduling of security reports |
| `depth` | triage · standard · deep_poc | How many files are reviewed. `deep_poc` adds a PoC and fix verification to every critical/high finding |
| `focus` | code · dependencies · secrets · config · ci | File ranking and reviewer instructions. Turning off `dependencies` skips the OSV step |
| `minSeverity` | critical … info | Findings below the threshold are hidden on the dashboard (still stored) |
| `audience` | developer · security · executive | Tone of the summary |
| `context` | free text | Fed to every agent (exposure, data sensitivity, compliance) |

## Questions model

- The AI raises questions only when the answer **changes risk**: exposure, data sensitivity, auth model, tenancy, deployment.
- While it keeps reading, it **answers its own open questions** with evidence (file paths). These show as "AI answered".
- Anything still open appears on the dashboard. User answers become **known answers** that every later scan uses, so it never asks twice.

## Scanning methodology

Scans follow published agentic security skills from Trail of Bits, Cloudflare, Anthropic, NVIDIA, Cognition and OpenAI. The product-visible effects:
- Every serious finding is **independently validated**. The report shows it as ✓ verified, *needs validation* (which becomes a question for you) or rejected (kept with its reasoning).
- Findings show a **threat model** ("an attacker with X can Y to achieve Z") and a **source → sink trace**.
- **Push scans review the diff first** (differential review).
- Known-CVE **runtime checks** cover Node, PHP, GitLab and Brotli, and workflows that run AI agents get **CI/agent-config checks**.

Details are in [SKILLS.md](./SKILLS.md).

## Out of scope for this POC (next steps)

- Report delivery by email, Slack or GitHub issues (reports live on the dashboard for now).
- Reachability analysis for dependency CVEs (today the AI and the user's context calibrate this).
- Multi-user organizations and role-based access. Today every user sees only their own scans.
- Fix PRs ("open a PR with the patch").
