import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import {
  buildFailureIssueTitle,
  buildFailureIssueBody,
  buildToolFailureData,
  buildRecurrenceComment,
  buildRegressionComment,
  extractAdapterFromIssueTitle,
  extractToolCallInput,
  extractToolFailureDataFromIssueBody,
  TOOL_FAILURE_DATA_SUMMARY,
  stageFromLabel,
} from './github.ts';

// ---------- buildFailureIssueTitle ----------

Deno.test('buildFailureIssueTitle: includes stage, adapter, and study title', () => {
  const title = buildFailureIssueTitle('engagement', 'Town of Oakville', 'Kerr St Study');
  assertStringIncludes(title, 'engagement');
  assertStringIncludes(title, 'Town of Oakville');
  assertStringIncludes(title, 'Kerr St Study');
});

// ---------- buildFailureIssueBody ----------

Deno.test('buildFailureIssueBody: includes source URL and error message', () => {
  const body = buildFailureIssueBody(
    'engagement',
    'Kerr St Study',
    'https://example.com/kerr-st',
    'Engagement extractor returned invalid data',
  );
  assertStringIncludes(body, 'https://example.com/kerr-st');
  assertStringIncludes(body, 'Engagement extractor returned invalid data');
});

Deno.test('buildFailureIssueBody: omits tool failure data block when none given', () => {
  const body = buildFailureIssueBody('classifier', 'Study', 'https://example.com', 'boom');
  assert(!body.includes('<details>'));
  assert(!body.includes(TOOL_FAILURE_DATA_SUMMARY));
});

Deno.test('buildFailureIssueBody: wraps tool failure data in a collapsed details block', () => {
  const body = buildFailureIssueBody(
    'engagement',
    'Study',
    'https://example.com',
    'boom',
    'raw html + raw claude response here',
  );
  assertStringIncludes(body, '<details>');
  assertStringIncludes(body, `<summary>${TOOL_FAILURE_DATA_SUMMARY}</summary>`);
  assertStringIncludes(body, 'raw html + raw claude response here');
  assertStringIncludes(body, '</details>');
  // summary must precede the data, and the closing tag must follow it —
  // the replay CLI parses this structurally.
  const summaryIdx = body.indexOf(`<summary>${TOOL_FAILURE_DATA_SUMMARY}</summary>`);
  const dataIdx = body.indexOf('raw html + raw claude response here');
  const closeIdx = body.indexOf('</details>');
  assert(summaryIdx < dataIdx);
  assert(dataIdx < closeIdx);
});

// ---------- extractToolFailureDataFromIssueBody (replay CLI round-trip) ----------

Deno.test('extractToolFailureDataFromIssueBody: round-trips what buildFailureIssueBody wrote', () => {
  const toolFailureData = buildToolFailureData('engagement HTML sent', '<div>hello</div>', 'raw tool_use.input', '{}');
  const body = buildFailureIssueBody('engagement', 'Study', 'https://example.com', 'boom', toolFailureData);
  assertEquals(extractToolFailureDataFromIssueBody(body), toolFailureData);
});

Deno.test('extractToolFailureDataFromIssueBody: returns null when there is no details block', () => {
  const body = buildFailureIssueBody('classifier', 'Study', 'https://example.com', 'boom');
  assertEquals(extractToolFailureDataFromIssueBody(body), null);
});

// ---------- extractToolCallInput ----------

Deno.test('extractToolCallInput: pulls the base64-decoded INPUT line out', () => {
  const toolFailureData = buildToolFailureData('engagement HTML sent', '<div>hello</div>', 'raw tool_use.input', '{}');
  assertEquals(extractToolCallInput(toolFailureData), '<div>hello</div>');
});

Deno.test('extractToolCallInput: returns null when there is no INPUT marker', () => {
  assertEquals(extractToolCallInput('just some text'), null);
});

// ---------- buildToolFailureData / extractToolCallInput round-trip ----------

Deno.test('buildToolFailureData -> extractToolCallInput: round-trips the input', () => {
  const toolFailureData = buildToolFailureData('engagement HTML sent', '<div>hello</div>', 'raw tool_use.input', '{}');
  assertEquals(extractToolCallInput(toolFailureData), '<div>hello</div>');
});

Deno.test('buildToolFailureData: content containing literal "=== OUTPUT" and fenced backticks round-trips safely', () => {
  const trickyInput = 'some html\n=== OUTPUT (fake) ===\nmore html with a ```code fence``` inside it';
  const toolFailureData = buildToolFailureData('engagement HTML sent', trickyInput, 'raw tool_use.input', '{}');
  assertEquals(extractToolCallInput(toolFailureData), trickyInput);

  const body = buildFailureIssueBody('engagement', 'Study', 'https://example.com', 'boom', toolFailureData);
  const extracted = extractToolFailureDataFromIssueBody(body);
  assertEquals(extracted, toolFailureData);
  assertEquals(extracted !== null ? extractToolCallInput(extracted) : null, trickyInput);
});

