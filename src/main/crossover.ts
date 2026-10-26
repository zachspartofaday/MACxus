import { constants, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, type RunResult } from './process.js';
import type { ProtonRunner } from './proton.js';

/**
 * Runtime DLLs copied into the prefix as native. The engine's own winhttp rejects
 * WINHTTP_OPTION_IPV6_FAST_FALLBACK, which XCurl (GDK libcurl) treats as fatal; the
 * runtime's winhttp accepts it and loads libnghttp2.dll from system32 for HTTP/2.
 */
export const MAC_RUNTIME_DLLS = ['xgameruntime.dll', 'windows.web.dll', 'twinapi.appcore.dll', 'gamingtcui.dll', 'winhttp.dll', 'libnghttp2.dll'] as const;

export interface CrossOverInstall {
  root: string;
  wine: string;
  wineserver: string;
  cxbottle: string;
  version: string;
  /** New Preview editions select their renamed server through the wine launcher. */
  serverViaWine?: boolean;
  supportsArm64?: boolean;
}

type Graphics = 'd3dmetal' | 'dxmt' | 'wined3d';

const BOTTLE = 'xbox';
const BUILTIN_MARKER = Buffer.from('Wine builtin DLL');

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function crossOverCandidateRoots(edition: 'standard' | 'preview' | 'preview-fex', home = os.homedir()): string[] {
  const apps = edition === 'preview-fex' ? ['CrossOver PreviewARM.app', 'CrossOver Preview ARM64.app', 'CrossOver Preview ARM.app', 'CrossOver Preview.app']
    : [edition === 'preview' ? 'CrossOver Preview.app' : 'CrossOver.app'];
  return ['/Applications', path.join(home, 'Applications')].flatMap(dir => apps.map(app => path.join(dir, app, 'Contents/SharedSupport/CrossOver')));
}

export function findCrossOverPreview(candidates = crossOverCandidateRoots('preview')): Promise<CrossOverInstall | undefined> {
  return findCrossOver(candidates);
}

export async function findCrossOverPreviewFex(candidates = crossOverCandidateRoots('preview-fex')): Promise<CrossOverInstall | undefined> {
  for (const root of candidates) {
    const installation = await findCrossOver([root]);
    if (installation?.supportsArm64) return installation;
  }
  return undefined;
}

export async function findCrossOver(candidates?: string[]): Promise<CrossOverInstall | undefined> {
  const roots = candidates ?? crossOverCandidateRoots('standard');
  for (const root of roots) {
    const wine = path.join(root, 'bin', 'wine');
    let wineserver = path.join(root, 'bin', 'wineserver');
    const cxbottle = path.join(root, 'bin', 'cxbottle');
    try {
      await Promise.all([wine, cxbottle].map((file) => fs.access(file, constants.X_OK)));
    } catch { continue; }
    let serverViaWine = false;
    try { await fs.access(wineserver, constants.X_OK); }
    catch {
      const servers = [path.join(root, 'bin/wineserver-x86'), path.join(root, 'bin/wineserver-arm64')];
      const available = await Promise.all(servers.map(async file => { try { await fs.access(file, constants.X_OK); return file; } catch { return undefined; } }));
      const server = available.find(Boolean);
      if (!server) continue;
      wineserver = server; serverViaWine = true;
    }
    let supportsArm64 = false;
    try {
      await fs.access(path.join(root, 'bin/wineserver-arm64'), constants.X_OK);
      await fs.access(path.join(root, 'lib/wine/aarch64-unix/ntdll.so'));
      await fs.access(path.join(root, 'lib/wine/aarch64-unix/libarm64ecfex.so'));
      supportsArm64 = true;
    } catch { /* This edition has no FEX/ARM engine. */ }
    let version = '';
    try {
      const plist = path.join(root, '..', '..', 'Info.plist');
      const result = await run('plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', plist]);
      if (result.code === 0) version = result.output.trim();
    } catch { /* version stays unknown */ }
    return { root, wine, wineserver, cxbottle, version, ...(serverViaWine ? { serverViaWine } : {}), ...(supportsArm64 ? { supportsArm64 } : {}) };
  }
  return undefined;
}

