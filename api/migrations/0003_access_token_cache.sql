-- Additive migration: existing connections remain valid; first use fills the cache.
ALTER TABLE drive_connections ADD COLUMN encrypted_access_token TEXT;
ALTER TABLE drive_connections ADD COLUMN access_token_expires_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE drive_connections ADD COLUMN access_token_version TEXT;
ALTER TABLE drive_connections ADD COLUMN refresh_lease_id TEXT;
ALTER TABLE drive_connections ADD COLUMN refresh_lease_until INTEGER NOT NULL DEFAULT 0;
ALTER TABLE drive_connections ADD COLUMN refresh_retry_after INTEGER NOT NULL DEFAULT 0;
