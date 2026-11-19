import test from 'node:test';
import assert from 'node:assert/strict';
import { importTypeScript } from './helpers.mjs';

const { createHeaderVisibility } = await importTypeScript(new URL('../src/lib/header-visibility.ts', import.meta.url));

test('reading down hides navigation; upward intent reveals it without jitter', () => {
  const visible = createHeaderVisibility();
  for (const y of [0, 50, 120, 150, 175]) assert.equal(visible(y), true);
  assert.equal(visible(220), false);
  for (const y of [500, 499, 502, 495, 503, 480, 470]) assert.equal(visible(y), false);
  assert.equal(visible(460), true);
  for (const y of [461, 459, 462, 475, 510]) assert.equal(visible(y), true);
  assert.equal(visible(530), false);
});

test('menu and focus keep navigation visible and reset accumulated travel', () => {
  const visible = createHeaderVisibility();
  assert.equal(visible(600), false);
  assert.equal(visible(600, true), true);
  assert.equal(visible(950, true), true);
  assert.equal(visible(950), true);
  assert.equal(visible(980), true);
  assert.equal(visible(1020), false);
});

test('top of page and restored scroll positions start with usable navigation', () => {
  const visible = createHeaderVisibility(1400);
  assert.equal(visible(1400), true);
  assert.equal(visible(1500), false);
  assert.equal(visible(120), true);
  assert.equal(visible(-100), true);
  assert.equal(visible(0), true);
});
