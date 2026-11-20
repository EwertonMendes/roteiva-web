-- Billing foundation only: NO checkout, webhook, transaction or entitlement writes yet.
-- Additive, empty tables. Historical access, grants and trial identities stay untouched.
CREATE TABLE billing_customers (
  owner_uid TEXT NOT NULL PRIMARY KEY REFERENCES access_accounts(owner_uid) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK(length(provider) BETWEEN 1 AND 32),
  provider_customer_ref TEXT NOT NULL UNIQUE CHECK(length(provider_customer_ref) BETWEEN 1 AND 160),
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  updated_at INTEGER NOT NULL CHECK(updated_at >= created_at)
);
CREATE TABLE billing_checkout_intents (
  id TEXT NOT NULL PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 80),
  owner_uid TEXT NOT NULL REFERENCES access_accounts(owner_uid) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK(length(provider) BETWEEN 1 AND 32),
  plan_code TEXT NOT NULL CHECK(plan_code IN ('monthly','quarterly','yearly')),
  pricing_version TEXT NOT NULL CHECK(length(pricing_version) BETWEEN 1 AND 40),
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
  status TEXT NOT NULL CHECK(status IN ('pending','ready','completed','expired','canceled','failed')),
  provider_checkout_ref TEXT UNIQUE,
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  expires_at INTEGER NOT NULL CHECK(expires_at > created_at),
  updated_at INTEGER NOT NULL CHECK(updated_at >= created_at)
);
CREATE INDEX billing_checkout_intents_owner ON billing_checkout_intents(owner_uid,created_at);
CREATE INDEX billing_checkout_intents_expiry ON billing_checkout_intents(status,expires_at);
