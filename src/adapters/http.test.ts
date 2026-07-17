import { expect } from '@std/expect';
import { describe, it } from '@std/testing/bdd';
import { absolutiseHtmlHrefs, absoluteUrl, fetchOrFail } from './http.ts';

/** Stubs the global fetch for the duration of `fn`, restoring it afterward even if `fn` throws. */
async function withStubbedFetch<T>(stub: typeof fetch, fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = stub;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

const BASE = 'https://www.example.ca';

describe('absoluteUrl', () => {
  it('leaves absolute http(s) URLs untouched', () => {
    expect(absoluteUrl('https://other.com/x', BASE)).toEqual('https://other.com/x');
    expect(absoluteUrl('http://other.com/x', BASE)).toEqual('http://other.com/x');
  });

  it('resolves protocol-relative hrefs to https', () => {
    expect(absoluteUrl('//cdn.example.com/x', BASE)).toEqual('https://cdn.example.com/x');
  });

  it('resolves root-relative hrefs against the base', () => {
    expect(absoluteUrl('/path/to/page', BASE)).toEqual('https://www.example.ca/path/to/page');
  });

  it('resolves bare-relative hrefs against the base (no separator corruption)', () => {
    // the old string-concatenation fallback produced `www.example.castudy/detail`
    expect(absoluteUrl('study/detail', `${BASE}/`)).toEqual('https://www.example.ca/study/detail');
  });

  it('falls back to the raw href when it cannot be parsed', () => {
    expect(absoluteUrl('http://[invalid', BASE)).toEqual('http://[invalid');
  });
});

describe('absolutiseHtmlHrefs', () => {
  it('resolves root-relative hrefs against the base', () => {
    const out = absolutiseHtmlHrefs('<a href="/docs/report.pdf">report</a>', BASE);
    expect(out).toContain('href="https://www.example.ca/docs/report.pdf"');
    expect(out.includes('href="/docs/report.pdf"')).toBe(false);
  });

  it('resolves protocol-relative hrefs to https', () => {
    const out = absolutiseHtmlHrefs('<a href="//cdn.example.com/x">cdn</a>', BASE);
    expect(out).toContain('href="https://cdn.example.com/x"');
  });

  it('leaves absolute hrefs untouched', () => {
    const html = '<a href="https://other.com/x">x</a>';
    expect(absolutiseHtmlHrefs(html, BASE)).toEqual(html);
  });

  it('rewrites every href in a fragment with multiple links', () => {
    const out = absolutiseHtmlHrefs(
      '<p><a href="/a">a</a> and <a href="//cdn.example.com/b">b</a></p>',
      BASE,
    );
    expect(out).toContain('href="https://www.example.ca/a"');
    expect(out).toContain('href="https://cdn.example.com/b"');
  });
});

describe('fetchOrFail', () => {
  it('passes through the response on success', async () => {
    const fakeResponse = new Response('ok');
    const res = await withStubbedFetch(
      () => Promise.resolve(fakeResponse),
      () => fetchOrFail('https://example.com'),
    );
    expect(res).toBe(fakeResponse);
  });

  it('normalizes a thrown network error to a deterministic message containing the url and error constructor name', async () => {
    await expect(
      withStubbedFetch(
        () => {
          throw new TypeError('network blew up');
        },
        () => fetchOrFail('https://example.com'),
      ),
    ).rejects.toThrow('Failed to fetch https://example.com: TypeError');
  });

  it('preserves the original error via cause', async () => {
    const original = new TypeError('dns lookup failed');
    let caught: unknown;
    await withStubbedFetch(
      () => {
        throw original;
      },
      () => fetchOrFail('https://example.com').catch((err) => {
        caught = err;
      }),
    );
    expect((caught as Error).cause).toBe(original);
  });

  it('two failures with different underlying messages produce the identical normalized message (stable for dedup)', async () => {
    const messageFor = (thrown: Error) =>
      withStubbedFetch(
        () => {
          throw thrown;
        },
        () => fetchOrFail('https://example.com'),
      ).catch((err) => (err as Error).message);

    const a = await messageFor(new TypeError('dns lookup failed for host A'));
    const b = await messageFor(new TypeError('connection refused on host B'));
    expect(a).toEqual(b);
  });
});
