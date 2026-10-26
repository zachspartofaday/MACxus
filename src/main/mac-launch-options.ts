import { promises as fs } from 'node:fs';
import path from 'node:path';
import { commandWords, normalizeLaunchTools, parseLaunchOptions } from '../shared/launch-tools.js';
import type { GameLaunchTools } from '../shared/types.js';
import type { GameWrapper } from './game-wrapper.js';
import { crossOverDlssEnvironment } from './mac-dlss.js';
import { shellQuote } from './crossover.js';

/** Wrap only the selected macOS game's runner. Prefix setup and Stop keep the
 * original runner, so trailing game arguments never reach registry/locale tools.
 * Values stay in this launch's environment; no bottle configuration is written. */
export async function prepareMacLaunchOptions(
  command: string,
  value: GameLaunchTools | undefined,
  root: string,
  source: NodeJS.ProcessEnv,
  profileEnv: Record<string, string>,
  engine: string,
): Promise<GameWrapper & { environment: NodeJS.ProcessEnv }> {
  const tools = normalizeLaunchTools(value);
  const { environment: custom, prefix, gameArgs } = parseLaunchOptions(tools.launchOptions);
  if (prefix.length) throw Error('Custom launch wrappers are not supported on macOS. Use NAME=value before %command% and game arguments after it.');
  // CrossOver applies CX_ENV after bottle setup, so validate its assignments too.
  // Use the same bounded literal-word grammar as ordinary launch options. Reject
  // nested CX_ENV rather than letting a later Wine invocation reinterpret it.
  const nested = custom.CX_ENV === undefined ? {} : crossOverAssignments(custom.CX_ENV);
  for (const assignments of [custom, nested]) {
    for (const key of ['CX_BOTTLE', 'CX_BOTTLE_PATH', 'CX_ROOT', 'CX_USER_BOTTLE_PATH']) {
      if (Object.hasOwn(assignments, key)) throw Error(`${key} is managed by MACxus and cannot be overridden in launch options.`);
    }
  }
  const merged = { ...source, ...custom };
  // Explicit per-game options and inherited user choices take priority over profiles.
  for (const [key, value] of Object.entries(profileEnv)) if (merged[key] === undefined) merged[key] = value;
  // Apply last, including CX_ENV: CrossOver applies it after bottle defaults.
  const environment = crossOverDlssEnvironment(merged, engine, tools.dlss === true);
  if (!gameArgs.length) return { command, environment, cleanup: async () => {} };
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const directory = await fs.mkdtemp(path.join(root, 'mac-game-options-'));
  const wrapper = path.join(directory, 'wine-wrapper');
  const cleanup = () => fs.rm(directory, { recursive: true, force: true });
  try {
    await fs.writeFile(wrapper, `#!/bin/sh\nexec ${shellQuote(command)} "$@" ${gameArgs.map(shellQuote).join(' ')}\n`, { mode: 0o700, flag: 'wx' });
    return { command: wrapper, environment, cleanup };
  } catch (error) { await cleanup(); throw error; }
}

function crossOverAssignments(value: string): Record<string, string> {
  if (commandWords(value).some(word => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word))) {
    throw Error('CX_ENV must contain only NAME=value assignments with literal quoting.');
  }
  const { environment } = parseLaunchOptions(value);
  if (Object.hasOwn(environment, 'CX_ENV')) throw Error('Nested CX_ENV is not supported in launch options.');
  return environment;
}
