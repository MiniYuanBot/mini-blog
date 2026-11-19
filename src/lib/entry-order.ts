interface SortableEntry {
  id: string;
  collection: string;
  data: { published?: Date; year?: number };
}

/** A year is only a sort key, never an invented publication date. */
export function entryTimestamp(entry: SortableEntry): number {
  return entry.data.published?.getTime() ?? (entry.collection === 'publications' ? Date.UTC(entry.data.year!, 0, 1) : 0);
}

/** Equal dates keep a course's lectures in natural filename order (2 before 10).
 * Revision dates never move a lecture ahead of earlier chapters. */
export function compareEntries(a: SortableEntry, b: SortableEntry): number {
  return entryTimestamp(b) - entryTimestamp(a)
    || a.id.localeCompare(b.id, 'en', { numeric: true })
    || a.collection.localeCompare(b.collection, 'en');
}
