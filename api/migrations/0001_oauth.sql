CREATE TABLE drive_connections (
  id TEXT PRIMARY KEY,
  owner_uid TEXT NOT NULL,
  google_account_id TEXT NOT NULL,
  google_email TEXT NOT NULL,
  encrypted_refresh_token TEXT,
  status TEXT NOT NULL CHECK (status IN ('connected','reconnect_required','revocation_pending')),
  scopes TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(owner_uid, google_account_id)
);
CREATE INDEX connections_owner ON drive_connections(owner_uid, status);
CREATE TABLE oauth_transactions (
  state_hash TEXT PRIMARY KEY,
  owner_uid TEXT NOT NULL,
  browser_hash TEXT NOT NULL,
  encrypted_verifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX oauth_expiry ON oauth_transactions(expires_at);
CREATE INDEX oauth_owner ON oauth_transactions(owner_uid, created_at);
