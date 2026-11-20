
-- Financial consent and the exact terms for each future renewal. Existing paid periods stay intact.
CREATE TABLE billing_plan_changes (
  id TEXT PRIMARY KEY,
  owner_uid TEXT NOT NULL,
  subscription_id TEXT NOT NULL,
  plan_code TEXT NOT NULL CHECK(plan_code IN ('quarterly','yearly')),
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
  catalog_version TEXT NOT NULL,
  effective_on TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('applying','verifying','scheduled','applied','rejected','review')),
  next_due_on TEXT,
  retry_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(owner_uid,subscription_id) REFERENCES access_subscriptions(owner_uid,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX billing_plan_changes_open ON billing_plan_changes(subscription_id)
  WHERE state IN ('applying','verifying','scheduled','review');
CREATE INDEX billing_plan_changes_payment ON billing_plan_changes(subscription_id,effective_on DESC);
CREATE INDEX billing_plan_changes_recovery ON billing_plan_changes(retry_at)
  WHERE state IN ('applying','verifying');
