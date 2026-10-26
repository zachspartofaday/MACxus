import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CrossOverInstall } from './crossover.js';
import { run, type RunResult } from './process.js';

export const HALO_STORE_ID = '9N683TDT5M7R';
const PACK_ID = 'halo-preview-media-v1';
const DLLS = ['mfplat.dll', 'winegstreamer.dll'] as const;
const ASSET_ROOT = fileURLToPath(new URL(`../../assets/compatibility-packs/${PACK_ID}/`, import.meta.url));
const pending = new Map<string, Promise<CrossOverInstall>>();

interface Manifest {
  id: string; storeId: string; engine: string; version: string; buildTag: string;
  unixSHA256: string; originalDLLs: Record<string, string>; dlls: Record<string, string>;
}
export interface CompatibilityPackRequest {
  storeId?: string; engine: string; installation: CrossOverInstall; dataRoot: string;
  log: (line: string) => void;
}
export interface CompatibilityPack {
  installation: CrossOverInstall;
  bottlesRoot: string;
  environment: Record<string, string>;
  configurePrefix: (prefix: string) => Promise<void>;
}
export interface CompatibilityPackDeps {
  assetRoot: string;
  execute: (command: string, args: string[]) => Promise<RunResult>;
}
const defaultDeps: CompatibilityPackDeps = { assetRoot: ASSET_ROOT, execute: run };

async function plainDirectories(root: string, ...parts: string[]): Promise<void> {
  let current = root;
  for (const part of ['', ...parts]) {
    current = path.join(current, part);
    const stat = await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Compatibility engine directories must not be symlinks.');
  }
}

