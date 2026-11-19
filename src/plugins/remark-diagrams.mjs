import { visit } from 'unist-util-visit';
import { diagramSource, cachedSvg } from './lib/plantuml.mjs';

export default function remarkDiagrams() {
  return (tree, file) => {
    visit(tree, 'code', (node, index, parent) => {
      if (!parent || index === undefined) return;
      if (node.lang === 'mermaid') {
        parent.children[index] = {
          type: 'paragraph', data: { hName: 'pre', hProperties: { className: ['mermaid-source'], 'data-mermaid': true } },
          children: [{ type: 'text', value: node.value }],
        };
      }
      if (node.lang === 'plantuml') {
        const svg = cachedSvg(diagramSource(node.value));
        if (!svg) file.fail('PlantUML diagram is not cached. Run `pnpm diagrams`, then build again. See docs/authoring.md for offline rendering.');
        parent.children[index] = {
          type: 'paragraph', data: { hName: 'figure', hProperties: { className: ['plantuml-diagram'] } },
          children: [{ type: 'image', url: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`, alt: node.meta || 'PlantUML diagram', title: null }],
        };
      }
    });
  };
}
