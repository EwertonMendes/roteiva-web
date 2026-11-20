-- Inbox only: no payment processing or entitlement writes in this migration.
-- Unique provider + event ID makes at-least-once delivery harmless.
-- Store minimal references, never the raw provider payload or cardholder data.
CREATE TABLE billing_webhook_events (
  provider TEXT NOT NULL CHECK(provider IN ('asaas')),
  event_id TEXT NOT NULL CHECK(length(event_id) BETWEEN 1 AND 240),
  event_type TEXT NOT NULL CHECK(length(event_type) BETWEEN 1 AND 96),
  resource_type TEXT NOT NULL CHECK(resource_type IN ('checkout','subscription','payment','other')),
  resource_ref TEXT CHECK(resource_ref IS NULL OR length(resource_ref) BETWEEN 1 AND 160),
  subscription_ref TEXT CHECK(subscription_ref IS NULL OR length(subscription_ref) BETWEEN 1 AND 160),
  status TEXT NOT NULL CHECK(status IN ('pending','review','processed','ignored')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  received_at INTEGER NOT NULL CHECK(received_at >= 0),
  updated_at INTEGER NOT NULL CHECK(updated_at >= received_at),
  processed_at INTEGER CHECK(processed_at IS NULL OR processed_at >= received_at),
  last_error_code TEXT CHECK(last_error_code IS NULL OR length(last_error_code) BETWEEN 1 AND 80),
  PRIMARY KEY(provider,event_id)
);
CREATE INDEX billing_webhook_events_pending ON billing_webhook_events(status,received_at);
