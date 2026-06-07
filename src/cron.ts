import { fetchHaltonRegionStudies, fetchStudyDetail } from './adapters/halton-region.ts';
import { classifyStudy } from './classifier.ts';
import { extractEngagementEvents } from './engagement.ts';
import { upsertAssessment, syncEngagementEvents, closeDb } from './db.ts';
import { sendDiscordChanges } from './discord.ts';

export async function cronHandler() {
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