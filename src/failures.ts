import type { EAStudy, FailureRecord, FailureStage } from './types.ts';
import {
  buildFailureIssueBody,
  buildFailureIssueTitle,
  buildRecurrenceComment,
  buildRegressionComment,
  commentOnGithubIssue,
  createGithubIssue,
  ensureLabelsExist,
  getGithubIssue,
  reopenGithubIssue,
  SCRAPER_FAILURE_LABEL,
  stageLabel,
} from './github.ts';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export class FailureError extends Error {
  constructor(message: string, public toolFailureData?: string) {
    super(message);
    this.name = 'FailureError';
  }
}

export async function computeFailureSignatureKey(
  stage: FailureStage,
  adapter: string,
  studyTitle: string,
  errorMessage: string,
): Promise<string> {
  const input = `${stage}|${adapter}|${studyTitle}|${errorMessage}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

let _kv: Deno.Kv | null = null;

async function getKv(): Promise<Deno.Kv> {
  if (!_kv) {
    _kv = await Deno.openKv();
  }
  return _kv;
}

export function closeKv(): void {
  _kv?.close();
  _kv = null;
}

export interface ReportFailureParams {
  stage: FailureStage;
  study: Pick<EAStudy, 'title' | 'sourceUrl' | 'municipalityOwner'>;
  error: Error;
  toolFailureData?: string;
}

export async function reportFailure(params: ReportFailureParams): Promise<void> {
  try {
    const { stage, study, error } = params;
    const toolFailureData = params.toolFailureData ?? (error instanceof FailureError ? error.toolFailureData : undefined);
    const now = new Date().toISOString();

    const digest = await computeFailureSignatureKey(stage, study.municipalityOwner, study.title, error.message);
    const key = ['failures', digest];

    const kv = await getKv();
    const existing = await kv.get<FailureRecord>(key);

    if (!existing.value) {
      await ensureLabelsExist();
      const title = buildFailureIssueTitle(stage, study.municipalityOwner, study.title);
      const body = buildFailureIssueBody(stage, study.title, study.sourceUrl, error.message, toolFailureData);
      const issue = await createGithubIssue(title, body, [SCRAPER_FAILURE_LABEL, stageLabel(stage)]);

      const record: FailureRecord = {
        stage,
        municipalityOwner: study.municipalityOwner,
        studyTitle: study.title,
        sourceUrl: study.sourceUrl,
        errorMessage: error.message,
        firstSeenAt: now,
        lastSeenAt: now,
        occurrenceCount: 1,
        githubIssueNumber: issue.number,
      };
      await kv.set(key, record, { expireIn: THIRTY_DAYS_MS });
      return;
    }

    const record = existing.value;
    const occurrenceCount = record.occurrenceCount + 1;
    const issue = await getGithubIssue(record.githubIssueNumber);

    if (issue.state === 'open') {
      await commentOnGithubIssue(record.githubIssueNumber, buildRecurrenceComment(occurrenceCount, now));
    } else {
      await reopenGithubIssue(record.githubIssueNumber);
      await commentOnGithubIssue(record.githubIssueNumber, buildRegressionComment(occurrenceCount, now));
    }

    await kv.set(key, { ...record, lastSeenAt: now, occurrenceCount }, { expireIn: THIRTY_DAYS_MS });
  } catch (reportingError) {
    // Failure reporting must never crash the cron run it's reporting on.
    console.error('reportFailure itself failed:', reportingError);
  }
}
