import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { collectDiagrams, validSvg, main as diagramsMain } from '../scripts/cache-diagrams.mjs';
import { cacheFile } from '../src/plugins/lib/plantuml.mjs';
import { validateConfig, releaseScript, main as deployMain } from '../scripts/deploy.mjs';

async function temporary(t, prefix) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  t.after(async () => {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith(prefix));
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

test('diagram discovery parses nested and tilde fences in MD/MDX and deduplicates source', async (t) => {
  const root = await temporary(t, 'miniyuan-diagrams-');
  const content = join(root, 'src', 'content', 'studies');
  await mkdir(content, { recursive: true });
  await writeFile(join(content, 'markdown.md'), [
    '---', 'title: Test fixture', '---', '',
    '> ~~~plantuml', '> A -> B: Nested fixture', '> ~~~', '',
    '````markdown', '```plantuml', 'ShouldNotBeRendered -> Example: Documentation', '```', '````',
  ].join('\n'));
  await writeFile(join(content, 'component.mdx'), [
    "import Marker from './marker.astro';", '',
    '~~~plantuml', 'A -> B: Nested fixture', '~~~', '',
    '```plantuml', 'C -> D: MDX fixture', '```',
  ].join('\n'));
  const diagrams = collectDiagrams(root);
  assert.equal(diagrams.length, 2);
  assert.equal(diagrams.find((diagram) => diagram.source.includes('A -> B')).locations.length, 2);
  assert.ok(diagrams.every((diagram) => diagram.locations.every((location) => /:\d+$/.test(location))));
  assert.ok(diagrams.every((diagram) => !diagram.source.includes('ShouldNotBeRendered')));
});

test('cache check diagnoses missing/invalid files without writes or network', async (t) => {
  t.mock.method(console, 'log', () => {});
  let networkCalls = 0;
  t.mock.method(globalThis, 'fetch', async () => { networkCalls += 1; throw new Error('Network must stay unused'); });
  const root = await temporary(t, 'miniyuan-cache-');
  const content = join(root, 'src', 'content');
  await mkdir(content, { recursive: true });
  await writeFile(join(content, 'fixture.md'), '```plantuml\nA -> B: Cache validation\n```');
  const [diagram] = collectDiagrams(root);
  await assert.rejects(diagramsMain(['--check'], root), /Uncached diagrams/);
  assert.equal(existsSync(join(root, '.plantuml-cache')), false);
  await mkdir(join(root, '.plantuml-cache'));
  await writeFile(cacheFile(diagram.source, root), '<svg>truncated response');
  await assert.rejects(diagramsMain(['--check'], root), /Uncached diagrams/);
  assert.equal(await readFile(cacheFile(diagram.source, root), 'utf8'), '<svg>truncated response');
  await writeFile(cacheFile(diagram.source, root), '<svg xmlns="http://www.w3.org/2000/svg"><text>Cached fixture</text></svg>');
  await diagramsMain(['--check'], root);
  assert.equal(networkCalls, 0);
  assert.equal(validSvg('<?xml version="1.0"?><svg><path /></svg>'), true);
  assert.equal(validSvg('<html>Gateway error</html>'), false);
  assert.equal(validSvg('<svg data-diagram-type="ERROR">Syntax Error?</svg>'), false);
});

test('deployment config rejects traversal, shell metacharacters, and arbitrary hooks', () => {
  const config = { host: 'fixture.invalid', remoteDir: '/var/www/fixture' };
  assert.equal(validateConfig(config).user, 'deploy');
  assert.throws(() => validateConfig({ ...config, remoteDir: '/' }), /remoteDir/);
  assert.throws(() => validateConfig({ ...config, remoteDir: '/var/www/../fixture' }), /remoteDir/);
  assert.throws(() => validateConfig({ ...config, host: 'fixture.invalid;echo x' }), /host/);
  assert.throws(() => validateConfig({ ...config, liveLink: '../dist' }), /liveLink/);
  assert.throws(() => validateConfig({ ...config, postDeploy: 'unexpected command' }), /Unsupported/);
  assert.throws(() => validateConfig({ ...config, port: 70000 }), /port/);
  const script = releaseScript(validateConfig(config), '20000101000000-fixture');
  assert.ok(script.indexOf('Release is incomplete') < script.lastIndexOf('mv -Tf'), 'Verify complete extraction before switching the live link');
  assert.doesNotMatch(script, /rm -rf/, 'Deployment must never purge previous releases automatically');
});

test('deployment dry run is reviewable and leaves the local project unchanged', async (t) => {
  const root = await temporary(t, 'miniyuan-deploy-');
  const config = { host: 'fixture.invalid', remoteDir: '/var/www/fixture' };
  await writeFile(join(root, 'deploy.config.json'), JSON.stringify(config));
  const before = await readdir(root);
  const logs = [];
  t.mock.method(console, 'log', (message) => logs.push(message));
  deployMain(['--dry-run'], root);
  assert.deepEqual(await readdir(root), before);
  assert.ok(logs.some((line) => line.includes('scp')));
  assert.ok(logs.some((line) => line.includes('mv -Tf')));
  assert.ok(logs.some((line) => line.includes('Nothing was changed')));
  logs.length = 0;
  deployMain(['--dry-run', '--rollback'], root);
  assert.ok(logs.some((line) => line.includes('No previous release')));
  assert.equal(logs.some((line) => line.includes('$ tar ')), false);
  assert.deepEqual(await readdir(root), before);
});
