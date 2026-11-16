import type { Adapter, DocumentLink, EAStudy, EAStudyDetail } from '../types.ts';
import { absolutiseHtmlHrefs, absoluteUrl, fetchHtml, parseHtml, sha256Hex } from './http.ts';

const BASE_URL = 'https://www.burlington.ca';
const MUNICIPALITY_OWNER = 'City of Burlington';

/**
 * Category listing pages on the site's news section that hold Municipal Class EA studies
 * (creek/flood/erosion, road and bridge works). Each card links to a post under
 * `/news-and-notices/posts/<category>/`. Scope is decided per study by the classifier.
 */
const CATEGORIES = [
  'environmental-assessments-projects',
  'road-and-transportation-construction-projects',
  'stormwater-management-projects',
];
const POST_PATH_PREFIXES = [
  '/news-and-notices/posts/environmental-assessment-projects/',
  '/news-and-notices/posts/road-and-transportation-construction-projects/',
  '/news-and-notices/posts/stormwater-management-projects/',
];
const MAX_PAGES = 10;

/**
 * Parses a Burlington news category listing page into studies.
 *
 * Cards are `a.gs-feed-list-title` anchors. Only links under the project post paths are
 * kept (the page also has unrelated featured event cards). No status field exists, so
 * status is inferred later by the classifier. Deduplicated by URL. Pure — no network.
 */
export function parseBurlingtonNewsListing(html: string): EAStudy[] {
  const doc = parseHtml(html);
  const studies: EAStudy[] = [];
  const seen = new Set<string>();

  for (const a of doc.querySelectorAll('a.gs-feed-list-title')) {
    const href = a.getAttribute('href') ?? '';
    let url: URL;
    try {
      url = new URL(href, BASE_URL);
    } catch {
      continue;
    }
    if (!POST_PATH_PREFIXES.some((p) => url.pathname.startsWith(p))) continue;
    const sourceUrl = url.href;
    if (seen.has(sourceUrl)) continue;
    const title = (a.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!title) continue;
    seen.add(sourceUrl);
    studies.push({
      title,
      municipalityOwner: MUNICIPALITY_OWNER,
      municipalityAreas: ['Burlington'],
      status: 'unknown', // inferred during classification
      rawStatus: '',
      sourceUrl,
    });
  }
  return studies;
}

/** Fetches every category listing (following `?page=N` until no new posts appear). */
export async function fetchBurlingtonNewsStudies(): Promise<EAStudy[]> {
  const all = new Map<string, EAStudy>();
  for (const category of CATEGORIES) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const html = await fetchHtml(`${BASE_URL}/news-and-notices/${category}/?page=${page}`);
      const studies = parseBurlingtonNewsListing(html);
      const fresh = studies.filter((s) => !all.has(s.sourceUrl));
      for (const s of fresh) all.set(s.sourceUrl, s);
      if (fresh.length === 0) break; // site repeats/empties past the last page
    }
  }
  return [...all.values()];
}

/**
 * Extracts published-document links from a news page.
 *
 * Documents are hosted under `/media/...` as PDF/Office files. The news pages
 * carry no per-document date label, so `date` is always null. Scoped to the page's main
 * content so global header/footer links are not picked up.
 */
function extractDocumentLinks(root: Element | Document): DocumentLink[] {
  const links: DocumentLink[] = [];
  const seen = new Set<string>();

  for (const anchor of root.querySelectorAll('a')) {
    const href = anchor.getAttribute('href') ?? '';
    if (!/\/media\/.+\.(?:pdf|docx?|xlsx?)(?:[?#].*)?$/i.test(href)) continue;

    const title = anchor.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    if (!title) continue;

    const url = absoluteUrl(href, BASE_URL);
    if (seen.has(url)) continue;
    seen.add(url);
    links.push({ title, url, date: null });
  }

  return links;
}

/**
 * Parses a Burlington news page HTML into an `EAStudyDetail`. Pure — no network.
 *
 * The individual `.aspx` news pages load fine (only the News *module* listing is blocked).
 * Extracts:
 * - `description`: plain text from the page's `.usn_cmp_text` body blocks (truncated, used for classification)
 * - `engagementHtml`: inner HTML of those blocks with relative links resolved (used for engagement extraction)
 * - `documentLinks`: published documents from `/media/` (title, URL; no date label)
 * - `contentHash`: SHA-256 of the body blocks' innerHTML + document titles+hrefs
 *
 * Falls back to `h1` + main content text for `description` when no `.usn_cmp_text` block exists.
 */
export async function parseBurlingtonNewsDetail(html: string): Promise<EAStudyDetail> {
  const doc = parseHtml(html);
  const root = doc.querySelector('.content-col') ?? doc.body;

  const contentBlocks = Array.from(root.querySelectorAll('.usn_cmp_text'));

  let description = contentBlocks
    .map((el) => el.textContent?.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 3000);

  if (!description) {
    const heading = doc.querySelector('h1')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    const body = root.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    description = [heading, body].filter(Boolean).join('\n\n').slice(0, 3000);
  }

  const engagementHtml = absolutiseHtmlHrefs(
    contentBlocks
      .map((el) => el.innerHTML.trim())
      .filter(Boolean)
      .join('\n\n'),
    BASE_URL,
  );

  const documentLinks = extractDocumentLinks(root);

  const contentHtml = contentBlocks.map((el) => el.innerHTML).join('');
  // Include both title and URL so a document re-title (same URL) still changes the hash.
  const docFingerprint = documentLinks.map((d) => d.title + d.url).join('');
  const contentHash = await sha256Hex(contentHtml + docFingerprint);

  return { description, engagementHtml, documentLinks, contentHash };
}

/** Fetches and parses a Burlington news page. */
export async function fetchBurlingtonNewsStudyDetail(sourceUrl: string): Promise<EAStudyDetail> {
  return parseBurlingtonNewsDetail(await fetchHtml(sourceUrl));
}

export const burlingtonNewsAdapter: Adapter = {
  municipalityOwner: MUNICIPALITY_OWNER,
  inferStatus: true, // news notices have no structured status — infer it during classification
  fetchStudies: fetchBurlingtonNewsStudies,
  fetchStudyDetail: fetchBurlingtonNewsStudyDetail,
};
