-- Preserve only keyed pseudonymous identity markers after personal account deletion.
-- No raw e-mail, provider subject, original UID, or FK to access_accounts.
-- All markers are written only by the server after verifying a Google Firebase ID token.
CREATE TABLE trial_identity_claims (
  fingerprint TEXT PRIMARY KEY NOT NULL CHECK(length(fingerprint)=67 AND substr(fingerprint,1,3)='v1_'),
  first_owner_tag TEXT NOT NULL CHECK(length(first_owner_tag)=67 AND substr(first_owner_tag,1,3)='v1_'),
  claimed_at INTEGER NOT NULL CHECK(typeof(claimed_at)='integer' AND claimed_at>=0)
);
CREATE INDEX trial_identity_claims_owner ON trial_identity_claims(first_owner_tag);
-- First trial ownership must not be transferred when the Auth UID is recreated.
CREATE TRIGGER trial_identity_claims_immutable BEFORE UPDATE ON trial_identity_claims
BEGIN SELECT RAISE(ABORT,'trial_identity_claims_immutable'); END;
