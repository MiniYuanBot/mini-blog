import { visit } from 'unist-util-visit';
import { parseAlt } from './lib/image-alt.mjs';

// Caption shorthand from the old blog. Construct nodes rather than raw HTML:
// markup-like text stays escaped, and credit links have a restricted protocol.
function captionNodes(value) {
  const tokens = /\[\[([^|\]]+)\|([^\]]+)\]\]|\{\{([^|}]+)\|([^}]+)\}\}|@@(.+?)@@|@([^\s@][^@]*?)@/g;
  const nodes = [];
  let cursor = 0;
  for (const match of value.matchAll(tokens)) {
    if (match.index > cursor) nodes.push({ type: 'text', value: value.slice(cursor, match.index) });
    if (match[1] || match[3]) {
      const label = match[1] || match[3];
      const url = (match[2] || match[4]).trim();
      const children = captionNodes(label);
      if (/^(?:https?:\/\/|mailto:|\/(?!\/)|#)/i.test(url) && !/[\u0000-\u0020]/.test(url)) nodes.push({ type: 'link', url, children });
      else nodes.push(...children);
    } else nodes.push({ type: match[5] ? 'strong' : 'emphasis', children: captionNodes(match[5] || match[6]) });
    cursor = match.index + match[0].length;
  }
  if (cursor < value.length) nodes.push({ type: 'text', value: value.slice(cursor) });
  return nodes;
}

const plainText = (nodes) => nodes.map((node) => node.type === 'text' ? node.value : plainText(node.children || [])).join('');
const prefixPattern = /^(?:图\s*(\d*)\s*[：:]|Figure\s*(\d*)\s*[:.])\s*/i;

/** Keep the original image node intact for Astro's native image optimizer.
 * HAST properties work in both Markdown and MDX, with no raw HTML injection. */
export default function remarkFigures() {
  return (tree) => {
    let number = 0;
    let figureId = 0;
    const captions = new Map();
    // Resolve reference-style images too, before Astro collects local assets.
    const definitions = new Map();
    visit(tree, 'definition', (node) => definitions.set(node.identifier.toLowerCase(), node));
    visit(tree, 'imageReference', (node, index, parent) => {
      const definition = definitions.get(node.identifier.toLowerCase());
      if (definition && parent) parent.children[index] = { type: 'image', url: definition.url, title: definition.title, alt: node.alt, position: node.position };
    });
    visit(tree, 'image', (image) => {
      const { caption, width, credit } = parseAlt(image.alt);
      image.alt = plainText(captionNodes(caption));
      const properties = width ? { style: `width: ${width}; max-width: 100%` } : {};
      image.data = { ...image.data, hProperties: { ...image.data?.hProperties, ...properties, loading: 'lazy', decoding: 'async' } };
      if (!image.title && !credit && !prefixPattern.test(caption)) return;
      const title = image.title || caption;
      const prefix = title.match(prefixPattern);
      const explicit = Number(prefix?.[1] || prefix?.[2]);
      number = explicit > 0 ? Math.max(number, explicit) : number + 1;
      const label = prefix && title.startsWith('图') ? `图 ${explicit || number}：` : `Figure ${explicit || number}. `;
      const nodes = captionNodes(label + title.slice(prefix?.[0].length || 0));
      if (credit) nodes.push({ type: 'text', value: ' — Credit: ' }, ...captionNodes(credit));
      captions.set(image, { id: `figure-${++figureId}`, nodes });
      image.title = null;
    });

    const imagesOf = (node) => {
      if (node.type !== 'paragraph' || node.data?.hName) return null;
      const images = node.children.filter((child) => child.type !== 'text' || child.value.trim());
      return images.length >= 1 && images.length <= 3 && images.every((child) => captions.has(child)) ? images : null;
    };
    const figure = (image) => ({
      type: 'paragraph',
      data: { hName: 'figure', hProperties: { className: ['content-figure'], id: captions.get(image).id } },
      children: [image, { type: 'paragraph', data: { hName: 'figcaption' }, children: captions.get(image).nodes }],
    });
    function groupFigures(parent) {
      if (!parent.children) return;
      for (const child of parent.children) groupFigures(child);
      const result = [];
      for (let index = 0; index < parent.children.length; index += 1) {
        const node = parent.children[index];
        const images = imagesOf(node);
        if (!images) { result.push(node); continue; }
        // Old notes use both adjacent paragraphs and whitespace-separated images.
        if (images.length === 1) {
          while (images.length < 3 && index + 1 < parent.children.length) {
            const next = imagesOf(parent.children[index + 1]);
            if (next?.length !== 1) break;
            images.push(next[0]);
            index += 1;
          }
        }
        const figures = images.map(figure);
        result.push(figures.length === 1 ? figures[0] : {
          type: 'blockquote', data: { hName: 'div', hProperties: { className: ['content-figure-group'] } }, children: figures,
        });
      }
      parent.children = result;
    }
    groupFigures(tree);
  };
}
