#!/usr/bin/env node
// Builds assets/d3d12-shim/d3d12.dll from the GPL-3.0 sources beside it (see its README).
// Needs a mingw cross compiler with a recent d3d12.h (Homebrew `mingw-w64` or llvm-mingw).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'd3d12-shim');
const src = (name) => path.join(root, 'src', name);
const out = path.join(root, 'd3d12.dll');
const compiler = process.env.MINGW_CC ?? 'x86_64-w64-mingw32-gcc';

execFileSync(compiler, [
  '-shared', '-O2', '-Wall', '-static-libgcc', '-Wl,--no-insert-timestamp', '-o', out,
  src('d3d12.c'), src('dxil_shadingrate.c'), src('inspect.c'), src('d3d12.def'),
], { stdio: 'inherit' });

// Wine loads a DLL from WINEDLLPATH only when it carries the builtin marker at offset 0x40.
const dll = readFileSync(out);
if (dll.readUInt32LE(0x3c) < 0x40 + 17) throw new Error('PE header too close to the DOS stub for the builtin marker');
dll.write('Wine builtin DLL\0', 0x40, 'latin1');
writeFileSync(out, dll);
console.log(`wrote ${out}`);
