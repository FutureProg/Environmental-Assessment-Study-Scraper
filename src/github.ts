import type { FailureStage } from './types.ts';

const REPO = 'FutureProg/Environmental-Assessment-Study-Scraper';
const API_BASE = `https://api.github.com/repos/${REPO}`;

export const SCRAPER_FAILURE_LABEL = 'scraper-failure';
export const TOOL_FAILURE_DATA_SUMMARY = 'Tool failure data';

const STAGE_LABELS: Record<FailureStage, string> = {
  adapter: 'stage:adapter',
  classifier: 'stage:classifier',
  engagement: 'stage:engagement',
};

// ---------- pure builders ----------

export function buildFailureIssueTitle(stage: FailureStage, adapter: string, studyTitle: string): string {
  return `[${stage}] ${adapter} — ${studyTitle}`;
}

/**
 * Reverse of buildFailureIssueTitle() — used by the replay CLI to recover which adapter
 * produced a failure, so it can look up that adapter's real inferStatus setting instead
 * of guessing.
 */
export function extractAdapterFromIssueTitle(title: string): string | null {
  const match = /^\[[^\]]+\]\s+(.+?)\s+—\s+/.exec(title);
  return match ? match[1] : null;
}

export function buildFailureIssueBody(
  stage: FailureStage,
  studyTitle: string,
  sourceUrl: string,
  errorMessage: string,
  toolFailureData?: string,
): string {
  const lines = [
    `**Stage:** ${stage}`,
    `**Study:** ${studyTitle}`,
    `**Source URL:** ${sourceUrl}`,
    '',
    `**Error:** ${errorMessage}`,
  ];

  if (toolFailureData) {
    lines.push(
      '',
      '<details>',
      `<summary>${TOOL_FAILURE_DATA_SUMMARY}</summary>`,
      '',
      '```',
      toolFailureData,
      '```',
      '</details>',
    );
  }

  return lines.join('\n');
}

// Raw scraped HTML/API responses are untrusted and can legitimately contain a line that
// looks like "=== OUTPUT" or a literal ``` sequence. Base64-encoding each segment (after
// truncating to a safe size) means the embedded content can never collide with the
// "=== INPUT/OUTPUT ===" markers or the outer ``` fence in buildFailureIssueBody — the
// encoded line is guaranteed to contain neither backticks nor newlines.
const MAX_SEGMENT_CHARS = 20_000;
const BASE64_CHUNK_SIZE = 0x8000;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n...[truncated, ${text.length - max} more chars]` : text;
}

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK_SIZE));
  }
  return btoa(binary);
}

function fromBase64(encoded: string): string {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/**
 * Builds a toolFailureData string for FailureError, in the "=== INPUT/OUTPUT ===" shape
 * extractToolCallInput() parses back out. Centralised here so the writer (classifier.ts,
 * engagement.ts) and the reader (extractToolCallInput, used by the replay CLI) can't drift.
 * Each segment is truncated (large scraped pages can otherwise blow past GitHub's ~65536-char
 * issue body limit) and base64-encoded (see MAX_SEGMENT_CHARS comment above) before embedding.
 */
export function buildToolFailureData(inputLabel: string, input: string, outputLabel: string, output: string): string {
  return [
    `=== INPUT (${inputLabel}) ===`,
    toBase64(truncate(input, MAX_SEGMENT_CHARS)),
    `=== OUTPUT (${outputLabel}) ===`,
    toBase64(truncate(output, MAX_SEGMENT_CHARS)),
  ].join('\n');
}

/**
 * Pulls the tool failure data back out of an issue body produced by
 * buildFailureIssueBody(), or null if the body has no such block. Scanning for the first
 * closing ``` is safe here because buildToolFailureData's output only ever contains static
 * marker text plus base64 — never a raw backtick from untrusted scraped content.
 */
export function extractToolFailureDataFromIssueBody(body: string): string | null {
  const summaryTag = `<summary>${TOOL_FAILURE_DATA_SUMMARY}</summary>`;
  const summaryIdx = body.indexOf(summaryTag);
  if (summaryIdx === -1) return null;

  const afterSummary = body.slice(summaryIdx + summaryTag.length);
  const fenceStart = afterSummary.indexOf('```');
  if (fenceStart === -1) return null;
  const fenceEnd = afterSummary.indexOf('```', fenceStart + 3);
  if (fenceEnd === -1) return null;

  return afterSummary.slice(fenceStart + 3, fenceEnd).replace(/^\n/, '').replace(/\n$/, '');
}

