import { assert, assertEquals, assertMatch } from '@std/assert';
import {
  parseBurlingtonNewsFeed,
  parseBurlingtonNewsDetail,
} from './burlington-news.ts';

const decoder = new TextDecoder('utf-8');

async function fixture(name: string): Promise<string> {
  const url = new URL(`./fixtures/burlington/${name}`, import.meta.url);
  const bytes = await Deno.readFile(url);
  return decoder.decode(bytes);
}

Deno.test('parseBurlingtonNewsFeed: keeps only city-projects-and-construction items (45 of 500)', async () => {
  const json = await fixture('news-feed.json');
  const studies = parseBurlingtonNewsFeed(json);
  assertEquals(studies.length, 45);
});

Deno.test('parseBurlingtonNewsFeed: constant fields + path filter per contract', async () => {
  const json = await fixture('news-feed.json');
  const studies = parseBurlingtonNewsFeed(json);
  for (const s of studies) {
    assertEquals(s.municipalityOwner, 'City of Burlington');
    assertEquals(s.municipalityAreas, ['Burlington']);
    assertEquals(s.status, 'unknown'); // no status in the feed — inferred during classification
    assertEquals(s.rawStatus, '');
    // every kept item lives under the city-projects/construction news path
    assert(s.sourceUrl.startsWith(
      'https://www.burlington.ca/en/news/current-city-projects-and-construction/',
    ));
    assertEquals(s.title, s.title.trim());
    assert(!/\s{2,}/.test(s.title));
    assert(s.title.length > 0);
  }
});

Deno.test('parseBurlingtonNewsFeed: captures EA notices not on Get Involved', async () => {
  const json = await fixture('news-feed.json');
  const titles = parseBurlingtonNewsFeed(json).map((s) => s.title);
  // creek/flood Class EAs that only exist as news notices
  assert(titles.includes('Lower Rambo Creek Flood Mitigation Environmental Assessment'));
  assert(titles.some((t) => t.includes('Falcon Creek Erosion Control Environmental Assessment')));
});

Deno.test('parseBurlingtonNewsFeed: de-duplicates by sourceUrl', async () => {
  const json = await fixture('news-feed.json');
  const urls = parseBurlingtonNewsFeed(json).map((s) => s.sourceUrl);
  assertEquals(new Set(urls).size, urls.length);
});

Deno.test('parseBurlingtonNewsFeed: filters out non-construction news (festivals, closures, development)', () => {
  const json = JSON.stringify([
    { title: 'Movies Under the Stars', link: 'https://www.burlington.ca/en/news/festivals-and-events/movies.aspx' },
    { title: 'Road Closure - Sheldon Park Drive', link: 'https://www.burlington.ca/en/news/road-closure-sheldon-park-drive.aspx' },
    { title: 'A Development Project', link: 'https://www.burlington.ca/en/news/current-development-projects/foo.aspx' },
    { title: 'New Street Bridge Replacement', link: 'https://www.burlington.ca/en/news/current-city-projects-and-construction/new-street-bridge.aspx' },
  ]);
  const studies = parseBurlingtonNewsFeed(json);
  assertEquals(studies.length, 1);
  assertEquals(studies[0].title, 'New Street Bridge Replacement');
});

Deno.test('parseBurlingtonNewsFeed: skips items missing link/title; collapses whitespace; tolerates bad json', () => {
  assertEquals(parseBurlingtonNewsFeed('not json'), []);
  assertEquals(parseBurlingtonNewsFeed('{"not":"an array"}'), []);
  const json = JSON.stringify([
    { title: '', link: 'https://www.burlington.ca/en/news/current-city-projects-and-construction/empty-title.aspx' },
    { link: 'https://www.burlington.ca/en/news/current-city-projects-and-construction/no-title.aspx' },
    { title: 'Has No Link' },
    { title: '  Spaced   Out\n\tStudy  ', link: 'https://www.burlington.ca/en/news/current-city-projects-and-construction/spaced.aspx' },
  ]);
  const studies = parseBurlingtonNewsFeed(json);
  assertEquals(studies.length, 1);
  assertEquals(studies[0].title, 'Spaced Out Study');
});

Deno.test('parseBurlingtonNewsDetail (appleby): description, hash, document links', async () => {
  const html = await fixture('appleby-creek-erosion-control-class-ea.html');
  const detail = await parseBurlingtonNewsDetail(html);

  assert(detail.description.includes('Aquafor Beech'));
  assert(detail.description.length <= 3000);
  assert(!/[\t]/.test(detail.description));

  assertMatch(detail.contentHash, /^[0-9a-f]{64}$/);

  // published documents from the news page's resources, deduplicated, absolutised, no date
  assertEquals(detail.documentLinks.length, 14);
  for (const d of detail.documentLinks) {
    assertEquals(d.date, null);
    assert(d.title.length > 0);
    assert(d.url.startsWith('https://www.burlington.ca/en/news/resources/'));
  }
  const urls = detail.documentLinks.map((d) => d.url);
  assertEquals(new Set(urls).size, urls.length);
});

Deno.test('parseBurlingtonNewsDetail: engagementHtml absolutises relative hrefs', async () => {
  const html = `
    <div id="mainContent"><div class="ge-content">
      <p>See the <a href="/en/news/resources/report.pdf">report</a> and
      <a href="//cdn.example.com/x">CDN</a>.</p>
    </div></div>`;
  const detail = await parseBurlingtonNewsDetail(html);
  assert(detail.engagementHtml.includes('https://www.burlington.ca/en/news/resources/report.pdf'));
  assert(detail.engagementHtml.includes('https://cdn.example.com/x'));
  assert(!detail.engagementHtml.includes('href="/en/news/resources/report.pdf"'));
});

Deno.test('parseBurlingtonNewsDetail: falls back to h1/main text when no content block', async () => {
  const html = `<html><body><h1>Fallback Study</h1><main>Body text only</main></body></html>`;
  const detail = await parseBurlingtonNewsDetail(html);
  assert(detail.description.includes('Fallback Study') || detail.description.includes('Body text'));
  assertEquals(detail.documentLinks.length, 0);
  assertMatch(detail.contentHash, /^[0-9a-f]{64}$/);
});

Deno.test('parseBurlingtonNewsDetail: contentHash deterministic + sensitive to content', async () => {
  const html = await fixture('appleby-creek-erosion-control-class-ea.html');
  const a = await parseBurlingtonNewsDetail(html);
  const b = await parseBurlingtonNewsDetail(html);
  assertEquals(a.contentHash, b.contentHash);
  const c = await parseBurlingtonNewsDetail('<div id="mainContent"><div class="ge-content">different</div></div>');
  assert(a.contentHash !== c.contentHash);
});
