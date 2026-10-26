import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { realpath } from 'node:fs/promises';
import path from 'node:path';

// A finished test process can leave security/indexing work briefly holding the
// disposable image open. Retry only EBUSY; never force-eject or remove a mounted image.
export async function detachMacTestVolume(mountpoint, {
  run = (tool, args, options = {}) => execFileSync(tool, args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...options }),
  wait = delay,
  log = console.warn,
  imagePath,
  canonical = realpath,
} = {}) {
  const expectedImage = imagePath ? await canonical(imagePath) : undefined;
  for (let attempt = 0; ; attempt++) {
    try {
      run('hdiutil', ['detach', mountpoint]);
      return;
    } catch (error) {
      // A busy detach may finish while hdiutil is returning its error. Never
      // infer completion from the next error alone: require a valid inventory
      // proving that both our exact image and mountpoint are absent.
      if (expectedImage && error.status === 1
          && /detach failed - No such file or directory/.test(String(error.stderr ?? ''))) {
        const plist = run('hdiutil', ['info', '-plist']);
        const images = JSON.parse(run('plutil', ['-extract', 'images', 'json', '-o', '-', '-'], { input: plist }));
        if (!Array.isArray(images)) throw Error('Invalid attached-image inventory during test-volume cleanup.');
        let attached = false;
        for (const image of images) {
          if (!image || typeof image !== 'object' || typeof image['image-path'] !== 'string'
              || (!path.isAbsolute(image['image-path']) && !/^ram:\/\/\d+$/.test(image['image-path']))
              || !Array.isArray(image['system-entities'])) throw Error('Incomplete attached-image inventory during test-volume cleanup.');
          // RAM images use ram:// identifiers; they cannot be this local backing
          // file, but their mountpoints must still be checked below.
          if (path.isAbsolute(image['image-path']) && await canonical(image['image-path']) === expectedImage) attached = true;
          for (const entity of image['system-entities']) {
            if (!entity || typeof entity !== 'object') throw Error('Invalid attached-image entity during test-volume cleanup.');
            if ('mount-point' in entity && (typeof entity['mount-point'] !== 'string' || !path.isAbsolute(entity['mount-point']))) throw Error('Invalid attached-image mountpoint during test-volume cleanup.');
            if (typeof entity['mount-point'] === 'string' && path.resolve(entity['mount-point']) === path.resolve(mountpoint)) attached = true;
          }
        }
        if (!attached) return;
      }
      if (error.status !== 16 || attempt === 4) throw error;
      log('The disposable Mac test volume is busy; retrying its normal detach.');
      await wait(250 * 2 ** attempt);
    }
  }
}
