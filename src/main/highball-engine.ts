import { createHash } from 'node:crypto';
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureRuntimeOverrides, installRuntimeDlls, shellQuote, writeRunnerScript, type RuntimeDllSource } from './crossover.js';
import { run } from './process.js';
import type { ProtonRunner } from './proton.js';

// Highball engine: Wine built from CrossOver 26.3 sources plus patches (LGPL-2.1),
// github.com/gauthierpiarrette/highball-engine. The release is pinned: tag, size
// and SHA-256 are fixed here and the published .sha256 asset must agree.
export const HIGHBALL_ENGINE_TAG = 'engine-wine-11.0-20261014T003801Z-0024-app-packages-0023-spatial-mixer';
export const HIGHBALL_ENGINE_ASSET = `${HIGHBALL_ENGINE_TAG}.tar.gz`;
export const HIGHBALL_ENGINE_SHA256_ASSET = `${HIGHBALL_ENGINE_ASSET}.sha256`;
export const HIGHBALL_ENGINE_SIZE = 334_884_359;
export const HIGHBALL_ENGINE_SHA256 = '1d1a130c0108a4bbb88cd289c3c313292868c3b84010eb315801eba43026e3e8';

/**
 * Runtime libraries the engine's host modules link against (GLib/GStreamer with
 * plugins, GnuTLS, ...), which Highball installs into <engine>/frameworks from the
 * same pinned archive as its x64 CrossOver 26.3 engine manifests.
 */
export interface HighballFrameworks {
  url: string;
  size: number;
  sha256: string;
  /** Folder inside the archive whose contents become <engine>/frameworks. */
  subpath: string;
}

export const HIGHBALL_FRAMEWORKS: HighballFrameworks = {
  url: 'https://github.com/Sikarugir-App/Wrapper/releases/download/v1.0/Template-1.0.11.tar.xz',
  size: 84_533_420,
  sha256: '9fa15479e7ff6abd99c1d07be285fb95f41fc6991586502427152b1f7d6ccb8a',
  subpath: 'Template-1.0.11.app/Contents/Frameworks',
};

export interface HighballRelease {
  tag: string;
  asset: string;
  sha256Asset: string;
  size: number;
  sha256: string;
  baseUrl: string;
  frameworks?: HighballFrameworks;
}

export const HIGHBALL_ENGINE_RELEASE: HighballRelease = {
  tag: HIGHBALL_ENGINE_TAG,
  asset: HIGHBALL_ENGINE_ASSET,
  sha256Asset: HIGHBALL_ENGINE_SHA256_ASSET,
  size: HIGHBALL_ENGINE_SIZE,
  sha256: HIGHBALL_ENGINE_SHA256,
  baseUrl: `https://github.com/gauthierpiarrette/highball-engine/releases/download/${HIGHBALL_ENGINE_TAG}`,
  frameworks: HIGHBALL_FRAMEWORKS,
};

export type Fetcher = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

const PREFIX = 'xbox-highball';
const RUNNER = 'xodus-highball-wine';
const REQUIRED_FILES = ['engine/bin/wine', 'engine/bin/wineserver', 'engine/lib/wine/x86_64-windows/kernelbase.dll'];
const FRAMEWORKS_MARKER = 'GStreamer.framework/Versions/1.0/lib/libgstreamer-1.0.0.dylib';
/** Same rules as the per-game profile values: they are embedded in a shell script. */
const SAFE_ENV_KEY = /^[A-Z_][A-Z0-9_]*$/;
const SAFE_ENV_VALUE = /^[\w .:+-]{1,64}$/;

function enginesDirectory(dataRoot: string): string {
  return path.join(dataRoot, 'engines', 'highball');
}

export function highballEngineDirectory(dataRoot: string, release: HighballRelease = HIGHBALL_ENGINE_RELEASE): string {
  return path.join(enginesDirectory(dataRoot), release.tag);
}

function layoutComplete(root: string): boolean {
  return REQUIRED_FILES.every((file) => existsSync(path.join(root, file)));
}

