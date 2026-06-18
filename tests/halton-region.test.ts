import { assert, assertEquals } from '@std/assert';
import {
  groupIntoStudies,
  hasSuffixedUrl,
  normaliseStatus,
  type RawRow,
} from '../src/adapters/halton-region.ts';

// ---------- normaliseStatus ----------

Deno.test('normaliseStatus: known values', () => {
  assertEquals(normaliseStatus('On-going'), 'on_going');
  assertEquals(normaliseStatus('Deferred'), 'deferred');
  assertEquals(normaliseStatus('Completed'), 'completed');
});

Deno.test('normaliseStatus: case-insensitive and trims', () => {
  assertEquals(normaliseStatus('  on-going  '), 'on_going');
  assertEquals(normaliseStatus('DEFERRED'), 'deferred');
  assertEquals(normaliseStatus('completed'), 'completed');
  assertEquals(normaliseStatus('cOmPlEtEd'), 'completed');
});

Deno.test('normaliseStatus: unknown / empty -> unknown', () => {
  assertEquals(normaliseStatus(''), 'unknown');
  assertEquals(normaliseStatus('In Progress'), 'unknown');
  assertEquals(normaliseStatus('ongoing'), 'unknown'); // missing hyphen is not a known value
});

// ---------- hasSuffixedUrl ----------

Deno.test('hasSuffixedUrl: parenthesised numeric suffix on pathname -> true', () => {
  assert(hasSuffixedUrl('https://www.halton.ca/study-name-(1)'));
  assert(hasSuffixedUrl('https://www.halton.ca/study-name-(2)'));
  assert(hasSuffixedUrl('https://www.halton.ca/a/b/study-(10)'));
});

Deno.test('hasSuffixedUrl: plain path -> false', () => {
  assertEquals(hasSuffixedUrl('https://www.halton.ca/study-name'), false);
  assertEquals(hasSuffixedUrl('https://www.halton.ca/study/name/'), false);
});

Deno.test('hasSuffixedUrl: suffix only in query/hash does not count', () => {
  assertEquals(hasSuffixedUrl('https://www.halton.ca/study?x=-(1)'), false);
  assertEquals(hasSuffixedUrl('https://www.halton.ca/study#-(1)'), false);
});

// ---------- groupIntoStudies ----------

function row(partial: Partial<RawRow>): RawRow {
  return {
    title: 'T',
    municipalityArea: 'Oakville',
    rawStatus: 'On-going',
    status: 'on_going',
    sourceUrl: 'https://www.halton.ca/study',
    ...partial,
  };
}

Deno.test('groupIntoStudies: groups by exact title, first-seen order', () => {
  const rows: RawRow[] = [
    row({ title: 'B Study', municipalityArea: 'Burlington', sourceUrl: 'https://www.halton.ca/b' }),
    row({ title: 'A Study', municipalityArea: 'Milton', sourceUrl: 'https://www.halton.ca/a' }),
    row({ title: 'B Study', municipalityArea: 'Oakville', sourceUrl: 'https://www.halton.ca/b-(1)' }),
  ];
  const studies = groupIntoStudies(rows);
  assertEquals(studies.length, 2);
  // first-seen order preserved: B Study first
  assertEquals(studies[0].title, 'B Study');
  assertEquals(studies[1].title, 'A Study');
  assertEquals(studies[0].municipalityOwner, 'Halton Region');
});

Deno.test('groupIntoStudies: distinct non-empty areas in first-seen order', () => {
  const rows: RawRow[] = [
    row({ title: 'S', municipalityArea: 'Burlington', sourceUrl: 'https://www.halton.ca/s' }),
    row({ title: 'S', municipalityArea: '', sourceUrl: 'https://www.halton.ca/s-(1)' }),
    row({ title: 'S', municipalityArea: 'Burlington', sourceUrl: 'https://www.halton.ca/s-(2)' }),
    row({ title: 'S', municipalityArea: 'Milton', sourceUrl: 'https://www.halton.ca/s-(3)' }),
  ];
  const [study] = groupIntoStudies(rows);
  assertEquals(study.municipalityAreas, ['Burlington', 'Milton']);
});

Deno.test('groupIntoStudies: status/rawStatus from FIRST row of group', () => {
  const rows: RawRow[] = [
    row({ title: 'S', rawStatus: 'Completed', status: 'completed', sourceUrl: 'https://www.halton.ca/s' }),
    row({ title: 'S', rawStatus: 'On-going', status: 'on_going', sourceUrl: 'https://www.halton.ca/s-(1)' }),
  ];
  const [study] = groupIntoStudies(rows);
  assertEquals(study.status, 'completed');
  assertEquals(study.rawStatus, 'Completed');
});

Deno.test('groupIntoStudies: canonical url = first non-suffixed url', () => {
  const rows: RawRow[] = [
    row({ title: 'S', sourceUrl: 'https://www.halton.ca/s-(1)' }),
    row({ title: 'S', sourceUrl: 'https://www.halton.ca/s' }),
    row({ title: 'S', sourceUrl: 'https://www.halton.ca/s-(2)' }),
  ];
  const [study] = groupIntoStudies(rows);
  assertEquals(study.sourceUrl, 'https://www.halton.ca/s');
});

Deno.test('groupIntoStudies: all-suffixed -> first row url', () => {
  const rows: RawRow[] = [
    row({ title: 'S', sourceUrl: 'https://www.halton.ca/s-(1)' }),
    row({ title: 'S', sourceUrl: 'https://www.halton.ca/s-(2)' }),
  ];
  const [study] = groupIntoStudies(rows);
  assertEquals(study.sourceUrl, 'https://www.halton.ca/s-(1)');
});

Deno.test('groupIntoStudies: empty input -> empty output', () => {
  assertEquals(groupIntoStudies([]), []);
});
