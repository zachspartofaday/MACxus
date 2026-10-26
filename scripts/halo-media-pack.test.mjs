import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createPackage } from '@electron/asar';
import { verifyHaloMediaPackDirectory, verifyPackagedHaloMediaPack } from './halo-media-pack.mjs';
const sha = data => createHash('sha256').update(data).digest('hex');

test('packaging requires both verified DLLs, the complete source and license inside the actual ASAR', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'halo-package-'));
  try {
    const app = path.join(temp, 'app'), root = path.join(app, 'assets/compatibility-packs/halo-preview-media-v1');
    const data = { 'payload/mfplat.dll': 'test-mfplat', 'payload/winegstreamer.dll': 'test-winegstreamer', 'source/crossover-sources-26.3.0.tar.gz': 'test-complete-source', 'COPYING.LIB': 'test-license', 'source/build-scripts/prepare-halo-media-pack.mjs': 'test-build-recipe', 'source/build-scripts/halo-media-pack.mjs': 'test-verifier', 'README.md': 'test-attribution-and-instructions', 'source/crossover-preview-halo-mf-software-output.patch': 'test-source-patch' };
    for (const [file, bytes] of Object.entries(data)) { await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true }); await fs.writeFile(path.join(root, file), bytes); }
    await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify({ id: 'halo-preview-media-v1', storeId: '9N683TDT5M7R', engine: 'crossover-preview', dlls: { 'mfplat.dll': sha(data['payload/mfplat.dll']), 'winegstreamer.dll': sha(data['payload/winegstreamer.dll']) }, source: { sha256: sha(data['source/crossover-sources-26.3.0.tar.gz']) }, licenseSHA256: sha(data['COPYING.LIB']), patch: { sha256: sha(data['source/crossover-preview-halo-mf-software-output.patch']) } }));
    await verifyHaloMediaPackDirectory(root);
    const archive = path.join(temp, 'good.asar'); await createPackage(app, archive); await verifyPackagedHaloMediaPack(archive);
    await fs.unlink(path.join(root, 'source/crossover-sources-26.3.0.tar.gz'));
    await assert.rejects(verifyHaloMediaPackDirectory(root));
    const missingSource = path.join(temp, 'missing.asar'); await createPackage(app, missingSource); await assert.rejects(verifyPackagedHaloMediaPack(missingSource));
    await fs.writeFile(path.join(root, 'source/crossover-sources-26.3.0.tar.gz'), data['source/crossover-sources-26.3.0.tar.gz']);
    await fs.writeFile(path.join(root, 'payload/mfplat.dll'), 'corrupt');
    await assert.rejects(verifyHaloMediaPackDirectory(root), /checksum mismatch/);
    const corrupt = path.join(temp, 'corrupt.asar'); await createPackage(app, corrupt); await assert.rejects(verifyPackagedHaloMediaPack(corrupt), /checksum mismatch/);
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
});
