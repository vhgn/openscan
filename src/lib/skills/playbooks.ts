/**
 * Agent playbooks distilled from the vendored skills (skills/vendor/*).
 * Each block is an adaptation of the named upstream skill; Trail of Bits-derived
 * text is CC-BY-SA-4.0 (https://github.com/trailofbits/skills), Cloudflare and
 * Anthropic-derived text is MIT. Kept short on purpose: every block is sent with
 * every agent call, so it must earn its tokens.
 */

const RECON = `METHOD (Trail of Bits audit-context-building + Cloudflare security-audit reconnaissance):
- Build understanding, not verdicts. Do not rate severity here.
- Map: product type and users; lower-trust principals and what each may do by design; entry surfaces (HTTP, RPC/messages, files/uploads, CLI/env/config, webhooks, CI, model context/tools); where identity, authorization and tenant scope are enforced; data stores and secrets; deployment visible in source.
- Follow the calls: a check that "looks enforced" often depends on another function. Say what makes each assumption true.
- When code relies on something that nothing enforces, record it as a note starting with "UNENFORCED:" plus the file. These are the most valuable hand-off to the hunting phase.
- Every claim cites a file (and line when known) or becomes an open question. Deployment facts not in source (proxy, WAF, IAM, headers) are open questions, never assumptions.`

const HUNT = `METHOD (Cloudflare security-audit hunting + Anthropic claude-code-security-review):
Find source-grounded trust-boundary failures and the smallest fix. For each candidate you MUST be able to name:
 1) the lower-trust principal and starting capability, 2) the accepted input/action, 3) the control that should reject/bind/isolate it,
 4) the exact source path after that control (trace as "file:line — step"), 5) the affected principal/resource and concrete result.
If any of these is missing it is not a finding. Express the threat model as: "An attacker with <capability> can <action> to achieve <impact>."
Categories: injection (SQL/NoSQL/command/template/path traversal/XXE), authn/authz bypass, privilege escalation, session/JWT flaws, IDOR/tenant isolation, SSRF controlling host/protocol, unsafe deserialization, XSS via unsafe sinks, hardcoded secrets, weak crypto/randomness, certificate validation bypass, sensitive-data exposure (secrets/PII in logs or responses).
HARD EXCLUSIONS (do not report): DoS/resource exhaustion/rate limiting, ReDoS/regex injection, outdated third-party libraries (handled by the dependency stage), missing hardening without a reachable violation, theoretical races, log spoofing, path-only SSRF, test-only files, documentation, lack of audit logs, user content in AI prompts by itself.
PRECEDENTS: env vars/CLI flags are trusted; UUIDs are unguessable; React/Angular escape output unless dangerouslySetInnerHTML/bypassSecurityTrust*; missing auth checks in client-side code are not vulnerabilities (the server must enforce); logging URLs is fine, logging secrets/PII is not.
Severity anchors: critical = unauthenticated RCE / full data-store access / arbitrary account takeover; high = full defeat of an explicit control with real consequences (auth bypass, cross-tenant read/write, stored XSS on others, authenticated RCE); medium = real boundary violation with limited blast radius or uncommon preconditions; low = non-secret disclosure or high-effort minimal gain. Never strengthen a crash into RCE or a same-principal action into privilege gain.
Confidence: only report what you are ≥70% sure is exploitable; mark 70–80% as "low", 80–90% "medium", ≥90% "high". Static-analyzer hints are leads, not findings.`

const DIFF = `DIFFERENTIAL MODE (Trail of Bits differential-review): files marked CHANGED come from the commit range that triggered this scan.
- Classify each changed file by RISK, not size: HIGH = auth, crypto, external calls, value transfer, removed validation; MEDIUM = business logic, state changes, new public APIs; LOW = comments, tests, UI, logging.
- "Just a refactor" is HIGH until proven LOW. Removed security checks are findings in their own right.
- Focus on what the change introduces or re-opens; describe the blast radius (which callers/routes reach the changed code).`

const CI_AGENTS = `CI / AGENT CONFIG (Trail of Bits agentic-actions-auditor + NVIDIA SkillSpector):
GitHub Actions that run AI agents (anthropics/claude-code-action, openai/codex-action, google-github-actions/run-gemini-cli, actions/ai-inference): check for
 A) env var holding \${{ github.event.* }} read by the prompt, B) \${{ github.event.* }} directly inside prompt fields, C) prompts that fetch issue/PR text via gh,
 D) pull_request_target + checkout of the PR head, E) CI logs/workflow_dispatch input fed to the prompt, F) allowed tools that permit $() expansion,
 G) eval/exec of steps.*.outputs, H) danger-full-access / Bash(*) / --yolo / unsafe sandbox, I) wildcard user allowlists ("*").
Severity rises with external triggers (pull_request_target, issue_comment, issues), dangerous sandbox modes, wildcard allowlists, write tokens/secrets in scope.
Agent skill/config files (SKILL.md, AGENTS.md, CLAUDE.md, .mcp.json, .cursor/rules): look for instruction overrides, hidden exfiltration (webhook/paste URLs, encoded blobs), pipe-to-shell installs, over-broad MCP tool permissions and tool-description poisoning.`

