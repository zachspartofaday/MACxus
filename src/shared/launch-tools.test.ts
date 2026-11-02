import { expect, it } from 'vitest';
import { commandWords, defaultLaunchTools, normalizeLaunchTools, parseLaunchOptions } from './launch-tools.js';

it('parses Steam-style environment, wrapper and trailing game arguments without shell evaluation', () => {
  expect(parseLaunchOptions('WINEDLLOVERRIDES="dxgi=n,b;winhttp=b" PROTON_ENABLE_WAYLAND=1 gamemoderun %command% --launcher-skip "two words"')).toEqual({
    environment: { WINEDLLOVERRIDES: 'dxgi=n,b;winhttp=b', PROTON_ENABLE_WAYLAND: '1' }, prefix: ['gamemoderun'], gameArgs: ['--launcher-skip', 'two words'],
  });
  expect(parseLaunchOptions('DXVK_HUD=')).toEqual({environment:{DXVK_HUD:''},prefix:[],gameArgs:[]});
  expect(commandWords('"/a path/it\'s tool" "literal $HOME" ""')).toEqual(["/a path/it's tool", 'literal $HOME', '']);
});

it.each(['mangohud %command% %command%', 'a%command%', 'bad "quote', 'bad\\', 'x && y', '$(touch bad)', 'x\ny', 'x\0y', 'x'.repeat(2049)])('rejects invalid or shell-based launch options: %s', value => {
  expect(() => parseLaunchOptions(value)).toThrow();
});

it.each(['WINEPREFIX=/other', 'XODUS_SOCKET=/other', 'WINE_DLL_FILE_MAP=bad', 'STEAM_COMPAT_DATA_PATH=/other'])('protects managed identity/prefix settings: %s', value => {
  expect(() => parseLaunchOptions(value)).toThrow('managed by Nexus');
});

it('validates persisted launch tool settings at the IPC boundary', () => {
  expect(normalizeLaunchTools(undefined)).toEqual(defaultLaunchTools);
  expect(() => normalizeLaunchTools({ ...defaultLaunchTools, mangoHud:'yes' })).toThrow();
  expect(() => normalizeLaunchTools({ ...defaultLaunchTools, dualSenseCompatibility:'yes' })).toThrow();
  expect(normalizeLaunchTools({ mangoHud:false, gamescope:false, gamescopeArgs:'', launchOptions:'' }).dualSenseCompatibility).toBe(false);
  expect(normalizeLaunchTools({ ...defaultLaunchTools, dualSenseCompatibility:true }).dualSenseCompatibility).toBe(true);
  expect(normalizeLaunchTools({ mangoHud:false, gamescope:false, gamescopeArgs:'', launchOptions:'' }).metalHud).toBe(false);
  expect(normalizeLaunchTools({ ...defaultLaunchTools, metalHud:true }).metalHud).toBe(true);
  expect(() => normalizeLaunchTools({ ...defaultLaunchTools, metalHud:1 })).toThrow();
  expect(() => normalizeLaunchTools({ ...defaultLaunchTools, gamescopeArgs:'-f --' })).toThrow();
  expect(normalizeLaunchTools({ ...defaultLaunchTools, launchOptions:' PROTON_ENABLE_WAYLAND=1 %command% ' }).launchOptions).toBe('PROTON_ENABLE_WAYLAND=1 %command%');
});

it('defaults DLSS off for older games and validates the per-game IPC value', () => {
  expect(normalizeLaunchTools({ mangoHud: false, gamescope: false, gamescopeArgs: '', launchOptions: '' }).dlss).toBe(false);
  expect(normalizeLaunchTools({ ...defaultLaunchTools, dlss: true }).dlss).toBe(true);
  for (const dlss of ['yes', 1, null, {}]) expect(() => normalizeLaunchTools({ ...defaultLaunchTools, dlss })).toThrow('Invalid DLSS setting.');
});

it('accepts a per-game executable override as a relative package path and drops an empty one', () => {
  expect(normalizeLaunchTools({ mangoHud: false, gamescope: false, gamescopeArgs: '', launchOptions: '' }).executable).toBeUndefined();
  expect(normalizeLaunchTools({ ...defaultLaunchTools, executable: '  Binaries/WinGDK/Game-WinGDK-Shipping.exe ' }).executable).toBe('Binaries/WinGDK/Game-WinGDK-Shipping.exe');
  expect(normalizeLaunchTools({ ...defaultLaunchTools, executable: 'Binaries\\WinGDK\\Game.exe' }).executable).toBe('Binaries/WinGDK/Game.exe');
  expect(normalizeLaunchTools({ ...defaultLaunchTools, executable: '   ' }).executable).toBeUndefined();
  for (const executable of ['/abs/Game.exe', 'C:\\Game.exe', '../Game.exe', 'a/../Game.exe', 'Game.dll', 'Game', 'x\0y.exe', 'x\ny.exe', `${'a'.repeat(500)}.exe`, 1, null, {}]) {
    expect(() => normalizeLaunchTools({ ...defaultLaunchTools, executable })).toThrow('Invalid executable override.');
  }
});
