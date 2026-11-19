import { copyText } from './clipboard';

export function initCodeBlocks(root: ParentNode = document): void {
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-code-copy]')) {
    const block = button.closest<HTMLElement>('[data-code-block]');
    const code = block?.querySelector<HTMLElement>('pre > code');
    const status = block?.querySelector<HTMLElement>('.code-copy-status');
    if (!code || !status || button.dataset.ready) continue;
    button.dataset.ready = 'true';
    button.hidden = false;
    const label = button.getAttribute('aria-label') || 'Copy code';
    let timer = 0;
    let copying = false;
    button.addEventListener('click', async () => {
      if (copying) return;
      copying = true;
      window.clearTimeout(timer);
      button.setAttribute('aria-busy', 'true');
      try {
        // textContent reads the code alone, including tabs, blank lines and HTML
        // characters; no toolbar labels, token markup or trim() enter the clipboard.
        await copyText(code.textContent || '');
        button.dataset.state = 'copied';
        button.setAttribute('aria-label', 'Code copied');
        button.title = 'Copied';
        status.textContent = 'Copied';
      } catch {
        button.dataset.state = 'error';
        button.setAttribute('aria-label', 'Copy failed; select the code to copy manually');
        button.title = 'Select the code to copy manually';
        status.textContent = 'Copy failed';
      } finally {
        copying = false;
        button.removeAttribute('aria-busy');
        timer = window.setTimeout(() => {
          delete button.dataset.state;
          button.setAttribute('aria-label', label);
          button.title = 'Copy code';
          status.textContent = '';
        }, 2500);
      }
    });
  }
}