function frameworksComplete(root: string, release: HighballRelease): boolean {
  return !release.frameworks || existsSync(path.join(root, 'frameworks', FRAMEWORKS_MARKER));
}

/** The engine root (holding engine/bin/wine) when the pinned engine and its frameworks are fully installed. */
export function highballEngineInstalled(dataRoot: string, release: HighballRelease = HIGHBALL_ENGINE_RELEASE): string | undefined {
  const root = highballEngineDirectory(dataRoot, release);
  return layoutComplete(root) && frameworksComplete(root, release) ? root : undefined;
}

function unsafeEntry(entry: string): boolean {
  if (!entry) return false;
  if (path.isAbsolute(entry)) return true;
  return entry.split('/').includes('..');
}

/** Streams url into a new file, enforcing the pinned size and SHA-256. */
async function downloadVerified(
  url: string,
  size: number,
  sha256: string,
  file: string,
  label: string,
  fetcher: Fetcher,
  onProgress?: (downloaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetcher(url, { signal });
  if (!response.ok || !response.body) throw new Error(`Download ${label} non riuscito (HTTP ${response.status}).`);
  const handle = await fs.open(file, 'wx', 0o600);
  try {
    const hash = createHash('sha256');
    let downloaded = 0;
    for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
      downloaded += chunk.length;
      if (downloaded > size) throw new Error(`Il download ${label} ha una dimensione inattesa (oltre ${size} byte).`);
      let offset = 0;
      while (offset < chunk.length) {
        const { bytesWritten } = await handle.write(chunk, offset, chunk.length - offset);
        if (bytesWritten === 0) throw new Error(`Il download ${label} ha smesso di scrivere sul disco.`);
        offset += bytesWritten;
      }
      hash.update(chunk);
      onProgress?.(downloaded, size);
    }
    if (downloaded !== size) throw new Error(`Il download ${label} ha una dimensione inattesa (${downloaded} byte invece di ${size}).`);
    if (hash.digest('hex') !== sha256) throw new Error(`Verifica SHA-256 ${label} non riuscita: il file scaricato è stato scartato.`);
  } finally {
    await handle.close();
  }
}

/** Lists the archive with the system tar and refuses absolute or parent-relative entries. */
async function checkArchiveEntries(archive: string, label: string): Promise<void> {
  const listing = await run('tar', ['-tf', archive], { maxOutput: 64_000_000 });
  if (listing.code !== 0) throw new Error(`Lettura dell'archivio ${label} non riuscita (codice ${listing.code}).`);
  if (listing.output.split('\n').map((line) => line.trim()).some(unsafeEntry)) throw new Error(`L'archivio ${label} contiene percorsi non sicuri: installazione annullata.`);
}

/**
 * Downloads the pinned engine to a temporary file, verifies size and SHA-256
 * (pinned and published), extracts it with the system tar into a staging folder
 * and renames that folder into place, then adds the pinned runtime frameworks
 * when they are missing. Nothing from a download is executed before it is verified.
 */
export async function installHighballEngine(
  dataRoot: string,
  fetcher: Fetcher = fetch,
  onProgress?: (downloaded: number, total: number) => void,
  release: HighballRelease = HIGHBALL_ENGINE_RELEASE,
  signal?: AbortSignal,
): Promise<string> {
  const installed = highballEngineInstalled(dataRoot, release);
  if (installed) return installed;
  const destination = highballEngineDirectory(dataRoot, release);
  if (!layoutComplete(destination)) await installEngine(dataRoot, destination, fetcher, onProgress, release, signal);
  if (release.frameworks && !frameworksComplete(destination, release)) {
    await installFrameworks(dataRoot, destination, release.frameworks, fetcher, onProgress, signal);
  }
  return destination;
}

