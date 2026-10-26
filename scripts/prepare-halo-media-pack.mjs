// Build-time preparation only. App users receive the verified DLLs and source;
// no compiler, downloader or signing-key changes are needed on their machine.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { verifyHaloMediaPackDirectory } from './halo-media-pack.mjs';

if (process.platform !== 'darwin') throw Error('Halo media pack preparation requires macOS.');
const project = fileURLToPath(new URL('..', import.meta.url));
const root = path.join(project, 'assets/compatibility-packs/halo-preview-media-v1');
const lock = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
const hash = data => createHash('sha256').update(data).digest('hex');
const execute = (name, args, options = {}) => execFileSync(name, args, { stdio: 'inherit', ...options });
const work = await fs.mkdtemp(path.join(os.tmpdir(), 'macxus-halo-build-'));
try {
  const archive = path.join(root, 'source', 'crossover-sources-26.3.0.tar.gz');
  await fs.mkdir(path.dirname(archive), { recursive: true });
  let valid = false;
  try { valid = hash(await fs.readFile(archive)) === lock.source.sha256; } catch { /* prepare below */ }
  if (!valid) {
    const localIndex = process.argv.indexOf('--source-archive');
    const temporary = path.join(work, 'source.tar.gz');
    if (localIndex !== -1) {
      if (!process.argv[localIndex + 1]) throw Error('--source-archive requires a path.');
      await fs.copyFile(process.argv[localIndex + 1], temporary);
    } else execute('/usr/bin/curl', ['--fail', '--location', '--proto', '=https', '--proto-redir', '=https', '--max-time', '600', '--output', temporary, lock.source.url]);
    if (hash(await fs.readFile(temporary)) !== lock.source.sha256) throw Error('Halo media source checksum mismatch.');
    await fs.copyFile(temporary, archive);
  }
  const patch = path.join(project, lock.patch.path);
  if (hash(await fs.readFile(patch)) !== lock.patch.sha256) throw Error('Halo media patch checksum mismatch.');
  const payload = path.join(root, 'payload');
  let payloadValid = true;
  for (const [name, expected] of Object.entries(lock.dlls)) {
    try { if (hash(await fs.readFile(path.join(payload, name))) !== expected) payloadValid = false; }
    catch { payloadValid = false; }
  }
  // Maintainers may reuse the exact already-tested build, never arbitrary DLLs.
  const prebuiltIndex = process.argv.indexOf('--dll-dir');
  let built;
  if (!payloadValid && prebuiltIndex !== -1) {
    built = process.argv[prebuiltIndex + 1];
    if (!built) throw Error('--dll-dir requires a path.');
  } else if (!payloadValid) {
    execute('/usr/bin/tar', ['-xzf', archive, '-C', work, 'sources/wine']);
    const source = path.join(work, 'sources/wine');
    for (const [name, digest] of Object.entries(lock.sources)) {
      if (hash(await fs.readFile(path.join(source, name))) !== digest.originalSHA256) throw Error(`Unexpected original source: ${name}`);
    }
    execute('/usr/bin/patch', ['--batch', '-p1', '-i', patch], { cwd: source });
    for (const [name, digest] of Object.entries(lock.sources)) {
      if (hash(await fs.readFile(path.join(source, name))) !== digest.patchedSHA256) throw Error(`Unexpected patched source: ${name}`);
    }
    const build = path.join(work, 'build'); await fs.mkdir(build);
    const env = { ...process.env, CC: 'clang -arch x86_64', CXX: 'clang++ -arch x86_64', PATH: ['/opt/homebrew/opt/bison/bin', '/usr/local/opt/bison/bin', process.env.PATH].filter(Boolean).join(':') };
    execute('../sources/wine/configure', ['--host=x86_64-apple-darwin', '--enable-win64', '--enable-archs=x86_64', '--without-x', '--without-wayland', '--without-gstreamer', '--enable-winegstreamer', '--without-cups', '--without-pulse', '--without-alsa', '--without-oss', '--without-dbus', '--without-gphoto', '--without-sane', '--without-v4l2', '--without-pcap', '--without-usb', '--without-capi', '--without-freetype', '--without-gnutls', '--without-opengl', '--without-vulkan', '--disable-tests'], { cwd: build, env });
    for (const name of Object.keys(lock.dlls)) {
      execute('/usr/bin/make', ['-j8', `dlls/${name.replace(/\.dll$/, '')}/x86_64-windows/${name}`], { cwd: build, env: { ...env, SOURCE_DATE_EPOCH: String(lock.buildTimestamps[name]) } });
    }
    built = path.join(work, 'payload'); await fs.mkdir(built);
    for (const name of Object.keys(lock.dlls)) {
      const dll = path.join(built, name);
      await fs.copyFile(path.join(build, 'dlls', name.replace(/\.dll$/, ''), 'x86_64-windows', name), dll);
      execute('x86_64-w64-mingw32-strip', ['--strip-debug', dll], { env: { ...env, SOURCE_DATE_EPOCH: String(lock.buildTimestamps[name]) } });
    }
  }
  if (built) {
    // Verify the whole candidate before changing any packaged payload file.
    const bytes = new Map();
    for (const [name, expected] of Object.entries(lock.dlls)) {
      const data = await fs.readFile(path.join(built, name));
      if (hash(data) !== expected) throw Error(`Halo ${name} is not the accepted artifact. A different toolchain needs new validation and a manifest update.`);
      bytes.set(name, data);
    }
    await fs.mkdir(payload, { recursive: true });
    for (const [name, data] of bytes) await fs.writeFile(path.join(payload, name), data);
  }
  await fs.copyFile(patch, path.join(root, 'source/crossover-preview-halo-mf-software-output.patch'));
  const recipe = path.join(root, 'source/build-scripts');
  await fs.mkdir(recipe, { recursive: true });
  for (const name of ['prepare-halo-media-pack.mjs', 'halo-media-pack.mjs']) await fs.copyFile(path.join(project, 'scripts', name), path.join(recipe, name));
  await verifyHaloMediaPackDirectory(root);
  console.log('Halo media pack payload and complete source match the pinned manifest.');
} finally {
  if (process.argv.includes('--keep-build')) console.log(`Retained maintainer build directory: ${work}`);
  else await fs.rm(work, { recursive: true, force: true });
}
