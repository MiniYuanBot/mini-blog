/** Import flat notes or note-buddy lectures into Studies.
 * Markdown rewriting is adapted from the old blog's importer. Dates are explicit,
 * changed files are backed up, and imports never delete existing content. */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMarkdownProcessor, parseFrontmatter, rehypeHeadingIds } from '@astrojs/markdown-remark';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { visit } from 'unist-util-visit';
import { parseAlt } from '../src/plugins/lib/image-alt.mjs';

// Reuse Astro's GFM parser and heading pipeline through the unified plugin API.
let parser;
const renderer = await createMarkdownProcessor({
  syntaxHighlight: false,
  remarkPlugins: [remarkMath, function captureParser() { parser = this; }],
  rehypePlugins: [[rehypeKatex, { strict: 'error', throwOnError: true }]],
});
await renderer.render('');
const headingRenderer = parser;
const IMAGE_EXT = /\.(?:png|jpe?g|gif|webp|avif|svg)$/i;
const ATTACHMENT_EXT = /\.(?:png|jpe?g|gif|webp|avif|svg|pdf|mp4|webm|mp3|wav|ogg|html)$/i;
const hash = (data) => createHash('sha256').update(data).digest('hex');
const slash = (path) => path.split(sep).join('/');
const key = (path) => path.toLowerCase();
const inside = (parent, child) => { const rel = relative(parent, child); return rel !== '' && !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel); };
const textOf = (node) => node.children ? node.children.map(textOf).join('') : node.value ?? node.alt ?? '';
const kebab = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `asset-${hash(text).slice(0, 8)}`;
const decode = (text) => { try { return decodeURIComponent(text); } catch { return text; } };
const stripChapterNumber = (text) => text.replace(/^\d+[ \t]+/, '');
const SOURCE_FOOTNOTE_ID = /^s\d+[pb]\d+(?:[-_]\d+)?$/i;

function headingSlugs(nodes) {
  const file = { history: [], data: { astro: {} } };
  rehypeHeadingIds()({ type: 'root', children: nodes.map((node) => ({
    type: 'element', tagName: 'h2', properties: {}, children: [{ type: 'text', value: textOf(node) }],
  })) }, file);
  return file.data.astro.headings.map((heading) => heading.slug);
}
const slug = (text) => headingSlugs([{ type: 'text', value: text }])[0];

/** The old notes displayed captions from plain alt text. Make those captions
 * explicit so the current figure plugin keeps numbering, credits and grouping. */
function addFigureTitles(body, lang) {
  const tree = parser.parse(body);
  const definitions = new Map();
  visit(tree, 'definition', (node) => { definitions.set(node.identifier, node); });
  const patched = new Set();
  const patches = [];
  let number = 0;
  visit(tree, (node) => {
    if (!['image', 'imageReference'].includes(node.type)) return;
    const target = node.type === 'image' ? node : definitions.get(node.identifier);
    if (!target) return;
    const { caption } = parseAlt(node.alt);
    if (!caption && !target.title) return;
    const title = target.title || caption;
    const explicit = title.match(/^(?:图\s*(\d*)\s*[：:]|Figure\s*(\d*)\s*[:.])/i);
    number = Number(explicit?.[1] || explicit?.[2]) || number + 1;
    if (target.title || explicit || patched.has(target)) return;
    patched.add(target);
    const label = lang === 'zh-CN' ? `图 ${number}：${caption}` : `Figure ${number}. ${caption}`;
    const at = target.position.end.offset - (node.type === 'image' ? 1 : 0);
    patches.push({ at, text: ` ${JSON.stringify(label)}` });
  });
  for (const { at, text } of patches.sort((a, b) => b.at - a.at)) body = body.slice(0, at) + text + body.slice(at);
  return body;
}

