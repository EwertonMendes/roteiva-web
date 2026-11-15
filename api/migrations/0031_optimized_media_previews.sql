-- Optional DEV-only optimized media previews. Original files remain in Drive/Dropbox.
-- A unique origin revision is processed at most once per account.
CREATE TABLE IF NOT EXISTS optimized_media_previews (
 owner_uid TEXT NOT NULL,
 provider TEXT NOT NULL CHECK(provider IN ('google_drive','dropbox')),
 connection_id TEXT NOT NULL,
 file_id TEXT NOT NULL,
 source_revision TEXT NOT NULL,
 source_size TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('creating','processing','ready','failed')),
 stream_uid TEXT,
 playback_origin TEXT,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(owner_uid,provider,connection_id,file_id,source_revision)
);
CREATE INDEX IF NOT EXISTS idx_optimized_media_owner ON optimized_media_previews(owner_uid,status,updated_at);
