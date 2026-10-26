import { expect, it } from 'vitest';
import { crossOverDlssEnvironment } from './mac-dlss.js';

it.each(['crossover', 'crossover-preview', 'crossover-preview-fex'])('sets the same DLSS flags for %s without mutating its bottle or parent environment', engine => {
  const source = { KEEP: 'unchanged', CX_ENV: 'OTHER="two words" D3DM_ENABLE_METALFX=0' };
  const enabled = crossOverDlssEnvironment(source, engine, true, '25.0.0');
  expect(enabled).toEqual({ ...source, D3DM_ENABLE_METALFX: '1', DXMT_ENABLE_NVEXT: '1',
    CX_ENV: 'OTHER="two words" D3DM_ENABLE_METALFX=0 D3DM_ENABLE_METALFX=1 DXMT_ENABLE_NVEXT=1' });
  expect(source).toEqual({ KEEP: 'unchanged', CX_ENV: 'OTHER="two words" D3DM_ENABLE_METALFX=0' });
  // A different game's disabled setting must override inherited/bottle flags.
  const disabled = crossOverDlssEnvironment(enabled, engine, false, '25.0.0');
  expect(disabled.D3DM_ENABLE_METALFX).toBe('0');
  expect(disabled.DXMT_ENABLE_NVEXT).toBe('0');
  expect(disabled.CX_ENV).toMatch(/D3DM_ENABLE_METALFX=0 DXMT_ENABLE_NVEXT=0$/);
});

it.each(['23.0.0', '24.0.0'])('matches CrossOver on Darwin %s: DXMT extensions only before Tahoe', version => {
  const env = crossOverDlssEnvironment({}, 'crossover', true, version);
  expect(env.D3DM_ENABLE_METALFX).toBe('0');
  expect(env.DXMT_ENABLE_NVEXT).toBe('1');
  expect(env.CX_ENV).toBe('D3DM_ENABLE_METALFX=0 DXMT_ENABLE_NVEXT=1');
});

it.each(['highball', ''])('leaves %s launches unchanged', engine => {
  const source = { D3DM_ENABLE_METALFX: 'custom', CX_ENV: 'OTHER=1' };
  expect(crossOverDlssEnvironment(source, engine, true, '26.0.0')).toEqual(source);
});