/** Strip note-buddy's editorial metadata before resolving headings and links. */
function stripImportMetadata(content) {
  const tree = parser.parse(content);
  const sourceFootnotes = new Set();
  const ranges = [];
  const remove = (node, block = false) => {
    let end = node.position.end.offset;
    if (block) while (content[end] === '\n') end += 1;
    ranges.push([node.position.start.offset, end]);
  };
  const isSourceFootnote = (id) => SOURCE_FOOTNOTE_ID.test(id) || sourceFootnotes.has(id.toLowerCase());
  const removeReference = (start, end) => {
    const newline = content.indexOf('\n', end);
    const tail = content.slice(end, newline === -1 ? content.length : newline).replace(/(?<!\\)\[\^([^\]\n]+)\]/g, (raw, id) => isSourceFootnote(id) ? '' : raw);
    // Spaces before a citation must not turn into a trailing Markdown break.
    // Preserve deliberate hard breaks written after the citation itself.
    if (/^[ \t]*$/.test(tail)) while (start > 0 && /[ \t]/.test(content[start - 1])) start -= 1;
    ranges.push([start, end]);
  };
  for (const [index, node] of tree.children.entries()) {
    if (node.type !== 'heading' || !/^不确定事项\s*[:：]?$/.test(textOf(node).trim())) continue;
    const next = tree.children.slice(index + 1).find((child) => child.type === 'heading' && child.depth <= node.depth);
    ranges.push([node.position.start.offset, next?.position.start.offset ?? content.length]);
  }
  visit(tree, (node) => {
    if (node.type === 'blockquote' && node.children[0]?.type === 'paragraph') {
      const title = textOf(node.children[0]).split('\n')[0].trim();
      if (/^\[![\w-]+\][+-]?\s*(?:(?:资料|引用|文献)?来源|出处|sources?)\s*[:：]?$/i.test(title)) remove(node, true);
    }
    if (node.type === 'footnoteDefinition') {
      const raw = content.slice(node.position.start.offset, node.position.end.offset);
      if (SOURCE_FOOTNOTE_ID.test(node.identifier) || /\.(?:pdf|docx|pptx?)\b/i.test(raw)) {
        sourceFootnotes.add(node.identifier.toLowerCase());
        remove(node, true);
      }
    }
  });
  visit(tree, (node) => {
    if (node.type === 'footnoteReference' && sourceFootnotes.has(node.identifier.toLowerCase())) removeReference(node.position.start.offset, node.position.end.offset);
    // Missing definitions parse as text. Strip generated source markers too,
    // while leaving fenced code, inline code and escaped examples untouched.
    if (node.type === 'text') {
      const start = node.position.start.offset;
      const raw = content.slice(start, node.position.end.offset);
      for (const match of raw.matchAll(/(?<!\\)\[\^([^\]\n]+)\]/g)) {
        if (isSourceFootnote(match[1])) removeReference(start + match.index, start + match.index + match[0].length);
      }
    }
  });
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [start, end] of ranges) {
    const last = merged.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  let result = content;
  for (const [start, end] of merged.reverse()) result = result.slice(0, start) + result.slice(end);
  return result;
}

function chapterNumber(node) {
  let first;
  visit(node, 'text', (child) => { first ??= child; });
  const prefix = first?.value.match(/^\d+[ \t]+/);
  return prefix ? { node: first, length: prefix[0].length } : null;
}

function navigationRange(doc) {
  const at = doc.tree.children.findIndex((node) => node.type === 'heading' && /^(?:章节导航|章节目录|本讲目录|目录)$/.test(textOf(node)));
  const nav = doc.tree.children[at];
  if (!nav) return null;
  const next = doc.tree.children.slice(at + 1).find((node) => node.type === 'heading' && node.depth <= nav.depth);
  return [nav.position.start.offset, next?.position.start.offset ?? doc.body.length];
}

