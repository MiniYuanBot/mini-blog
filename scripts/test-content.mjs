/** Build technical fixtures in an isolated project. Never add sample articles to
 * the real content directories or rely on the old project's assets. */
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { unified } from 'unified';
import rehypeParse from 'rehype-parse';
import { visit } from 'unist-util-visit';
import sharp from 'sharp';
import { diagramSource, cacheFile } from '../src/plugins/lib/plantuml.mjs';
import { auditLinks } from './check-links.mjs';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const cacheRoot = join(projectRoot, '.cache');
await mkdir(cacheRoot, { recursive: true });
const fixtureRoot = await mkdtemp(join(cacheRoot, 'content-test-'));
const sourceRoot = join(projectRoot, 'src');
const require = createRequire(import.meta.url);
const astroPackagePath = require.resolve('astro/package.json');
const astroPackage = JSON.parse(await readFile(astroPackagePath, 'utf8'));
const astroBin = resolve(dirname(astroPackagePath), astroPackage.bin.astro);
const parser = unified().use(rehypeParse);

async function put(path, content) {
  const target = join(fixtureRoot, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content);
}

function markdown(metadata, body) {
  return `---\n${Object.entries(metadata).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n')}\n---\n\n${body}\n`;
}

function elements(html, predicate) {
  const matches = [];
  visit(parser.parse(html), 'element', (node) => { if (predicate(node)) matches.push(node); });
  return matches;
}

function textContent(node) {
  return node.type === 'text' ? node.value : (node.children || []).map(textContent).join('');
}

function articleMetadata(html) {
  return elements(html, (node) => node.tagName === 'script' && node.properties.type === 'application/ld+json')
    .map((node) => JSON.parse(textContent(node)))
    .find((data) => data['@type'] === 'ScholarlyArticle');
}

async function readOutput(path) { return readFile(join(fixtureRoot, 'dist', path), 'utf8'); }
const outputExists = async (path) => readOutput(path).then(() => true, () => false);

async function walk(directory) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await walk(path));
    else if (entry.isFile()) paths.push(path);
  }
  return paths;
}

