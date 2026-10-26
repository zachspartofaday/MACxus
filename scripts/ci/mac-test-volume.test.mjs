import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detachMacTestVolume } from '../mac-test-volume.mjs';

test('retries transient busy volumes with bounded backoff, then succeeds', async () => {
  const calls = [], waits = [];
  await detachMacTestVolume('/temporary fixture path', {
    run: (tool, args) => {
      calls.push([tool, args]);
      if (calls.length < 3) throw Object.assign(new Error('Resource busy'), { status: 16 });
    },
    wait: async ms => { waits.push(ms); }, log: () => {},
  });
  assert.deepEqual(calls, Array(3).fill(['hdiutil', ['detach', '/temporary fixture path']]));
  assert.deepEqual(waits, [250, 500]);
});

test('persistent busy errors stop after five attempts without force-ejecting', async () => {
  const error = Object.assign(new Error('Resource busy'), { status: 16 });
  let calls = 0;
  const waits = [];
  await assert.rejects(detachMacTestVolume('/fixture', {
    run: () => { calls++; throw error; }, wait: async ms => { waits.push(ms); }, log: () => {},
  }), failure => failure === error);
  assert.equal(calls, 5);
  assert.deepEqual(waits, [250, 500, 1000, 2000]);
});

test('permission and tool failures propagate immediately', async () => {
  for (const error of [Object.assign(new Error('Denied'), { status: 1 }), Object.assign(new Error('Missing'), { code: 'ENOENT' })]) {
    let calls = 0;
    await assert.rejects(detachMacTestVolume('/fixture', {
      run: () => { calls++; throw error; },
      wait: () => { throw Error('Must not retry'); }, log: () => {},
    }), failure => failure === error);
    assert.equal(calls, 1);
  }
});
