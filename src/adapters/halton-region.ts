import type { Adapter, DocumentLink, EAStatus, EAStudy, EAStudyDetail } from '../types.ts';
import { absoluteUrl, fetchDocument, sha256Hex } from './http.ts';

const BASE_URL = 'https://www.halton.ca';
const LISTING_PATH = '/for-residents/infrastructure-and-growth/municipal-class-environmental-assessment-studies';
const MUNICIPALITY_OWNER = 'Halton Region';

export interface RawRow {
  title: string;
  municipalityArea: string;
  rawStatus: string;
  status: EAStatus;
  sourceUrl: string;
}

function buildPageUrl(page: number): string {
  return `${BASE_URL}${LISTING_PATH}?searchtext=&searchmode=anyword&sort=8&page=${page}`;
}

export function normaliseStatus(raw: string): EAStatus {
  switch (raw.trim().toLowerCase()) {
    case 'on-going': return 'on_going';
    case 'deferred':  return 'deferred';
    case 'completed': return 'completed';
    default:          return 'unknown';
  }
}

/**
 * Returns true if the URL has a numeric suffix that Halton appends to duplicate
 * study entries (e.g. `.../study-name-(1)`, `.../study-name-(2)`).
 *
 * The un-suffixed URL is the canonical one that points to the primary study page.
 */
export function hasSuffixedUrl(url: string): boolean {
  return /\-\(\d+\)$/.test(new URL(url).pathname);
}

/**
 * Parses the EA results table on a single listing page into raw row objects.
 *
 * Each `<tr>` in `.hal-generic-smart-search-results-table tbody` contains three `<td>`
 * columns in order: project name (with anchor), municipality, status.
 *
 * Returns one `RawRow` per table row — does not deduplicate cross-municipality entries.
 * Rows with an empty title are skipped.
 */
function parseRows(document: Document): RawRow[] {
  const rows = document.querySelectorAll(
    '.hal-generic-smart-search-results-table tbody tr'
  );
  const results: RawRow[] = [];

  for (const row of rows) {
    const cells = row.querySelectorAll('td');
    if (cells.length < 3) continue;

    const anchor = cells[0].querySelector('a');
    const title = anchor?.textContent?.trim() ?? cells[0].textContent?.trim() ?? '';
    const href = anchor?.getAttribute('href') ?? '';
    const sourceUrl = absoluteUrl(href, BASE_URL);
    const municipalityArea = cells[1].textContent?.trim() ?? '';
    const rawStatus = cells[2].textContent?.trim() ?? '';

    if (!title) continue;

    results.push({
      title,
      municipalityArea,
      rawStatus,
      status: normaliseStatus(rawStatus),
      sourceUrl,
    });
  }

  return results;
}

/**
 * Deduplicates raw rows into a list of `EAStudy` objects.
 *
 * Halton Region lists the same study once per covered municipality, all with the same
 * title but different URLs — the duplicate entries have a numeric suffix on the URL path
 * (e.g. `.../study-name-(1)`, `.../study-name-(2)`). This function groups rows by exact
 * title and merges them into a single study with a `municipalityAreas` array containing
 * all distinct areas.
 *
 * The canonical `sourceUrl` is the URL without a numeric suffix. If none exists in the
 * group (shouldn't happen in practice), the first URL is used as a fallback.
 */
export function groupIntoStudies(rows: RawRow[]): EAStudy[] {
  const grouped = new Map<string, RawRow[]>();

  for (const row of rows) {
    const existing = grouped.get(row.title);
    if (existing) {
      existing.push(row);
    } else {
      grouped.set(row.title, [row]);
    }
  }

  return Array.from(grouped.entries()).map(([title, group]) => ({
    title,
    municipalityOwner: MUNICIPALITY_OWNER,
    municipalityAreas: [...new Set(group.map((r) => r.municipalityArea).filter(Boolean))],
    status: group[0].status,
    rawStatus: group[0].rawStatus,
    sourceUrl: group.find((r) => !hasSuffixedUrl(r.sourceUrl))?.sourceUrl ?? group[0].sourceUrl,
  }));
}

