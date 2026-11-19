import { queryTerms, searchEntries, snippetFor, type SearchEntry } from '../lib/search';

const form = document.querySelector<HTMLFormElement>('#search-form')!;
const input = document.querySelector<HTMLInputElement>('#search-input')!;
const select = document.querySelector<HTMLSelectElement>('#search-collection')!;
const status = document.querySelector<HTMLElement>('#search-status')!;
const results = document.querySelector<HTMLOListElement>('#search-results')!;
const more = document.querySelector<HTMLButtonElement>('#search-more')!;
const empty = document.querySelector<HTMLElement>('#search-empty')!;
const batchSize = 20;
let indexPromise: Promise<SearchEntry[]> | undefined;
let revision = 0;
let timer: number | undefined;
let matches: ReturnType<typeof searchEntries> = [];
let terms: string[] = [];
let shown = 0;

function loadIndex(): Promise<SearchEntry[]> {
  indexPromise ??= fetch('/search-index.json').then((response) => {
    if (!response.ok) throw new Error('Search index unavailable');
    return response.json() as Promise<SearchEntry[]>;
  }).catch((error) => { indexPromise = undefined; throw error; });
  return indexPromise;
}

/** Build highlights with text nodes; a query is never interpreted as markup. */
function highlight(target: HTMLElement, text: string) {
  const escaped = terms.slice().sort((a, b) => b.length - a.length).map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!escaped.length) { target.textContent = text; return; }
  const pattern = new RegExp(escaped.join('|'), 'gi');
  let end = 0;
  for (const match of text.matchAll(pattern)) {
    target.append(document.createTextNode(text.slice(end, match.index)));
    const mark = document.createElement('mark');
    mark.textContent = match[0];
    target.append(mark);
    end = match.index + match[0].length;
  }
  target.append(document.createTextNode(text.slice(end)));
}

function renderBatch() {
  const batch = matches.slice(shown, shown + batchSize);
  for (const { entry } of batch) {
    const item = document.createElement('li');
    item.className = 'search-result';
    const article = document.createElement('article');
    const meta = document.createElement('p');
    meta.className = 'search-result-meta';
    const date = entry.displayDate ?? new Date(entry.published).toLocaleDateString('en', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
    meta.textContent = `${entry.collection} · ${date}`;
    const heading = document.createElement('h2');
    const link = document.createElement('a');
    link.href = entry.url;
    highlight(link, entry.title);
    heading.append(link);
    const snippet = document.createElement('p');
    highlight(snippet, snippetFor(entry, terms));
    article.append(meta, heading, snippet);
    item.append(article);
    results.append(item);
  }
  shown += batch.length;
  more.hidden = shown >= matches.length;
  if (matches.length) status.textContent = `${matches.length} ${matches.length === 1 ? 'result' : 'results'}${shown < matches.length ? ` · Showing ${shown}` : ''}`;
}

async function run(updateUrl = true) {
  const request = ++revision;
  const query = input.value.trim();
  const collection = select.value;
  terms = queryTerms(query);
  results.replaceChildren();
  matches = [];
  shown = 0;
  more.hidden = true;
  empty.hidden = false;
  if (updateUrl) {
    const url = new URL(location.href);
    query ? url.searchParams.set('q', query) : url.searchParams.delete('q');
    collection ? url.searchParams.set('section', collection) : url.searchParams.delete('section');
    history.replaceState(null, '', url);
  }
  if (!terms.length) {
    status.textContent = form.dataset.total === '0' ? 'There is nothing to search yet. Published entries will appear here.' : 'Enter a word or phrase to begin.';
    return;
  }
  status.textContent = 'Searching…';
  try {
    const entries = await loadIndex();
    if (request !== revision) return;
    matches = searchEntries(entries, query, collection);
    if (!entries.length) { status.textContent = 'There is nothing to search yet. Published entries will appear here.'; return; }
    if (!matches.length) { status.textContent = `No results for “${query}”. Try fewer words or another section.`; return; }
    empty.hidden = true;
    renderBatch();
  } catch {
    if (request === revision) status.textContent = 'Search could not be loaded. Check your connection and try again.';
  }
}

form.addEventListener('submit', (event) => { event.preventDefault(); clearTimeout(timer); void run(); });
input.addEventListener('input', () => {
  revision += 1;
  clearTimeout(timer);
  timer = window.setTimeout(() => void run(), 120);
});
select.addEventListener('change', () => { clearTimeout(timer); void run(); });
more.addEventListener('click', () => {
  const previous = shown;
  renderBatch();
  results.querySelectorAll<HTMLAnchorElement>('h2 a')[previous]?.focus();
});
document.addEventListener('keydown', (event) => {
  const target = event.target;
  const typing = target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
  if (event.key === '/' && !typing && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); input.focus(); }
  if (event.key === 'Escape' && document.activeElement === input) {
    input.value = '';
    clearTimeout(timer);
    void run();
  }
});
function restoreQuery() {
  const url = new URL(location.href);
  input.value = url.searchParams.get('q') || '';
  select.value = url.searchParams.get('section') || '';
  if (!select.value) select.value = '';
  void run(false);
}
window.addEventListener('popstate', restoreQuery);
restoreQuery();
