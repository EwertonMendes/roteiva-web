-- Old failed rows may have been accepted by the provider before the status write.
-- Explicitly opt in only new, definitive provider rejections to safe retries.
ALTER TABLE feedback_reports ADD COLUMN retry_safe INTEGER NOT NULL DEFAULT 0 CHECK(retry_safe IN (0,1));
