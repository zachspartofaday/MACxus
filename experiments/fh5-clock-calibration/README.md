# Experimental FH5 clock calibration

This is a separate opt-in experiment on top of the accepted FH5 Preview pack,
not an update to its payload, manifest, source archive or installed application.
No game code or vendor implementation is included. It targets the same single
M5 Max / Rosetta Preview 20261015 / Metal 4 configuration. It has no game
acceptance yet. It does not establish input-to-display latency or performance.

The existing queue's `GetClockCalibration` returns `E_NOTIMPL`. Prior live traces
observe FH5 calling it repeatedly. The experiment adds a Wine builtin PE module
and matching Unix companion, loaded using Wine's own synchronous Unix-call ABI.
The companion calls an export in the injected Metal timestamp bridge and uses
the exact `MTLDevice` held by that bridge. It does not use file, socket or
environment-variable exchanges per sample, and does not substitute CPU time for
GPU time. The process keeps the companion loaded for its lifetime.

Metal `sampleTimestamps` supplies paired absolute CPU and GPU nanoseconds on the
tested device. Real query results use the device's reported 24 MHz ticks. The
native call converts sampled GPU nanoseconds to those ticks using 128-bit math.
Before and after sampling, short absolute/continuous CPU brackets constrain the
offset. Their intersection is recomputed for every call, rejects a detected
sleep transition and refuses an uncertainty interval wider than 100 microseconds.
Continuous nanoseconds become Preview's 10 MHz QPC units. The PE module checks
the actual guest frequency and brackets every result with actual guest QPC calls.
Unsupported conditions or failures leave both caller outputs untouched.

The graphics hook is enabled only with `MACXUS_GPU_CLOCK_CALIBRATION=1` before
first use. Missing/disabled companion or native bridge returns `E_NOTIMPL`;
there is no invented pair. This is not a general multi-adapter calibration
implementation. Null and identical output pointers are rejected when enabled.
No real host sleep/resume trial or long-session drift acceptance is claimed.

Build and run synthetic probes from the repository root, using an existing
private engine whose loader already allows native injection. Never change the
installed vendor engine to run this experiment:

```sh
python3 experiments/fh5-clock-calibration/build.py work/fh5-clock-experiment \
  --sdk /path/to/pinned/fresh-sdk \
  --engine '/path/to/private/Preview.app/Contents/SharedSupport/CrossOver'
```

The SDK layout is `wine-src` and `wine-build`, prepared by the pack's SDK recipe.
The optional `--prefix-template` is only for a previously synthetic account-free
prefix. The runner copies it into the new output, never edits the template, and
stops only the output's own Wine server. It launches no FH5 or account service.
Before Wine starts, linked write-directory ancestors, an external C: mapping and
linked registry files are rejected. The calibration DLL is copied into an
exclusively created sibling and atomically replaces its directory entry, so a
preserved template DLL link is detached without writing through it. Output
cannot be placed inside the template, SDK, engine or experiment source trees.
The original vendor loader ignores DYLD injection; using it correctly exercises
the unsupported path but cannot accept the injected calibration path.

The runner overlays reconstructed graphics source in its new output directory;
it does not edit pack source. It records binaries, per-probe logs and hashes
under that ignored directory. Tests cover mathematical offset/error bounds,
100,000 simulated sleep transitions and post-resume offsets, sanitizer checks,
64 real native Metal query brackets, 1,024 actual guest QPC brackets, eight
concurrent callers, unsupported/null paths, disabled hook contracts, and 32
real D3D12 query submissions with reset, repeated resolve and future queue waits.

Portable production packaging, pinning/reproducibility of the new modules and
normal Play integration remain follow-ups. This experiment must not be staged
as the existing accepted pack. Keep raw logs and any future private controller,
prefix, account details or game files out of contribution artifacts.
