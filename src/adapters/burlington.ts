import type { Adapter, DocumentLink, EAStudy, EAStudyDetail } from '../types.ts';
import { absoluteUrl, fetchHtml, parseHtml, sha256Hex } from './http.ts';

const BASE_URL = 'https://www.getinvolvedburlington.ca';
const LISTING_PATH = '/projects';
const MUNICIPALITY_OWNER = 'City of Burlington';

/**
 * Burlington publishes its public-engagement projects (including EA consultations) on a
 * Granicus EngagementHQ platform at getinvolvedburlington.ca rather than as a structured
 * EA table. The city's own EA news index (`burlington.ca/Modules/News/en/Environmental`)
 * is blocked by a WAF rule on the `/Modules/` path, so the engagement platform is used
 * instead — it is where active EA consultations and their comment windows are posted.
 *
 * Unlike the other municipalities' listings, this platform is not EA-specific: it carries
 * every kind of engagement (budgets, festivals, surveys, …). The scope classifier is
 * relied on to filter out non-EA / out-of-scope projects, the same way it does for the
 * other sources — out-of-scope projects are stored but never notified on.
 */

/**
 * Decodes HTML entities in a string using the parser itself.
 *
 * The listing's visible titles are double-encoded in the source markup
 * (e.g. `Festivals &amp;amp; Events Strategy`), so a single `textContent` read leaves a
 * stray `&amp;`. Re-parsing the value resolves the remaining layer. This is idempotent for
 * already-decoded text, so single-encoded titles are unaffected.
 */
function decodeEntities(doc: Document, text: string): string {
  const el = doc.createElement('div');
  el.innerHTML = text;
  return el.textContent ?? text;
}

/**
 * Parses Burlington's EngagementHQ project listing into studies.
 *
 * Each project is a `.project-tile` carrying a `data-state` (`published` / `archived`),
 * an `a.project-tile__link` to the project page, and a `.project-tile__meta__name` title.
 * There is no EA-specific status field, so status is inferred later by the classifier (see
 * `inferStatus` on the adapter); `data-state` is recorded verbatim as `rawStatus`.
 *
 * Burlington covers a single municipal area, so `municipalityAreas` is always
 * `['Burlington']`. Tiles are deduplicated by absolute URL.
 */
function parseStudies(document: Document): EAStudy[] {
  const tiles = document.querySelectorAll('.project-tile');
  const studies: EAStudy[] = [];
  const seen = new Set<string>();

  for (const tile of tiles) {
    const href = tile.querySelector('a.project-tile__link')?.getAttribute('href') ?? '';
    if (!href) continue;

    const sourceUrl = absoluteUrl(href, BASE_URL);
    if (seen.has(sourceUrl)) continue;

    const rawTitle = tile.querySelector('.project-tile__meta__name')?.textContent
      ?.replace(/\s+/g, ' ').trim() ?? '';
    const title = decodeEntities(document, rawTitle).replace(/\s+/g, ' ').trim();
    if (!title) continue;

    seen.add(sourceUrl);
    studies.push({
      title,
      municipalityOwner: MUNICIPALITY_OWNER,
      municipalityAreas: ['Burlington'],
      status: 'unknown', // no EA status on the listing — inferred during classification
      rawStatus: tile.getAttribute('data-state') ?? '',
      sourceUrl,
    });
  }

  return studies;
}

/**
 * Parses Burlington's listing page HTML into studies. Pure — no network.
 */
export function parseBurlingtonListing(html: string): EAStudy[] {
  return parseStudies(parseHtml(html));
}

/**
 * Fetches all engagement projects from Burlington's getInvolved listing page.
 *
 * The platform renders every project tile in a single server-rendered page, so there is
 * no pagination to handle.
 */
export async function fetchBurlingtonStudies(): Promise<EAStudy[]> {
  return parseBurlingtonListing(await fetchHtml(`${BASE_URL}${LISTING_PATH}`));
}

/**
 * Extracts the document-library links from a project detail page.
 *
 * Documents are rendered as `a.document-library-widget-link` anchors pointing at the
 * platform's `/{id}/widgets/{id}/documents/{id}` download URLs. EngagementHQ does not
 * attach a publication-date label to these links, so `date` is always null.
 */
function extractDocumentLinks(doc: Document): DocumentLink[] {
  const links: DocumentLink[] = [];
  const seen = new Set<string>();

  for (const anchor of doc.querySelectorAll('a.document-library-widget-link')) {
    const title = anchor.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    const href = anchor.getAttribute('href') ?? '';
    if (!title || !href) continue;

    const url = absoluteUrl(href, BASE_URL);
    if (seen.has(url)) continue;
    seen.add(url);
    links.push({ title, url, date: null });
  }

  return links;
}

/**
 * Parses a Burlington project detail page HTML into an `EAStudyDetail`. Pure — no network.
 *
 * Extracts:
 * - `description`: plain text from `.shared-content-block` content sections (truncated, used for classification)
 * - `engagementHtml`: inner HTML of those same blocks with relative links resolved (used for engagement extraction)
 * - `documentLinks`: structured rows from the document-library widget (title, URL; no date label)
 * - `contentHash`: SHA-256 of the content-block innerHTML + joined document URLs
 *
 * Falls back to `h1` + main/body text for `description` when no content block is present.
 */
export async function parseBurlingtonDetail(html: string): Promise<EAStudyDetail> {
  const doc = parseHtml(html);

  const contentBlocks = Array.from(doc.querySelectorAll('.shared-content-block'));

  let description = contentBlocks
    .map((el) => el.textContent?.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 3000);

  if (!description) {
    const heading = doc.querySelector('h1')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    const main = doc.querySelector('main') ?? doc.body;
    const body = main?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    description = [heading, body].filter(Boolean).join('\n\n').slice(0, 3000);
  }

  const engagementHtml = contentBlocks
    .map((el) => el.innerHTML.trim())
    .filter(Boolean)
    .join('\n\n')
    .replace(/href="(\/\/[^"]+)"/g, `href="https:$1"`)
    .replace(/href="(\/[^"]+)"/g, `href="${BASE_URL}$1"`);

  const documentLinks = extractDocumentLinks(doc);

  const contentHtml = contentBlocks.map((el) => el.innerHTML).join('');
  const docHrefs = documentLinks.map((d) => d.url).join('');
  const contentHash = await sha256Hex(contentHtml + docHrefs);

  return { description, engagementHtml, documentLinks, contentHash };
}

/** Fetches and parses a Burlington project's detail page. */
export async function fetchBurlingtonStudyDetail(sourceUrl: string): Promise<EAStudyDetail> {
  return parseBurlingtonDetail(await fetchHtml(sourceUrl));
}

export const burlingtonAdapter: Adapter = {
  municipalityOwner: MUNICIPALITY_OWNER,
  inferStatus: true, // the engagement platform has no EA status field — infer it during classification
  fetchStudies: fetchBurlingtonStudies,
  fetchStudyDetail: fetchBurlingtonStudyDetail,
};