const VALIDATE = `METHOD (Trail of Bits fp-check + vulnerability-triage-brocards + Cloudflare candidate verifier):
You did not write this finding. Try to REFUTE it from the source you are shown. LLMs are biased toward seeing bugs and overrating severity.
Step 0 — restate the exact claim, root cause, trigger, impact and threat model in one or two sentences. If it does not make coherent sense restated, reject it.
Gates (all must pass to confirm): 1 Reachability — a real lower-trust entry point reaches the sink with attacker-controlled data; 2 Real impact — RCE, privilege gain, cross-boundary data access/modification, not an operational robustness issue; 3 No preventing control — trace the full validation chain backwards (framework escaping, ORM binding, middleware auth, schema validation, type constraints); 4 Environment — no source-visible protection blocks it entirely.
Brocards — dismiss when: no coherent threat model; the attacker already needs the power the bug grants ("exploit from the heavens"); the path is not used by any real caller; behaviour is mandated by a spec or explicitly documented; the fix would hurt more than the bug; the only evidence is a CVE/score with no technical path.
Verdicts: "confirmed" = complete source path + concrete impact + no visible preventing layer (give a calibrated severity). "needs_validation" = a SPECIFIC fact outside source decides it (state that exact missing fact as a question the owner can answer; no severity). "rejected" = source, a visible control, missing impact or an impossible prerequisite refutes it. needs_validation is never a parking place for a vague idea, and never for a question about how the code behaves (whether a handler authenticates, who calls it, what a config does): trace that in the code and decide.`

const REPORT = `METHOD (Cloudflare reporting + Trail of Bits supply-chain-risk-auditor / patching-bugs + Cognition vuln-fix workflow):
- Rank by demonstrated risk; severity never exceeds demonstrated impact. needs_validation items carry no severity: list them as questions for the owner.
- For each recommendation name the invariant to enforce, the narrowest change at the last trusted decision point, and a regression test. Prefer one focused change per issue.
- Dependency/runtime upgrades: choose the smallest fixed version, keep the repo's pin style and image variant, and say whether it is a patch or major bump. A CVE alone is neither necessary nor sufficient: say whether the vulnerable code path is plausibly reachable.
- Style: impersonal and declarative; state the finding, the datum behind it, and the action. No intensifiers, no guesses about why the code is the way it is.`

export interface PlaybookContext {
  /** Paths in the current batch (used to decide which domain blocks apply). */
  paths?: string[]
  /** True for push-triggered differential scans. */
  differential?: boolean
}

export const AGENT_CONFIG_RE = /(^|\/)(SKILL\.md|AGENTS\.md|CLAUDE\.md|GEMINI\.md|\.mcp\.json|mcp\.json|\.cursorrules)$|(^|\/)\.cursor\/rules\/|(^|\/)\.claude\/(commands|agents|skills)\//i
export const WORKFLOW_RE = /^\.github\/workflows\/[^/]+\.ya?ml$/

export interface Playbook {
  text: string
  skills: string[]
}

export function reconPlaybook(): Playbook {
  return { text: RECON, skills: ['tob-audit-context-building', 'cf-security-audit'] }
}

export function huntPlaybook(ctx: PlaybookContext = {}): Playbook {
  const blocks = [HUNT]
  const skills = ['cf-security-audit', 'anthropic-security-review']
  if (ctx.differential) {
    blocks.push(DIFF)
    skills.push('tob-differential-review')
  }
  const paths = ctx.paths ?? []
  if (paths.some((p) => WORKFLOW_RE.test(p) || AGENT_CONFIG_RE.test(p))) {
    blocks.push(CI_AGENTS)
    skills.push('tob-agentic-actions-auditor', 'nvidia-skillspector')
  }
  return { text: blocks.join('\n\n'), skills }
}

export function validatePlaybook(): Playbook {
  return { text: VALIDATE, skills: ['tob-fp-check', 'tob-vulnerability-triage-brocards', 'cf-security-audit'] }
}

export function reportPlaybook(): Playbook {
  return {
    text: REPORT,
    skills: ['cf-security-audit', 'tob-supply-chain-risk-auditor', 'tob-patching-bugs', 'cognition-devin-vuln-fixes', 'tob-vulnerability-triage-brocards'],
  }
}
