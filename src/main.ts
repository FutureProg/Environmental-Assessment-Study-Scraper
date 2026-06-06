import { fetchHaltonRegionStudies, fetchStudyDetail } from './adapters/halton-region.ts';
import { classifyStudy } from './classifier.ts';

async function main() {
  const studies = await fetchHaltonRegionStudies();
  console.log(`Found ${studies.length} studies`);

  for (const study of studies) {
    study.detail = await fetchStudyDetail(study.sourceUrl);
    const classification = await classifyStudy(study);
    console.log(`\n${study.title}`);
    console.log(`  Category : ${classification.mcCategory} — ${classification.mcCategoryReasoning}`);
    console.log(`  Scope    : ${classification.scope} — ${classification.scopeReasoning}`);
  }
}

await main();

// Execute at 6PM every day
Deno.cron("Halton Region Environmental Assessments", '0 18 * * *', async () => {
  await main();
});
