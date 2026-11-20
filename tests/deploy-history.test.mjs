import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { historyScript, main as deployMain, validateConfig } from '../scripts/deploy.mjs';

function findShell() {
  if (process.platform !== 'win32') return '/bin/sh';
  const gitPaths = spawnSync('where.exe', ['git'], { encoding: 'utf8', windowsHide: true }).stdout?.trim().split(/\r?\n/) ?? [];
  return gitPaths.map((path) => resolve(dirname(path), '..', 'bin', 'bash.exe')).find(existsSync);
}

const shell = findShell();
const shellTest = { skip: !shell && 'Install Git Bash to execute the remote-shell fixtures on Windows.' };
const releaseId = (day) => `202611${String(day).padStart(2, '0')}120000000-abcdef`;

async function temporary(t) {
  const root = await mkdtemp(join(tmpdir(), 'miniyuan-release-history-'));
  t.after(async () => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith('miniyuan-release-history-'));
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

async function fixture(t) {
  const root = await temporary(t);
  const releases = join(root, 'releases');
  await mkdir(releases);
  const run = (script) => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith('miniyuan-release-history-'));
    return spawnSync(shell, ['-s'], {
      cwd: root,
      input: `PATH=/usr/bin:/bin:$PATH\n${script}\n`,
      encoding: 'utf8',
      windowsHide: true,
    });
  };
  const pwd = run('pwd -P');
  assert.equal(pwd.status, 0, pwd.error?.message ?? pwd.stderr);
  const config = validateConfig({ host: 'fixture.invalid', remoteDir: pwd.stdout.trim() });
  const add = async (name, { complete = true, uploading = false } = {}) => {
    const directory = join(releases, name);
    await mkdir(directory);
    if (complete) await writeFile(join(directory, 'index.html'), `<h1>${name}</h1>`);
    if (uploading) await writeFile(join(directory, 'upload.tar.gz'), 'In-flight fixture archive');
    return directory;
  };
  const link = (target, name) => symlink(target, join(root, name), process.platform === 'win32' ? 'junction' : 'dir');
  return { root, releases, config, add, link, run };
}

