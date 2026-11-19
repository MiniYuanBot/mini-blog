import { createHeaderVisibility } from '../lib/header-visibility';

/** The native disclosure remains usable without JavaScript. These listeners
 * add dismissal behavior; this dropdown is not a modal or a focus trap. */
const menu = document.querySelector<HTMLDetailsElement>('[data-mobile-menu]');
const toggle = document.querySelector<HTMLElement>('[data-menu-toggle]');

const header = document.querySelector<HTMLElement>('.site-header');
if (header) {
  // Clamp elastic overscroll at both ends, especially on touch devices.
  const position = () => Math.max(0, Math.min(window.scrollY, document.documentElement.scrollHeight - window.innerHeight));
  const visibility = createHeaderVisibility(position());
  let frame = 0;
  const render = () => {
    frame = 0;
    const keepVisible = !!menu?.open || header.contains(document.activeElement);
    header.toggleAttribute('data-header-hidden', !visibility(position(), keepVisible));
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(render);
  };
  const reveal = () => {
    visibility(position(), true);
    header.removeAttribute('data-header-hidden');
  };

  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', reveal);
  window.addEventListener('pageshow', reveal);
  header.addEventListener('focusin', reveal);
  header.addEventListener('focusout', schedule);
  menu?.addEventListener('toggle', schedule);
}

if (menu && toggle) {
  const desktop = window.matchMedia('(min-width: 960px)');
  const sync = () => {
    toggle.setAttribute('aria-expanded', String(menu.open));
    toggle.setAttribute('aria-label', menu.open ? 'Close navigation menu' : 'Open navigation menu');
  };
  const close = (returnFocus = false) => {
    menu.open = false;
    sync();
    if (returnFocus) toggle.focus();
  };

  menu.addEventListener('toggle', sync);
  menu.addEventListener('click', (event) => {
    if ((event.target as Element).closest('.mobile-nav a')) close();
  });
  menu.addEventListener('focusout', (event) => {
    if (event.relatedTarget instanceof Node && !menu.contains(event.relatedTarget)) close();
  });
  document.addEventListener('click', (event) => {
    if (menu.open && event.target instanceof Node && !menu.contains(event.target)) {
      close(menu.contains(document.activeElement));
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menu.open) {
      event.preventDefault();
      close(true);
    }
  });
  desktop.addEventListener('change', () => {
    const active = document.activeElement;
    const focusInsideMenu = menu.contains(active);
    close();
    if (desktop.matches && focusInsideMenu) {
      const href = active instanceof HTMLAnchorElement ? active.getAttribute('href') : null;
      const equivalent = [...document.querySelectorAll<HTMLAnchorElement>('.primary-nav a')].find((link) => link.getAttribute('href') === href);
      (equivalent || document.querySelector<HTMLAnchorElement>('.wordmark'))?.focus();
    }
  });
  if (desktop.matches) menu.open = false;
  sync();
}
