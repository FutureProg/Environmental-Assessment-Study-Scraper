import { assert, assertEquals, assertMatch } from '@std/assert';
import {
  parseOakvilleListing,
  parseOakvilleDetail,
} from '../src/adapters/oakville.ts';

const decoder = new TextDecoder('utf-8');

async function fixture(name: string): Promise<string> {
  const url = new URL(`./fixtures/oakville/${name}`, import.meta.url);
  const bytes = await Deno.readFile(url);
  return decoder.decode(bytes);
}

Deno.test('parseOakvilleListing: returns one study per card (7 cards)', async () => {
  const html = await fixture('listing.html');
  const studies = parseOakvilleListing(html);
  assertEquals(studies.length, 7);
});

Deno.test('parseOakvilleListing: first study title & absolute url', async () => {
  const html = await fixture('listing.html');
  const studies = parseOakvilleListing(html);
  const first = studies[0];
  assertEquals(
    first.title,
    'Burnhamthorpe Road Study and Class Environmental Assessment',
  );
  assertEquals(
    first.sourceUrl,
    'https://www.oakville.ca/transportation-roads/transportation-roads-studies-and-plans/environmental-assessment-studies/burnhamthorpe-road-study-and-ea/',
  );
});

Deno.test('parseOakvilleListing: constant fields per contract', async () => {
  const html = await fixture('listing.html');
  const studies = parseOakvilleListing(html);
  for (const s of studies) {
    assertEquals(s.municipalityOwner, 'Town of Oakville');
    assertEquals(s.municipalityAreas, ['Oakville']);
    assertEquals(s.status, 'unknown');
    assertEquals(s.rawStatus, '');
    // every sourceUrl absolutised against oakville.ca
    assert(s.sourceUrl.startsWith('https://www.oakville.ca/'));
    // titles trimmed, internal whitespace collapsed
    assertEquals(s.title, s.title.trim());
    assert(!/\s{2,}/.test(s.title));
    assert(!/[\n\t]/.test(s.title));
  }
});

Deno.test('parseOakvilleListing: expected set of titles in order', async () => {
  const html = await fixture('listing.html');
  const studies = parseOakvilleListing(html);
  assertEquals(studies.map((s) => s.title), [
    'Burnhamthorpe Road Study and Class Environmental Assessment',
    'Coronation Park Drainage Environmental Assessment',
    'McCraney Creek Bridge Replacement Environmental Assessment',
    'Midtown Oakville Class Environmental Assessment Study',
    'Sixth Line Class Environmental Assessment',
    'Speers Road Environmental Assessment Study',
    'Wyecroft Road Improvements Environmental Assessment',
  ]);
});

Deno.test('parseOakvilleListing: de-duplicates by absolute sourceUrl', async () => {
  const html = await fixture('listing.html');
  const studies = parseOakvilleListing(html);
  const urls = studies.map((s) => s.sourceUrl);
  assertEquals(new Set(urls).size, urls.length);
});

Deno.test('parseOakvilleListing: leaves http(s) hrefs unchanged; skips empty href/title', () => {
  const html = `
    <div class="widget-page-cards">
      <a class="card" href="https://example.com/already-absolute/">
        <div class="card-title">Absolute Study</div>
        <div class="card-text">x</div>
      </a>
      <a class="card" href="/relative/study/">
        <div class="card-title">Relative Study</div>
        <div class="card-text">x</div>
      </a>
      <a class="card" href="">
        <div class="card-title">No Href</div>
      </a>
      <a class="card" href="/empty-title/">
        <div class="card-title">   </div>
      </a>
    </div>`;
  const studies = parseOakvilleListing(html);
  const byTitle = Object.fromEntries(studies.map((s) => [s.title, s.sourceUrl]));
  assertEquals(byTitle['Absolute Study'], 'https://example.com/already-absolute/');
  assertEquals(byTitle['Relative Study'], 'https://www.oakville.ca/relative/study/');
  // empty href and empty title skipped
  assert(!('No Href' in byTitle));
  assertEquals(studies.length, 2);
});

