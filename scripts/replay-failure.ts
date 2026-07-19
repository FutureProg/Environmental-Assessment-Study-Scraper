import { extractAdapterFromIssueTitle, extractToolCallInput, extractToolFailureDataFromIssueBody, getGithubIssue, stageFromLabel } from '../src/github.ts';
import { classifyStudy } from '../src/classifier.ts';
import { extractEngagementData } from '../src/engagement.ts';
import { adapters } from '../src/adapters/index.ts';
import type { EAStudy, EAStudyDetail } from '../src/types.ts';

async function main() {
  const issueNumber = Number(Deno.args[0]);
  if (!issueNumber || Number.isNaN(issueNumber)) {
    console.error('Usage: deno task replay-failure -- <issue-number>');
    Deno.exit(1);
  }

  const issue = await getGithubIssue(issueNumber);
  const stage = issue.labels.map((l) => stageFromLabel(l.name)).find((s) => s !== null);
  if (!stage) {
    console.error(`Issue #${issueNumber} has no recognised stage:* label — cannot determine how to replay it.`);
    Deno.exit(1);
  }

  // Adapter-stage failures never have a captured payload (they're thrown by fetchStudyDetail()
  // as plain Errors, never a FailureError with toolFailureData) — check this before the generic
  // "no tool failure data attached" check below, which would otherwise always fire first for
  // this stage and mask this more specific, actionable message.
  if (stage === 'adapter') {
    console.error('Adapter-stage failures have no captured payload to replay against — re-run the adapter live instead.');
    Deno.exit(1);
  }

  const toolFailureData = issue.body ? extractToolFailureDataFromIssueBody(issue.body) : null;
  if (toolFailureData === null) {
    console.error(`Issue #${issueNumber} has no tool failure data attached — nothing to replay.`);
    Deno.exit(1);
  }

  const input = extractToolCallInput(toolFailureData);
  if (input === null) {
    console.error(`Issue #${issueNumber}'s tool failure data has no "=== INPUT" section — cannot replay.`);
    Deno.exit(1);
  }

  switch (stage) {
    case 'engagement': {
      const detail: EAStudyDetail = {
        description: '',
        engagementHtml: input,
        documentLinks: [],
        contentHash: '',
      };
      console.log(JSON.stringify(await extractEngagementData(detail), null, 2));
      break;
    }
    case 'classifier': {
      const adapterName = extractAdapterFromIssueTitle(issue.title);
      const matchedAdapter = adapterName ? adapters.find((a) => a.municipalityOwner === adapterName) : undefined;
      if (!matchedAdapter) {
        console.error(`Could not determine which adapter produced issue #${issueNumber} (title: "${issue.title}") — defaulting to inferStatus: false. Pass the real value manually if this adapter infers status.`);
      }
      const study: EAStudy = {
        title: `replay-of-issue-${issueNumber}`,
        municipalityAreas: [],
        municipalityOwner: adapterName ?? 'unknown',
        status: 'unknown',
        rawStatus: '',
        sourceUrl: '',
        detail: { description: input, engagementHtml: '', documentLinks: [], contentHash: '' },
      };
      console.log(JSON.stringify(await classifyStudy(study, { inferStatus: matchedAdapter?.inferStatus ?? false }), null, 2));
      break;
    }
  }
}

await main();
