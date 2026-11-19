import rss from '@astrojs/rss';
import { getEntries, entryUrl } from '../lib/content';
import { site } from '../../site.config';

export async function GET() {
  return rss({
    title: site.title, description: site.description, site: site.url,
    items: (await getEntries()).map((entry) => ({
      title: entry.data.title, description: entry.data.description,
      pubDate: entry.data.published, link: entryUrl(entry), categories: entry.data.tags,
    })),
    customData: '<language>en</language>',
  });
}
