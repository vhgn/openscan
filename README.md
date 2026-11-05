# openscan

**AI security review for your GitHub repositories.** openscan reads a repo the way an attacker would and writes a short brief: what matters, what is risky, and what to do next.

Live at [openscan.underscore.am](https://openscan.underscore.am). Brief: [TASK.md](./TASK.md). Product spec: [PRODUCT.md](./PRODUCT.md). How to run, deploy and change it: [docs/TECHNICAL.md](./docs/TECHNICAL.md). Screens: [`docs/screens/`](./docs/screens).

```bash
npm install && cp .dev.vars.example .dev.vars   # set SESSION_SECRET, LWC_SECRET, DEV_DEMO_LOGIN=1
```

```bash
npm run db:migrate:local && npm run dev
```

Then open `http://localhost:3000/api/dev/login?repos=OWASP/NodeGoat` and follow the onboarding.

## How we read the brief

The customer asked for three things, and each one shaped the product:

- **"Not a raw scanner report."** The output is a *brief*: overall risk in one sentence, what matters, numbered next actions, then findings in fix order. A second agent tries to disprove each serious finding. The report marks it verified, needs validation, or rejected.
- **"Understand what matters."** Risk depends on facts the code can't show, such as whether the service is public and what data it holds. The AI asks about these while it reads, answers its own questions when later files settle them, and shows the user only the rest. Answers are reused, so it never asks twice. Onboarding also records preferences: frequency, depth, focus, severity threshold and audience.
- **"A product experience, not just an API."** You sign in with GitHub, install a read-only GitHub App, link ChatGPT and watch the first read with live progress. Then you land on a one-page dashboard, and scans run on a schedule or on push. A REST API (`/api/scans`) exists as a secondary way in.

"Code or dependencies" became both: AI code review plus dependency data from OSV.dev. The reader is an engineering lead or CTO who wants a defensible plan, not 400 rows.

## Trade-offs

| We chose | Instead of | Why, and what it cost |
| --- | --- | --- |
| **GitHub App** install | Pasting a repo URL | Private repos need access anyway, and scans can run while the user is offline. Costs more setup. Public `owner/repo` still works in demo mode. |
| **User's own ChatGPT plan** ([login-with-chatgpt](https://github.com/opencoredev/login-with-chatgpt)) | Our API key | No inference bill or keys. Costs a dependency on a young SDK and a 120 requests/min limit. |
| **Codex Cloud tasks** when a Codex environment exists | File batches only | The agent sees the whole repo, not the top 30 to 50 files. Uses undocumented endpoints; falls back to direct review. |
| **Workers + D1 + Queues** (TypeScript, `nodejs_compat`) | A Node server with long jobs | One cheap deploy. Scans become small retryable steps, and a cron revives stalled ones. Not a plain Node process. |
| **Validator agent** per serious finding | Reporting everything | Fewer false alarms; slower scans, more tokens. |

## What's mocked or unverified

- **Demo login** (`/api/dev/login`, `DEV_DEMO_LOGIN=1`, forced off in production) signs in a fake user with public repos.
- **Without ChatGPT**, the **heuristic engine** runs: real deterministic rules, OSV.dev and known-CVE checks, no AI. That is the "mocked scan" the brief allowed. Nothing returns made-up AI output.
- **Verified end to end:** demo login through onboarding, both scan kinds with real OSV results, dashboard, report, REST API, cron, production build.
- **Not verified (needs real accounts):** ChatGPT device-login approval and AI scans, Codex Cloud, GitHub App install, webhooks.

## What we cut, and why

- **MCP server and its OAuth 2.1 server** (about 1,300 lines, five tables). An authorization server is security-critical code to maintain, and the UI and REST API already meet the brief. Migration `0007` drops the tables.
- **Scripted mock-AI mode.** A second code path that only tested itself; the heuristic engine covers scanning without AI.
- **Five of six design directions.** The owner chose *Essay*: the report reads like a document.
- **Later:** report delivery (email, Slack, issues), dependency reachability, organizations and roles, fix PRs. Useful, but not needed to show what matters and what to do next.

## How the coding agent helped, and where it went wrong

The project was built with **Claude Code** as a pair programmer. The product owner made the product calls: flow, audience, naming and design.

**Where it helped**

- Turned the brief and the owner's notes into `TASK.md` and `PRODUCT.md`, with each requirement mapped to code.
- Read the login-with-chatgpt source before coding and found how to replay the signed session through `proxyFetch`, so background scans use the user's plan without exporting tokens.
- Ran three rounds of design options with Playwright screenshots, then rebuilt every page in the chosen style.
- Checked its work: tests, builds and a Playwright run caught a file-ranking bug, a duplicate React during SSR, a hydration mismatch and GitHub rate limits.
- Vendored security methodology from Trail of Bits, Cloudflare, Anthropic, NVIDIA and others with licenses ([SKILLS.md](./SKILLS.md)) instead of ad-hoc prompts.

**Where it went wrong**

- **Scope creep.** The brief expected about 3 hours. The agent kept adding well-built optional systems (Codex Cloud, product memory, six designs, a full RFC-compliant OAuth server for MCP) without flagging their upkeep. MCP and OAuth were the clearest case and are now removed.
- **Built, then thrown away:** the mock-AI mode and most design options.
- **Confident without checking.** The Codex client follows endpoints mirrored from `openai/codex` and has never run against a real account. In CI it pinned `bitwarden/sm-action@v3`, a tag that doesn't exist.
- **Its own bugs:** the file-ranking bug was its code; its tests caught it.
- **Too much documentation:** the README reached 800 lines. The detail now lives in [docs/TECHNICAL.md](./docs/TECHNICAL.md).

The lesson: the agent is fast and careful inside a well-defined task, but it needs a person to say "that's enough".
