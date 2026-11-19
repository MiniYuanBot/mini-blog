# Architecture and reuse decisions

## What was examined

The reference project uses Astro content collections for `blog` and `note`, shared metadata schemas, dynamic entry/list/tag routes, reusable pagination helpers, a lazily fetched JSON search index, and remark/rehype transforms. It also has an Obsidian compatibility layer, custom attachment indexing/copying, encrypted posts, note-import tooling, UnoCSS styling, and an SSH release deployment script.

Its PlantUML implementation records an important operational constraint: asynchronous diagram requests inside Astro's concurrent content loader previously caused unreliable synchronization. It resolves this with a separate cache-generation command and synchronous cache reads during Markdown processing. That separation is preserved here.

## Reused, adapted, or replaced

| Area                              | Decision                                   | Reason                                                                                                            |
| --------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Astro + TypeScript                | Retained                                   | Static content and typed templates fit the task without a client framework                                        |
| Collection/filter helpers         | Adapted                                    | Four sections share one published-entry query, ordering, and URL convention                                       |
| Pagination                        | Reused from `src/utils/pagination.ts`      | Stable root URL for page one and windowed navigation already solve the problem                                    |
| Image metadata parser             | Reused from `src/plugins/lib/image-alt.js` | Width and credit syntax are tested, isolated logic worth retaining                                                |
| Figure rendering                  | Replaced                                   | Semantic Markdown nodes retain Astro's image optimization and work in Markdown and MDX                            |
| Code blocks                       | Extended                                   | A rehype transform wraps Shiki output with language labels; a small article script copies the unchanged code text |
| Local images                      | Astro's native asset pipeline              | Removes the old filesystem attachment index and copy middleware                                                   |
| PlantUML                          | Adapted                                    | Source hashes and a committed SVG cache preserve offline, deterministic builds                                    |
| Mermaid                           | Adapted                                    | Article-only dynamic import, readable source fallback, and theme-aware rendering                                  |
| Search                            | Adapted                                    | Lazy JSON loading and weighted matching are retained; the 1,000-character body cutoff is removed                  |
| TOC and anchors                   | Reimplemented                              | Native links/details plus a small active-section enhancement replace theme-specific UI                            |
| Directional links                 | Adapted                                    | The old Button's SVG shaft/head interaction becomes reusable `ArrowIcon` and plain-text `ActionLink` components   |
| RSS, sitemap, SEO                 | Retained through Astro integrations        | Shared content filtering and one configured origin prevent inconsistent public surfaces                           |
| Deployment                        | Adapted                                    | Release directories, atomic switching, and rollback remain; imports, copied secrets, and remote hooks are removed |
| Visual design                     | Rebuilt                                    | Shared CSS variables, typography, and plain lists replace UnoCSS cards, shadows, and decoration                   |
| Obsidian callouts                 | Adapted                                    | Existing Chinese notes retain semantic callouts, nested content, and native folding                               |
| Obsidian vault imports/encryption | Not carried over                           | Regular Markdown links and local images remain the content contract                                               |

The copied and adapted code is covered by the original project's MIT license, retained in `LICENSE`. The Studies migration copies 96 course notes and their referenced images, with English display metadata and Chinese bodies. No old page layout or visual theme is copied. The migrated project builds independently of the old directory.

## Content boundary

`src/content.config.ts` defines the common metadata and collection-specific fields. The file path becomes the route, and explicit dates replace filesystem/git-derived dates. Publications may instead provide a year for coarse ordering and a period label when no exact date is known; unknown dates and author lists are omitted from metadata. This makes builds independent of clone history and file timestamps.

`src/lib/content.ts` owns the public-entry filter. Article routes, listings, homepage selections, tags, search, and RSS consume the same result. Draft and future-dated entries do not generate public pages. Content schema validation still runs for all collection files.

`site.config.ts` owns personal identity and navigation definitions. The displayed name, university, department, and degree subjects come from the old profile/education configuration. Its `contact` fields supply the footer's GitHub, telephone, and email links, using the author's existing footer values. Publication records use information supplied by the author, including RICA's title, Spring 2026 period, CoNEXT acceptance, and third-author role. No biography claim, research interest, external profile, project, or publication is invented. Empty research interests and collections remain supported.

## Rendering boundary

Astro 7 defaults to a different Markdown processor. This project explicitly selects the unified processor from `@astrojs/markdown-remark` so the established remark/rehype ecosystem remains available to both `.md` and `.mdx`.

