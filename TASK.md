# Backend Home Assignment: "AI Scan Review Experience"

> Transcribed from the original assignment PDF (`Agentic_poc.pdf`, OX Security). This file is the **source brief**; see [PRODUCT.md](./PRODUCT.md) for how we interpreted it and [README.md](./README.md) for the short write-up and [docs/TECHNICAL.md](./docs/TECHNICAL.md) for how to run what we built.

## Context

We are building a product in the coding-agent/AI security-scanning space.

A customer gave us this vague request:

> *"I want to connect one of my GitHub repositories and get an AI-assisted code or dependencies security review.*
>
> *I don't want a raw scanner report. I want to understand what matters, what is risky, and what I should do next.*
>
> *It should feel like a product experience, not just an API."*

Your task is to take this vague request and build a small E2E flow.

**Expected time: ~3 hours.**

## What You Need To Deliver

Build a small app/service that lets a user:

1. Submit a GitHub repository URL.
2. Start some kind of security/code scan or mocked scan.
3. Follow the scan progress.
4. See a useful result screen/API response.
5. Understand the most important risks and recommended next actions.

You decide the exact UX, API, states, data model, and flow.

## Must Have

- Backend implementation in Node.js + TypeScript.
- A way to start a scan.
- A way to track scan progress.
- A way to review the final result.
- README explaining your product and technical decisions.

  Short explanation of how you used coding agents.

---

## How this repo maps to the brief

| Requirement | Where |
| --- | --- |
| Submit a GitHub repository | GitHub App install + repo picker (`/onboarding`), `POST /api/scans` (by linked repo id). Demo mode accepts public `owner/repo` names: `/api/dev/login?repos=owner/repo` |
| Start a scan | "Scan now" on `/dashboard`, `POST /api/scans`, automatic first scan after onboarding, scheduled/on-push scans |
| Track progress | `/scans/:id` (live progress bar + activity log, cancel), `GET /api/scans/:id/progress?since=` (cursor + ETag), `POST /api/scans/:id/cancel` |
| Review the result | `/scans/:id`: overall risk, headline, *what matters*, *what to do next*, ranked findings with impact, fix and optional PoC. `GET /api/scans/:id` (JSON), `GET /api/scans/:id/sarif` (SARIF 2.1.0 export) |
| Node.js + TypeScript backend | TanStack Start server functions + API routes on Cloudflare Workers (`nodejs_compat`), D1, Queues |
| README with product/tech decisions + coding-agent usage | [README.md](./README.md) (details in [docs/TECHNICAL.md](./docs/TECHNICAL.md)) |
