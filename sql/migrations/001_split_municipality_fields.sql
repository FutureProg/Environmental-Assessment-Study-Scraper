-- Migration 001: Replace single municipality_id with municipality_owner FK + municipality_areas TEXT[]
--
-- Rationale: A study conducted by one municipality (owner) may cover multiple lower-tier
-- municipalities (areas). Halton Region's website lists the same study once per involved
-- municipality, so a single municipality_id column would produce duplicate assessment rows.
--
-- Areas are stored as a TEXT[] rather than a junction table — the scraper produces them as
-- plain name strings, a junction table would require a name→ID lookup on every insert, and
-- Postgres TEXT[] is directly queryable (e.g. WHERE 'Burlington' = ANY(municipality_areas)).

-- 1. Drop the old single-municipality column and its unique constraint
ALTER TABLE environmental_assessments.assessments
  DROP CONSTRAINT assessments_title_municipality_unique;

ALTER TABLE environmental_assessments.assessments
  DROP COLUMN municipality_id;

-- 2. Add municipality_owner (FK) and municipality_areas (TEXT[])
ALTER TABLE environmental_assessments.assessments
  ADD COLUMN municipality_owner INTEGER NOT NULL
    REFERENCES environmental_assessments.municipalities (id),
  ADD COLUMN municipality_areas TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN environmental_assessments.assessments.municipality_owner
  IS 'The municipality responsible for conducting this study';
COMMENT ON COLUMN environmental_assessments.assessments.municipality_areas
  IS 'Geographic areas the study covers, as municipality name strings (e.g. ''{Burlington, Oakville}''). Queryable with = ANY(municipality_areas)';

-- 3. New unique constraint scoped to owner
ALTER TABLE environmental_assessments.assessments
  ADD CONSTRAINT assessments_title_owner_unique UNIQUE (title, municipality_owner);
