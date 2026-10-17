-- Distinguish narrow per-file consent from optional broad folder-library consent.
ALTER TABLE oauth_transactions ADD COLUMN scope_mode TEXT NOT NULL DEFAULT 'files' CHECK (scope_mode IN ('files','folders'));
