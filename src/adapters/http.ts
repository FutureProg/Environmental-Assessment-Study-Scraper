import { JSDOM } from 'jsdom';

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export const BROWSER_HEADERS = {
  'User-Agent': USER_AGENT,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-CA,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Cache-Control': 'max-age=0',
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Parses an HTML string into a DOM Document, optionally with a base URL. */
export function parseHtml(html: string, url?: string): Document {
  const options = url ? { url, pretendToBeVisual: true } : { pretendToBeVisual: true };
  return new JSDOM(html, options).window.document;
}

/**
 * Fetches a URL with browser-like headers and returns the response body.
 * Sleeps 1s before each request to stay polite to municipal sites.
 */
export async function fetchHtml(url: string): Promise<string> {
  await sleep(1000);
  const response = await fetch(url, { headers: BROWSER_HEADERS });
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
  return response.text();
}

/** Fetches a URL and parses the response into a DOM Document. */
export async function fetchDocument(url: string): Promise<Document> {
  return parseHtml(await fetchHtml(url), url);
}

/**
 * Fetches a URL and returns the response body as text, without browser-specific HTML headers.
 * Use for JSON API endpoints where sending `Accept: text/html` would be semantically wrong.
 */
export async function fetchJson(url: string): Promise<string> {
  await sleep(1000);
  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'application/json,*/*;q=0.8',
      'Accept-Language': 'en-CA,en;q=0.9',
    },
  });
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
  return response.text();
}

/**
 * Resolves a possibly-relative href to an absolute URL against a base URL.
 * Handles https/http, protocol-relative `//`, and site-relative `/` paths.
 */
export function absoluteUrl(href: string, baseUrl: string): string {
  if (href.startsWith('http://') || href.startsWith('https://')) return href;
  if (href.startsWith('//')) return `https:${href}`;
  return `${baseUrl}${href}`;
}

/** SHA-256 hex digest of a string — used for detail-page content hashing. */
export async function sha256Hex(input: string): Promise<string> {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