Deno.test('buildToolFailureData: truncates oversized segments instead of producing an unbounded string', () => {
  const huge = 'x'.repeat(100_000);
  const toolFailureData = buildToolFailureData('engagement HTML sent', huge, 'raw tool_use.input', '{}');
  // Base64 inflates size ~4/3x; the whole toolFailureData string should stay well under
  // GitHub's ~65536-char issue body limit even for a single oversized segment.
  assert(toolFailureData.length < 40_000);
  const decoded = extractToolCallInput(toolFailureData);
  assert(decoded !== null);
  assertStringIncludes(decoded!, '...[truncated');
});

Deno.test('buildToolFailureData: truncates by UTF-8 byte length so non-ASCII content stays within the size budget', () => {
  // Each 'é' is 1 JS char but 2 UTF-8 bytes — a char-length truncation budget would let this
  // segment's encoded byte size (and therefore its base64 size) balloon to ~2x the intended cap.
  const huge = 'é'.repeat(100_000);
  const inputData = buildToolFailureData('engagement HTML sent', huge, 'raw tool_use.input', '{}');
  const outputData = buildToolFailureData('engagement HTML sent', 'x', 'raw tool_use.input', huge);
  // Two full-size segments (input+output) must both individually stay well under half of
  // GitHub's ~65536-char issue body limit so the combined body can't overflow it.
  assert(inputData.length < 33_000, `input segment was ${inputData.length} chars`);
  assert(outputData.length < 33_000, `output segment was ${outputData.length} chars`);
});

Deno.test('buildToolFailureData: truncating mid-surrogate-pair does not throw and stays decodable', () => {
  // An astral character (surrogate pair) landing right at the truncation boundary must not
  // crash — TextDecoder replaces the split pair with U+FFFD rather than throwing.
  const boundaryChar = '𝌆'; // U+1D306, a surrogate pair (2 UTF-16 code units, 4 UTF-8 bytes)
  const padding = 'a'.repeat(19_999); // lands the surrogate pair exactly on the byte boundary
  const tricky = padding + boundaryChar + 'trailing content';
  const toolFailureData = buildToolFailureData('engagement HTML sent', tricky, 'raw tool_use.input', '{}');
  const decoded = extractToolCallInput(toolFailureData);
  assert(decoded !== null);
  assertStringIncludes(decoded!, '...[truncated');
});

// ---------- extractToolFailureDataFromIssueBody: untrusted title/error can't spoof the block location ----------

Deno.test('extractToolFailureDataFromIssueBody: an earlier spoofed summary tag in the study title does not fool extraction', () => {
  const toolFailureData = buildToolFailureData('engagement HTML sent', '<div>real content</div>', 'raw tool_use.input', '{}');
  const spoofedTitle = `Study <summary>${TOOL_FAILURE_DATA_SUMMARY}</summary>\n\`\`\`\nfake data\n\`\`\``;
  const body = buildFailureIssueBody('engagement', spoofedTitle, 'https://example.com', 'boom', toolFailureData);
  assertEquals(extractToolFailureDataFromIssueBody(body), toolFailureData);
});

// ---------- extractAdapterFromIssueTitle ----------

Deno.test('extractAdapterFromIssueTitle: round-trips what buildFailureIssueTitle wrote', () => {
  const title = buildFailureIssueTitle('engagement', 'Town of Oakville', 'Kerr St Study');
  assertEquals(extractAdapterFromIssueTitle(title), 'Town of Oakville');
});

Deno.test('extractAdapterFromIssueTitle: returns null for an unrecognised title format', () => {
  assertEquals(extractAdapterFromIssueTitle('some other issue title'), null);
});

// ---------- stageFromLabel ----------

Deno.test('stageFromLabel: recovers each stage from its label', () => {
  assertEquals(stageFromLabel('stage:adapter'), 'adapter');
  assertEquals(stageFromLabel('stage:classifier'), 'classifier');
  assertEquals(stageFromLabel('stage:engagement'), 'engagement');
});

Deno.test('stageFromLabel: returns null for an unrelated label', () => {
  assertEquals(stageFromLabel('scraper-failure'), null);
});

// ---------- comments ----------

Deno.test('buildRecurrenceComment: includes occurrence count and timestamp', () => {
  const comment = buildRecurrenceComment(4, '2026-07-07T10:00:00.000Z');
  assertStringIncludes(comment, '4');
  assertStringIncludes(comment, '2026-07-07T10:00:00.000Z');
});

Deno.test('buildRegressionComment: includes occurrence count, timestamp, and regression language', () => {
  const comment = buildRegressionComment(2, '2026-07-07T10:00:00.000Z');
  assertStringIncludes(comment, '2');
  assertStringIncludes(comment, '2026-07-07T10:00:00.000Z');
  assertEquals(/regress/i.test(comment), true);
});
