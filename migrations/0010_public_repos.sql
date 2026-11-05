-- Public repositories added by name live under a negative id (no installation),
-- next to the positive-id row of the same repository when someone has the GitHub
-- App installed on it. Installation tokens (and the private data they unlock,
-- like code scanning alerts) must never serve a user who only added it by name,
-- so the two rows stay separate and full_name is no longer unique.
DROP INDEX IF EXISTS repositories_full_name;
CREATE INDEX repositories_full_name ON repositories(full_name);
