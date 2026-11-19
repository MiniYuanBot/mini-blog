export { };

// Native anchors retain browser scrolling, focus, and hash history.
const targets = [...document.querySelectorAll<HTMLAnchorElement>('[data-toc-link]')].map((link) => ({
  link,
  heading: document.getElementById(decodeURIComponent(link.hash.slice(1))),
}));
const headings = [...new Set(targets.map(({ heading }) => heading).filter((heading): heading is HTMLElement => !!heading))];

if (headings.length) {
  const offset = () => (parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0)
    + (parseFloat(getComputedStyle(headings[0]).scrollMarginTop) || 0) + 1;
  const markCurrent = () => {
    let current = headings[0];
    const cutoff = offset();
    for (const heading of headings) {
      if (heading.getBoundingClientRect().top <= cutoff) current = heading;
    }
    for (const { link, heading } of targets) {
      if (heading === current) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    }
  };
  let observer: IntersectionObserver | undefined;
  const observe = () => {
    observer?.disconnect();
    if ('IntersectionObserver' in window) {
      observer = new IntersectionObserver(markCurrent, { rootMargin: `-${offset()}px 0px 0px 0px`, threshold: [0, 1] });
      headings.forEach((heading) => observer!.observe(heading));
    }
    markCurrent();
  };
  window.addEventListener('resize', observe);
  window.addEventListener('hashchange', markCurrent);
  window.addEventListener('scrollend', markCurrent);
  observe();
}

const menu = document.querySelector<HTMLDetailsElement>('[data-toc-menu]');
const toggle = document.querySelector<HTMLElement>('[data-toc-toggle]');

if (menu && toggle) {
  const desktop = window.matchMedia('(min-width: 960px)');
  const mobileToc = menu.closest('.toc-mobile');
  const desktopToc = document.querySelector<HTMLElement>('.toc');
  const siteMenu = document.querySelector<HTMLDetailsElement>('[data-mobile-menu]');
  const sync = () => toggle.setAttribute('aria-expanded', String(menu.open));
  const close = (returnFocus = false) => {
    menu.open = false;
    sync();
    if (returnFocus) toggle.focus({ preventScroll: true });
  };

  menu.addEventListener('toggle', () => {
    sync();
    if (menu.open && siteMenu?.open) {
      const focusInSiteMenu = siteMenu.contains(document.activeElement);
      siteMenu.open = false;
      if (focusInSiteMenu) toggle.focus({ preventScroll: true });
    }
  });
  siteMenu?.addEventListener('toggle', () => {
    if (siteMenu.open && menu.open) {
      const focusInToc = menu.contains(document.activeElement);
      close();
      if (focusInToc) siteMenu.querySelector('summary')?.focus({ preventScroll: true });
    }
  });
  menu.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('[data-toc-link]')) close(true);
  });
  menu.addEventListener('focusout', (event) => {
    // Focus is still in transit here; activeElement may temporarily be <body>.
    // Keep internal focus moves from closing the panel before a link's click.
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
    close();
    if (desktop.matches && mobileToc?.contains(active)) {
      const equivalent = active instanceof HTMLAnchorElement
        ? [...desktopToc?.querySelectorAll<HTMLAnchorElement>('a') || []].find((link) => link.hash === active.hash)
        : undefined;
      const disclosure = desktopToc?.querySelector('details');
      if (equivalent && disclosure) disclosure.open = true;
      (equivalent || desktopToc?.querySelector('summary'))?.focus({ preventScroll: true });
    } else if (!desktop.matches && desktopToc?.contains(active)) {
      toggle.focus({ preventScroll: true });
    }
  });
  if (desktop.matches) menu.open = false;
  sync();
}
