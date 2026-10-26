export interface CompatibilityRoute {
  id: string; storeId: string; engine: 'crossover' | 'crossover-preview'; version: string; buildTag: string;
}
export interface UnrealIniAction {
  kind: 'unreal-ini'; project: string; platform: 'Windows' | 'WinGDK'; file: 'Engine.ini' | 'Game.ini';
  section: string; values: Record<string, string>; readOnly: boolean;
}
export interface CompatibilityManifest extends CompatibilityRoute {
  schemaVersion: 1; kind: 'wine-engine-overlay'; recipe: 'wine-pe-v1'; name: string;
  engineDirectory: string; appName: string; dlls: Record<string, string>; originalDLLs: Record<string, string>;
  unixLibraries: Record<string, string>; environment: Record<string, string>; configuration: UnrealIniAction[];
  source: { url: string; archive: string; sha256: string; wineSubdirectory: string };
  patch: { path: string; sha256: string };
  sources: Record<string, { originalSHA256: string; patchedSHA256: string }>;
  buildTimestamps: Record<string, number>; licenseSHA256: string;
}
export function parseCompatibilityCatalog(value: unknown): { schemaVersion: 1; packs: CompatibilityRoute[] };
export function parseCompatibilityManifest(value: unknown, entry?: CompatibilityRoute): CompatibilityManifest;
export function configurationPath(action: UnrealIniAction): string;
