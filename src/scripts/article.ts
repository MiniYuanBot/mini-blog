import { initCodeBlocks } from './code-blocks';

initCodeBlocks();

const blocks = [...document.querySelectorAll<HTMLElement>('[data-mermaid]')];
if (blocks.length) {
  const sources = blocks.map((node) => node.textContent || '');
  let rendering = false;
  let rerender = false;
  let serial = 0;
  const draw = async () => {
    if (rendering) { rerender = true; return; }
    rendering = true;
    try {
      const { default: mermaid } = await import('mermaid');
      do {
        rerender = false;
        const theme = document.documentElement.dataset.theme;
        const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'neutral', suppressErrorRendering: true });
        for (const [index, block] of blocks.entries()) {
          try {
            const { svg } = await mermaid.render(`diagram-${index}-${serial++}`, sources[index]);
            block.innerHTML = svg;
            block.classList.add('mermaid-rendered');
            block.setAttribute('role', 'img');
            block.setAttribute('aria-label', 'Mermaid diagram');
          } catch {
            block.textContent = sources[index];
            block.classList.remove('mermaid-rendered');
            block.removeAttribute('role');
            block.setAttribute('aria-label', 'Diagram source; rendering unavailable');
          }
        }
      } while (rerender);
    } catch {
      // Preserve readable source when the optional diagram bundle cannot load.
    } finally { rendering = false; }
  };
  document.addEventListener('theme:change', () => void draw());
  void draw();
}
