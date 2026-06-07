import { fetchHaltonRegionStudies, fetchStudyDetail } from './src/adapters/halton-region.ts';
import { classifyStudy } from './src/classifier.ts';
import { extractEngagementEvents } from './src/engagement.ts';
import { upsertAssessment, syncEngagementEvents, closeDb } from './src/db.ts';
import { sendDiscordChanges } from './src/discord.ts';

async function main() {
  const studies = await fetchHaltonRegionStudies();
  console.log(`Found ${studies.length} studies`);

  for (const study of studies) {
    study.detail = await fetchStudyDetail(study.sourceUrl);
    const classification = await classifyStudy(study);
    const diff = await upsertAssessment(study, classification);

    console.log(`\n${study.title}`);
    console.log(`  Scope : ${classification.scope} — ${classification.scopeReasoning}`);

    const engagementEvents = await extractEngagementEvents(study.detail);
    const newEvents = await syncEngagementEvents(diff.id, engagementEvents);

    if (newEvents.length > 0) {
      console.log(`  Engagement: ${newEvents.length} new event(s)`);
    }

    await sendDiscordChanges(diff, newEvents);
  }

  await closeDb();
}

// Execute at 6PM every day
Deno.cron("Halton Region Environmental Assessments", '0 18 * * *', async () => {
  await main();
});

// Deno Deploy starts the app during warm-up and "waits for the HTTP server to
// start" before considering the deployment healthy — even for a cron-only
// worker. Without a listener, warm-up times out and the deploy fails. Serve a
// minimal health endpoint so the deploy passes; the cron above still fires on
// schedule. Deno.serve() binds to the platform-provided port automatically.
if (Deno.env.get('DENO_DEPLOYMENT_ID')) {
  Deno.serve(() => new Response('EA Study Scraper — cron worker OK'));
} else {
  // In local dev there's no cron runtime, so run once immediately.
  await main();
}
