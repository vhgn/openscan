/**
 * Agentic security skills used by the openscan pipeline.
 *
 * Source list: the "[Bot] Agentic security skills" sheet (Skills tab). Originals are
 * vendored verbatim under /skills/vendor (see skills/vendor/SOURCES.md for commits and
 * licenses). This registry says which pipeline stage uses each skill and how:
 *
 *   prompt        - methodology distilled into an agent playbook (./playbooks.ts)
 *   deterministic - re-implemented as code (rules / version checks) in the scanner
 *   ingest        - results from the tool are imported when available
 *   reference     - kept for humans/fix workflows; openscan never edits code
 */

export type Stage = 'recon' | 'hunt' | 'supply-chain' | 'validate' | 'report' | 'ci-agents'
export type Application = 'prompt' | 'deterministic' | 'ingest' | 'reference'

export interface SkillInfo {
  id: string
  name: string
  publisher: string
  license: string
  stages: Stage[]
  applied: Application[]
  /** What the skill is (from the sheet, shortened). */
  summary: string
  /** Exactly how openscan uses it. */
  howUsed: string
  repoUrl: string
  vendoredPath: string
  sourcePost?: string
}

export const SKILLS: SkillInfo[] = [
  {
    id: 'tob-audit-context-building',
    name: 'audit-context-building',
    publisher: 'Trail of Bits',
    license: 'CC-BY-SA-4.0',
    stages: ['recon'],
    applied: ['prompt'],
    summary: 'Build function-level context (assumptions, guarantees, dependencies, open questions) before hunting; no verdicts.',
    howUsed: 'Reader and architect agents follow the calls, cite a line for every claim, record unenforced assumptions as "nothing found", and carry open questions forward as onboarding questions.',
    repoUrl: 'https://github.com/trailofbits/skills/tree/main/plugins/audit-context-building',
    vendoredPath: 'skills/vendor/trailofbits/audit-context-building',
    sourcePost: 'https://x.com/krishnadey30/status/2112482415973376100',
  },
  {
    id: 'cf-security-audit',
    name: 'security-audit',
    publisher: 'Cloudflare',
    license: 'MIT',
    stages: ['recon', 'hunt', 'validate', 'report'],
    applied: ['prompt'],
    summary: 'Six-phase audit: recon, coverage-led hunting, fresh-verifier validation, structured findings, record verification, reporting.',
    howUsed: 'Recon checklist (principals, entry surfaces, controls); hunter candidate gate (principal → input → control → boundary → result); a separate verifier agent per finding with confirmed / needs_validation / rejected verdicts; severity anchors; smallest fix at the last trusted decision point.',
    repoUrl: 'https://github.com/cloudflare/security-audit-skill',
    vendoredPath: 'skills/vendor/cloudflare/security-audit',
    sourcePost: 'https://x.com/joshdbirdwell/status/2115603115852313080',
  },
  {
    id: 'tob-differential-review',
    name: 'differential-review',
    publisher: 'Trail of Bits',
    license: 'CC-BY-SA-4.0',
    stages: ['hunt'],
    applied: ['prompt', 'deterministic'],
    summary: 'Risk-first security review of PRs/commits/diffs with blast radius and adversarial modelling.',
    howUsed: 'Push-triggered scans fetch the commit range, always review changed files first, and the reviewer classifies each change HIGH/MEDIUM/LOW risk (auth, crypto, external calls, removed validation = HIGH).',
    repoUrl: 'https://github.com/trailofbits/skills/tree/main/plugins/differential-review',
    vendoredPath: 'skills/vendor/trailofbits/differential-review',
    sourcePost: 'https://x.com/iCleanAI/status/2111138946373828791',
  },
  {
    id: 'tob-static-analysis',
    name: 'static-analysis (CodeQL + Semgrep)',
    publisher: 'Trail of Bits',
    license: 'CC-BY-SA-4.0',
    stages: ['hunt'],
    applied: ['ingest'],
    summary: 'Run CodeQL/Semgrep and process SARIF for deterministic interprocedural SAST.',
    howUsed: 'CodeQL/Semgrep cannot run inside a Worker. When the repository already has GitHub code scanning, openscan imports open alerts as findings and sends them through the same false-positive validation.',
    repoUrl: 'https://github.com/trailofbits/skills/tree/main/plugins/static-analysis',
    vendoredPath: 'skills/vendor/trailofbits/static-analysis',
    sourcePost: 'https://x.com/krishnadey30/status/2112482415973376100',
  },
  {
    id: 'anthropic-security-review',
    name: 'Claude Code Security Review',
    publisher: 'Anthropic',
    license: 'MIT',
    stages: ['hunt', 'validate'],
    applied: ['prompt'],
    summary: 'Diff-aware AI security review with categories, hard exclusions, precedents and false-positive filtering.',
    howUsed: 'Reviewer uses its vulnerability categories, hard exclusions (DoS, rate limits, outdated libs in code review, tests, docs) and precedents (env vars trusted, React safe unless dangerouslySetInnerHTML, client-side auth not a vuln).',
    repoUrl: 'https://github.com/anthropics/claude-code-security-review',
    vendoredPath: 'skills/vendor/anthropic/claude-code-security-review',
    sourcePost: 'https://x.com/myrrazor/status/2115102359051239797',
  },
  {
    id: 'tob-supply-chain-risk-auditor',
    name: 'supply-chain-risk-auditor',
    publisher: 'Trail of Bits',
    license: 'CC-BY-SA-4.0',
    stages: ['supply-chain', 'report'],
    applied: ['deterministic', 'prompt'],
    summary: 'Version-matched advisories, abandoned upstreams, publisher concentration, install-time scripts.',
    howUsed: 'Lockfile advisory sweep via OSV.dev, install-script inventory from package-lock, explicit "unassessable" when a lockfile is not parsed, and impersonal "finding → datum → action" report style.',
    repoUrl: 'https://github.com/trailofbits/skills/tree/main/plugins/supply-chain-risk-auditor',
    vendoredPath: 'skills/vendor/trailofbits/supply-chain-risk-auditor',
    sourcePost: 'https://x.com/krishnadey30/status/2112482415973376100',
  },
  {
    id: 'tob-brotli-checker',
    name: 'brotli-checker',
    publisher: 'Trail of Bits',
    license: 'MIT',
    stages: ['supply-chain'],
    applied: ['deterministic'],
    summary: 'Inventory vulnerable Brotli decoder copies (CVE-2026-111497) and guide updates.',
    howUsed: 'Flags bundled Brotli 1.0.3–1.0.9, 1.1.0, 1.2.0 (fixed 1.0.10 / 1.1.1 / 1.2.1) and Node runtimes below the October 2026 security release.',
    repoUrl: 'https://github.com/trailofbits/brotli-checker',
    vendoredPath: 'skills/vendor/trailofbits-brotli-checker/brotli-checker',
    sourcePost: 'https://x.com/trailofbits/status/2113771101058937163',
  },
  {
    id: 'openai-php2shell-checker',
    name: 'php2shell-checker',
    publisher: 'OpenAI',
    license: 'Apache-2.0',
    stages: ['supply-chain'],
    applied: ['deterministic'],
    summary: 'Version check for PHP2Shell (CVE-2026-109618 / CVE-2026-109619); no exploit probes.',
    howUsed: 'Compares PHP versions pinned in Dockerfiles/composer/CI with fixed releases 8.2.35, 8.3.36, 8.4.27, 8.5.12; ≤8.1 reported as potentially vulnerable (never "confirmed"), distro backports noted.',
    repoUrl: 'https://github.com/openai/php2shell-checker',
    vendoredPath: 'skills/vendor/openai/php2shell-checker',
    sourcePost: 'https://x.com/OpenAI/status/2112945805686604033',
  },
  {
    id: 'nvidia-skillspector',
    name: 'SkillSpector',
    publisher: 'NVIDIA',
    license: 'Apache-2.0',
    stages: ['ci-agents'],
    applied: ['prompt', 'deterministic'],
    summary: 'Scanner for AI agent skills / MCP packs: prompt injection, exfiltration, privilege, tool poisoning.',
    howUsed: 'Agent configuration in scanned repos (SKILL.md, AGENTS.md, CLAUDE.md, .mcp.json, .cursor/rules) is ranked for review and checked for instruction overrides, exfiltration endpoints, pipe-to-shell installs and over-broad MCP tools.',
    repoUrl: 'https://github.com/NVIDIA/SkillSpector',
    vendoredPath: 'skills/vendor/nvidia/skillspector',
    sourcePost: 'https://x.com/yogsec/status/2112773139990188373',
  },
  {
    id: 'tob-fp-check',
    name: 'fp-check',
    publisher: 'Trail of Bits',
    license: 'CC-BY-SA-4.0',
    stages: ['validate'],
    applied: ['prompt'],
    summary: 'Verify suspected bugs → TRUE/FALSE POSITIVE with documented evidence and gate reviews.',
    howUsed: 'Validator restates the claim, traces source → sink, runs the six gates (process, reachability, impact, PoC, bounds, environment) and the false-positive checklist, then a devil\'s-advocate pass.',
    repoUrl: 'https://github.com/trailofbits/skills/tree/main/plugins/fp-check',
    vendoredPath: 'skills/vendor/trailofbits/fp-check',
    sourcePost: 'https://x.com/QAInsights/status/2113458281779773523',
  },
  {
    id: 'tob-vulnerability-triage-brocards',
    name: 'vulnerability-triage-brocards',
    publisher: 'Trail of Bits',
    license: 'CC-BY-SA-4.0',
    stages: ['validate', 'report'],
    applied: ['prompt'],
    summary: 'Seven brocards to accept / dismiss / request info on vulnerability reports.',
    howUsed: 'Validator and triage lead dismiss findings without a threat model, "exploits from the heavens", unreachable code, standard/documented behaviour, cures worse than the disease, and CVE-only claims.',
    repoUrl: 'https://github.com/trailofbits/skills/tree/main/plugins/vulnerability-triage-brocards',
    vendoredPath: 'skills/vendor/trailofbits/vulnerability-triage-brocards',
    sourcePost: 'https://x.com/iCleanAI/status/2111138946373828791',
  },
  {
    id: 'cognition-devin-vuln-fixes',
    name: 'Devin Vulnerability Fixes',
    publisher: 'Cognition',
    license: 'MIT',
    stages: ['supply-chain', 'report'],
    applied: ['deterministic', 'reference'],
    summary: 'Remediation packs for PHP2Shell, Node Oct-2026 release, GitLab CVE-2026-110264: inventory → approval → patch → verify → PR.',
    howUsed: 'Fixed-version data powers the runtime advisory check (Node 22.23.4/24.22.1/26.12.1, PHP, GitLab 19.5.1…18.11.13); recommendations keep the repo\'s pin style and image variant. openscan stops at the approval gate: it recommends, never edits.',
    repoUrl: 'https://github.com/CognitionAI/devin-vuln-fixes',
    vendoredPath: 'skills/vendor/cognition/devin-vuln-fixes',
    sourcePost: 'https://x.com/Ldataengineer/status/2114514135513747585',
  },
  {
    id: 'tob-patching-bugs',
    name: 'patching-bugs',
    publisher: 'Trail of Bits',
    license: 'CC-BY-SA-4.0',
    stages: ['report'],
    applied: ['prompt', 'reference'],
    summary: 'Reproduce one accepted bug, scoped patch, independent proof and regression report.',
    howUsed: 'Each recommendation names the invariant, the narrowest patch location and a regression test; PoCs are written as owner-runnable verification steps.',
    repoUrl: 'https://github.com/trailofbits/skills/tree/main/plugins/patching-bugs',
    vendoredPath: 'skills/vendor/trailofbits/patching-bugs',
    sourcePost: 'https://x.com/trailofbits/status/2112938091585351824',
  },
  {
    id: 'tob-agentic-actions-auditor',
    name: 'agentic-actions-auditor',
    publisher: 'Trail of Bits',
    license: 'CC-BY-SA-4.0',
    stages: ['ci-agents'],
    applied: ['prompt', 'deterministic'],
    summary: 'Audit GitHub Actions that run AI agents for attacker-controlled prompt input, dangerous sandboxes, wildcard allowlists.',
    howUsed: 'Workflows using AI actions are always reviewed; vectors B (expression injection), D (pull_request_target + head checkout), G (eval of AI output), H (dangerous sandbox flags) and I (wildcard allowlists) are also detected deterministically.',
    repoUrl: 'https://github.com/trailofbits/skills/tree/main/plugins/agentic-actions-auditor',
    vendoredPath: 'skills/vendor/trailofbits/agentic-actions-auditor',
    sourcePost: 'https://x.com/ArpitChandak18/status/2117968068400001329',
  },
]

export const SKILL_BY_ID = Object.fromEntries(SKILLS.map((s) => [s.id, s])) as Record<string, SkillInfo>

export const STAGE_LABELS: Record<Stage, string> = {
  recon: 'Scope / understand',
  hunt: 'Static review / discovery',
  'supply-chain': 'Dependencies & runtimes',
  validate: 'Validate / triage',
  report: 'Report / fixes',
  'ci-agents': 'CI & agent config',
}
