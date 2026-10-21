-- A Drive ACL belongs to one review/version until its revocation is confirmed.
-- File IDs are globally unique in Drive, even across connected accounts.
CREATE TABLE review_file_claims (
 file_id TEXT PRIMARY KEY NOT NULL,
 review_id TEXT NOT NULL REFERENCES review_requests(id) ON DELETE CASCADE,
 version INTEGER NOT NULL
);
-- Fail migration on conflicting historical grants rather than guessing ownership.
INSERT INTO review_file_claims(file_id,review_id,version)
 SELECT file_id,review_id,version FROM review_assets
 WHERE grant_state IN ('granting','granted','revoking');
ALTER TABLE review_assets ADD COLUMN lease_id TEXT;
ALTER TABLE review_assets ADD COLUMN lease_until INTEGER NOT NULL DEFAULT 0;
ALTER TABLE review_requests ADD COLUMN transition_id TEXT;
CREATE INDEX review_cleanup ON review_requests(status,updated_at);
