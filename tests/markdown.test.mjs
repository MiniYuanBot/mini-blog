import test from 'node:test';
import assert from 'node:assert/strict';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkFigures from '../src/plugins/remark-figures.mjs';
import remarkDiagrams from '../src/plugins/remark-diagrams.mjs';
import remarkCallouts from '../src/plugins/remark-callouts.mjs';
import rehypeCodeBlocks from '../src/plugins/rehype-code-blocks.mjs';
import rehypeParse from 'rehype-parse';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { visit } from 'unist-util-visit';
import { parseAlt, normalizeWidth } from '../src/plugins/lib/image-alt.mjs';
import { diagramSource, diagramHash } from '../src/plugins/lib/plantuml.mjs';
import { createMarkdownProcessor } from '@astrojs/markdown-remark';
import { footnoteBackContent } from '../src/lib/arrow.mjs';

function transform(markdown, plugin) {
  const processor = unified().use(remarkParse).use(plugin);
  return processor.runSync(processor.parse(markdown));
}

test('figures preserve the native image node, alt text, and a separately numbered caption', () => {
  const tree = transform('![Diagram alternative|w=60%|credit: Test author](./image.png "Caption text")\n\nA paragraph between the figures.\n\n![Second alternative](./other.png "Second caption")', remarkFigures);
  const [first, , second] = tree.children;
  assert.equal(first.data.hName, 'figure');
  assert.equal(first.children[0].type, 'image');
  assert.equal(first.children[0].url, './image.png');
  assert.equal(first.children[0].alt, 'Diagram alternative');
  assert.equal(first.children[0].data.hProperties.loading, 'lazy');
  assert.equal(first.children[1].data.hName, 'figcaption');
  assert.equal(first.children[1].children.map((node) => node.value).join(''), 'Figure 1. Caption text — Credit: Test author');
  assert.equal(second.data.hProperties.id, 'figure-2');
  const nextDocument = transform('![Alternative](./image.png "Caption")', remarkFigures);
  assert.equal(nextDocument.children[0].data.hProperties.id, 'figure-1');
});

test('images without captions stay images and untrusted metadata is not turned into raw HTML', () => {
  const tree = transform('![Alternative](./image.png)\n\n![Figure: <script>test</script>|w=1px;background:red](./image.png)', remarkFigures);
  assert.equal(tree.children[0].data, undefined);
  const figure = tree.children[1];
  assert.equal(figure.children[1].children[0].type, 'text');
  assert.equal(figure.children[0].data.hProperties.style, undefined);
  assert.equal(normalizeWidth('10px; color:red'), null);
  assert.deepEqual(parseAlt('Alternative|300|credit: Fixture'), { caption: 'Alternative', width: '300px', credit: 'Fixture' });
});

test('Mermaid keeps literal source in a text node for accessible no-JS fallback', () => {
  const tree = transform('```mermaid\nflowchart LR\nA["<b>Fixture</b>"] --> B[Output]\n```', remarkDiagrams);
  const block = tree.children[0];
  assert.equal(block.data.hName, 'pre');
  assert.equal(block.data.hProperties['data-mermaid'], true);
  assert.equal(block.children[0].type, 'text');
  assert.match(block.children[0].value, /<b>Fixture<\/b>/);
});

test('PlantUML source keys are stable and a missing cache fails with a repair command', () => {
  const source = diagramSource('A -> B: Unit fixture');
  assert.match(source, /^@startuml\n/);
  assert.match(source, /skinparam shadowing false/);
  assert.match(source, /\n@enduml$/);
  assert.equal(diagramHash(source), diagramHash(diagramSource('  A -> B: Unit fixture  ')));
  assert.notEqual(diagramHash(source), diagramHash(diagramSource('B -> A: Unit fixture')));
  const named = diagramSource('@startuml named-diagram\nA -> B: Unit fixture\n@enduml');
  assert.match(named, /^@startuml named-diagram\nhide circle\n/);
  assert.match(named, /skinparam shadowing false/);
  assert.equal(named.match(/@startuml/g).length, 1);
  assert.throws(() => transform('```plantuml\nUnitMissingCacheA -> UnitMissingCacheB: unique-blank-cache\n```', remarkDiagrams), /pnpm diagrams/);
});

