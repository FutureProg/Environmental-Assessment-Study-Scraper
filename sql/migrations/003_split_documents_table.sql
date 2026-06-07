-- Migration 003: Split documents out of engagement_events into a dedicated documents table
--
-- Rationale: Documents have a fundamentally different shape from engagement events —
-- they carry no event_date, end_date, or location, and are deduped purely by URL.
-- Keeping them in engagement_events required forcing null into three columns and
-- stuffing the document title + publication date into the notes field as a combined string.
-- A separate table gives each concept its own schema and makes queries unambiguous.

-- 1. Create the documents table
CREATE TABLE environmental_assessments.documents (
  id              SERIAL PRIMARY KEY,
  study_id        INTEGER NOT NULL REFERENCES environmental_assessments.assessments (id) ON DELETE CASCADE,
  url             TEXT NOT NULL,
  title           TEXT,
  published_label TEXT,
  fingerprint     TEXT NOT NULL,
  inserted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT documents_study_fingerprint_unique UNIQUE (study_id, fingerprint)
);

COMMENT ON TABLE  environmental_assessments.documents                 IS 'Published documents and reports associated with an EA study';
COMMENT ON COLUMN environmental_assessments.documents.study_id        IS 'The assessment this document belongs to';
COMMENT ON COLUMN environmental_assessments.documents.url             IS 'Direct link to the document or document listing page';
COMMENT ON COLUMN environmental_assessments.documents.title           IS 'Display name of the document as it appears on the study page';
COMMENT ON COLUMN environmental_assessments.documents.published_label IS 'Unparsed publication date label scraped from the website, e.g. "August 2023"';
COMMENT ON COLUMN environmental_assessments.documents.fingerprint     IS 'Deduplication key: url — used to avoid reinserting known documents';
COMMENT ON COLUMN environmental_assessments.documents.inserted_at     IS 'When this record was created';

CREATE INDEX documents_study_id_idx ON environmental_assessments.documents (study_id);

-- 2. Migrate existing document rows from engagement_events
--    The notes column previously contained "title (date)" or just "title" — stored as-is in title.
INSERT INTO environmental_assessments.documents (study_id, url, title, published_label, fingerprint)
SELECT
  study_id,
  COALESCE(url, ''),
  notes,
  NULL,
  COALESCE(url, fingerprint)
FROM environmental_assessments.engagement_events
WHERE type = 'document';

-- 3. Remove document rows from engagement_events
DELETE FROM environmental_assessments.engagement_events
WHERE type = 'document';

-- 4. Remove 'document' from the engagement_event_type enum.
--    PostgreSQL does not support DROP VALUE on an existing enum, so we recreate the type.

CREATE TYPE environmental_assessments.engagement_event_type_new AS ENUM (
  'open_house',
  'comment_deadline',
  'hearing'
);

ALTER TABLE environmental_assessments.engagement_events
  ALTER COLUMN type TYPE environmental_assessments.engagement_event_type_new
  USING type::text::environmental_assessments.engagement_event_type_new;

DROP TYPE environmental_assessments.engagement_event_type;

ALTER TYPE environmental_assessments.engagement_event_type_new
  RENAME TO engagement_event_type;
