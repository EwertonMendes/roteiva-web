-- Only authorized metadata and encrypted capabilities; never file bytes.
CREATE TABLE drive_upload_attempts (
  id TEXT NOT NULL,
  owner_uid TEXT NOT NULL,
  connection_id TEXT NOT NULL REFERENCES drive_connections(id) ON DELETE CASCADE,
  connection_revision INTEGER NOT NULL,
  project_id INTEGER NOT NULL,
  linked_folder_id TEXT NOT NULL,
  target_folder_id TEXT NOT NULL,
  file_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL CHECK(size > 0),
  encrypted_session TEXT,
  status TEXT NOT NULL CHECK(status IN ('starting','active','completed')),
  expires_at INTEGER NOT NULL,
  PRIMARY KEY(owner_uid,id)
);
CREATE INDEX drive_upload_expiry ON drive_upload_attempts(expires_at);
