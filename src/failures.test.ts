import { assertEquals, assertNotEquals, assertRejects } from '@std/assert';
import { callAnthropicOrFail, computeFailureSignatureKey, describeApiError, FailureError } from './failures.ts';
import { extractToolCallInput } from './github.ts';

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
