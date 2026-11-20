-- Additive integration state. Existing access and grant rows stay untouched.
ALTER TABLE billing_checkout_intents ADD COLUMN checkout_path TEXT;
ALTER TABLE billing_checkout_intents ADD COLUMN first_due_on TEXT;
ALTER TABLE billing_checkout_intents ADD COLUMN recovery_after INTEGER;
CREATE INDEX billing_checkout_recovery_due ON billing_checkout_intents(recovery_after)
  WHERE status IN ('pending','ready') AND provider_checkout_ref IS NOT NULL;
CREATE UNIQUE INDEX billing_checkout_one_open ON billing_checkout_intents(owner_uid)
  WHERE status IN ('pending','ready');

ALTER TABLE billing_webhook_events ADD COLUMN checkout_intent_ref TEXT;
ALTER TABLE billing_webhook_events ADD COLUMN next_attempt_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE billing_webhook_events ADD COLUMN lease_id TEXT;
ALTER TABLE billing_webhook_events ADD COLUMN lease_until INTEGER NOT NULL DEFAULT 0;
CREATE INDEX billing_webhook_events_due ON billing_webhook_events(status,next_attempt_at,received_at);

CREATE TABLE billing_contracts (
  checkout_intent_id TEXT PRIMARY KEY REFERENCES billing_checkout_intents(id) ON DELETE CASCADE,
  owner_uid TEXT NOT NULL,
  subscription_id TEXT NOT NULL UNIQUE,
  next_due_on TEXT,
  stopped_at INTEGER,
  removed_at INTEGER,
  cancel_after INTEGER,
  cancel_attempts INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(owner_uid,subscription_id) REFERENCES access_subscriptions(owner_uid,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX billing_contract_one_running ON billing_contracts(owner_uid) WHERE removed_at IS NULL;
CREATE INDEX billing_contract_cancel_due ON billing_contracts(cancel_after) WHERE removed_at IS NULL AND cancel_after IS NOT NULL;

CREATE TRIGGER billing_contract_validate_intent BEFORE INSERT ON billing_contracts
WHEN NOT EXISTS (
  SELECT 1 FROM billing_checkout_intents WHERE id=NEW.checkout_intent_id
    AND owner_uid=NEW.owner_uid AND status IN ('pending','ready')
) OR EXISTS (SELECT 1 FROM account_deletions WHERE owner_uid=NEW.owner_uid)
BEGIN SELECT RAISE(ABORT,'billing_intent_unavailable'); END;

ALTER TABLE billing_payment_records ADD COLUMN details TEXT;
ALTER TABLE billing_payment_records ADD COLUMN invoice_path TEXT;
CREATE INDEX billing_payment_records_by_subscription ON billing_payment_records(subscription_id,due_on DESC,verified_at DESC);
CREATE INDEX billing_payment_records_owner_history ON billing_payment_records(owner_uid,due_on DESC,created_at DESC);

CREATE TABLE billing_access_projections (
  owner_uid TEXT PRIMARY KEY REFERENCES access_accounts(owner_uid) ON DELETE CASCADE,
  version TEXT NOT NULL,
  next_attempt_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT
);
CREATE INDEX billing_access_projections_due ON billing_access_projections(next_attempt_at);
