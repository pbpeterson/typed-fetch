# The audit ledger

What has already been audited, what was decided, and what the decision cost.

## Why this file exists

A reviewer asked to "find something" in this repository will find something.
That is a property of the instruction, not of the code. Over twenty review
passes have run here, and the same reports keep coming back — not because they
were wrong the first time, but because nothing recorded that they had been
adjudicated. An unrecorded verdict is re-litigated forever.

This file is the record. It has three parts, and each answers a different
repeat report:

1. **The evidence bar** — what a finding must clear before it is one.
2. **Adjudicated clean** — areas that have been checked, with the reasoning, so
   a later pass can read the argument instead of rebuilding it.
3. **Adjudicated closed** — reports that are correct about the code and still
   not defects, because the cost was weighed and the trade was taken.

It does not replace the two records that bind behavior:
[ADR 0003](./adr/0003-the-untrusted-fetch-conformance-boundary.md) states how
far the library distrusts an injected `fetch`, and
[ADR 0002](./adr/0002-refuse-a-clone-copy-that-cannot-confirm-the-branch.md)
states when a `clone()` copy is refused. A report that contradicts either is an
amendment to that ADR, not a bug report. `disclosure-channels.spec.ts` plays the
same role for the channels an error's data can reach a reader through.

## How to review this repository

Read `CONTRIBUTING.md` for the gates. Then, before reporting anything:

- **State the trigger.** The exact input or sequence, not a shape.
- **State the wrong outcome.** What a caller observes, not what could go wrong.
- **Check the suite.** Grep for a test that already asserts it. The suite has
  extensive regression coverage, and many findings are already pinned.
- **Prefer a failing test to an argument.** If a failing test cannot be written,
  it is not a finding yet.
- **An empty result is a good result.** Reporting nothing is a valid outcome of
  a review, and padding a report with style notes costs the next reviewer the
  time it saved this one.

Style, naming, comment wording, "consider adding a test", missing features, and
prose preferences are not findings. They are not deferred — they are out of
scope for a defect review.

## Adjudicated clean

Each entry was verified, most of them empirically. A later pass that wants to
re-open one should read the reasoning first and say what it gets wrong.

### The request path

- **Body custody on every refusal path.** Every throw between the `isResponse`
  call and the success return is covered by the response phase's catch in
  `typedFetch`, and `releaseResponseBody` is total: every read is guarded, and a
  primitive, a hostile Proxy body, and a non-object `body` all fall through. No
  path strands a body. The release call has its own guard, so a value too broken
  to release cannot replace the real cause.
- **No leaked listener, timer, or table entry survives a rejected call.** The
  library adds no listener to a signal and sets no timer. The only keyed tables
  written on the failure path are the identity `WeakMap`s.
- **The options snapshot's proxy invariants.** A frozen `options` carrying an own
  `fetch` does not trip a proxy `get` invariant; the `signal` slot is always
  re-declared configurable and writable, and the trap delegates with `options`
  as the receiver. `headers` is no longer replaced at all, so the shape that
  used to need the descriptor clone is now an ordinary read.
- **The init dictionary stays empty when the caller passes nothing**, so
  `typedFetch(request)` does not trip the Fetch Standard's "init is not empty"
  branch and does not detach the `Request`'s own signal.
- **Signal, abort, and timeout interleaving.** `typedFetch` runs in three
  phases, each with its own catch, and only the transport phase consults the
  signal. A network failure that merely coincides with an abort stays a
  `NetworkError`, and caller code in the setup or response phase cannot claim an
  abort at all. Nothing runs between the transport's rejection and its
  classification, because the request input is serialized before the request.
- **Header-container coverage is no longer a thing this library needs.** The
  collector matched WebIDL's `HeadersInit` conversion for a record, an array of
  pairs, a `Headers` instance, an inner pair that is any iterable, and a
  callable carrying own enumerable properties — and it was still defeated,
  because every one of those shapes can answer a SECOND read differently. The
  message is a library constant now — see ADR 0003's second amendment of
  2026-08-03 — so nothing reads the caller's `headers` but the transport.
- **The spec claims in `src/`.** 22 statements about the Fetch Standard, WebIDL,
  the Streams Standard, and the URL Standard were checked against the
  specification text and against an executed probe. 20 were correct, including
  the NUL/CR/LF refusal set, the whitespace normalization set,
  `FOREIGN_RESPONSE_TYPES` against the IDL enum, `signal: null` detaching, the
  synchronous `ReadableStreamCancel` chain, and the abort-reason mapping. The
  two that were wrong are fixed (the `ByteString` range check and the
  `getSetCookie` premise).
