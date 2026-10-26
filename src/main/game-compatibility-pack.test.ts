import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HALO_STORE_ID, haloMovieSettings, prepareGameCompatibilityPack, type CompatibilityPackDeps, type CompatibilityPackRequest } from './game-compatibility-pack.js';

const temporary: string[] = [];
const hash = (data: string) => createHash('sha256').update(data).digest('hex');
afterEach(async () => { await Promise.all(temporary.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'halo-pack-')); temporary.push(root);
  const app = path.join(root, 'Preview.app'), cxRoot = path.join(app, 'Contents/SharedSupport/CrossOver');
  const assets = path.join(root, 'assets'), data = path.join(root, 'data');
  await fs.mkdir(path.join(cxRoot, 'lib/wine/x86_64-windows'), { recursive: true });
  await fs.mkdir(path.join(cxRoot, 'lib/wine/x86_64-unix'), { recursive: true });
  await fs.mkdir(path.join(cxRoot, 'etc'), { recursive: true });
  await fs.writeFile(path.join(app, 'Contents/Info.plist'), 'fixture-plist');
  await fs.mkdir(path.join(assets, 'payload'), { recursive: true });
  await fs.writeFile(path.join(cxRoot, 'etc/CrossOver.conf'), '"BuildTag" = "tested-preview"\n');
  await fs.writeFile(path.join(cxRoot, 'lib/wine/x86_64-unix/winegstreamer.so'), 'unix-library');
  const names = ['mfplat.dll', 'winegstreamer.dll'];
  for (const name of names) {
    await fs.writeFile(path.join(cxRoot, 'lib/wine/x86_64-windows', name), `original-${name}`);
    await fs.writeFile(path.join(assets, 'payload', name), `patched-${name}`);
  }
  await fs.writeFile(path.join(assets, 'manifest.json'), JSON.stringify({ id: 'halo-preview-media-v1', storeId: HALO_STORE_ID, engine: 'crossover-preview', version: '20261015', buildTag: 'tested-preview', unixSHA256: hash('unix-library'), originalDLLs: Object.fromEntries(names.map(n => [n, hash(`original-${n}`)])), dlls: Object.fromEntries(names.map(n => [n, hash(`patched-${n}`)])) }));
  const calls: Array<[string, string[]]> = [];
  const deps: CompatibilityPackDeps = { assetRoot: assets, execute: async (command, args) => {
    calls.push([command, args]);
    if (command.endsWith('/ditto')) await fs.cp(args[3], args[4], { recursive: true });
    return { code: 0, output: '' };
  } };
  const request: CompatibilityPackRequest = { storeId: HALO_STORE_ID, engine: 'crossover-preview', installation: { root: cxRoot, wine: path.join(cxRoot, 'bin/wine'), wineserver: path.join(cxRoot, 'bin/wineserver'), cxbottle: path.join(cxRoot, 'bin/cxbottle'), version: '20261015' }, dataRoot: data, log: () => {} };
  return { root, app, cxRoot, assets, data, calls, deps, request };
}