test('legacy Chinese captions retain numbering, rich credits, widths and image groups', () => {
  const tree = transform([
    '![图 7：@@橙色@@神经元|w=60%|credit: [[论文|https://example.com/paper]]](./first.png)',
    '',
    '![图：@第二张@|300](./second.png)',
    '',
    '![Figure: Third](./third.png)',
  ].join('\n'), remarkFigures);
  const group = tree.children[0];
  assert.equal(group.data.hName, 'div');
  assert.deepEqual(group.data.hProperties.className, ['content-figure-group']);
  assert.equal(group.children.length, 3);
  const [first, second, third] = group.children;
  assert.equal(first.children[0].alt, '图 7：橙色神经元');
  assert.equal(first.children[0].data.hProperties.style, 'width: 60%; max-width: 100%');
  assert.equal(second.children[0].data.hProperties.style, 'width: 300px; max-width: 100%');
  const caption = first.children[1].children;
  assert.equal(caption[0].value, '图 7：');
  assert.equal(caption[1].type, 'strong');
  assert.equal(caption.at(-1).type, 'link');
  assert.equal(caption.at(-1).url, 'https://example.com/paper');
  assert.equal(second.children[1].children[0].value, '图 8：');
  assert.equal(third.children[1].children[0].value, 'Figure 9. Third');
  assert.deepEqual(group.children.map((node) => node.data.hProperties.id), ['figure-1', 'figure-2', 'figure-3']);
});

test('image references and inline image widths survive, unsafe credit links stay text', () => {
  const tree = transform('Text ![inline|width:40%](./inline.png).\n\n![图 1：Caption|credit: {{unsafe|javascript:alert(1)}}][pic]\n\n[pic]: ./ref.png', remarkFigures);
  assert.equal(tree.children[0].children[1].data.hProperties.style, 'width: 40%; max-width: 100%');
  const figure = tree.children[1];
  assert.equal(figure.children[0].type, 'image');
  assert.equal(figure.children[0].url, './ref.png');
  assert.equal(figure.children[1].children.at(-1).type, 'text');
  assert.equal(figure.children[1].children.at(-1).value, 'unsafe');
});

test('callouts preserve formatted titles, nested lists and folding without changing literal code', () => {
  const tree = transform('> [!tip] **重点**\n> 中文正文\n>\n> - 条目\n>\n> > [!question]- 问题\n> > 答案\n\n> [!info]+\n> 内容\n\n```text\n> [!tip] literal\n```', remarkCallouts);
  const [callout, open, code] = tree.children;
  assert.equal(callout.data.hName, 'aside');
  assert.equal(callout.children[0].children.find((n) => n.type === 'strong').children[0].value, '重点');
  const body = callout.children[1].children;
  assert.equal(body[0].children[0].value, '中文正文');
  assert.equal(body[1].type, 'list');
  assert.equal(body[2].data.hName, 'details');
  assert.equal(body[2].data.hProperties.open, undefined);
  assert.equal(body[2].children[0].data.hName, 'summary');
  assert.equal(open.data.hProperties.open, true);
  assert.equal(open.children[0].children[0].value, 'Info');
  assert.equal(code.value, '> [!tip] literal');
});

test('generated footnote backrefs use accessible SVGs and preserve repeated-reference numbering', async () => {
  const renderer = await createMarkdownProcessor({ syntaxHighlight: false, remarkRehype: { footnoteBackContent } });
  const { code } = await renderer.render('A statement.[^note] A second reference.[^note]\n\nA meaningful relation: x → y.\n\n[^note]: A test footnote.');
  const backrefs = [...code.matchAll(/<a\b[^>]*data-footnote-backref=""[^>]*>([\s\S]*?)<\/a>/g)];
  assert.equal(backrefs.length, 2);
  assert.match(backrefs[0][0], /aria-label="Back to reference 1"/);
  assert.match(backrefs[1][0], /aria-label="Back to reference 1-2"/);
  for (const [, contents] of backrefs) {
    assert.match(contents, /<svg[^>]*data-arrow-direction="up"/);
    assert.match(contents, /aria-hidden="true"/);
    assert.match(contents, /class="arrow-shaft"/);
    assert.match(contents, /class="arrow-head"/);
  }
  assert.doesNotMatch(backrefs[0][1], /<sup>/);
  assert.match(backrefs[1][1], /<sup>2<\/sup>/);
  assert.doesNotMatch(code, /↩/);
  assert.match(code, /x → y/, 'Author-supplied content arrows must remain untouched');
});

