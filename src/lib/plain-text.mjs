import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMdx from 'remark-mdx';

/** Walk the Markdown/MDX syntax tree so code, tables, and late paragraphs remain
 * searchable without indexing imports, JavaScript expressions, or raw markup. */
export function plainText(source, mdx = false) {
  const processor = unified().use(remarkParse);
  if (mdx) processor.use(remarkMdx);
  const tree = processor.parse(source);
  const fragments = [];
  function walk(node) {
    if (['mdxjsEsm', 'mdxFlowExpression', 'mdxTextExpression', 'html', 'definition'].includes(node.type)) return;
    if (typeof node.value === 'string') fragments.push(node.value);
    if (node.type === 'image' && node.alt) fragments.push(node.alt.split('|')[0]);
    if (node.children) node.children.forEach(walk);
  }
  walk(tree);
  return fragments.join(' ').replace(/\s+/g, ' ').trim();
}
