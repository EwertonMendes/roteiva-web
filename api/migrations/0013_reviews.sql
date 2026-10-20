-- Public review gateway lives in D1 because Firestore owner-scoped rules must never become public.
-- Media remains exclusively in the owner's Google Drive.
CREATE TABLE review_requests (
 id TEXT PRIMARY KEY NOT NULL,
 owner_uid TEXT NOT NULL,
 client_id INTEGER NOT NULL,
 project_id INTEGER NOT NULL,
 client_name TEXT NOT NULL,
 project_name TEXT NOT NULL,
 studio_name TEXT NOT NULL,
 title TEXT NOT NULL,
 message TEXT NOT NULL DEFAULT '',
 recipient_email TEXT NOT NULL DEFAULT '',
 access_mode TEXT NOT NULL CHECK(access_mode IN ('link','google')),
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','publishing','pending','changes','approved','closing','closed')),
 current_version INTEGER NOT NULL DEFAULT 1 CHECK(current_version>=1),
 expires_at INTEGER NOT NULL,
 token_hash TEXT NOT NULL UNIQUE,
 encrypted_token TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE INDEX review_owner_updated ON review_requests(owner_uid,updated_at DESC);
CREATE TABLE review_assets (
 review_id TEXT NOT NULL REFERENCES review_requests(id) ON DELETE CASCADE,
 version INTEGER NOT NULL,
 file_id TEXT NOT NULL,
 connection_id TEXT NOT NULL,
 linked_folder_id TEXT NOT NULL,
 name TEXT NOT NULL,
 mime_type TEXT NOT NULL,
 permission_id TEXT,
 grant_state TEXT NOT NULL DEFAULT 'unshared' CHECK(grant_state IN ('unshared','granting','granted','revoking','revoked')),
 PRIMARY KEY(review_id,version,file_id)
);
CREATE TABLE review_comments (
 id TEXT PRIMARY KEY,
 review_id TEXT NOT NULL REFERENCES review_requests(id) ON DELETE CASCADE,
 version INTEGER NOT NULL,
 file_id TEXT NOT NULL,
 author_name TEXT NOT NULL,
 author_email TEXT,
 body TEXT NOT NULL,
 seconds INTEGER,
 created_at INTEGER NOT NULL
);
CREATE INDEX review_comments_lookup ON review_comments(review_id,version,created_at);
CREATE TABLE review_decisions (
 id TEXT PRIMARY KEY,
 review_id TEXT NOT NULL REFERENCES review_requests(id) ON DELETE CASCADE,
 version INTEGER NOT NULL,
 decision TEXT NOT NULL CHECK(decision IN ('approved','changes')),
 author_name TEXT NOT NULL,
 author_email TEXT,
 message TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 UNIQUE(review_id,version)
);