- **The ordinary paths.** HEAD and 404 with a null body, 204 and 304 on the
  success branch, an opaque response's real shape against
  `hasTypedResponseIdentityScalars`, `method` normalization, a used `Request`,
  and GET with a body. All behave as documented.

### The body lifecycle

- **`claimable()` versus `readStarted`, `bodyUsed`, and `body.locked`.** The one
  place `bodyUsed` is read twice in a single decision is unreachable as a defect:
  the divergent interleaving falls through to the release step, where cancelling
  a locked stream rejects and is swallowed — the same observable as the intended
  path.
- **Tee and branch bookkeeping under reentrancy.** Verified for a nested
  `clone()` inside a recreate callback, a recreate that cancels mid-clone, two
  clones of one error, a foreign copy whose ownership query re-enters `clone()`,
  a `Response` whose `clone()` returns itself, and a subclass that constructs
  another error inside its own constructor. Every branch got an owner and every
  cancel settled with the source freed.
- **Lent identity does not leak across calls.** Nothing between lending and the
  `try` can throw, and the `finally` covers all four exits. The status and field
  tables are written only after both the getter and the normalization succeed,
  so a mid-construction throw records nothing. Nested loans on one key are the
  stated residual.
- **`releaseResponseBody`** is hardened against hostile own getters, a replaced
  prototype, a shadowed `cancel`, a non-thenable return, a Proxy that refuses the
  prototype walk, and a non-Response argument.
- **`stageIdentity`'s rollback** drops exactly the tables the refused call wrote,
  and `IDENTITY_TABLES` is the whole set a successful read can write. A field
  fixed by an earlier ACCEPTED call survives, which is what keeps TF-20 true.

### What mutation testing measured

The suite was scored mechanically: 1580 mutations enumerated from the
TypeScript AST across every file under `src/`, each run against the 14 root spec
files. Two things are worth carrying forward.

- **The 40 status classes, `known-http-error`, and `unknown-http-error` score
  100%.** The hand-written roster and its per-class assertions leave nothing
  unprotected.
- **The survivors that mattered were 11 gaps where the code was RIGHT and
  nothing defended it.** Every one now has a test, and each test was verified to
  fail against the mutation and pass against the real source: the three
  `userinfo` shapes, the `cors`/`opaque`/`opaqueredirect` response types, the
  399 side of the 400 boundary, the tag gate and the field-presence gate, a
  `bodyUsed` that is not a boolean, a live UNaborted signal, the native-versus-
  visible stream release, the `readStarted` early return, and both `inspect`
  signposts.

A large share of the remaining survivors are EQUIVALENT MUTANTS — provably
unable to change behavior. They cluster in three places, and a future pass
should recognise them rather than re-report them: null and primitive guards
that sit in front of a `try`/`catch` which already returns the same verdict;
`typeof x === "function"` checks on intrinsics captured at module load, where
`Reflect.apply` would throw into the same `catch`; and `writable`/`configurable`
descriptor flags on prototype members no consumer path rewrites (`enumerable` is
killed everywhere it matters). `scripts/**` cannot participate at all — those
specs import from `scripts/*.mjs` and never touch `src/`.

### Other runtimes

Measured, not assumed, on Deno 1.46.3 and Bun 1.3.13 against both constructed
and network-backed responses.

- **The Bun `bodyUsed` divergence is real and stated correctly.** A bare
  `getReader()` sets `bodyUsed` on Bun and not on Node or Deno, and the
  dependent behavior follows: `cancel()` on an externally locked body resolves
  on Bun and rejects on Node and Deno. `bodyUsed` also latches after
  `releaseLock()` on Bun, and Bun's own `Response.text()` then throws, so the
  refusal is correct rather than a false negative.
- **Identity, redaction, `toJSON`, the five guards, class selection, and the
  success-surface check are byte-identical** on Deno and Bun to Node.
- **The inspect channel holds on all three.** `Deno.inspect` and `Bun.inspect`
  both honour `Symbol.for("nodejs.util.inspect.custom")`, and no address, header
  value, or URL query leaks through inspect, `toJSON`, `JSON.stringify`,
  `Object.keys`, the spread, `structuredClone`, or `String(error)`.
