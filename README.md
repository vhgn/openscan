# openscan

**AI security review for your GitHub repositories.** openscan reads your code like an attacker would and briefs you like a CISO: what matters, what is risky, and what to do next. It is not a raw scanner dump.

Built with **TanStack Start** on **Cloudflare Workers**, **D1** (SQLite), and **Queues**. It is installed as a **GitHub App**. Everything runs on the user's own ChatGPT plan through **[login-with-chatgpt](https://github.com/opencoredev/login-with-chatgpt)** (no API keys). When the user has a **Codex Cloud environment** for a repo, the agent work runs as **Codex Cloud tasks**, with the full repository checked out in OpenAI's sandbox.

---

## Which `.md` is for what

| File | What it is | Read it when… |
| --- | --- | --- |
| **[README.md](./README.md)** (this file) | How to run locally, deploy, architecture, technical decisions, how coding agents were used | You want to run or change the code |
| **[TASK.md](./TASK.md)** | The original assignment brief (transcribed from `Agentic_poc.pdf`) plus a table mapping each requirement to where it lives | You want to know what was asked |
| **[PRODUCT.md](./PRODUCT.md)** | Product spec: audience, required flows, the chosen design (Essay), preferences, questions model, out of scope | You want to know what we're building and why |
| **[SKILLS.md](./SKILLS.md)** | The agentic security skills the scanner uses (Trail of Bits, Cloudflare, Anthropic, NVIDIA, Cognition, OpenAI): which stage each runs in, how it's applied, licenses, and how to update them | You want to know *how* a scan reasons, or to change the methodology |
| [`skills/vendor/`](./skills/vendor) | Verbatim copies of those skills, with upstream licenses and pinned commits (`SOURCES.md`) | Auditing or updating the methodology |
| [`docs/design/`](./docs/design) | The chosen Essay style: landing page and sample brief (also live on `/design`) | Seeing the design |
| [`docs/screens/`](./docs/screens) | Screenshots of landing → onboarding → brief → report → settings → product memory | Quick visual tour |
| [`.dev.vars.example`](./.dev.vars.example) | Every secret and env var, with comments | Setting up your environment |

---

## Run it locally

### Prerequisites

- Node.js 22+ and npm
- No Cloudflare account is needed for local dev. `wrangler` and the Vite plugin run D1, Queues and cron locally in `workerd`.

### 1. Quick start (demo mode, no GitHub App, about 3 minutes)

Demo mode signs you in as a fake user and links **public** repositories. It's the fastest way to see the whole flow.

```bash
npm install
```

```bash
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars`: set `SESSION_SECRET` and `LWC_SECRET` to random values (`openssl rand -hex 32`) and add `DEV_DEMO_LOGIN=1`. The `GITHUB_*` values can stay as placeholders in demo mode.

```bash
npm run db:migrate:local
```

```bash
npm run dev
```

Then open:

1. **http://localhost:3000/**: the landing page (Essay style; `/design` shows the style and a sample brief).
2. **http://localhost:3000/api/dev/login?repos=OWASP/NodeGoat**: demo sign-in with any public repos (comma-separated). It drops you into onboarding.
3. Select the repo, then either **Login with ChatGPT** (real AI) or **Skip** (deterministic heuristic engine), answer the preference questions, wait for reading, and land on the dashboard.

> Anonymous GitHub API calls are limited to 60/hour per IP. Demo mode falls back to jsDelivr and `raw.githubusercontent.com` for public repos. If you still hit limits, set `GITHUB_PUBLIC_TOKEN` (any read-only token) in `.dev.vars`.

### 2. Full local setup with a real GitHub App

1. **Expose localhost** so GitHub can reach your webhook and callback:

   ```bash
   npx cloudflared tunnel --url http://localhost:3000
   ```

   Put the printed `https://….trycloudflare.com` URL in `APP_URL` (in `.dev.vars`; it overrides `wrangler.jsonc`).

