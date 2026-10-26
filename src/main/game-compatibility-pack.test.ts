import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { updateIniSettings, prepareGameCompatibilityPack, type CompatibilityPackDeps, type CompatibilityPackRequest } from './game-compatibility-pack.js';
import { prepareMacRunner, type MacRunnerDeps } from './mac-engine.js';

const HALO_STORE_ID = '9N683TDT5M7R';
const haloValues = { 'Electra.Win.H264UseOldOutputPath': '1', 'Electra.Win.H265UseOldOutputPath': '1' };
const haloMovieSettings = (text: string) => updateIniSettings(text, 'SystemSettings', haloValues);
const temporary: string[] = [];
const hash = (data: string) => createHash('sha256').update(data).digest('hex');
afterEach(async () => { await Promise.all(temporary.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'halo-pack-')); temporary.push(root);
  const app = path.join(root, 'Preview.app'), cxRoot = path.join(app, 'Contents/SharedSupport/CrossOver');
  const catalogRoot = path.join(root, 'assets');
  const assets = path.join(catalogRoot, 'halo-preview-media-v1'), data = path.join(root, 'data');
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
  const manifest = JSON.parse(await fs.readFile(new URL('../../assets/compatibility-packs/halo-preview-media-v1/manifest.json', import.meta.url), 'utf8'));
  Object.assign(manifest, { buildTag: 'tested-preview', unixLibraries: { 'winegstreamer.so': hash('unix-library') }, originalDLLs: Object.fromEntries(names.map(n => [n, hash(`original-${n}`)])), dlls: Object.fromEntries(names.map(n => [n, hash(`patched-${n}`)])) });
  await fs.writeFile(path.join(assets, 'manifest.json'), JSON.stringify(manifest));
  const route = Object.fromEntries(['id', 'storeId', 'engine', 'version', 'buildTag'].map(key => [key, manifest[key]]));
  await fs.writeFile(path.join(catalogRoot, 'catalog.json'), JSON.stringify({ schemaVersion: 1, packs: [route] }));
  const calls: Array<[string, string[]]> = [];
  const deps: CompatibilityPackDeps = { assetRoot: catalogRoot, execute: async (command, args) => {
    calls.push([command, args]);
    if (command.endsWith('/ditto')) await fs.cp(args[3], args[4], { recursive: true });
    return { code: 0, output: '' };
  } };
  const request: CompatibilityPackRequest = { storeId: HALO_STORE_ID, engine: 'crossover-preview', installation: { root: cxRoot, wine: path.join(cxRoot, 'bin/wine'), wineserver: path.join(cxRoot, 'bin/wineserver'), cxbottle: path.join(cxRoot, 'bin/cxbottle'), version: '20261015' }, dataRoot: data, log: () => {} };
  return { root, app, cxRoot, catalogRoot, assets, data, calls, deps, request };
}

async function setupPipeline(f: Awaited<ReturnType<typeof fixture>>, pack: NonNullable<Awaited<ReturnType<typeof prepareGameCompatibilityPack>>>, setup: MacRunnerDeps['prepareCrossOver']) {
  return prepareMacRunner({ setting: 'crossover-preview', storeId: HALO_STORE_ID, dataRoot: f.data, runtimeDllDir: '/dlls', log: () => {} }, {
    findCrossOver: async () => undefined, findCrossOverPreview: async () => f.request.installation,
    highballInstalled: () => undefined, profiles: async () => ({}),
    prepareHighball: async () => { throw Error('Unexpected engine'); },
    prepareCompatibility: async () => pack, prepareCrossOver: setup,
  });
}

