# d3d12 shim (GPL-3.0)

`d3d12.dll` is a proxy that MACxus puts in front of Apple's D3DMetal on the Highball engine, only for
games that ask for it with `HB_D3D12_TSSHIM=1` (a per-game profile in `assets/mac-profiles.json`, or
launch options). It fills D3D12 gaps D3DMetal leaves and, on GPUs without variable rate shading
(Apple M1), hands pixel shaders that read `SV_ShadingRate` to D3DMetal with that input read as
`SV_ViewportArrayIndex`, so Metal accepts the pipelines. Without it Forza Horizon 6 draws no menus
on an M1 Max (148 refused pipelines). See `docs/DISCOVERIES.md`, item 19.

## Origin

- `src/d3d12.c`, `src/d3d12.def`: Highball's tsshim, by Gauthier Piarrette,
  https://github.com/gauthierpiarrette/highball (GPL-3.0), with the changes below.
- `src/dxil_shadingrate.c`, `src/dxil_shadingrate.h`, `src/inspect.c`, `src/inspect.h` and the
  `SV_ShadingRate`/blend changes in `src/d3d12.c`: MetalHorizon, by alexandreunitypro,
  https://github.com/alexandreunitypro/MetalHorizon-FH6-Mac-Launcher, `tools/tsshim` at commit
  `903a55f771bf55cbd766589ad33e3f7179632e24` (GPL-3.0).
- `src/ORIGIN.md` is MetalHorizon's own note, unchanged.

The files are copied unchanged. They stay under the GNU General Public License version 3
(`LICENSE`). The rest of MACxus is MIT; the shim is a separate program that MACxus ships beside it.

## Build

`node scripts/build-d3d12-shim.mjs` (mingw-w64 cross compiler) compiles the sources and writes the
Wine builtin marker at offset 0x40. The launcher copies the result into
`<data>/highball-d3d12-shim/wine/x86_64-windows/` and lays D3DMetal's `d3d12.dll` beside it as
`apd12.dll`.