The transforms handle math, callouts, semantic figures, code windows, and diagram fences. KaTeX, heading IDs, heading links, and syntax highlighting render at build time. `rehype-code-blocks.mjs` runs after KaTeX and keeps Shiki's `pre/code` contents intact; math and diagram blocks are excluded. `code-blocks.ts` adds Clipboard API support, a selection-based fallback, and accessible success/failure feedback without injecting language labels into copied text. Local images remain image nodes until Astro processes them, including grouped figures and reference-style images. Captions retain Chinese numbering, width metadata, and safely parsed source links. PlantUML reads cached SVG synchronously and embeds it as an image; its shared style matches the old notes so all 146 migrated diagrams reuse their original, source-matched SVG caches. Network rendering happens only through a separate author-invoked command.

`BaseLayout` owns the document, metadata, navigation, theme initialization, and shared page layout. The `head` slot extends document metadata. The `header`, `content`, `sidebar`, and `after` slots share one outer shell, capped at 1080px and aligned with the site header and footer. The reading modifier narrows the article column inside that shell; the sidebar modifier positions the desktop TOC beside it and anchors the mobile article toolbar at the bottom of the screen.

`ListingLayout` fills those slots with the heading, shared entry rows, and pagination. `ArticleLayout` supplies the byline, resources, TOC, body, and article footer. Page components provide content rather than defining independent outer widths or vertical spacing. `ActionLink` combines a text label with `ArrowIcon`; use the icon directly when a link already has its own internal structure. SVG geometry in `src/lib/arrow.mjs` is shared by `ArrowIcon` and generated Markdown/MDX footnote return links, preserving accessible labels and repeated-reference superscripts.

## Browser boundary

The site uses standard page navigation rather than an application router. Native anchor links retain URL fragments and browser history; CSS enables smooth scrolling, clears the sticky header at every width, and switches to immediate scrolling for reduced-motion preferences. The desktop TOC also reserves space below the header so revealing navigation never covers it. Light/dark colors follow CSS system preferences even without JavaScript. The small theme enhancement remembers a reader's manual choice and supports returning to system mode.

The header is sticky at every width: 88px on desktop and 64px below 960px, with an opaque page-colored background and a thin rule. `navigation.ts` batches passive scroll events with animation frames; `header-visibility.ts` hides it after 64px downward travel and reveals it after 40px upward travel. The first 120px of the page, an open menu, and focus inside the header keep it visible. Elastic overscroll is clamped, and distance from the last scroll extreme prevents jitter from toggling it. A 220ms transform transition leaves document layout unchanged and becomes immediate under reduced motion. Without JavaScript the header stays visible. The native mobile disclosure retains Escape, outside-click dismissal, and focus handling when switching back to desktop.

Search code and its full-text JSON payload belong to the search page. The index includes the entire published Markdown/MDX body, including code fences, tables, and image alt text, without a character cutoff. MDX imports and JavaScript expressions, link definitions, and raw HTML nodes are omitted; visible text inside MDX components is retained. Search matches every query term across the title, tags, description, and body, with higher weights for titles and tags.

Articles with headings use a 48px bottom toolbar below 960px, with a native Contents disclosure and Back to top link. The contents panel opens upward, stays within the available viewport, and shares its links with the desktop TOC. Page padding reserves space for the toolbar and device safe-area inset. Native links and disclosures work without JavaScript; `src/scripts/toc.ts` adds active-section tracking, dismissal, and focus handling while preserving normal anchor navigation. Mermaid is dynamically loaded by `src/scripts/article.ts` only when an article contains a Mermaid block.

CSS ownership is explicit: `src/styles/global.css` controls the shared layout and scrolling; `header.css`, `toc.css`, `prose.css`, and `arrow.css` own their respective components. `motion.css` supplies shared 140ms/220ms timings, `cubic-bezier(0.2, 0.7, 0.2, 1)` easing, and a 6px displacement token for color, theme, arrow, and disclosure feedback. `disclosure.css` enhances native opening and closing with fades, small panel movement, and supported intrinsic-height transitions; closing content becomes inert, and unsupported browsers retain instant native disclosure behavior. No animation library or JavaScript animation dependency is needed. Reduced-motion and print settings zero the shared timings and displacement; native smooth scrolling keeps browser-controlled timing and becomes immediate under reduced motion.

## Verification boundary

Unit tests exercise shared logic and transforms. The content integration test creates an isolated project with synthetic testing fixtures and verifies real Markdown/MDX rendering and publishing behavior. It retains the project and generated output under the ignored `.cache/content-test-*` directories for browser inspection and debugging. These generated directories can be removed after inspection. The fixtures are test data and never enter the real content collections or production output.

`pnpm verify` checks types, unit tests, the site's production build, generated internal links, and the isolated integration build. Empty-state helpers remain covered without adding test content to the real collections. The optional CI workflow performs the same work and stores a static artifact; it does not publish it.
