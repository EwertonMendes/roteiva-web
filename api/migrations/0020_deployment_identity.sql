-- Intentionally empty. The guarded provisioning command seals the environment.
CREATE TABLE deployment_identity (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  environment TEXT NOT NULL CHECK (environment IN ('dev','prod'))
);
CREATE TRIGGER deployment_identity_immutable_update BEFORE UPDATE ON deployment_identity
BEGIN SELECT RAISE(ABORT, 'deployment identity is immutable'); END;
CREATE TRIGGER deployment_identity_immutable_delete BEFORE DELETE ON deployment_identity
BEGIN SELECT RAISE(ABORT, 'deployment identity is immutable'); END;