- **The Node floor is set by undici, not by a JS API.** The newest built-in
  `src/` uses is `Object.hasOwn` (Node 16.9). The Node.js floor is 20.13.0 because
  `Response.clone()` has the wrong tee polarity below it — see the CHANGELOG.

### Disclosure

- **Every channel in the inventory, for `UnknownHttpError` and for a `clone()`
  copy.** The inventory instantiates `NotFoundError`; both of these were run
  separately across all eight channels and are clean.
- **`JSON.stringify` with a replacer.** `toJSON` runs first, so the replacer only
  ever sees the redacted record.
- **`Symbol.toStringTag` and own symbols.** The tag is the plain `[object Error]`,
  and the brands, the inspect hook, and the ownership query all live on
  prototypes, non-enumerable.
- **`console.dir` and inspect with `customInspect: false`.** Own enumerable
  properties only, so `url`, `headers`, and `reason` stay out. `cause` does
  NOT: Node's error formatter prints it whatever its enumerability, which is
  why `disclosure-channels.spec.ts` asserts the sentinel IS present for that
  call. That is residual 1 showing through, not a clean channel.
  `showHidden: true` does print them — that is a developer explicitly asking for
  hidden properties, and `url` and `headers` are documented escape hatches.
- **`structuredClone`** carries `name`, `message`, `stack`, and `cause` only. The
  `cause` survival is the documented residual.
- **URL redaction across shapes**: uppercase scheme, IPv6 host with userinfo,
  non-ASCII userinfo, backslash, padded whitespace, embedded tab, `wss:` with
  userinfo and query, an opaque `data:` URL, relative with query, scheme-relative
  with userinfo, and unparseable junk with query and fragment. The `file:` path
  residual is documented in `src/errors/redact-url.ts`.

### Packaging and types

- **Module resolution.** `@arethetypeswrong/cli` reports no problems against the
  real tarball for `.`, `./errors`, and `./package.json` across node10, node16
  from CJS and from ESM, and bundler. Direct `tsc` compiles under all four
  resolution modes with `skipLibCheck` off.
- **`dist/` is reproducible from `src/`** and byte-identical to the committed
  build. CJS and ESM export parity is exact: 51 of 51 at the root, 45 of 45 at
  `./errors`.
- **Tree-shaking does not drop the brand and inspect side effects.** Bundled with
  Rollup and `@rollup/plugin-node-resolve`, which maps `sideEffects: false` onto
  `moduleSideEffects: false`: all seven brand calls survive and the guards still
  answer `true`. The worry noted in `scripts/check-consumer.mjs` is theoretical.
- **Errors-as-values narrowing.** Destructured and non-destructured forms,
  `if (error)`, `if (!error)`, `if (response)`, `if (error !== null)`, and
  `if (error) throw error` all narrow in both directions. The five-guard chain is
  exhaustive — a trailing `const never: never = error` compiles — and a `switch`
  over all 40 mapped statuses after `isKnownHttpError` reaches an unreachable
  default. Types imported from `.` and from `./errors` are the same declarations.
- **The release gates do not pass while what they guard is broken.**
  `verify-pack` uses an allowlist plus exact file-count bounds, and it runs
  twice in the release workflow: once on the dry-run manifest and once on the
  STAGED tarball, which is the file that gets published. `validate-release`
  ties tag, version, changelog heading, footer links, and the `origin/main` tip
  together; `check-docs` fails loudly on a missing or partial `dist/`;
  `is-main-module` resolves symlinks on both sides.
- **The publish argument is a path, and npm reads it as a spec.** The publish
  step resolves the staged tarball with `realpath`, because npm treats a spec as
  a file only when it starts with `.`, `/`, `~/`, or a drive letter. A relative
  `package/<name>.tgz` was read as a GitHub shorthand and sent to `git
ls-remote`. `scripts/release-publish.spec.mjs` drives the real npm CLI against
  both forms with a recording `git` first on PATH.

### What round 4 settled

Four lanes ran in parallel: the uncovered branches, the round-3 commits, the
runtimes and the gate scripts, and the documents against the behavior.

