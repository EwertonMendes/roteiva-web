-- Support metadata only. Attachments are sent directly to a verified inbox,
-- never persisted in D1, Firestore or object storage.
CREATE TABLE IF NOT EXISTS feedback_reports (
 id TEXT PRIMARY KEY,
 owner_uid TEXT NOT NULL,
 request_key TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('bug','idea','praise','other')),
 title TEXT NOT NULL,
 description TEXT NOT NULL,
 screen TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('sending','sent','failed')),
 attachment_count INTEGER NOT NULL CHECK(attachment_count BETWEEN 0 AND 5),
 message_id TEXT,
 created_at INTEGER NOT NULL,
 sent_at INTEGER,
 UNIQUE(owner_uid,request_key)
);
CREATE INDEX IF NOT EXISTS idx_feedback_owner_created ON feedback_reports(owner_uid,created_at DESC);
