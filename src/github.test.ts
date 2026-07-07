import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import {
  buildFailureIssueTitle,
  buildFailureIssueBody,
  buildToolFailureData,
  buildRecurrenceComment,
  buildRegressionComment,
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
  const toolFailureData = '=== INPUT (engagement HTML sent) ===\n<div>hello</div>\n=== OUTPUT (raw tool_use.input) ===\n{}';
  const body = buildFailureIssueBody('engagement', 'Study', 'https://example.com', 'boom', toolFailureData);
  assertEquals(extractToolFailureDataFromIssueBody(body), toolFailureData);
});

Deno.test('extractToolFailureDataFromIssueBody: returns null when there is no details block', () => {
  const body = buildFailureIssueBody('classifier', 'Study', 'https://example.com', 'boom');
  assertEquals(extractToolFailureDataFromIssueBody(body), null);
});

// ---------- extractToolCallInput ----------

Deno.test('extractToolCallInput: pulls the INPUT section out, stopping before OUTPUT', () => {
  const toolFailureData = '=== INPUT (engagement HTML sent) ===\n<div>hello</div>\n=== OUTPUT (raw tool_use.input) ===\n{}';
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
