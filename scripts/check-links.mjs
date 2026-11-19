import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve, relative, join, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { unified } from 'unified';
import rehypeParse from 'rehype-parse';
import { visit } from 'unist-util-visit';

const parser = unified().use(rehypeParse);

async function filesWithin(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesWithin(file));
    else if (entry.isFile()) result.push(file);
  }
  return result;
}

/** Check emitted files, not source guesses: internal routes, asset URLs,
 * responsive image candidates, CSS resources, and HTML fragment targets. */
export async function auditLinks(directory, options = {}) {
  const root = resolve(directory);
  const files = await filesWithin(root);
  const present = new Set(files.map((file) => resolve(file)));
  const documents = new Map();
  const references = [];
  let canonicalOrigin;

  for (const file of files.filter((file) => file.endsWith('.html'))) {
    const tree = parser.parse(await readFile(file, 'utf8'));
    const ids = new Set();
    visit(tree, 'element', (node) => {
      const properties = node.properties || {};
      if (properties.id) ids.add(String(properties.id));
      if (node.tagName === 'a' && properties.name) ids.add(String(properties.name));
      if (!canonicalOrigin && node.tagName === 'link' && properties.rel?.includes('canonical')) {
        try { canonicalOrigin = new URL(String(properties.href)).origin; } catch { /* Report the URL below. */ }
      }
      for (const attribute of ['href', 'src', 'poster']) {
        if (typeof properties[attribute] === 'string') references.push({ file, url: properties[attribute], attribute });
      }
      if (typeof properties.srcSet === 'string' && !properties.srcSet.startsWith('data:')) {
        for (const candidate of properties.srcSet.split(',')) {
          references.push({ file, url: candidate.trim().split(/\s+/)[0], attribute: 'srcset' });
        }
      }
    });
    documents.set(file, ids);
  }
  for (const file of files.filter((file) => file.endsWith('.css'))) {
    const css = await readFile(file, 'utf8');
    for (const match of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
      references.push({ file, url: match[1].trim(), attribute: 'CSS url' });
    }
  }

  const origin = options.origin || canonicalOrigin || 'https://static.invalid';
  const errors = [];
  let checked = 0;
  for (const reference of references) {
    const { file, url: raw, attribute } = reference;
    if (!raw || raw === '#' || /^(?:data:|mailto:|tel:|javascript:|blob:)/i.test(raw)) continue;
    const filePath = `/${relative(root, file).split(sep).join('/')}`;
    const route = filePath.replace(/index\.html$/, '');
    let url;
    try { url = new URL(raw, new URL(route, origin)); }
    catch { errors.push(`${relative(root, file)}: invalid ${attribute} ${JSON.stringify(raw)}`); continue; }
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) continue;
    checked += 1;
    let decoded;
    try { decoded = decodeURIComponent(url.pathname); }
    catch { errors.push(`${relative(root, file)}: malformed URL encoding ${JSON.stringify(raw)}`); continue; }
    let target = resolve(root, `.${decoded}`);
    const rel = relative(root, target);
    if (rel.startsWith(`..${sep}`) || rel === '..' || resolve(root, rel) !== target) {
      errors.push(`${relative(root, file)}: URL escapes output directory ${JSON.stringify(raw)}`);
      continue;
    }
    if (!present.has(target)) {
      const candidates = [join(target, 'index.html'), `${target}.html`];
      target = candidates.find((candidate) => present.has(candidate)) || target;
    }
    if (!present.has(target)) {
      errors.push(`${relative(root, file)}: missing ${attribute} target ${JSON.stringify(raw)}`);
      continue;
    }
    if (url.hash && extname(target) === '.html') {
      let fragment;
      try { fragment = decodeURIComponent(url.hash.slice(1)); }
      catch { errors.push(`${relative(root, file)}: malformed fragment ${JSON.stringify(raw)}`); continue; }
      // Browser text-fragment directives do not refer to an HTML id.
      if (fragment.startsWith(':~:text=')) continue;
      if (!documents.get(target)?.has(fragment)) errors.push(`${relative(root, file)}: missing fragment ${JSON.stringify(raw)}`);
    }
  }
  return { files: files.length, pages: documents.size, checked, errors };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const directory = resolve(process.argv[2] || 'dist');
  try {
    if (!(await stat(directory)).isDirectory()) throw new Error(`${directory} is not a directory`);
    const result = await auditLinks(directory);
    if (result.errors.length) {
      console.error(result.errors.join('\n'));
      process.exitCode = 1;
    } else console.log(`Link audit passed: ${result.pages} pages, ${result.checked} local references.`);
  } catch (error) {
    console.error(`Link audit failed: ${error.message}. Run pnpm build first.`);
    process.exitCode = 1;
  }
}