2. **Create a GitHub App** at https://github.com/settings/apps/new:

   | Setting | Value |
   | --- | --- |
   | Homepage URL | `APP_URL` |
   | Callback URL | `APP_URL/api/auth/github/callback` |
   | Expire user authorization tokens | ✅ (refresh tokens are handled) |
   | Request user authorization (OAuth) during installation | ⬜ leave off (we use the Setup URL) |
   | Setup URL | `APP_URL/api/github/setup`, with ✅ *Redirect on update* |
   | Webhook URL | `APP_URL/api/github/webhook` |
   | Webhook secret | a random string, also set as `GITHUB_WEBHOOK_SECRET` |
   | Repository permissions | **Contents: Read-only**, **Metadata: Read-only** |
   | Optional permission | **Code scanning alerts: Read-only** (imports CodeQL/Semgrep alerts; see SKILLS.md) |
   | Subscribe to events | **Push** (installation events are always delivered) |
   | Where can it be installed | Any account |

3. Generate a **private key** and copy the App ID, Client ID and a new Client secret into `.dev.vars`:

   ```
   GITHUB_APP_ID=…
   GITHUB_CLIENT_ID=…
   GITHUB_CLIENT_SECRET=…
   GITHUB_WEBHOOK_SECRET=…
   GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n…\n-----END RSA PRIVATE KEY-----"
   GITHUB_APP_SLUG=<the app's URL slug>
   ```

   The PKCS#1 key GitHub gives you works as-is; it's converted to PKCS#8 for WebCrypto at runtime.

4. Remove `DEV_DEMO_LOGIN`, restart `npm run dev`, open `APP_URL`, and click **Connect GitHub**.

