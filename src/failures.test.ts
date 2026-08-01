import { assertEquals, assertNotEquals, assertRejects } from '@std/assert';
import { callAnthropicOrFail, computeFailureSignatureKey, describeApiError, FailureError, reportFailure } from './failures.ts';
import { extractToolCallInput } from './github.ts';
import { closeKv } from './kv.ts';
import type { FailureRecord } from './types.ts';

Deno.test('computeFailureSignatureKey: stable for identical inputs', async () => {
  const a = await computeFailureSignatureKey('engagement', 'Town of Oakville', 'Kerr St Study', 'boom');
  const b = await computeFailureSignatureKey('engagement', 'Town of Oakville', 'Kerr St Study', 'boom');
  assertEquals(a, b);
});

Deno.test('computeFailureSignatureKey: differs by stage', async () => {
  const a = await computeFailureSignatureKey('engagement', 'Town of Oakville', 'Kerr St Study', 'boom');
  const b = await computeFailureSignatureKey('classifier', 'Town of Oakville', 'Kerr St Study', 'boom');
  assertNotEquals(a, b);
});

Deno.test('computeFailureSignatureKey: differs by adapter', async () => {
  const a = await computeFailureSignatureKey('engagement', 'Town of Oakville', 'Kerr St Study', 'boom');
  const b = await computeFailureSignatureKey('engagement', 'Halton Region', 'Kerr St Study', 'boom');
  assertNotEquals(a, b);
});

Deno.test('computeFailureSignatureKey: differs by study title', async () => {
  const a = await computeFailureSignatureKey('engagement', 'Town of Oakville', 'Kerr St Study', 'boom');
  const b = await computeFailureSignatureKey('engagement', 'Town of Oakville', 'Other Study', 'boom');
  assertNotEquals(a, b);
});

Deno.test("computeFailureSignatureKey: a delimiter character in one field can't shift into another field and collide", async () => {
  // A naive '|'-joined signature would hash 'engagement|adapter|A|B|C' for both of these,
  // even though they're two different (title, error) pairs.
  const a = await computeFailureSignatureKey('engagement', 'adapter', 'A|B', 'C');
  const b = await computeFailureSignatureKey('engagement', 'adapter', 'A', 'B|C');
  assertNotEquals(a, b);
});

Deno.test('computeFailureSignatureKey: differs by error message', async () => {
  const a = await computeFailureSignatureKey('engagement', 'Town of Oakville', 'Kerr St Study', 'boom');
  const b = await computeFailureSignatureKey('engagement', 'Town of Oakville', 'Kerr St Study', 'crash');
  assertNotEquals(a, b);
});

Deno.test('FailureError: carries optional toolFailureData', () => {
  const withData = new FailureError('bad shape', 'the raw stuff');
  assertEquals(withData.message, 'bad shape');
  assertEquals(withData.toolFailureData, 'the raw stuff');

  const withoutData = new FailureError('bad shape');
  assertEquals(withoutData.toolFailureData, undefined);
});

Deno.test('FailureError: carries an optional cause so the original error is not lost', () => {
  const original = new Error('the real underlying failure');
  const wrapped = new FailureError('normalized summary', undefined, original);
  assertEquals(wrapped.cause, original);

  const withoutCause = new FailureError('normalized summary');
  assertEquals(withoutCause.cause, undefined);
});

// ---------- describeApiError ----------

