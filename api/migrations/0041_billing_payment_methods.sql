-- Additive payment-method accounting. Existing card subscriptions and ledger rows
-- remain CREDIT_CARD without backfill or provider-side changes.
ALTER TABLE billing_checkout_intents ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'CREDIT_CARD'
  CHECK(payment_method IN ('CREDIT_CARD','PIX'));
ALTER TABLE billing_payment_records ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'CREDIT_CARD'
  CHECK(payment_method IN ('CREDIT_CARD','PIX'));
CREATE INDEX billing_checkout_owner_method ON billing_checkout_intents(owner_uid,payment_method,created_at);
-- Historical cards remain modeled as recurring contracts. PIX purchases use a
-- distinct access_subscriptions row per verified detached payment, identified by
-- the same server-owned intent. The payment ledger still enforces unique refs.
