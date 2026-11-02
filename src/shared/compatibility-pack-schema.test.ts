import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCompatibilityCatalog, parseCompatibilityManifest } from './compatibility-pack-schema.mjs';
const reference = JSON.parse(readFileSync(new URL('../../assets/compatibility-packs/halo-preview-media-v1/manifest.json', import.meta.url), 'utf8'));
const route = (manifest: typeof reference) => Object.fromEntries(['id', 'storeId', 'engine', 'version', 'buildTag'].map(key => [key, manifest[key]]));

describe('compatibility pack metadata boundaries', () => {
  it('accepts the bundled catalog and Halo manifest', () => {
    const catalog = parseCompatibilityCatalog(JSON.parse(readFileSync(new URL('../../assets/compatibility-packs/catalog.json', import.meta.url), 'utf8')));
    expect(catalog.schemaVersion).toBe(1);
    expect(parseCompatibilityManifest(reference, route(reference) as Parameters<typeof parseCompatibilityManifest>[1]).id).toBe('halo-preview-media-v1');
  });
  it.each([
    ['id', '../escape'], ['id', 'CASE-COLLISION'], ['schemaVersion', 2], ['kind', 'shell-script'], ['recipe', 'download-and-execute'], ['buildPathPolicy', 'absolute-source'], ['buildPathPolicy', undefined],
    ['engine', 'crossover-preview-fex'], ['engineDirectory', '../bottles'], ['engineDirectory', 'Bottles'],
    ['appName', 'MACxus ../Other.app'], ['appName', 'MACxus Bad\nName.app'],
    ['dlls', { '../escape.dll': 'a'.repeat(64) }], ['dlls', { 'mfplat.dll': 'invalid' }],
    ['unixLibraries', { '../escape.so': 'a'.repeat(64) }],
    ['environment', { DYLD_INSERT_LIBRARIES: '/untrusted' }], ['environment', { WINEPREFIX: '/other-game' }],
    ['environment', { MACXUS_TEST: 'a\nb' }], ['source', { ...reference.source, archive: '../source.tar.gz' }],
    ['patch', { ...reference.patch, path: 'assets/runtime-patches/../outside.patch' }],
  ])('rejects unsafe or unsupported %s metadata (%j)', (key, value) => {
    expect(() => parseCompatibilityManifest({ ...reference, [key]: value })).toThrow('Invalid compatibility pack');
  });
  it.each([
    { project: '..' }, { platform: '../WinGDK' }, { file: '../Engine.ini' }, { section: 'SystemSettings]\n[Other' },
    { values: { 'Key\nInjected': '1' } }, { values: { Key: '1\nInjected=1' } }, { kind: 'execute' }, { values: { Option: '1', option: '2' } },
  ])('rejects configuration path and INI injection: %j', changes => {
    expect(() => parseCompatibilityManifest({ ...reference, configuration: [{ ...reference.configuration[0], ...changes }] })).toThrow();
  });
  it('rejects duplicate IDs, ambiguous build routes, and manifest mismatches', () => {
    const one = route(reference), two = { ...one, id: 'another-pack' };
    for (const packs of [[one, one], [one, two]]) expect(() => parseCompatibilityCatalog({ schemaVersion: 1, packs })).toThrow(/duplicate|ambiguous/);
    expect(() => parseCompatibilityManifest(reference, { ...one, storeId: '111111111111' } as never)).toThrow('manifest/catalog mismatch');
    expect(() => parseCompatibilityManifest({ ...reference, configuration: [reference.configuration[0], reference.configuration[0]] })).toThrow('duplicate INI');
  });
});