function apiErrorLike(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

Deno.test('describeApiError: same HTTP status produces the same stable summary regardless of message text', () => {
  const a = describeApiError(apiErrorLike(529, 'Overloaded: request abc-123 at 10:00:01'));
  const b = describeApiError(apiErrorLike(529, 'Overloaded: request xyz-789 at 10:04:52'));
  assertEquals(a.summary, b.summary);
  assertNotEquals(a.detail, b.detail);
});

Deno.test('describeApiError: distinguishes by status code', () => {
  const a = describeApiError(apiErrorLike(500, 'boom'));
  const b = describeApiError(apiErrorLike(429, 'boom'));
  assertNotEquals(a.summary, b.summary);
});

Deno.test('describeApiError: falls back to constructor name when there is no status', () => {
  const { summary, detail } = describeApiError(new TypeError('network blew up'));
  assertEquals(summary, 'API request failed: TypeError');
  assertEquals(detail, 'network blew up');
});

Deno.test('describeApiError: handles non-Error throws', () => {
  const { summary, detail } = describeApiError('a string was thrown');
  assertEquals(summary, 'API request failed: unknown error');
  assertEquals(detail, 'a string was thrown');
});

// ---------- callAnthropicOrFail ----------

Deno.test('callAnthropicOrFail: passes through the result on success', async () => {
  const result = await callAnthropicOrFail('input label', 'raw input', () => Promise.resolve({ ok: true }));
  assertEquals(result, { ok: true });
});

Deno.test('callAnthropicOrFail: wraps a failure in a FailureError carrying a normalized summary, the raw input, and the original error as cause', async () => {
  const original = apiErrorLike(429, 'Overloaded: request abc-123');
  const err = await assertRejects(
    () => callAnthropicOrFail('description sent', 'the raw description', () => Promise.reject(original)),
    FailureError,
  );
  assertEquals(err.message, 'API request failed: HTTP 429');
  assertEquals(err.cause, original);
  assertEquals(err.toolFailureData !== undefined, true);
  const input = extractToolCallInput(err.toolFailureData!);
  assertEquals(input, 'the raw description');
});

Deno.test('callAnthropicOrFail: two failures with different message text but the same status produce the same FailureError message (stable for dedup)', async () => {
  const a = await assertRejects(
    () => callAnthropicOrFail('label', 'input', () => Promise.reject(apiErrorLike(529, 'Overloaded: request abc-123'))),
    FailureError,
  );
  const b = await assertRejects(
    () => callAnthropicOrFail('label', 'input', () => Promise.reject(apiErrorLike(529, 'Overloaded: request xyz-789'))),
    FailureError,
  );
  assertEquals(a.message, b.message);
});

// ---------- reportFailure ----------
//
// reportFailure talks to two side-effecting collaborators: Deno.openKv() (default, unpathed —
// every openKv() call in-process shares the same backing store, so a handle opened here sees
// what reportFailure wrote) and github.ts's fetch-based helpers (stubbed here the same way
// adapters/http.test.ts stubs fetch for fetchOrFail).

interface FetchCall { method: string; url: string; body: unknown }

function makeGithubFetchStub(overrides: Partial<{
  createIssue: () => Response;
  getIssue: () => Response;
  comment: () => Response;
  reopen: () => Response;
}> = {}) {
  const calls: FetchCall[] = [];
  const stub = ((input: string | URL | Request, init?: RequestInit) => {
    const url = input.toString();
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body });

    if (url.endsWith('/labels')) {
      return Promise.resolve(new Response(null, { status: 201 }));
    }
    if (method === 'POST' && url.endsWith('/issues')) {
      return Promise.resolve(overrides.createIssue ? overrides.createIssue() : new Response(JSON.stringify({ number: 42 }), { status: 201 }));
    }
    if (method === 'GET' && /\/issues\/\d+$/.test(url)) {
      return Promise.resolve(overrides.getIssue ? overrides.getIssue() : new Response(JSON.stringify({ state: 'open' }), { status: 200 }));
    }
    if (method === 'POST' && /\/issues\/\d+\/comments$/.test(url)) {
      return Promise.resolve(overrides.comment ? overrides.comment() : new Response(null, { status: 201 }));
    }
    if (method === 'PATCH' && /\/issues\/\d+$/.test(url)) {
      return Promise.resolve(overrides.reopen ? overrides.reopen() : new Response(null, { status: 200 }));
    }
    return Promise.reject(new Error(`unexpected fetch in test: ${method} ${url}`));
  }) as typeof fetch;
  return { stub, calls };
}

