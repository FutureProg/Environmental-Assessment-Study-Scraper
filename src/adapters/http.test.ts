import { expect } from '@std/expect';
import { describe, it } from '@std/testing/bdd';
import { absolutiseHtmlHrefs, absoluteUrl } from './http.ts';

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
