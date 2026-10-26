# Halo movies with CrossOver Preview (experimental)

Halo: Campaign Evolved (`9N683TDT5M7R`) played startup movies with picture and
sound using this source patch in a separate **CrossOver Preview Rosetta
20261015** engine and disposable bottle. Some stutter was reported with verbose
diagnostics enabled. Later cinematics and playback with minimal logging still
need testing. This does not establish compatibility with FEX/ARM Preview.

This patches Wine's Media Foundation decoder, not Halo's executable or media.
It is a maintainer experiment, not a launcher feature or a distributed runtime.
No default game profile, shared bottle or installed CrossOver is changed.

## Supported experiment

The exact source, patch, original engine DLLs and tested output hashes are in
[`preview-media-experiment.lock.json`](../scripts/preview-media-experiment.lock.json).
The build uses the publicly available **CrossOver 26.3.0 Wine sources**, because
matching Preview sources were unavailable. Two private-interface fields are
adapted for the tested Preview: `wg_sample.stride` and
`wg_transform_attrs.output_plane_stride`. They are required even when the
software-output opt-in is off. Do not use these replacement DLLs with stable
26.3, another Preview build or an ARM64 engine.

The software-output opt-in exposes system-memory NV12, reports no D3D awareness,
rejects a D3D device manager and provides decoder-owned `IMF2DBuffer` samples.
Without the opt-in, the patched decoder retains its base-source format and
D3D-awareness behavior. This is not proof that every other media interface
matches Preview; keep the experiment isolated to Halo.

## Rebuild

Use macOS with Xcode command-line tools, GNU Bison 3.8 or later, GNU Make and
MinGW-w64's `x86_64-w64-mingw32-strip`. Homebrew Bison is keg-only, so put its
`bin` directory on the build process's `PATH`.

1. Create a new temporary experiment directory outside the repository and
   download the source archive specified by the lock. Verify its SHA-256 before
   extracting `sources/wine/` there.
2. Verify the three original source hashes in the lock. From the extracted Wine
   source directory, apply
   `assets/runtime-patches/crossover-preview-halo-mf-software-output.patch`
   using `patch -p1`. Verify the three resulting hashes in the lock.
3. Make a separate build directory alongside the extracted Wine source and run:

   ```sh
   CC="clang -arch x86_64" CXX="clang++ -arch x86_64" \
     ../sources/wine/configure \
     --host=x86_64-apple-darwin --enable-win64 --enable-archs=x86_64 \
     --without-x --without-wayland --without-gstreamer --enable-winegstreamer \
     --without-cups --without-pulse --without-alsa --without-oss --without-dbus \
     --without-gphoto --without-sane --without-v4l2 --without-pcap --without-usb \
     --without-capi --without-freetype --without-gnutls --without-opengl \
     --without-vulkan --disable-tests
   make -j8 dlls/winegstreamer/x86_64-windows/winegstreamer.dll \
     dlls/mfplat/x86_64-windows/mfplat.dll
   ```

4. Copy those two PE DLLs into a separate output directory and strip their debug
   symbols using `x86_64-w64-mingw32-strip --strip-debug`. Record their hashes.
   The tested hashes identify the accepted local artifacts; different compiler
   versions can produce different bytes and require new candidate validation.

Only PE DLLs are built. Retain Preview's own Unix `winegstreamer.so` and its
GStreamer libraries. The recorded patch was applied to clean source and verified
to reproduce all three candidate source files exactly.

## Isolated game test

- First verify the installed Preview version and original DLL hashes against the
  lock. Make a separate copy with `ditto --noqtn --noextattr --norsrc`. Give it a
  unique name and bundle identifier, then replace only that copy's two DLLs in
  `Contents/SharedSupport/CrossOver/lib/wine/x86_64-windows/`.
- Locally ad-hoc sign the test app with `codesign --force --sign - --timestamp=none`
  and verify it with `codesign --verify --deep --strict` before execution. Do not
  disable Gatekeeper or modify the original app to resolve a signature failure.
- Use a disposable bottle and a separate game clone. Preserve game files, saves
  and credentials in the normal installation. Run Halo through the same signed
  Xodus backend, with save synchronization disabled (`XODUS_SAVE_SYNC=none`).
  Never re-sign the backend or broaden Keychain access for this experiment.
- Set `MACXUS_MF_SOFTWARE_OUTPUT=1` only for the isolated Halo process. In its
  disposable bottle, add the following to Meteorite's
  `Saved/Config/WinGDK/Engine.ini` (and `Windows/Engine.ini` if that configuration
  directory is used), then make those test files read-only:

  ```ini
  [SystemSettings]
  Electra.Win.H264UseOldOutputPath=1
  Electra.Win.H265UseOldOutputPath=1
  ```

- Compare startup movies and an opening cinematic with minimal logging first.
  Enable `+mfplat,+winegstreamer` only for a bounded diagnostic capture. The
  confirmed run produced about 77 MB of trace logs; it is unsuitable for a
  performance conclusion. Stop only the disposable prefix after the test.

The direct H.264 decoder test returned 90 frames from 90 compressed packets,
including 90 `IMF2DBuffer` samples. Four additional file-decoding comparisons
passed for the logo and opening-cinematic files with the opt-in on and off. The
full game test exited cleanly, and the user confirmed picture and audio. Raw
logs, movie packets, prefixes and game files are intentionally not committed.

## Distribution boundary

No rebuilt DLL or vendor application is committed or automatically installed.
The existing winevideo license-confirmation requirement in
[THIRD_PARTY.md](THIRD_PARTY.md#winevideo-patches) still applies. A packaged,
game-scoped delivery mechanism, exact Preview source compatibility, minimal-log
pacing and later cinematics remain separate work before general distribution.
