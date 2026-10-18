CREATE TABLE account_deletions (
  owner_uid TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL UNIQUE,
  phase TEXT NOT NULL CHECK(phase IN ('locking','revoking','firestore','identity','completed','manual_review')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  lease_until INTEGER NOT NULL DEFAULT 0,
  lease_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  error_code TEXT
);
CREATE INDEX deletion_due ON account_deletions(phase,next_attempt_at,lease_until);
