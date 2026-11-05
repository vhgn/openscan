-- Product memory lets a rescan skip files already reviewed at the same blob hash.
-- Their open findings are copied into the new scan so its report stays complete;
-- carried_from names the scan that actually reviewed the code (NULL = found by this scan).
ALTER TABLE findings ADD COLUMN carried_from TEXT;