async function directory(root: string, ...parts: string[]): Promise<string> {
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    await fs.mkdir(current, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error; });
    const stat = await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Compatibility pack directories must not be symlinks.');
  }
  return current;
}
const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');
async function verifiedFile(file: string, expected: string): Promise<Buffer> {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024 * 1024) throw Error(`Invalid compatibility component: ${path.basename(file)}.`);
  const data = await fs.readFile(file);
  if (sha256(data) !== expected) throw Error(`Compatibility component checksum mismatch: ${path.basename(file)}.`);
  return data;
}
async function command(deps: CompatibilityPackDeps, name: string, args: string[]): Promise<void> {
  const result = await deps.execute(name, args);
  if (result.code !== 0) throw Error(`Halo compatibility engine preparation failed (${path.basename(name)}): ${result.output.trim().slice(-500)}`);
}
function engineAt(installation: CrossOverInstall, app: string): CrossOverInstall {
  const root = path.join(app, 'Contents/SharedSupport/CrossOver');
  return { ...installation, root, wine: path.join(root, 'bin/wine'), wineserver: path.join(root, 'bin', path.basename(installation.wineserver)), cxbottle: path.join(root, 'bin/cxbottle') };
}
async function validateEngine(app: string, manifest: Manifest, deps: CompatibilityPackDeps): Promise<void> {
  const stat = await fs.lstat(app);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Invalid compatibility engine directory.');
  await plainDirectories(app, 'Contents', 'SharedSupport', 'CrossOver', 'lib', 'wine', 'x86_64-windows');
  await plainDirectories(app, 'Contents', 'SharedSupport', 'CrossOver', 'lib', 'wine', 'x86_64-unix');
  const wine = path.join(app, 'Contents/SharedSupport/CrossOver/lib/wine');
  for (const name of DLLS) await verifiedFile(path.join(wine, 'x86_64-windows', name), manifest.dlls[name]);
  await verifiedFile(path.join(wine, 'x86_64-unix/winegstreamer.so'), manifest.unixSHA256);
  await command(deps, '/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
}
async function prepareEngine(request: CompatibilityPackRequest, manifest: Manifest, payload: Map<string, Buffer>, root: string, deps: CompatibilityPackDeps): Promise<CrossOverInstall> {
  const app = path.join(root, 'MACxus Halo Video.app');
  let exists = true;
  try {
    await fs.lstat(app);
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; exists = false; }
  if (exists) {
    // A damaged cache is an error, never permission to overwrite an unknown app.
    await validateEngine(app, manifest, deps);
    return engineAt(request.installation, app);
  }
  request.log('Preparing the Halo movie compatibility engine…');
  const original = path.resolve(request.installation.root, '../../..');
  if (!original.endsWith('.app')) throw Error('Halo compatibility requires a CrossOver application bundle.');
  await plainDirectories(original);
  // Finder metadata in some vendor bundles prevents strict resource checks;
  // verify their code, then strictly verify the freshly sealed private copy.
  await command(deps, '/usr/bin/codesign', ['--verify', '--deep', '--ignore-resources', original]);
  const staging = await fs.mkdtemp(path.join(root, '.prepare-'));
  const staged = path.join(staging, 'MACxus Halo Video.app');
  try {
    await command(deps, '/usr/bin/ditto', ['--noqtn', '--noextattr', '--norsrc', original, staged]);
    await plainDirectories(staged, 'Contents', 'SharedSupport', 'CrossOver', 'lib', 'wine', 'x86_64-windows');
    for (const name of DLLS) {
      const target = path.join(staged, 'Contents/SharedSupport/CrossOver/lib/wine/x86_64-windows', name);
      const stat = await fs.lstat(target);
      if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Unexpected compatibility DLL destination.');
      // Never modify a hard-linked copy of the installed engine.
      await fs.unlink(target);
      await fs.writeFile(target, payload.get(name)!, { flag: 'wx', mode: 0o644 });
    }
    const plist = path.join(staged, 'Contents/Info.plist');
    const plistBytes = await fs.readFile(plist);
    const plistStat = await fs.lstat(plist);
    if (!plistStat.isFile() || plistStat.isSymbolicLink()) throw Error('Invalid compatibility engine property list.');
    await fs.unlink(plist);
    await fs.writeFile(plist, plistBytes, { flag: 'wx', mode: 0o644 });
    for (const [key, value] of [['CFBundleIdentifier', `io.macxus.compat.${PACK_ID}`], ['CFBundleName', 'MACxus Halo Video']]) {
      await command(deps, '/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, plist]);
    }
    await command(deps, '/usr/bin/codesign', ['--force', '--sign', '-', '--timestamp=none', staged]);
    await validateEngine(staged, manifest, deps);
    await fs.rename(staged, app);
    return engineAt(request.installation, app);
  } finally { await fs.rm(staging, { recursive: true, force: true }); }
}

/** Source-engine and payload hashes are checked before copying or executing.
 * This pack is selected only for Halo + the exact tested Preview Rosetta build. */
export async function prepareGameCompatibilityPack(request: CompatibilityPackRequest, deps: CompatibilityPackDeps = defaultDeps): Promise<CompatibilityPack | undefined> {
  if (request.storeId?.toUpperCase() !== HALO_STORE_ID || request.engine !== 'crossover-preview') return undefined;
  const manifest = JSON.parse(await fs.readFile(path.join(deps.assetRoot, 'manifest.json'), 'utf8')) as Manifest;
  if (manifest.id !== PACK_ID || manifest.storeId !== HALO_STORE_ID || manifest.engine !== 'crossover-preview'
      || !/^[\w.-]+$/.test(manifest.buildTag) || !/^[a-f0-9]{64}$/.test(manifest.unixSHA256)
      || DLLS.some(name => !/^[a-f0-9]{64}$/.test(manifest.dlls?.[name]) || !/^[a-f0-9]{64}$/.test(manifest.originalDLLs?.[name]))) {
    throw Error('Invalid Halo compatibility pack manifest.');
  }
  const cx = request.installation;
  if (cx.version !== manifest.version || cx.supportsArm64) {
    request.log('Halo movie compatibility pack does not support this Preview version or architecture; using the selected engine.');
    return undefined;
  }
  const config = await fs.readFile(path.join(cx.root, 'etc/CrossOver.conf'), 'utf8');
  if (!config.split(/\r?\n/).some(line => line.trim() === `"BuildTag" = "${manifest.buildTag}"`)) {
    request.log('Halo movie compatibility pack does not match this Preview build; using the selected engine.');
    return undefined;
  }
  for (const name of DLLS) await verifiedFile(path.join(cx.root, 'lib/wine/x86_64-windows', name), manifest.originalDLLs[name]);
  await verifiedFile(path.join(cx.root, 'lib/wine/x86_64-unix/winegstreamer.so'), manifest.unixSHA256);
  const payload = new Map<string, Buffer>();
  for (const name of DLLS) {
    try { payload.set(name, await verifiedFile(path.join(deps.assetRoot, 'payload', name), manifest.dlls[name])); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      request.log('Halo movie compatibility pack payload is unavailable in this build; using the selected engine.');
      return undefined;
    }
  }
  await fs.mkdir(request.dataRoot, { recursive: true });
  const managed = await directory(request.dataRoot, 'compatibility-packs');
  const root = await directory(managed, PACK_ID);
  const key = path.resolve(root);
  let installation = pending.get(key);
  if (!installation) {
    installation = prepareEngine(request, manifest, payload, root, deps);
    pending.set(key, installation);
  }
  let prepared: CrossOverInstall;
  try { prepared = await installation; } finally { if (pending.get(key) === installation) pending.delete(key); }
  const bottlesRoot = await directory(root, 'bottles');
  request.log('Halo movie compatibility pack enabled for this game only.');
  return {
    installation: prepared, bottlesRoot, environment: { MACXUS_MF_SOFTWARE_OUTPUT: '1' },
    configurePrefix: async prefix => {
      if (path.resolve(prefix) !== path.join(bottlesRoot, 'xbox')) throw Error('Halo compatibility settings require the dedicated bottle.');
      const stat = await fs.lstat(prefix);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Invalid Halo compatibility bottle.');
      for (const configuration of ['Windows', 'WinGDK']) {
        const dir = await directory(prefix, 'drive_c', 'users', 'crossover', 'AppData', 'Local', 'Meteorite', 'Saved', 'Config', configuration);
        const ini = path.join(dir, 'Engine.ini');
        let before = '';
        try {
          const stat = await fs.lstat(ini);
          if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw Error('Invalid Halo Engine.ini.');
          before = await fs.readFile(ini, 'utf8');
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        const after = haloMovieSettings(before);
        if (after !== before) {
          const temp = await fs.mkdtemp(path.join(dir, '.halo-ini-'));
          try {
            const file = path.join(temp, 'Engine.ini');
            await fs.writeFile(file, after, { flag: 'wx', mode: 0o444 });
            await fs.rename(file, ini);
          } finally { await fs.rm(temp, { recursive: true, force: true }); }
        }
        await fs.chmod(ini, 0o444);
      }
    },
  };
}

export function haloMovieSettings(text: string): string {
  const settings = ['Electra.Win.H264UseOldOutputPath=1', 'Electra.Win.H265UseOldOutputPath=1'];
  const output: string[] = []; let system = false, found = false;
  for (const line of text.split(/\r?\n/)) {
    const section = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (section) {
      system = section[1].toLowerCase() === 'systemsettings';
      output.push(line);
      if (system && !found) { output.push(...settings); found = true; }
    } else if (!system || !/^\s*Electra\.Win\.H26[45]UseOldOutputPath\s*=/i.test(line)) output.push(line);
  }
  if (!found) output.push('', '[SystemSettings]', ...settings);
  return output.join('\n').replace(/\n*$/, '\n');
}