try {
  // Copy implementation, deliberately excluding all real author content.
  await cp(sourceRoot, join(fixtureRoot, 'src'), {
    recursive: true,
    filter: (path) => relative(sourceRoot, path).split(sep)[0] !== 'content',
  });
  for (const filename of ['astro.config.ts', 'site.config.ts', 'tsconfig.json', 'package.json']) {
    await cp(join(projectRoot, filename), join(fixtureRoot, filename));
  }
  const fixtureConfig = join(fixtureRoot, 'site.config.ts');
  const fixtureFriend = {
    name: 'Field Notes', url: 'https://example.org/field-notes/', recommendation: 'I come back for the sketches.',
  };
  await writeFile(fixtureConfig, [
    await readFile(fixtureConfig, 'utf8'),
    'site.pageSize = 10;',
    `friends.push(${JSON.stringify(fixtureFriend)});`,
    '',
  ].join('\n'));
  await cp(join(projectRoot, 'public'), join(fixtureRoot, 'public'), { recursive: true });
  for (const name of ['publications', 'projects', 'explorations', 'studies']) {
    await mkdir(join(fixtureRoot, 'src', 'content', name), { recursive: true });
  }

  const metadata = {
    title: 'Integration fixture: content pipeline', description: 'Technical test content; never published to the real website.',
    published: '2000-12-20', tags: ['integration-fixture', 'systems'], featured: true,
  };
  const uml = 'Parser -> Renderer: Integration fixture';
  const image = await sharp({ create: { width: 120, height: 60, channels: 3, background: '#667268' } }).png().toBuffer();
  await put('src/content/explorations/assets/fixture.png', image);
  await put('src/content/explorations/assets/Mixed Case Image.png', image);
  await put('src/content/explorations/assets/fixture.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60" viewBox="0 0 120 60"><rect x="1" y="1" width="118" height="58" fill="none" stroke="#667268"/></svg>');
  await put('public/images/raw-fixture.png', image);
  await put('src/content/studies/assets/fixture.png', image);
  const body = [
    '## Parser stage',
    '',
    'Inline mathematics: $E = mc^2$.',
    '',
    'A footnote reference.[^pipeline] The same note again.[^pipeline]',
    '',
    '$$\n\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}\n$$',
    '',
    '```ts\nexport const fixtureNumber = 42;\n```',
    '',
    '![Accessible pipeline fixture|w=75%|credit: Integration test](./assets/fixture.png "Native image caption")',
    '',
    '| Stage | Result |\n| --- | --- |\n| Parse | Syntax tree |',
    '',
    '![图 7：@@重点@@|width:60%|credit: [[论文|https://example.com/paper]]](./assets/Mixed%20Case%20Image.png)',
    '',
    '![图：第二张|300](./assets/fixture.png)',
    '',
    '![图：第三张][legacy-reference]',
    '',
    '[legacy-reference]: ./assets/fixture.png',
    '',
    '<img src="/images/raw-fixture.png" alt="Raw HTML public image" width="120" height="60" />',
    '',
    '![SVG image alternative](./assets/fixture.svg)',
    '',
    '> [!tip] 中文提示\n> 保留中文内容。\n>\n> > [!question]- 折叠问题\n> > 保留答案。',
    '',
    '### Renderer stage',
    '',
    '```mermaid\nflowchart LR\nA[Parser] --> B[Output]\n```',
    '',
    `\`\`\`plantuml Pipeline fixture\n${uml}\n\`\`\``,
    '',
    '## Repeated heading',
    '',
    'First heading with this label.',
    '',
    '## Repeated heading',
    '',
    'Second heading with the same label.',
    '',
    '## Full text boundary',
    '',
    'A deliberately repeated sentence checks the complete search index. '.repeat(100),
    '',
    'LateBoundaryNeedle verifies indexing beyond the former excerpt limit.',
    '',
    '[A downloadable attachment](/downloads/fixture.txt)',
    '',
    '[^pipeline]: Technical footnote fixture for build-time SVG arrows.',
  ].join('\n');
  await put('src/content/explorations/pipeline.md', markdown(metadata, body));
  for (let index = 0; index < 10; index += 1) {
    const filename = index === 0 ? 'nested/page-00.md' : `page-${String(index).padStart(2, '0')}.md`;
    await put(`src/content/explorations/${filename}`, markdown({
      ...metadata, title: `Integration fixture ${index}`, published: `2000-02-${String(index + 1).padStart(2, '0')}`, featured: false,
    }, `## Pagination fixture\n\nTechnical fixture entry ${index}.`));
  }
  await put('src/components/TestMarker.astro', '<aside data-fixture-marker><slot /></aside>');
  await put('src/content/studies/mdx-fixture.mdx', markdown({
    ...metadata, title: 'Integration fixture: MDX', published: '2000-12-21', course: 'Integration test', lang: 'zh-CN', featured: false,
  }, [
    "import Marker from '../../components/TestMarker.astro';",
    '',
    '## MDX heading',
    '',
    '<Marker>Visible MDX component text.</Marker>',
    '',
    'Inline MDX mathematics: $a^2 + b^2 = c^2$.',
    '',
    'An MDX footnote reference.[^mdx-note] The same note again.[^mdx-note]',
    '',
    '![Accessible MDX image](./assets/fixture.png "MDX image caption")',
    '',
    '```mermaid\nflowchart LR\nM[MDX] --> H[HTML]\n```',
    '',
    `\`\`\`plantuml MDX pipeline fixture\n${uml}\n\`\`\``,
    '',
    '```js\nconst mdxFixture = true;\n```',
    '',
    '[^mdx-note]: Technical MDX footnote fixture for build-time SVG arrows.',
  ].join('\n')));
  await put('src/content/publications/publication-fixture.md', markdown({
    ...metadata, title: 'Integration fixture: publication schema', published: '2000-11-01', featured: false,
    authors: ['Integration test'], venue: 'Schema validation fixture', doi: '10.1234/integration-fixture',
    paper: 'https://example.com/paper', code: 'https://example.com/code',
  }, '## Publication metadata\n\nTechnical schema fixture.'));
  await put('src/content/publications/partial-publication-fixture.md', markdown({
    title: 'Integration fixture: accepted publication',
    description: 'Technical metadata fixture with a known season and role, without an exact date or author list.',
    year: 2000, period: 'Spring 2000', status: 'accepted', authorRole: 'Third author',
    tags: ['integration-fixture', 'systems'],
  }, '## Partial publication metadata\n\nTechnical fixture for an accepted paper with coarse dating.'));
  await put('src/content/projects/project-fixture.md', markdown({
    ...metadata, title: 'Integration fixture: project schema', published: '2000-10-01', featured: false,
    repository: 'https://example.com/repository', website: 'https://example.com/project', status: 'active',
  }, '## Project metadata\n\nTechnical schema fixture.'));
  await put('src/content/explorations/draft-fixture.md', markdown({
    ...metadata, title: 'HiddenDraftMarker88', draft: true, tags: ['private-fixture'],
  }, 'HiddenDraftBody88'));
  await put('src/content/studies/future-fixture.md', markdown({
    ...metadata, title: 'HiddenFutureMarker88', published: '2999-01-01', tags: ['future-fixture'],
  }, 'HiddenFutureBody88'));
  await put('public/downloads/fixture.txt', 'Technical download fixture.\n');
  await mkdir(join(fixtureRoot, '.plantuml-cache'), { recursive: true });
  await writeFile(cacheFile(diagramSource(uml), fixtureRoot), '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="64" viewBox="0 0 240 64"><rect width="240" height="64" fill="white"/><text x="12" y="36" fill="#222">PlantUML cache fixture</text></svg>');

  console.log(`Building isolated content fixtures: ${relative(projectRoot, fixtureRoot)}`);
  const build = spawnSync(process.execPath, [astroBin, 'build'], {
    cwd: fixtureRoot,
    env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1' },
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  });
  await writeFile(join(fixtureRoot, 'build.log'), `${build.stdout || ''}\n${build.stderr || ''}`);
  if (build.status !== 0) throw new Error(`Fixture build failed (${build.status ?? build.error}).\n${build.stdout || ''}\n${build.stderr || ''}`);

  const article = await readOutput('explorations/pipeline/index.html');
  const mdxArticle = await readOutput('studies/mdx-fixture/index.html');
  for (const html of [article, mdxArticle]) {
    assert.match(html, /<html[^>]+lang="en"/);
    assert.ok(elements(html, (node) => node.tagName === 'h1').length === 1, 'One primary heading per article');
    assert.ok(elements(html, (node) => node.properties.className?.includes('katex')).length, 'KaTeX must render at build time');
    assert.ok(elements(html, (node) => node.properties.className?.includes('astro-code')).length, 'Syntax highlighting must be generated');
    const codeFrames = elements(html, (node) => node.properties.className?.includes('code-block'));
    assert.equal(codeFrames.length, 1, 'Only the code fence gets a window; math and diagrams must stay separate');
    const frame = codeFrames[0];
    const pre = frame.children.find((node) => node.tagName === 'pre');
    assert.ok(pre?.properties.className?.includes('astro-code'), 'Shiki must remain inside the code window');
    assert.equal(textContent(pre), html === article ? 'export const fixtureNumber = 42;' : 'const mdxFixture = true;');
    const toolbar = frame.children.find((node) => node.properties?.className?.includes('code-header'));
    assert.equal(toolbar.properties.lang, 'en');
    const language = toolbar.children.find((node) => node.properties?.className?.includes('code-language'));
    assert.equal(textContent(language), html === article ? 'TypeScript' : 'JavaScript');
    const copy = toolbar.children.find((node) => node.tagName === 'button');
    assert.ok(copy.properties.hidden, 'Copy control must progressively enhance after JS initializes');
    assert.match(copy.properties.ariaLabel, /^Copy .+ code$/);
    assert.equal(copy.children.filter((node) => node.tagName === 'svg').length, 2);
    assert.ok(elements(html, (node) => 'dataMermaid' in node.properties || 'data-mermaid' in node.properties).length, 'Mermaid source must survive both Markdown and MDX');
    assert.ok(elements(html, (node) => node.tagName === 'img' && String(node.properties.src).startsWith('data:image/svg+xml;base64,')).length, 'PlantUML must render from a local cache');
    assert.ok(elements(html, (node) => node.tagName === 'figure' && node.properties.className?.includes('content-figure')).length, 'Figure semantics must survive image optimization');
    assert.ok(elements(html, (node) => node.tagName === 'figcaption').length, 'Captions must render in Markdown and MDX');
    assert.ok(elements(html, (node) => node.tagName === 'img' && String(node.properties.src).startsWith('/_astro/') && node.properties.width && node.properties.height).length, 'Native images need local optimized URLs and intrinsic dimensions');
    assert.ok(elements(html, (node) => node.tagName === 'script' && node.properties.type === 'application/ld+json').length, 'Article structured data must be present');
    const backrefs = elements(html, (node) => node.tagName === 'a' && 'dataFootnoteBackref' in node.properties);
    assert.equal(backrefs.length, 2, 'Markdown and MDX footnotes must preserve every return link');
    for (const [index, backref] of backrefs.entries()) {
      assert.equal(backref.properties.ariaLabel, index === 0 ? 'Back to reference 1' : 'Back to reference 1-2');
      const icon = backref.children.find((node) => node.type === 'element' && node.tagName === 'svg');
      assert.ok(icon, 'Generated footnote backrefs must use SVG arrows');
      assert.equal(icon.properties.dataArrowDirection, 'up');
      assert.equal(icon.properties.ariaHidden, 'true');
      const repeat = backref.children.find((node) => node.type === 'element' && node.tagName === 'sup');
      assert.equal(repeat?.children[0]?.value, index === 0 ? undefined : '2');
    }
    assert.doesNotMatch(html, /↩/, 'Generated Unicode return glyphs must be replaced');
  }
  assert.match(article, /id="parser-stage"/);
  assert.match(article, /href="#parser-stage"/);
  assert.match(article, /id="repeated-heading-1"/);
  assert.match(article, /Figure 1\. Native image caption/);
  const legacyGroup = elements(article, (node) => node.properties.className?.includes('content-figure-group'))[0];
  assert.ok(legacyGroup, 'Legacy figures must keep their responsive group');
  assert.match(textContent(legacyGroup), /图 7：重点/);
  assert.match(textContent(legacyGroup), /图 8：第二张/);
  assert.match(textContent(legacyGroup), /图 9：第三张/);
  assert.equal(legacyGroup.children.filter((node) => node.tagName === 'figure').length, 3);
  assert.ok(elements(article, (node) => node.tagName === 'a' && node.properties.href === 'https://example.com/paper').length, 'Legacy credit links must remain clickable');
  assert.ok(elements(article, (node) => node.tagName === 'img' && node.properties.style?.includes('width: 60%')).length, 'Native optimization must retain percentage widths');
  assert.ok(elements(article, (node) => node.tagName === 'img' && node.properties.style?.includes('width: 300px')).length, 'Native optimization must retain pixel widths');
  assert.ok(elements(article, (node) => node.tagName === 'img' && node.properties.src === '/images/raw-fixture.png').length, 'Raw HTML public image URLs must still work');
  assert.ok(elements(article, (node) => node.tagName === 'img' && String(node.properties.src).startsWith('/_astro/') && String(node.properties.src).endsWith('.svg') && node.properties.width === 120 && node.properties.height === 60).length, 'Local SVG images must retain their format and dimensions');
  assert.ok(elements(article, (node) => node.tagName === 'aside' && node.properties.dataCallout === 'tip').length);
  assert.ok(elements(article, (node) => node.tagName === 'details' && node.properties.dataCallout === 'question' && !node.properties.open).length);
  assert.match(mdxArticle, /data-fixture-marker/);
  assert.ok(elements(mdxArticle, (node) => node.tagName === 'article' && node.properties.lang === 'zh-CN').length, 'Body language must be independent of the English site shell');
  assert.match(mdxArticle, /Figure 1\. MDX image caption/);

  const index = JSON.parse(await readOutput('search-index.json'));
  assert.equal(index.length, 15, 'Search should contain every public entry and no drafts/future entries');
  const indexedArticle = index.find((entry) => entry.url === '/explorations/pipeline/');
  assert.ok(indexedArticle.body.indexOf('LateBoundaryNeedle') > 1000, 'Late paragraphs must not be truncated');
  assert.match(indexedArticle.body, /fixtureNumber/);
  assert.ok(index.find((entry) => entry.url === '/studies/mdx-fixture/').body.includes('Visible MDX component text'));
  const partialUrl = '/publications/partial-publication-fixture/';
  const indexedPartial = index.find((entry) => entry.url === partialUrl);
  assert.ok(indexedPartial, 'A publication with only a year must remain searchable');
  assert.equal(indexedPartial.published, '2000', 'Search must not invent a precise publication date from a year');
  assert.equal(indexedPartial.displayDate, 'Spring 2000', 'Search must display the supplied season');

  const publicationListing = await readOutput('publications/index.html');
  let partialRow;
  for (const row of elements(publicationListing, (node) => node.tagName === 'article')) {
    visit(row, 'element', (node) => { if (node.tagName === 'a' && node.properties.href === partialUrl) partialRow = row; });
  }
  assert.ok(partialRow, 'Accepted publications with coarse dates must appear in the listing');
  assert.match(textContent(partialRow), /Spring 2000/);
  assert.match(textContent(partialRow), /Accepted · Third author/);
  const rowTimes = [];
  visit(partialRow, 'element', (node) => { if (node.tagName === 'time') rowTimes.push(node); });
  assert.equal(rowTimes.length, 0, 'The listing must not emit an exact datetime for a season-only publication');

  const partialPublication = await readOutput('publications/partial-publication-fixture/index.html');
  assert.match(partialPublication, /Spring 2000/);
  assert.match(partialPublication, /Accepted · Third author/);
  assert.equal(elements(partialPublication, (node) => node.tagName === 'time').length, 0);
  assert.equal(elements(partialPublication, (node) => node.tagName === 'meta' && ['article:published_time', 'article:modified_time'].includes(node.properties.property)).length, 0, 'Open Graph must not invent a precise publication date');
  const partialMetadata = articleMetadata(partialPublication);
  assert.ok(partialMetadata, 'Partial publications still need ScholarlyArticle metadata');
  for (const key of ['datePublished', 'dateModified', 'author']) {
    assert.equal(Object.hasOwn(partialMetadata, key), false, `Unknown ${key} must be omitted from structured data`);
  }
  const fullPublication = await readOutput('publications/publication-fixture/index.html');
  const fullMetadata = articleMetadata(fullPublication);
  assert.equal(fullMetadata.datePublished, '2000-11-01T00:00:00.000Z', 'Known exact dates must still be published');
  assert.deepEqual(fullMetadata.author, [{ '@type': 'Person', name: 'Integration test' }], 'Known authors must still be published');

  const secondPage = await readOutput('explorations/page/2/index.html');
  const canonical = elements(secondPage, (node) => node.tagName === 'link' && node.properties.rel?.includes('canonical'))[0];
  assert.equal(new URL(canonical.properties.href).pathname, '/explorations/page/2/');
  assert.match(secondPage, /href="\/explorations\/"[^>]*rel="prev"/);
  assert.ok(await outputExists('explorations/nested/page-00/index.html'), 'Nested content paths need stable article routes');
  assert.ok(await outputExists('tags/integration-fixture/page/2/index.html'), 'Tags need pagination too');
  assert.equal(await outputExists('explorations/page/1/index.html'), false);
  assert.equal(await outputExists('explorations/draft-fixture/index.html'), false);
  assert.equal(await outputExists('studies/future-fixture/index.html'), false);
  assert.equal(await outputExists('tags/private-fixture/index.html'), false);
  assert.equal(await outputExists('tags/future-fixture/index.html'), false);

  const rss = await readOutput('rss.xml');
  assert.equal((rss.match(/<item>/g) || []).length, 15);
  assert.match(rss, /<language>en<\/language>/);
  const rssItems = [...rss.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((match) => match[1]);
  const partialRssItem = rssItems.find((item) => item.includes(partialUrl));
  assert.ok(partialRssItem, 'Publications without an exact date must remain in RSS');
  assert.doesNotMatch(partialRssItem, /<pubDate>|<author>/, 'RSS must omit unknown dates and author names');
  const fullRssItem = rssItems.find((item) => item.includes('/publications/publication-fixture/'));
  const fullRssDate = fullRssItem?.match(/<pubDate>([^<]+)<\/pubDate>/)?.[1];
  assert.ok(fullRssDate, 'RSS must preserve an explicitly supplied publication date');
  assert.equal(new Date(fullRssDate).toISOString(), '2000-11-01T00:00:00.000Z');
  const sitemap = await readOutput('sitemap-0.xml');
  assert.match(sitemap, /\/explorations\/pipeline\//);
  assert.match(sitemap, /\/studies\/mdx-fixture\//);
  assert.match(sitemap, /\/publications\/partial-publication-fixture\//);
  assert.doesNotMatch(sitemap, /\/search\/|\/404\//);
  const home = await readOutput('index.html');
  assert.match(home, /Integration fixture: content pipeline/);

  const friendsPage = await readOutput('friends/index.html');
  const [friendRow] = elements(friendsPage, (node) => node.tagName === 'li'
    && node.children.some((child) => child.tagName === 'a' && child.properties.href === fixtureFriend.url));
  assert.ok(friendRow && textContent(friendRow).includes(fixtureFriend.recommendation));
  const [template] = elements(friendsPage, (node) => node.tagName === 'pre');
  const requestLinks = elements(friendsPage, (node) => node.tagName === 'a' && node.properties.href.includes('body='));
  assert.equal(requestLinks.length, 2, 'Both issue and email requests need a prefilled body');
  for (const link of requestLinks) {
    const body = new URL(link.properties.href).searchParams.get('body');
    assert.equal(body.replaceAll('\r\n', '\n'), textContent(template), 'The prefilled request must match the copyable example');
  }

  for (const file of await walk(join(fixtureRoot, 'dist'))) {
    if (!/\.(?:html|xml|json|js)$/.test(file)) continue;
    assert.doesNotMatch(await readFile(file, 'utf8'), /Hidden(?:Draft|Future)(?:Marker|Body)88/, `Private content leaked into ${relative(fixtureRoot, file)}`);
  }
  const links = await auditLinks(join(fixtureRoot, 'dist'));
  assert.deepEqual(links.errors, [], `Broken fixture links:\n${links.errors.join('\n')}`);
  console.log(`Content integration passed: Markdown + MDX, math, diagrams, images, metadata, full-text search, tags, pagination, RSS, sitemap, and draft/future exclusion.`);
  console.log(`Fixture output retained for inspection: ${join(fixtureRoot, 'dist')}`);
  console.log(`Link audit passed: ${links.pages} pages, ${links.checked} local references.`);
} catch (error) {
  console.error(error.stack || error.message);
  console.error(`Fixture project retained at ${fixtureRoot}`);
  process.exitCode = 1;
}
