-- Commercial access is independent from Firebase login and business documents.
-- This migration does not change access for existing users until enrollment via /access/ensure.
CREATE TABLE access_accounts (
  owner_uid TEXT NOT NULL PRIMARY KEY CHECK(length(owner_uid) BETWEEN 1 AND 128),
  trial_started_at INTEGER NOT NULL,
  trial_ends_at INTEGER NOT NULL,
  suspended_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK(trial_ends_at > trial_started_at),
  CHECK(trial_ends_at - trial_started_at = 604800000),
  CHECK(typeof(trial_started_at)='integer' AND trial_started_at>=0),
  CHECK(typeof(trial_ends_at)='integer'),
  CHECK(suspended_at IS NULL OR (typeof(suspended_at)='integer' AND suspended_at>=0))
);
CREATE TRIGGER access_trial_immutable BEFORE UPDATE OF owner_uid,trial_started_at,trial_ends_at ON access_accounts
WHEN NEW.owner_uid!=OLD.owner_uid OR NEW.trial_started_at!=OLD.trial_started_at OR NEW.trial_ends_at!=OLD.trial_ends_at
BEGIN SELECT RAISE(ABORT,'access_trial_immutable'); END;
CREATE TABLE access_grants (
  id TEXT NOT NULL PRIMARY KEY,
  owner_uid TEXT NOT NULL REFERENCES access_accounts(owner_uid) ON DELETE CASCADE,
  grant_kind TEXT NOT NULL CHECK(grant_kind IN ('complimentary','lifetime')),
  starts_at INTEGER NOT NULL,
  ends_at INTEGER,
  revoked_at INTEGER,
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 500),
  created_at INTEGER NOT NULL,
  CHECK(typeof(starts_at)='integer' AND starts_at>=0),
  CHECK((grant_kind='lifetime' AND ends_at IS NULL) OR
        (grant_kind='complimentary' AND ends_at IS NOT NULL AND typeof(ends_at)='integer' AND ends_at > starts_at))
);
CREATE INDEX access_grants_owner ON access_grants(owner_uid,revoked_at,ends_at);
CREATE TABLE access_subscriptions (
  id TEXT NOT NULL PRIMARY KEY,
  owner_uid TEXT NOT NULL REFERENCES access_accounts(owner_uid) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_reference TEXT NOT NULL UNIQUE,
  cadence TEXT NOT NULL CHECK(cadence IN ('monthly','quarterly','yearly')),
  status TEXT NOT NULL CHECK(status IN ('active','past_due','canceled','expired')),
  paid_until INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX access_subscriptions_owner ON access_subscriptions(owner_uid,status,paid_until);
-- No customer-facing endpoint may insert, update or delete these records.
-- A separate administration service will be designed and authenticated later.
