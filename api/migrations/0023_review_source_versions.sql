-- New reviews identify the selected library reference and exact provider revision.
ALTER TABLE review_assets ADD COLUMN library_node_id TEXT;
ALTER TABLE review_assets ADD COLUMN source_revision TEXT;
ALTER TABLE review_assets ADD COLUMN source_size TEXT;
