-- Named Google participants are review-scoped; email is a verified Firebase/Google identity.
CREATE TABLE review_participants (
 review_id TEXT NOT NULL REFERENCES review_requests(id) ON DELETE CASCADE,
 email TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('reviewer','viewer')),
 PRIMARY KEY (review_id,email)
);
CREATE INDEX review_participants_by_role ON review_participants(review_id,role);
-- Migrate historical restricted invitations without changing their reviewer access.
INSERT INTO review_participants(review_id,email,role)
 SELECT id,LOWER(recipient_email),'reviewer' FROM review_requests
 WHERE access_mode='google' AND recipient_email!='';
-- One Google permission is managed per (file,principal), independently of review/version.
-- "managed=0" means it was created outside Roteiva and must never be revoked here.
CREATE TABLE review_google_acl (
 file_id TEXT NOT NULL,
 email TEXT NOT NULL,
 connection_id TEXT NOT NULL,
 permission_id TEXT,
 managed INTEGER NOT NULL CHECK(managed IN (0,1)),
 state TEXT NOT NULL CHECK(state IN ('granting','ready','revoking')),
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(file_id,email)
);
CREATE TABLE review_google_uses (
 review_id TEXT NOT NULL REFERENCES review_requests(id) ON DELETE CASCADE,
 version INTEGER NOT NULL,
 file_id TEXT NOT NULL,
 email TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('active','revoked')),
 PRIMARY KEY(review_id,version,file_id,email)
);
CREATE INDEX review_google_uses_live ON review_google_uses(file_id,email,state);

ALTER TABLE review_requests ADD COLUMN restrict_existing_public INTEGER NOT NULL DEFAULT 0 CHECK(restrict_existing_public IN (0,1));
CREATE TABLE review_votes (
 review_id TEXT NOT NULL REFERENCES review_requests(id) ON DELETE CASCADE,
 version INTEGER NOT NULL,
 email TEXT NOT NULL,
 decision TEXT NOT NULL CHECK(decision IN ('approved','changes')),
 author_name TEXT NOT NULL,
 message TEXT NOT NULL DEFAULT '',
 created_at INTEGER NOT NULL,
 PRIMARY KEY(review_id,version,email)
);
CREATE INDEX review_votes_lookup ON review_votes(review_id,version);
-- Existing in-progress Google reviews already hold ACLs. Import their usage and
-- retain exact pre-existing/managed ownership before sharing files across reviews.
INSERT OR IGNORE INTO review_google_uses(review_id,version,file_id,email,state)
 SELECT a.review_id,a.version,a.file_id,LOWER(r.recipient_email),'active'
 FROM review_assets a JOIN review_requests r ON r.id=a.review_id
 WHERE r.access_mode='google' AND r.recipient_email!='' AND a.grant_state='granted';
INSERT OR IGNORE INTO review_google_acl(file_id,email,connection_id,permission_id,managed,state,updated_at)
 SELECT a.file_id,LOWER(r.recipient_email),a.connection_id,a.permission_id,
 CASE WHEN a.permission_id IS NULL THEN 0 ELSE 1 END,'ready',r.updated_at
 FROM review_assets a JOIN review_requests r ON r.id=a.review_id
 WHERE r.access_mode='google' AND r.recipient_email!='' AND a.grant_state='granted';
DELETE FROM review_file_claims WHERE EXISTS(
 SELECT 1 FROM review_requests r WHERE r.id=review_file_claims.review_id AND r.access_mode='google'
);
UPDATE review_assets SET permission_id=NULL WHERE grant_state='granted' AND EXISTS(
 SELECT 1 FROM review_requests r WHERE r.id=review_assets.review_id AND r.access_mode='google'
);

ALTER TABLE review_google_acl ADD COLUMN owner_review_id TEXT;

-- Multiple separate approvals may select one Drive file concurrently.
-- These references protect app-created "anyone" permissions until their last user closes.
CREATE TABLE review_link_uses (
 review_id TEXT NOT NULL REFERENCES review_requests(id) ON DELETE CASCADE,
 version INTEGER NOT NULL,
 file_id TEXT NOT NULL,
 PRIMARY KEY(review_id,version,file_id)
);
CREATE INDEX review_link_uses_by_file ON review_link_uses(file_id);
