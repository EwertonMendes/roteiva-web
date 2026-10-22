-- Existing reviews retain their original Drive permission/revocation contract.
-- New reviews default to portal-only access: no public Drive permission is created.
-- Owners may explicitly opt into additional direct Drive sharing for named Google accounts.
ALTER TABLE review_requests ADD COLUMN drive_share_enabled INTEGER NOT NULL DEFAULT 1 CHECK(drive_share_enabled IN (0,1));
