-- Additive, fail-closed foundation. Existing Drive records remain intact.
CREATE TABLE dropbox_connections (
 id TEXT PRIMARY KEY NOT NULL,
 owner_uid TEXT NOT NULL,
 dropbox_account_id TEXT NOT NULL,
 dropbox_email TEXT NOT NULL,
 encrypted_refresh_token TEXT,
 encrypted_access_token TEXT,
 access_token_expires_at INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL CHECK(status IN ('connected','reconnect_required','revocation_pending')),
 scopes TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 UNIQUE(owner_uid,dropbox_account_id)
);
CREATE INDEX dropbox_connections_owner ON dropbox_connections(owner_uid,status);
CREATE TABLE dropbox_oauth_transactions (
 state_hash TEXT PRIMARY KEY NOT NULL,
 owner_uid TEXT NOT NULL,
 browser_hash TEXT NOT NULL DEFAULT '',
 encrypted_verifier TEXT NOT NULL,
 encrypted_state TEXT NOT NULL,
 launch_hash TEXT,
 launched_at INTEGER,
 expires_at INTEGER NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE INDEX dropbox_oauth_owner ON dropbox_oauth_transactions(owner_uid,created_at);
CREATE INDEX dropbox_oauth_expiry ON dropbox_oauth_transactions(expires_at);
ALTER TABLE review_assets ADD COLUMN provider TEXT NOT NULL DEFAULT 'google_drive'
 CHECK(provider IN ('google_drive','dropbox'));
CREATE INDEX review_asset_provider ON review_assets(provider,connection_id);
CREATE TABLE dropbox_upload_attempts (
 id TEXT NOT NULL,
 owner_uid TEXT NOT NULL,
 connection_id TEXT NOT NULL REFERENCES dropbox_connections(id),
 connection_revision INTEGER NOT NULL,
 project_id INTEGER NOT NULL,
 linked_folder_id TEXT NOT NULL,
 target_folder_id TEXT NOT NULL,
 name TEXT NOT NULL,
 size INTEGER NOT NULL,
 mime_type TEXT NOT NULL,
 encrypted_session TEXT,
 committed_offset INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL CHECK(status IN ('starting','active','uncertain','completed','failed')),
 file_id TEXT,
 expires_at INTEGER NOT NULL,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(owner_uid,id)
);
CREATE INDEX dropbox_upload_cleanup ON dropbox_upload_attempts(expires_at,status);