/** Wine treats a builtin-marked file in system32 as a placeholder; clearing the marker makes it load as native. */
export function stripBuiltinMarker(bytes: Buffer): Buffer {
  const copy = Buffer.from(bytes);
  if (copy.length >= 80 && copy.subarray(64, 80).equals(BUILTIN_MARKER)) copy.fill(0, 64, 80);
  return copy;
}

export function crossOverWrapperScript(cx: CrossOverInstall, bottlesRoot: string, bottle: string, graphics: Graphics): string {
  const prefix = path.join(bottlesRoot, bottle);
  const server = cx.serverViaWine ? `${shellQuote(cx.wine)} --bottle ${shellQuote(bottle)} --ux-app wineserver` : shellQuote(cx.wineserver);
  return [
    '#!/bin/sh',
    `export CX_BOTTLE_PATH=${shellQuote(bottlesRoot)}`,
    `export CX_GRAPHICS_BACKEND="\${CX_GRAPHICS_BACKEND:-${graphics}}"`,
    `export WINEPREFIX=${shellQuote(prefix)}`,
    'if [ "${1:-}" = "--nexus-stop-prefix" ]; then',
    `  exec ${server} -k`,
    'fi',
    'launch_status=0',
    `${shellQuote(cx.wine)} --bottle ${shellQuote(bottle)} "$@" || launch_status=$?`,
    'wait_status=0',
    `${server} -w || wait_status=$?`,
    'if [ "$launch_status" -ne 0 ]; then exit "$launch_status"; fi',
    'exit "$wait_status"',
    '',
  ].join('\n');
}

/** Where the runtime DLLs come from: the Nexus runtime dir, optionally shadowed per file by an override dir. */
export interface RuntimeDllSource {
  dir: string;
  /** `<dataRoot>/runtime-overrides`: a DLL found here replaces the runtime's copy. */
  overrideDir?: string;
  /** MACxus' patched DLLs shipped in the app (assets/mac-runtime-dlls); used after overrideDir. */
  bundledDir?: string;
}

const BUNDLED_RUNTIME_DLLS = fileURLToPath(new URL('../../assets/mac-runtime-dlls', import.meta.url));

/**
 * The bundled DLLs are full builds of one Nexus runtime release plus the macOS
 * patches (assets/runtime-patches); they apply only to that release, whose name
 * manifest.json records. <release>/files/lib/wine/x86_64-windows is runtimeDllDir.
 */
export async function bundledRuntimeDllDirectory(runtimeDllDir: string, bundledDir = BUNDLED_RUNTIME_DLLS): Promise<string | undefined> {
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(bundledDir, 'manifest.json'), 'utf8')) as { runtime?: unknown };
    return manifest.runtime === path.basename(path.resolve(runtimeDllDir, '..', '..', '..', '..')) ? bundledDir : undefined;
  } catch { return undefined; }
}

export function runtimeOverrideDirectory(dataRoot: string): string {
  return path.join(dataRoot, 'runtime-overrides');
}

