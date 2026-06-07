CREATE SCHEMA IF NOT EXISTS environmental_assessments;

-- ============================================================
-- Enums
-- ============================================================

CREATE TYPE environmental_assessments.ea_status AS ENUM (
  'on_going',
  'deferred',
  'completed',
  'unknown'
);

CREATE TYPE environmental_assessments.ea_scope AS ENUM (
  'in_scope',
  'out_of_scope',
  'unclassified'
);

CREATE TYPE environmental_assessments.engagement_event_type AS ENUM (
  'open_house',
  'comment_deadline',
  'hearing'
);

-- ============================================================
-- municipalities
-- ============================================================

CREATE TABLE environmental_assessments.municipalities (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  listing_url  TEXT NOT NULL,
  adapter_type TEXT NOT NULL,
  active       BOOLEAN NOT NULL DEFAULT TRUE
);

COMMENT ON COLUMN environmental_assessments.municipalities.name         IS 'Full display name of the municipality';
COMMENT ON COLUMN environmental_assessments.municipalities.listing_url  IS 'URL of the EA listing page to scrape';
COMMENT ON COLUMN environmental_assessments.municipalities.adapter_type IS 'Identifier for the scraper adapter to use (e.g. halton_region, burlington)';
COMMENT ON COLUMN environmental_assessments.municipalities.active       IS 'Whether this municipality is currently being scraped';

INSERT INTO environmental_assessments.municipalities (name, listing_url, adapter_type) VALUES
  ('Halton Region',        'https://www.halton.ca/for-residents/infrastructure-and-growth/municipal-class-environmental-assessment-studies', 'halton_region'),
  ('City of Burlington',   'https://www.burlington.ca/Modules/News/en/Environmental',                                                        'burlington'),
  ('Town of Oakville',     'https://www.oakville.ca/transportation-roads/transportation-roads-studies-and-plans/environmental-assessment-studies/', 'oakville'),
  ('Town of Milton',       'https://www.milton.ca/en/business-and-development/town-projects.aspx',                                            'milton'),
  ('Town of Halton Hills', 'https://www.haltonhills.ca/en/residents/environmental-assessment-ea-studies.aspx',                               'halton_hills');

-- ============================================================
-- assessments
-- ============================================================

CREATE TABLE environmental_assessments.assessments (
  id                 SERIAL PRIMARY KEY,
  title              TEXT NOT NULL,
  municipality_owner INTEGER NOT NULL REFERENCES environmental_assessments.municipalities (id),
  municipality_areas TEXT[] NOT NULL DEFAULT '{}',
  source_url         TEXT NOT NULL,
  status             environmental_assessments.ea_status NOT NULL DEFAULT 'unknown',
  raw_status         TEXT,
  scope              environmental_assessments.ea_scope NOT NULL DEFAULT 'unclassified',
  scope_reasoning    TEXT,
  engagement_data    JSONB,
  last_seen_at       TIMESTAMPTZ,
  inserted_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT assessments_title_owner_unique UNIQUE (title, municipality_owner)
);

COMMENT ON COLUMN environmental_assessments.assessments.id                 IS 'Primary key';
COMMENT ON COLUMN environmental_assessments.assessments.title              IS 'Name of the EA study as it appears on the listing page';
COMMENT ON COLUMN environmental_assessments.assessments.municipality_owner IS 'The municipality responsible for conducting this study';
COMMENT ON COLUMN environmental_assessments.assessments.municipality_areas IS 'Geographic areas the study covers, as municipality name strings (e.g. ''{Burlington, Oakville}''). Queryable with = ANY(municipality_areas)';
COMMENT ON COLUMN environmental_assessments.assessments.source_url         IS 'URL of the individual study page';
COMMENT ON COLUMN environmental_assessments.assessments.status          IS 'Normalised status value derived from raw_status';
COMMENT ON COLUMN environmental_assessments.assessments.raw_status      IS 'Verbatim status string scraped from the website before normalisation';
COMMENT ON COLUMN environmental_assessments.assessments.scope           IS 'Whether this study is relevant to Safe Streets Halton, as determined by Claude';
COMMENT ON COLUMN environmental_assessments.assessments.scope_reasoning IS 'Claude''s explanation for the scope classification';
COMMENT ON COLUMN environmental_assessments.assessments.engagement_data IS 'Unstructured engagement info extracted from the study page (dates, links, etc.)';
COMMENT ON COLUMN environmental_assessments.assessments.last_seen_at    IS 'Last time the scraper confirmed this study still appears on the listing page';
COMMENT ON COLUMN environmental_assessments.assessments.inserted_at     IS 'When this record was first created';
COMMENT ON COLUMN environmental_assessments.assessments.updated_at      IS 'When this record was last modified — maintained automatically by trigger';

CREATE OR REPLACE FUNCTION environmental_assessments.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER assessments_set_updated_at
  BEFORE UPDATE ON environmental_assessments.assessments
  FOR EACH ROW EXECUTE FUNCTION environmental_assessments.set_updated_at();

-- ============================================================
-- engagement_events (optional — drop if keeping JSONB only)
-- ============================================================

CREATE TABLE environmental_assessments.engagement_events (
  id          SERIAL PRIMARY KEY,
  study_id    INTEGER NOT NULL REFERENCES environmental_assessments.assessments (id) ON DELETE CASCADE,
  type        environmental_assessments.engagement_event_type NOT NULL,
  event_date  TIMESTAMPTZ,
  end_date    TIMESTAMPTZ,
  location    TEXT,
  url         TEXT,
  notes       TEXT,
  fingerprint TEXT NOT NULL DEFAULT '',
  inserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT engagement_events_study_fingerprint_unique UNIQUE (study_id, fingerprint)
);

COMMENT ON COLUMN environmental_assessments.engagement_events.study_id    IS 'The assessment this event belongs to';
COMMENT ON COLUMN environmental_assessments.engagement_events.type        IS 'Category of engagement opportunity';
COMMENT ON COLUMN environmental_assessments.engagement_events.event_date  IS 'Start date/time of the event or consultation period (null if unknown)';
COMMENT ON COLUMN environmental_assessments.engagement_events.end_date    IS 'End date/time for multi-day consultation periods (null if single day or unknown)';
COMMENT ON COLUMN environmental_assessments.engagement_events.location    IS 'Physical address or venue name (null for online or deadline-only events)';
COMMENT ON COLUMN environmental_assessments.engagement_events.url         IS 'Link to a registration page, comment form, or document';
COMMENT ON COLUMN environmental_assessments.engagement_events.notes       IS 'Any additional context extracted from the study page';
COMMENT ON COLUMN environmental_assessments.engagement_events.fingerprint IS 'Deduplication key: type:url:event_date — used to avoid reinserting known events';
COMMENT ON COLUMN environmental_assessments.engagement_events.inserted_at IS 'When this record was created';

CREATE INDEX engagement_events_study_id_idx   ON environmental_assessments.engagement_events (study_id);
CREATE INDEX engagement_events_event_date_idx ON environmental_assessments.engagement_events (event_date);

-- ============================================================
-- documents
-- ============================================================

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

