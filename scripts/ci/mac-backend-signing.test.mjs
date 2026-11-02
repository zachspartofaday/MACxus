import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolveMacSigningIdentity, signMacBackend, verifyMacBackendSigning } from '../mac-backend-signing.mjs';

const fingerprint = 'AB'.repeat(20);
const listing = `  1) ${fingerprint} "Developer ID Application: Fixture (TEAM)"\n  2) ${'CD'.repeat(20)} "Other"\n     2 valid identities found`;

test('default ad-hoc builds never inspect the Keychain or re-sign binaries', () => {
  const unexpected = () => { throw Error('Unexpected signing tool invocation'); };
  for (const value of [undefined, '', '  ']) assert.equal(resolveMacSigningIdentity(value, unexpected), null);
  signMacBackend('/bundle', null, unexpected);
  verifyMacBackendSigning('/bundle', null, unexpected);
});

test('explicit certificate selection is exact, unique and bound to its fingerprint', () => {
  const run = (command, args) => {
    assert.equal(command, 'security');
    assert.deepEqual(args, ['find-identity', '-p', 'codesigning']);
    return listing;
  };
  assert.equal(resolveMacSigningIdentity('Developer ID Application: Fixture (TEAM)', run), fingerprint);
  assert.equal(resolveMacSigningIdentity(fingerprint.toLowerCase(), run), fingerprint);
  assert.throws(() => resolveMacSigningIdentity('Fixture', run), /exactly one/);
  assert.throws(() => resolveMacSigningIdentity('missing', run), /exactly one/);
  assert.throws(() => resolveMacSigningIdentity('Other', () => listing + `\n  3) ${'EF'.repeat(20)} "Other"`), /disambiguate/);
});

test('an untrusted self-signed certificate listed twice is still one exact identity', () => {
  const selfSigned = '22'.repeat(20);
  const untrusted = `Policy: Code Signing\n  Matching identities\n  1) ${selfSigned} "MACxus Local Signing" (CSSMERR_TP_NOT_TRUSTED)\n     1 identities found\n\n  Valid identities only\n     0 valid identities found`;
  assert.equal(resolveMacSigningIdentity('MACxus Local Signing', () => untrusted + `\n  2) ${selfSigned} "MACxus Local Signing" (CSSMERR_TP_NOT_TRUSTED)`), selfSigned);
});

test('xodus-cli is signed once with one identifier and copied byte for byte to xodus-service, then both are verified', () => {
  const calls = [], copies = [];
  signMacBackend('/bundle', fingerprint, (command, args) => { calls.push([command, args]); return ''; }, (from, to) => copies.push([from, to]));
  assert.deepEqual(calls[0], ['codesign', ['--force', '--sign', fingerprint, '--identifier', 'io.macxus.xodus', '/bundle/xodus-cli']]);
  assert.deepEqual(copies, [['/bundle/xodus-cli', '/bundle/xodus-service']]);
  assert.deepEqual(calls.slice(1), ['xodus-cli', 'xodus-service'].map(name => ['codesign', [
    '--verify', '--strict', '--test-requirement', `=identifier "io.macxus.xodus" and certificate leaf = H"${fingerprint}"`, `/bundle/${name}`,
  ]]));
  assert.equal(calls.length, 3);
});

test('macOS compiles both generated code requirements as literal text', { skip: process.platform !== 'darwin' }, () => {
  verifyMacBackendSigning('/bundle', fingerprint, (_command, args) => {
    const parsed = execFileSync('/usr/bin/csreq', ['-r', args[3], '-t'], { encoding: 'utf8' });
    assert.match(parsed, /identifier "io\.macxus\.xodus"/);
    assert.match(parsed, /certificate leaf = H"abab/i);
  });
});

test('missing certificates, failed signing and mismatched signatures stop the build without fallback', () => {
  const failure = () => { throw Error('Signing unavailable'); };
  assert.throws(() => resolveMacSigningIdentity('requested', failure), /Signing unavailable/);
  assert.throws(() => signMacBackend('/bundle', fingerprint, failure, () => {}), /Signing unavailable/);
  assert.throws(() => verifyMacBackendSigning('/bundle', fingerprint, failure), /Signing unavailable/);
  assert.throws(() => signMacBackend('/bundle', '-'), /fingerprint/);
});
