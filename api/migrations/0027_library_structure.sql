CREATE TABLE library_structure_attempts (
 library_id TEXT NOT NULL REFERENCES libraries(id), id TEXT NOT NULL, request_hash TEXT NOT NULL,
 mapping TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('applying','complete')), created_at INTEGER NOT NULL,
 PRIMARY KEY(library_id,id)
);
CREATE TRIGGER structure_owner_deletion_insert BEFORE INSERT ON library_structure_attempts
WHEN NOT EXISTS(SELECT 1 FROM libraries l WHERE l.id=NEW.library_id AND l.state='active' AND NOT EXISTS(SELECT 1 FROM account_deletions d WHERE d.owner_uid=l.owner_uid))
BEGIN SELECT RAISE(ABORT,'account_deleting'); END;
CREATE TRIGGER structure_owner_deletion_update BEFORE UPDATE ON library_structure_attempts
WHEN NOT EXISTS(SELECT 1 FROM libraries l WHERE l.id=NEW.library_id AND l.state='active' AND NOT EXISTS(SELECT 1 FROM account_deletions d WHERE d.owner_uid=l.owner_uid))
BEGIN SELECT RAISE(ABORT,'account_deleting'); END;
