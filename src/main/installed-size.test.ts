import { afterEach, beforeEach, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installedGameBytes } from './installed-size';

let root: string;
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'macxus-size-')); });
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

it('measures nested logical file sizes, including sparse files, without shell parsing', async () => {
  const game = path.join(root, "Game's files; literal"); await fs.mkdir(path.join(game, 'data'), { recursive: true });
  await fs.writeFile(path.join(game, 'manifest'), '12345');
  const sparse = path.join(game, 'data', 'large.bin'); await fs.writeFile(sparse, ''); await fs.truncate(sparse, 3 * 1024 ** 3);
  expect(await installedGameBytes(game)).toBe(3 * 1024 ** 3 + 5);
});
it('does not follow linked data, external saves or directory cycles', async () => {
  const game = path.join(root, 'Game'); await fs.mkdir(game); await fs.writeFile(path.join(game, 'data'), '123');
  await fs.writeFile(path.join(root, 'save'), '123456789');
  await fs.symlink(path.join(root, 'save'), path.join(game, 'linked-save'));
  await fs.symlink(game, path.join(game, 'loop'));
  expect(await installedGameBytes(game)).toBe(3);
});
it('counts hard-linked content only once', async () => {
  await fs.writeFile(path.join(root, 'data'), '12345'); await fs.link(path.join(root, 'data'), path.join(root, 'alias'));
  expect(await installedGameBytes(root)).toBe(5);
});
it('reports unavailable instead of a partial total when the scan exceeds its bounds', async () => {
  await fs.writeFile(path.join(root, 'a'), '12'); await fs.writeFile(path.join(root, 'b'), '345');
  expect(await installedGameBytes(root, { entries: 1, milliseconds: 15_000 })).toBeUndefined();
  expect(await installedGameBytes(root, { entries: 100, milliseconds: 0 })).toBeUndefined();
});
it('handles empty, missing and non-directory installations without inventing a size', async () => {
  expect(await installedGameBytes(root)).toBe(0);
  expect(await installedGameBytes(path.join(root, 'missing'))).toBeUndefined();
  await fs.writeFile(path.join(root, 'file'), 'data');
  expect(await installedGameBytes(path.join(root, 'file'))).toBeUndefined();
});
