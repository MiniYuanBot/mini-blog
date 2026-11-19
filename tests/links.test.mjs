import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { auditLinks } from '../scripts/check-links.mjs';

test('built-output audit resolves canonical, relative, encoded asset and anchor URLs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'miniyuan-links-'));
  try {
    await mkdir(join(directory, 'notes'), { recursive: true });
    await mkdir(join(directory, 'assets'), { recursive: true });
    await writeFile(join(directory, 'index.html'), '<link rel="canonical" href="https://fixture.example/"><h1 id="main">Home</h1><a href="/notes/#section">Note</a><img src="/assets/test%20image.svg"><a href="https://remote.example/absent">External</a>');
    await writeFile(join(directory, 'notes', 'index.html'), '<h1 id="section">Note</h1><a href="../#main">Home</a><link rel="stylesheet" href="/assets/test.css">');
    await writeFile(join(directory, 'assets', 'test image.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    await writeFile(join(directory, 'assets', 'test.css'), 'body{background-image:url("test%20image.svg")}');
    assert.deepEqual((await auditLinks(directory)).errors, []);
    await writeFile(join(directory, 'broken.html'), '<a href="/missing/">Missing</a><a href="/notes/#absent">Missing anchor</a><img src="/assets/no-image.svg">');
    const broken = await auditLinks(directory);
    assert.equal(broken.errors.length, 3);
    assert.ok(broken.errors.some((error) => error.includes('missing fragment')));
    assert.ok(broken.errors.some((error) => error.includes('no-image.svg')));
  } finally {
    // Only remove the exact temporary directory created by this test.
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('miniyuan-links-'));
    await rm(directory, { recursive: true, force: true });
  }
});
