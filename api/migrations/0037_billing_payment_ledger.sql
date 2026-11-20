-- Future verified payment ledger only. No access publication or payment processing.
-- A composite foreign key prevents recording a payment under the wrong owner.
CREATE UNIQUE INDEX access_subscriptions_owner_id ON access_subscriptions(owner_uid,id);
CREATE TABLE billing_payment_records (
  id TEXT NOT NULL PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 80),
  owner_uid TEXT NOT NULL,
  subscription_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK(provider IN ('asaas')),
  provider_payment_ref TEXT NOT NULL CHECK(length(provider_payment_ref) BETWEEN 1 AND 160),
  state TEXT NOT NULL CHECK(state IN ('pending','confirmed','received','overdue','refunded','chargeback','review')),
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
  currency TEXT NOT NULL CHECK(currency='BRL'),
  due_on TEXT CHECK(due_on IS NULL OR
    (length(due_on)=10 AND due_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')),
  verified_at INTEGER NOT NULL CHECK(verified_at>=0),
  paid_at INTEGER CHECK(paid_at IS NULL OR paid_at>=0),
  period_ends_at INTEGER CHECK(period_ends_at IS NULL OR period_ends_at>=0),
  applied_at INTEGER CHECK(applied_at IS NULL OR applied_at>=0),
  created_at INTEGER NOT NULL CHECK(created_at>=0),
  updated_at INTEGER NOT NULL CHECK(updated_at>=created_at),
  UNIQUE(provider,provider_payment_ref),
  FOREIGN KEY(owner_uid,subscription_id)
    REFERENCES access_subscriptions(owner_uid,id) ON DELETE CASCADE
);
CREATE INDEX billing_payment_records_subscription ON billing_payment_records(owner_uid,subscription_id,verified_at);
