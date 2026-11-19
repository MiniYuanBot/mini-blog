import test from 'node:test';
import assert from 'node:assert/strict';
import { importTypeScript } from './helpers.mjs';
import { plainText } from '../src/lib/plain-text.mjs';

const { paginate, pageHref, pageNumbers, laterPageParams } = await importTypeScript(new URL('../src/lib/pagination.ts', import.meta.url));
const { queryTerms, searchEntries, scoreEntry, snippetFor } = await importTypeScript(new URL('../src/lib/search.ts', import.meta.url));
const { compareEntries, entryTimestamp } = await importTypeScript(new URL('../src/lib/entry-order.ts', import.meta.url));

test('equal publication dates keep course lectures in natural order without using revision dates', () => {
  const note = (id, published = '2026-10-10', updated = '2026-10-10') => ({
    id, collection: 'studies', data: { published: new Date(published), updated: new Date(updated) },
  });
  const entries = [
    note('term/course/10-last'), note('term/course/questions'),
    note('term/course/2-middle', '2026-10-10', '2026-11-20'), note('term/course/01-first'),
    note('term/older/01-first', '2026-10-09'), note('term/newer/01-first', '2026-10-11'),
  ];
  assert.deepEqual(entries.sort(compareEntries).map(({ id }) => id), [
    'term/newer/01-first', 'term/course/01-first', 'term/course/2-middle',
    'term/course/10-last', 'term/course/questions', 'term/older/01-first',
  ]);
  assert.equal(new Set(entries.filter(({ id }) => id.startsWith('term/course/')).map(entryTimestamp)).size, 1);
  assert.equal(entryTimestamp({ id: 'paper', collection: 'publications', data: { year: 2026 } }), Date.UTC(2026, 0, 1));
});

test('empty collections have one valid empty page, with no pagination routes', () => {
  const page = paginate([], 20, 10);
  assert.equal(page.page, 1);
  assert.equal(page.totalPages, 1);
  assert.deepEqual(page.items, []);
  assert.equal(page.firstItem, 0);
  assert.equal(page.lastItem, 0);
  assert.equal(page.hasPrev, false);
  assert.equal(page.hasNext, false);
  assert.deepEqual(laterPageParams(0, 10), []);
});

test('pagination neither drops nor duplicates entries and has one first-page URL', () => {
  const entries = Array.from({ length: 23 }, (_, index) => index);
  const pages = [1, 2, 3].map((number) => paginate(entries, number, 10));
  assert.deepEqual(pages.flatMap(({ items }) => items), entries);
  assert.deepEqual([pages[2].firstItem, pages[2].lastItem], [21, 23]);
  assert.equal(paginate(entries, -2, 10).page, 1);
  assert.equal(paginate(entries, Number.NaN, 10).page, 1);
  assert.equal(paginate(entries, 99, 10).page, 3);
  assert.equal(pageHref('/explorations/', 1), '/explorations/');
  assert.equal(pageHref('/tags/systems', 2), '/tags/systems/page/2/');
  assert.deepEqual(laterPageParams(23, 10).map(({ params }) => params.page), ['2', '3']);
  assert.deepEqual(pageNumbers(6, 12), [1, 'gap', 5, 6, 7, 'gap', 12]);
});

const entry = (overrides = {}) => ({
  title: 'Parser internals', description: 'An integration fixture', collection: 'explorations',
  tags: ['compilers'], published: '2000-01-01', url: '/explorations/parser/', body: 'A syntax tree.', ...overrides,
});

test('full-text search finds code and a unique term beyond the old 1,000-character limit', () => {
  const body = plainText(`${'A paragraph of test prose. '.repeat(150)}\n\n\`\`\`ts\nconst lateNeedle = 7;\n\`\`\``);
  assert.ok(body.indexOf('lateNeedle') > 1000);
  const results = searchEntries([entry({ body })], 'lateneedle');
  assert.equal(results.length, 1);
  assert.match(snippetFor(results[0].entry, ['lateneedle']), /lateNeedle/);
});

test('search requires every query term, ranks title matches, and filters collections', () => {
  const records = [
    entry({ title: 'A note', body: 'parser syntax', published: '2000-01-02' }),
    entry({ title: 'Parser syntax', url: '/explorations/title/' }),
    entry({ title: 'Parser syntax', collection: 'studies', url: '/studies/title/' }),
  ];
  assert.deepEqual(queryTerms(' PARSER  syntax parser '), ['parser', 'syntax']);
  assert.equal(searchEntries(records, 'parser syntax', 'explorations')[0].entry.url, '/explorations/title/');
  assert.equal(searchEntries(records, 'parser syntax', 'studies').length, 1);
  assert.equal(searchEntries(records, 'parser nonexistent').length, 0);
  assert.equal(searchEntries(records, '').length, 0);
  assert.equal(scoreEntry(entry(), []), 0);
});

test('Markdown/MDX extraction retains prose, image alternatives, tables and code without indexing JS', () => {
  const result = plainText('import Marker from "./private-module.astro";\n\n## Heading\n\n<Marker>Visible component text</Marker>\n\n{secretIdentifier}\n\n![Accessible image](./asset.png)\n\n| Name | Value |\n| --- | --- |\n| field | cell |', true);
  assert.match(result, /Heading/);
  assert.match(result, /Visible component text/);
  assert.match(result, /Accessible image/);
  assert.match(result, /field/);
  assert.doesNotMatch(result, /private-module|secretIdentifier|asset\.png/);
});

test('snippets remain plain text and handle a query absent from the body', () => {
  const sample = entry({ body: '<img src=x onerror=alert(1)> raw fixture' });
  assert.equal(snippetFor(sample, ['absent']), sample.body);
  assert.equal(snippetFor(entry({ body: '', description: 'Description fallback' }), []), 'Description fallback');
});
