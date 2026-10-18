-- Fence late OAuth callbacks and token refreshes atomically with the account-deletion job.
-- Revocation transitions to revocation_pending remain allowed.
CREATE TRIGGER reject_drive_connection_for_deleting_user
BEFORE INSERT ON drive_connections
WHEN EXISTS (SELECT 1 FROM account_deletions WHERE owner_uid=NEW.owner_uid AND phase!='completed')
BEGIN SELECT RAISE(ABORT,'account_deleting'); END;

CREATE TRIGGER reject_drive_refresh_for_deleting_user
BEFORE UPDATE ON drive_connections
WHEN NEW.status='connected' AND
  EXISTS (SELECT 1 FROM account_deletions WHERE owner_uid=NEW.owner_uid AND phase!='completed')
BEGIN SELECT RAISE(ABORT,'account_deleting'); END;
