import { getCollection, type CollectionEntry } from 'astro:content';
import { collectionNames, type CollectionName } from '../../site.config';
import { compareEntries, entryTimestamp } from './entry-order';

export type Entry = CollectionEntry<CollectionName>;

// Vite reduces Object.keys(glob) to paths without importing article bodies.
// It also refreshes this module on file additions/removals in development.
// Empty collections are intentional; avoid Astro's repeated missing-collection warning.
const files = Object.keys(import.meta.glob('../content/**/*.{md,mdx}'));
const populated = new Set(files.map((path) => path.split('/')[2]));

/** Every public surface uses this filter: pages, home, tags, search, and RSS. */
export async function getEntries(collection?: CollectionName): Promise<Entry[]> {
  const names = collection ? [collection] : collectionNames;
  const entries: Entry[] = (await Promise.all(names.map((name) => populated.has(name) ? getCollection(name) : Promise.resolve([])))).flat();
  const now = Date.now();
  return entries
    .filter((entry) => !entry.data.draft && entryTimestamp(entry) <= now)
    .sort(compareEntries);
}

export function entryDateLabel(entry: Entry): string {
  if (entry.collection === 'publications' && entry.data.period) return entry.data.period;
  if (entry.data.published) return formatDate(entry.data.published);
  return entry.collection === 'publications' ? String(entry.data.year) : '';
}

export function publicationByline(entry: CollectionEntry<'publications'>): string {
  const { authors, venue, status, authorRole } = entry.data;
  const statusLabel = status ? status[0].toUpperCase() + status.slice(1) : undefined;
  return [authors.join(', '), venue, statusLabel, authorRole].filter(Boolean).join(' · ');
}

export const entryUrl = (entry: Entry) => `/${entry.collection}/${entry.id}/`;
export const tagsOf = (entries: Entry[]) => [...new Set(entries.flatMap(({ data }) => data.tags))].sort();
export const formatDate = (date: Date) => new Intl.DateTimeFormat('en', {
  year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC',
}).format(date);
export const readingTime = (body = '') => Math.max(1, Math.ceil(body.trim().split(/\s+/).length / 220));