function walk(dir, prefix = '') {
  return readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true })).flatMap((entry) => {
    if (entry.name.startsWith('.')) return [];
    const rel = posix.join(prefix, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Refusing symbolic link: ${join(dir, entry.name)}`);
    return entry.isDirectory() ? walk(join(dir, entry.name), rel) : [rel];
  });
}

function readDocument(root, rel) {
  const { frontmatter, content } = parseFrontmatter(readFileSync(join(root, rel), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n'));
  const body = stripImportMetadata(content);
  const tree = parser.parse(body);
  const h1 = tree.children.find((node) => node.type === 'heading' && node.depth === 1);
  return { rel, data: frontmatter, body, tree, h1, title: String(frontmatter.title ?? (h1 && textOf(h1)) ?? basename(rel, '.md')) };
}

function assertSafePath(root, target) {
  if (!inside(root, target)) throw new Error(`Import path must stay inside the project: ${target}`);
  for (let path = target; inside(root, path); path = dirname(path)) {
    if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error(`Refusing symbolic-link destination: ${path}`);
  }
}

function assertSafeDestination(root, dest) {
  const base = resolve(root, 'src/content/studies');
  const coursePath = slash(relative(base, dest));
  if (!inside(base, dest) || !/^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(coursePath)) {
    throw new Error(`Import destination must be src/content/studies/<semester>/<course> in lowercase kebab-case: ${dest}`);
  }
  assertSafePath(root, dest);
}

function dateValue(value, label, dayOnly = false) {
  const raw = value instanceof Date ? value.toISOString() : String(value ?? '');
  const date = new Date(raw);
  if (!/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(raw) || Number.isNaN(date.valueOf())
    || (raw.length === 10 && date.toISOString().slice(0, 10) !== raw)
    || (dayOnly && !/^\d{4}-\d{2}-\d{2}$/.test(raw))) {
    throw new Error(`${label} must be a valid ${dayOnly ? 'YYYY-MM-DD date' : 'ISO date or timestamp'}: ${raw}`);
  }
  return raw.length === 10 ? raw : date.toISOString();
}

function metadata(doc, defaults, overrides, courseTitle, lecture, date) {
  const data = { ...doc?.data, ...defaults, ...overrides };
  const title = String(data.title ?? doc?.title ?? lecture ?? courseTitle).replace(/^L\d+\s+/i, '').trim();
  const label = lecture ? `Lecture${lecture.slice(1).padStart(2, '0')}` : /questions/i.test(doc?.rel) ? 'Questions' : 'Review';
  const description = String(overrides.description ?? defaults.description ?? `${courseTitle}, ${label}.`).trim();
  const tags = data.tags ?? [];
  if (!title || !description) throw new Error(`Empty title or description for ${doc?.rel ?? lecture}`);
  if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tag))) {
    throw new Error(`tags must be lowercase kebab-case strings for ${doc?.rel ?? lecture}`);
  }
  const out = { title, description, published: date, tags: [...new Set(tags)], course: courseTitle, lang: data.lang ?? 'zh-CN' };
  if (!['en', 'zh-CN'].includes(out.lang)) throw new Error(`Invalid lang for ${doc?.rel ?? lecture}`);
  if (data.updated !== undefined) out.updated = dateValue(data.updated, 'updated');
  for (const field of ['draft', 'featured']) {
    if (data[field] !== undefined) {
      if (typeof data[field] !== 'boolean') throw new Error(`${field} must be a boolean`);
      out[field] = data[field];
    }
  }
  return `---\n${Object.entries(out).map(([name, value]) => `${name}: ${JSON.stringify(value)}`).join('\n')}\n---\n\n`;
}

/** Plan and validate every read/write before changing the destination. */
export function planNotesImport(config, { root = process.cwd() } = {}) {
  root = resolve(root);
  if (!config.from || !config.to) throw new Error('Each import needs both "from" and "to".');
  const from = config.from.startsWith('~') ? join(process.env.USERPROFILE ?? process.env.HOME ?? '', config.from.slice(1)) : config.from;
  const src = realpathSync(resolve(root, from));
  const dest = resolve(root, config.to);
  assertSafeDestination(root, dest);
  if (src === dest || inside(src, dest) || inside(dest, src)) throw new Error('Import source and destination must not overlap.');
  const sourceFiles = walk(src);
  const docs = new Map(sourceFiles.filter((rel) => /\.md$/i.test(rel)).map((rel) => [key(rel), readDocument(src, rel)]));
  const courseIndex = docs.get('index.md');
  const defaults = config.frontmatter ?? {};
  const courseTitle = defaults.course ?? config.courseTitle;
  if (typeof courseTitle !== 'string' || !courseTitle.trim()) throw new Error('Set frontmatter.course to the course display name.');
  const published = dateValue(defaults.published, 'frontmatter.published', true);
  const coursePath = slash(relative(resolve(root, 'src/content/studies'), dest));
  const routeFor = (output) => `/studies/${coursePath}/${output.replace(/\.md$/, '')}/`;
  const outputs = new Map();
  const publicOutputs = new Map();
  const targets = new Map();
  const lectures = [];
  const errors = [];
  const addOutput = (rel, data) => {
    if (outputs.has(rel)) throw new Error(`Import filename collision: ${rel}`);
    outputs.set(rel, Buffer.isBuffer(data) ? data : Buffer.from(data));
  };

  for (const entry of readdirSync(src, { withFileTypes: true }).filter((entry) => entry.isDirectory() && /^L\d+$/i.test(entry.name)).sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }))) {
    const lecture = entry.name;
    const number = lecture.slice(1).padStart(2, '0');
    const overrides = config.lectures?.[lecture] ?? config.lectures?.[lecture.toUpperCase()] ?? {};
    const stem = overrides.slug ?? 'lecture';
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(stem)) throw new Error(`Invalid English kebab-case slug for ${lecture}: ${stem}`);
    const output = `${number}-${stem}.md`;
    if (lectures.some((item) => item.output === output)) throw new Error(`Duplicate lecture number: ${lecture}`);
    const chapters = [...docs.values()].filter((doc) => key(posix.dirname(doc.rel)) === `${key(lecture)}/chapters`).sort((a, b) => a.rel.localeCompare(b.rel, 'en', { numeric: true }));
    if (!chapters.length) throw new Error(`No chapters found in ${lecture}/chapters`);
    const index = docs.get(`${key(lecture)}/index.md`);
    const item = { lecture, output, chapters, index, overrides };
    lectures.push(item);
    if (index) targets.set(key(index.rel), { output, anchor: '', doc: index, prefix: `${key(lecture)}-overview` });
    for (const [i, doc] of chapters.entries()) {
      const section = kebab(String(doc.data.section ?? `section-${i + 1}`));
      const anchor = `${key(lecture)}-${section}`;
      targets.set(key(doc.rel), { output, anchor, doc, prefix: anchor, shift: 1, chapter: true });
    }
  }
  for (const doc of docs.values()) {
    if (basename(doc.rel).toLowerCase() === 'index.md' || targets.has(key(doc.rel))) continue;
    if (/^L\d+\//i.test(doc.rel) || /(?:^|\/)assets\//i.test(doc.rel)) throw new Error(`Unexpected Markdown outside chapters: ${doc.rel}`);
    const overrides = config.notes?.[doc.rel] ?? {};
    const stem = basename(doc.rel, '.md');
    const number = stem.match(/^(?:L)?(\d+)(?:[-_ ]|$)/i)?.[1];
    const filename = overrides.slug ? `${number ? `${number.padStart(2, '0')}-` : ''}${overrides.slug}` : stem.toLowerCase().replace(/^(?:l)?(\d+)[-_ ]?/, (_, n) => `${n.padStart(2, '0')}-`).replace(/-$/, '');
    const output = posix.join(posix.dirname(doc.rel).toLowerCase(), `${filename}.md`);
    if (!/^[a-z0-9-]+(?:\/[a-z0-9-]+)*\.md$/.test(output)) throw new Error(`Set notes[${JSON.stringify(doc.rel)}].slug to an English kebab-case filename.`);
    targets.set(key(doc.rel), { output, anchor: '', doc, overrides, lecture: number ? `L${number}` : null, prefix: kebab(output.replace(/\.md$/, '')) });
  }
  if (!targets.size) throw new Error(`No importable Markdown notes found in ${src}`);
  // The course overview is replaced by the site's Studies listing.
  if (courseIndex) targets.set('index.md', { output: '/studies/', anchor: '', doc: courseIndex, prefix: 'course' });

  const assets = new Map();
  for (const rel of sourceFiles.filter((rel) => ATTACHMENT_EXT.test(rel))) {
    const parts = rel.split('/');
    const lecture = /^L\d+$/i.test(parts[0]) ? parts.shift().toLowerCase() : '';
    const ext = rel.slice(rel.lastIndexOf('.')).toLowerCase();
    const name = kebab(parts.filter((part) => part.toLowerCase() !== 'assets').join('-').slice(0, -ext.length));
    const output = `assets/${lecture && !name.startsWith(`${lecture}-`) ? `${lecture}-` : ''}${name}${ext}`;
    const data = readFileSync(join(src, rel));
    if (IMAGE_EXT.test(rel)) {
      addOutput(output, data);
      assets.set(key(rel), output);
    } else {
      const url = `/downloads/notes/${coursePath}/${output.slice('assets/'.length)}`;
      if (publicOutputs.has(`public${url}`)) throw new Error(`Import filename collision: ${url}`);
      publicOutputs.set(`public${url}`, data);
      assets.set(key(rel), url);
    }
  }

  function findSource(doc, path) {
    const clean = decode(path).replace(/\\/g, '/');
    const rel = key(posix.normalize(posix.join(posix.dirname(doc.rel), clean)));
    if (targets.has(rel) || assets.has(rel)) return rel;
    const lecture = doc.rel.split('/')[0];
    // note-buddy sometimes writes assets/x.png from chapters/, one directory too deep.
    if (/^assets\//i.test(clean) && /^L\d+$/i.test(lecture)) {
      const scoped = key(`${lecture}/${clean}`);
      if (assets.has(scoped)) return scoped;
    }
    if (!clean.includes('/')) {
      const candidates = [...targets.keys(), ...assets.keys()].filter((candidate) => {
        const note = docs.get(candidate);
        return key(basename(candidate)) === key(clean) || key(basename(candidate, '.md')) === key(clean) || note?.title === clean || note?.data.aliases?.includes(clean);
      });
      const local = candidates.filter((candidate) => candidate.startsWith(`${key(lecture)}/`));
      const hits = local.length ? local : candidates;
      if (hits.length === 1) return hits[0];
      if (hits.length > 1) throw new Error(`Ambiguous reference in ${doc.rel}: ${path}`);
    }
    return null;
  }

  // Resolve links to the headings Astro generates, including duplicate suffixes
  // and the text KaTeX contributes to headings. No HTML anchors enter the notes.
  for (const target of targets.values()) {
    target.headings = new Map();
    target.originalSlugs = new Map();
    const nodes = [];
    visit(target.doc.tree, 'heading', (node) => { nodes.push(node); });
    const slugs = headingSlugs(nodes);
    nodes.forEach((node, index) => {
      const original = slugs[index];
      target.originalSlugs.set(node, original);
      if (node === target.doc.h1 && !target.chapter) target.headings.set(original, '');
    });
  }

  function collectHeadings(doc, references, include = () => true) {
    const target = targets.get(key(doc.rel));
    if (target.chapter && !doc.h1) {
      references.push({ target, synthetic: true, node: { type: 'heading', depth: 2, children: [{ type: 'text', value: stripChapterNumber(doc.title) }] } });
    }
    visit(doc.tree, 'heading', (node) => {
      if ((node !== doc.h1 || target.chapter) && include(node)) references.push({ target, node });
    });
  }

  function assignHeadingIds(references) {
    const children = references.map(({ target, node, synthetic }) => {
      const copy = structuredClone(node);
      if (!synthetic) copy.depth = Math.min(6, copy.depth + (target.shift ?? 0));
      if (target.chapter && node === target.doc.h1) {
        const number = chapterNumber(copy);
        if (number) number.node.value = number.node.value.slice(number.length);
      }
      return copy;
    });
    const file = { data: { astro: {} } };
    headingRenderer.runSync({ type: 'root', children }, file);
    const headings = file.data.astro.headings;
    if (headings.length !== references.length) throw new Error('Cannot determine imported heading IDs.');
    references.forEach(({ target, node, synthetic }, i) => {
      const id = headings[i].slug;
      if (!synthetic) {
        target.headings.set(target.originalSlugs.get(node), id);
      }
      if (synthetic || node === target.doc.h1) target.anchor = id;
    });
  }

  for (const lecture of lectures) {
    const references = [];
    const range = lecture.index && navigationRange(lecture.index);
    if (lecture.index) {
      collectHeadings(lecture.index, references, (node) => !range || node.position.start.offset < range[0]);
      if (range) {
        const target = targets.get(key(lecture.index.rel));
        const navigation = [...target.originalSlugs.keys()].find((node) => node.position.start.offset === range[0]);
        target.headings.set(target.originalSlugs.get(navigation), '');
      }
    }
    for (const chapter of lecture.chapters) collectHeadings(chapter, references);
    if (range) collectHeadings(lecture.index, references, (node) => node.position.start.offset >= range[1]);
    assignHeadingIds(references);
  }
  for (const target of targets.values()) {
    if (target.output.startsWith('/') || /^L\d+\//i.test(target.doc.rel)) continue;
    const references = [];
    collectHeadings(target.doc, references);
    assignHeadingIds(references);
  }

  function rewriteUrl(doc, url) {
    const current = targets.get(key(doc.rel));
    if (/^section:/i.test(url)) {
      const section = decode(url.slice(8));
      const lecture = key(doc.rel.split('/')[0]);
      const hit = [...targets.values()].find((target) => key(target.doc.rel).startsWith(`${lecture}/chapters/`) && (target.doc.data.section === section || target.prefix === `${lecture}-${kebab(section)}`));
      if (hit) return `#${hit.anchor}`;
      errors.push(`${doc.rel}: unknown section "${url}"`);
      return url;
    }
    if (/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(url)) return url;
    const [pathWithQuery, fragment] = url.split('#');
    const [path, ...queryParts] = pathWithQuery.split('?');
    const query = queryParts.length ? `?${queryParts.join('?')}` : '';
    const found = path ? findSource(doc, path) : key(doc.rel);
    if (found && assets.has(found)) {
      const asset = assets.get(found);
      const path = asset.startsWith('/') ? asset : `./${posix.relative(posix.dirname(current.output), asset)}`;
      return path + query + (fragment ? `#${fragment}` : '');
    }
    const target = found && targets.get(found);
    if (target) {
      const heading = fragment ? target.headings.get(decode(fragment)) ?? target.headings.get(slug(decode(fragment))) : target.anchor;
      if (fragment && heading === undefined) errors.push(`${doc.rel}: unknown heading "${url}"`);
      const route = target.output.startsWith('/') ? target.output : target.output === current.output ? '' : routeFor(target.output);
      return `${route}${query}${heading ? `#${heading}` : ''}` || '#';
    }
    errors.push(`${doc.rel}: cannot resolve "${url}"`);
    return url;
  }

  function transform(doc, { omitNavigation = true, omitH1 = false, omitRange } = {}) {
    const target = targets.get(key(doc.rel));
    const patches = [];
    const omitted = [];
    const remove = (node) => {
      let end = node.position.end.offset;
      while (doc.body[end] === '\n') end += 1;
      omitted.push([node.position.start.offset, end]);
    };
    if (omitH1 && doc.h1) remove(doc.h1);
    if (omitRange) omitted.push(omitRange);
    if (omitNavigation) {
      for (const node of doc.tree.children) {
        if (node.type !== 'paragraph') continue;
        const links = node.children.filter((child) => child.type === 'link');
        if (links.length && links.every((link) => /^(?:本讲目录|课程目录|上一节|下一节|返回目录)/.test(textOf(link))) && node.children.every((child) => child.type === 'link' || (child.type === 'text' && /^[\s·|←→]*$/.test(child.value)))) remove(node);
      }
    }
    omitted.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < omitted.length;) {
      if (omitted[i][0] <= omitted[i - 1][1]) {
        omitted[i - 1][1] = Math.max(omitted[i - 1][1], omitted[i][1]);
        omitted.splice(i, 1);
      } else i += 1;
    }
    const skipped = (node) => omitted.some(([start, end]) => node.position.start.offset >= start && node.position.end.offset <= end);
    const patch = (start, end, value) => patches.push({ start, end, value });
    visit(doc.tree, (node) => {
      if (!node.position || skipped(node)) return;
      const start = node.position.start.offset;
      const end = node.position.end.offset;
      const raw = doc.body.slice(start, end);
      if (node.type === 'heading') {
        const depth = Math.min(6, node.depth + (target.shift ?? 0));
        const marker = raw.match(/^#{1,6}[ \t]+/);
        if (marker) {
          patch(start, start + marker[0].length, `${'#'.repeat(depth)} `);
          const number = target.chapter && node === doc.h1 && chapterNumber(node);
          if (number) patch(number.node.position.start.offset, number.node.position.start.offset + number.length, '');
        } else {
          const title = target.chapter && node === doc.h1 ? stripChapterNumber(textOf(node)) : textOf(node);
          patch(start, end, `${'#'.repeat(depth)} ${title}`);
        }
      } else if (['link', 'image', 'definition'].includes(node.type)) {
        const url = rewriteUrl(doc, node.url);
        const destination = node.type === 'definition' ? raw.match(/^\[[^\]]+\]:\s*/)?.[0].length : raw.indexOf('](', node.children?.length ? node.children.at(-1).position.end.offset - start : 0) + 2;
        if (!destination || destination < 2) throw new Error(`Cannot locate link destination in ${doc.rel}: ${raw}`);
        const tail = raw.slice(destination);
        const leading = tail.match(/^\s*/)[0].length;
        const at = destination + leading;
        let length;
        if (raw[at] === '<') length = raw.indexOf('>', at) - at + 1;
        else {
          let depth = 0;
          length = 0;
          for (const char of raw.slice(at)) {
            if ((char === ')' && depth === 0) || /\s/.test(char)) break;
            if (char === '(') depth += 1;
            if (char === ')') depth -= 1;
            length += char.length;
          }
        }
        patch(start + at, start + at + length, /\s/.test(url) ? `<${url}>` : url);
      } else if (node.type === 'text') {
        for (const match of raw.matchAll(/(!?)\[\[([^\n]+?)\]\]/g)) {
          const [path, ...alias] = match[2].split('|');
          const url = rewriteUrl(doc, path);
          const label = alias.join('|') || path;
          const value = match[1] ? `![${alias.length ? `|${label}` : ''}](${url})` : `[${label}](${url})`;
          patch(start + match.index, start + match.index + match[0].length, value);
        }
      }
      if (node.type === 'footnoteReference' || node.type === 'footnoteDefinition') {
        const label = raw.match(/^\[\^([^\]]+)\]/);
        if (label) patch(start + 2, start + label[0].length - 1, `${target.prefix}-${label[1]}`);
      }
      // Reference-style links have their own namespace in each source chapter.
      if (node.type === 'definition') {
        const label = raw.match(/^\[([^\]]+)\]/);
        if (label) patch(start + 1, start + label[0].length - 1, `${target.prefix}-${label[1]}`);
      } else if (node.type === 'linkReference' || node.type === 'imageReference') {
        const label = raw.match(/\[([^\]]*)\]$/);
        if (label) {
          const replacement = `${target.prefix}-${node.label ?? node.identifier}`;
          if (node.referenceType === 'shortcut') patch(end, end, `[${replacement}]`);
          else patch(end - label[0].length + 1, end - 1, replacement);
        }
      }
    });
    for (const [start, end] of omitted) patch(start, end, '');
    patches.sort((a, b) => b.start - a.start || b.end - a.end);
    let result = doc.body;
    let boundary = doc.body.length;
    for (const { start, end, value } of patches) {
      if (end > boundary) throw new Error(`Overlapping Markdown edits in ${doc.rel}`);
      result = result.slice(0, start) + value + result.slice(end);
      boundary = start;
    }
    result = result.trim();
    if (target.chapter && !doc.h1) result = `## ${stripChapterNumber(doc.title)}\n\n${result}`;
    return result.trim();
  }

  for (const { lecture, output, chapters, index, overrides } of lectures) {
    let intro = '';
    let tail = '';
    if (index) {
      const range = navigationRange(index);
      if (range) {
        // Transform both parts separately, keeping summary material after the chapters.
        intro = transform(index, { omitH1: true, omitRange: [range[0], index.body.length] });
        tail = transform(index, { omitH1: true, omitRange: [0, range[1]] });
      } else intro = transform(index, { omitH1: true });
    }
    const body = [intro, ...chapters.map((doc) => transform(doc)), tail].filter(Boolean).join('\n\n---\n\n');
    addOutput(output, metadata(index, defaults, overrides, courseTitle, lecture, published)
      + addFigureTitles(body, overrides.lang ?? defaults.lang ?? index?.data.lang ?? 'zh-CN') + '\n');
  }
  for (const target of targets.values()) {
    if (target.output.startsWith('/') || /^L\d+\//i.test(target.doc.rel)) continue;
    addOutput(target.output, metadata(target.doc, defaults, target.overrides, courseTitle, target.lecture, published)
      + addFigureTitles(transform(target.doc, { omitH1: true }), target.overrides.lang ?? defaults.lang ?? target.doc.data.lang ?? 'zh-CN') + '\n');
  }
  if (errors.length) throw new Error(`Import validation failed (${errors.length}):\n${[...new Set(errors)].map((error) => `  ${error}`).join('\n')}`);

  const desired = [...outputs].map(([rel, data]) => [resolve(dest, rel), data]);
  desired.push(...[...publicOutputs].map(([rel, data]) => [resolve(root, rel), data]));
  const writes = [];
  for (const [file, data] of desired) {
    assertSafePath(root, file);
    if (file === src || inside(src, file)) throw new Error(`Import outputs must not overwrite source files: ${file}`);
    const old = existsSync(file) ? readFileSync(file) : null;
    if (!old || !old.equals(data)) writes.push({ file, data, before: old && hash(old) });
  }
  return {
    root, src, dest, published, lectures: lectures.length,
    notes: [...outputs.keys()].filter((rel) => rel.endsWith('.md')).length,
    assets: assets.size, writes,
    entries: [...outputs].filter(([rel]) => rel.endsWith('.md')).map(([rel]) => rel).sort((a, b) => a.localeCompare(b, 'en', { numeric: true })),
  };
}

