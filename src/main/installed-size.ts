import { promises as fs } from 'node:fs';
import path from 'node:path';

/** Logical file bytes in this installation, without reading file contents or
 * following symlink targets. Failures never return a misleading partial total. */
export async function installedGameBytes(directory: string, limits = { entries: 250_000, milliseconds: 15_000 }): Promise<number | undefined> {
  const deadline = Date.now() + limits.milliseconds;
  try {
    const root = await fs.realpath(directory);
    if (root === path.parse(root).root) return undefined;
    const original = await fs.lstat(root, { bigint: true });
    if (!original.isDirectory()) return undefined;
    const pending = [root], directories = new Set<string>(), hardlinks = new Set<string>();
    let bytes = 0n, entries = 0;
    while (pending.length) {
      if (Date.now() >= deadline) return undefined;
      const current = pending.pop()!;
      const info = await fs.lstat(current, { bigint: true });
      if (info.isSymbolicLink()) continue;
      if (info.dev !== original.dev || !info.isDirectory()) return undefined;
      const identity = `${info.dev}:${info.ino}`;
      if (directories.has(identity)) continue;
      directories.add(identity);
      for await (const entry of await fs.opendir(current)) {
        if (++entries > limits.entries || Date.now() >= deadline) return undefined;
        const file = path.join(current, entry.name), stat = await fs.lstat(file, { bigint: true });
        if (stat.isSymbolicLink()) continue;
        if (stat.dev !== original.dev) return undefined;
        if (stat.isDirectory()) { pending.push(file); continue; }
        if (!stat.isFile()) continue;
        if (stat.nlink > 1n) {
          const key = `${stat.dev}:${stat.ino}`;
          if (hardlinks.has(key)) continue;
          hardlinks.add(key);
        }
        bytes += stat.size;
        if (bytes > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
      }
    }
    const final = await fs.lstat(root, { bigint: true });
    if (final.dev !== original.dev || final.ino !== original.ino || !final.isDirectory()) return undefined;
    return Number(bytes);
  } catch { return undefined; }
}
