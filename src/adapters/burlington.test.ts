import { assert, assertEquals, assertMatch } from '@std/assert';
import {
  parseBurlingtonListing,
  parseBurlingtonDetail,
} from './burlington.ts';

const decoder = new TextDecoder('utf-8');

async function fixture(name: string): Promise<string> {
  const url = new URL(`./fixtures/burlington/${name}`, import.meta.url);
  const bytes = await Deno.readFile(url);
  return decoder.decode(bytes);
}

Deno.test('parseBurlingtonListing: returns one study per project tile (90 tiles)', async () => {
  const html = await fixture('listing.html');
  const studies = parseBurlingtonListing(html);
  assertEquals(studies.length, 90);
});

Deno.test('parseBurlingtonListing: first study title, url, raw status', async () => {
  const html = await fixture('listing.html');
  const studies = parseBurlingtonListing(html);
  const first = studies[0];
  // visible title is double HTML-encoded in source ("&amp;amp;") — must be fully decoded
  assertEquals(first.title, 'Festivals & Events Strategy');
  assertEquals(first.sourceUrl, 'https://www.getinvolvedburlington.ca/eventstrategy');
  assertEquals(first.rawStatus, 'published');
});

Deno.test('parseBurlingtonListing: constant fields per contract', async () => {
  const html = await fixture('listing.html');
  const studies = parseBurlingtonListing(html);
  for (const s of studies) {
    assertEquals(s.municipalityOwner, 'City of Burlington');
    assertEquals(s.municipalityAreas, ['Burlington']);
    // status is inferred during classification — listing carries the placeholder
    assertEquals(s.status, 'unknown');
    // every sourceUrl absolutised against the engagement platform
    assert(s.sourceUrl.startsWith('https://www.getinvolvedburlington.ca/'));
    // titles fully decoded, trimmed, internal whitespace collapsed
    assert(!s.title.includes('&amp;'));
    assertEquals(s.title, s.title.trim());
    assert(!/\s{2,}/.test(s.title));
    assert(!/[\n\t]/.test(s.title));
    assert(s.title.length > 0);
  }
});

Deno.test('parseBurlingtonListing: de-duplicates by absolute sourceUrl', async () => {
  const html = await fixture('listing.html');
  const studies = parseBurlingtonListing(html);
  const urls = studies.map((s) => s.sourceUrl);
  assertEquals(new Set(urls).size, urls.length);
});

Deno.test('parseBurlingtonListing: maps data-state to rawStatus; archived preserved', () => {
  const html = `
    <div class='project-tile-wrapper row'>
      <div class='project-tile' data-name='active road study' data-state='published'>
        <div class='project-tile__card'>
          <a class="project-tile__link" href="/active-road">
            <div class='project-tile__meta'><span class='project-tile__meta__name'>Active Road Study</span></div>
          </a>
        </div>
      </div>
      <div class='project-tile' data-name='old study' data-state='archived'>
        <div class='project-tile__card'>
          <a class="project-tile__link" href="/old-study">
            <div class='project-tile__meta'><span class='project-tile__meta__name'>Old Study</span></div>
          </a>
        </div>
      </div>
    </div>`;
  const studies = parseBurlingtonListing(html);
  assertEquals(studies.length, 2);
  assertEquals(studies[0].rawStatus, 'published');
  assertEquals(studies[1].rawStatus, 'archived');
});

Deno.test('parseBurlingtonListing: resolves relative/absolute/protocol-relative hrefs; skips empties', () => {
  const html = `
    <div class='project-tile-wrapper'>
      <div class='project-tile' data-name='a' data-state='published'>
        <div class='project-tile__card'><a class="project-tile__link" href="https://example.com/abs/">
          <span class='project-tile__meta__name'>Absolute</span></a></div>
      </div>
      <div class='project-tile' data-name='b' data-state='published'>
        <div class='project-tile__card'><a class="project-tile__link" href="/relative/">
          <span class='project-tile__meta__name'>Relative</span></a></div>
      </div>
      <div class='project-tile' data-name='c' data-state='published'>
        <div class='project-tile__card'><a class="project-tile__link" href="//cdn.example.com/proto/">
          <span class='project-tile__meta__name'>Protocol</span></a></div>
      </div>
      <div class='project-tile' data-name='d' data-state='published'>
        <div class='project-tile__card'><a class="project-tile__link" href="">
          <span class='project-tile__meta__name'>No Href</span></a></div>
      </div>
      <div class='project-tile' data-name='e' data-state='published'>
        <div class='project-tile__card'><a class="project-tile__link" href="/empty-title/">
          <span class='project-tile__meta__name'>   </span></a></div>
      </div>
    </div>`;
  const studies = parseBurlingtonListing(html);
  const byTitle = Object.fromEntries(studies.map((s) => [s.title, s.sourceUrl]));
  assertEquals(byTitle['Absolute'], 'https://example.com/abs/');
  assertEquals(byTitle['Relative'], 'https://www.getinvolvedburlington.ca/relative/');
  assertEquals(byTitle['Protocol'], 'https://cdn.example.com/proto/');
  assert(!('No Href' in byTitle)); // empty href skipped
  assertEquals(studies.length, 3); // empty href + empty title skipped
});

