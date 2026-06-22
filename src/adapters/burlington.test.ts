import { expect } from '@std/expect';
import { describe, it } from '@std/testing/bdd';
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

describe('parseBurlingtonListing', () => {
  it('returns one study per project tile (90 tiles)', async () => {
    const html = await fixture('listing.html');
    const studies = parseBurlingtonListing(html);
    expect(studies.length).toBe(90);
  });

  it('parses first study title, url, raw status', async () => {
    const html = await fixture('listing.html');
    const studies = parseBurlingtonListing(html);
    const first = studies[0];
    // visible title is double HTML-encoded in source ("&amp;amp;") — must be fully decoded
    expect(first.title).toEqual('Festivals & Events Strategy');
    expect(first.sourceUrl).toEqual('https://www.getinvolvedburlington.ca/eventstrategy');
    expect(first.rawStatus).toEqual('published');
  });

  it('sets constant fields per contract', async () => {
    const html = await fixture('listing.html');
    const studies = parseBurlingtonListing(html);
    for (const s of studies) {
      expect(s.municipalityOwner).toEqual('City of Burlington');
      expect(s.municipalityAreas).toEqual(['Burlington']);
      // status is inferred during classification — listing carries the placeholder
      expect(s.status).toEqual('unknown');
      // every sourceUrl absolutised against the engagement platform
      expect(s.sourceUrl).toMatch(/^https:\/\/www\.getinvolvedburlington\.ca\//);
      // titles fully decoded, trimmed, internal whitespace collapsed
      expect(s.title.includes('&amp;')).toBe(false);
      expect(s.title).toEqual(s.title.trim());
      expect(/\s{2,}/.test(s.title)).toBe(false);
      expect(/[\n\t]/.test(s.title)).toBe(false);
      expect(s.title.length).toBeGreaterThan(0);
    }
  });

  it('de-duplicates by absolute sourceUrl', async () => {
    const html = await fixture('listing.html');
    const studies = parseBurlingtonListing(html);
    const urls = studies.map((s) => s.sourceUrl);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('maps data-state to rawStatus; archived preserved', () => {
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
    expect(studies.length).toBe(2);
    expect(studies[0].rawStatus).toEqual('published');
    expect(studies[1].rawStatus).toEqual('archived');
  });

  it('resolves relative/absolute/protocol-relative hrefs; skips empties', () => {
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
    expect(byTitle['Absolute']).toEqual('https://example.com/abs/');
    expect(byTitle['Relative']).toEqual('https://www.getinvolvedburlington.ca/relative/');
    expect(byTitle['Protocol']).toEqual('https://cdn.example.com/proto/');
    expect('No Href' in byTitle).toBe(false); // empty href skipped
    expect(studies.length).toBe(3); // empty href + empty title skipped
  });

  it('fully decodes double-encoded entities and collapses whitespace', () => {
    const html = `
      <div class='project-tile-wrapper'>
        <div class='project-tile' data-name='x' data-state='published'>
          <div class='project-tile__card'><a class="project-tile__link" href="/x/">
            <span class='project-tile__meta__name'>  Roads &amp;amp; Cycling\n\t  Plan  </span></a></div>
        </div>
      </div>`;
    const studies = parseBurlingtonListing(html);
    expect(studies.length).toBe(1);
    expect(studies[0].title).toEqual('Roads & Cycling Plan');
  });
});

describe('parseBurlingtonDetail', () => {
  it('(electric-mobility) extracts description, hash, document links', async () => {
    const html = await fixture('electric-mobility-strategy.html');
    const detail = await parseBurlingtonDetail(html);

    // description: non-empty plain text, truncated to 3000, whitespace collapsed
    expect(detail.description.length).toBeGreaterThan(0);
    expect(detail.description.length).toBeLessThanOrEqual(3000);
    expect(/[\t]/.test(detail.description)).toBe(false);

    // contentHash: 64-char lowercase hex
    expect(detail.contentHash).toMatch(/^[0-9a-f]{64}$/);

    // documentLinks: scraped from the document-library widget, unique, absolutised, no date label
    expect(detail.documentLinks.length).toBe(14);
    for (const d of detail.documentLinks) {
      expect(d.date).toBe(null);
      expect(d.title.length).toBeGreaterThan(0);
      expect(d.url).toMatch(/^https:\/\/www\.getinvolvedburlington\.ca\//);
    }
    expect(detail.documentLinks[0].title).toEqual('Climate Action Plan Report');
    const urls = detail.documentLinks.map((d) => d.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('absolutises relative hrefs in engagementHtml', async () => {
    const html = `
      <div class='shared-content-block'>
        <p>See the <a href="/imp/documents">project documents</a> and
        the <a href="//cdn.example.com/x">CDN file</a>.</p>
      </div>`;
    const detail = await parseBurlingtonDetail(html);
    expect(detail.engagementHtml).toContain('https://www.getinvolvedburlington.ca/imp/documents');
    expect(detail.engagementHtml).toContain('https://cdn.example.com/x');
    expect(detail.engagementHtml.includes('href="/imp/documents"')).toBe(false);
  });

  it('falls back to h1/main text when no content block', async () => {
    const html = `<html><body><h1>Fallback Project</h1><main>Some body content here</main></body></html>`;
    const detail = await parseBurlingtonDetail(html);
    expect(detail.description).toContain('Fallback Project');
    expect(detail.description).toContain('Some body content');
    expect(detail.documentLinks.length).toBe(0);
    expect(detail.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces a contentHash that is deterministic for identical input', async () => {
    const html = await fixture('electric-mobility-strategy.html');
    const a = await parseBurlingtonDetail(html);
    const b = await parseBurlingtonDetail(html);
    expect(a.contentHash).toEqual(b.contentHash);
  });

  it('produces a different hash for different input', async () => {
    const a = await parseBurlingtonDetail(await fixture('electric-mobility-strategy.html'));
    const b = await parseBurlingtonDetail(await fixture('burlington-transit.html'));
    expect(a.contentHash).not.toEqual(b.contentHash);
  });
});
