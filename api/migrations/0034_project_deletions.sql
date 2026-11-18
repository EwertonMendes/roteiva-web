-- Project deletion is a durable, owner-scoped saga. Tombstones remain to fence stale writes.
CREATE TABLE project_deletions (
 owner_uid TEXT NOT NULL,
 project_id INTEGER NOT NULL CHECK(project_id>0),
 operation_id TEXT NOT NULL UNIQUE,
 phase TEXT NOT NULL DEFAULT 'locking'
   CHECK(phase IN ('locking','reviews','uploads','library','previews','firestore','completed','manual_review')),
 attempts INTEGER NOT NULL DEFAULT 0,
 lease_id TEXT,
 lease_until INTEGER NOT NULL DEFAULT 0,
 next_attempt_at INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 completed_at INTEGER,
 error_code TEXT,
 PRIMARY KEY(owner_uid,project_id)
);
CREATE INDEX project_deletions_queue ON project_deletions(phase,next_attempt_at,lease_until);

CREATE TABLE project_deletion_previews (
 owner_uid TEXT NOT NULL, project_id INTEGER NOT NULL,
 provider TEXT NOT NULL, connection_id TEXT NOT NULL, file_id TEXT NOT NULL, source_revision TEXT NOT NULL,
 PRIMARY KEY(owner_uid,project_id,provider,connection_id,file_id,source_revision),
 FOREIGN KEY(owner_uid,project_id) REFERENCES project_deletions(owner_uid,project_id) ON DELETE CASCADE
);

-- Reject new data as soon as the D1 deletion request is accepted, before cross-store cleanup.
CREATE TRIGGER project_library_insert_fence BEFORE INSERT ON libraries
WHEN EXISTS(SELECT 1 FROM project_deletions p WHERE p.owner_uid=NEW.owner_uid AND p.project_id=NEW.project_id)
BEGIN SELECT RAISE(ABORT,'project_deleting'); END;
CREATE TRIGGER project_review_insert_fence BEFORE INSERT ON review_requests
WHEN EXISTS(SELECT 1 FROM project_deletions p WHERE p.owner_uid=NEW.owner_uid AND p.project_id=NEW.project_id)
BEGIN SELECT RAISE(ABORT,'project_deleting'); END;
CREATE TRIGGER project_drive_upload_insert_fence BEFORE INSERT ON drive_upload_attempts
WHEN EXISTS(SELECT 1 FROM project_deletions p WHERE p.owner_uid=NEW.owner_uid AND p.project_id=NEW.project_id)
BEGIN SELECT RAISE(ABORT,'project_deleting'); END;
CREATE TRIGGER project_dropbox_upload_insert_fence BEFORE INSERT ON dropbox_upload_attempts
WHEN EXISTS(SELECT 1 FROM project_deletions p WHERE p.owner_uid=NEW.owner_uid AND p.project_id=NEW.project_id)
BEGIN SELECT RAISE(ABORT,'project_deleting'); END;
-- Existing libraries are also fenced: root and children cannot be edited after request.
CREATE TRIGGER project_library_node_insert_fence BEFORE INSERT ON library_nodes
WHEN EXISTS(SELECT 1 FROM libraries l JOIN project_deletions p
 ON p.owner_uid=l.owner_uid AND p.project_id=l.project_id WHERE l.id=NEW.library_id)
BEGIN SELECT RAISE(ABORT,'project_deleting'); END;
CREATE TRIGGER project_library_node_update_fence BEFORE UPDATE ON library_nodes
WHEN EXISTS(SELECT 1 FROM libraries l JOIN project_deletions p
 ON p.owner_uid=l.owner_uid AND p.project_id=l.project_id WHERE l.id=NEW.library_id)
BEGIN SELECT RAISE(ABORT,'project_deleting'); END;
CREATE TRIGGER project_library_asset_insert_fence BEFORE INSERT ON library_assets
WHEN EXISTS(SELECT 1 FROM libraries l JOIN project_deletions p
 ON p.owner_uid=l.owner_uid AND p.project_id=l.project_id WHERE l.id=NEW.library_id)
BEGIN SELECT RAISE(ABORT,'project_deleting'); END;
CREATE TRIGGER project_library_asset_update_fence BEFORE UPDATE ON library_assets
WHEN EXISTS(SELECT 1 FROM libraries l JOIN project_deletions p
 ON p.owner_uid=l.owner_uid AND p.project_id=l.project_id WHERE l.id=NEW.library_id)
BEGIN SELECT RAISE(ABORT,'project_deleting'); END;
CREATE TRIGGER project_library_entry_insert_fence BEFORE INSERT ON library_entries
WHEN EXISTS(SELECT 1 FROM libraries l JOIN project_deletions p
 ON p.owner_uid=l.owner_uid AND p.project_id=l.project_id WHERE l.id=NEW.library_id)
BEGIN SELECT RAISE(ABORT,'project_deleting'); END;
CREATE TRIGGER project_library_entry_update_fence BEFORE UPDATE ON library_entries
WHEN EXISTS(SELECT 1 FROM libraries l JOIN project_deletions p
 ON p.owner_uid=l.owner_uid AND p.project_id=l.project_id WHERE l.id=NEW.library_id)
BEGIN SELECT RAISE(ABORT,'project_deleting'); END;
CREATE TRIGGER project_library_structure_insert_fence BEFORE INSERT ON library_structure_attempts
WHEN EXISTS(SELECT 1 FROM libraries l JOIN project_deletions p
 ON p.owner_uid=l.owner_uid AND p.project_id=l.project_id WHERE l.id=NEW.library_id)
BEGIN SELECT RAISE(ABORT,'project_deleting'); END;
CREATE TRIGGER project_library_upload_target_insert_fence BEFORE INSERT ON library_upload_targets
WHEN EXISTS(SELECT 1 FROM libraries l JOIN project_deletions p
 ON p.owner_uid=l.owner_uid AND p.project_id=l.project_id WHERE l.id=NEW.library_id)
BEGIN SELECT RAISE(ABORT,'project_deleting'); END;

CREATE TRIGGER project_library_structure_update_fence BEFORE UPDATE ON library_structure_attempts
WHEN EXISTS(SELECT 1 FROM libraries l JOIN project_deletions p
 ON p.owner_uid=l.owner_uid AND p.project_id=l.project_id WHERE l.id=NEW.library_id)
BEGIN SELECT RAISE(ABORT,'project_deleting'); END;
CREATE TRIGGER project_library_upload_target_update_fence BEFORE UPDATE ON library_upload_targets
WHEN EXISTS(SELECT 1 FROM libraries l JOIN project_deletions p
 ON p.owner_uid=l.owner_uid AND p.project_id=l.project_id WHERE l.id=NEW.library_id)
BEGIN SELECT RAISE(ABORT,'project_deleting'); END;
