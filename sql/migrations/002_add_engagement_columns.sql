-- end_date for date ranges (e.g. "between Nov 23 and Dec 21")
ALTER TABLE environmental_assessments.engagement_events
  ADD COLUMN end_date TIMESTAMPTZ;

-- fingerprint for deduplication (avoids NULL-in-unique-constraint problems)
ALTER TABLE environmental_assessments.engagement_events
  ADD COLUMN fingerprint TEXT NOT NULL DEFAULT '';

ALTER TABLE environmental_assessments.engagement_events
  ADD CONSTRAINT engagement_events_study_fingerprint_unique
    UNIQUE (study_id, fingerprint);
