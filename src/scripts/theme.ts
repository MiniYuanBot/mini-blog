type Theme = 'system' | 'light' | 'dark';
const root = document.documentElement;
const button = document.querySelector<HTMLButtonElement>('#theme-toggle');
const label = document.querySelector('#theme-label');
const media = window.matchMedia('(prefers-color-scheme: dark)');
const choices: Theme[] = ['system', 'light', 'dark'];

function apply(theme: Theme) {
  root.dataset.theme = theme;
  const next = choices[(choices.indexOf(theme) + 1) % choices.length];
  if (button) {
    button.hidden = false;
    button.setAttribute('aria-label', `Theme: ${theme}. Switch to ${next} theme.`);
    button.title = `Theme: ${theme}. Click to use ${next}.`;
  }
  if (label) label.textContent = theme === 'system' ? 'Auto' : theme === 'light' ? 'Light' : 'Dark';
  document.dispatchEvent(new CustomEvent('theme:change'));
}
apply((root.dataset.theme as Theme) || 'system');
button?.addEventListener('click', () => {
  const next = choices[(choices.indexOf(root.dataset.theme as Theme) + 1) % choices.length];
  try { localStorage.setItem('miniyuan-theme', next); } catch { /* Private browsing still supports this page. */ }
  apply(next);
});
media.addEventListener('change', () => { if (root.dataset.theme === 'system') apply('system'); });
window.addEventListener('storage', (event) => {
  if (event.key === 'miniyuan-theme') apply(event.newValue === 'light' || event.newValue === 'dark' ? event.newValue : 'system');
});
