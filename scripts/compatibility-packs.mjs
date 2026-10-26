import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { extractFile } from '@electron/asar';
import { parseCompatibilityCatalog, parseCompatibilityManifest } from '../src/shared/compatibility-pack-schema.mjs';

const relative = 'assets/compatibility-packs';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export async function verifyCompatibilityPack(read, entry) {
  const manifest = parseCompatibilityManifest(JSON.parse((await read('manifest.json')).toString('utf8')), entry);
  const files = {
    ...Object.fromEntries(Object.entries(manifest.dlls).map(([name, hash]) => [`payload/${name}`, hash])),
    [`source/${manifest.source.archive}`]: manifest.source.sha256,
    'COPYING.LIB': manifest.licenseSHA256,
    [`source/${path.posix.basename(manifest.patch.path)}`]: manifest.patch.sha256,
  };
  for (const [file, expected] of Object.entries(files)) {
    if (digest(await read(file)) !== expected) throw Error(`Compatibility pack checksum mismatch: ${file}`);
  }
  for (const file of ['source/build-scripts/prepare-compatibility-packs.mjs', 'source/build-scripts/compatibility-packs.mjs', 'source/src/shared/compatibility-pack-schema.mjs', 'README.md']) {
    if (!(await read(file)).length) throw Error(`Missing compatibility pack source instructions: ${file}`);
  }
  return manifest;
}
export function verifyCompatibilityPackDirectory(root, entry) { return verifyCompatibilityPack(file => fs.readFile(path.join(root, file)), entry); }
async function verifyAll(read) {
  const catalog = parseCompatibilityCatalog(JSON.parse((await read('catalog.json')).toString('utf8')));
  for (const entry of catalog.packs) await verifyCompatibilityPack(file => read(`${entry.id}/${file}`), entry);
  return catalog;
}
export function verifyCompatibilityPacksDirectory(root) { return verifyAll(file => fs.readFile(path.join(root, file))); }
export function verifyPackagedCompatibilityPacks(archive) { return verifyAll(file => extractFile(archive, `${relative}/${file}`)); }
