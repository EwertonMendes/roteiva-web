-- Serialize remote append/commit operations and survive retries/timeouts.
ALTER TABLE dropbox_upload_attempts ADD COLUMN lease_id TEXT;
ALTER TABLE dropbox_upload_attempts ADD COLUMN lease_until INTEGER NOT NULL DEFAULT 0;
CREATE INDEX dropbox_upload_owner ON dropbox_upload_attempts(owner_uid,connection_id,status);
