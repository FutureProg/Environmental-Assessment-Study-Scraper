import { JSDOM } from 'jsdom';
import type { EAStatus, EAStudy, EAStudyDetail } from '../types.ts';

const BASE_URL = 'https://www.halton.ca';
const LISTING_PATH = '/for-residents/infrastructure-and-growth/municipal-class-environmental-assessment-studies';
const MUNICIPALITY_OWNER = 'Halton Region';

interface RawRow {
  title: string;
  municipalityArea: string;
  rawStatus: string;
  status: EAStatus;
  sourceUrl: string;
}

function buildPageUrl(page: number): string {
  return `${BASE_URL}${LISTING_PATH}?searchtext=&searchmode=anyword&sort=8&page=${page}`;
}

function normaliseStatus(raw: string): EAStatus {
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
function hasSuffixedUrl(url: string): boolean {
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
    const sourceUrl = href.startsWith('http') ? href : `${BASE_URL}${href}`;
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
function groupIntoStudies(rows: RawRow[]): EAStudy[] {
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
    const dom = await JSDOM.fromURL(buildPageUrl(page), { pretendToBeVisual: true });
    const rows = parseRows(dom.window.document);

    const newRows = rows.filter((r) => !seenUrls.has(r.sourceUrl));

    // Every URL on this page has already been seen — we've gone past the last page
    if (newRows.length === 0) break;

    for (const r of newRows) seenUrls.add(r.sourceUrl);
    allRows.push(...newRows);
    page++;
  }

  return groupIntoStudies(allRows);
}

/**
 * Fetches a study's detail page and extracts descriptive content for classification.
 *
 * Extraction priority:
 * 1. Text from `.ck-text` elements inside `div.hal-ea-studies-detail-bottom` (Purpose + Scope)
 * 2. Full `main#hal-main-content` text
 * 3. Body text as a last resort
 */
export async function fetchStudyDetail(sourceUrl: string): Promise<EAStudyDetail> {
  const dom = await JSDOM.fromURL(sourceUrl, { pretendToBeVisual: true });
  const doc = dom.window.document;

  const detailsSection = doc.querySelector('div.hal-ea-studies-detail-bottom');
  if (detailsSection) {
    const ckTexts = detailsSection.querySelectorAll('.ck-text');
    if (ckTexts.length > 0) {
      const text = Array.from(ckTexts)
        .map((el) => el.textContent?.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .join('\n\n');
      return { description: text };
    }
  }

  const main = doc.querySelector('main#hal-main-content') ?? doc.body;
  const text = main.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  return { description: text };
}
