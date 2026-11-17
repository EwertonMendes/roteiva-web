-- Old failed rows may have been accepted by the provider before the status write.
-- Explicitly opt in only new, definitive provider rejections to safe retries.
ALTER TABLE feedback_reports ADD COLUMN retry_safe INTEGER NOT NULL DEFAULT 0 CHECK(retry_safe IN (0,1));

-- Bound retries of the same request key; new rows begin with one attempt.
ALTER TABLE feedback_reports ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 1 CHECK(attempt_count BETWEEN 1 AND 3);
