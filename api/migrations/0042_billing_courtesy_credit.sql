-- Credit remaining finite free access when a new customer buys a recurring
-- card plan. The credit is constant for the lifetime of that recurrence: it
-- does not compound on every renewal. Existing intents get zero credit.
ALTER TABLE billing_checkout_intents ADD COLUMN courtesy_credit_ms INTEGER NOT NULL DEFAULT 0
  CHECK(courtesy_credit_ms>=0 AND courtesy_credit_ms<=31536000000);
