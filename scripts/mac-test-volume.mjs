import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

// A finished test process can leave security/indexing work briefly holding the
// disposable image open. Retry only EBUSY; never force-eject or remove a mounted image.
export async function detachMacTestVolume(mountpoint, {
  run = (tool, args) => execFileSync(tool, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
  wait = delay,
  log = console.warn,
} = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      run('hdiutil', ['detach', mountpoint]);
      return;
    } catch (error) {
      if (error.status !== 16 || attempt === 4) throw error;
      log('The disposable Mac test volume is busy; retrying its normal detach.');
      await wait(250 * 2 ** attempt);
    }
  }
}
