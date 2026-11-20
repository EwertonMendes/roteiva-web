-- Preserve the highest verified completed refund total without rewriting existing ledger rows.
ALTER TABLE billing_payment_records ADD COLUMN refunded_amount_cents INTEGER NOT NULL DEFAULT 0
  CHECK(refunded_amount_cents >= 0 AND refunded_amount_cents <= amount_cents);
