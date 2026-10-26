// Restore the ignored, patched Wine PE files from the exact owner release.
// The release and each DLL are pinned independently; no account is used.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { extractFile } from '@electron/asar';
import { verifyRuntimeDllDirectory, verifyPackagedRuntimeDlls } from './mac-runtime-dlls.mjs';

if (process.platform !== 'darwin') throw Error('Preparing Mac runtime DLLs requires macOS.');
const directory = fileURLToPath(new URL('../assets/mac-runtime-dlls', import.meta.url));
try {
  await verifyRuntimeDllDirectory(directory);
  console.log('Mac runtime DLLs match the pinned manifest.');
} catch {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'macxus-dlls-'));
  const image = path.join(work, 'runtime.dmg');
  const mount = path.join(work, 'mount');
  let mounted = false;
  const run = (tool, args) => execFileSync(tool, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    run('/usr/bin/curl', ['--fail', '--location', '--proto', '=https', '--proto-redir', '=https', '--max-time', '600', '--output', image,
      'https://github.com/fladnaG86/MACxus/releases/download/v0.3.11-mac.5/MACxus-0.3.11-arm64.dmg']);
    const hash = createHash('sha256').update(await fs.readFile(image)).digest('hex');
    if (hash !== '5f726cb85bc8a209bb86946eee447d2624e55362738ade40fa16992298da82f1') throw Error('Mac runtime source release checksum mismatch.');
    await fs.mkdir(mount);
    run('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, image]);
    mounted = true;
    const archive = path.join(mount, 'MACxus.app/Contents/Resources/app.asar');
    const manifest = await verifyPackagedRuntimeDlls(archive);
    // Validate the complete input before replacing any local assets.
    for (const name of Object.keys(manifest.sha256)) {
      const temporary = path.join(directory, `${name}.tmp-${process.pid}`);
      try {
        await fs.writeFile(temporary, extractFile(archive, `assets/mac-runtime-dlls/${name}`));
        await fs.rename(temporary, path.join(directory, name));
      } finally { await fs.rm(temporary, { force: true }); }
    }
    await verifyRuntimeDllDirectory(directory);
    console.log(`Prepared Mac runtime DLLs for ${manifest.runtime}.`);
  } finally {
    // Do not remove a mountpoint if detaching failed.
    if (mounted) run('/usr/bin/hdiutil', ['detach', mount]);
    await fs.rm(work, { recursive: true, force: true });
  }
}
