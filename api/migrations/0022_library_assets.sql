CREATE TABLE library_assets (
 library_id TEXT NOT NULL REFERENCES libraries(id), id TEXT NOT NULL,
 provider TEXT NOT NULL CHECK(provider IN ('google_drive','dropbox')),
 connection_id TEXT NOT NULL, file_id TEXT NOT NULL,
 source_name TEXT NOT NULL, mime_type TEXT NOT NULL, size TEXT,
 source_revision TEXT, observed_at INTEGER NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('available','unavailable','restricted','source_trashed')),
 PRIMARY KEY(library_id,id), UNIQUE(library_id,provider,connection_id,file_id)
);
ALTER TABLE library_nodes ADD COLUMN asset_id TEXT;
CREATE UNIQUE INDEX library_folder_asset ON library_nodes(library_id,parent_id,asset_id) WHERE state='active' AND asset_id IS NOT NULL;
CREATE TABLE library_entries (
 library_id TEXT NOT NULL, node_id TEXT NOT NULL, asset_id TEXT NOT NULL,
 PRIMARY KEY(library_id,node_id),
 FOREIGN KEY(library_id,node_id) REFERENCES library_nodes(library_id,id),
 FOREIGN KEY(library_id,asset_id) REFERENCES library_assets(library_id,id)
);
CREATE INDEX library_asset_entries ON library_entries(library_id,asset_id);