async function withStubbedFetch<T>(stub: typeof fetch, fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = stub;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

async function readFailureRecord(stage: 'adapter' | 'classifier' | 'engagement', adapter: string, studyTitle: string, errorMessage: string) {
  const digest = await computeFailureSignatureKey(stage, adapter, studyTitle, errorMessage);
  const kv = await Deno.openKv();
  try {
    return (await kv.get<FailureRecord>(['failures', digest])).value;
  } finally {
    kv.close();
  }
}

async function writeFailureRecord(stage: 'adapter' | 'classifier' | 'engagement', adapter: string, studyTitle: string, errorMessage: string, record: FailureRecord) {
  const digest = await computeFailureSignatureKey(stage, adapter, studyTitle, errorMessage);
  const kv = await Deno.openKv();
  try {
    await kv.set(['failures', digest], record);
  } finally {
    kv.close();
  }
}

async function deleteFailureRecord(stage: 'adapter' | 'classifier' | 'engagement', adapter: string, studyTitle: string, errorMessage: string) {
  const digest = await computeFailureSignatureKey(stage, adapter, studyTitle, errorMessage);
  const kv = await Deno.openKv();
  try {
    await kv.delete(['failures', digest]);
  } finally {
    kv.close();
  }
}

const testStudy = (title: string) => ({
  title,
  sourceUrl: 'https://example.com/study',
  municipalityOwner: 'Town of Oakville',
});

Deno.test('reportFailure: new signature files a GitHub issue and writes a fresh KV record', async () => {
  const study = testStudy('reportFailure: new signature');
  const { stub, calls } = makeGithubFetchStub();
  try {
    await withStubbedFetch(stub, () =>
      reportFailure({ stage: 'engagement', study, error: new Error('boom') }));

    const record = await readFailureRecord('engagement', study.municipalityOwner, study.title, 'boom');
    assertEquals(record?.occurrenceCount, 1);
    assertEquals(record?.githubIssueNumber, 42);
    assertEquals(record?.firstSeenAt, record?.lastSeenAt);
    assertEquals(calls.some((c) => c.method === 'POST' && c.url.endsWith('/issues')), true);
  } finally {
    await deleteFailureRecord('engagement', study.municipalityOwner, study.title, 'boom');
    closeKv();
  }
});

Deno.test('reportFailure: existing signature with an open linked issue posts a recurrence comment (no reopen)', async () => {
  const study = testStudy('reportFailure: recurring open issue');
  await writeFailureRecord('engagement', study.municipalityOwner, study.title, 'boom', {
    stage: 'engagement',
    municipalityOwner: study.municipalityOwner,
    studyTitle: study.title,
    sourceUrl: study.sourceUrl,
    errorMessage: 'boom',
    firstSeenAt: '2026-01-01T00:00:00.000Z',
    lastSeenAt: '2026-01-01T00:00:00.000Z',
    occurrenceCount: 1,
    githubIssueNumber: 7,
  });

  const { stub, calls } = makeGithubFetchStub({ getIssue: () => new Response(JSON.stringify({ state: 'open' }), { status: 200 }) });
  try {
    await withStubbedFetch(stub, () =>
      reportFailure({ stage: 'engagement', study, error: new Error('boom') }));

    const record = await readFailureRecord('engagement', study.municipalityOwner, study.title, 'boom');
    assertEquals(record?.occurrenceCount, 2);
    assertEquals(record?.githubIssueNumber, 7);
    assertEquals(calls.some((c) => c.method === 'POST' && c.url.endsWith('/issues/7/comments')), true);
    assertEquals(calls.some((c) => c.method === 'PATCH'), false);
    assertEquals(calls.some((c) => c.method === 'POST' && c.url.endsWith('/issues')), false);
  } finally {
    await deleteFailureRecord('engagement', study.municipalityOwner, study.title, 'boom');
    closeKv();
  }
});

Deno.test('reportFailure: existing signature with a closed linked issue reopens it and posts a regression comment', async () => {
  const study = testStudy('reportFailure: recurring closed issue');
  await writeFailureRecord('engagement', study.municipalityOwner, study.title, 'boom', {
    stage: 'engagement',
    municipalityOwner: study.municipalityOwner,
    studyTitle: study.title,
    sourceUrl: study.sourceUrl,
    errorMessage: 'boom',
    firstSeenAt: '2026-01-01T00:00:00.000Z',
    lastSeenAt: '2026-01-01T00:00:00.000Z',
    occurrenceCount: 3,
    githubIssueNumber: 9,
  });

  const { stub, calls } = makeGithubFetchStub({ getIssue: () => new Response(JSON.stringify({ state: 'closed' }), { status: 200 }) });
  try {
    await withStubbedFetch(stub, () =>
      reportFailure({ stage: 'engagement', study, error: new Error('boom') }));

    const record = await readFailureRecord('engagement', study.municipalityOwner, study.title, 'boom');
    assertEquals(record?.occurrenceCount, 4);
    assertEquals(record?.githubIssueNumber, 9);
    assertEquals(calls.some((c) => c.method === 'PATCH' && c.url.endsWith('/issues/9')), true);
    assertEquals(calls.some((c) => c.method === 'POST' && c.url.endsWith('/issues/9/comments')), true);
  } finally {
    await deleteFailureRecord('engagement', study.municipalityOwner, study.title, 'boom');
    closeKv();
  }
});

Deno.test('reportFailure: existing signature whose prior occurrence never got an issue filed retries filing rather than updating', async () => {
  const study = testStudy('reportFailure: retry filing');
  await writeFailureRecord('engagement', study.municipalityOwner, study.title, 'boom', {
    stage: 'engagement',
    municipalityOwner: study.municipalityOwner,
    studyTitle: study.title,
    sourceUrl: study.sourceUrl,
    errorMessage: 'boom',
    firstSeenAt: '2026-01-01T00:00:00.000Z',
    lastSeenAt: '2026-01-01T00:00:00.000Z',
    occurrenceCount: 1,
    githubIssueNumber: null,
  });

  const { stub, calls } = makeGithubFetchStub();
  try {
    await withStubbedFetch(stub, () =>
      reportFailure({ stage: 'engagement', study, error: new Error('boom') }));

    const record = await readFailureRecord('engagement', study.municipalityOwner, study.title, 'boom');
    assertEquals(record?.occurrenceCount, 2);
    assertEquals(record?.githubIssueNumber, 42);
    assertEquals(calls.some((c) => c.method === 'POST' && c.url.endsWith('/issues')), true);
    assertEquals(calls.some((c) => /\/issues\/\d+$/.test(c.url) && c.method === 'GET'), false);
  } finally {
    await deleteFailureRecord('engagement', study.municipalityOwner, study.title, 'boom');
    closeKv();
  }
});

Deno.test('reportFailure: never throws even when reporting itself fails (GitHub down)', async () => {
  const study = testStudy('reportFailure: github down');
  const stub = (() => Promise.reject(new TypeError('network blew up'))) as typeof fetch;
  try {
    await withStubbedFetch(stub, () =>
      reportFailure({ stage: 'engagement', study, error: new Error('boom') }));

    const record = await readFailureRecord('engagement', study.municipalityOwner, study.title, 'boom');
    assertEquals(record?.occurrenceCount, 1);
    assertEquals(record?.githubIssueNumber, null);
  } finally {
    await deleteFailureRecord('engagement', study.municipalityOwner, study.title, 'boom');
    closeKv();
  }
});
