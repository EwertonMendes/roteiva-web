-- Commercial access is independent from Firebase login and business documents.
-- This migration does not change access for existing users until enrollment via /access/ensure.
CREATE TABLE access_accounts (
  owner_uid TEXT PRIMARY KEY,
  trial_started_at INTEGER NOT NULL,
  trial_ends_at INTEGER NOT NULL,
  suspended_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK(trial_ends_at > trial_started_at),
  CHECK(trial_ends_at - trial_started_at = 604800000)
);
CREATE TABLE access_grants (
  id TEXT PRIMARY KEY,
  owner_uid TEXT NOT NULL REFERENCES access_accounts(owner_uid) ON DELETE CASCADE,
  grant_kind TEXT NOT NULL CHECK(grant_kind IN ('complimentary','lifetime')),
  starts_at INTEGER NOT NULL,
  ends_at INTEGER,
  revoked_at INTEGER,
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 500),
  created_at INTEGER NOT NULL,
  CHECK((grant_kind='lifetime' AND ends_at IS NULL) OR (grant_kind='complimentary' AND ends_at > starts_at))
);
CREATE INDEX access_grants_owner ON access_grants(owner_uid,revoked_at,ends_at);
CREATE TABLE access_subscriptions (
  id TEXT PRIMARY KEY,
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
