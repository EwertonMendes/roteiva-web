-- Additive foundation; no existing folders, reviews, grants or provider files removed.
CREATE TABLE libraries (
 id TEXT PRIMARY KEY, owner_uid TEXT NOT NULL, project_id INTEGER NOT NULL CHECK(project_id>0),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
 state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','deleting')),
 created_at INTEGER NOT NULL, UNIQUE(owner_uid,project_id)
);
CREATE TABLE library_nodes (
 library_id TEXT NOT NULL REFERENCES libraries(id), id TEXT NOT NULL,
 parent_id TEXT, kind TEXT NOT NULL CHECK(kind IN ('folder','asset')),
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
 state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','trashed')),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
 PRIMARY KEY(library_id,id),
 FOREIGN KEY(library_id,parent_id) REFERENCES library_nodes(library_id,id),
 CHECK((id='root' AND parent_id IS NULL AND kind='folder') OR (id!='root' AND parent_id IS NOT NULL))
);
CREATE INDEX library_children ON library_nodes(library_id,parent_id,state,kind,name,id);
-- The recursive test happens inside the write statement, including concurrent moves.
CREATE TRIGGER library_parent_insert BEFORE INSERT ON library_nodes WHEN NEW.id!='root'
BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM library_nodes WHERE library_id=NEW.library_id AND id=NEW.parent_id AND kind='folder' AND state='active')
 THEN RAISE(ABORT,'library_parent_denied') END;
 SELECT CASE WHEN (WITH RECURSIVE ancestors(id,parent_id,depth) AS (
 SELECT id,parent_id,1 FROM library_nodes WHERE library_id=NEW.library_id AND id=NEW.parent_id
 UNION ALL SELECT n.id,n.parent_id,a.depth+1 FROM library_nodes n JOIN ancestors a ON n.id=a.parent_id AND n.library_id=NEW.library_id WHERE a.depth<=16
 ) SELECT max(depth) FROM ancestors)>16 THEN RAISE(ABORT,'library_depth_exceeded') END;
END;
CREATE TRIGGER library_parent_update BEFORE UPDATE OF parent_id ON library_nodes
BEGIN
 SELECT CASE WHEN OLD.id='root' OR NEW.parent_id IS NULL OR NOT EXISTS(
 SELECT 1 FROM library_nodes WHERE library_id=NEW.library_id AND id=NEW.parent_id AND kind='folder' AND state='active')
 THEN RAISE(ABORT,'library_parent_denied') END;
 SELECT CASE WHEN EXISTS(WITH RECURSIVE descendants(id) AS (
 SELECT OLD.id UNION ALL SELECT n.id FROM library_nodes n JOIN descendants d ON n.parent_id=d.id WHERE n.library_id=OLD.library_id
 ) SELECT 1 FROM descendants WHERE id=NEW.parent_id) THEN RAISE(ABORT,'library_cycle') END;
 SELECT CASE WHEN (
 (WITH RECURSIVE a(id,parent_id,depth) AS (
 SELECT id,parent_id,0 FROM library_nodes WHERE library_id=NEW.library_id AND id=NEW.parent_id
 UNION ALL SELECT n.id,n.parent_id,a.depth+1 FROM library_nodes n JOIN a ON n.id=a.parent_id WHERE n.library_id=NEW.library_id AND a.depth<=16
 ) SELECT max(depth) FROM a) + 1 +
 (WITH RECURSIVE d(id,depth) AS (SELECT OLD.id,0 UNION ALL SELECT n.id,d.depth+1 FROM library_nodes n JOIN d ON n.parent_id=d.id WHERE n.library_id=OLD.library_id AND d.depth<=16)
 SELECT max(depth) FROM d)
 )>16 THEN RAISE(ABORT,'library_depth_exceeded') END;
END;
CREATE TRIGGER library_node_identity BEFORE UPDATE OF library_id,id,kind ON library_nodes
BEGIN SELECT RAISE(ABORT,'library_identity_immutable'); END;
CREATE TRIGGER library_root_state BEFORE UPDATE OF state ON library_nodes WHEN OLD.id='root'
BEGIN SELECT RAISE(ABORT,'library_root_immutable'); END;
CREATE TRIGGER library_root_delete BEFORE DELETE ON library_nodes WHEN OLD.id='root'
 AND EXISTS(SELECT 1 FROM libraries WHERE id=OLD.library_id AND state!='deleting')
BEGIN SELECT RAISE(ABORT,'library_root_immutable'); END;
CREATE TRIGGER library_identity BEFORE UPDATE OF id,owner_uid,project_id ON libraries
BEGIN SELECT RAISE(ABORT,'library_identity_immutable'); END;
