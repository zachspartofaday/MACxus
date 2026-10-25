import { promises as fs } from 'node:fs';
import type { MacEngine } from '../shared/types.js';

/** Environment keys a per-game macOS profile may set; anything else is dropped. */
export const MAC_PROFILE_ENV_KEYS = [
  'D3DM_VENDOR_ID', 'D3DM_DEVICE_ID', 'D3DM_DEVICE_DESCRIPTION', 'D3DM_ENABLE_METALFX',
  'WINEMSYNC', 'WINEESYNC', 'ROSETTA_ADVERTISE_AVX', 'MTL_HUD_ENABLED',
] as const;
const ALLOWED_KEYS = new Set<string>(MAC_PROFILE_ENV_KEYS);
const VALUE = /^[\w .:+-]{1,64}$/;
const ENGINES = new Set<string>(['crossover', 'crossover-preview', 'crossover-preview-fex', 'highball']);

export interface MacProfile {
  engine?: MacEngine;
  env: Record<string, string>;
  note?: string;
}

export type MacProfiles = Record<string, MacProfile>;

const BUNDLED = new URL('../../assets/mac-profiles.json', import.meta.url);

/** Validates profiles keyed by Store product ID; invalid parts are dropped with a log line. */
export function parseMacProfiles(raw: unknown, log: (line: string) => void = console.warn): MacProfiles {
  const profiles: MacProfiles = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    log('mac-profiles: il file dei profili non è un oggetto; nessun profilo caricato.');
    return profiles;
  }
  for (const [id, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { log(`mac-profiles: profilo ${id} ignorato (non è un oggetto).`); continue; }
    const value = entry as { engine?: unknown; env?: unknown; note?: unknown };
    const profile: MacProfile = { env: {} };
    if (value.engine !== undefined) {
      if (typeof value.engine === 'string' && ENGINES.has(value.engine)) profile.engine = value.engine as MacEngine;
      else log(`mac-profiles: ${id}: motore ${JSON.stringify(value.engine)} ignorato.`);
    }
    if (value.env !== undefined) {
      if (value.env && typeof value.env === 'object' && !Array.isArray(value.env)) {
        for (const [key, setting] of Object.entries(value.env as Record<string, unknown>)) {
          if (!ALLOWED_KEYS.has(key)) { log(`mac-profiles: ${id}: variabile ${key} non consentita, ignorata.`); continue; }
          if (typeof setting !== 'string' || !VALUE.test(setting)) { log(`mac-profiles: ${id}: valore di ${key} non valido, ignorato.`); continue; }
          profile.env[key] = setting;
        }
      } else log(`mac-profiles: ${id}: env ignorato (non è un oggetto).`);
    }
    if (typeof value.note === 'string') profile.note = value.note.slice(0, 200);
    profiles[id.toUpperCase()] = profile;
  }
  return profiles;
}

/** Reads the bundled assets/mac-profiles.json (or another file); a missing or broken file yields no profiles. */
export async function loadMacProfiles(file: string | URL = BUNDLED, log: (line: string) => void = console.warn): Promise<MacProfiles> {
  let text: string;
  try { text = await fs.readFile(file, 'utf8'); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') log(`mac-profiles: lettura non riuscita: ${(error as Error).message}`);
    return {};
  }
  try { return parseMacProfiles(JSON.parse(text), log); } catch (error) {
    log(`mac-profiles: JSON non valido: ${(error as Error).message}`);
    return {};
  }
}

export function macProfileFor(profiles: MacProfiles, storeId: string | undefined): MacProfile | undefined {
  if (!storeId) return undefined;
  return profiles[storeId.toUpperCase()];
}

/** The profile's engine wins only when that engine is installed; otherwise the global setting applies. */
export function effectiveMacEngine(setting: MacEngine | undefined, profile: MacProfile | undefined, installed: Partial<Record<MacEngine, boolean>>): MacEngine {
  // Preview is an explicit engine test; a bundled Highball recommendation
  // must not silently replace the edition the user chose to try.
  if (setting === 'crossover-preview' || setting === 'crossover-preview-fex') return setting;
  if (profile?.engine && installed[profile.engine]) return profile.engine;
  return setting ?? 'crossover';
}