function succeeds(result) {
  assert.equal(result.status, 0, result.error?.message ?? `${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

test('history commands reuse SSH settings and skip build, packaging, and upload', async (t) => {
  const root = await temporary(t);
  const config = { host: 'fixture.invalid', user: 'publisher', port: 2222, identityFile: 'fixture-key', remoteDir: '/var/www/fixture', liveLink: 'site' };
  await writeFile(join(root, 'custom.json'), JSON.stringify(config));
  t.mock.method(console, 'log', () => {});
  for (const args of [['--list'], ['--clean'], ['--clean', '--keep', '0'], ['--clean', '--keep', '3', '--dry-run']]) {
    const calls = [];
    deployMain([...args, '--config', 'custom.json'], root, (...call) => { calls.push(call); return { status: 0 }; });
    assert.equal(calls.length, 1);
    const [command, commandArgs] = calls[0];
    assert.equal(command, 'ssh');
    assert.deepEqual(commandArgs.slice(0, -1), ['-p', '2222', '-o', 'BatchMode=yes', '-i', 'fixture-key', 'publisher@fixture.invalid']);
    assert.match(commandArgs.at(-1), /\$base\/site/);
    if (args.includes('--dry-run') || args.includes('--list')) assert.doesNotMatch(commandArgs.at(-1), /rm -rf|mkdir /);
    if (args.includes('--dry-run')) assert.match(commandArgs.at(-1), /WOULD DELETE/);
    assert.deepEqual(await readdir(root), ['custom.json']);
  }
  assert.throws(() => deployMain(['--list', '--config', 'custom.json'], root, () => ({ status: 1 })), /ssh exited with 1/);
});

test('invalid history arguments fail before reading config or running SSH', () => {
  const execute = () => assert.fail('Invalid arguments must not execute commands');
  for (const args of [
    ['--clean', '--keep'], ['--clean', '--keep', '-1'], ['--clean', '--keep', '1.5'],
    ['--clean', '--keep', '9007199254740992'], ['--clean', '--keep', '3;echo'],
    ['--list', '--keep', '3'], ['--keep', '2'], ['--list', '--clean'],
    ['--clean', '--rollback'], ['--list', '--skip-build'], ['--clean', '--skip-build'],
  ]) assert.throws(() => deployMain(args, '/no-config-needed', execute), /--keep|--rollback|--skip-build/);
  assert.throws(() => historyScript({}, { keep: -1 }), /--keep/);
  assert.throws(() => historyScript({}, { keep: 1.5 }), /--keep/);
});

test('list shows newest first, current/previous, incomplete and unmanaged releases without writes', shellTest, async (t) => {
  const f = await fixture(t);
  await f.add(releaseId(1));
  await f.link(await f.add(releaseId(2)), 'previous');
  await f.link(await f.add(releaseId(3)), 'dist');
  await f.add(releaseId(4), { complete: false, uploading: true });
  await f.add('manual-backup');
  const before = await readdir(f.root);
  const output = succeeds(f.run(historyScript(f.config)));
  assert.match(output, new RegExp(`${releaseId(3)}\\s+current\\s+\\S+`));
  assert.match(output, new RegExp(`${releaseId(2)}\\s+previous\\s+\\S+`));
  assert.match(output, new RegExp(`${releaseId(1)}\\s+complete\\s+\\S+`));
  assert.match(output, new RegExp(`${releaseId(4)}\\s+incomplete\\s+\\S+`));
  assert.match(output, /manual-backup\s+unmanaged/);
  for (let day = 4; day > 1; day--) assert.ok(output.indexOf(releaseId(day)) < output.indexOf(releaseId(day - 1)));
  assert.deepEqual(await readdir(f.root), before);
});

test('cleanup previews and deletes older complete releases while retaining five newest and pinned older versions', shellTest, async (t) => {
  const f = await fixture(t);
  for (let day = 1; day <= 8; day++) await f.add(releaseId(day));
  await f.link(join(f.releases, releaseId(2)), 'previous');
  await f.link(join(f.releases, releaseId(6)), 'dist');
  await f.add(releaseId(9), { complete: false, uploading: true });
  await f.add(releaseId(10), { uploading: true });
  await f.add('manual-backup');
  const outside = join(f.root, 'outside');
  await mkdir(outside);
  await writeFile(join(outside, 'index.html'), 'Must survive');
  await f.link(outside, `releases/${releaseId(11)}`);
  const before = await readdir(f.releases);

  const preview = succeeds(f.run(historyScript(f.config, { clean: true, dryRun: true })));
  assert.match(preview, /Preview: 2 release\(s\) would be deleted/);
  for (const day of [1, 3]) assert.ok(preview.includes(`WOULD DELETE ${releaseId(day)}`));
  assert.deepEqual(await readdir(f.releases), before);
  assert.equal(existsSync(join(f.root, '.deploy-lock')), false);

  const output = succeeds(f.run(historyScript(f.config, { clean: true })));
  assert.match(output, /Deleted 2 release\(s\)/);
  for (const day of [1, 3]) assert.equal(existsSync(join(f.releases, releaseId(day))), false);
  for (const day of [2, 4, 5, 6, 7, 8, 9, 10, 11]) assert.ok(existsSync(join(f.releases, releaseId(day))));
  assert.ok(existsSync(join(f.releases, 'manual-backup')));
  assert.equal(await readFile(join(outside, 'index.html'), 'utf8'), 'Must survive');
  assert.equal(await readFile(join(f.root, 'dist', 'index.html'), 'utf8'), `<h1>${releaseId(6)}</h1>`);
  assert.equal(await readFile(join(f.root, 'previous', 'index.html'), 'utf8'), `<h1>${releaseId(2)}</h1>`);
  assert.equal(existsSync(join(f.root, '.deploy-lock')), false);
});

test('--keep 0 preserves current and previous even when they refer to the same release', shellTest, async (t) => {
  const f = await fixture(t);
  const protectedDirectory = await f.add(releaseId(1));
  await f.link(protectedDirectory, 'dist');
  await f.link(protectedDirectory, 'previous');
  await f.add(releaseId(2));
  const output = succeeds(f.run(historyScript(f.config, { clean: true, keep: 0 })));
  assert.match(output, /current,previous/);
  assert.deepEqual(await readdir(f.releases), [releaseId(1)]);
});

test('cleanup honors an explicit retention count without current or previous links', shellTest, async (t) => {
  const f = await fixture(t);
  for (let day = 1; day <= 4; day++) await f.add(releaseId(day));
  succeeds(f.run(historyScript(f.config, { clean: true, keep: 2 })));
  assert.deepEqual(await readdir(f.releases), [releaseId(3), releaseId(4)]);
});

test('cleanup obeys the deployment lock; read-only preview does not alter an existing lock', shellTest, async (t) => {
  const f = await fixture(t);
  await f.add(releaseId(1));
  await mkdir(join(f.root, '.deploy-lock'));
  const blocked = f.run(historyScript(f.config, { clean: true, keep: 0 }));
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /holds the lock/);
  assert.ok(existsSync(join(f.releases, releaseId(1))));
  const preview = succeeds(f.run(historyScript(f.config, { clean: true, keep: 0, dryRun: true })));
  assert.match(preview, /WOULD DELETE/);
  assert.ok(existsSync(join(f.root, '.deploy-lock')));
  assert.ok(existsSync(join(f.releases, releaseId(1))));
});

for (const scenario of ['current outside releases', 'previous outside releases', 'dangling current', 'real current directory']) {
  test(`cleanup refuses ${scenario} and releases its own lock`, shellTest, async (t) => {
    const f = await fixture(t);
    await f.add(releaseId(1));
    if (scenario === 'real current directory') await mkdir(join(f.root, 'dist'));
    else {
      const outside = join(f.root, 'outside');
      if (scenario !== 'dangling current') await mkdir(outside);
      await f.link(outside, scenario.startsWith('previous') ? 'previous' : 'dist');
    }
    const result = f.run(historyScript(f.config, { clean: true, keep: 0 }));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /release symlink|release directory|Cannot resolve/);
    assert.ok(existsSync(join(f.releases, releaseId(1))));
    assert.equal(existsSync(join(f.root, '.deploy-lock')), false);
  });
}

test('history handles an empty or absent releases directory without writes', shellTest, async (t) => {
  const f = await fixture(t);
  for (const options of [{}, { clean: true }, { clean: true, dryRun: true }]) {
    assert.match(succeeds(f.run(historyScript(f.config, options))), /No releases found/);
    assert.equal(existsSync(join(f.root, '.deploy-lock')), false);
    const config = { ...f.config, remoteDir: `${f.config.remoteDir}/not-created` };
    assert.match(succeeds(f.run(historyScript(config, options))), /No releases found/);
    assert.equal(existsSync(join(f.root, 'not-created')), false);
  }
});

test('cleanup refuses a symlinked releases root', shellTest, async (t) => {
  const f = await fixture(t);
  await f.add(releaseId(1));
  const other = join(f.root, 'other');
  await mkdir(other);
  await symlink(f.releases, join(other, 'releases'), process.platform === 'win32' ? 'junction' : 'dir');
  const result = f.run(historyScript({ ...f.config, remoteDir: `${f.config.remoteDir}/other` }, { clean: true, keep: 0 }));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must be a real directory/);
  assert.ok(existsSync(join(f.releases, releaseId(1))));
});
