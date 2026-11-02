import type { Game, GameLaunchTools } from '../shared/types.js';
import { LINUX_RUN_PATCH } from './backend.js';

/** The prepared runner owns WINEPREFIX and runtime libraries, even without tools. */
export function preparedGameWine(runner: { command: string; launchCommand?: string } | undefined, fallback: string): string {
  return runner?.launchCommand ?? runner?.command ?? fallback;
}

/** One package launch policy. Runtime/backend, never title names, own compatibility. */
export function gameLaunchArguments(
  game: Pick<Game, 'path' | 'executable'> & { launchTools?: Pick<GameLaunchTools, 'executable'> },
  wine: string,
  market: string,
  backendPatch: string | undefined,
): string[] {
  if (backendPatch !== LINUX_RUN_PATCH) {
    throw new Error('Play requires the current managed Xodus backend. Update the backend in Settings.');
  }
  const executable = game.launchTools?.executable?.trim() || game.executable?.trim();
  if (!executable) throw new Error('The package manifest has no launch executable.');
  const args = ['run', game.path, wine, '--exe', executable, '--materialize-chain'];
  if (market) args.push('--market', market);
  return args;
}
