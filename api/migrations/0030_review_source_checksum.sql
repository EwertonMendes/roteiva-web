-- Optional provider checksum is evidence in the immutable content snapshot, never an authorization substitute.
ALTER TABLE review_assets ADD COLUMN source_checksum TEXT;
