import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { glob } from 'astro/loaders';
import type { CollectionName } from '../site.config';

const httpUrl = z.url().refine((value) => /^https?:\/\//.test(value), 'Use an HTTP or HTTPS URL');
const common = z.object({
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  published: z.coerce.date(),
  updated: z.coerce.date().optional(),
  tags: z.array(z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Tags use lowercase words separated by hyphens')).default([]).transform((tags) => [...new Set(tags)]),
  draft: z.boolean().default(false),
  featured: z.boolean().default(false),
  lang: z.enum(['en', 'zh-CN']).default('en'),
});

function loader(name: CollectionName) {
  return glob({
    base: `./src/content/${name}`,
    pattern: '**/*.{md,mdx}',
    generateId: ({ entry }) => {
      const id = entry.replace(/\.mdx?$/, '').replace(/\/index$/, '');
      if (!/^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/.test(id) || /^(index|page)(\/|$)/.test(id)) {
        throw new Error(`Invalid content path: ${entry}. Use lowercase kebab-case; index and page are reserved at the root.`);
      }
      return id;
    },
  });
}

const publications = defineCollection({
  loader: loader('publications'),
  schema: common.extend({
    published: z.coerce.date().optional(),
    authors: z.array(z.string().min(1)).default([]),
    year: z.number().int().min(1000).max(9999).optional(),
    period: z.string().trim().min(1).optional(),
    status: z.enum(['accepted', 'published']).optional(),
    authorRole: z.string().trim().min(1).optional(),
    venue: z.string().optional(),
    paper: httpUrl.optional(),
    code: httpUrl.optional(),
    doi: z.string().regex(/^10\.\d{4,9}\/.+$/, 'Use a DOI identifier, without the https://doi.org/ prefix').optional(),
  }).refine((data) => data.published !== undefined || data.year !== undefined, {
    message: 'Publications require an exact published date or a year.',
    path: ['published'],
  }),
});
const projects = defineCollection({
  loader: loader('projects'),
  schema: common.extend({
    repository: httpUrl.optional(),
    website: httpUrl.optional(),
    status: z.enum(['active', 'completed', 'archived']).optional(),
  }),
});
const explorations = defineCollection({ loader: loader('explorations'), schema: common });
const studies = defineCollection({ loader: loader('studies'), schema: common.extend({ course: z.string().optional() }) });

export const collections = { publications, projects, explorations, studies };