async function readRuntimeDll(source: RuntimeDllSource, name: string): Promise<{ bytes: Buffer; origin: 'override' | 'bundled' | 'runtime' }> {
  for (const [dir, origin] of [[source.overrideDir, 'override'], [source.bundledDir, 'bundled']] as const) {
    if (!dir) continue;
    try { return { bytes: await fs.readFile(path.join(dir, name)), origin }; } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return { bytes: await fs.readFile(path.join(source.dir, name)), origin: 'runtime' };
}

/** Copies the runtime DLLs into the prefix's system32 as native DLLs; returns the names that changed. */
export async function installRuntimeDlls(prefix: string, runtimeDlls: string | RuntimeDllSource, log: (line: string) => void = () => undefined): Promise<string[]> {
  const source = typeof runtimeDlls === 'string' ? { dir: runtimeDlls } : runtimeDlls;
  const system32 = path.join(prefix, 'drive_c', 'windows', 'system32');
  await fs.mkdir(system32, { recursive: true });
  const changed: string[] = [];
  const overridden: string[] = [];
  const bundled: string[] = [];
  for (const name of MAC_RUNTIME_DLLS) {
    const dll = await readRuntimeDll(source, name);
    if (dll.origin === 'override') overridden.push(name);
    if (dll.origin === 'bundled') bundled.push(name);
    const stripped = stripBuiltinMarker(dll.bytes);
    const target = path.join(system32, name);
    let current: Buffer | undefined;
    try { current = await fs.readFile(target); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (current?.equals(stripped)) continue;
    const temporary = `${target}.nexus-${process.pid}`;
    try {
      await fs.writeFile(temporary, stripped, { mode: 0o644 });
      await fs.rename(temporary, target);
    } finally { await fs.unlink(temporary).catch(() => undefined); }
    changed.push(name);
  }
  if (overridden.length) log(`DLL del runtime sostituite da ${source.overrideDir}: ${overridden.join(', ')}.`);
  if (bundled.length) log(`DLL patchate di MACxus: ${bundled.join(', ')}.`);
  return changed;
}

/** `reg add` arguments that make Wine prefer the native copy of a runtime DLL. */
export function dllOverrideArgs(name: string): string[] {
  return ['reg', 'add', 'HKCU\\Software\\Wine\\DllOverrides', '/v', name.replace(/\.dll$/i, ''), '/t', 'REG_SZ', '/d', 'native,builtin', '/f'];
}

/**
 * Sets the native,builtin overrides when the prefix is new, a DLL changed or the
 * marker file is missing/stale; the marker is written only after every override succeeded.
 */
export async function ensureRuntimeOverrides(prefix: string, force: boolean, regAdd: (name: string) => Promise<RunResult>, label: string): Promise<void> {
  const markerPath = path.join(prefix, '.macxus-overrides');
  const markerContent = [...MAC_RUNTIME_DLLS].sort().join('\n') + '\n';
  let confirmed = false;
  try { confirmed = (await fs.readFile(markerPath, 'utf8')) === markerContent; } catch { /* not confirmed yet */ }
  if (!force && confirmed) return;
  for (const name of MAC_RUNTIME_DLLS) {
    const result = await regAdd(name);
    if (result.code !== 0) throw new Error(`Could not set the ${name} override in the ${label} (code ${result.code})`);
  }
  await fs.writeFile(markerPath, markerContent);
}

/** Atomically writes a 0700 wrapper script. */
export async function writeRunnerScript(runner: string, content: string): Promise<void> {
  const temporary = `${runner}.tmp-${process.pid}`;
  await fs.writeFile(temporary, content, { mode: 0o700 });
  await fs.rename(temporary, runner);
  await fs.chmod(runner, 0o700);
}

export async function prepareCrossOverRunner(
  cx: CrossOverInstall,
  bottlesRoot: string,
  runtimeDlls: string | RuntimeDllSource,
  graphics: Graphics = 'd3dmetal',
  log: (line: string) => void = () => undefined,
  architecture: 'win64' | 'arm64' = 'win64',
): Promise<ProtonRunner> {
  const bottlePath = path.join(bottlesRoot, BOTTLE);
  const env = { ...process.env, CX_BOTTLE_PATH: bottlesRoot, WINEPREFIX: bottlePath };
  await fs.mkdir(bottlesRoot, { recursive: true });

  let existed = true;
  try { await fs.access(path.join(bottlePath, 'system.reg')); } catch { existed = false; }
  if (!existed) {
    const created = await run(cx.cxbottle, ['--bottle', BOTTLE, '--create', '--template', 'win10_64', ...(architecture === 'arm64' ? ['--winearch', 'arm64'] : [])], { env });
    try { await fs.access(path.join(bottlePath, 'system.reg')); } catch {
      throw new Error(`The CrossOver bottle was not created: ${created.output.trim().split('\n').slice(-3).join(' | ') || `code ${created.code}`}`);
    }
  }

  const changed = await installRuntimeDlls(bottlePath, runtimeDlls, log);
  await ensureRuntimeOverrides(bottlePath, !existed || changed.length > 0, (name) =>
    run(cx.wine, ['--bottle', BOTTLE, ...dllOverrideArgs(name)], { env }), 'CrossOver bottle');

  const runner = path.join(bottlesRoot, 'xodus-crossover-wine');
  await writeRunnerScript(runner, crossOverWrapperScript(cx, bottlesRoot, BOTTLE, graphics));
  return { command: runner, compatibilityDataPath: bottlePath, stopPrefix: { command: runner, args: ['--nexus-stop-prefix'] } };
}
