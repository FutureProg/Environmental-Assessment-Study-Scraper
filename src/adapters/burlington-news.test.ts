import { expect } from '@std/expect';
import { beforeAll, describe, it } from '@std/testing/bdd';
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

describe('parseBurlingtonNewsFeed', () => {
  // Loaded once for the whole block — the parse is pure, so every case can share one read.
  let feedJson: string;
  beforeAll(async () => {
    feedJson = await fixture('news-feed.json');
  });

  it('keeps only city-projects-and-construction items (45 of 500)', () => {
    expect(parseBurlingtonNewsFeed(feedJson).length).toBe(45);
  });

  it('sets constant fields + path filter per contract', () => {
    for (const s of parseBurlingtonNewsFeed(feedJson)) {
      expect(s.municipalityOwner).toEqual('City of Burlington');
      expect(s.municipalityAreas).toEqual(['Burlington']);
      expect(s.status).toEqual('unknown'); // no status in the feed — inferred during classification
      expect(s.rawStatus).toEqual('');
      // every kept item lives under the city-projects/construction news path
      expect(s.sourceUrl).toMatch(
        /^https:\/\/www\.burlington\.ca\/en\/news\/current-city-projects-and-construction\//,
      );
      expect(s.title).toEqual(s.title.trim());
      expect(/\s{2,}/.test(s.title)).toBe(false);
      expect(s.title.length).toBeGreaterThan(0);
    }
  });

  it('captures EA notices not on Get Involved', () => {
    const titles = parseBurlingtonNewsFeed(feedJson).map((s) => s.title);
    // creek/flood Class EAs that only exist as news notices
    expect(titles.some((t) => t.includes('Lower Rambo Creek Flood Mitigation Environmental Assessment'))).toBe(true);
    expect(titles.some((t) => t.includes('Falcon Creek Erosion Control Environmental Assessment'))).toBe(true);
  });

  it('de-duplicates by sourceUrl', () => {
    const urls = parseBurlingtonNewsFeed(feedJson).map((s) => s.sourceUrl);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('filters out non-construction news (festivals, closures, development)', () => {
    const json = JSON.stringify([
      { title: 'Movies Under the Stars', link: 'https://www.burlington.ca/en/news/festivals-and-events/movies.aspx' },
      { title: 'Road Closure - Sheldon Park Drive', link: 'https://www.burlington.ca/en/news/road-closure-sheldon-park-drive.aspx' },
      { title: 'A Development Project', link: 'https://www.burlington.ca/en/news/current-development-projects/foo.aspx' },
      { title: 'New Street Bridge Replacement', link: 'https://www.burlington.ca/en/news/current-city-projects-and-construction/new-street-bridge.aspx' },
    ]);
    const studies = parseBurlingtonNewsFeed(json);
    expect(studies.length).toBe(1);
    expect(studies[0].title).toEqual('New Street Bridge Replacement');
  });

  it('resolves relative feed links against the base and skips unparseable ones', () => {
    // generic URL-resolution behaviour is covered in http.test.ts (absoluteUrl); this
    // asserts only the feed's own contract — both relative forms are kept and resolved,
    // the malformed one is dropped.
    const json = JSON.stringify([
      { title: 'Root Relative', link: '/en/news/current-city-projects-and-construction/root.aspx' },
      { title: 'Bare Relative', link: 'en/news/current-city-projects-and-construction/bare.aspx' },
      { title: 'Bad Link', link: 'http://[invalid' },
    ]);
    const byTitle = Object.fromEntries(parseBurlingtonNewsFeed(json).map((s) => [s.title, s.sourceUrl]));
    expect(byTitle['Root Relative']).toEqual(
      'https://www.burlington.ca/en/news/current-city-projects-and-construction/root.aspx',
    );
    expect(byTitle['Bare Relative']).toEqual(
      'https://www.burlington.ca/en/news/current-city-projects-and-construction/bare.aspx',
    );
    expect('Bad Link' in byTitle).toBe(false);
  });

  it('skips items missing link/title; collapses whitespace; tolerates bad json', () => {
    expect(parseBurlingtonNewsFeed('not json')).toEqual([]);
    expect(parseBurlingtonNewsFeed('{"not":"an array"}')).toEqual([]);
    const json = JSON.stringify([
      { title: '', link: 'https://www.burlington.ca/en/news/current-city-projects-and-construction/empty-title.aspx' },
      { link: 'https://www.burlington.ca/en/news/current-city-projects-and-construction/no-title.aspx' },
      { title: 'Has No Link' },
      { title: '  Spaced   Out\n\tStudy  ', link: 'https://www.burlington.ca/en/news/current-city-projects-and-construction/spaced.aspx' },
    ]);
    const studies = parseBurlingtonNewsFeed(json);
    expect(studies.length).toBe(1);
    expect(studies[0].title).toEqual('Spaced Out Study');
  });
});

describe('parseBurlingtonNewsDetail', () => {
  // Real news page, loaded once and shared across the cases that need it.
  let applebyHtml: string;
  beforeAll(async () => {
    applebyHtml = await fixture('appleby-creek-erosion-control-class-ea.html');
  });

  it('(appleby) extracts description, hash, document links', async () => {
    const detail = await parseBurlingtonNewsDetail(applebyHtml);

    expect(detail.description).toContain('Aquafor Beech');
    expect(detail.description.length).toBeLessThanOrEqual(3000);
    expect(/[\t]/.test(detail.description)).toBe(false);

    expect(detail.contentHash).toMatch(/^[0-9a-f]{64}$/);

    // published documents from the news page's resources, deduplicated, absolutised, no date
    expect(detail.documentLinks.length).toBe(14);
    for (const d of detail.documentLinks) {
      expect(d.date).toBe(null);
      expect(d.title.length).toBeGreaterThan(0);
      expect(d.url).toMatch(/^https:\/\/www\.burlington\.ca\/en\/news\/resources\//);
    }
    const urls = detail.documentLinks.map((d) => d.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('falls back to h1/main text when no content block', async () => {
    const html = `<html><body><h1>Fallback Study</h1><main>Body text only</main></body></html>`;
    const detail = await parseBurlingtonNewsDetail(html);
    expect(detail.description).toContain('Fallback Study');
    expect(detail.description).toContain('Body text');
    expect(detail.documentLinks.length).toBe(0);
    expect(detail.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces a contentHash that is deterministic + sensitive to content', async () => {
    const a = await parseBurlingtonNewsDetail(applebyHtml);
    const b = await parseBurlingtonNewsDetail(applebyHtml);
    expect(a.contentHash).toEqual(b.contentHash);
    const c = await parseBurlingtonNewsDetail('<div id="mainContent"><div class="ge-content">different</div></div>');
    expect(a.contentHash).not.toEqual(c.contentHash);
  });
});
