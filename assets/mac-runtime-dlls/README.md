# MACxus patched runtime DLLs

PE builds of the Xodus Nexus runtime release `xodus-nexus-runtime-11.0-20261022-gf4adc821`
(Wine 11.0 sources, LGPL-2.1-or-later) with the macOS patches in `assets/runtime-patches`:

| DLL | Patches |
| --- | --- |
| `xgameruntime.dll` | `wine-macos-gs-last-error.patch`, `xgameruntime-xstore-queries.patch` |
| `windows.web.dll`, `twinapi.appcore.dll`, `gamingtcui.dll`, `winhttp.dll` | `wine-macos-gs-last-error.patch` |

The launcher installs them only on that runtime release (see `manifest.json`). A DLL placed in
`~/Library/Application Support/MACxus/runtime-overrides` takes precedence.

Rebuild: apply the patches to the runtime's Wine tree, `configure` for PE only, then
`make dlls/<name>/x86_64-windows/<name>.dll` (needs `x86_64-w64-mingw32-gcc` and Homebrew bison
on `PATH`).

These generated DLLs are ignored by Git. `npm run prepare:mac-runtime-dlls` restores
them on macOS from the owner's pinned `v0.3.11-mac.5` DMG, verifying both the image
checksum and every DLL against `manifest.json`. It mounts the image read-only and
does not execute anything from it. Existing matching files are reused, including
locally rebuilt files with the same hashes. Changing runtime or patch versions
requires updating the manifest and preparation source together.

`npm run dist:mac` prepares these assets automatically. Packaging and the bundle
smoke check verify all five DLLs inside the actual ASAR; missing, corrupt or
mismatched files fail the build. `libnghttp2.dll` comes from the installed Nexus
runtime and is not one of these patched assets.
