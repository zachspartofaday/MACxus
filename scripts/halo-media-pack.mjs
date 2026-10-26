import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { extractFile } from '@electron/asar';

const relative = 'assets/compatibility-packs/halo-preview-media-v1';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function verify(read) {
  const manifest = JSON.parse((await read('manifest.json')).toString('utf8'));
  if (manifest.id !== 'halo-preview-media-v1' || manifest.storeId !== '9N683TDT5M7R'
      || manifest.engine !== 'crossover-preview') throw Error('Invalid Halo compatibility pack.');
  const files = { 'payload/mfplat.dll': manifest.dlls?.['mfplat.dll'], 'payload/winegstreamer.dll': manifest.dlls?.['winegstreamer.dll'],
    'source/crossover-sources-26.3.0.tar.gz': manifest.source?.sha256, 'COPYING.LIB': manifest.licenseSHA256, 'source/crossover-preview-halo-mf-software-output.patch': manifest.patch?.sha256 };
  for (const [file, expected] of Object.entries(files)) {
    if (!/^[a-f0-9]{64}$/.test(expected ?? '') || digest(await read(file)) !== expected) throw Error(`Halo pack checksum mismatch: ${file}`);
  }
  for (const file of ['source/build-scripts/prepare-halo-media-pack.mjs', 'source/build-scripts/halo-media-pack.mjs', 'README.md']) {
    if (!(await read(file)).length) throw Error(`Missing Halo pack source instructions: ${file}`);
  }
  return manifest;
}
export function verifyHaloMediaPackDirectory(root) { return verify(file => fs.readFile(path.join(root, file))); }
export function verifyPackagedHaloMediaPack(archive) { return verify(file => extractFile(archive, `${relative}/${file}`)); }