### Useful local commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite + workerd on :3000 (pages, API, queue consumer, D1) |
| `npm test` | Unit tests (Node's built-in test runner): file ranking, dependency parsing, heuristics, runtime advisories, skill registry/vendoring, PEM conversion, JSON extraction |
| `AI_MODE=mock` in `.dev.vars` | Scripted fake LLM **and** fake Codex Cloud (tasks complete after two polls, about 1 minute), to exercise the whole agent path (recon → hunt → validate verdicts → questions → triage) without a ChatGPT account. Local testing only. |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | Production build into `dist/` |
| `npm run db:migrate:local` | Apply `migrations/*.sql` to the local D1 |
| `npx wrangler d1 execute openscan --local --command "select * from scans"` | Inspect local data |
| `curl "http://localhost:3000/cdn-cgi/handler/scheduled"` | Fire the cron (recurring reports + reviving stalled scans) |

---

## Deploy to Cloudflare

### With GitHub Actions (recommended)

[`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml) runs on every push and pull request:

- **check** (no secrets): `npm ci`, typecheck, unit tests, production build.
- **deploy** (only from `main`: a push, or *Run workflow* on `main`): loads secrets from **Bitwarden Secrets Manager** with Bitwarden's [`bitwarden/sm-action`](https://github.com/bitwarden/sm-action), creates the D1 database and queue if they don't exist (`scripts/ci/provision.mjs`), applies D1 migrations, builds, and runs `wrangler deploy` with the Worker secrets (`--secrets-file`) and production vars (`--var`) in one step (`scripts/ci/worker-secrets.mjs`). `DEV_DEMO_LOGIN` is always forced to `0`. The job uses the `production` environment, so you can add required reviewers there.

Setup, once:

1. In Bitwarden Secrets Manager, create a project (e.g. *openscan*) with these secrets:

   | Secret | Value |
   | --- | --- |
   | `CLOUDFLARE_API_TOKEN` | API token with *Workers Scripts: Edit*, *D1: Edit*, *Queues: Edit* (Account) |
   | `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID |
   | `APP_URL` | Public URL of the Worker, e.g. `https://openscan.<subdomain>.workers.dev` |
   | `SESSION_SECRET`, `LWC_SECRET` | `openssl rand -hex 32` each |
   | `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_WEBHOOK_SECRET` | From your GitHub App |
   | `GITHUB_APP_PRIVATE_KEY` | The `.pem` contents (multi-line is fine) |

2. Create a **machine account** with read access to that project and generate an **access token**. Add it to the repository as the Actions secret **`BWS_ACCESS_TOKEN`**. It is the only secret stored in GitHub.
3. The *Load secrets from Bitwarden* step maps each secret **ID** (not sensitive) to its env var name. If you recreate a secret in Bitwarden, update its ID there.
4. For the EU cloud (vault.bitwarden.eu), set the repository variable `BWS_CLOUD_REGION=eu`.

The first deploy creates the D1 database `openscan` and the queue `openscan-jobs`. To reuse an existing database, add a `D1_DATABASE_ID` secret to Bitwarden and to the mapping. Finally, point the GitHub App's URLs at `APP_URL`.

### By hand

```bash
npx wrangler login
```

```bash
npx wrangler d1 create openscan
```

Paste the printed `database_id` into `wrangler.jsonc`.

```bash
npx wrangler queues create openscan-jobs
```

```bash
npm run db:migrate:remote
```

Set each secret (you'll be prompted for the value):

```bash
for s in SESSION_SECRET LWC_SECRET GITHUB_APP_ID GITHUB_CLIENT_ID GITHUB_CLIENT_SECRET GITHUB_WEBHOOK_SECRET GITHUB_APP_PRIVATE_KEY; do npx wrangler secret put $s; done
```

Set `APP_URL` and `GITHUB_APP_SLUG` in `wrangler.jsonc` `vars`, then:

```bash
npm run deploy
```

Finally, point the GitHub App's URLs at the deployed `APP_URL`. Queues and cron triggers are available on the Workers Free plan.

---

## How it works

```
                      ┌──────────────────────── Cloudflare Worker (src/server.ts) ───────────────────────┐
 browser ── HTTPS ──▶ │ fetch: TanStack Start (SSR landing, client pages, server fns, /api/*)            │
                      │   /api/auth/github/*   GitHub App user OAuth  ──▶ D1 users/sessions              │
                      │   /api/github/webhook  installation / repos / push ──▶ D1, enqueue scans         │
                      │   /api/chatgpt/*       login-with-chatgpt handler (D1-backed session store)      │
                      │   /api/scans[/:id]     REST: start / list / poll scans                           │
                      │ queue:  one scan STEP per message ──▶ next step re-enqueued                      │
                      │ cron:   */15 → recurring reports per preference, revive stalled scans            │
                      └────────────┬───────────────────────────────┬──────────────────────┬──────────────┘
                                   │ installation token             │ proxyFetch (in-process)│
                              GitHub REST                    ChatGPT (user's plan)        OSV.dev
```

### Engines

| Engine | When | How the AI work runs |
| --- | --- | --- |
| `codex` | ChatGPT linked **and** the user has a [Codex Cloud environment](https://chatgpt.com/codex/settings/environments) for the repo | Three Codex Cloud tasks per scan, run in Ask mode (read-only): **recon** (profile + questions), **hunt** (review the whole repo), and a separate **validate** task, which is a fresh agent that tries to refute each finding. Tasks are polled every 30 s via delayed queue messages. Task links appear on the report. |
| `ai` | ChatGPT linked, no Codex environment (or a Codex task failed) | The Worker sends ranked file batches to ChatGPT through the login-with-chatgpt proxy. |
| `heuristic` | ChatGPT not linked, or `AI_MODE=heuristic` | Deterministic rules plus OSV and runtime advisories only. |

The Codex client (`src/lib/codex/cloud.ts`) uses the same ChatGPT backend endpoints as `codex cloud` (`/wham/environments/by-repo/…`, `/wham/tasks`). These are mirrored from `openai/codex` and are **not a documented public API**. Any Codex error (session expired, task failed or timed out, output not matching the JSON contract) logs a warning and falls back to the `ai` engine for that scan.

### Products and unified memory (`src/lib/products.ts`)

A **product** is a named group of repositories (for example `api` + `web` + `infra`). Each repo belongs to one product per user. Onboarding creates the first product. More can be created on `/products/new`, and **Scan product** scans every repo in it as one run (`scans.run_id`). Questions and answers are shared across the product, so the AI never asks the same thing per repo.

Every product has one **memory** (table `memory`), so agents don't re-check the same things:

| Kind | What is remembered | How agents use it |
| --- | --- | --- |
| `fact` | Profile facts (auth, deployment, data stores), `UNENFORCED:` assumptions, owner answers | Injected into every agent prompt (direct and Codex) as *established facts*, together with the profiles of the product's other repos for cross-repo trust boundaries |
| `reviewed` | `repo:path` at a git blob hash, with its outcome | Security scans **skip files reviewed at the same hash** within 30 days (14 for deep scans). Push-changed files are always re-reviewed. Codex tasks get the skip list. |
| `verdict` | Validator outcome for a claim, plus the file's blob hash | The same claim (same file and category, similar title) on **byte-identical code** keeps its earlier verdict: rejected stays dismissed, confirmed carries over without re-validation. Any code change triggers fresh validation. |

`/products/:id` shows the memory, with a hit counter per entry ("re-checks avoided"). Every entry, or a whole kind, can be forgotten.

### Scan engine (`src/lib/scanner/engine.ts`)

A resumable state machine. **Each queue message runs exactly one step** and stores its state in D1, so every Worker invocation stays short, retries are per step, and the UI gets fine-grained progress for free.

| Kind | Steps | Purpose |
| --- | --- | --- |
| `understand` | `init → read* → profile` | Onboarding "AI reads your repo": builds a repo profile (stack, entry points, data stores, auth, sensitive areas) and raises or self-answers questions |
| `security` | `init → deps → review* → validate* → triage` | The report. `deps` runs the deterministic signals: OSV, install scripts, Node/PHP/GitLab/Brotli runtime advisories, GitHub code-scanning import. `review` does batched AI code review (diff-first on push). `validate` sends each serious finding to an **independent validator** that confirms it, marks it needs-validation (which raises a question for you), or rejects it. `triage` ranks findings, writes *what matters* / *next actions*, and adds PoCs when `depth = deep_poc` |

**Agents** (`src/lib/ai/agents.ts`) are role prompts with zod output schemas: *reader*, *architect*, *reviewer*, *validator*, *triage lead*. Their methodology comes from published agentic security skills, distilled into playbooks (`src/lib/skills/playbooks.ts`). [SKILLS.md](./SKILLS.md) maps every skill to its stage. Calls go through the AI SDK (`streamText` + `Output.object`), with a tolerant JSON fallback. Static-analyzer hits are passed to the reviewer as hints to confirm or reject.

**Heuristic engine.** If the user skips ChatGPT, their session expires, or `AI_MODE=heuristic`, the same pipeline runs with deterministic rules (secrets, injection sinks, TLS off, CI risks) plus OSV. Scans never fail just because the AI is unavailable.

### Data model (`migrations/0001_init.sql`)

`users` · `sessions` · `installations` · `user_installations` · `repositories` (+ `profile_json`) · `user_repositories` (`selected`, Codex environment) · `products` · `product_repositories` · `memory` · `preferences` · `scans` (status/phase/progress/state/summary/skills/Codex tasks/product/run) · `scan_events` (activity log) · `findings` (severity, priority, PoC, fingerprint, verdict, trace, threat model, source, skills) · `questions` (open / auto_answered / answered) · `lwc_store` (ChatGPT SDK sessions) · `app_settings` (unused since the design was chosen; kept for future settings).

### REST API (cookie-authenticated)

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/api/scans` | `{ repoId, kind?: "security" \| "understand" }` → `202 { id, url }` |
| `GET` | `/api/scans` | List your scans |
| `GET` | `/api/scans/:id` | Status, phase, progress, event log, summary, findings, questions |
| `POST` | `/api/github/webhook` | GitHub App webhook (HMAC-verified) |
| `*` | `/api/chatgpt/*` | login-with-chatgpt routes (`login`, `status`, `session`, `models`, `responses`, …) |

---

## Technical decisions

- **TanStack Start on Workers.** One deployable gives pages, typed server functions for the UI, and plain API routes for REST and webhooks. The same Worker exports `queue` and `scheduled` handlers (`src/server.ts`), so there's no separate backend to run.
- **Selective SSR: only the landing page renders on the server.** `src/start.ts` sets `defaultSsr: false`; the root and `/` opt back in with `ssr: true`. The public page arrives as full HTML (fast first paint, crawlable), while signed-in pages render in the browser and load their data through server functions. That keeps the Worker's SSR work to one page, avoids hydration mismatches on live data (relative times, progress), and shows a quiet wordmark while a page loads.
- **One design system (Essay).** Tokens in `src/styles.css` (paper, ink, cream squiggle; Newsreader, Instrument Serif, Inter, JetBrains Mono) and primitives in `src/components/ui.tsx` (`Page`, `Masthead`, `Margin`, `SectionHead`, `Severity`, `Verdict`, `Progress`). Every page is a document: one 42rem reading column, notes in the right margin, severity as words rather than coloured pills.
- **D1 + Queues instead of a long-running job.** Workers are request-scoped, so a repo review is split into small idempotent steps. Steps are retried with backoff, and a cron revives anything stalled for more than 10 minutes.
- **The GitHub App reads code with installation tokens; user tokens are used only to discover repos.** Background scans never depend on a user being online. User tokens are AES-GCM encrypted at rest and refreshed automatically.
- **ChatGPT tokens stay server-side.** For background scans we store the user's *signed SDK session cookie* (encrypted) and replay it through `auth.proxyFetch()`, which calls the SDK handler in-process. The SDK's own session store is a D1 table, so sessions survive deploys. Codex Cloud task calls aren't behind the SDK proxy, so for those only, the Worker uses `dangerouslyGetTokens()` to get a fresh **short-lived access token + account id**. The refresh token stays redacted inside the SDK, and access tokens are never stored or logged.
- **Model discovery, not hardcoding.** The model comes from the account's `/models` list via a preference order (`PREFERRED_MODELS`).
- **Questions are first-class data.** They're deduplicated, capped per repo, answered by the AI with evidence or by the user, and fed into every later scan as known answers.
- **Bounded context.** Files are ranked for security relevance (`select-files.ts`, unit-tested), truncated per file, and batched by a character budget. Depth preference controls how many files are reviewed.
- **Real dependency data.** OSV.dev `querybatch` (free, no key) over lockfiles and manifests (npm, PyPI, Go, crates.io, RubyGems).
- **Methodology from vetted skills, not ad-hoc prompts.** Trail of Bits, Cloudflare, Anthropic, NVIDIA, Cognition and OpenAI skills are vendored with their licenses. Their methods run as agent playbooks; parts that can be made deterministic run as tested code (runtime advisories, agentic-actions rules). A separate validator agent tries to refute every serious finding before it reaches the report.
- **Graceful degradation everywhere:** heuristic engine without AI, jsDelivr/raw CDN fallback for public demo repos, structured-output → plain-JSON fallback for models.

### Known limitations

- **Codex Cloud** uses undocumented ChatGPT backend endpoints, the same ones `codex cloud` uses, so they may change. Each user must create a Codex environment per repository at chatgpt.com/codex. The Codex path was verified end to end with `AI_MODE=mock` (scripted fake tasks), not against a real ChatGPT account.

- Only some of the end-to-end flow could be verified in the build sandbox. **Verified:** demo login, repo selection, preferences, the understand scan, the security scan with real OSV results, the dashboard, the report, the REST API, cron, the production build, and `wrangler deploy --dry-run`. The ChatGPT SDK worked up to OpenAI's device-code step. **Not verified (needs real accounts):** the ChatGPT device-login approval and AI-mode scans, GitHub App install/OAuth, and webhooks.
- Large monorepos: only the top-ranked files are reviewed (30 to 50 per scan by depth). Truncated trees are noted in scan state.
- Dependency findings are not reachability-checked yet. The AI triage and the user's context calibrate their severity.

---

## How coding agents were used

This POC was built with **Claude Code** as a pair programmer, in a single session:

1. **Brief → spec.** The agent read the assignment PDF and the product owner's notes and turned them into `TASK.md` and `PRODUCT.md`.
2. **Research before code.** It cloned `opencoredev/login-with-chatgpt` and read its docs, skill file and source (`proxyFetch`, session store, request normalization). That's how it arrived at the "replay the signed cookie through `proxyFetch`" approach for background inference without exporting tokens. It scaffolded TanStack Start with `create-cloudflare` to get the canonical Workers setup.
3. **Design loop with the owner.** It built `/design` options in several rounds (terminal, editorial, banknote-engraving and others), screenshotted them with Playwright and published them for comments. The owner chose **Essay**, and the agent then rebuilt every signed-in page in that system.
4. **Verification.** `tsc`, unit tests (which caught a real ranking bug: test files outranked application code), a production build plus `wrangler deploy --dry-run`, and a Playwright-driven end-to-end run of onboarding → reading → report (screenshots in `docs/screens/`). Runtime issues found this way and fixed: a duplicate React instance during SSR dep optimization, a hydration mismatch, and GitHub anonymous rate limits.
5. **Human in the loop.** The product owner made the product decisions (flow, audience, naming, design choice). Anything needing real credentials (GitHub App, ChatGPT) is documented above rather than faked.
