-- Publication probes are bounded across requests; only fresh exact-source checks can publish.
ALTER TABLE review_assets ADD COLUMN source_checked_at INTEGER NOT NULL DEFAULT 0;