/** Validate the snapshot, back up changed files, then atomically replace outputs. */
export function applyNotesImport(plan) {
  for (const { file, before } of plan.writes) {
    assertSafePath(plan.root, file);
    const current = existsSync(file) ? hash(readFileSync(file)) : null;
    if (current !== before) throw new Error('File changed after import planning: ' + file);
  }
  const changed = plan.writes.filter((write) => write.before !== null);
  let backup;
  if (changed.length) {
    backup = join(plan.root, '.cache/note-import-backups', new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8));
    assertSafePath(plan.root, backup);
    for (const { file } of changed) {
      const target = join(backup, relative(plan.root, file));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, readFileSync(file), { flag: 'wx' });
    }
  }
  for (const { file, data } of plan.writes) {
    mkdirSync(dirname(file), { recursive: true });
    const temp = file + '.' + randomUUID() + '.tmp';
    try {
      writeFileSync(temp, data, { flag: 'wx' });
      renameSync(temp, file);
    } finally {
      if (existsSync(temp)) unlinkSync(temp);
    }
  }
  return backup;
}

export function readImportConfig({ root = process.cwd(), configPath = 'notes.config.json' } = {}) {
  const file = resolve(root, configPath);
  if (!existsSync(file)) throw new Error('Import configuration not found: ' + file);
  const { importNotes } = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  if (!Array.isArray(importNotes) || !importNotes.length) throw new Error('notes.config.json needs a non-empty importNotes array.');
  return importNotes;
}

