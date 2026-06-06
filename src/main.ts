import { fetchHaltonRegionStudies } from './adapters/halton-region.ts';

async function main() {
  const studies = await fetchHaltonRegionStudies();
  console.log(`Found ${studies.length} studies`);
  console.log(JSON.stringify(studies, null, 2));
}

await main();

// Execute at 6PM every day
Deno.cron("Halton Region Environmental Assessments", '0 18 * * *', async () => {
  await main();
});
