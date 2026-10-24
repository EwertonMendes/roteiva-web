-- Keep Dropbox refresh leases and OAuth issuance safe during account deletion.
ALTER TABLE dropbox_connections ADD COLUMN refresh_lease_id TEXT;
ALTER TABLE dropbox_connections ADD COLUMN refresh_lease_until INTEGER NOT NULL DEFAULT 0;
ALTER TABLE dropbox_connections ADD COLUMN refresh_retry_after INTEGER NOT NULL DEFAULT 0;
ALTER TABLE oauth_exchange_guards ADD COLUMN provider TEXT NOT NULL DEFAULT 'google_drive'
 CHECK(provider IN ('google_drive','dropbox'));
CREATE TRIGGER reject_dropbox_connection_for_deleting_user BEFORE INSERT ON dropbox_connections
WHEN EXISTS(SELECT 1 FROM account_deletions WHERE owner_uid=NEW.owner_uid)
BEGIN SELECT RAISE(ABORT,'account_deleting'); END;
CREATE TRIGGER reject_dropbox_refresh_for_deleting_user BEFORE UPDATE ON dropbox_connections
WHEN NEW.status='connected' AND EXISTS(SELECT 1 FROM account_deletions WHERE owner_uid=NEW.owner_uid)
BEGIN SELECT RAISE(ABORT,'account_deleting'); END;
CREATE TRIGGER reject_dropbox_transaction_for_deleting_user BEFORE INSERT ON dropbox_oauth_transactions
WHEN EXISTS(SELECT 1 FROM account_deletions WHERE owner_uid=NEW.owner_uid)
BEGIN SELECT RAISE(ABORT,'account_deleting'); END;