Deno.test('parseOakvilleListing: collapses internal whitespace in title', () => {
  const html = `
    <div class="widget-page-cards">
      <a class="card" href="/x/">
        <div class="card-title">  Lots   of\n\t  space  </div>
      </a>
    </div>`;
  const studies = parseOakvilleListing(html);
  assertEquals(studies.length, 1);
  assertEquals(studies[0].title, 'Lots of space');
});

Deno.test('parseOakvilleDetail (burnhamthorpe): description, hash, links', async () => {
  const html = await fixture('burnhamthorpe.html');
  const detail = await parseOakvilleDetail(html);

  // description: non-empty plain text, truncated to 3000
  assert(detail.description.length > 0);
  assert(detail.description.length <= 3000);
  assert(detail.description.includes('William Halton Parkway'));
  // whitespace collapsed (no double spaces / tabs / newlines runs)
  assert(!/[\t]/.test(detail.description));

  // contentHash: 64-char lowercase hex
  assertMatch(detail.contentHash, /^[0-9a-f]{64}$/);

  // documentLinks: 4 in this fixture, unique urls, date null, absolutised
  assertEquals(detail.documentLinks.length, 4);
  for (const d of detail.documentLinks) {
    assertEquals(d.date, null);
    assert(d.title.length > 0);
    assert(d.url.startsWith('https://www.oakville.ca/getmedia/'));
  }
  assertEquals(
    detail.documentLinks[0].title,
    'Burnhamthorpe Road Notice of Study Commencement',
  );
  const urls = detail.documentLinks.map((d) => d.url);
  assertEquals(new Set(urls).size, urls.length);
});

Deno.test('parseOakvilleDetail (burnhamthorpe): engagementHtml absolutises relative hrefs', async () => {
  const html = await fixture('burnhamthorpe.html');
  const detail = await parseOakvilleDetail(html);
  // the widget-text contains a relative anchor to the North Oakville Secondary Plan
  assert(
    detail.engagementHtml.includes(
      'https://www.oakville.ca/business-development/planning-development/official-plan/north-oakville-secondary-plans/',
    ),
    'relative href should be rewritten to absolute',
  );
  // should not retain the bare relative form for that link
  assert(
    !detail.engagementHtml.includes(
      'href="/business-development/planning-development/official-plan/north-oakville-secondary-plans/"',
    ),
  );
});

Deno.test('parseOakvilleDetail (coronation-park): 7 document links, nested ul', async () => {
  const html = await fixture('coronation-park.html');
  const detail = await parseOakvilleDetail(html);

  assertEquals(detail.documentLinks.length, 7);
  assertEquals(detail.documentLinks[0].title, 'EA Final Report');
  assertEquals(
    detail.documentLinks[detail.documentLinks.length - 1].title,
    'Notice of study completion',
  );
  for (const d of detail.documentLinks) {
    assertEquals(d.date, null);
    assert(d.url.startsWith('https://www.oakville.ca/getmedia/'));
  }
  const urls = detail.documentLinks.map((d) => d.url);
  assertEquals(new Set(urls).size, urls.length);
});

Deno.test('parseOakvilleDetail: contentHash deterministic for identical input', async () => {
  const html = await fixture('coronation-park.html');
  const a = await parseOakvilleDetail(html);
  const b = await parseOakvilleDetail(html);
  assertEquals(a.contentHash, b.contentHash);
  assertMatch(a.contentHash, /^[0-9a-f]{64}$/);
});

Deno.test('parseOakvilleDetail: different input yields different hash', async () => {
  const a = await parseOakvilleDetail(await fixture('burnhamthorpe.html'));
  const b = await parseOakvilleDetail(await fixture('coronation-park.html'));
  assert(a.contentHash !== b.contentHash);
});
