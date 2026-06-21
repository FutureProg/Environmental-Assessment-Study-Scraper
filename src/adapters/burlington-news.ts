import type { Adapter, DocumentLink, EAStudy, EAStudyDetail } from '../types.ts';
import { absoluteUrl, fetchHtml, fetchJson, parseHtml, sha256Hex } from './http.ts';

const BASE_URL = 'https://www.burlington.ca';
// The site's News module (`/Modules/News/...`) is WAF-blocked, but the NewsModule JSON
// service that powers the on-page news feeds is not. It returns recent news items across
// all categories; the EA / capital-project notices are filtered by their URL path below.
const FEED_PATH = '/Modules/NewsModule/services/getTopFiveNews.ashx?limit=500&lang=en';
const MUNICIPALITY_OWNER = 'City of Burlington';

/**
 * News items under this path are Burlington's "Current City Projects and Construction"
 * notices — the category that holds Municipal Class EA studies (road, bridge, creek/flood,
 * erosion) alongside capital works. Everything else in the feed (festivals, road closures,
 * development applications, recreation) is dropped here; scope (road-safety relevance) is
 * then decided per study by the classifier.
 */
const PROJECT_PATH = '/en/news/current-city-projects-and-construction/';

/** Shape of a single item in the NewsModule feed JSON (only the fields we use). */
interface NewsFeedItem {
  title?: string;
  link?: string;
}

/**
 * Parses Burlington's NewsModule feed JSON into studies.
 *
 * This is a complementary source to Get Involved Burlington: many EA notices (notably the
 * creek/flood/erosion Class EAs) are posted only as news items and never get an engagement
 * project. The feed is a rolling list of recent news, so this captures newly posted notices
 * rather than the full historical archive.
 *
 * There is no status field on the feed, so status is inferred later by the classifier (see
 * `inferStatus` on the adapter). Items are deduplicated by URL. Pure — no network.
 */
export function parseBurlingtonNewsFeed(json: string): EAStudy[] {
  let items: unknown;
  try {
    items = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(items)) return [];

  const studies: EAStudy[] = [];
  const seen = new Set<string>();

  for (const item of items as NewsFeedItem[]) {
    const link = (item?.link ?? '').trim();
    if (!link) continue;
    let url: URL;
    try {
      url = new URL(link, BASE_URL);
    } catch {
      continue;
    }
    if (!url.pathname.startsWith(PROJECT_PATH)) continue;

    const sourceUrl = url.href;
    if (seen.has(sourceUrl)) continue;

    const title = (item?.title ?? '').replace(/\s+/g, ' ').trim();
    if (!title) continue;

    seen.add(sourceUrl);
    studies.push({
      title,
      municipalityOwner: MUNICIPALITY_OWNER,
      municipalityAreas: ['Burlington'],
      status: 'unknown', // no status in the feed — inferred during classification
      rawStatus: '',
      sourceUrl,
    });
  }

  return studies;
}

/**
 * Fetches Burlington's EA / capital-project news notices from the NewsModule JSON feed.
 */
export async function fetchBurlingtonNewsStudies(): Promise<EAStudy[]> {
  return parseBurlingtonNewsFeed(await fetchJson(`${BASE_URL}${FEED_PATH}`));
}

/**
 * Extracts published-document links from a news page.
 *
 * Documents are hosted under `/en/news/resources/...` as PDF/Office files. The news pages
 * carry no per-document date label, so `date` is always null. Scoped to the page's main
 * content so global header/footer links are not picked up.
 */
function extractDocumentLinks(root: Element | Document): DocumentLink[] {
  const links: DocumentLink[] = [];
  const seen = new Set<string>();

  for (const anchor of root.querySelectorAll('a')) {
    const href = anchor.getAttribute('href') ?? '';
    if (!/\/news\/resources\/.+\.(?:pdf|docx?|xlsx?)(?:[?#].*)?$/i.test(href)) continue;

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
 * - `description`: plain text from the page's `.ge-content` body blocks (truncated, used for classification)
 * - `engagementHtml`: inner HTML of those blocks with relative links resolved (used for engagement extraction)
 * - `documentLinks`: published documents from `/en/news/resources/` (title, URL; no date label)
 * - `contentHash`: SHA-256 of the body blocks' innerHTML + document titles+hrefs
 *
 * Falls back to `h1` + main content text for `description` when no `.ge-content` block exists.
 */
export async function parseBurlingtonNewsDetail(html: string): Promise<EAStudyDetail> {
  const doc = parseHtml(html);
  const root = doc.querySelector('#mainContent') ?? doc.body;

  const contentBlocks = Array.from(root.querySelectorAll('.ge-content'));

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

  const engagementHtml = contentBlocks
    .map((el) => el.innerHTML.trim())
    .filter(Boolean)
    .join('\n\n')
    .replace(/href="(\/\/[^"]+)"/g, `href="https:$1"`)
    .replace(/href="(\/[^"]+)"/g, `href="${BASE_URL}$1"`);

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