- **Every branch in `src/` is now taken by a test or carries a written reason.**
  Writing those tests was the hunt — a branch nobody exercises is where a wrong
  guard hides — and it found none. Five branches cannot be reached at all, each
  with its argument beside a `v8 ignore` range: the success-surface
  precondition, the rollback flag's `if` inside its own catch, the no-identity
  arm of `clone()`, the captured-prototype guard behind the captured getter, and
  the `?? 0` on a `for...of` code point. The threshold is 100 percent branches,
  so uncovering one fails the gate.
- **The non-keyable identity path is not reachable through the seams.**
  `keyable()` is false only for `null`, `undefined`, and the primitives.
  `isResponse` refuses a primitive resolved value before any identity read, and
  `clone()` refuses a primitive branch before it builds anything. What remains
  is a JavaScript caller handing a non-`Response` to a public constructor, which
  is a violation of the declared parameter type. On that path nothing is
  recorded, so two reads can diverge — visible only through `message` and a
  `status` on a value that is not a response, neither of which is a stated
  contract. Recorded rather than closed.
- **A polyfilled `globalThis.Request` paired with the ambient `fetch` does not
  split the request from the error.** Both directions were measured against the
  live server: a polyfill with a `toString` reaches the URL the error names, and
  one without fails loudly with the requested URL on `url`.
- **Deno discards the origin's reason phrase** and substitutes the canonical one
  for the status code, so `safeReasonPhrase` has nothing to filter there. Bun
  exercises it fully and answers exactly as Node does, except that Bun's client
  refuses a C0 character in the status line outright. Measured on Deno 2.9.5 and
  Bun 1.3.13, which is newer than the measurement above.
- **The four gate gaps round 1 recorded were all real and all latent.** The
  missing check was run for each one, and the artifact passed every one: CJS and
  ESM export the same 51 and 45 names, the two declaration files declare the
  same exports, the `./errors` subpath resolves under Deno, and the node10
  redirect resolves under `tsc`. Each gap is now closed by a check that was
  proved to fail when the thing it guards is broken.
- **Bun has no consumer gate**, and its resolution of the exports map, the
  subpath, and the `require` condition matched Node exactly when driven by hand.
  Closing that is a CI change and is still open.

### What round 5 settled

Four lanes: the round-4 commits, the strength of the tests round 4 added, cost
and retention, and the disclosure channels re-run as a set.

- **The redactor's two branches read different things, and that was the whole
  defect.** The absolute branch reads the normalized `pathname`; the relative
  branch read the RAW string while emitting the normalized path. The WHATWG
  parser CREATES the `://` the scan looks for — it rewrites a backslash pair and
  removes an ASCII tab, CR, or LF — so `/go/https:\\svc:pw@host/v1` emitted the
  password. The relative branch reads both forms. The absolute branch read only
  the normalized `pathname` until round 8. The query and the fragment are
  scanned too: the "pathname, never href" argument is about this url's own
  authority, which cannot appear in either.
- **Reading the path for a hidden authority costs a diagnostic.** A needle from
  a path, a query, or a fragment is removed from the message wherever it
  appears, so a proxy url can delete an ordinary host from a sentence that names
  it. Over-redaction is the safe direction and narrowing the needle needs the
  caller's value a second time, which is the read the library-authored-message
  rule exists to avoid. Stated on `redactUrlInMessage`.
- **The message pass was quadratic** once the needle list grew with the url:
  8000 embedded credentials cost 435 ms against 4.9 ms before the path scan.
  Every needle ends with `@`, so one walk over the message's `@` positions
  replaces one `replaceAll` per needle — 6 ms at the same size.

  **That rewrite shipped with a defect, and the fuzz that cleared it was the
  reason.** It resolved two overlapping needles by position and skipped the one
  that reached back, which left the longer needle's tail — a password — in the
  message; chained `replaceAll` had no such hole, because it resolved overlaps
  by needle ORDER. The 120,000-input fuzz that reported "byte-identical" drew
  from an alphabet that never produced a nested authority with an internal
  `@`, so it could not generate the shape. Round 6 found it in 129 of 40,000
  generated urls. The pass now collects every match and MERGES the overlapping
  ones, which removes at least what the chained form removed.
  **A timing guard for it was written and removed:** it must be a ratio against
  a control measured in the same run, and v8 coverage instrumentation does not
  slow the two functions by the same factor, so the guard failed one run in two
  on unchanged code. The cost is recorded in the source and in a
  correctness-only test at 4000 credentials.

