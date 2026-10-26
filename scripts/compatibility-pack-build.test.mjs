import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { compatibilityPackConfigure } from './compatibility-pack-build.mjs';

const compiler = 'x86_64-w64-mingw32-gcc', strip = 'x86_64-w64-mingw32-strip';
const available = name => spawnSync(name, ['--version'], { stdio: 'ignore' }).status === 0;

test('Wine configure keeps the original relative source reference across temporary roots', () => {
  for (const root of ['/tmp/short-build-A', '/private/var/folders/longer-random-build-B']) {
    const build = path.join(root, 'build'), source = path.join(root, 'sources/wine');
    assert.equal(compatibilityPackConfigure(build, source), '../sources/wine/configure');
  }
  assert.throws(() => compatibilityPackConfigure('/tmp/build', '/tmp/build'), /separate/);
});

test('stripped PE __FILE__ strings and bytes reproduce across different absolute build paths', {
  skip: !available(compiler) || !available(strip) ? 'MinGW compiler/strip unavailable; full Wine rebuilds are a separate maintainer check' : false,
}, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'macxus-pe-path-'));
  try {
    const outputs = [];
    for (const name of ['short', 'a-much-longer-and-different-build-directory']) {
      const work = path.join(root, name), build = path.join(work, 'build'), source = path.join(work, 'sources/wine');
      await fs.mkdir(path.join(source, 'libs/strmbase'), { recursive: true }); await fs.mkdir(build);
      // Mirrors the strmbase critical-section diagnostic literals which survive
      // --strip-debug. Configure's source spelling becomes generated Makefile input.
      await fs.writeFile(path.join(source, 'libs/strmbase/seeking.c'), 'const char *source_name = __FILE__ ": SourceSeeking.cs";\nint main(void) { return source_name[0] == 0; }\n');
      const configure = compatibilityPackConfigure(build, source);
      const input = path.join(path.dirname(configure), 'libs/strmbase/seeking.c');
      execFileSync(compiler, ['-g', '-O2', input, '-o', 'probe.exe', '-Wl,--no-insert-timestamp'], { cwd: build, stdio: 'pipe' });
      execFileSync(strip, ['--strip-debug', 'probe.exe'], { cwd: build, stdio: 'pipe' });
      const bytes = await fs.readFile(path.join(build, 'probe.exe'));
      assert.ok(bytes.includes(Buffer.from('../sources/wine/libs/strmbase/seeking.c: SourceSeeking.cs')));
      assert.ok(!bytes.includes(Buffer.from(root)));
      outputs.push(bytes);
    }
    assert.deepEqual(outputs[0], outputs[1]);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
