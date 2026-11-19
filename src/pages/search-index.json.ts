import { getEntries, entryUrl, entryDateLabel } from '../lib/content';
import { plainText } from '../lib/plain-text.mjs';
import type { SearchEntry } from '../lib/search';

export async function GET() {
  const entries: SearchEntry[] = (await getEntries()).map((entry) => ({
    title: entry.data.title,
    description: entry.data.description,
    collection: entry.collection,
    tags: entry.data.tags,
    published: entry.data.published?.toISOString() ?? (entry.collection === 'publications' ? String(entry.data.year) : ''),
    displayDate: entryDateLabel(entry),
    url: entryUrl(entry),
    body: plainText(entry.body || '', entry.filePath?.endsWith('.mdx')),
  }));
  return new Response(JSON.stringify(entries), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