- **Coverage is not strength, and a mutation pass measured the gap.** Round 4
  routed seven caller-supplied slots through `ownSlot` and the suite asserted
  one of them, with neither half of the read covered for any slot: reverting six
  of the seven left the suite green, and so did moving `Object.hasOwn` back
  outside the `try`. Forty-six mutations ran against the round-4 code; 33 were
  killed, 5 are provable equivalents, and the 8 real gaps now have tests.
- **One `v8 ignore` justification was false.** The captured `Response.prototype`
  and the captured body getter come from FOUR reads of a mutable global, not one
  condition, so the guard is reachable. It is a test now, not an ignore. The
  other four ranges were attacked and hold.
- **The channel inventory is still seven.** Every slot round 4 touched was given
  a sentinel across all seven channels for a dedicated class, `UnknownHttpError`,
  a `clone()` copy, and a request failure. Nothing leaked. `util.format`, the
  `JSON.stringify(err, getOwnPropertyNames(err))` idiom, and `console.table` are
  each covered by an existing channel rather than being a new one. The copy's
  matrix is identical to its original's, row for row.
- **Nothing is retained.** Every keyed table is weak and none holds a reference
  back to its key, proved with forced collection and a negative control: 600
  concurrent failures, 50 errors from one response, a `clone()` chain never
  released, and 200 requests on one aborted signal are all collectable, while
  ten deliberately-held errors are reported as retained.

### What round 6 settled

Four lanes: the round-5 fixes, the setup phase and the transport seam, the
second sources of truth, and the surface a consumer reaches.

- **A one-pass removal cannot resolve overlapping needles by position.** Round
  5's rewrite kept the first match and skipped anything reaching back into it,
  which left the longer needle's tail — a password — in the message. Chained
  `replaceAll` had no such hole because it resolved overlaps by needle ORDER.
  The pass now merges overlapping matches. The lesson worth carrying: the fuzz
  that cleared the rewrite drew from an alphabet that could not GENERATE the
  shape, so it proved nothing about it. A differential fuzz must be built from
  the shapes the code distinguishes, not from random noise.
- **ADR 0003 row H-28 reached only half the reads it describes.** The phase
  split drew the transport phase at the CALL, and a transport reads the caller's
  init inside it — every getter on `method`, `body`, `integrity`, and every read
  inside a header container. The corpus scenario throws from an `ownKeys` trap,
  which is a read `typedFetch` performs itself, so the row stayed green while
  the other half was open. See the amendment of 2026-08-08 for the window that
  closes it and exactly where it stops.
- **Four conformance rows did not drive their own claim.** H-04's body carried
  no stream method, so an earlier gate refused it and the `locked` typecheck
  decided nothing anywhere in the suite. H-11 asserted a class field that never
  holds the wire value. H-14 never presented the refused value a second time,
  which is the whole row. H-02 is satisfied by the method gate and defended
  elsewhere. Each of the first three now fails when its own defence is removed.
  **The method that found them is the one to reuse: remove the defence a row
  names and see whether the suite notices.**
- **The roster table had no column for the reason phrase**, while the
  contributing guide told a contributor to write the row "from the RFC". A
  wrong-but-plausible phrase on a class no document names left `vitest run`
  green and failed only under `tsc`. The table carries the phrase now, compared
  at runtime. All 40 rows were checked against the RFC and the IANA registry:
  status, class name, and phrase agree, including the two documented exceptions
  (418, 510) and the three legacy class names whose phrases are current (413,
  416, 422).
- **The test server truncated any header value carrying a colon**, which is
  every `Location`, `Retry-After`, `Link`, and `Content-Range`. No test passed
  one, so nothing was lying — the next test would have read `https` and blamed
  the library.
- **The consumer-reachable surface holds.** Seventy-eight cases across
  subclassing, `clone(recreate)`, and two genuine copies in one process found
  no defect: no stranded stream, no `cancel()` that never settles, no error
  without a body owner, no identity that disagrees between two errors from one
  response. The refusal matrix is now a table in `base-http-error.spec.ts`, and
  the only two rows where a branch is not released are the two documented
  residuals.

### What round 7 settled, and the one thing it left open

Four lanes: the round-6 fixes, the brand and the inspect hook, the gates' own
specs, and the published artifact.

