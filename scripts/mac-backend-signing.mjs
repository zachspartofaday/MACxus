import path from 'node:path';
import { copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const binaries = ['xodus-cli', 'xodus-service'];
/**
 * One identifier for both shipping names. macOS binds a Keychain grant to the
 * binary's code hash and resets an item's partition list whenever a non-Team-ID
 * binary updates it, so two different binaries writing the same item prompt each
 * other forever. xodus-service is therefore a byte-identical copy of xodus-cli
 * (the role comes from the file name): one code hash, one grant per build.
 */
export const BACKEND_CODE_IDENTIFIER = 'io.macxus.xodus';
const execute = (tool, args) => execFileSync(tool, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** No Keychain lookup unless a maintainer explicitly requests certificate signing. */
export function resolveMacSigningIdentity(requested, run = execute) {
  const selector = requested?.trim();
  if (!selector) return null;
  // No -v: a self-signed root such as "MACxus Local Signing" is reported as
  // CSSMERR_TP_NOT_TRUSTED yet still signs. That listing repeats identities, so
  // match each certificate once by fingerprint.
  const output = run('security', ['find-identity', '-p', 'codesigning']);
  const identities = [...new Map([...output.matchAll(/^\s*\d+\)\s+([a-f\d]{40})\s+"(.*?)"(?:\s+\([^)]*\))?\s*$/gim)]
    .map(match => [match[1].toUpperCase(), { hash: match[1].toUpperCase(), name: match[2] }])).values()];
  const matches = identities.filter(item => item.hash === selector.toUpperCase() || item.name === selector);
  if (matches.length !== 1) throw Error('MACXUS_SIGNING_IDENTITY must match exactly one valid code-signing identity in the build Keychain. Use its SHA-1 fingerprint to disambiguate.');
  return matches[0].hash;
}

export function verifyMacBackendSigning(directory, identity, run = execute) {
  if (identity === null) return;
  if (!/^[A-F\d]{40}$/.test(identity)) throw Error('Invalid backend signing certificate fingerprint.');
  const requirement = `=identifier "${BACKEND_CODE_IDENTIFIER}" and certificate leaf = H"${identity}"`;
  for (const name of binaries) {
    run('codesign', ['--verify', '--strict', '--test-requirement', requirement, path.join(directory, name)]);
  }
}

/**
 * Sign the copy in the shipping bundle, never Cargo's reusable build output.
 * xodus-cli is signed once and then copied to xodus-service so both files are
 * identical bytes (the same signature, hence the same code hash).
 */
export function signMacBackend(directory, identity, run = execute, copy = copyFileSync) {
  if (identity === null) return;
  if (!/^[A-F\d]{40}$/.test(identity)) throw Error('Invalid backend signing certificate fingerprint.');
  const [cli, service] = binaries;
  run('codesign', ['--force', '--sign', identity, '--identifier', BACKEND_CODE_IDENTIFIER, path.join(directory, cli)]);
  copy(path.join(directory, cli), path.join(directory, service));
  verifyMacBackendSigning(directory, identity, run);
}
