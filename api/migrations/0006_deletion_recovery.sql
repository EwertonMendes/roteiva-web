-- Preserve the failed stage for audited, single-operation manual recovery.
ALTER TABLE account_deletions ADD COLUMN failed_phase TEXT
  CHECK(failed_phase IS NULL OR failed_phase IN ('locking','revoking','firestore','identity'));

-- Close the race between the route check and creation of an OAuth transaction.
CREATE TRIGGER reject_oauth_transaction_for_deleting_user
BEFORE INSERT ON oauth_transactions
WHEN EXISTS (SELECT 1 FROM account_deletions WHERE owner_uid=NEW.owner_uid)
BEGIN SELECT RAISE(ABORT,'account_deleting'); END;

-- An OAuth exchange can already be in flight when deletion is requested.
-- Keep a durable guard until its grant is either stored or revoked.
CREATE TABLE oauth_exchange_guards (
  exchange_id TEXT PRIMARY KEY,
  owner_uid TEXT NOT NULL,
  encrypted_token TEXT,
  started_at INTEGER NOT NULL
);
CREATE INDEX oauth_exchange_owner ON oauth_exchange_guards(owner_uid);
CREATE TRIGGER reject_exchange_for_deleting_user
BEFORE INSERT ON oauth_exchange_guards
WHEN EXISTS (SELECT 1 FROM account_deletions WHERE owner_uid=NEW.owner_uid)
BEGIN SELECT RAISE(ABORT,'account_deleting'); END;