describe('game compatibility packs', () => {
  it('does not inspect unrelated manifests or touch engines for other games, stable CrossOver or FEX', async () => {
    const f = await fixture(); await fs.writeFile(path.join(f.assets, 'manifest.json'), 'broken unrelated manifest');
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
    expect(one?.installation.wine).toContain('compatibility-packs/halo-preview-media-v1/verified-engine-v2/MACxus Halo Video.app/');
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
    expect(await fs.readdir(path.join(f.data, 'compatibility-packs/halo-preview-media-v1/verified-engine-v2'))).toEqual([]);
    expect(await fs.readFile(path.join(f.cxRoot, 'lib/wine/x86_64-windows/mfplat.dll'), 'utf8')).toBe('original-mfplat.dll');
  });
  it('checks the vendor resource seal before replacement or resealing can hide a modified resource', async () => {
    const f = await fixture(), execute = f.deps.execute;
    await fs.mkdir(path.join(f.app, 'Contents/Resources'));
    await fs.writeFile(path.join(f.app, 'Contents/Resources/vendor.txt'), 'modified sealed resource');
    let resealed = false;
    f.deps.execute = async (command, args) => {
      const result = await execute(command, args);
      if (command.endsWith('/codesign') && args.includes('--force')) resealed = true;
      if (command.endsWith('/codesign') && args.includes('--strict') && !resealed) {
        // A strict check against the original signature rejects the resource.
        // Re-signing first would accept it, reproducing the former bug.
        expect(await fs.readFile(path.join(args.at(-1)!, 'Contents/SharedSupport/CrossOver/lib/wine/x86_64-windows/mfplat.dll'), 'utf8')).toBe('original-mfplat.dll');
        return { code: 1, output: 'a sealed resource is missing or invalid' };
      }
      return result;
    };
    await expect(prepareGameCompatibilityPack(f.request, f.deps)).rejects.toThrow('sealed resource');
    expect(resealed).toBe(false);
    expect(f.calls.some(([name]) => name.endsWith('/PlistBuddy'))).toBe(false);
    expect(await fs.readFile(path.join(f.cxRoot, 'lib/wine/x86_64-windows/mfplat.dll'), 'utf8')).toBe('original-mfplat.dll');
  });
  it('ignores engines created under the previous resource verification policy without removing their bottle', async () => {
    const f = await fixture();
    const legacy = path.join(f.data, 'compatibility-packs/halo-preview-media-v1/MACxus Halo Video.app');
    await fs.mkdir(path.dirname(legacy), { recursive: true }); await fs.cp(f.app, legacy, { recursive: true });
    for (const name of ['mfplat.dll', 'winegstreamer.dll']) await fs.writeFile(path.join(legacy, 'Contents/SharedSupport/CrossOver/lib/wine/x86_64-windows', name), `patched-${name}`);
    const prefix = path.join(path.dirname(legacy), 'bottles/xbox'); await fs.mkdir(prefix, { recursive: true }); await fs.writeFile(path.join(prefix, 'keep.txt'), 'existing game data');
    const pack = (await prepareGameCompatibilityPack(f.request, f.deps))!;
    expect(pack.installation.root).toContain('verified-engine-v2');
    expect(f.calls.filter(([name]) => name.endsWith('/ditto'))).toHaveLength(1);
    expect(await fs.readFile(path.join(prefix, 'keep.txt'), 'utf8')).toBe('existing game data');
    expect((await fs.stat(legacy)).isDirectory()).toBe(true);
  });
  it.each(['prefix', 'drive_c', 'windows', 'system32', 'user.reg', 'registry-hardlink', 'c-drive'])('rejects linked %s before either engine can write through it', async kind => {
    const f = await fixture(), pack = (await prepareGameCompatibilityPack(f.request, f.deps))!;
    const prefix = path.join(pack.bottlesRoot, 'xbox'), outside = path.join(f.root, 'another-bottle');
    await fs.mkdir(path.join(outside, 'drive_c/windows/system32'), { recursive: true });
    await fs.writeFile(path.join(outside, 'system.reg'), 'keep registry'); await fs.writeFile(path.join(outside, 'user.reg'), 'keep user registry');
    await fs.writeFile(path.join(outside, 'drive_c/windows/system32/winhttp.dll'), 'keep DLL');
    if (kind === 'prefix') await fs.symlink(outside, prefix);
    else {
      await fs.mkdir(path.join(prefix, 'drive_c/windows/system32'), { recursive: true });
      if (['drive_c', 'windows', 'system32'].includes(kind)) {
        const relative = kind === 'drive_c' ? 'drive_c' : kind === 'windows' ? 'drive_c/windows' : 'drive_c/windows/system32';
        const target = path.join(prefix, relative); await fs.rm(target, { recursive: true }); await fs.symlink(path.join(outside, relative), target);
      } else if (kind === 'user.reg') await fs.symlink(path.join(outside, 'user.reg'), path.join(prefix, 'user.reg'));
      else if (kind === 'registry-hardlink') await fs.link(path.join(outside, 'user.reg'), path.join(prefix, 'user.reg'));
      else { await fs.mkdir(path.join(prefix, 'dosdevices')); await fs.symlink(path.join(outside, 'drive_c'), path.join(prefix, 'dosdevices/c:')); }
    }
    let setups = 0;
    await expect(setupPipeline(f, pack, async () => {
      setups++;
      // Model the first writes made by normal bottle setup.
      await fs.writeFile(path.join(prefix, 'drive_c/windows/system32/winhttp.dll'), 'changed DLL');
      await fs.writeFile(path.join(prefix, 'user.reg'), 'changed registry');
      return { command: '/runner', compatibilityDataPath: prefix };
    })).rejects.toThrow(/symlinks|links|own drive_c/);
    expect(setups).toBe(0);
    expect(await fs.readFile(path.join(outside, 'user.reg'), 'utf8')).toBe('keep user registry');
    expect(await fs.readFile(path.join(outside, 'drive_c/windows/system32/winhttp.dll'), 'utf8')).toBe('keep DLL');
  });
  it('rechecks setup paths after stock initialization and before patched-engine setup', async () => {
    const f = await fixture(), pack = (await prepareGameCompatibilityPack(f.request, f.deps))!;
    const prefix = path.join(pack.bottlesRoot, 'xbox'), outside = path.join(f.root, 'outside'); await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'winhttp.dll'), 'keep DLL'); let setups = 0;
    await expect(setupPipeline(f, pack, async () => {
      setups++;
      if (setups === 1) {
        await fs.mkdir(path.join(prefix, 'drive_c/windows'), { recursive: true });
        await fs.symlink(outside, path.join(prefix, 'drive_c/windows/system32'));
      } else await fs.writeFile(path.join(prefix, 'drive_c/windows/system32/winhttp.dll'), 'changed DLL');
      return { command: '/runner', compatibilityDataPath: prefix };
    })).rejects.toThrow('symlinks');
    expect(setups).toBe(1); expect(await fs.readFile(path.join(outside, 'winhttp.dll'), 'utf8')).toBe('keep DLL');
  });
  it('accepts first boot and ordinary Wine C:/Z: links in an existing dedicated bottle', async () => {
    const f = await fixture(), pack = (await prepareGameCompatibilityPack(f.request, f.deps))!;
    const prefix = path.join(pack.bottlesRoot, 'xbox'); await pack.validatePrefix(prefix);
    await fs.mkdir(path.join(prefix, 'dosdevices'), { recursive: true }); await fs.mkdir(path.join(prefix, 'drive_c/windows/system32'), { recursive: true });
    await fs.symlink('../drive_c', path.join(prefix, 'dosdevices/c:')); await fs.symlink('/', path.join(prefix, 'dosdevices/z:'));
    await fs.writeFile(path.join(prefix, 'system.reg'), 'own registry'); await pack.validatePrefix(prefix);
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

describe('catalog-driven game isolation', () => {
  async function addSecond(f: Awaited<ReturnType<typeof fixture>>) {
    const manifest = JSON.parse(await fs.readFile(path.join(f.assets, 'manifest.json'), 'utf8'));
    Object.assign(manifest, { id: 'synthetic-second-v1', storeId: '222222222222', name: 'Synthetic second game', appName: 'MACxus Second Game.app', engineDirectory: 'verified-engine-v1',
      dlls: { 'other.dll': hash('patched-other') }, originalDLLs: { 'other.dll': hash('original-other') }, buildTimestamps: { 'other.dll': 42 },
      environment: { MACXUS_SECOND_GAME: '1' }, configuration: [{ kind: 'unreal-ini', project: 'DifferentProject', platform: 'Windows', file: 'Game.ini', section: 'GameSettings', values: { SecondGameOption: '42' }, readOnly: false }] });
    const assets = path.join(f.catalogRoot, manifest.id);
    await fs.mkdir(path.join(assets, 'payload'), { recursive: true });
    await fs.writeFile(path.join(assets, 'manifest.json'), JSON.stringify(manifest));
    await fs.writeFile(path.join(assets, 'payload/other.dll'), 'patched-other');
    await fs.writeFile(path.join(f.cxRoot, 'lib/wine/x86_64-windows/other.dll'), 'original-other');
    const catalog = JSON.parse(await fs.readFile(path.join(f.catalogRoot, 'catalog.json'), 'utf8'));
    catalog.packs.push(Object.fromEntries(['id', 'storeId', 'engine', 'version', 'buildTag'].map(key => [key, manifest[key]])));
    await fs.writeFile(path.join(f.catalogRoot, 'catalog.json'), JSON.stringify(catalog));
    return { ...f.request, storeId: manifest.storeId };
  }
  it('routes two games to independent DLLs, bottles, environment and configuration without launch-code changes', async () => {
    const f = await fixture(), secondRequest = await addSecond(f);
    const [halo, second] = await Promise.all([prepareGameCompatibilityPack(f.request, f.deps), prepareGameCompatibilityPack(secondRequest, f.deps)]);
    expect(halo!.bottlesRoot).not.toBe(second!.bottlesRoot);
    expect(second!.installation.root).toContain('synthetic-second-v1/verified-engine-v1/MACxus Second Game.app');
    expect(second!.environment).toEqual({ MACXUS_SECOND_GAME: '1' });
    expect(halo!.environment).toEqual({ MACXUS_MF_SOFTWARE_OUTPUT: '1' });
    for (const pack of [halo!, second!]) { await fs.mkdir(path.join(pack.bottlesRoot, 'xbox')); await pack.configurePrefix(path.join(pack.bottlesRoot, 'xbox')); }
    const secondIni = path.join(second!.bottlesRoot, 'xbox/drive_c/users/crossover/AppData/Local/DifferentProject/Saved/Config/Windows/Game.ini');
    expect(await fs.readFile(secondIni, 'utf8')).toContain('[GameSettings]\nSecondGameOption=42');
    expect((await fs.stat(secondIni)).mode & 0o777).toBe(0o644);
    await expect(fs.stat(path.join(second!.bottlesRoot, 'xbox/drive_c/users/crossover/AppData/Local/Meteorite'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(path.join(second!.installation.root, 'lib/wine/x86_64-windows/other.dll'), 'utf8')).toBe('patched-other');
    expect(await fs.readFile(path.join(halo!.installation.root, 'lib/wine/x86_64-windows/other.dll'), 'utf8')).toBe('original-other');
    await expect(second!.configurePrefix(path.join(halo!.bottlesRoot, 'xbox'))).rejects.toThrow('dedicated bottle');
    expect(await fs.readFile(path.join(f.cxRoot, 'lib/wine/x86_64-windows/other.dll'), 'utf8')).toBe('original-other');
  });
  it('does not read a broken unrelated manifest, but refuses a broken selected one before copying', async () => {
    const f = await fixture(), secondRequest = await addSecond(f);
    await fs.writeFile(path.join(f.catalogRoot, 'synthetic-second-v1/manifest.json'), '{bad');
    await expect(prepareGameCompatibilityPack(secondRequest, f.deps)).rejects.toThrow();
    expect(f.calls).toEqual([]);
    expect(await prepareGameCompatibilityPack(f.request, f.deps)).toBeDefined();
  });
  it('also supports a registered stable CrossOver overlay, without applying the Preview pack', async () => {
    const f = await fixture(), request = await addSecond(f);
    const file = path.join(f.catalogRoot, 'synthetic-second-v1/manifest.json');
    const manifest = JSON.parse(await fs.readFile(file, 'utf8')); manifest.engine = 'crossover';
    await fs.writeFile(file, JSON.stringify(manifest));
    const catalogFile = path.join(f.catalogRoot, 'catalog.json'), catalog = JSON.parse(await fs.readFile(catalogFile, 'utf8'));
    catalog.packs[1].engine = 'crossover'; await fs.writeFile(catalogFile, JSON.stringify(catalog));
    expect(await prepareGameCompatibilityPack(request, f.deps)).toBeUndefined();
    const pack = await prepareGameCompatibilityPack({ ...request, engine: 'crossover' }, f.deps);
    expect(pack!.environment).toEqual({ MACXUS_SECOND_GAME: '1' });
    expect(await prepareGameCompatibilityPack({ ...f.request, engine: 'crossover' }, f.deps)).toBeUndefined();
  });
  it('rejects catalog ambiguity and selected manifest misrouting before executing commands', async () => {
    const f = await fixture(), file = path.join(f.catalogRoot, 'catalog.json');
    const catalog = JSON.parse(await fs.readFile(file, 'utf8'));
    catalog.packs.push({ ...catalog.packs[0], id: 'ambiguous-v1' });
    await fs.writeFile(file, JSON.stringify(catalog));
    await expect(prepareGameCompatibilityPack(f.request, f.deps)).rejects.toThrow('ambiguous');
    catalog.packs.pop(); await fs.writeFile(file, JSON.stringify(catalog));
    const manifest = JSON.parse(await fs.readFile(path.join(f.assets, 'manifest.json'), 'utf8')); manifest.storeId = '333333333333';
    await fs.writeFile(path.join(f.assets, 'manifest.json'), JSON.stringify(manifest));
    await expect(prepareGameCompatibilityPack(f.request, f.deps)).rejects.toThrow('manifest/catalog mismatch');
    expect(f.calls).toEqual([]);
  });
  it('validates a second game configuration destination before setup and refuses hard-linked INI files', async () => {
    const f = await fixture(), secondRequest = await addSecond(f), pack = (await prepareGameCompatibilityPack(secondRequest, f.deps))!;
    const prefix = path.join(pack.bottlesRoot, 'xbox'), local = path.join(prefix, 'drive_c/users/crossover/AppData/Local');
    const outside = path.join(f.root, 'other-config'); await fs.mkdir(outside);
    await fs.mkdir(local, { recursive: true }); await fs.symlink(outside, path.join(local, 'DifferentProject'));
    await expect(pack.validatePrefix(prefix)).rejects.toThrow('symlinks');
    await fs.unlink(path.join(local, 'DifferentProject'));
    const config = path.join(local, 'DifferentProject/Saved/Config/Windows'); await fs.mkdir(config, { recursive: true });
    const external = path.join(outside, 'Game.ini'); await fs.writeFile(external, 'Keep=1');
    await fs.link(external, path.join(config, 'Game.ini'));
    await expect(pack.configurePrefix(prefix)).rejects.toThrow('links');
    expect(await fs.readFile(external, 'utf8')).toBe('Keep=1'); expect((await fs.stat(external)).mode & 0o777).toBe(0o644);
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
