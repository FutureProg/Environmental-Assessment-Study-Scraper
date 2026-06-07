import postgres from 'postgres';
import type { AssessmentDiff, EngagementEvent, StudyDocument, EAStatus, EAStudy, EAClassification, ScopeResult } from './types.ts';

export interface StoredAssessment {
  contentHash: string | null;
  scope: ScopeResult;
  scopeReasoning: string | null;
}

let _sql: ReturnType<typeof postgres> | null = null;

function getSql() {
  if (!_sql) {
    const cert = Deno.env.get('DATABASE_CERT');
    _sql = postgres(Deno.env.get('DATABASE_URL')!, {
      ssl: cert ? { ca: cert } : undefined,
    });
  }
  return _sql;
}

export async function getStoredAssessment(title: string, owner: string, sourceUrl: string): Promise<StoredAssessment | null> {
  const sql = getSql();
  const [row] = await sql<{ content_hash: string | null; scope: ScopeResult; scope_reasoning: string | null }[]>`
    SELECT a.content_hash, a.scope, a.scope_reasoning
    FROM environmental_assessments.assessments a
    JOIN environmental_assessments.municipalities m ON m.id = a.municipality_owner
    WHERE a.title = ${title} AND m.name = ${owner} AND a.source_url = ${sourceUrl}
  `;
  if (!row) return null;
  return { contentHash: row.content_hash, scope: row.scope, scopeReasoning: row.scope_reasoning };
}

export async function upsertAssessment(
  study: EAStudy,
  classification: EAClassification,
  contentHash: string,
): Promise<AssessmentDiff> {
  const sql = getSql();

  // Capture existing state before upsert for change detection
  const [existing] = await sql<{ id: number; status: string; scope: string }[]>`
    SELECT a.id, a.status, a.scope
    FROM environmental_assessments.assessments a
    JOIN environmental_assessments.municipalities m ON m.id = a.municipality_owner
    WHERE a.title = ${study.title} AND m.name = ${study.municipalityOwner} AND a.source_url = ${study.sourceUrl}
  `;

  const [row] = await sql<{ id: number; is_new: boolean }[]>`
    INSERT INTO environmental_assessments.assessments
      (title, municipality_owner, municipality_areas, source_url,
       status, raw_status, scope, scope_reasoning, content_hash, last_seen_at)
    VALUES (
      ${study.title},
      (SELECT id FROM environmental_assessments.municipalities WHERE name = ${study.municipalityOwner}),
      ${study.municipalityAreas},
      ${study.sourceUrl},
      ${study.status}::environmental_assessments.ea_status,
      ${study.rawStatus},
      ${classification.scope}::environmental_assessments.ea_scope,
      ${classification.scopeReasoning},
      ${contentHash},
      NOW()
    )
    ON CONFLICT (title, municipality_owner) DO UPDATE SET
      municipality_areas = EXCLUDED.municipality_areas,
      source_url         = EXCLUDED.source_url,
      status             = EXCLUDED.status,
      raw_status         = EXCLUDED.raw_status,
      scope              = EXCLUDED.scope,
      scope_reasoning    = EXCLUDED.scope_reasoning,
      content_hash       = EXCLUDED.content_hash,
      last_seen_at       = EXCLUDED.last_seen_at
    RETURNING id, (xmax = 0) AS is_new
  `;

  const diff: AssessmentDiff = {
    id: row.id,
    title: study.title,
    sourceUrl: study.sourceUrl,
    status: study.status,
    scope: classification.scope,
    scopeReasoning: classification.scopeReasoning,
    isNew: row.is_new,
  };

  if (existing) {
    if (existing.status !== study.status) {
      diff.statusChanged = { from: existing.status as EAStatus, to: study.status };
    }
    if (existing.scope !== classification.scope) {
      diff.scopeChanged = { from: existing.scope as ScopeResult, to: classification.scope };
    }
  }

  return diff;
}

/**
 * Inserts engagement events for an assessment, skipping any that already exist
 * (matched by study_id + fingerprint). Returns only the newly inserted events.
 */
export async function syncEngagementEvents(
  assessmentId: number,
  events: EngagementEvent[],
): Promise<EngagementEvent[]> {
  if (events.length === 0) return [];

  const sql = getSql();

  const rows = events.map((e) => ({
    study_id:    assessmentId,
    type:        e.type,
    event_date:  e.eventDate ?? null,
    end_date:    e.endDate ?? null,
    location:    e.location ?? null,
    url:         e.url ?? null,
    notes:       e.notes ?? null,
    fingerprint: `${e.type}:${e.url ?? ''}:${e.eventDate ?? ''}`,
  }));

  const inserted = await sql<{ fingerprint: string }[]>`
    INSERT INTO environmental_assessments.engagement_events
      ${sql(rows, 'study_id', 'type', 'event_date', 'end_date', 'location', 'url', 'notes', 'fingerprint')}
    ON CONFLICT (study_id, fingerprint) DO NOTHING
    RETURNING fingerprint
  `;

  const newFingerprints = new Set(inserted.map((r) => r.fingerprint));
  return events.filter((e) => newFingerprints.has(`${e.type}:${e.url ?? ''}:${e.eventDate ?? ''}`));
}

/**
 * Inserts documents for an assessment, skipping any that already exist
 * (matched by study_id + fingerprint). Returns only the newly inserted documents.
 */
export async function syncDocuments(
  assessmentId: number,
  documents: StudyDocument[],
): Promise<StudyDocument[]> {
  if (documents.length === 0) return [];

  const sql = getSql();

  const rows = documents.map((d) => ({
    study_id:        assessmentId,
    url:             d.url,
    title:           d.title,
    published_label: d.publishedLabel ?? null,
    fingerprint:     d.url,
  }));

  const inserted = await sql<{ fingerprint: string }[]>`
    INSERT INTO environmental_assessments.documents
      ${sql(rows, 'study_id', 'url', 'title', 'published_label', 'fingerprint')}
    ON CONFLICT (study_id, fingerprint) DO NOTHING
    RETURNING fingerprint
  `;

  const newFingerprints = new Set(inserted.map((r) => r.fingerprint));
  return documents.filter((d) => newFingerprints.has(d.url));
}

export async function closeDb(): Promise<void> {
  await _sql?.end({timeout: 5});
  _sql = null;
}
