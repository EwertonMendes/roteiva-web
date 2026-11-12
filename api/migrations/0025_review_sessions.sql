CREATE TABLE review_sessions (
 id_hash TEXT PRIMARY KEY, review_id TEXT NOT NULL REFERENCES review_requests(id) ON DELETE CASCADE,
 version INTEGER NOT NULL, invite_hash TEXT NOT NULL, viewer_subject TEXT,
 expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX review_session_expiry ON review_sessions(expires_at);
CREATE INDEX review_session_invite ON review_sessions(review_id,created_at);
