# FH5 active-target blend experiment

This default-off candidate tests the broader blend-policy idea from
[xvferxedd/fh5-d3dmetal-fix](https://github.com/xvferxedd/fh5-d3dmetal-fix/blob/83944060dee664bee18b44d35a1fca63b86edc0e/src/d3d12.c#L520).
Our existing correction disables blending that targets an absent render target.
This experiment also addresses SRC1 factors on active-target pipelines whose
pixel shader lacks the genuine SV_Target0/SV_Target1 output pair.

`MACXUS_FH5_ACTIVE_BLEND=1` enables it within the pack's existing append-only
pipeline path; unset or `0` retains the accepted baseline. Shader bytecode and
caller-owned descriptions remain unchanged. The candidate uses the pack's
read-only metadata parser, preserves malformed/unsupported/ambiguous signatures,
preserves a genuine two-target output pair, and only edits active enabled blend
state. Unknown or duplicate pipeline-stream subobjects refuse the rewrite.
No new shader substitution, descriptor-stride translation, unwind workaround,
timing change or memory-policy change is included.

Replacing an unavailable second source with the first source is an explicit
compatibility policy. It does not establish Windows parity or prove that every
rewritten game pipeline has the intended appearance.

## Observed synthetic behavior

Tests ran on the existing M5 Max / pinned Preview renderer using owned shaders
only. No account or FH5 was used. Both pipeline APIs and optional depth output
were checked for each colour-output count, with the switch off and on:

| Pixel colour outputs | Switch off | Switch on |
| --- | --- | --- |
| SV_Target0 only | Draw skipped | Pixels match explicit SRC-factor reference |
| SV_Target0 + SV_Target1 | Genuine dual-source blend | Identical genuine dual-source blend; differs from SRC reference |
| SV_Target0 + SV_Target1 + SV_Target2 (and optional SV_Target3) | Draw skipped | Pixels match explicit SRC-factor reference |

All 32 rendering combinations matched these expectations. Production-derived
contracts passed 2,862 checks, including all eight-target signature masks for
OSGN/OSG5/OSG1, factor mappings, disabled/unknown targets, copied descriptors,
unchanged shader bytes, the off switch and direct/stream consistency.

Compile the probe with the recorded MinGW toolchain:

```sh
x86_64-w64-mingw32-g++ -O2 -Wall -static -static-libgcc \
  -Wl,--no-insert-timestamp assets/fh5-preview/source/tests/active-blend.cpp \
  -o /path/to/new/active-blend.exe -ld3dcompiler
```

The regular source-pack builder also compiles `active-blend-contracts.exe`.
Run the account-free comparisons with new output storage:

```sh
python3 experiments/fh5-active-blend/run-render-probes.py \
  --engine /path/to/Preview.app/Contents/SharedSupport/CrossOver \
  --proxy /path/to/build/payload/d3d12.dll \
  --probe /path/to/active-blend.exe \
  --contracts /path/to/build/probes/active-blend-contracts.exe \
  --output /path/to/new/blend-evidence
```

The script creates and stops only its owned prefix. Its control expects the
observed converter failures and therefore targets this pinned renderer, not a
future renderer that might handle the original pipelines itself.

## Game comparison pending

Use the same graphics settings and benchmark corner as the baseline. Record
missing banners, black road regions and any new visual problems separately.
Bounded numeric diagnostics identify applied rewrites without shader dumps or
account data. A successful compile or a restored synthetic triangle does not
count as FH5 acceptance, and additional restored draws can increase GPU work.
Do not use a shader-compiling diagnostic run as a performance comparison.

Only after the game comparison should the policy be considered for default
activation. The installed accepted app and previous source branch remain
available for rollback during this local experiment.
