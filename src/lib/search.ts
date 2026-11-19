/** Full-text search, adapted from the old site's lazy JSON index. No body limit. */
export interface SearchEntry {
  title: string;
  description: string;
  collection: string;
  tags: string[];
  published: string;
  displayDate?: string;
  url: string;
  body: string;
}

export const queryTerms = (query: string) => [...new Set(query.toLowerCase().trim().split(/\s+/).filter(Boolean))];

export function scoreEntry(entry: SearchEntry, terms: string[]): number {
  if (!terms.length) return 0;
  const fields = [entry.title, entry.tags.join(' '), entry.description, entry.body].map((field) => field.toLowerCase());
  const weights = [12, 6, 4, 1];
  let total = 0;
  for (const term of terms) {
    const score = fields.reduce((sum, field, i) => sum + (field.includes(term) ? weights[i] : 0), 0);
    if (!score) return 0;
    total += score;
  }
  return total + (fields[0].startsWith(terms.join(' ')) ? 8 : 0);
}

export function searchEntries(entries: SearchEntry[], query: string, collection = '') {
  const terms = queryTerms(query);
  return entries
    .filter((entry) => !collection || entry.collection === collection)
    .map((entry) => ({ entry, score: scoreEntry(entry, terms) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || b.entry.published.localeCompare(a.entry.published));
}

export function snippetFor(entry: SearchEntry, terms: string[]): string {
  const text = entry.body || entry.description;
  const positions = terms.map((term) => text.toLowerCase().indexOf(term)).filter((at) => at >= 0);
  const start = Math.max(0, (positions.length ? Math.min(...positions) : 0) - 60);
  const end = Math.min(text.length, start + 220);
  return `${start ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}
