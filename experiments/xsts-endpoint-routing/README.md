# Shared authentication endpoint investigation

007 First Light continued to run after installing the fork's merged #22–#24
runtime, but online access still failed. Its existing Play log contains six
`xsts_authorize_privilege` failures with HTTP 400. The runtime was selected from
the override directory, loaded natively from system32, and the bottle's copy
matched the installed override. The account bridge was ready and the backend
reported successful content-license parsing. Those earlier successes do not
establish that Xbox online authentication completed.

FH5's earlier XSTS requests also returned HTTP 400. Its investigation established
that the guessed game-service origin was not its registered token audience;
Windows title authentication and authenticated title-endpoint discovery resolved
that part of the failure. That work became #22. FH5 still required other fixes
before gameplay and online access worked.

The package metadata differs: FH5 omitted MSAAppId, while 007 declares one. The
latter uses the preserved SISU branch. The shared endpoint matcher is used after
either identity path. The old matcher fails synthetic catch-all/trailing-star,
repeated-suffix backtracking and DNS-case fixtures. Such a miss can route a token
request through the existing guessed-origin fallback instead of the service's
supplied audience. This is a reproduced shared defect; the current 007 log does
not contain its requested audience or endpoint-match outcome, so attribution of
007's rejection to this defect remains unproven.

The candidate repairs those wildcard cases and adds numeric refusal diagnostics.
It does not switch the SISU identity to another app, guess a replacement audience,
remove title claims, or convert an Xbox denial into success. It contains no game
code, account data, game-specific routing rules or runtime path constants.

## Validation and limits

- The old production-derived endpoint probe fails the new regressions with exit
  42; the candidate is tested against the same fixtures.
- Source reconstruction starts from pinned Git objects and verifies every patch
  and all 36 locked runtime source hashes. All 23 implementation C objects are
  rebuilt using the matching generated Wine SDK; this is not a from-zero SDK or
  toolchain reproduction claim.
- Account-free Wine probes exercise endpoint lookup, legacy title request
  construction, privilege handling, token ABI and initialization. Synthetic XSTS
  error bodies cover numeric bounds, malformed/type-mismatched values and keeping
  messages/redirects out of the new diagnostic output. Privilege refusals remain
  failures.
- The build retains the existing macOS GS last-error header correction for its
  local component checks. This host-specific input is separate from the shared
  source patch.
- No game, account service or live authentication probe is started for this
  investigation. The installed runtime, applications and ordinary bottles are
  unchanged by the candidate work.

Before claiming an online fix, test a controlled 007 run and inspect the new
`endpoint_metadata`, `xerr_present`, `xerr` and `title` fields if authorization
still fails. A successful token request also needs validation against the game's
actual online service. Preserve the numeric refusal rather than treating HTTP
400 as proof of a particular title/audience/account problem.
