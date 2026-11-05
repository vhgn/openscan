# Scanning skills

openscan's scan pipeline is built from published **agentic security skills**. The list comes from the *"[Bot] Agentic security skills"* sheet (Skills tab), which only includes skills published under a known security vendor's GitHub org.

- **Originals:** vendored verbatim (markdown only, no scripts) in [`skills/vendor/`](./skills/vendor), each with its upstream license. Pinned commits are in [`skills/vendor/SOURCES.md`](./skills/vendor/SOURCES.md).
- **Registry (code):** [`src/lib/skills/registry.ts`](./src/lib/skills/registry.ts) records each skill's stage and how openscan applies it.
- **Agent playbooks:** [`src/lib/skills/playbooks.ts`](./src/lib/skills/playbooks.ts) holds short, distilled versions of the methodology that go into the agent prompts.
- **In the app:** `/skills` lists every skill. Each scan report has a *Methodology* section listing the skills that scan actually applied.

## Where each skill runs

```
security scan:  init ──▶ deps/signals ──▶ review* ──▶ validate* ──▶ triage
understand:     init ──▶ read* ──▶ profile
```

| Stage | Skill (publisher) | How openscan applies it |
| --- | --- | --- |
| **Understand** (reader + architect agents) | audit-context-building (Trail of Bits) | Follow the calls, cite a line or raise an open question, record `UNENFORCED:` assumptions ("nothing found"). Open questions become onboarding questions. |
| | security-audit: reconnaissance (Cloudflare) | Map principals, entry surfaces, controls and deployment-only facts. Facts outside source become questions, never assumptions. |
| **Review** (hunter agent) | security-audit: hunting + candidate gate (Cloudflare) | Every finding must name principal → input → control → boundary → result, with a `file:line` **trace** and a **threat model**. Uses the critical/high/medium/low severity anchors. |
| | Claude Code Security Review (Anthropic) | Vulnerability categories, **hard exclusions** (DoS, rate limits, outdated libs in code review, tests, docs) and **precedents** (env vars trusted, React safe unless `dangerouslySetInnerHTML`, client-side auth is not a vuln). |
| | differential-review (Trail of Bits) | **Push-triggered scans** fetch the push's commit range. Changed files are ranked first and marked `CHANGED`, and the reviewer classifies each by risk (auth/crypto/external calls/removed validation = HIGH). |
| | agentic-actions-auditor (Trail of Bits) | Workflows that use AI actions are always reviewed (vectors A–I). Vectors B, D, G, H and I are also **deterministic rules**. |
| | SkillSpector (NVIDIA) | `SKILL.md`, `AGENTS.md`, `CLAUDE.md`, `.mcp.json` and `.cursor/rules` are ranked for review. Instruction overrides, exfiltration endpoints and pipe-to-shell installs are deterministic rules. |
| | static-analysis: CodeQL + Semgrep (Trail of Bits) | Can't run inside a Worker. Open **GitHub code-scanning alerts** (CodeQL/Semgrep SARIF) are imported as findings and validated like any other. This needs the optional *Code scanning alerts: read* app permission. |
| **Deps / signals** (deterministic) | supply-chain-risk-auditor (Trail of Bits) | OSV advisory sweep over lockfiles, an install-script inventory from `package-lock.json`, and an explicit *unassessable* note for unparsed lockfiles (yarn/pnpm). |
| | brotli-checker (Trail of Bits) | Flags Brotli 1.0.3–1.0.9, 1.1.0 and 1.2.0 (CVE-2026-111497), and Node runtimes below the October 2026 release. |
| | php2shell-checker (OpenAI) | Checks PHP pins in Dockerfiles, CI and `.php-version` against 8.2.35 / 8.3.36 / 8.4.27 / 8.5.12. PHP ≤ 8.1 is reported as *potentially* vulnerable, never "confirmed". |
| | Devin Vulnerability Fixes (Cognition) | Supplies the fixed-version data: Node 22.23.4 / 24.22.1 / 26.12.1 (≤ 20 is EOL) and GitLab 19.5.1 … 18.11.13. Recommendations keep the repo's pin style and image variant. |
| **Validate** (fresh validator agent, new stage) | fp-check (Trail of Bits) | Step 0 restates the claim, then gates for reachability, real impact, no preventing control and environment, plus the false-positive checklist. |
| | vulnerability-triage-brocards (Trail of Bits) | Dismisses findings that lack a threat model, require "exploits from the heavens", sit in unreachable code, describe standard or documented behaviour, have a cure worse than the disease, or rest on a CVE alone. |
| | security-audit: candidate verifier (Cloudflare) | A *different* agent tries to refute each finding. **confirmed** gets a calibrated severity. **needs_validation** gets no severity; the exact missing fact becomes a **question for the owner** on the dashboard. **rejected** is dismissed, and the reasoning is kept. |
| **Report** (triage lead) | security-audit: reporting (Cloudflare), patching-bugs (Trail of Bits), supply-chain style (Trail of Bits), Cognition fix workflow | Severity never exceeds demonstrated impact. Each fix names the invariant, the narrowest change and a regression test. Upgrades use the smallest fixed version. Writing style is impersonal: finding → datum → action. Triage cannot dismiss a finding the validator confirmed. openscan **recommends and never edits code**: it stops at the approval gate. |

