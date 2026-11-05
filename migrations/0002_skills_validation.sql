-- Agentic security skills integration: independent validation verdicts,
-- Cloudflare-style source traces / threat models, and per-finding skill attribution.

ALTER TABLE findings ADD COLUMN verdict TEXT;          -- confirmed | needs_validation | rejected | NULL (unverified)
ALTER TABLE findings ADD COLUMN verification TEXT;     -- validator's reasoning (gates, refutation attempt)
ALTER TABLE findings ADD COLUMN trace_json TEXT;       -- ["file:line — step", ...] source → sink
ALTER TABLE findings ADD COLUMN threat_model TEXT;     -- "An attacker with X can Y to achieve Z"
ALTER TABLE findings ADD COLUMN source TEXT;           -- ai-review | heuristic | osv | runtime-advisory | code-scanning
ALTER TABLE findings ADD COLUMN skills_json TEXT;      -- skill ids that produced / validated this finding

-- Which skills a scan applied (shown on the report page).
ALTER TABLE scans ADD COLUMN skills_json TEXT;
