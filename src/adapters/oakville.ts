import type { Adapter, DocumentLink, EAStudy, EAStudyDetail } from '../types.ts';
import { fetchHtml, parseHtml, sha256Hex } from './http.ts';

const BASE_URL = 'https://www.oakville.ca';
const LISTING_PATH = '/transportation-roads/transportation-roads-studies-and-plans/environmental-assessment-studies/';
const MUNICIPALITY_OWNER = 'Town of Oakville';

/** Resolves a possibly-relative href against Oakville's base URL. */
function absoluteUrl(href: string): string {
  return href.startsWith('http') ? href : `${BASE_URL}${href}`;
}

/**
 * Parses Oakville's EA listing into studies.
 *
 * The listing is a grid of cards under `.widget-page-cards`, each an `<a class="card">`
 * wrapping a `.card-title` and a `.card-text` description. There is no status column —
 * status is inferred later by the classifier (see `inferStatus` on the adapter).
 *
 * Oakville covers a single municipal area, so `municipalityAreas` is always `['Oakville']`.
 * Cards are deduplicated by URL in case the same study is linked more than once.
 */
function parseStudies(document: Document): EAStudy[] {
  const cards = document.querySelectorAll('.widget-page-cards a.card');
  const studies: EAStudy[] = [];
  const seen = new Set<string>();

  for (const card of cards) {
    const href = card.getAttribute('href') ?? '';
    if (!href) continue;

    const sourceUrl = absoluteUrl(href);
    if (seen.has(sourceUrl)) continue;

    const title = card.querySelector('.card-title')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    if (!title) continue;

    seen.add(sourceUrl);
    studies.push({
      title,
      municipalityOwner: MUNICIPALITY_OWNER,
      municipalityAreas: ['Oakville'],
      status: 'unknown',  // no status on the listing — inferred during classification
      rawStatus: '',
      sourceUrl,
    });
  }

  return studies;
}

/**
 * Parses Oakville's listing page HTML into studies. Pure — no network.
 */
export function parseOakvilleListing(html: string): EAStudy[] {
  return parseStudies(parseHtml(html));
}

/**
 * Fetches all EA studies from Oakville's listing page.
 *
 * Unlike Halton, the listing is a single un-paginated page, so there is no pagination
 * or cross-municipality deduplication to handle.
 */
export async function fetchOakvilleStudies(): Promise<EAStudy[]> {
  return parseOakvilleListing(await fetchHtml(`${BASE_URL}${LISTING_PATH}`));
}

/**
 * Extracts the "Project documents" link lists from a detail page.
 *
 * Documents live in `.widget-link-listing` widgets as `<ul><li><a>` rows. Oakville does
 * not attach a publication-date label to these links, so `date` is always null.
 */
function extractDocumentLinks(doc: Document): DocumentLink[] {
  const links: DocumentLink[] = [];
  const seen = new Set<string>();

  for (const anchor of doc.querySelectorAll('.widget-link-listing li a')) {
    const title = anchor.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    const href = anchor.getAttribute('href') ?? '';
    if (!title || !href) continue;

    const url = absoluteUrl(href);
    if (seen.has(url)) continue;
    seen.add(url);
    links.push({ title, url, date: null });
  }

  return links;
}

/**
 * Parses an Oakville study detail page HTML into an `EAStudyDetail`. Pure — no network.
 *
 * Extracts:
 * - `description`: plain text from `.widget-text` blocks (truncated, used for classification)
 * - `engagementHtml`: inner HTML of those same blocks with relative links resolved (used for engagement extraction)
 * - `documentLinks`: structured rows from `.widget-link-listing` (title, URL; no date label)
 * - `contentHash`: SHA-256 of the `.widget-text` + `.widget-link-listing` innerHTML
 *
 * Falls back to main/body text for `description` when no `.widget-text` block is present.
 */
export async function parseOakvilleDetail(html: string): Promise<EAStudyDetail> {
  const doc = parseHtml(html);

  const textBlocks = Array.from(doc.querySelectorAll('.widget-text'));

  let description = textBlocks
    .map((el) => el.textContent?.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 3000);

  if (!description) {
    const main = doc.querySelector('main') ?? doc.body;
    description = main.textContent?.replace(/\s+/g, ' ').trim().slice(0, 3000) ?? '';
  }

  const engagementHtml = textBlocks
    .map((el) => el.innerHTML.trim())
    .filter(Boolean)
    .join('\n\n')
    .replace(/href="(\/[^"]+)"/g, `href="${BASE_URL}$1"`);

  const documentLinks = extractDocumentLinks(doc);

  const textHtml = textBlocks.map((el) => el.innerHTML).join('');
  const linkHtml = Array.from(doc.querySelectorAll('.widget-link-listing'))
    .map((el) => el.innerHTML).join('');
  const contentHash = await sha256Hex(textHtml + linkHtml);

  return { description, engagementHtml, documentLinks, contentHash };
}

/** Fetches and parses an Oakville study's detail page. */
export async function fetchOakvilleStudyDetail(sourceUrl: string): Promise<EAStudyDetail> {
  return parseOakvilleDetail(await fetchHtml(sourceUrl));
}

export const oakvilleAdapter: Adapter = {
  municipalityOwner: MUNICIPALITY_OWNER,
  inferStatus: true, // Oakville's listing has no status field — infer it during classification
  fetchStudies: fetchOakvilleStudies,
  fetchStudyDetail: fetchOakvilleStudyDetail,
};
