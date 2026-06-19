import { adapters } from './adapters/index.ts';
import { classifyStudy } from './classifier.ts';
import { extractEngagementData } from './engagement.ts';
import { upsertAssessment, getStoredAssessment, syncEngagementEvents, syncDocuments, closeDb } from './db.ts';
import { sendDiscordChanges } from './discord.ts';
import type { Adapter, EAClassification, EAStudy } from './types.ts';

export async function cronHandler() {
  for (const adapter of adapters) {
    try {
      await runAdapter(adapter);
    } catch (err) {
      console.error(`[${adapter.municipalityOwner}] adapter failed:`, err);
    }
  }

  await closeDb();
  console.log('Done');
}

async function runAdapter(adapter: Adapter) {
  const studies = await adapter.fetchStudies();
  console.log(`[${adapter.municipalityOwner}] Found ${studies.length} studies`);

  for (const study of studies) {
    // Isolate failures per study so one bad detail page doesn't skip the rest of the batch.
    try {
      await processStudy(adapter, study);
    } catch (err) {
      console.error(`  [${study.title}] failed, skipping:`, err);
    }
  }
}

async function processStudy(adapter: Adapter, study: EAStudy) {
  study.detail = await adapter.fetchStudyDetail(study.sourceUrl);

  const stored = await getStoredAssessment(study.title, study.municipalityOwner);
  const contentChanged = stored === null || stored.contentHash !== study.detail.contentHash;

  let classification: EAClassification;
  if (contentChanged) {
    classification = await classifyStudy(study, { inferStatus: adapter.inferStatus });
    // For sources without a structured status field, adopt the inferred status.
    // rawStatus is left as the adapter set it (empty) — it records the verbatim
    // scraped status, and inferred status was never scraped from the source.
    if (adapter.inferStatus && classification.status) {
      study.status = classification.status;
    }
  } else {
    classification = { scope: stored!.scope, scopeReasoning: stored!.scopeReasoning ?? '' };
    // Content unchanged means status wasn't re-inferred — keep the stored status so
    // we don't overwrite it with the adapter's placeholder 'unknown'.
    if (adapter.inferStatus) {
      study.status = stored!.status;
    }
  }

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