test('code frames retain highlighted text exactly, with language labels and accessible copy buttons', async () => {
  const examples = [
    { lang: 'python', label: 'Python', code: 'def greet():\n    print("<中文> & \\"quotes\\"")\n\n\t# tab and trailing spaces  ' },
    { lang: 'cpp', label: 'C++', code: '#include <iostream>\nint main() { return 0; }' },
    { lang: 'f90', label: 'Fortran 90', code: 'program main\n  print *, "hello"\nend program' },
    { lang: '', label: 'Text', code: '  untyped <text>\n\n\t<svg onload="test">' },
  ];
  const renderer = await createMarkdownProcessor({
    shikiConfig: { themes: { light: 'github-light', dark: 'github-dark' } },
    rehypePlugins: [rehypeCodeBlocks],
  });
  const { code: html } = await renderer.render(examples.map((example) => `\`\`\`${example.lang}\n${example.code}\n\`\`\``).join('\n\n'));
  const blocks = [];
  visit(unified().use(rehypeParse).parse(html), 'element', (node) => {
    if (node.properties.className?.includes('code-block')) blocks.push(node);
  });
  const textOf = (node) => node.type === 'text' ? node.value : (node.children || []).map(textOf).join('');
  assert.equal(blocks.length, examples.length);
  blocks.forEach((block, index) => {
    const [header, pre] = block.children;
    assert.equal(pre.tagName, 'pre');
    assert.ok(pre.properties.className.includes('astro-code'));
    assert.ok(String(pre.properties.style).includes('--shiki-dark'));
    assert.equal(pre.properties.tabIndex, 0);
    assert.equal(textOf(pre), examples[index].code, 'Whitespace and literal markup must survive highlighting');
    assert.equal(textOf(header.children[1]), examples[index].label);
    assert.equal(header.children[0].properties.ariaHidden, 'true');
    const button = header.children.find((node) => node.tagName === 'button');
    assert.equal(button.properties.type, 'button');
    assert.equal(button.properties.ariaLabel, `Copy ${examples[index].label} code`);
    assert.equal(button.properties.hidden, true, 'Nonfunctional controls stay hidden before JS initializes');
    assert.equal(button.children.filter((node) => node.tagName === 'svg').length, 2);
  });
  assert.doesNotMatch(html, /<svg onload=/);
});

test('inline code and Mermaid diagrams are not turned into code windows', async () => {
  const renderer = await createMarkdownProcessor({ remarkPlugins: [remarkDiagrams], rehypePlugins: [rehypeCodeBlocks] });
  const { code } = await renderer.render('Inline `example()` remains inline.\n\n```mermaid\nflowchart LR\nA --> B\n```');
  assert.match(code, /<code>example\(\)<\/code>/);
  assert.match(code, /data-mermaid/);
  assert.doesNotMatch(code, /data-code-block|data-code-copy/);
});

test('display equations remain math, including when a renderer runs the code plugin first', async () => {
  for (const rehypePlugins of [[rehypeKatex, rehypeCodeBlocks], [rehypeCodeBlocks, rehypeKatex]]) {
    const renderer = await createMarkdownProcessor({ remarkPlugins: [remarkMath], rehypePlugins });
    const { code } = await renderer.render('$$\nx^2 + y^2 = 1\n$$\n\nInline $x$.');
    assert.match(code, /katex-display/);
    assert.doesNotMatch(code, /data-code-block|data-code-copy/);
  }
});
