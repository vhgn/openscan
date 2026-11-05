-- Products: several repositories reviewed as one product, with a shared memory.

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX products_user ON products(user_id);

-- A repository belongs to at most one product per user (enforced in app code).
CREATE TABLE product_repositories (
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  repo_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, repo_id)
);
CREATE INDEX product_repositories_repo ON product_repositories(repo_id);

ALTER TABLE scans ADD COLUMN product_id TEXT;
ALTER TABLE scans ADD COLUMN run_id TEXT;            -- groups the per-repo scans of one product scan
ALTER TABLE questions ADD COLUMN product_id TEXT;    -- questions/answers are shared across the product

-- Unified product memory so agents do not re-check the same things.
--   fact     : durable knowledge (profile notes, UNENFORCED assumptions, owner answers); key = normalized text
--   reviewed : a file was reviewed at a given blob hash; key = "<repo_id>:<path>", content_hash = git blob sha
--   verdict  : validator outcome for a claim; key = finding fingerprint, content_hash = blob sha of the file
CREATE TABLE memory (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  repo_id INTEGER,
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  content TEXT NOT NULL,
  evidence TEXT,
  content_hash TEXT,
  meta_json TEXT,
  source_scan_id TEXT,
  hits INTEGER NOT NULL DEFAULT 0,      -- how many times this memory saved work
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX memory_key ON memory(product_id, kind, key);
CREATE INDEX memory_repo ON memory(product_id, repo_id, kind);
