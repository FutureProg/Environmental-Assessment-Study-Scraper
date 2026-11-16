import { expect } from '@std/expect';
import { beforeAll, describe, it } from '@std/testing/bdd';
import { parseBurlingtonNewsDetail, parseBurlingtonNewsListing } from './burlington-news.ts';

const decoder = new TextDecoder('utf-8');

async function fixture(name: string): Promise<string> {
  const bytes = await Deno.readFile(new URL(`./fixtures/burlington/${name}`, import.meta.url));
  return decoder.decode(bytes);
}

describe('parseBurlingtonNewsListing', () => {
  let eaHtml: string;
  let roadHtml: string;
  beforeAll(async () => {
    eaHtml = await fixture('news-listing-ea.html');
    roadHtml = await fixture('news-listing-road.html');
  });

  it('extracts the EA category cards (8)', () => {
    const studies = parseBurlingtonNewsListing(eaHtml);
    expect(studies.length).toBe(8);
    const titles = studies.map((s) => s.title);
    expect(titles).toContain('Appleby Creek Erosion Control Class EA');
    expect(titles.some((t) => t.includes('Lower Rambo Creek Flood Mitigation'))).toBe(true);
  });

  it('sets constant fields per contract and absolutises URLs', () => {
    for (const s of parseBurlingtonNewsListing(eaHtml)) {
      expect(s.municipalityOwner).toEqual('City of Burlington');
      expect(s.municipalityAreas).toEqual(['Burlington']);
      expect(s.status).toEqual('unknown');
      expect(s.rawStatus).toEqual('');
      expect(s.sourceUrl).toMatch(/^https:\/\/www\.burlington\.ca\/news-and-notices\/posts\/environmental-assessment-projects\//);
      expect(s.title).toEqual(s.title.trim());
    }
  });

  it('only keeps project categories, dropping festivals/other cards, and de-duplicates', () => {
    const urls = parseBurlingtonNewsListing(roadHtml).map((s) => s.sourceUrl);
    expect(urls.length).toBeGreaterThan(0);
    expect(new Set(urls).size).toBe(urls.length);
    for (const u of urls) expect(u).toContain('/news-and-notices/posts/road-and-transportation-construction-projects/');
  });

  it('filters by path and tolerates empty input', () => {
    expect(parseBurlingtonNewsListing('')).toEqual([]);
    const html = `<a class="gs-feed-list-title" href="/news-and-notices/posts/upcoming-festivals-and-events/x/">Fest</a>
      <a class="gs-feed-list-title" href="/news-and-notices/posts/stormwater-management-projects/y/">  Storm   Study </a>`;
    const studies = parseBurlingtonNewsListing(html);
    expect(studies.length).toBe(1);
    expect(studies[0].title).toEqual('Storm Study');
  });
});

describe('parseBurlingtonNewsDetail', () => {
  let applebyHtml: string;
  beforeAll(async () => {
    applebyHtml = await fixture('appleby-creek-erosion-control-class-ea.html');
  });

  it('(appleby) extracts description, hash, document links', async () => {
    const detail = await parseBurlingtonNewsDetail(applebyHtml);
    expect(detail.description).toContain('Aquafor Beech');
    expect(detail.description.length).toBeLessThanOrEqual(3000);
    expect(detail.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(detail.documentLinks.length).toBeGreaterThan(5);
    for (const d of detail.documentLinks) {
      expect(d.date).toBe(null);
      expect(d.title.length).toBeGreaterThan(0);
      expect(d.url).toMatch(/^https:\/\/www\.burlington\.ca\/media\/.+\.(pdf|docx?|xlsx?)/i);
    }
    const urls = detail.documentLinks.map((d) => d.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('falls back to h1/main text when no content block', async () => {
    const detail = await parseBurlingtonNewsDetail(`<html><body><h1>Fallback Study</h1><main>Body text only</main></body></html>`);
    expect(detail.description).toContain('Fallback Study');
    expect(detail.description).toContain('Body text');
    expect(detail.documentLinks.length).toBe(0);
  });

  it('produces a deterministic contentHash sensitive to content', async () => {
    const a = await parseBurlingtonNewsDetail(applebyHtml);
    const b = await parseBurlingtonNewsDetail(applebyHtml);
    expect(a.contentHash).toEqual(b.contentHash);
    const c = await parseBurlingtonNewsDetail('<div class="content-col"><section class="usn_cmp_text">different</section></div>');
    expect(a.contentHash).not.toEqual(c.contentHash);
  });
});