/**
 * Pulls the "=== INPUT ... ===" section back out of a toolFailureData string built
 * by classifier.ts / engagement.ts's FailureError sites. The input is base64-encoded
 * on a single line immediately after the marker (see buildToolFailureData), so this is
 * a direct decode rather than a scan for a closing delimiter — the embedded content
 * can't be mistaken for a marker regardless of what it contains.
 */
export function extractToolCallInput(toolFailureData: string): string | null {
  const lines = toolFailureData.split('\n');
  const startIdx = lines.findIndex((l) => l.startsWith('=== INPUT'));
  if (startIdx === -1 || startIdx + 1 >= lines.length) return null;
  try {
    return fromBase64(lines[startIdx + 1]);
  } catch {
    return null;
  }
}

export function buildRecurrenceComment(occurrenceCount: number, timestamp: string): string {
  return `Still failing as of ${timestamp} — occurrence #${occurrenceCount}.`;
}

export function buildRegressionComment(occurrenceCount: number, timestamp: string): string {
  return `Regression: this failure recurred as of ${timestamp} (occurrence #${occurrenceCount}) after this issue was closed.`;
}

// ---------- thin fetch wrappers ----------

function authHeaders(): HeadersInit {
  const token = Deno.env.get('GITHUB_TOKEN');
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  };
}

let labelsEnsured = false;

export async function ensureLabelsExist(): Promise<void> {
  if (labelsEnsured) return;

  const labels = [
    { name: SCRAPER_FAILURE_LABEL, color: 'd73a4a', description: 'Auto-filed when a cron run throws while processing a study' },
    { name: STAGE_LABELS.adapter, color: 'bfd4f2', description: 'Failure fetching a study listing or detail page' },
    { name: STAGE_LABELS.classifier, color: 'bfd4f2', description: "Failure in Claude's scope/status classification tool call" },
    { name: STAGE_LABELS.engagement, color: 'bfd4f2', description: "Failure in Claude's engagement/document extraction tool call" },
  ];

  const results = await Promise.all(labels.map(async (label) => {
    const res = await fetch(`${API_BASE}/labels`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(label),
    });
    // 422 means the label already exists — fine, ignore.
    if (!res.ok && res.status !== 422) {
      console.error(`Failed to create label ${label.name}: ${res.status} ${await res.text()}`);
      return false;
    }
    return true;
  }));

  // Only remember success when every label actually exists — otherwise a transient
  // failure (bad token, rate limit) would permanently skip retrying for this process.
  labelsEnsured = results.every(Boolean);
}

export function stageLabel(stage: FailureStage): string {
  return STAGE_LABELS[stage];
}

/** Reverse of stageLabel() — used by the replay CLI to recover the stage from an issue's labels. */
export function stageFromLabel(labelName: string): FailureStage | null {
  const entry = (Object.entries(STAGE_LABELS) as [FailureStage, string][]).find(([, label]) => label === labelName);
  return entry ? entry[0] : null;
}

export async function createGithubIssue(title: string, body: string, labels: string[]): Promise<{ number: number }> {
  const res = await fetch(`${API_BASE}/issues`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ title, body, labels }),
  });
  if (!res.ok) {
    throw new Error(`Failed to create GitHub issue: ${res.status} ${await res.text()}`);
  }
  return await res.json();
}

export async function getGithubIssue(issueNumber: number): Promise<{ state: 'open' | 'closed'; title: string; body: string | null; labels: { name: string }[] }> {
  const res = await fetch(`${API_BASE}/issues/${issueNumber}`, {
    headers: authHeaders(),
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch GitHub issue #${issueNumber}: ${res.status} ${await res.text()}`);
  }
  return await res.json();
}

export async function commentOnGithubIssue(issueNumber: number, body: string): Promise<void> {
  const res = await fetch(`${API_BASE}/issues/${issueNumber}/comments`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ body }),
  });
  if (!res.ok) {
    throw new Error(`Failed to comment on GitHub issue #${issueNumber}: ${res.status} ${await res.text()}`);
  }
}

export async function reopenGithubIssue(issueNumber: number): Promise<void> {
  const res = await fetch(`${API_BASE}/issues/${issueNumber}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ state: 'open' }),
  });
  if (!res.ok) {
    throw new Error(`Failed to reopen GitHub issue #${issueNumber}: ${res.status} ${await res.text()}`);
  }
}