Deno.test('parseBurlingtonListing: fully decodes double-encoded entities and collapses whitespace', () => {
  const html = `
    <div class='project-tile-wrapper'>
      <div class='project-tile' data-name='x' data-state='published'>
        <div class='project-tile__card'><a class="project-tile__link" href="/x/">
          <span class='project-tile__meta__name'>  Roads &amp;amp; Cycling\n\t  Plan  </span></a></div>
      </div>
    </div>`;
  const studies = parseBurlingtonListing(html);
  assertEquals(studies.length, 1);
  assertEquals(studies[0].title, 'Roads & Cycling Plan');
});

Deno.test('parseBurlingtonDetail (electric-mobility): description, hash, document links', async () => {
  const html = await fixture('electric-mobility-strategy.html');
  const detail = await parseBurlingtonDetail(html);

  // description: non-empty plain text, truncated to 3000, whitespace collapsed
  assert(detail.description.length > 0);
  assert(detail.description.length <= 3000);
  assert(!/[\t]/.test(detail.description));

  // contentHash: 64-char lowercase hex
  assertMatch(detail.contentHash, /^[0-9a-f]{64}$/);

  // documentLinks: scraped from the document-library widget, unique, absolutised, no date label
  assertEquals(detail.documentLinks.length, 14);
  for (const d of detail.documentLinks) {
    assertEquals(d.date, null);
    assert(d.title.length > 0);
    assert(d.url.startsWith('https://www.getinvolvedburlington.ca/'));
  }
  assertEquals(detail.documentLinks[0].title, 'Climate Action Plan Report');
  const urls = detail.documentLinks.map((d) => d.url);
  assertEquals(new Set(urls).size, urls.length);
});

Deno.test('parseBurlingtonDetail: engagementHtml absolutises relative hrefs', async () => {
  const html = `
    <div class='shared-content-block'>
      <p>See the <a href="/imp/documents">project documents</a> and
      the <a href="//cdn.example.com/x">CDN file</a>.</p>
    </div>`;
  const detail = await parseBurlingtonDetail(html);
  assert(detail.engagementHtml.includes('https://www.getinvolvedburlington.ca/imp/documents'));
  assert(detail.engagementHtml.includes('https://cdn.example.com/x'));
  assert(!detail.engagementHtml.includes('href="/imp/documents"'));
});

Deno.test('parseBurlingtonDetail: falls back to h1/main text when no content block', async () => {
  const html = `<html><body><h1>Fallback Project</h1><main>Some body content here</main></body></html>`;
  const detail = await parseBurlingtonDetail(html);
  assert(detail.description.includes('Fallback'));
  assertEquals(detail.documentLinks.length, 0);
  assertMatch(detail.contentHash, /^[0-9a-f]{64}$/);
});

Deno.test('parseBurlingtonDetail: contentHash deterministic for identical input', async () => {
  const html = await fixture('electric-mobility-strategy.html');
  const a = await parseBurlingtonDetail(html);
  const b = await parseBurlingtonDetail(html);
  assertEquals(a.contentHash, b.contentHash);
});

Deno.test('parseBurlingtonDetail: different input yields different hash', async () => {
  const a = await parseBurlingtonDetail(await fixture('electric-mobility-strategy.html'));
  const b = await parseBurlingtonDetail(await fixture('burlington-transit.html'));
  assert(a.contentHash !== b.contentHash);
});
