ALTER TABLE environmental_assessments.assessments
  ADD COLUMN IF NOT EXISTS content_hash TEXT;

COMMENT ON COLUMN environmental_assessments.assessments.content_hash IS 'SHA-256 hex digest of the detail page content (.hal-ea-studies-detail + .resource-listing-eastudies). Used to skip re-classification when content is unchanged.';