### Not adopted

- **Secrets-only skill:** the sheet left this cell empty on purpose (no trustworthy first-party skill). openscan's pattern rules and the supply-chain auditor cover secrets for now.
- **Executable helpers** (Python/Node scripts in the upstream repos) are **not vendored or run**. openscan runs in a Worker; equivalent logic is re-implemented in `src/lib/scanner/runtime-advisories.ts` and `heuristics.ts` and covered by unit tests (`tests/skills.test.ts`).

### Prior runs (product memory)

Cloudflare's security-audit skill treats prior runs carefully. A prior *confirmed* record carries over only when its source is unchanged. A prior *rejected* record suppresses only the unchanged failed claim, never coverage of the area. openscan's product memory follows the same rule: verdicts and reviewed-file skips are keyed to the file's git blob hash, so any change sends the code back through review and validation. See README → *Products and unified memory*.

## Validation verdicts in the UI

| Badge | Meaning | Effect |
| --- | --- | --- |
| ✓ verified | The validator confirmed the full source path and impact | Keeps its (possibly corrected) severity. Triage cannot dismiss it. |
| needs validation | A specific fact outside the repo decides it | Shown under *Needs your input*. Your answer feeds the next scan. |
| rejected | Refuted by source, by a visible control, or by missing impact | Moved to the collapsed *rejected / dismissed* list, with the validator's reasoning |
| *(none)* | Not validated: deterministic advisories, low/info findings, or heuristic mode | Version-matched data. Reachability is discussed in the report. |

The validator runs on critical/high/medium findings from the AI review, pattern rules and code scanning: up to 4, 8 or 12 per scan depending on the *depth* preference, two per queue step.

## Updating the skills

1. Re-clone the upstream repos and copy the markdown into `skills/vendor/<publisher>/…`. Update the commit hashes in `skills/vendor/SOURCES.md`.
2. If a skill's method changed, update its playbook in `src/lib/skills/playbooks.ts` and its `howUsed` text in `registry.ts`.
3. If fixed versions changed (Node, PHP, GitLab, Brotli), update `runtime-advisories.ts` and `tests/skills.test.ts`.
4. Run `npm test`. A test fails if a registered skill isn't vendored or a playbook references an unknown skill.

## Licenses

| Folder | License |
| --- | --- |
| `skills/vendor/trailofbits/` | CC-BY-SA-4.0 (© Trail of Bits). Adapted playbook text derived from it is shared under the same license. |
| `skills/vendor/trailofbits-brotli-checker/`, `cloudflare/`, `anthropic/`, `cognition/` | MIT |
| `skills/vendor/nvidia/`, `openai/` | Apache-2.0 |
