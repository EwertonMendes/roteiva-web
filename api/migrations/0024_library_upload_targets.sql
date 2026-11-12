CREATE TABLE library_upload_targets (
 library_id TEXT NOT NULL REFERENCES libraries(id), provider TEXT NOT NULL CHECK(provider IN ('google_drive','dropbox')),
 connection_id TEXT NOT NULL, reserved_id TEXT NOT NULL, file_id TEXT,
 state TEXT NOT NULL CHECK(state IN ('reserved','ready')), created_at INTEGER NOT NULL,
 PRIMARY KEY(library_id,provider,connection_id)
);
