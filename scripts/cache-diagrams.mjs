/** Populate the deterministic PlantUML cache before compiling Markdown.
 * Adapted from the old project's two-stage rendering design. Network work is
 * deliberately outside Astro's concurrent content loader.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMdx from 'remark-mdx';
import { visit } from 'unist-util-visit';
import { cacheFile, cachedSvg, diagramHash, diagramSource, remoteUrl } from '../src/plugins/lib/plantuml.mjs';

function contentFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? contentFiles(path) : entry.isFile() && /\.mdx?$/.test(entry.name) ? [path] : [];
  });
}

/** Parse fenced code as Markdown syntax, including nested and tilde fences.
 * Blank the frontmatter but retain line numbers for useful error messages.
 */
export function collectDiagrams(root = process.cwd()) {
  const diagrams = new Map();
  for (const path of contentFiles(join(root, 'src/content'))) {
    const source = readFileSync(path, 'utf8').replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, (frontmatter) => frontmatter.replace(/[^\r\n]/g, ' '));
    const parser = unified().use(remarkParse);
    if (path.endsWith('.mdx')) parser.use(remarkMdx);
    let tree;
    try { tree = parser.parse(source); }
    catch (error) { throw new Error(`${relative(root, path)}: ${error.message}`); }
    visit(tree, 'code', (node) => {
      if (node.lang !== 'plantuml') return;
      const renderedSource = diagramSource(node.value);
      const hash = diagramHash(renderedSource);
      if (!diagrams.has(hash)) diagrams.set(hash, { source: renderedSource, hash, locations: [] });
      diagrams.get(hash).locations.push(`${relative(root, path)}:${node.position?.start.line || 1}`);
    });
  }
  return [...diagrams.values()];
}

export function validSvg(value) {
  const document = value.replace(/^\uFEFF/, '').replace(/^\s*<\?xml[\s\S]*?\?>\s*/i, '').trim();
  return /^<svg[\s>]/i.test(document) && /<\/svg>\s*$/i.test(document)
    && !/data-diagram-type=["']ERROR["']|Syntax Error\?/i.test(document);
}

function renderLocally(source) {
  const jar = resolve(process.env.PLANTUML_JAR);
  if (!existsSync(jar)) throw new Error(`PLANTUML_JAR does not exist: ${jar}`);
  const result = spawnSync('java', ['-Djava.awt.headless=true', '-jar', jar, '-tsvg', '-pipe', '-charset', 'UTF-8'], {
    input: source, encoding: 'utf8', timeout: 30_000, maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Local PlantUML exited with ${result.status}: ${(result.stderr || '').trim()}`);
  if (!validSvg(result.stdout)) throw new Error('Local PlantUML returned an invalid or error SVG. Check the diagram syntax.');
  return result.stdout;
}

async function renderRemotely(source) {
  const url = new URL(remoteUrl(source));
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('PLANTUML_SERVER must use HTTP or HTTPS.');
  let failure;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { accept: 'image/svg+xml' }, signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(`PlantUML server returned HTTP ${response.status}`);
      const svg = await response.text();
      if (!validSvg(svg)) throw new Error('PlantUML server returned an invalid or error SVG. Check the diagram syntax.');
      return svg;
    } catch (error) { failure = error; }
  }
  throw failure;
}

export async function main(args = process.argv.slice(2), root = process.cwd()) {
  const flags = new Set(args);
  if (flags.has('--help')) {
    console.log('Usage: pnpm diagrams [--check | --force]\n\n--check  Validate existing cache; do not render or contact a server.\n--force  Replace cached diagrams.\n\nPLANTUML_JAR selects a local Java renderer. Otherwise PLANTUML_SERVER\n(default https://www.plantuml.com/plantuml) receives the diagram source.');
    return;
  }
  for (const arg of flags) if (!['--check', '--force'].includes(arg)) throw new Error(`Unknown argument: ${arg}`);
  if (flags.has('--check') && flags.has('--force')) throw new Error('--check and --force cannot be used together.');
  const diagrams = collectDiagrams(root);
  const pending = diagrams.filter((diagram) => {
    const cached = cachedSvg(diagram.source, root);
    return flags.has('--force') || !cached || !validSvg(cached);
  });
  console.log(`${diagrams.length} unique PlantUML diagram(s); ${diagrams.length - pending.length} cached; ${pending.length} missing or invalid.`);
  if (!pending.length) return;
  if (flags.has('--check')) throw new Error(`Uncached diagrams:\n${pending.flatMap((diagram) => diagram.locations).map((location) => `  ${location}`).join('\n')}\nRun pnpm diagrams to populate the cache.`);
  console.log(process.env.PLANTUML_JAR ? 'Rendering with the local PlantUML JAR.' : `Sending diagram source to ${new URL(remoteUrl(pending[0].source)).origin}.`);
  const failures = [];
  let completed = 0;
  const worker = async () => {
    while (pending.length) {
      const diagram = pending.shift();
      if (!diagram) break;
      try {
        const svg = process.env.PLANTUML_JAR ? renderLocally(diagram.source) : await renderRemotely(diagram.source);
        const destination = cacheFile(diagram.source, root);
        mkdirSync(dirname(destination), { recursive: true });
        const temporary = `${destination}.${process.pid}.tmp`;
        writeFileSync(temporary, svg, 'utf8');
        renameSync(temporary, destination);
        completed += 1;
      } catch (error) { failures.push(`${diagram.locations.join(', ')}: ${error.message}`); }
    }
  };
  await Promise.all(Array.from({ length: process.env.PLANTUML_JAR ? 1 : 3 }, worker));
  console.log(`Wrote ${completed} diagram(s) to .plantuml-cache/.`);
  if (failures.length) throw new Error(`Some diagrams could not be rendered:\n${failures.map((failure) => `  ${failure}`).join('\n')}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
