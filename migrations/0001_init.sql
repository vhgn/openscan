-- openscan initial schema (Cloudflare D1 / SQLite)

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  github_id INTEGER NOT NULL UNIQUE,
  login TEXT NOT NULL,
  name TEXT,
  avatar_url TEXT,
  -- GitHub App user-to-server token (AES-GCM encrypted with SESSION_SECRET)
  gh_token_enc TEXT,
  gh_refresh_enc TEXT,
  gh_token_expires_at INTEGER,
  -- Signed Login-with-ChatGPT session cookie (encrypted). Lets background jobs
  -- call the SDK proxy on the user's behalf without ever exporting raw tokens.
  chatgpt_cookie_enc TEXT,
  chatgpt_email TEXT,
  chatgpt_plan TEXT,
  onboarding_step TEXT NOT NULL DEFAULT 'repos',
  onboarded_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,           -- sha256(cookie token)
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

-- KeyValueStore backing @opencoredev/loginwithchatgpt-server sessions.
CREATE TABLE lwc_store (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  expires_at INTEGER
);

CREATE TABLE installations (
  id INTEGER PRIMARY KEY,        -- GitHub installation id
  account_login TEXT NOT NULL,
  account_type TEXT NOT NULL,    -- User | Organization
  repository_selection TEXT,     -- all | selected
  suspended_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE user_installations (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  installation_id INTEGER NOT NULL REFERENCES installations(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, installation_id)
);

CREATE TABLE repositories (
  id INTEGER PRIMARY KEY,        -- GitHub repo id (negative ids = public demo repos)
  installation_id INTEGER,       -- NULL for public demo repos
  full_name TEXT NOT NULL,
  default_branch TEXT,
  private INTEGER NOT NULL DEFAULT 0,
  html_url TEXT,
  description TEXT,
  language TEXT,
  profile_json TEXT,             -- AI-built understanding of the repo
  understood_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX repositories_full_name ON repositories(full_name);

CREATE TABLE user_repositories (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  repo_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  selected INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, repo_id)
);

CREATE TABLE preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE scans (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  repo_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,            -- understand | security
  trigger TEXT NOT NULL,         -- onboarding | manual | schedule | push
  status TEXT NOT NULL,          -- queued | running | completed | failed
  phase TEXT NOT NULL DEFAULT 'queued',
  progress INTEGER NOT NULL DEFAULT 0,
  engine TEXT,                   -- ai | heuristic
  model TEXT,
  commit_sha TEXT,
  state_json TEXT NOT NULL DEFAULT '{}',
  summary_json TEXT,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER
);
CREATE INDEX scans_user ON scans(user_id, created_at DESC);
CREATE INDEX scans_repo ON scans(repo_id, created_at DESC);
CREATE INDEX scans_status ON scans(status, updated_at);

CREATE TABLE scan_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id TEXT NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  ts INTEGER NOT NULL,
  level TEXT NOT NULL DEFAULT 'info',
  message TEXT NOT NULL
);
CREATE INDEX scan_events_scan ON scan_events(scan_id, id);

CREATE TABLE findings (
  id TEXT PRIMARY KEY,
  scan_id TEXT NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  repo_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  severity TEXT NOT NULL,        -- critical | high | medium | low | info
  category TEXT NOT NULL,        -- code | dependency | secret | config | ci
  title TEXT NOT NULL,
  file TEXT,
  line INTEGER,
  description TEXT NOT NULL,
  impact TEXT,
  recommendation TEXT,
  poc TEXT,                      -- research / proof-of-concept (when preferences ask for it)
  confidence TEXT,               -- high | medium | low
  priority INTEGER,              -- 1 = fix first
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL
);
CREATE INDEX findings_user ON findings(user_id, created_at DESC);
CREATE INDEX findings_scan ON findings(scan_id);

CREATE TABLE questions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  repo_id INTEGER REFERENCES repositories(id) ON DELETE CASCADE,
  scan_id TEXT REFERENCES scans(id) ON DELETE SET NULL,
  question TEXT NOT NULL,
  rationale TEXT,
  status TEXT NOT NULL DEFAULT 'open',  -- open | auto_answered | answered | dismissed
  answer TEXT,
  answer_source TEXT,            -- ai | user
  evidence TEXT,
  created_at INTEGER NOT NULL,
  answered_at INTEGER
);
CREATE INDEX questions_user ON questions(user_id, status, created_at DESC);

CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by TEXT,
  updated_at INTEGER NOT NULL
);
