-- Make OAuth startup independent of third-party cookie storage.
-- A one-use launch ticket is exchanged during a top-level navigation to the Worker.
ALTER TABLE oauth_transactions ADD COLUMN launch_hash TEXT;
ALTER TABLE oauth_transactions ADD COLUMN encrypted_state TEXT;
ALTER TABLE oauth_transactions ADD COLUMN launched_at INTEGER;
CREATE UNIQUE INDEX oauth_launch_hash_unique ON oauth_transactions(launch_hash) WHERE launch_hash IS NOT NULL;
