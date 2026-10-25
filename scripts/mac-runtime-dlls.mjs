import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { extractFile } from '@electron/asar';

const names = ['gamingtcui.dll', 'twinapi.appcore.dll', 'windows.web.dll', 'winhttp.dll', 'xgameruntime.dll'];
export const runtimeManifestPath = new URL('../assets/mac-runtime-dlls/manifest.json', import.meta.url);

export async function verifyRuntimeDlls(read, expected) {
  expected ??= JSON.parse(await fs.readFile(runtimeManifestPath, 'utf8'));
  const manifest = JSON.parse(await read('manifest.json'));
  if (typeof expected.runtime !== 'string' || !expected.runtime || manifest.runtime !== expected.runtime ||
      JSON.stringify(Object.keys(manifest.sha256 ?? {}).sort()) !== JSON.stringify(names) ||
      JSON.stringify(Object.keys(expected.sha256 ?? {}).sort()) !== JSON.stringify(names)) {
    throw Error('Invalid Mac runtime DLL manifest.');
  }
  for (const name of names) {
    const hash = expected.sha256[name];
    if (!/^[a-f\d]{64}$/.test(hash) || manifest.sha256[name] !== hash) throw Error(`Invalid Mac runtime DLL hash: ${name}`);
    let bytes;
    try { bytes = await read(name); }
    catch { throw Error(`Missing Mac runtime DLL: ${name}. Run npm run prepare:mac-runtime-dlls.`); }
    if (createHash('sha256').update(bytes).digest('hex') !== hash) throw Error(`Corrupt Mac runtime DLL: ${name}`);
  }
  return manifest;
}

export function verifyPackagedRuntimeDlls(archive) {
  return verifyRuntimeDlls(name => extractFile(archive, `assets/mac-runtime-dlls/${name}`));
}

export function verifyRuntimeDllDirectory(directory) {
  return verifyRuntimeDlls(name => fs.readFile(path.join(directory, name)));
}
