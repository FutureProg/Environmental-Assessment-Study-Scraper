import { fetchHaltonRegionStudies, fetchStudyDetail } from './adapters/halton-region.ts';
import { classifyStudy } from './classifier.ts';
import { upsertAssessment, closeDb } from './db.ts';

async function main() {
  const studies = await fetchHaltonRegionStudies();
  console.log(`Found ${studies.length} studies`);

  for (const study of studies) {
    study.detail = await fetchStudyDetail(study.sourceUrl);
    const classification = await classifyStudy(study);
    await upsertAssessment(study, classification);
    console.log(`\n${study.title}`);
    console.log(`  Scope : ${classification.scope} — ${classification.scopeReasoning}`);
  }

  await closeDb();
}

await main();

// Execute at 6PM every day
Deno.cron("Halton Region Environmental Assessments", '0 18 * * *', async () => {
  await main();
});