/**
 * Fetches all EA studies from Halton Region's listing page, paginating through
 * all available pages.
 *
 * Halton's site does not return an empty page when you request a page number beyond
 * the last — it repeats the final page instead. Pagination is therefore detected by
 * tracking seen `sourceUrl` values: when every URL on a fetched page has already been
 * seen, we know we've looped back to the last page and stop.
 *
 * All raw rows are collected first, then passed through `groupIntoStudies` to merge
 * cross-municipality duplicate entries before returning.
 */
export async function fetchHaltonRegionStudies(): Promise<EAStudy[]> {
  const allRows: RawRow[] = [];
  const seenUrls = new Set<string>();
  let page = 1;

  while (true) {
    const doc = await fetchDocument(buildPageUrl(page));
    const rows = parseRows(doc);

    const newRows = rows.filter((r) => !seenUrls.has(r.sourceUrl));

    // Every URL on this page has already been seen — we've gone past the last page
    if (newRows.length === 0) break;

    for (const r of newRows) seenUrls.add(r.sourceUrl);
    allRows.push(...newRows);
    page++;
  }

  return groupIntoStudies(allRows);
}

function computeContentHash(doc: Document): Promise<string> {
  const detail = doc.querySelector('.hal-ea-studies-detail')?.innerHTML ?? '';
  const resources = doc.querySelector('.resource-listing-eastudies')?.innerHTML ?? '';
  return sha256Hex(detail + resources);
}

/**
 * Fetches a study's detail page and extracts:
 * - `description`: plain text from `.ck-text` elements (truncated, used for classification)
 * - `engagementHtml`: raw inner HTML of those same `.ck-text` elements (preserves links, used for engagement extraction)
 * - `documentLinks`: structured rows from `hal-ea-studies-listing` (title, URL, date label)
 * - `contentHash`: SHA-256 of `.hal-ea-studies-detail` + `.resource-listing-eastudies` innerHTML
 *
 * Falls back to full main/body text for `description` when the structured section is absent.
 */
export async function fetchStudyDetail(sourceUrl: string): Promise<EAStudyDetail> {
  const doc = await fetchDocument(sourceUrl);

  let description = '';
  let engagementHtml = '';

  const detailsSection = doc.querySelector('div.hal-ea-studies-detail-bottom');
  if (detailsSection) {
    const ckTexts = detailsSection.querySelectorAll('.ck-text');
    if (ckTexts.length > 0) {
      description = Array.from(ckTexts)
        .map((el) => el.textContent?.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .join('\n\n')
        .slice(0, 3000);
      engagementHtml = Array.from(ckTexts)
        .map((el) => el.innerHTML.trim())
        .filter(Boolean)
        .join('\n\n')
        .replace(/href="(\/\/[^"]+)"/g, `href="https:$1"`)
        .replace(/href="(\/[^"]+)"/g, `href="${BASE_URL}$1"`);
    }
  }

  if (!description) {
    const main = doc.querySelector('main#hal-main-content') ?? doc.body;
    description = main.textContent?.replace(/\s+/g, ' ').trim().slice(0, 3000) ?? '';
  }

  const documentLinks = extractDocumentLinks(doc);
  const contentHash = await computeContentHash(doc);

  return { description, engagementHtml, documentLinks, contentHash };
}

/**
 * Extracts structured document listing rows from `hal-ea-studies-listing`.
 *
 * Each row has a link (title + href) and an optional date label span.
 * Relative hrefs are resolved to absolute URLs.
 */
function extractDocumentLinks(doc: Document): DocumentLink[] {
  const rows = doc.querySelectorAll('.hal-ea-studies-listing-row');
  const links: DocumentLink[] = [];

  for (const row of rows) {
    const anchor = row.querySelector('a');
    if (!anchor) continue;

    const title = anchor.textContent?.trim() ?? '';
    const href = anchor.getAttribute('href') ?? '';
    const url = absoluteUrl(href, BASE_URL);
    const dateEl = row.querySelector('.hal-ea-studies-listing-item-report-date');
    const date = dateEl?.textContent?.trim() ?? null;

    if (title && url) {
      links.push({ title, url, date });
    }
  }

  return links;
}

export const haltonRegionAdapter: Adapter = {
  municipalityOwner: MUNICIPALITY_OWNER,
  inferStatus: false, // Halton's listing has a structured status column
  fetchStudies: fetchHaltonRegionStudies,
  fetchStudyDetail,
};
