import { assertEquals, assertNotEquals } from '@std/assert';
import { computeFailureSignatureKey, FailureError } from './failures.ts';

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
