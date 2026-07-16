import type { EAStudy, FailureRecord, FailureStage } from './types.ts';
import { sha256Hex } from './adapters/http.ts';
import {
  buildFailureIssueBody,
  buildFailureIssueTitle,
  buildRecurrenceComment,
  buildRegressionComment,
  buildToolFailureData,
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
  constructor(message: string, public toolFailureData?: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = 'FailureError';
  }
}

/**
 * Normalizes an Anthropic SDK/network error into a stable summary (used for the FailureError
 * message and dedup signature) and the full detail (used for diagnostics). Raw error messages
 * from a failed API call can embed non-deterministic content (request IDs, timing) that would
 * otherwise defeat signature-based dedup between occurrences of the same underlying failure.
 */
export function describeApiError(err: unknown): { summary: string; detail: string } {
  const detail = err instanceof Error ? err.message : String(err);
  const status = err && typeof err === 'object' && 'status' in err && typeof (err as { status: unknown }).status === 'number'
    ? (err as { status: number }).status
    : undefined;
  const summary = status !== undefined
    ? `API request failed: HTTP ${status}`
    : `API request failed: ${err instanceof Error ? err.constructor.name : 'unknown error'}`;
  return { summary, detail };
}

/**
 * Wraps a client.messages.create() call so every Claude tool-call site (classifier.ts,
 * engagement.ts) fails identically: normalizes the error via describeApiError() for a stable
 * dedup signature, attaches the raw input that was sent as diagnostic data, and preserves the
 * original error as `cause` so console.error(err) at the catch site in cron.ts still surfaces
 * the original SDK error's message/stack — not just the normalized summary.
 */
export async function callAnthropicOrFail<T>(inputLabel: string, rawInput: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const { summary, detail } = describeApiError(err);
    const toolFailureData = buildToolFailureData(inputLabel, rawInput, 'raw error detail', detail);
    throw new FailureError(summary, toolFailureData, err);
  }
}

export async function computeFailureSignatureKey(
  stage: FailureStage,
  adapter: string,
  studyTitle: string,
  errorMessage: string,
): Promise<string> {
  return await sha256Hex(`${stage}|${adapter}|${studyTitle}|${errorMessage}`);
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

/**
 * Reports a pipeline-stage failure and rethrows it, for use at a stage call site's catch
 * block: `catch (err) { await reportAndRethrow('classifier', study, err); throw err; }`.
 * Centralises the coerce-report-rethrow pattern so every stage in cron.ts follows it
 * identically and a newly added stage can't accidentally skip reporting.
 *
 * The trailing `throw err;` at the call site is required, not redundant: this function is
 * declared `Promise<never>` (it always throws internally, since reportFailure never rejects),
 * but TypeScript does not narrow control flow/definite-assignment through an awaited call to
 * an imported `Promise<never>`-returning function the way it would a local `throw` statement —
 * omitting the trailing throw compiles fine here but breaks a call site that needs to assign a
 * variable in the try block for use afterward (e.g. `classification`/`engagementResult` in
 * cron.ts's processStudy).
 */
export async function reportAndRethrow(
  stage: FailureStage,
  study: ReportFailureParams['study'],
  err: unknown,
): Promise<never> {
  const error = err instanceof Error ? err : new Error(String(err));
  await reportFailure({ stage, study, error });
  throw err;
}