- **A pollution guard asked for a VALUE, and a value read has a receiver.** An
  accessor on `Object.prototype` answers `undefined` for
  `this === Object.prototype` and the payload for every other receiver, so both
  `hasBrand` and `asksOwnsResponse` saw a clean prototype while the next line
  resolved the polluted member through the chain. Every brand guard became a
  constant `true`, and the ownership query accepted a value that owns nothing —
  which orphans a teed branch and leaves `cancel()` pending forever. Round 3
  closed the data-property shape and left the accessor shape open. Both guards
  now ask for PRESENCE, which takes no receiver. The finding does not touch ADR
  0003's out-of-scope item 5: a brand forged on the VALUE is still accepted, by
  design.
- **A scope test asked whether a KEY was present.** `ambientTransport` was
  `!hasFetchOverride`, and this file already draws that distinction eleven lines
  further down, for the init, because collapsing it once reopened row H-26.
  `fetch: undefined` carries the key and leaves the platform's transport in
  place, which reopened H-28; a replaced `globalThis.fetch` carries no key and
  IS caller code, which took a real abort away. The comparison is against the
  `fetch` captured at module load now.
- **The gates are real, and two of their CLAIMS were not.** Fifty mutations
  against the gates' pure decisions killed forty-nine. What failed was prose:
  the `nodenext` pass said it did `attw`'s job and stopped doing it under
  TypeScript 6, which follows Node 22's `require(esm)` — so both directions of a
  mis-wired `types` condition passed silently, and `attw` runs nowhere in CI. A
  `node16` pass restores it. The other was a documented limit with no test.
- **A single pass cannot dominate a chained one, and a previous comment said it
  could.** Chained `replaceAll` re-scans after each removal and so matches text
  the removal creates. Round 6 deleted that stated residual and wrote the
  opposite over it. The residual is back, in a module whose whole discipline is
  stating them.

**OPEN, and a maintainer's decision rather than a defect to fix quietly.**
`tsup.config.ts` sets `splitting: true`, which is what buys cross-entry
`instanceof` inside one format. On the CJS side tsup takes a path that converts
the graph with Sucrase, which downlevels class fields unconditionally. Two
consequences reach a consumer who uses `require()`:

- **44 of the 45 exported classes lose their own `Class.name`** —
  `NotFoundError.name === "_class9"`, and `error.constructor.name` with it. The
  instance `error.name` is correct in both formats, so the semver contract on
  `error.name` holds; `Class.name` is not covered by it either way.
- **A consumer subclass with an accessor on `name`, `status`, or `statusText`
  throws under `require()` and works under `import`**, because the fields
  become `[[Set]]` rather than `[[Define]]`. That is the documented extension
  point.

Both are ESM-clean and reproduce against the installed tarball. No gate saw them
because every root spec imports `src/`, the surface snapshot compares export
NAMES rather than what they are bound to, and `check-consumer` reads the
instance `error.name` only. The options all cost something published — keep
`splitting` and document the two, or drop it and lose cross-entry `instanceof`
in CJS (the guards are brand-keyed and unaffected, which is what the library
already tells consumers to prefer). It is a compatibility trade on a published
package, so it is recorded here rather than decided.

### What round 8 settled

Four lanes: request setup and classification, response and error
construction, disclosure, and the public surface.

- **A custom transport's own tagged `Request` was misfiled as the ambient
  one's URL.** `transportTakesRequest` asked whether a `fetch` option was
  passed, not which transport runs the request. So
  `typedFetch(taggedInput, { fetch: globalThis.fetch })` filed `error.url` as
  the input's own `url` — a server the request never reached — and an
  implementation installed on `globalThis.fetch` received a serialized URL
  string instead of the caller's own tagged `Request`. The parameter is now
  `callerTransport`, computed from the already-known `ambientTransport`. A
  non-callable `fetch` option stays on the platform's rule. (R8-H1-01,
  R8-H1-02)
- **The absolute branch never read the raw input.** The URL path state ends
  `pathname` at the first `?` or `#`, so an embedded credential arrived
  truncated and `stripValues` dropped the half that carried the `@`. The
  branch now removes raw userinfo spans after this url's own authority, then
  re-parses. (R8-H3-01)
- **Channel 3 resolved no member this library owns.** `Symbol.toPrimitive` is
  the first step of `ToPrimitive`, so one write to `Object.prototype`
  rendered the error itself and put the full href in every log line. The four
  root prototypes now own that key. This finding was adjudicated twice: a
  read-only adjudicator called realm-level pollution out of scope, and the
  orchestrator overruled it, because the stamp needs no non-configurable
  descriptor — a subclass `toString` still decides the channel — and because
  the polluting write never reached `toJSON` or the inspect key, which is why
  the other eleven renders stayed clean. (R8-H3-02)
