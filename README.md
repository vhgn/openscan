# openscan

**AI security review for your GitHub repositories.** openscan reads your code like an attacker would and briefs you like a CISO: what matters, what is risky, and what to do next. It is not a raw scanner dump.

Built with **TanStack Start** on **Cloudflare Workers**, **D1** (SQLite), and **Queues**. It is installed as a **GitHub App**. Everything runs on the user's own ChatGPT plan through **[login-with-chatgpt](https://github.com/opencoredev/login-with-chatgpt)** (no API keys). When the user has a **Codex Cloud environment** for a repo, the agent work runs as **Codex Cloud tasks**, with the full repository checked out in OpenAI's sandbox.

**Production:** [https://openscan.underscore.am](https://openscan.underscore.am) (this is the production `APP_URL`). MCP endpoint: `https://openscan.underscore.am/mcp`.

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
   | `APP_URL` | Public URL of the app. Production: `https://openscan.underscore.am` |
   | `SESSION_SECRET`, `LWC_SECRET` | `openssl rand -hex 32` each |
   | `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_WEBHOOK_SECRET` | From your GitHub App |
   | `GITHUB_APP_PRIVATE_KEY` | The `.pem` contents (multi-line is fine) |

2. Create a **machine account** with read access to that project and generate an **access token**. Add it to the repository as the Actions secret **`BWS_ACCESS_TOKEN`**. It is the only secret stored in GitHub.
3. The *Load secrets from Bitwarden* step maps each secret **ID** (not sensitive) to its env var name. If you recreate a secret in Bitwarden, update its ID there.
4. For the EU cloud (vault.bitwarden.eu), set the repository variable `BWS_CLOUD_REGION=eu`.

The first deploy creates the D1 database `openscan` and the queue `openscan-jobs`. To reuse an existing database, add a `D1_DATABASE_ID` secret to Bitwarden and to the mapping. Finally, point the GitHub App's URLs at `APP_URL`.

Production URLs (`APP_URL` = `https://openscan.underscore.am`):

| What | URL |
| --- | --- |
| App / GitHub App homepage | `https://openscan.underscore.am` |
| GitHub App callback URL | `https://openscan.underscore.am/api/auth/github/callback` |
| GitHub App setup URL | `https://openscan.underscore.am/api/github/setup` |
| GitHub App webhook URL | `https://openscan.underscore.am/api/github/webhook` |
| MCP server | `https://openscan.underscore.am/mcp` |
| OAuth issuer (MCP) | `https://openscan.underscore.am` |

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
                      │   /mcp                 MCP server (Bearer token) ──▶ same read models/actions    │
                      │   /oauth/*, /.well-known/oauth-*  OAuth 2.1 server for MCP clients ──▶ D1        │
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

How one Codex task runs (`runCodexTask` in `src/lib/scanner/engine.ts`):

```mermaid
sequenceDiagram
    autonumber
    participant E as Scan engine (phase codex_ROLE)
    participant CH as chatgpt.ts
    participant LWC as login-with-chatgpt handler
    participant CX as Codex Cloud (/wham)
    participant D as D1
    participant Q as Queue

    E->>CH: codexClientFor(user)
    CH->>LWC: dangerouslyGetTokens (synthetic request with the stored session cookie)
    LWC-->>CH: short-lived access token and account id, never stored
    E->>E: build prompt for recon, hunt or validate: profile, known answers, memory skip list, changed files
    E->>CX: POST /wham/tasks with environment, branch, prompt, Ask mode
    CX-->>E: task id
    E->>D: save task id in state and codex_tasks_json (linked from the report)
    E->>Q: enqueue phase codex_ROLE_wait with a 30s delay

    loop every 30s until the task finishes or 45 min pass
        Q->>E: runStep
        E->>CX: GET /wham/tasks/ID
        CX-->>E: pending, in_progress, completed or failed
        E->>Q: re-enqueue with a 30s delay
    end

    alt completed and the output passes the zod contract
        E->>D: save findings, answers, questions or verdicts
        E->>E: advance to the next phase
    else failed, timed out, invalid JSON or no ChatGPT session
        E->>D: engine becomes ai (or heuristic), file cursor reset, warning logged
        E->>E: continue in read, review or validate on the direct engine
    end
```

### Products and unified memory (`src/lib/products.ts`)

A **product** is a named group of repositories (for example `api` + `web` + `infra`). Each repo belongs to one product per user. Onboarding creates the first product. More can be created on `/products/new`. Questions and answers are shared across the product, so the AI never asks the same thing per repo.

**Products own scans.** A review is a **product scan** (table `product_scans`), and it owns one repository scan per member repo (`scans.product_scan_id`). The brief's *Run a fresh review of …* picker lists products, scheduled reports run once per product, and the onboarding report is the product's first review. Each member repo has a **scan on push** switch (`product_repositories.scan_on_push`, on the product page): a push to its default branch starts a product scan with a differential review of only that repo; its siblings reach the agents through product memory. Choosing *On every push* in preferences turns the switch on for every repo, and moving away from it turns them all off. `POST /api/scans {productId}` reviews a product; `{repoId}` reviews one repo inside its product.

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

How one queue message is processed (`runStep`):

```mermaid
sequenceDiagram
    autonumber
    participant Q as Queue openscan-jobs
    participant W as Worker queue handler
    participant E as engine.runStep
    participant D as D1
    participant P as Product memory
    participant X as Step (understand or security)

    Q->>W: message with scanId (batch size 1)
    W->>E: runStep(scanId)
    E->>D: load scan, user and repo
    alt scan missing, completed or failed
        E-->>W: return without doing anything
    end
    E->>D: if queued, mark running
    E->>D: load preferences
    E->>P: find the repo's product, or create a default one
    E->>E: resolveEngine picks codex, ai or heuristic (kept for the whole scan)
    opt AI engine
        E->>P: memoryContext (facts and sibling repo profiles)
        E->>E: add the memory to the prompt context
    end
    E->>X: run the step for scan.phase
    X-->>E: next phase, progress, optional delay
    E->>D: save phase, progress, state_json and skills, reset attempts
    alt next phase is done
        E->>D: mark completed
        E->>E: a finished understand scan starts the first security scan
    else more work
        E->>Q: enqueue the same scan (30s delay while polling Codex)
    end
    W->>Q: ack

    Note over E,X: When a step throws
    X--xE: error
    E->>D: log the error as a scan event
    alt third failed attempt
        E->>D: mark failed
    else
        E->>D: attempts + 1
        E->>Q: enqueue again after 10s x attempts
    end
    Note over W: If runStep itself crashes, the message is retried after 15s
```

Each state below is `scans.phase`. A self-loop is one more queue message for the same phase (the next file batch, the next two findings to validate, or another Codex poll). If a step throws, the same phase is retried after 10 s × attempt; after 3 attempts the scan is marked `failed`. The cron also re-enqueues any queued or running scan with no update in 10 minutes.

**`understand`**

```mermaid
stateDiagram-v2
    [*] --> queued
    queued --> init
    init --> read : engine ai or heuristic
    init --> codex_recon : engine codex
    note right of init
        fetch git tree (jsDelivr fallback for demo repos)
        select top 30 files
        heuristic questions when there is no LLM
    end note

    read --> read : next batch, up to 6 files and 45k chars
    note right of read
        AI reader agent with the recon playbook
        collects notes, answers its own open questions,
        raises up to 3 new questions per batch
        heuristic mode keeps README and manifests
    end note
    read --> profile : no files left

    codex_recon --> codex_recon_wait : start Codex task (Ask mode)
    codex_recon --> read : no ChatGPT session (fallback)
    codex_recon_wait --> codex_recon_wait : poll every 30s, timeout 45 min
    codex_recon_wait --> done : completed with valid JSON
    codex_recon_wait --> read : failed, timed out or bad JSON (fallback)

    profile --> done
    note right of profile
        profile agent or heuristicProfile
        writes repositories.profile_json
        stores profile facts in product memory
    end note
    done --> [*]
```

**`security`**

```mermaid
stateDiagram-v2
    [*] --> queued
    queued --> init
    init --> deps
    note right of init
        fetch git tree, record commit sha
        push scans fetch changed files and put them first
        product memory skips files reviewed at the same blob hash
        select 20, 35 or 50 files by depth, boost sensitive areas
        pick lockfiles and runtime files
    end note

    deps --> review : engine ai or heuristic
    deps --> codex_hunt : engine codex
    note right of deps
        deterministic signals
        OSV.dev for npm, PyPI, Go, crates.io, RubyGems
        Brotli copies and install scripts
        Node, PHP and GitLab runtime advisories
        GitHub code-scanning alerts import
    end note

    review --> review : next batch
    note right of review
        heuristic hits passed to the AI as hints to verify
        reviewer agent with the hunt playbook (differential on push)
        findings deduped by fingerprint, remembered verdicts reused
        reviewed files recorded with their blob hash
    end note
    review --> validate : AI engine and serious findings queued
    review --> triage : heuristic, or nothing to validate

    validate --> validate : next 2 findings
    note right of validate
        independent validator agent with fresh context
        fp-check gates and triage brocards
        confirmed, needs_validation (raises a question)
        or rejected (dismissed)
        verdict remembered with the file blob hash
    end note
    validate --> triage : queue empty

    codex_hunt --> codex_hunt_wait : start hunt task
    codex_hunt --> review : no ChatGPT session (fallback)
    codex_hunt_wait --> codex_hunt_wait : poll every 30s
    codex_hunt_wait --> codex_validate : findings to validate
    codex_hunt_wait --> triage : nothing to validate
    codex_hunt_wait --> review : failed, timed out or bad JSON (fallback)

    codex_validate --> codex_validate_wait : start validate task
    codex_validate --> validate : no ChatGPT session (fallback)
    codex_validate_wait --> codex_validate_wait : poll every 30s
    codex_validate_wait --> triage : verdicts applied
    codex_validate_wait --> validate : Codex failure, validate directly

    triage --> done
    note right of triage
        AI triage lead ranks, re-scores and drops false positives
        never dismisses a validator-confirmed finding
        writes PoCs when depth is deep_poc
        heuristic mode sorts by severity x confidence
        writes summary_json with stats and validation counts
    end note
    done --> [*]
```

**Agents** (`src/lib/ai/agents.ts`) are role prompts with zod output schemas: *reader*, *architect*, *reviewer*, *validator*, *triage lead*. Their methodology comes from published agentic security skills, distilled into playbooks (`src/lib/skills/playbooks.ts`). [SKILLS.md](./SKILLS.md) maps every skill to its stage. Calls go through the AI SDK (`streamText` + `Output.object`), with a tolerant JSON fallback. Static-analyzer hits are passed to the reviewer as hints to confirm or reject.

**Heuristic engine.** If the user skips ChatGPT, their session expires, or `AI_MODE=heuristic`, the same pipeline runs with deterministic rules (secrets, injection sinks, TLS off, CI risks) plus OSV. Scans never fail just because the AI is unavailable.

### Data model (`migrations/`)

```mermaid
erDiagram
    USERS ||--o{ SESSIONS : "authenticates"
    USERS ||--o| PREFERENCES : "has"
    USERS ||--o{ USER_INSTALLATIONS : "linked to"
    INSTALLATIONS ||--o{ USER_INSTALLATIONS : "shared by"
    INSTALLATIONS ||--o{ REPOSITORIES : "grants"
    USERS ||--o{ USER_REPOSITORIES : "sees"
    REPOSITORIES ||--o{ USER_REPOSITORIES : "visible to"
    USERS ||--o{ PRODUCTS : "owns"
    PRODUCTS ||--o{ PRODUCT_REPOSITORIES : "groups"
    REPOSITORIES ||--o{ PRODUCT_REPOSITORIES : "member of"
    PRODUCTS ||--o{ MEMORY : "remembers"
    PRODUCTS ||--o{ PRODUCT_SCANS : "owns"
    PRODUCT_SCANS ||--o{ SCANS : "runs one per repo"
    USERS ||--o{ SCANS : "runs"
    REPOSITORIES ||--o{ SCANS : "scanned by"
    PRODUCTS |o--o{ SCANS : "scoped to"
    SCANS ||--o{ SCAN_EVENTS : "logs"
    SCANS ||--o{ FINDINGS : "produces"
    REPOSITORIES ||--o{ FINDINGS : "located in"
    USERS ||--o{ QUESTIONS : "is asked"
    SCANS |o--o{ QUESTIONS : "raises"
    REPOSITORIES |o--o{ QUESTIONS : "about"
    PRODUCTS |o--o{ QUESTIONS : "shared across"
    USERS ||--o{ OAUTH_REQUESTS : "approves"
    USERS ||--o{ OAUTH_CODES : "receives"
    USERS ||--o{ OAUTH_GRANTS : "connects"
    OAUTH_CLIENTS ||--o{ OAUTH_REQUESTS : "asks"
    OAUTH_CLIENTS ||--o{ OAUTH_CODES : "redeems"
    OAUTH_CLIENTS ||--o{ OAUTH_GRANTS : "holds"
    OAUTH_GRANTS ||--o{ OAUTH_TOKENS : "issues"

    USERS {
        TEXT id PK
        INTEGER github_id UK
        TEXT login
        TEXT gh_token_enc "AES-GCM"
        TEXT gh_refresh_enc "AES-GCM"
        TEXT chatgpt_cookie_enc "AES-GCM signed LWC cookie"
        TEXT onboarding_step
        INTEGER onboarded_at
    }
    SESSIONS {
        TEXT id PK "sha256 of cookie token"
        TEXT user_id FK
        INTEGER expires_at
    }
    PREFERENCES {
        TEXT user_id PK
        TEXT json "frequency, depth, focus, context"
    }
    INSTALLATIONS {
        INTEGER id PK "GitHub installation id"
        TEXT account_login
        TEXT account_type
        TEXT repository_selection
    }
    USER_INSTALLATIONS {
        TEXT user_id PK
        INTEGER installation_id PK
    }
    REPOSITORIES {
        INTEGER id PK "negative = public demo repo"
        INTEGER installation_id
        TEXT full_name UK
        TEXT default_branch
        TEXT profile_json "AI repo profile"
        INTEGER understood_at
    }
    USER_REPOSITORIES {
        TEXT user_id PK
        INTEGER repo_id PK
        INTEGER selected
        TEXT codex_env_id
        INTEGER codex_checked_at
    }
    PRODUCTS {
        TEXT id PK
        TEXT user_id FK
        TEXT name
    }
    PRODUCT_REPOSITORIES {
        TEXT product_id PK
        INTEGER repo_id PK
        INTEGER scan_on_push "a push starts a product scan"
    }
    PRODUCT_SCANS {
        TEXT id PK
        TEXT product_id FK
        TEXT user_id FK
        TEXT trigger "onboarding, manual, schedule, push"
        INTEGER push_repo_id "push: the repo pushed"
        TEXT commit_sha "push: head commit"
    }
    MEMORY {
        TEXT id PK
        TEXT product_id FK
        INTEGER repo_id
        TEXT kind "fact, reviewed, verdict"
        TEXT key "unique per product and kind"
        TEXT content_hash "git blob sha"
        INTEGER hits
    }
    SCANS {
        TEXT id PK
        TEXT kind "understand, security"
        TEXT trigger "onboarding, manual, schedule, push"
        TEXT status "queued, running, completed, failed"
        TEXT phase "state machine cursor"
        INTEGER progress
        TEXT engine "codex, ai, heuristic"
        TEXT commit_sha
        TEXT state_json "resumable scan state"
        TEXT summary_json
        TEXT codex_tasks_json
        TEXT product_id
        TEXT product_scan_id "the product scan that owns it"
        INTEGER attempts
    }
    SCAN_EVENTS {
        INTEGER id PK
        TEXT scan_id FK
        TEXT level
        TEXT message
    }
    FINDINGS {
        TEXT id PK
        TEXT scan_id FK
        TEXT severity
        TEXT category
        TEXT title
        TEXT file
        TEXT fingerprint "sha256 of repo, category, title, file"
        TEXT verdict "confirmed, needs_validation, rejected"
        TEXT source "ai-review, heuristic, osv, runtime-advisory, code-scanning"
        INTEGER priority
        TEXT poc
        TEXT trace_json
        TEXT status "open, dismissed"
    }
    QUESTIONS {
        TEXT id PK
        TEXT user_id FK
        TEXT question
        TEXT status "open, auto_answered, answered, dismissed"
        TEXT answer
        TEXT answer_source "ai, user"
        TEXT product_id
    }
    LWC_STORE {
        TEXT key PK "ChatGPT SDK session store"
        TEXT value
        INTEGER expires_at
    }
    APP_SETTINGS {
        TEXT key PK
        TEXT value
    }
    OAUTH_CLIENTS {
        TEXT id PK "client_id"
        TEXT secret_hash "sha256, NULL for public clients"
        TEXT redirect_uris "JSON array"
        TEXT token_endpoint_auth_method
        TEXT source "dcr, metadata_document"
    }
    OAUTH_REQUESTS {
        TEXT id PK
        TEXT user_id FK
        TEXT client_id
        TEXT params_json
        INTEGER expires_at "10 min"
    }
    OAUTH_CODES {
        TEXT id PK "sha256 of code"
        TEXT client_id
        TEXT user_id FK
        TEXT code_challenge "PKCE S256"
        TEXT scope
        TEXT resource
        INTEGER expires_at "5 min, single use"
    }
    OAUTH_GRANTS {
        TEXT id PK
        TEXT user_id FK
        TEXT client_id
        TEXT scope
        TEXT resource "APP_URL/mcp"
        INTEGER last_used_at
    }
    OAUTH_TOKENS {
        TEXT id PK "sha256 of token"
        TEXT grant_id FK
        TEXT kind "access 1h, refresh 30d rotated"
        TEXT scope
        INTEGER expires_at
    }
```

`scans.product_id`, `scans.product_scan_id` and `questions.product_id` were added by `ALTER TABLE` without a foreign key; the link to `products` is kept in app code. Likewise `client_id` in the `oauth_*` tables has no foreign key to `oauth_clients`. `lwc_store` and `app_settings` stand alone.

`users` · `sessions` · `oauth_clients` · `oauth_requests` · `oauth_codes` · `oauth_grants` · `oauth_tokens` (MCP OAuth, `0005_mcp_oauth.sql`) · `installations` · `user_installations` · `repositories` (+ `profile_json`) · `user_repositories` (`selected`, Codex environment) · `products` · `product_repositories` (`scan_on_push`) · `product_scans` (one review of a product: trigger, pushed repo and commit) · `memory` · `preferences` · `scans` (one repository job: status/phase/progress/state/summary/skills/Codex tasks/product/product scan) · `scan_events` (activity log) · `findings` (severity, priority, PoC, fingerprint, verdict, trace, threat model, source, skills) · `questions` (open / auto_answered / answered) · `lwc_store` (ChatGPT SDK sessions) · `app_settings` (unused since the design was chosen; kept for future settings).

### Identity, tokens and secrets

```mermaid
sequenceDiagram
    autonumber
    actor U as User browser
    participant M as MCP client
    participant W as Worker
    participant GH as GitHub
    participant D as D1
    participant LWC as login-with-chatgpt (/api/chatgpt)
    participant OAI as ChatGPT

    rect rgb(235,240,255)
    Note over U,GH: Sign in with the GitHub App
    U->>W: GET /api/auth/github/login (optional ?next=)
    W-->>U: redirect to GitHub, state cookie and next cookie
    U->>GH: authorize
    GH-->>U: redirect to /api/auth/github/callback with code and state
    U->>W: callback (state must match the cookie)
    W->>GH: exchange code for user token and refresh token
    W->>GH: GET /user
    W->>D: upsert user, store tokens AES-GCM encrypted
    W->>GH: list installations and repositories
    W->>D: installations, repositories, user links
    W->>D: session row keyed by sha256 of the cookie token, 30 days
    W-->>U: openscan_session cookie (HttpOnly, SameSite Lax), redirect to next or landing
    end

    rect rgb(235,255,240)
    Note over U,GH: App install and webhooks
    U->>GH: install the App on repositories
    GH-->>U: redirect to /api/github/setup
    U->>W: setup resyncs repositories
    GH->>W: POST /api/github/webhook (HMAC verified): installation, installation_repositories, push
    W->>D: keep installations and repositories in sync, start push scans
    end

    rect rgb(255,245,230)
    Note over U,OAI: Link ChatGPT (the user's own plan, no API keys)
    U->>LWC: device-code login
    LWC->>OAI: OAuth
    LWC->>D: SDK session in lwc_store
    LWC-->>U: signed lwc_session cookie
    U->>W: linkChatGPTSession server function
    W->>D: users.chatgpt_cookie_enc = AES-GCM(lwc cookie)
    end

    rect rgb(245,235,255)
    Note over W,OAI: Background work during a scan (user offline)
    W->>D: decrypt chatgpt_cookie_enc
    W->>LWC: synthetic request with that cookie, proxyFetch in-process
    LWC->>OAI: responses (120 per minute limit)
    W->>GH: App JWT (RS256), installation token cached until 5 min before expiry
    W->>GH: read tree and files with the installation token
    end

    rect rgb(240,240,240)
    Note over U,W: MCP client connects (OAuth 2.1)
    M->>W: POST /mcp without a token
    W-->>M: 401 with resource metadata URL
    M->>W: GET /.well-known/oauth-protected-resource/mcp and oauth-authorization-server
    M->>W: POST /oauth/register, or an https client_id metadata document
    W->>D: oauth_clients
    M->>U: open browser at /oauth/authorize (PKCE S256, resource APP_URL/mcp)
    U->>W: GET /oauth/authorize
    W-->>U: not signed in: GitHub login with next back to authorize
    W->>D: oauth_requests
    W-->>U: consent page
    U->>W: approve
    W->>D: oauth_codes (sha256, 5 min, single use)
    W-->>M: redirect with code
    M->>W: POST /oauth/token with code and PKCE verifier
    W->>D: oauth_grants, oauth_tokens (sha256, access 1h, refresh 30d rotated)
    M->>W: POST /mcp with Bearer token
    W->>D: authenticateMcp: token, grant, user, resource check
    W-->>M: tool results, scoped to the grant
    end
```

- **Repository contents are always read with installation tokens.** User tokens are only used to discover which repositories a user can see, so background scans never need the user online.
- **ChatGPT tokens never leave the SDK.** The Worker stores the encrypted signed SDK cookie and replays it in-process. Codex is the one exception: it gets a short-lived access token, and the refresh token stays redacted inside the SDK.
- **Every secret stored for MCP OAuth is a sha256 hash** (client secrets, codes, tokens). The cron deletes expired codes, requests and tokens, and unused clients and grants.

### REST API (cookie-authenticated)

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/api/scans` | `{ repoId, kind?: "security" \| "understand" }` → `202 { id, url }` |
| `GET` | `/api/scans` | List your scans |
| `GET` | `/api/scans/:id` | Status, phase, progress, event log, summary, findings, questions |
| `POST` | `/api/github/webhook` | GitHub App webhook (HMAC-verified) |
| `*` | `/api/chatgpt/*` | login-with-chatgpt routes (`login`, `status`, `session`, `models`, `responses`, …) |

### MCP server (OAuth)

openscan is also an **MCP server** at `APP_URL/mcp`, so Claude, Cursor, VS Code or any MCP client can read your briefs and act on them. Add the URL as a remote (Streamable HTTP) server; the client discovers the OAuth server, registers itself, and opens a browser where you sign in with GitHub and approve the connection. No API keys.

```bash
claude mcp add --transport http openscan https://openscan.underscore.am/mcp
```

| Tool | Scope | What it does |
| --- | --- | --- |
| `list_repositories` | read | Linked repos, whether watched, product, latest security report |
| `get_repository` | read | The AI-built repo profile (stack, entry points, data stores, auth, sensitive areas) |
| `list_scans` | read | Recent scans, optionally for one repo |
| `get_scan` | read | Status/progress, or the full report: risk, what matters, next actions, findings, questions |
| `list_findings` | read | Open findings of the latest report per repo, filtered by repo and minimum severity |
| `list_questions` | read | The reviewer's open (or answered) questions |
| `start_scan` | write | Queue a security report or a fresh repo read |
| `answer_question` | write | Answer a question; it becomes product memory |
| `update_finding_status` | write | Mark a finding fixed, dismissed, or open again |

Write tools are only listed when the token carries `openscan:write`. The server is stateless (one JSON-RPC exchange per POST, JSON responses), which suits Workers.

The OAuth 2.1 authorization server (`src/lib/oauth/`) implements what the [MCP authorization spec](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization) asks for:

| Endpoint | Standard |
| --- | --- |
| `GET /.well-known/oauth-protected-resource[/mcp]` | RFC 9728 protected resource metadata (also advertised in the `401` `WWW-Authenticate` header) |
| `GET /.well-known/oauth-authorization-server` | RFC 8414 authorization server metadata |
| `POST /oauth/register` | RFC 7591 dynamic client registration (public or confidential clients) |
| `client_id` = https URL | Client ID Metadata Documents (fetched, validated, cached for an hour) |
| `GET/POST /oauth/authorize` | Authorization code with **PKCE S256 required**, consent page, `iss` in the response (RFC 9207) |
| `POST /oauth/token` | `authorization_code` and `refresh_token` (rotated on every use; scope may be narrowed) |
| `POST /oauth/revoke` | RFC 7009; revoking a refresh token disconnects the client |

Security notes: tokens are bound to `APP_URL/mcp` (RFC 8707 `resource`); codes, tokens and client secrets are stored as SHA-256 hashes; codes and consent requests are single-use (`DELETE … RETURNING`); redirect URIs must be https, loopback http (any port, RFC 8252) or a private-use scheme, and are matched exactly; the consent page can't be framed and rejects cross-origin posts. Access tokens live 1 hour, refresh tokens 30 days. The cron purges expired rows. Users see and disconnect clients under **Settings → MCP**. Because metadata uses `APP_URL` as the issuer, set it to the public URL clients will use.

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

- **Codex Cloud** uses undocumented ChatGPT backend endpoints, the same ones `codex cloud` uses, so they may change. Each user must create a Codex environment per repository at chatgpt.com/codex. The Codex path has not been verified against a real ChatGPT account.

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
