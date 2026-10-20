-- Additive hardening; never rewrite an applied migration.
CREATE TABLE trial_identity_key (
  id INTEGER PRIMARY KEY CHECK(id=1),
  verifier TEXT NOT NULL CHECK(length(verifier)=67 AND substr(verifier,1,3)='v1_')
);
CREATE TRIGGER trial_identity_key_immutable BEFORE UPDATE ON trial_identity_key
BEGIN SELECT RAISE(ABORT,'trial_identity_key_immutable'); END;