export function importNotes(configs, { root = process.cwd(), dryRun = false } = {}) {
  if (!Array.isArray(configs) || !configs.length) throw new Error('importNotes must be a non-empty array.');
  // Plan every course first so an invalid link in a later course prevents all writes.
  const plans = configs.map((config) => planNotesImport(config, { root }));
  for (const [i, plan] of plans.entries()) {
    if (plans.some((other, j) => j < i && (plan.dest === other.dest || inside(plan.dest, other.dest) || inside(other.dest, plan.dest)))) {
      throw new Error('Overlapping import destinations: ' + plan.dest);
    }
    if (plans.some((other) => plan.dest === other.src || inside(plan.dest, other.src) || inside(other.src, plan.dest))) {
      throw new Error('Import destinations must not overlap any configured source: ' + plan.dest);
    }
    if (plan.writes.some(({ file }) => plans.some((other) => file === other.src || inside(other.src, file)))) {
      throw new Error('Import outputs must not overwrite any configured source files.');
    }
  }
  for (const plan of plans) {
    console.log('[notes] ' + (dryRun ? '[dry-run] ' : '') + slash(relative(root, plan.dest)) + ': ' + plan.notes + ' notes, ' + plan.assets + ' assets; ' + plan.writes.length + ' writes (' + plan.writes.filter((write) => write.before !== null).length + ' backed up before replacement); published ' + plan.published);
    console.log('  Order: ' + plan.entries.join(' -> '));
    if (!dryRun) {
      const backup = applyNotesImport(plan);
      if (backup) console.log('  Backup: ' + slash(relative(root, backup)));
    }
  }
  return plans;
}

export function main(args = process.argv.slice(2), root = process.cwd()) {
  if (args.length === 1 && args[0] === '--help') {
    console.log('Usage: pnpm notes [--dry-run] [--config notes.config.json]\n\nReads importNotes[].from/to and frontmatter from the config.\nImages stay beside notes; downloads go into public/downloads/notes.\nChanged files are backed up in .cache/note-import-backups. No files are deleted.');
    return [];
  }
  let configPath;
  let dryRun = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--config' && args[index + 1] && !args[index + 1].startsWith('--') && !configPath) configPath = args[++index];
    else throw new Error('Usage: pnpm notes [--dry-run] [--config notes.config.json]');
  }
  return importNotes(readImportConfig({ root, configPath }), { root, dryRun });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch (error) { console.error('[notes] ' + error.message); process.exitCode = 1; }
}
