import { defineConfig } from 'astro/config';
import { unified, rehypeHeadingIds } from '@astrojs/markdown-remark';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import remarkFigures from './src/plugins/remark-figures.mjs';
import remarkDiagrams from './src/plugins/remark-diagrams.mjs';
import remarkCallouts from './src/plugins/remark-callouts.mjs';
import rehypeCodeBlocks from './src/plugins/rehype-code-blocks.mjs';
import { footnoteBackContent } from './src/lib/arrow.mjs';
import { site } from './site.config';

export default defineConfig({
  site: site.url,
  output: 'static',
  trailingSlash: 'always',
  compressHTML: true,
  integrations: [mdx(), sitemap({ filter: (url) => !/\/(search|404)\/?$/.test(new URL(url).pathname) })],
  markdown: {
    processor: unified({
      remarkRehype: { footnoteBackContent },
      remarkPlugins: [remarkMath, remarkCallouts, remarkFigures, remarkDiagrams],
      rehypePlugins: [
        [rehypeKatex, { strict: 'error', throwOnError: true }],
        rehypeCodeBlocks,
        rehypeHeadingIds,
        [rehypeAutolinkHeadings, {
          behavior: 'append',
          properties: { className: ['heading-anchor'], ariaLabel: 'Link to this section' },
          content: { type: 'text', value: '#' },
        }],
      ],
    }),
    shikiConfig: { themes: { light: 'github-light', dark: 'github-dark' } },
  },
  image: { responsiveStyles: true },
});
