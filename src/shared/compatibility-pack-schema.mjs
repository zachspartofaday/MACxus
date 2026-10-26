// Shared by the launcher and build/ASAR verification. Bundled metadata only;
// manifests cannot supply commands, arbitrary filesystem paths or loader variables.
const fail = message => { throw Error(`Invalid compatibility pack: ${message}.`); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const check = (condition, message) => { if (!condition) fail(message); };
const component = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/.test(value) && !value.includes('..');
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const engine = value => ['crossover', 'crossover-preview'].includes(value);
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 160 && !/[\x00-\x1f\x7f]/.test(value);
const relative = value => typeof value === 'string' && value.split('/').every(component);
const hashes = (value, names) => object(value) && Object.keys(value).length > 0 && Object.entries(value).every(([name, digest]) => names(name) && hash(digest));
const dll = name => component(name) && /^[a-z0-9_.-]+\.dll$/.test(name);

function route(entry) {
  check(object(entry) && typeof entry.id === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(entry.id) && typeof entry.storeId === 'string' && /^[A-Z0-9]{12}$/.test(entry.storeId) && engine(entry.engine)
    && component(entry.version) && component(entry.buildTag), 'catalog route');
}
export function parseCompatibilityCatalog(value) {
  check(object(value) && value.schemaVersion === 1 && Array.isArray(value.packs), 'catalog schema');
  const ids = new Set(), routes = new Set();
  for (const entry of value.packs) {
    route(entry);
    const key = JSON.stringify([entry.storeId, entry.engine, entry.version, entry.buildTag]);
    check(!ids.has(entry.id) && !routes.has(key), 'duplicate id or ambiguous game/engine build');
    ids.add(entry.id); routes.add(key);
  }
  return value;
}
export function parseCompatibilityManifest(value, entry) {
  route(value);
  check(value.schemaVersion === 1 && value.kind === 'wine-engine-overlay' && value.recipe === 'wine-pe-v1', 'schema or handler');
  if (entry) check(['id', 'storeId', 'engine', 'version', 'buildTag'].every(key => value[key] === entry[key]), 'manifest/catalog mismatch');
  check(text(value.name) && component(value.engineDirectory) && value.engineDirectory.toLowerCase() !== 'bottles', 'name or engine directory');
  check(typeof value.appName === 'string' && /^MACxus [A-Za-z0-9 ._-]{1,64}\.app$/.test(value.appName) && !value.appName.includes('..'), 'private application name');
  check(hashes(value.dlls, dll) && hashes(value.originalDLLs, dll)
    && JSON.stringify(Object.keys(value.dlls).sort()) === JSON.stringify(Object.keys(value.originalDLLs).sort()), 'DLL fingerprints');
  check(hashes(value.unixLibraries, name => component(name) && /^[a-z0-9_.-]+\.so$/.test(name)), 'Unix fingerprints');
  check(object(value.environment) && Object.entries(value.environment).every(([key, val]) =>
    /^MACXUS_[A-Z0-9_]{1,64}$/.test(key) && typeof val === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(val)), 'launch environment');
  check(Array.isArray(value.configuration), 'configuration actions');
  const targets = new Set();
  for (const action of value.configuration) {
    check(object(action) && action.kind === 'unreal-ini' && component(action.project)
      && ['Windows', 'WinGDK'].includes(action.platform) && ['Engine.ini', 'Game.ini'].includes(action.file)
      && typeof action.readOnly === 'boolean' && text(action.section) && /^[A-Za-z0-9_. /-]+$/.test(action.section)
      && object(action.values) && Object.keys(action.values).length > 0, 'Unreal INI action');
    check(new Set(Object.keys(action.values).map(key => key.toLowerCase())).size === Object.keys(action.values).length, 'duplicate INI keys');
    for (const [key, val] of Object.entries(action.values)) check(/^[A-Za-z0-9_.]+$/.test(key) && typeof val === 'string' && /^[A-Za-z0-9_. -]{1,160}$/.test(val), 'INI value');
    const target = JSON.stringify([action.project.toLowerCase(), action.platform, action.file]);
    check(!targets.has(target), 'duplicate INI destination'); targets.add(target);
  }
  check(object(value.source) && typeof value.source.url === 'string' && /^https:\/\/[^\s]+$/.test(value.source.url)
    && component(value.source.archive) && value.source.archive.endsWith('.tar.gz') && hash(value.source.sha256) && relative(value.source.wineSubdirectory), 'source archive');
  check(object(value.patch) && relative(value.patch.path) && value.patch.path.startsWith('assets/runtime-patches/') && value.patch.path.endsWith('.patch') && hash(value.patch.sha256), 'source patch');
  check(object(value.sources) && Object.keys(value.sources).length > 0 && Object.entries(value.sources).every(([name, digest]) =>
    relative(name) && object(digest) && hash(digest.originalSHA256) && hash(digest.patchedSHA256)), 'source fingerprints');
  check(object(value.buildTimestamps) && Object.keys(value.dlls).every(name => Number.isSafeInteger(value.buildTimestamps[name]) && value.buildTimestamps[name] >= 0)
    && hash(value.licenseSHA256), 'reproducible build or license');
  return value;
}
export function configurationPath(action) {
  return `drive_c/users/crossover/AppData/Local/${action.project}/Saved/Config/${action.platform}`;
}
