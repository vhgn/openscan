-- Products own scans.
-- A product scan is one review of a product. It runs one repository scan per
-- member repo (scans.product_scan_id). A push to a member repo starts a product
-- scan only when that repo opts in (product_repositories.scan_on_push).

CREATE TABLE product_scans (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'security',
  trigger TEXT NOT NULL,         -- onboarding | manual | schedule | push
  push_repo_id INTEGER,          -- push: the repository that was pushed
  commit_sha TEXT,               -- push: head commit
  created_at INTEGER NOT NULL
);
CREATE INDEX product_scans_product ON product_scans(product_id, created_at DESC);
CREATE INDEX product_scans_user ON product_scans(user_id, created_at DESC);

-- scans.run_id grouped the repo scans of one product run; it now points at product_scans.id.
ALTER TABLE scans RENAME COLUMN run_id TO product_scan_id;
CREATE INDEX scans_product_scan ON scans(product_scan_id);

-- Per member repo: does a push to its default branch start a product scan?
ALTER TABLE product_repositories ADD COLUMN scan_on_push INTEGER NOT NULL DEFAULT 0;
-- Keep today's behaviour: users who chose "on every push" keep push scans on every repo.
UPDATE product_repositories SET scan_on_push = 1
WHERE product_id IN (
  SELECT p.id FROM products p JOIN preferences pf ON pf.user_id = p.user_id
  WHERE json_extract(pf.json, '$.frequency') = 'on_push'
);

-- Backfill: attach older scans to the product that owns their repo,
-- and give every older security scan a product scan of its own (or its run's).
UPDATE scans SET product_id = (
  SELECT pr.product_id FROM product_repositories pr JOIN products p ON p.id = pr.product_id
  WHERE pr.repo_id = scans.repo_id AND p.user_id = scans.user_id LIMIT 1
) WHERE product_id IS NULL;
UPDATE scans SET product_scan_id = id WHERE product_scan_id IS NULL AND product_id IS NOT NULL AND kind = 'security';
INSERT INTO product_scans (id, product_id, user_id, kind, trigger, created_at)
SELECT s.product_scan_id, MIN(s.product_id), MIN(s.user_id), 'security', MIN(s.trigger), MIN(s.created_at)
FROM scans s JOIN products p ON p.id = s.product_id
WHERE s.product_scan_id IS NOT NULL
GROUP BY s.product_scan_id;
