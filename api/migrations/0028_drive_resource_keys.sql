-- Link-shared resource keys are metadata credentials, encrypted with the existing keyring.
CREATE TABLE drive_resource_keys (
 connection_id TEXT NOT NULL REFERENCES drive_connections(id) ON DELETE CASCADE,
 owner_uid TEXT NOT NULL, file_id TEXT NOT NULL, encrypted_key TEXT NOT NULL, updated_at INTEGER NOT NULL,
 PRIMARY KEY(connection_id,file_id)
);
CREATE TRIGGER resource_key_owner_insert BEFORE INSERT ON drive_resource_keys
WHEN NOT EXISTS(SELECT 1 FROM drive_connections c WHERE c.id=NEW.connection_id AND c.owner_uid=NEW.owner_uid AND c.status='connected' AND NOT EXISTS(SELECT 1 FROM account_deletions d WHERE d.owner_uid=c.owner_uid))
BEGIN SELECT RAISE(ABORT,'account_deleting'); END;
CREATE TRIGGER resource_key_owner_update BEFORE UPDATE ON drive_resource_keys
WHEN NOT EXISTS(SELECT 1 FROM drive_connections c WHERE c.id=NEW.connection_id AND c.owner_uid=NEW.owner_uid AND c.status='connected' AND NOT EXISTS(SELECT 1 FROM account_deletions d WHERE d.owner_uid=c.owner_uid))
BEGIN SELECT RAISE(ABORT,'account_deleting'); END;