- **The lint gate was red before round 8 changed anything.** Two dead symbols
  and three rules firing on the round-6 refusal-matrix subclasses.
  `ownsResponseSymbol` in `error-classes.spec.ts` was genuinely dead: its
  round-6 content had already moved to `base-http-error.spec.ts`, which owns
  the `BaseHttpError`/`clone()` contract. `scenarioOf` in `conformance.spec.ts`
  was not dead but unwired: three isolated-defense tests hand-duplicated a
  `HOSTILE_SCENARIOS` entry in prose instead of deriving from it, and the
  fixture had already drifted from the prose. `constructor-super` and
  `no-this-alias` fired on a deliberately hostile subclass in the refusal
  matrix and are now silenced at the narrowest scope with a written reason.
  (R8-H4-01)
- **Coverage reached 100/100/100/100 for every file under `src/`**, and
  `vitest.config.ts` now says so on all four axes. Real hostile-input tests
  drive the four defensive `catch` arms in `src/index.ts` (lines 40, 58, 426,
  699): a revoked Proxy, a live Proxy whose `getPrototypeOf` trap throws, a
  forged brand pair with a throwing `status` getter, and a tagged
  non-platform request with a throwing `url` getter. No `v8 ignore` range was
  added.
- **H2 and H4 returned clean.** H2 swept all 512 three-op sequences over
  `errorBodyOf` and left zero stranded sources. H4 pinned the `./errors` ⊂ `.`
  type-surface containment and the README's 40-row class table against the
  built package.

## Adjudicated closed

Correct about the code. Not defects.

1. **A `RequestInit`-typed value is not assignable to `TypedFetchOptions`
   without `lib.dom`.** `@types/node` types the record arm of `HeadersInit` as
   all-optional, so its values are `string | undefined`, and this library rejects
   `undefined` on every header name — a header set to `undefined` reaches the
   wire as the literal string `"undefined"`. Keeping the rejection costs the
   `RequestInit` passthrough; a wrapper types its own parameter as
   `TypedFetchOptions` instead. Both sides are pinned by
   `scripts/check-consumer.mjs`, whose two `@ts-expect-error` directives cannot
   both survive a change of mind, and the cost is stated in the README
   limitations.

2. **`TypedResponse<T>` is not assignable to `Response`,** because it does not
   promise `bytes()`. Promising it would hand consumers a method that does not
   exist on the Node.js 20.13.0 floor this package declares.

3. **A brand can be forged or stripped.** `Symbol.for` is process-global and an
   instance-level property can shadow a prototype one. Both require the consumer
   to attack their own process, and neither makes the library emit a secret. The
   README says the brand is not a security control.

4. **`instanceof` across package copies.** Documented, and the reason the guards
   are brand-keyed.

5. **A `file:` URL keeps its path.** For a `file:` URL the path IS the structure,
   and redacting it would leave nothing diagnostic. Stated in
   `src/errors/redact-url.ts`.

6. **What `error.cause` carries.** The platform error is kept unmodified,
   because a caller who asks for it needs the real text. `toJSON()` and the
   inspect hook withhold it. A log line that copies it carries whatever the
   platform quoted.

7. **The eight permanent exclusions in ADR 0003.** Read them before reporting a
   hostile-`fetch` behavior; a report that the library does not handle one of
   them is not a defect.

8. **A `recreate` callback that locks the branch and then fails.** `clone()`
   promises that a refused result leaves the original usable, and every refusal
   releases the branch to keep that promise. A callback that takes
   `branch.body.getReader()` and then returns a refused value defeats the
   release: only the holder of a reader can cancel a locked stream, so the
   branch is never freed and `cancel()` on the original never settles. No code
   in this library can recover it — `cancel()` refuses loudly for the same state
   on the error's own stream, and a sibling branch has no such voice. Stated on
   `clone()` as a residual, with the rule it implies: do not take a reader inside
   a `recreate` callback.

## What this file is not

It is not a promise that nothing is left. It is a record of what was examined
and what was decided, so the next pass starts from the frontier instead of the
beginning. A finding that clears the evidence bar and contradicts an entry here
is welcome — and it should say which entry, and why the reasoning there fails.