async function installEngine(
  dataRoot: string,
  destination: string,
  fetcher: Fetcher,
  onProgress: ((downloaded: number, total: number) => void) | undefined,
  release: HighballRelease,
  signal?: AbortSignal,
): Promise<void> {
  const engines = enginesDirectory(dataRoot);
  await fs.mkdir(engines, { recursive: true, mode: 0o700 });
  const suffix = `${process.pid}-${Date.now()}`;
  const temporary = path.join(engines, `.download-${suffix}.tar.gz`);
  const staging = path.join(engines, `.staging-${suffix}`);
  try {
    const checksumResponse = await fetcher(`${release.baseUrl}/${release.sha256Asset}`, { signal });
    if (!checksumResponse.ok) throw new Error(`Download del motore Highball non riuscito (HTTP ${checksumResponse.status} sul file .sha256).`);
    const published = (await checksumResponse.text()).trim().split(/\s+/)[0]?.toLowerCase() ?? '';
    if (!/^[0-9a-f]{64}$/.test(published) || published !== release.sha256) {
      throw new Error('Il checksum pubblicato del motore Highball non corrisponde a quello atteso: download interrotto.');
    }

    await downloadVerified(`${release.baseUrl}/${release.asset}`, release.size, release.sha256, temporary, 'del motore Highball', fetcher, onProgress, signal);
    await checkArchiveEntries(temporary, 'del motore Highball');

    await fs.mkdir(staging, { mode: 0o700 });
    const extracted = await run('tar', ['-xzf', temporary, '-C', staging]);
    if (extracted.code !== 0) throw new Error(`Estrazione del motore Highball non riuscita (codice ${extracted.code}).`);
    if (!layoutComplete(staging)) throw new Error(`L'archivio del motore Highball è incompleto (servono ${REQUIRED_FILES.join(', ')}).`);
    try { await fs.rename(staging, destination); }
    catch (error) {
      // Another install finished first: keep it.
      if (!layoutComplete(destination)) throw error;
    }
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
    await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Extracts only the archive's frameworks folder and swaps it in as <engine>/frameworks. */
async function installFrameworks(
  dataRoot: string,
  destination: string,
  frameworks: HighballFrameworks,
  fetcher: Fetcher,
  onProgress: ((downloaded: number, total: number) => void) | undefined,
  signal?: AbortSignal,
): Promise<void> {
  const engines = enginesDirectory(dataRoot);
  const suffix = `${process.pid}-${Date.now()}`;
  const temporary = path.join(engines, `.download-${suffix}.tar.xz`);
  const staging = path.join(engines, `.staging-${suffix}`);
  const label = 'delle librerie del motore Highball';
  try {
    await downloadVerified(frameworks.url, frameworks.size, frameworks.sha256, temporary, label, fetcher, onProgress, signal);
    await checkArchiveEntries(temporary, label);

    await fs.mkdir(staging, { mode: 0o700 });
    const extracted = await run('tar', ['-xJf', temporary, '-C', staging, frameworks.subpath]);
    if (extracted.code !== 0) throw new Error(`Estrazione ${label} non riuscita (codice ${extracted.code}).`);
    const source = path.join(staging, frameworks.subpath);
    if (!existsSync(path.join(source, FRAMEWORKS_MARKER))) throw new Error(`L'archivio ${label} è incompleto (manca ${FRAMEWORKS_MARKER}).`);
    const target = path.join(destination, 'frameworks');
    // The engine tarball ships an empty frameworks folder; anything else left there is incomplete.
    await fs.rm(target, { recursive: true, force: true });
    await fs.rename(source, target);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
    await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }
}

function safeEnvironment(extraEnv: Record<string, string>): [string, string][] {
  return Object.entries(extraEnv).filter(([key, value]) => SAFE_ENV_KEY.test(key) && typeof value === 'string' && SAFE_ENV_VALUE.test(value));
}

/**
 * Wrapper that runs the Highball wine on its own prefix with CrossOver's D3DMetal
 * (WINEDLLPATH_PREPEND, CX_D3DMETALPATH, DYLD fallback paths). msync defaults on;
 * WINEMSYNC/WINEESYNC and profile values only apply when not already set.
 */
export function highballWrapperScript(engineRoot: string, appleGptkRoot: string, crossOverLib64: string, prefix: string, extraEnv: Record<string, string>, d3d12Shim?: D3D12Shim): string {
  const wine = shellQuote(path.join(engineRoot, 'engine', 'bin', 'wine'));
  const wineserver = shellQuote(path.join(engineRoot, 'engine', 'bin', 'wineserver'));
  const externalDir = path.join(appleGptkRoot, 'external');
  const external = shellQuote(externalDir);
  // The engine's runtime frameworks (GLib/GStreamer and friends, as Highball installs them)
  // come before CrossOver's lib64, whose GLib is too old for the engine's winegstreamer;
  // D3DMetal stays first and the dyld defaults are kept after ours.
  const frameworksDir = path.join(engineRoot, 'frameworks');
  const gstreamerLib = path.join(frameworksDir, 'GStreamer.framework', 'Versions', '1.0', 'lib');
  const libraryPath = shellQuote(`${externalDir}:${frameworksDir}:${gstreamerLib}:${crossOverLib64}:`);
  const frameworkPath = shellQuote(`${externalDir}:${frameworksDir}:`);
  const defaults = Object.fromEntries(safeEnvironment({ WINEMSYNC: '1', WINEESYNC: '0', ROSETTA_ADVERTISE_AVX: '1', ...extraEnv }));
  return [
    '#!/bin/sh',
    `export WINEPREFIX=${shellQuote(prefix)}`,
    `export WINEDLLPATH_PREPEND=${shellQuote(path.join(appleGptkRoot, 'wine'))}`,
    `export CX_D3DMETALPATH=${external}`,
    `export DYLD_FALLBACK_LIBRARY_PATH=${libraryPath}"\${DYLD_FALLBACK_LIBRARY_PATH:-/usr/local/lib:/usr/lib}"`,
    `export DYLD_FALLBACK_FRAMEWORK_PATH=${frameworkPath}"\${DYLD_FALLBACK_FRAMEWORK_PATH:-/Library/Frameworks:/System/Library/Frameworks}"`,
    // Without these, GStreamer looks for plugins in a Homebrew path that does not exist here
    // and Media Foundation videos get no H.264/AAC decoders.
    `export GST_PLUGIN_SYSTEM_PATH=${shellQuote(path.join(gstreamerLib, 'gstreamer-1.0'))}`,
    `export GST_REGISTRY=${shellQuote(path.join(prefix, '.gstreamer-registry.x86_64.bin'))}`,
    // Values match SAFE_ENV_VALUE, so they cannot break out of the double quotes.
    ...Object.entries(defaults).map(([key, value]) => `export ${key}="\${${key}:-${value}}"`),
    // Like CrossOver's wine script: Rosetta advertises AVX for any value, so 0 must unset it.
    'if [ "$ROSETTA_ADVERTISE_AVX" = 0 ]; then unset ROSETTA_ADVERTISE_AVX; fi',
    // The d3d12 shim goes in front of D3DMetal only for games that ask for it (a profile or
    // launch options with HB_D3D12_TSSHIM=1): it has been measured on Forza Horizon 6 only.
    ...(d3d12Shim ? [
      'if [ "${HB_D3D12_TSSHIM:-0}" != 0 ]; then',
      `  export WINEDLLPATH_PREPEND=${shellQuote(`${path.join(d3d12Shim.dir, 'wine')}:${path.join(appleGptkRoot, 'wine')}`)}`,
      `  export HB_D3D12_REAL=${shellQuote(`Z:${d3d12Shim.realDll.replaceAll('/', '\\')}`)}`,
      '  echo "Shim d3d12 davanti a D3DMetal (HB_D3D12_TSSHIM=1)." >&2',
      'fi',
    ] : []),
    'if [ "${1:-}" = "--nexus-stop-prefix" ]; then',
    `  exec ${wineserver} -k`,
    'fi',
    // Like Nexus' Linux wine-launcher: the title's PlayFabGameSave.dll becomes nexus_pgs_native.dll
    // behind the runtime's proxy, which adds the stock UI in-process PlayFab saves expect. Only a
    // symlink in the RAM-disk launch view is swapped, and it is put back before the backend copies
    // the game's new files into its folder. NEXUS_PLAYFAB_ADAPTER=0 turns it off.
    'pgs_restore() { rm -f "$pgs_dll" "$pgs_dir/nexus_pgs_native.dll"; ln -s "$pgs_target" "$pgs_dll"; }',
    'case "${1:-}" in Z:\\\\*) pgs_dir=$(printf \'%s\' "${1#Z:}" | tr \'\\\\\' /); pgs_dir=${pgs_dir%/*} ;; *) pgs_dir= ;; esac',
    'pgs_dll="$pgs_dir/PlayFabGameSave.dll"',
    'if [ -n "$pgs_dir" ] && [ "${NEXUS_PLAYFAB_ADAPTER:-1}" != 0 ] && [ -f "${NEXUS_PGS_PROXY:-}" ] && [ -L "$pgs_dll" ] && [ ! -e "$pgs_dir/nexus_pgs_native.dll" ]; then',
    '  pgs_target=$(readlink "$pgs_dll")',
    '  if cp "$pgs_dll" "$pgs_dir/nexus_pgs_native.dll" && rm "$pgs_dll" && cp "$NEXUS_PGS_PROXY" "$pgs_dll"; then',
    '    trap pgs_restore EXIT; trap \'exit 129\' HUP; trap \'exit 130\' INT; trap \'exit 143\' TERM',
    '    export WINEDLLOVERRIDES="${WINEDLLOVERRIDES:+$WINEDLLOVERRIDES;}playfabgamesave=n;nexus_pgs_native=n"',
    '  else',
    '    pgs_restore',
    '  fi',
    'fi',
    'launch_status=0',
    `${wine} "$@" || launch_status=$?`,
    'wait_status=0',
    `${wineserver} -w || wait_status=$?`,
    'if [ "$launch_status" -ne 0 ]; then exit "$launch_status"; fi',
    'exit "$wait_status"',
    '',
  ].join('\n');
}

export function highballOverrideDirectory(dataRoot: string): string {
  return path.join(dataRoot, 'highball-overrides');
}

export function highballShimDirectory(dataRoot: string): string {
  return path.join(dataRoot, 'highball-d3d12-shim');
}

export interface D3D12Shim {
  /** Overlay root holding wine/x86_64-windows/d3d12.dll (the shim) and apd12.dll. */
  dir: string;
  /** D3DMetal's d3d12.dll laid out beside the shim under the name it loads. */
  realDll: string;
}

/** Rewrites a PE's export directory name (same length only, so nothing else moves). */
export function patchPeExportName(pe: Buffer, name: string): Buffer {
  const out = Buffer.from(pe);
  const header = out.readUInt32LE(0x3c);
  if (out.toString('latin1', header, header + 4) !== 'PE\0\0') throw new Error('Not a PE file');
  const sections = out.readUInt16LE(header + 6);
  const optional = header + 24;
  if (out.readUInt16LE(optional) !== 0x20b) throw new Error('Not a PE32+ file');
  const table = optional + out.readUInt16LE(header + 20);
  const fileOffset = (rva: number) => {
    for (let i = 0; i < sections; i++) {
      const entry = table + 40 * i;
      const [size, address, rawSize, raw] = [out.readUInt32LE(entry + 8), out.readUInt32LE(entry + 12), out.readUInt32LE(entry + 16), out.readUInt32LE(entry + 20)];
      if (rva >= address && rva < address + Math.max(size, rawSize)) return rva - address + raw;
    }
    throw new Error(`RVA 0x${rva.toString(16)} is outside every section`);
  };
  const nameOffset = fileOffset(out.readUInt32LE(fileOffset(out.readUInt32LE(optional + 112)) + 12));
  const end = out.indexOf(0, nameOffset);
  if (end - nameOffset !== name.length) throw new Error(`Export name ${out.toString('latin1', nameOffset, end)} cannot become ${name}`);
  out.write(name, nameOffset, 'latin1');
  return out;
}

const SHIM_REAL = 'apd12';
const BUNDLED_D3D12_SHIM = fileURLToPath(new URL('../../assets/d3d12-shim/d3d12.dll', import.meta.url));

/**
 * Copies MACxus' build of the shim (assets/d3d12-shim, GPL-3.0, sources beside it) into shimRoot
 * when it is missing or different. A shim placed there by hand is replaced by the bundled one.
 */
export async function installBundledD3D12Shim(shimRoot: string, bundled = BUNDLED_D3D12_SHIM): Promise<void> {
  const wanted = await readOptional(bundled);
  if (!wanted) return;
  const target = path.join(shimRoot, 'wine', 'x86_64-windows', 'd3d12.dll');
  if ((await readOptional(target))?.equals(wanted)) return;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await replaceFile(target, wanted);
}

/**
 * Lays out the d3d12 shim the way Highball does: D3DMetal's d3d12.dll beside it as apd12.dll,
 * export name patched (CrossOver's Wine tells builtins apart by that name, so under its own the
 * copy would come back as the shim), and its unix half linked as apd12.so. Undefined when no shim
 * is installed in shimRoot.
 */
export async function prepareD3D12Shim(shimRoot: string, appleGptkRoot: string): Promise<D3D12Shim | undefined> {
  const pe = path.join(shimRoot, 'wine', 'x86_64-windows');
  if (!existsSync(path.join(pe, 'd3d12.dll'))) return undefined;
  const realDll = path.join(pe, `${SHIM_REAL}.dll`);
  const wanted = patchPeExportName(await fs.readFile(path.join(appleGptkRoot, 'wine', 'x86_64-windows', 'd3d12.dll')), `${SHIM_REAL}.dll`);
  if (!(await readOptional(realDll))?.equals(wanted)) await replaceFile(realDll, wanted);
  const unix = path.join(shimRoot, 'wine', 'x86_64-unix');
  const link = path.join(unix, `${SHIM_REAL}.so`);
  const target = path.join(appleGptkRoot, 'wine', 'x86_64-unix', 'd3d12.so');
  await fs.mkdir(unix, { recursive: true });
  if (await fs.readlink(link).catch(() => undefined) !== target) {
    await fs.rm(link, { force: true });
    await fs.symlink(target, link);
  }
  return { dir: shimRoot, realDll };
}

async function readOptional(file: string): Promise<Buffer | undefined> {
  try { return await fs.readFile(file); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function replaceFile(target: string, bytes: Buffer): Promise<void> {
  const temporary = `${target}.nexus-${process.pid}`;
  try {
    await fs.writeFile(temporary, bytes, { mode: 0o644 });
    await fs.rename(temporary, target);
  } finally { await fs.unlink(temporary).catch(() => undefined); }
}

/**
 * Swaps engine builtins (x86_64-windows) for the DLLs in overrideDir, e.g. a
 * winegstreamer built from the same CrossOver sources with extra patches. They stay
 * builtin, so their unix libraries still load. The engine's original is kept once in
 * <engine>/overrides-original and put back when its override is removed; the prefix's
 * system32 copy follows the engine's. Returns the DLL names that changed.
 */
export async function installHighballEngineOverrides(engineRoot: string, prefix: string, overrideDir: string, log: (line: string) => void = () => undefined): Promise<string[]> {
  const lib = path.join(engineRoot, 'engine', 'lib', 'wine', 'x86_64-windows');
  const originals = path.join(engineRoot, 'overrides-original');
  const system32 = path.join(prefix, 'drive_c', 'windows', 'system32');
  const listDlls = async (dir: string) => (await fs.readdir(dir).catch(() => [] as string[])).filter((name) => /^[\w.-]+\.dll$/i.test(name));
  const changed: string[] = [];
  const install = async (name: string, bytes: Buffer) => {
    let updated = false;
    if (!(await readOptional(path.join(lib, name)))?.equals(bytes)) { await replaceFile(path.join(lib, name), bytes); updated = true; }
    const copy = await readOptional(path.join(system32, name));
    if (copy && !copy.equals(bytes)) { await replaceFile(path.join(system32, name), bytes); updated = true; }
    if (updated) changed.push(name);
  };

  const wanted = await listDlls(overrideDir);
  for (const name of wanted) {
    const original = await readOptional(path.join(lib, name));
    if (!original) { log(`Override Highball ignorato: ${name} non è una DLL del motore.`); continue; }
    if (!(await readOptional(path.join(originals, name)))) {
      await fs.mkdir(originals, { recursive: true });
      await replaceFile(path.join(originals, name), original);
    }
    await install(name, await fs.readFile(path.join(overrideDir, name)));
  }
  for (const name of await listDlls(originals)) {
    if (wanted.includes(name)) continue;
    await install(name, await fs.readFile(path.join(originals, name)));
    await fs.rm(path.join(originals, name));
  }
  if (changed.length) log(`DLL del motore Highball aggiornate da ${overrideDir}: ${changed.join(', ')}.`);
  return changed;
}

/**
 * Prepares the Highball prefix <bottlesRoot>/xbox-highball (separate from the
 * CrossOver bottle), installs the runtime DLLs as native, applies the engine
 * overrides (see installHighballEngineOverrides) and writes the wrapper.
 */
export async function prepareHighballRunner(
  engineRoot: string,
  appleGptkRoot: string,
  crossOverLib64: string,
  bottlesRoot: string,
  runtimeDlls: string | RuntimeDllSource,
  extraEnv: Record<string, string> = {},
  log: (line: string) => void = () => undefined,
  engineOverrideDir?: string,
  d3d12ShimDir?: string,
): Promise<ProtonRunner> {
  const wine = path.join(engineRoot, 'engine', 'bin', 'wine');
  const wineserver = path.join(engineRoot, 'engine', 'bin', 'wineserver');
  const prefix = path.join(bottlesRoot, PREFIX);
  try { await fs.access(path.join(crossOverLib64, 'libgnutls.30.dylib')); } catch {
    log('GnuTLS non trovato: le connessioni sicure (servizi online) potrebbero non funzionare con il motore Highball.');
  }
  const env: NodeJS.ProcessEnv = { ...process.env, WINEPREFIX: prefix, WINEDEBUG: process.env.WINEDEBUG ?? '-all' };
  await fs.mkdir(bottlesRoot, { recursive: true });

  let existed = true;
  try { await fs.access(path.join(prefix, 'system.reg')); } catch { existed = false; }
  if (!existed) {
    await fs.mkdir(prefix, { recursive: true });
    const booted = await run(wine, ['wineboot', '-u'], { env });
    // wineserver writes system.reg when it exits.
    await run(wineserver, ['-w'], { env }).catch(() => undefined);
    try { await fs.access(path.join(prefix, 'system.reg')); } catch {
      throw new Error(`Il prefisso Highball non è stato creato: ${booted.output.trim().split('\n').slice(-3).join(' | ') || `codice ${booted.code}`}`);
    }
  }

  const changed = await installRuntimeDlls(prefix, runtimeDlls, log);
  await ensureRuntimeOverrides(prefix, !existed || changed.length > 0, (args) => run(wine, args, { env }), 'Highball prefix');
  if (engineOverrideDir) await installHighballEngineOverrides(engineRoot, prefix, engineOverrideDir, log);

  const runner = path.join(bottlesRoot, RUNNER);
  // The shim serves D3D12 calls D3DMetal does not implement (timestamp queries, shader-model
  // queries, depth resolves), corrects APPEND_ALIGNED input-layout offsets and makes pixel shaders
  // that read SV_ShadingRate drawable on GPUs without VRS. The bundled build is laid out for every
  // Highball launch, and the wrapper uses it when HB_D3D12_TSSHIM=1. 64-bit atomics are NOT hidden:
  // hiding them made Halo refuse to start (Nanite requires the capability).
  if (d3d12ShimDir) await installBundledD3D12Shim(d3d12ShimDir);
  const shim = d3d12ShimDir ? await prepareD3D12Shim(d3d12ShimDir, appleGptkRoot) : undefined;
  await writeRunnerScript(runner, highballWrapperScript(engineRoot, appleGptkRoot, crossOverLib64, prefix, extraEnv, shim));
  return { command: runner, compatibilityDataPath: prefix, stopPrefix: { command: runner, args: ['--nexus-stop-prefix'] } };
}
