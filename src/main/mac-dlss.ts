import { release } from 'node:os';

/** Match CrossOver's DLSS toggle without changing the shared bottle config.
 * CX_ENV is applied after bottle EnvironmentVariables by CrossOver's wine
 * launcher. Inherited D3DM/DXMT variables alone can be overwritten there.
 * Keep both flags explicit so an off game cannot inherit an on bottle. */
export function crossOverDlssEnvironment(
  source: NodeJS.ProcessEnv,
  engine: string,
  enabled: boolean,
  darwinRelease = release(),
): NodeJS.ProcessEnv {
  if (!['crossover', 'crossover-preview', 'crossover-preview-fex'].includes(engine)) return source;
  // macOS Tahoe is Darwin 25. CrossOver enables D3DMetal's MetalFX path only
  // there or newer; DXMT's NV extensions also work on Sonoma and Sequoia.
  const metalFx = enabled && Number.parseInt(darwinRelease, 10) >= 25 ? '1' : '0';
  const nvExtensions = enabled ? '1' : '0';
  return {
    ...source,
    D3DM_ENABLE_METALFX: metalFx,
    DXMT_ENABLE_NVEXT: nvExtensions,
    CX_ENV: [source.CX_ENV, `D3DM_ENABLE_METALFX=${metalFx} DXMT_ENABLE_NVEXT=${nvExtensions}`].filter(Boolean).join(' '),
  };
}
