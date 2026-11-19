import { visit } from 'unist-util-visit';

/** Render the Obsidian callouts used by the course notes as semantic HTML.
 * Leave code, ordinary blockquotes, math and the original Markdown untouched. */
export default function remarkCallouts() {
  return (tree) => {
    visit(tree, 'blockquote', (node) => {
      if (node.data?.hName) return;
      const first = node.children[0];
      const lead = first?.type === 'paragraph' ? first.children[0] : null;
      const marker = lead?.type === 'text' && lead.value.match(/^\[!([\w-]+)\]([+-]?)[ \t]*/);
      if (!marker) return;
      const type = marker[1].toLowerCase();
      const fold = marker[2];
      lead.value = lead.value.slice(marker[0].length);
      const title = [];
      const children = first.children;
      while (children.length) {
        const child = children[0];
        if (child.type === 'break') { children.shift(); break; }
        if (child.type === 'text' && child.value.includes('\n')) {
          const at = child.value.indexOf('\n');
          if (at > 0) title.push({ type: 'text', value: child.value.slice(0, at) });
          child.value = child.value.slice(at + 1);
          if (!child.value) children.shift();
          break;
        }
        title.push(children.shift());
      }
      if (!children.length) node.children.shift();
      if (title[0]?.type === 'text') title[0].value = title[0].value.trimStart();
      if (title.length === 1 && title[0].type === 'text' && !title[0].value) title.length = 0;
      if (!title.length) title.push({ type: 'text', value: type.charAt(0).toUpperCase() + type.slice(1) });
      const body = node.children;
      node.data = {
        hName: fold ? 'details' : 'aside',
        hProperties: { className: ['callout'], dataCallout: type, ...(fold === '+' ? { open: true } : {}) },
      };
      node.children = [
        { type: 'paragraph', data: { hName: fold ? 'summary' : 'div', hProperties: { className: ['callout-title'] } }, children: title },
        { type: 'blockquote', data: { hName: 'div', hProperties: { className: ['callout-content'] } }, children: body },
      ];
    });
  };
}
