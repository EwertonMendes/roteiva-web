-- Atomic fences: late requests cannot recreate data after account deletion starts.

CREATE TRIGGER library_owner_deletion_insert BEFORE INSERT ON libraries
WHEN EXISTS(SELECT 1 FROM account_deletions WHERE owner_uid=NEW.owner_uid)
BEGIN SELECT RAISE(ABORT,'account_deleting'); END;

CREATE TRIGGER library_owner_deletion_update BEFORE UPDATE ON libraries
WHEN NEW.state='active' AND EXISTS(SELECT 1 FROM account_deletions WHERE owner_uid=NEW.owner_uid)
BEGIN SELECT RAISE(ABORT,'account_deleting'); END;

CREATE TRIGGER library_nodes_deletion_insert BEFORE INSERT ON library_nodes
WHEN NOT EXISTS(SELECT 1 FROM libraries l WHERE l.id=NEW.library_id AND l.state='active' AND NOT EXISTS(SELECT 1 FROM account_deletions d WHERE d.owner_uid=l.owner_uid))
BEGIN SELECT RAISE(ABORT,'account_deleting'); END;

CREATE TRIGGER library_nodes_deletion_update BEFORE UPDATE ON library_nodes
WHEN NOT EXISTS(SELECT 1 FROM libraries l WHERE l.id=NEW.library_id AND l.state='active' AND NOT EXISTS(SELECT 1 FROM account_deletions d WHERE d.owner_uid=l.owner_uid))
BEGIN SELECT RAISE(ABORT,'account_deleting'); END;

CREATE TRIGGER library_assets_deletion_insert BEFORE INSERT ON library_assets
WHEN NOT EXISTS(SELECT 1 FROM libraries l WHERE l.id=NEW.library_id AND l.state='active' AND NOT EXISTS(SELECT 1 FROM account_deletions d WHERE d.owner_uid=l.owner_uid))
BEGIN SELECT RAISE(ABORT,'account_deleting'); END;

CREATE TRIGGER library_assets_deletion_update BEFORE UPDATE ON library_assets
WHEN NOT EXISTS(SELECT 1 FROM libraries l WHERE l.id=NEW.library_id AND l.state='active' AND NOT EXISTS(SELECT 1 FROM account_deletions d WHERE d.owner_uid=l.owner_uid))
BEGIN SELECT RAISE(ABORT,'account_deleting'); END;

CREATE TRIGGER library_entries_deletion_insert BEFORE INSERT ON library_entries
WHEN NOT EXISTS(SELECT 1 FROM libraries l WHERE l.id=NEW.library_id AND l.state='active' AND NOT EXISTS(SELECT 1 FROM account_deletions d WHERE d.owner_uid=l.owner_uid))
BEGIN SELECT RAISE(ABORT,'account_deleting'); END;

CREATE TRIGGER library_entries_deletion_update BEFORE UPDATE ON library_entries
WHEN NOT EXISTS(SELECT 1 FROM libraries l WHERE l.id=NEW.library_id AND l.state='active' AND NOT EXISTS(SELECT 1 FROM account_deletions d WHERE d.owner_uid=l.owner_uid))
BEGIN SELECT RAISE(ABORT,'account_deleting'); END;

CREATE TRIGGER library_upload_targets_deletion_insert BEFORE INSERT ON library_upload_targets
WHEN NOT EXISTS(SELECT 1 FROM libraries l WHERE l.id=NEW.library_id AND l.state='active' AND NOT EXISTS(SELECT 1 FROM account_deletions d WHERE d.owner_uid=l.owner_uid))
BEGIN SELECT RAISE(ABORT,'account_deleting'); END;

CREATE TRIGGER library_upload_targets_deletion_update BEFORE UPDATE ON library_upload_targets
WHEN NOT EXISTS(SELECT 1 FROM libraries l WHERE l.id=NEW.library_id AND l.state='active' AND NOT EXISTS(SELECT 1 FROM account_deletions d WHERE d.owner_uid=l.owner_uid))
BEGIN SELECT RAISE(ABORT,'account_deleting'); END;

CREATE TRIGGER review_owner_deletion_insert BEFORE INSERT ON review_requests
WHEN EXISTS(SELECT 1 FROM account_deletions WHERE owner_uid=NEW.owner_uid)
BEGIN SELECT RAISE(ABORT,'account_deleting'); END;

CREATE TRIGGER review_owner_deletion_update BEFORE UPDATE ON review_requests
WHEN NEW.status NOT IN ('closing','closed') AND EXISTS(SELECT 1 FROM account_deletions WHERE owner_uid=NEW.owner_uid)
BEGIN SELECT RAISE(ABORT,'account_deleting'); END;

CREATE TRIGGER review_asset_owner_deletion_insert BEFORE INSERT ON review_assets
WHEN EXISTS(SELECT 1 FROM review_requests r JOIN account_deletions d ON d.owner_uid=r.owner_uid WHERE r.id=NEW.review_id)
BEGIN SELECT RAISE(ABORT,'account_deleting'); END;

CREATE TRIGGER review_session_authority_insert BEFORE INSERT ON review_sessions
WHEN NOT EXISTS(SELECT 1 FROM review_requests r WHERE r.id=NEW.review_id AND r.status IN ('pending','changes','approved') AND r.current_version=NEW.version AND r.token_hash=NEW.invite_hash AND r.expires_at>unixepoch()*1000 AND NOT EXISTS(SELECT 1 FROM account_deletions d WHERE d.owner_uid=r.owner_uid))
BEGIN SELECT RAISE(ABORT,'review_session_expired'); END;

CREATE TRIGGER review_session_authority_update BEFORE UPDATE ON review_sessions
WHEN NOT EXISTS(SELECT 1 FROM review_requests r WHERE r.id=NEW.review_id AND r.status IN ('pending','changes','approved') AND r.current_version=NEW.version AND r.token_hash=NEW.invite_hash AND r.expires_at>unixepoch()*1000 AND NOT EXISTS(SELECT 1 FROM account_deletions d WHERE d.owner_uid=r.owner_uid))
BEGIN SELECT RAISE(ABORT,'review_session_expired'); END;
