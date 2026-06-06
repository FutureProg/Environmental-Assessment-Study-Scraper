import postgres from 'postgres';
import type { EAStudy, EAClassification } from './types.ts';

const sql = postgres(Deno.env.get('DATABASE_URL')!);

export async function upsertAssessment(
  study: EAStudy,
  classification: EAClassification,
): Promise<void> {
  await sql`
    INSERT INTO environmental_assessments.assessments
      (title, municipality_owner, municipality_areas, source_url,
       status, raw_status, scope, scope_reasoning, last_seen_at)
    VALUES (
      ${study.title},
      (SELECT id FROM environmental_assessments.municipalities WHERE name = ${study.municipalityOwner}),
      ${study.municipalityAreas},
      ${study.sourceUrl},
      ${study.status}::environmental_assessments.ea_status,
      ${study.rawStatus},
      ${classification.scope}::environmental_assessments.ea_scope,
      ${classification.scopeReasoning},
      NOW()
    )
    ON CONFLICT (title, municipality_owner) DO UPDATE SET
      municipality_areas = EXCLUDED.municipality_areas,
      source_url         = EXCLUDED.source_url,
      status             = EXCLUDED.status,
      raw_status         = EXCLUDED.raw_status,
      scope              = EXCLUDED.scope,
      scope_reasoning    = EXCLUDED.scope_reasoning,
      last_seen_at       = EXCLUDED.last_seen_at
  `;
}

export async function closeDb(): Promise<void> {
  await sql.end();
}
