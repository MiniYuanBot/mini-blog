import { visit, SKIP } from 'unist-util-visit';

const languageLabels = {
  plaintext: 'Text', plain: 'Text', text: 'Text', txt: 'Text',
  js: 'JavaScript', javascript: 'JavaScript', jsx: 'JSX',
  ts: 'TypeScript', typescript: 'TypeScript', tsx: 'TSX',
  py: 'Python', python: 'Python', python3: 'Python',
  c: 'C', cpp: 'C++', 'c++': 'C++', csharp: 'C#', cs: 'C#',
  bash: 'Bash', sh: 'Shell', shell: 'Shell', shellscript: 'Shell', zsh: 'Zsh',
  asm: 'Assembly', java: 'Java', vue: 'Vue', ini: 'INI',
  f90: 'Fortran 90', fortran: 'Fortran', 'fortran-free-form': 'Fortran',
  'fortran-fixed-form': 'Fortran', make: 'Makefile', makefile: 'Makefile', cmake: 'CMake',
  html: 'HTML', css: 'CSS', json: 'JSON', yaml: 'YAML', yml: 'YAML',
  md: 'Markdown', markdown: 'Markdown', mdx: 'MDX', sql: 'SQL',
  rust: 'Rust', rs: 'Rust', go: 'Go', powershell: 'PowerShell', ps1: 'PowerShell',
};
const element = (tagName, properties = {}, children = []) => ({ type: 'element', tagName, properties, children });
const text = (value) => ({ type: 'text', value });

function icon(kind) {
  const children = kind === 'copy' ? [
    element('rect', { x: 8, y: 8, width: 12, height: 12, rx: 2 }),
    element('path', { d: 'M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3' }),
  ] : [element('path', { d: 'm5 12 4 4L19 6' })];
  return element('svg', {
    className: [`code-icon-${kind}`], xmlns: 'http://www.w3.org/2000/svg',
    viewBox: '0 0 24 24', width: 18, height: 18, fill: 'none', stroke: 'currentColor',
    strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', ariaHidden: 'true', focusable: 'false',
  }, children);
}

/** Runs after Shiki. Keep its pre/code tree intact so highlighting, whitespace,
 * keyboard scrolling and copied text are identical in Markdown and MDX. */
export default function rehypeCodeBlocks() {
  return (tree) => {
    visit(tree, 'element', (node, index, parent) => {
      if (node.tagName !== 'pre' || !parent || index === undefined) return;
      if (parent.properties?.className?.includes('code-block')) return SKIP;
      const code = node.children.find((child) => child.type === 'element' && child.tagName === 'code');
      if (!code) return; // Mermaid and math are rendered by their own plugins.
      const classes = Array.isArray(code.properties.className) ? code.properties.className : String(code.properties.className || '').split(/\s+/);
      if (classes.some((name) => ['language-math', 'math-display', 'math-inline'].includes(name))) return;
      const languageClass = classes.find((name) => String(name).startsWith('language-'));
      const language = String(node.properties.dataLanguage || node.properties['data-language'] || languageClass?.slice(9) || 'text');
      const label = languageLabels[language.toLowerCase()] || language;
      node.properties.tabIndex ??= 0;
      node.properties.ariaLabel = `${label} code`;
      const toolbar = element('div', { className: ['code-header'], lang: 'en' }, [
        element('span', { className: ['code-window-dots'], ariaHidden: 'true' }, [element('span'), element('span'), element('span')]),
        element('span', { className: ['code-language'] }, [text(label)]),
        element('span', { className: ['code-copy-status'], role: 'status', ariaLive: 'polite', ariaAtomic: 'true' }),
        // JS reveals the functional button; the language header also works without JS.
        element('button', { type: 'button', className: ['code-copy'], dataCodeCopy: '', ariaLabel: `Copy ${label} code`, title: 'Copy code', hidden: true }, [icon('copy'), icon('check')]),
      ]);
      parent.children[index] = element('div', { className: ['code-block'], dataCodeBlock: '' }, [toolbar, node]);
      return SKIP;
    });
  };
}
