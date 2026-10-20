-- A fixed cohort/expiry makes retries idempotent; no moving beta window.
CREATE TABLE access_rollout (
 id INTEGER NOT NULL PRIMARY KEY CHECK(id=1),
 cutoff_at INTEGER NOT NULL,
 beta_ends_at INTEGER NOT NULL CHECK(beta_ends_at-cutoff_at=2592000000),
 cursor TEXT,
 processed INTEGER NOT NULL DEFAULT 0,
 completed_at INTEGER,
 updated_at INTEGER NOT NULL
);
INSERT INTO access_rollout(id,cutoff_at,beta_ends_at,updated_at)
VALUES(1,unixepoch()*1000,unixepoch()*1000+2592000000,unixepoch()*1000);
CREATE TRIGGER access_rollout_dates_immutable BEFORE UPDATE OF cutoff_at,beta_ends_at ON access_rollout
WHEN NEW.cutoff_at!=OLD.cutoff_at OR NEW.beta_ends_at!=OLD.beta_ends_at
BEGIN SELECT RAISE(ABORT,'access_rollout_dates_immutable'); END;
CREATE TRIGGER access_account_deletion_guard BEFORE INSERT ON access_accounts
WHEN EXISTS(SELECT 1 FROM account_deletions WHERE owner_uid=NEW.owner_uid)
BEGIN SELECT RAISE(ABORT,'account_deleting'); END;
CREATE TRIGGER access_grant_deletion_guard BEFORE INSERT ON access_grants
WHEN EXISTS(SELECT 1 FROM account_deletions WHERE owner_uid=NEW.owner_uid)
BEGIN SELECT RAISE(ABORT,'account_deleting'); END;
