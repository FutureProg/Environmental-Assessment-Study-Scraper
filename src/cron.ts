import { fetchHaltonRegionStudies, fetchStudyDetail } from './adapters/halton-region.ts';
import { classifyStudy } from './classifier.ts';
import { extractEngagementData } from './engagement.ts';
import { upsertAssessment, getStoredAssessment, syncEngagementEvents, syncDocuments, closeDb } from './db.ts';
import { sendDiscordChanges } from './discord.ts';

export async function cronHandler() {
  const studies = await fetchHaltonRegionStudies();
  console.log(`Found ${studies.length} studies`);

  for (const study of studies) {
    study.detail = await fetchStudyDetail(study.sourceUrl);

    const stored = await getStoredAssessment(study.title, study.municipalityOwner, study.sourceUrl);
    const contentChanged = stored === null || stored.contentHash !== study.detail.contentHash;

    const classification = contentChanged
      ? await classifyStudy(study)
      : { scope: stored!.scope, scopeReasoning: stored!.scopeReasoning ?? '' };

    const diff = await upsertAssessment(study, classification, study.detail.contentHash);

    console.log(`\n${study.title}`);
    if (contentChanged) {
      console.log(`  Scope : ${classification.scope} — ${classification.scopeReasoning}`);
    } else {
      console.log(`  Scope : ${classification.scope} (content unchanged, skipped re-classification)`);
    }

    let newEvents: Awaited<ReturnType<typeof syncEngagementEvents>> = [];
    let newDocuments: Awaited<ReturnType<typeof syncDocuments>> = [];

    if (contentChanged) {
      const { events: engagementEvents, documents } = await extractEngagementData(study.detail);
      newEvents = await syncEngagementEvents(diff.id, engagementEvents);
      newDocuments = await syncDocuments(diff.id, documents);

      if (newEvents.length > 0) {
        console.log(`  Engagement: ${newEvents.length} new event(s)`);
        const eventTypes = new Set(newEvents.map((e) => e.type));
        eventTypes.forEach((type) => console.log(`    - ${type}: ${newEvents.filter((e) => e.type === type).length} new event(s)`));
        console.log(newEvents.map((e) => `    - ${e.type} on ${e.eventDate} (${e.url})`).join('\n'));
      }

      if (newDocuments.length > 0) {
        console.log(`  Documents: ${newDocuments.length} new document(s)`);
        console.log(newDocuments.map((d) => `    - ${d.title} (${d.url})`).join('\n'));
      }
    }

    await sendDiscordChanges(diff, newEvents, newDocuments);
  }

  await closeDb();
  console.log('Done');
}