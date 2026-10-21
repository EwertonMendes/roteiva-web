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