describe('game compatibility packs', () => {
  it('does not inspect packs or touch engines for other games, stable CrossOver or FEX', async () => {
    const f = await fixture(); f.deps.assetRoot = '/does-not-exist';
    for (const changed of [{ storeId: 'another-game' }, { engine: 'crossover' }, { engine: 'crossover-preview-fex' }, { storeId: undefined }]) {
      expect(await prepareGameCompatibilityPack({ ...f.request, ...changed }, f.deps)).toBeUndefined();
    }
    expect(f.calls).toEqual([]); await expect(fs.stat(f.data)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('leaves unsupported Preview editions unchanged', async () => {
    const f = await fixture();
    for (const installation of [{ ...f.request.installation, version: 'future' }, { ...f.request.installation, supportsArm64: true }]) {
      expect(await prepareGameCompatibilityPack({ ...f.request, installation }, f.deps)).toBeUndefined();
    }
    await fs.writeFile(path.join(f.cxRoot, 'etc/CrossOver.conf'), '"BuildTag" = "different-build"\n');
    expect(await prepareGameCompatibilityPack(f.request, f.deps)).toBeUndefined(); expect(f.calls).toEqual([]);
  });
  it('rejects changed vendor DLLs and corrupt payload before copying or signing', async () => {
    const f = await fixture();
    const vendor = path.join(f.cxRoot, 'lib/wine/x86_64-windows/mfplat.dll');
    await fs.writeFile(vendor, 'corrupt');
    await expect(prepareGameCompatibilityPack(f.request, f.deps)).rejects.toThrow('checksum mismatch'); expect(f.calls).toEqual([]);
    await fs.writeFile(vendor, 'original-mfplat.dll');
    await fs.writeFile(path.join(f.assets, 'payload/winegstreamer.dll'), 'corrupt');
    await expect(prepareGameCompatibilityPack(f.request, f.deps)).rejects.toThrow('checksum mismatch'); expect(f.calls).toEqual([]);
  });
  it('allows an ordinary development checkout without generated payload to use normal Preview', async () => {
    const f = await fixture(); await fs.unlink(path.join(f.assets, 'payload/mfplat.dll'));
    expect(await prepareGameCompatibilityPack(f.request, f.deps)).toBeUndefined(); expect(f.calls).toEqual([]);
  });
  it('copies and signs a dedicated engine, reuses it and leaves originals unchanged', async () => {
    const f = await fixture();
    const [one, two] = await Promise.all([prepareGameCompatibilityPack(f.request, f.deps), prepareGameCompatibilityPack(f.request, f.deps)]);
    expect(one?.installation).toEqual(two?.installation); expect(one?.environment).toEqual({ MACXUS_MF_SOFTWARE_OUTPUT: '1' });
    expect(one?.installation.wine).toContain('compatibility-packs/halo-preview-media-v1/MACxus Halo Video.app/');
    expect(one?.bottlesRoot).toContain('compatibility-packs/halo-preview-media-v1/bottles');
    expect(f.calls.filter(([name]) => name.endsWith('/ditto'))).toHaveLength(1);
    expect(await fs.readFile(path.join(f.cxRoot, 'lib/wine/x86_64-windows/mfplat.dll'), 'utf8')).toBe('original-mfplat.dll');
    await prepareGameCompatibilityPack(f.request, f.deps);
    expect(f.calls.filter(([name]) => name.endsWith('/ditto'))).toHaveLength(1);
    const cloned = path.join(one!.installation.root, 'lib/wine/x86_64-windows/mfplat.dll');
    await fs.writeFile(cloned, 'corrupt');
    await expect(prepareGameCompatibilityPack(f.request, f.deps)).rejects.toThrow('checksum mismatch');
    expect(f.calls.filter(([name]) => name.endsWith('/ditto'))).toHaveLength(1);
  });
  it('breaks hard links before replacing DLLs', async () => {
    const f = await fixture(), execute = f.deps.execute;
    f.deps.execute = async (command, args) => {
      const result = await execute(command, args);
      if (command.endsWith('/ditto')) {
        const relative = 'Contents/SharedSupport/CrossOver/lib/wine/x86_64-windows/mfplat.dll';
        const target = path.join(args[4], relative); await fs.unlink(target); await fs.link(path.join(args[3], relative), target);
      }
      return result;
    };
    await prepareGameCompatibilityPack(f.request, f.deps);
    expect(await fs.readFile(path.join(f.cxRoot, 'lib/wine/x86_64-windows/mfplat.dll'), 'utf8')).toBe('original-mfplat.dll');
  });
  it('never activates a copy with failed signature validation and removes only its staging directory', async () => {
    const f = await fixture(), execute = f.deps.execute;
    f.deps.execute = (command, args) => args.includes('--strict') ? Promise.resolve({ code: 1, output: 'signature failed' }) : execute(command, args);
    await expect(prepareGameCompatibilityPack(f.request, f.deps)).rejects.toThrow('signature failed');
    expect(await fs.readdir(path.join(f.data, 'compatibility-packs/halo-preview-media-v1'))).toEqual([]);
    expect(await fs.readFile(path.join(f.cxRoot, 'lib/wine/x86_64-windows/mfplat.dll'), 'utf8')).toBe('original-mfplat.dll');
  });
  it('refuses a symlinked managed cache', async () => {
    const f = await fixture(); await fs.mkdir(f.data); await fs.symlink(f.root, path.join(f.data, 'compatibility-packs'));
    await expect(prepareGameCompatibilityPack(f.request, f.deps)).rejects.toThrow('symlinks'); expect(f.calls).toEqual([]);
  });
  it('rejects copied directory symlinks before replacing engine files', async () => {
    const f = await fixture(), execute = f.deps.execute;
    f.deps.execute = async (command, args) => {
      const result = await execute(command, args);
      if (command.endsWith('/ditto')) {
        const dir = path.join(args[4], 'Contents/SharedSupport/CrossOver/lib/wine/x86_64-windows');
        await fs.rm(dir, { recursive: true });
        await fs.symlink(path.join(f.cxRoot, 'lib/wine/x86_64-windows'), dir);
      }
      return result;
    };
    await expect(prepareGameCompatibilityPack(f.request, f.deps)).rejects.toThrow('symlinks');
    expect(await fs.readFile(path.join(f.cxRoot, 'lib/wine/x86_64-windows/mfplat.dll'), 'utf8')).toBe('original-mfplat.dll');
  });
  it('configures only its dedicated Halo bottle and preserves other INI settings', async () => {
    const f = await fixture(), pack = (await prepareGameCompatibilityPack(f.request, f.deps))!;
    await expect(pack.configurePrefix('/another/bottle')).rejects.toThrow('dedicated bottle');
    const prefix = path.join(pack.bottlesRoot, 'xbox');
    const dir = path.join(prefix, 'drive_c/users/crossover/AppData/Local/Meteorite/Saved/Config/WinGDK');
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, 'Engine.ini');
    await fs.writeFile(file, '[SystemSettings]\nExisting=42\nElectra.Win.H264UseOldOutputPath=0\n[Other]\nKeep=1\n');
    await pack.configurePrefix(prefix);
    const text = await fs.readFile(file, 'utf8'), stat = await fs.stat(file);
    expect(text).toContain('Existing=42'); expect(text).toContain('[Other]\nKeep=1');
    expect(text.match(/Electra.Win.H264UseOldOutputPath=/g)).toHaveLength(1); expect(text).toContain('Electra.Win.H264UseOldOutputPath=1');
    expect(stat.mode & 0o777).toBe(0o444);
    await pack.configurePrefix(prefix); expect((await fs.stat(file)).mtimeMs).toBe(stat.mtimeMs);
    await fs.chmod(file, 0o644); await fs.unlink(file); await fs.symlink(path.join(f.root, 'untouched'), file);
    await expect(pack.configurePrefix(prefix)).rejects.toThrow('Engine.ini');
    await expect(fs.stat(path.join(f.root, 'untouched'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('Halo Electra configuration', () => {
  it('is idempotent and handles CRLF and duplicate sections without touching other sections', () => {
    const text = '[systemsettings]\r\nElectra.Win.H265UseOldOutputPath=0\r\n[Other]\r\nValue=42\r\n[SystemSettings]\r\nElectra.Win.H264UseOldOutputPath=0\r\n';
    const result = haloMovieSettings(text);
    expect(haloMovieSettings(result)).toBe(result);
    expect(result.match(/H264UseOldOutputPath=/g)).toHaveLength(1);
    expect(result.match(/H265UseOldOutputPath=/g)).toHaveLength(1);
    expect(result).toContain('[Other]\nValue=42');
  });
});
