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
  `fetch` does not trip a proxy `get` invariant. On that branch, the `signal`
  slot is re-declared configurable and writable, and the trap delegates with
  `options` as the receiver. The no-override branch proxies the caller's own
  object directly and does no descriptor work at all; it is safe for a
  different reason. `typedFetch` passes the caller's own first read of
  `signal`, not a value read again, so the trap's answer is by construction
  the value the target already holds. `headers` is no longer replaced at all,
  so the shape that used to need the descriptor clone is now an ordinary read.
- **The init dictionary stays empty when the caller passes nothing**, so
  `typedFetch(request)` does not trip the Fetch Standard's "init is not empty"
  branch and does not detach the `Request`'s own signal.
- **Signal, abort, and timeout interleaving.** `typedFetch` runs in three
  phases, each with its own catch, and only the transport phase consults the
  signal. A network failure that merely coincides with an abort stays a
  `NetworkError`, and caller code in the setup or response phase cannot claim an
  abort at all. Nothing runs between the transport's rejection and its
  classification, because the request input is serialized before the request.
- **`typedFetch` reads `options.signal` earlier than a bare `fetch` does, and
  that is a decision, not a defect.** The setup phase reads it in phase 1. A
  bare `fetch` converts `init` as a WebIDL dictionary in member order and
  reads `method` first, `signal` later. A self-mutating `signal` getter can
  therefore change the request under one and not the other. No caller
  observes a request it did not describe itself, and reading the governing
  signal once, up front, is inherent to capturing it at all.
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

### What round 9 settled

Four lanes: request setup and classification, response and error
construction, URL redaction, and disclosure channels.

- **The setup phase read `requestInput.signal` plainly, so an own data
  property defined over `Request.prototype.signal` captured a decoy:** the
  transport aborted on the associated signal while the library filed a
  `NetworkError` instead of an `AbortedError`. The read now goes through
  `nativeRequestSignal`, chosen by the same `callerTransport` predicate that
  admits the input. Record F1's inventory as the reason the class is closed,
  not just the case: the setup phase takes exactly three things off a
  handed-over `Request` — `url` (round 8), `signal` (round 9), and the own
  `Symbol.toStringTag`, which can only widen the verdict; `method`, `headers`,
  `body`, and `redirect` are never read, because the transport receives the
  `Request` whole. (R9-H1-01)
- **`installInspect` stamped only Node's key.** Deno resolves
  `Symbol.for("Deno.customInspect")` first, so one write of that key to
  `Object.prototype` rendered the error's own properties and put the full
  href — userinfo password and query token — into `console.log` and
  `Deno.inspect`. Both keys are stamped now. Record the measured runtime map:
  Node resolves its own key; Bun's `Bun.inspect.custom` IS Node's key; Deno
  resolves its own first; browsers and workerd gate no per-object inspect
  key. (R9-H4-01)
- **R9-H3-01 and R9-H3-02, both inside round 8's own fix.** Comparing two
  texts the URL parser does not agree about was the whole defect, and the raw
  scan is gone. Round 8 taught the absolute branch to read the raw input
  because the path state ends `pathname` at the first `?` or `#`; round 9
  broke that scan from both sides — `rawAfterAuthority` took the first `://`
  for this url's own authority, which is wrong for `https:/host`,
  `https:host`, and `https:\\host` (all reach the authority state), so the
  raw region began after the credential (R9-H3-01); and it searched for a
  mark the parser CREATES from a backslash pair or a removed tab, CR, or LF,
  so an embedded `https:\\svc:pw@` was invisible while `pathname` had already
  been cut at the `?` (R9-H3-02). `redactUrl` reads no raw text now: it scans
  `pathname`, and looks past it only to find an `@` when the pathname ends
  inside an authority — the removal itself is always clipped to `pathname` —
  so the marks are the ones the parser wrote, the authority is wherever the
  parser found it, and a redaction can never move the host it names. The
  same change closed two relative-branch shapes nobody had reported. `userinfosOf` still reads raw
  text, because a needle must match the spelling a platform quoted; its cut
  is anchored on the scheme now, not on the first `://`. F3 validated the
  change with differential fuzzing against HEAD — 60,000 urls and 180,000
  messages, zero cases where the new code leaks and the old does not, zero
  cases where the emitted host differs from the url's real host.
- **Residual, round 9.** A `://` inside the query cuts short an embedded
  credential's region when that credential has no `@` of its own before it,
  so `/go/https://svc:hunter2?a=://b@c` keeps `svc:hunter2`; it is
  under-redaction, it predates round 9, and closing it would delete `host1`
  from `://host1/x://u2:pw@host2/v1`, which the suite pins as a path the
  redactor keeps. Round 9 closed the single-solidus embedded authority.
  `redactUrl` kept `svc:pw` in `/go/https:/svc:pw@host`, which is the
  spelling every slash-collapsing proxy and every `path.join` produces from
  an ordinary `/go/https://svc:pw@host`. The mark that OPENS a userinfo
  region and the mark that CLOSES one are now different. A region opens
  where the URL Standard opens an authority: at two or more solidi under any
  scheme, and at a SPECIAL scheme over any number of solidi, including none;
  a region closes only at `://`. Widening both — which the fixer tried and
  reverted — gives a password that spells `:/` the power to end its own
  region and emit the prefix, and a
  200,000-url differential fuzz measured 5,241 new `url` leaks and 13,435 new
  `message` leaks for that form against zero for the split. The split closed
  15,456 leaking urls in that fuzz, moved no host in any of the 200,000, and
  made no message worse. What it costs is over-redaction: a chain of
  single-solidus authorities collapses to its last host, and a path segment
  ending in `:/` before an `@` loses the segment. One residual replaces it,
  and it is narrower: a standard-base64 credential containing a `/` behind a
  single solidus is read as a path segment, because `looksLikeUserinfo`'s
  third rule needs the two solidi the parser's own spelling has —
  `file:///c:/Users/alice@corp/x` is a drive letter, not an authority.
- **H2 returned clean.** It closed all 4096 four-operation `errorBodyOf`
  sequences, every interleaving of two `ErrorBody` handles over one
  `Response`, six same-tick concurrency pairs, all 81 four-operation
  `clone()`-chain mixes, `Response`-subclass getters that shift after the
  first read on six members, abort and timeout composition, and ADR 0003 row
  H-14 driven through all 15 refusal points of the response phase. H2 chased
  two candidates and discarded both because the failing test was wrong, not
  the code.

### What round 10 settled

Four lanes: request setup and classification, response and error
construction, URL redaction, and disclosure channels. H2 returned clean for
the third consecutive round.

- **R10-H1-01 (medium).** Round 9 routed the `signal` read by
  `callerTransport`, and which transport runs says nothing about which
  signal governs: `{ fetch: (input, init) => globalThis.fetch(input, init) }`
  hands the `Request` over whole, so the platform aborted on the internal
  slot while the library read a shadowing own property and filed a
  `NetworkError` for an aborted request. The branch is now
  `input.platformRequest` — whether the accessor APPLIES, a fact about the
  input this module already decided once — and it is the same axis `url` has
  used since round 8.
- **R10-H3-01 (critical).** A userinfo region opened in the path and closed
  at an `@` in the QUERY, so removing the span took the `?` with it and the
  rebuild promoted query text into the path. Two failures at once: a query
  token survived into all seven channels, and the diagnostic named a host
  the url never named, in place of the one it did. A redaction that lies
  sends the reader to the wrong server. Record the invariant that replaced
  the rule: every byte `redactUrl` emits comes from the input's origin or
  from its parser-produced `pathname` with userinfo spans deleted, never
  from `search` or `hash`, so the emitted url is a subsequence of the parsed
  origin-plus-path and the query and fragment are always dropped whole.
- **R10-H4-01 (critical).** A zero-solidus embedded authority
  (`https:svc:pw@host`) kept its credential, because the region opened only
  when at least one solidus followed the scheme colon. One to four solidi
  lost it; zero kept it — and three documents said the rule held however
  many solidi spelled it. The opening rule now asks the URL Standard's own
  question and is verified against `new URL` in a table test rather than
  restated in prose.
- **The fuzz.** 295,794 urls, five checks each: nothing throws; no
  parser-recognized credential survives; no query or fragment byte is
  emitted; the origin never moves and the emitted path is a SUBSEQUENCE of
  `parsed.pathname`; and a differential against the previous commit. Zero
  origin-moved, zero path-not-a-subsequence, zero throws. 6,195 credential
  leaks the previous commit had and this does not; 84,825 inputs where it
  emitted a query or fragment byte and this does not. The subsequence check
  is the one round 9's 200,000-url fuzz lacked, and that absence is why a
  lying redaction shipped.
- **The pin that changed.** A CONTROL row in `redaction-authority-spelling.spec.ts`
  pinned exact bytes that were themselves promoted query text — the benign
  instance of R10-H3-01's mechanism. The orchestrator verified against the
  platform that `internal.test/v1` is query text in that url and upheld the
  conversion: the expected string changed, and the two assertions the
  control exists for (the password is absent, the host is unmoved) were
  added. State the lesson plainly: a control that pins bytes instead of a
  rule can pin a defect.
- **H2 clean, third round.** It pinned the 40 classes as a generated
  population, all 200 statuses from 400 to 599, an 864-cell identity matrix
  through both `typedFetch` and `clone()`, the redactor's totality over
  100,000 urls, and 100 guard answers across two real package copies. It
  also found the gate weakness below.
- **The roster gate.** `roster-sync.spec.ts` check 1 compared the UNION of
  `ClientErrors` and `ServerErrors`, so a class moved between the groups was
  invisible to it. Check 1b now derives each class's group from its own
  `static status` and compares the groups separately, at compile time.
  Proved by moving `NotFoundError` in a scratch copy outside the repository
  and watching `typecheck` fail.

### What round 11 settled

Four lanes: request setup and classification, URL redaction, disclosure
channels, and the documents against the built package. H2 returned clean for
the fourth consecutive round.

- **R11-H1-01 (high) and R11-H1-02 (medium), one defect.** Round 10 branched
  the `signal` read on `input.platformRequest` and stated there was no third
  case. There were two. A `Proxy` over a platform `Request` is `instanceof
Request`, so the branch applied the prototype accessor, which throws when
  applied to a proxy — and the request was never sent at all, resolving
  `NetworkError` with an empty url. Any input whose `signal` read throws
  refused the whole request, while the sibling `url` read had caught its own
  throw since round 8. The branch is gone: the read tries the accessor, falls
  back to a plain read, then to no signal, because the accessor's own failure
  answers the question no predicate over a prototype chain can. Record the
  invariant: no read the setup phase performs to DESCRIBE a request can stop
  the transport from running; only the reads that PRODUCE what the transport
  receives may end a call. Record also that round 9's three-read inventory
  was incomplete when written — `value instanceof Request` runs a prototype
  walk a `Proxy` trap can hijack, and it was hardened by accident rather than
  by inventory.
- **R11-H3-01 (critical).** A region tested one `@`, the last one before its
  closing mark, so `https://api.test/go/https://BEARER_SECRET@cdn.test/img/@alice`
  read `BEARER_SECRET@cdn.test/img/` as a path because it ends in `/` and
  shipped the credential through all seven channels. The rule is now one
  question per `@` and the union of the yes answers, re-asked of what each
  answer leaves behind.
- **The defect the fix found in itself.** The first form of the fix removed a
  credential and left text its own rule calls userinfo, because removing a
  span moves the region's first `/` and first `:`, which both rules read — a
  colon-bearing host like `[::1]` or `host:8443` triggered it. Measured as
  1,925 fixed-point failures over 604,204 urls where the previous commit had
  none. Asking again after each answer closed it, bounded at three answers
  per region, and the scan stays linear.
- **The class measure.** Tail-independence over 249,480 urls: the previous
  commit had 4,524 rows where the target path's tail decided the credential's
  verdict; the fix leaves 1,740, every one of them the trailing-`/`
  credential, which is recorded residual 4.
- **The fuzz.** 853,684 urls with multiple `@` per region at every position,
  crossed with 0-4 solidi, backslash and tab and newline spellings, special
  and non-special schemes, percent-encoded delimiters, nesting depth 1-3,
  IPv6 and IDN hosts, and `file:` drive letters. Zero throws, zero subsequence
  violations, zero moved origins, zero emitted query or fragment bytes, zero
  fixed-point failures, zero new leaks against the previous commit, 15,393
  leaks closed.
- **Why the parser was not called.** Once every `@` is asked, the heuristic
  set strictly contains what `new URL` answers: the parser's userinfo ends at
  the last `@` before the region's first `/`, and the heuristics also catch
  `svc:hun/ter2@host` and `YWxpY2U/cGFzc3dvcmQ@host`, which the parser reads
  as hosts and paths and the suite pins as redacted.
- **R11-H4-01 (low).** The residual-1 advice named one of the two channels
  that keep what `error.cause` quotes, so a consumer who followed it exactly
  still shipped the quoted credential to another realm. Record that the
  finding came from testing a document sentence against the built package,
  which is the method that also produced round 9's Deno key and round 10's
  zero-solidus credential.
- **H2 clean, fourth round.** It pinned the redactor's totality over 120,000
  hostile strings and a 34,200-url structured corpus, real-socket body
  failures against a local server rather than hand-made streams,
  `errorBodyOf` against a stream that errors mid-read, ADR 0003 row H-14
  through two identity getters that fail earlier than the pinned one, and a
  property no round had stated: a hierarchical redaction is a FIXED POINT,
  `redactUrl(redactUrl(u)) === redactUrl(u)`, over 80,021 urls. That property
  is what caught the fix's own regression above.

### What round 12 settled

Four lanes: request setup and classification, response and error
construction, URL redaction, and disclosure channels — plus an independent
parser-derived oracle built against the redactor from scratch. H2 returned
clean for the fifth consecutive round.

- **R12-H4-01 and R12-H3-01 (critical), and R12-F2-01 (critical), one defect
  seen three ways.** A password can spell `://` and end its own region. A
  protocol-relative input let the parser eat the opening mark, so no region
  opened and the credential rode out in the path. And a bare `//` inside the
  path opened no region at all, because the rule required a scheme in front
  of the solidi. Record the reasoning that mattered: round 9 had REFUSED to
  widen the end mark, measuring that a password spelling `:/` would end its
  own region — so the wide mark leaks and the narrow mark leaks, and that is
  the evidence that the end of a region cannot be a textual mark at all.
  State the invariant that replaced it: a region opens where the URL
  Standard opens an authority — at a scheme colon with its solidi, at two or
  more solidi with no scheme, and at the seam where the parser consumed the
  mark — and it ends only where `new URL` reads a complete authority at its
  start. Record why it cannot be spelled past: to shorten a region an
  attacker must make the parser read a complete authority there, which means
  the parser found the host, so everything before it is the userinfo the
  parser reports and is removed.
- **R12-F2-02 (medium).** The relative branch emitted a path beginning with
  two solidi, which a second pass read as protocol-relative and reduced
  again, so the redactor was not a fixed point of itself. The answer is now
  resolved until re-reading it changes nothing.
- **The fuzz.** 124,355 inputs over fifteen checks, zero failures, plus
  26,250 structured urls for the fixed point alone.
- **The oracle, and why this round is different.** Round 12 built an
  independent judge, `redaction-oracle.spec.ts`, derived from the
  URL Standard rather than from this module's bug history — every credential
  is whatever `new URL` reports for the input and for every url-shaped
  substring of it. It found the third region-opening class that both
  hunters had missed. Record the reason it worked: five previous fuzz
  harnesses were each written from the shapes the previous rounds had taught
  them, and each time the next round found the shape that harness could not
  generate.
- **The oracle judged against itself.** It stayed red on 13 of 3,576 inputs.
  The fixer claimed both classes were faults in the judge; the orchestrator
  verified the platform's answers, and the judge's author confirmed 0 of 13
  were disclosures — 11 were a derived credential colliding with the origin
  the output must keep, 2 were a corpus that spelled one sentinel into two
  roles. The judge now excises one occurrence of the input's own origin
  before searching, and the corpus follows a stated rule: one sentinel, one
  role. Record that the fix fails OPEN — a moved origin excises nothing —
  and that a self-check pins the three region-opening classes of this round
  so a later softening of the judge fails loudly.
- **Two CONTROL rows inverted.** `disclosure-channels.spec.ts` recorded both
  the scheme-relative and the percent-encoded-colon shape as residuals that
  keep the secret. Both are closed now; measurement contradicted the
  expectation that the encoded colon would still leak, and the rows were
  inverted to match what the module does. Record the recurring lesson in one
  sentence: a control that pins bytes can pin a defect.
- **H1 clean.** It verified the eight-read inventory of the setup phase is
  complete, including the two reads that sit outside a phase `try` and are
  total by construction, and added 18 pins.
- **H2 clean, fifth round.** It pinned the response phase's read inventory as
  a CLOSED SET — twelve members refuse a mapped 404, three are never
  reached — identity as a function over 512 generated read schedules, and
  the error body releasing its source exactly once, measured by counting the
  source's own cancel algorithm rather than inferred.

### What round 13 settled

Five findings; H1 returned clean.

- **R13-H2-01 and R13-H3-01 (critical), one class.** Round 12 made the URL
  parser the final authority on where an authority begins and ends, and did
  not define what happens when the parser DECLINES to answer. Both criticals
  are that gap. `seamUserinfo`'s parse THREW for an empty host or an
  out-of-range port, so the guard answered null and no region opened — 112 of
  a 200-url seam population leaked. A reference whose scheme equals
  `RELATIVE_BASE`'s had its mark CONSUMED by the parser, so no mark was ever
  seen. Record the principle that closed both: when a parse the module leans
  on throws, the module removes the span anyway. A structure the parser
  declines to read is not one it has ruled out, it is one nobody can bound.
  No parse remains at this seam: what is believed now is an `@` with no
  text in front of it, which names an empty userinfo and has nothing to
  remove, and that is what keeps `file:///c:/Users/alice@corp/x` whole.
- **`RELATIVE_BASE` was not changed, and why.** Its scheme's identity was
  silently load-bearing, but every special scheme collides with an input
  that spells it, and every non-special one gives up the second load-bearing
  property: speciality, which makes `\` a solidus and keeps `\` out of the
  emitted `pathname` — without it the relative branch's loop loses its
  termination bound and hangs the response phase. All three properties are
  now written on the constant.
- **R13-H4-01 (medium).** Redaction was not a fixed point of itself on a
  family of urls whose userinfo carries both a solidus-colon run and an
  embedded `://` behind a bare `//`. Fixed by re-asking the END question at
  each new cut, not the `@` question alone.
- **Two findings that were the DOCUMENT, not the module** — the `file:`
  entry in the special-scheme list, and the `%3A` bullet's claims in both
  directions. Both are corrected in `SECURITY.md`. Record that the
  orchestrator verified both on the platform and upheld the fixer's dispute,
  and that the `file:` error had propagated into the round-12 oracle, whose
  `opensRegion` helper quoted the false sentence. State the lesson in one
  sentence: quoting a contract makes a spec-derived judge exactly as correct
  as the contract.
- **The oracle now asks the parser instead of the document.** It probes with
  a canary userinfo at the exact scheme and solidus spelling written, and
  distinguishes three answers — an authority with a userinfo, an authority
  the parse refuses (still an opener, because the credential in
  `https://u:p@/v1` is real), and no region. It found a bug in itself while
  being rewired: it had been passing its base unconditionally, so a
  reference whose scheme equalled the base's was read as relative with the
  mark eaten — round 13's own second finding, turned against the instrument.
  28 properties green over 4,163 inputs.
- **The fuzz.** 140,856 urls over nine checks, all green: zero throws, zero
  idempotence failures, zero credential survivals, zero moved origins, zero
  subsequence violations, zero query or fragment bytes, zero message
  disagreements; 18,204 sentinel exposures closed against the previous
  commit and zero opened. Two failure classes were found DURING the fix by
  the repository's own pins rather than by the fixer's corpus — the
  fail-closed seam broke a 150,000-url fixed-point pin because removing the
  first authority re-creates the seam.
- **H1 clean.** It closed the transport's return value as a set: 13 shapes
  and 90 combinations against five properties, with non-vacuity verified
  three ways including an inversion that produced six real violations. It
  also recorded two corrections to the ledger, above: the proxy-invariant
  entry under "The request path" was true of one branch only, and the
  `options.signal`-versus-bare-`fetch` read-order difference is recorded as
  a decision rather than a defect.

### What round 14 settled

Four findings; H1 returned clean for the third consecutive round.

- **R14-H2-01 and R14-H3-01 (critical), and R14-H4-02 (medium) — one
  class.** Three rounds have now found bugs in the gap between the text a
  guard EXAMINED and the text EMITTED: round 13's fail-closed seam
  re-created a seam when it removed an authority; round 14's dot segment
  slid a second credential into a seam that had just been cleared, because
  the rebuild is a parse and a parse removes dot segments; and a leading C0
  control or space made the parser consume the scheme colon where the
  module's skip set covered only tab, CR and LF. Record the invariant that
  closed the class: every question this module asks is asked of the text it
  emits — the scan re-runs on the pathname its own rebuild produced and
  returns only from a pass that emits exactly what it scanned. Record
  explicitly that re-asking `redactUrl` of its own answer is NOT that
  property and does not imply it: a second call recomputes the origin and
  re-reads the mark from a text that no longer holds it, and one of the
  leaking shapes was already a fixed point of the whole redactor.
- **The parser-normalisation enumeration.** The fixer enumerated all eleven
  normalisations the basic URL parser performs, from the Standard's steps
  rather than from this module's bug history, and recorded for each whether
  the module mirrors it and why. Three were unmirrored and were exactly this
  round's three findings: the leading C0-control-or-space strip, `file:`'s
  own state, and dot-segment removal. Record the two that are deliberately
  never mirrored and the reason: percent-encoding, which is the `%3A`/`%40`
  residual; and host normalisation, which the module never needs because it
  never computes a host — it takes `parsed.host` and asks the parser instead
  of comparing host text.
- **Two defects the fixer found in its own work.** The seam had believed the
  parser's REPORT rather than its SPLIT POINT, so a `:@` cut kept a
  password — the parser normalises an empty userinfo away in what
  `username` and `password` report. And the fix moved the quadratic from the
  relative branch to the ABSOLUTE branch, which a redirecting server can
  choose, measured at 465 ms for 16 KB; a cursor rule closed it to 0.8 ms
  with byte-identical answers. `cleaned`'s loop is the correctness
  guarantee — it is what makes the scan re-run on the text the rebuild
  produced — and the cursor is a cost optimization only, bounded to one
  extra pass for the dot-segment shape that would otherwise be quadratic.
  No earlier round recorded the loop as confined to the relative branch;
  where that reading was possible it is corrected here. Note that this
  invalidated H2's proof that the quadratic was unreachable from a real
  `Response`, and that the fixer caught it before shipping.
- **R14-H4-01 (medium).** A security sentence named the wrong member.
  Record the rule it teaches: `error.url` and `toJSON().url` have opposite
  contracts by design, so a sentence about redaction must name the exact
  member.
- **The fuzz.** 18,964 inputs over eight checks: zero throws, zero
  idempotence failures, zero moved origins, zero subsequence violations,
  zero query or fragment bytes, zero entry-point disagreements, and zero
  path segments deleted from urls the parser calls ordinary path. 3,398
  exposures closed against the previous commit; the 3 opened are the
  `file:` correction itself, each verified on the platform.
- **H1 clean, third round.** It closed the options-snapshot proxy
  invariants over 288 generated objects, and settled round 13's recorded
  divergence with measurement: `signal` is the only WebIDL member the setup
  phase reads, and every one of the fifteen members is read exactly once
  under both branches — the same count a bare `fetch` produces, so the
  divergence is order only, never count. It judged `snapshotRequestInit`'s
  fidelity by what a real HTTP server received for 31 init shapes.

### What round 15 settled

Three findings; H1 and H3 both returned clean — H3 for the first time in
eight rounds. Round 15 is the protocol's cap: see the closing entry below.

- **R15-H2-01 (medium).** Round 14 taught the redaction loop's SEAM cursor
  to skip a dot segment its own removal exposes. The ORDINARY region's
  cursor, in `malformedUserinfoSpans`, kept advancing over solidi alone, so
  the same input shape — one credential per dot segment — still drained
  one group per pass wherever no seam existed. A remote server chooses that
  shape through a 302 `Location` header: measured at 204 ms against 0.2 ms
  for a same-length, same-character control that differs only in where the
  `@` sits, because the ordinary cursor had not learned to advance past the
  dot segments its own removal creates.
- **The cursor rule that closed R15-H2-01, and the fix that was rejected.**
  One cursor rule, with a set parameter, closes the class: a cursor may
  advance past a `..` dot segment only where nothing a pop could shorten
  lies in front of it, which is the seam's position and no other. The
  hunter's proposed one-line fix applied round 14's seam rule to the
  ordinary cursor too, swallowing every `..` there. A `..` inside a removed
  span is a `..` the rebuild never performs, so the segment it would have
  popped survives instead — under-redaction, not over-redaction. Six
  inputs in 200,000 generated ones lost a credential that way. The
  hunter's claim that every changed answer removed MORE text was false:
  run over every changed row with the round-12 oracle, rather than by
  inspection, 1,622 systematic rows removed less. The shipped fix is
  narrower — the seam's cursor takes the full dot-segment set, the
  ordinary region's cursor takes only the single-dot spellings.
- **The twelfth parser normalisation, absorbed rather than mirrored.** The
  URL Standard's file path state normalises a Windows drive letter — an
  ASCII alpha followed by `:` or `|` in the FIRST path position has its
  second code point replaced with `:` — and it is the only normalisation
  that can CREATE an authority mark from text that held none, because
  `c|//` is not a colon and `c://` is. A removal can promote a later
  segment into first position, so the mark appears in the rebuild rather
  than in the text that was scanned. The module mirrors it nowhere, and
  needs no mirror: `file:///a@c|//svc:PW@internal.test/v1` answers
  `file:///c://internal.test/v1`, because the pass that emits an answer is
  a pass that scanned that exact answer.
- **A correction to round 14's recorded reason for not mirroring host
  normalisation.** "The module never computes a host, it takes
  `parsed.host` and asks the parser" is true but not sufficient:
  `cleaned` glues that host text back onto a path and re-parses it once
  per pass, so the claim that must hold is that a host the parser
  emitted is a fixed point of the parser. It is, verified across fourteen
  forms — IPv4 and IPv6 spellings, percent-encoding, case, a trailing dot,
  a normalized port, and Punycode among them.
- **A residual recorded, not closed.** `redactUrl`'s relative branch
  resolves one protocol-relative authority per parse, so a caller-written
  relative reference of N `//host` groups costs N parses: 16 KB of `//a//`
  measured 606 ms before this round's fix and 682 ms after it. The url is
  always caller-chosen, never a redirect target, because `response.url` is
  absolute. Closing it means deciding where the last authority ends
  without parsing to it, which reopens the class rounds 13 through 15 each
  found a defect in.
- **R15-H4-01 and R15-H4-02 — the document, not the module.** Two lanes
  independently falsified `SECURITY.md`'s claim that neither
  `error.message` nor `toJSON().url` emits a query or fragment byte under
  any spelling. `toJSON().url` holds that property by construction, but
  `error.message` holds it only for a message this library writes:
  `NetworkError`'s message is public API, and its constructor cleans a
  caller-supplied platform message with an exact-string replacement of
  `url` — best effort, and defeated by a message that quotes a different
  spelling of the same url, such as a stripped fragment or a normalized
  default port. Separately, `CHANGELOG.md`'s `[Unreleased]` section still
  stated round 12's believed-parse rule for the seam — "only a parse that
  succeeds and reports no credential is believed" — a rule round 14
  replaced with a direct read of the parser's split point. `RELEASING.md`
  step 1 moves `[Unreleased]` verbatim into an immutable dated section, so
  the stale sentence would have shipped as a permanent record of a
  mechanism the package no longer has. Both are fixed in `SECURITY.md` and
  `CHANGELOG.md`.
- **Termination is now pinned, not assumed.** A test replaces
  `globalThis.URL` with a subclass for the length of one synchronous call,
  which reads the loop's own steps without the module holding a counter
  for anyone. Over 1,400 constructions, no rebuild ever answers with a
  pathname longer than the path it was given. The pass-count bound is
  asserted as an EQUALITY, not a ceiling: four groups and four hundred
  groups cost the same number of parses. That equality fails on the
  pre-fix tree.
- **The four lane handovers.** Each round-15 lane file states, in its own
  comments, what it leaves PROVEN, what it leaves ASSUMED, and what to
  attack first. The full text lives in `request-cross-call-isolation.spec.ts`,
  `response-loop-bound.spec.ts`, `redaction-normalisation-enumeration.spec.ts`, and
  `surface-message-guarantee.spec.ts`. The load-bearing items:
  - **H1.** The module's cross-call state is exactly one `WeakSet`, pinned
    executably against the module's own declaration list. Phases 1 and 3
    of `typedFetch` contain no `await`, which is the structural reason two
    calls cannot interleave inside either one. Attack first: phase 3's
    catch releases the body of a `Response` an earlier call already
    returned as a success. Not reachable today through an honest
    `Response` — it needs a value that answers `type` differently on a
    second presentation, which ADR 0003 puts permanently out of scope as
    item 3 — but it is a real cross-call coupling with no ADR sentence
    naming it, and it needs one, or a custody check, rather than a guard.
  - **H2.** The loop's termination bound, and the fact that the bound is
    TIGHT. Attack first: for every cursor that advances past a removal,
    does it advance past everything the next parse deletes.
  - **H3.** The absolute branch is a pure function of the parsed URL,
    which closes eight of the twelve normalisations by unreachability
    rather than by mirroring. It believes the class is closed
    structurally, and names what would change its mind: a fixed-point
    violation, a reader-credential witness, a `cleaned` pass that returns
    text it did not scan, or a third `bringsOwnAuthority` spelling.
  - **H4.** The residual list above, and the release assessment recorded
    in `CHANGELOG.md`'s `[Unreleased]` lead paragraph and `### Changed`
    section.
- **The Node floor, now measured.** For seven rounds every gate was green
  without ever executing the declared `engines` floor, because
  `smoke:node-min` only WARNS on a newer runtime and CI's
  `node-version: 20` resolves to the latest 20.x. The orchestrator ran
  `scripts/smoke/node-min.mjs` on a real Node 20.13.0 against a freshly
  built `dist` after the final round: OK, exit 0. Bun stays unexercised
  locally. `smoke:deno` and `check-deno-consumer` ran green in the
  round-13 and round-14 gates.
- **The loop hit the cap.** The protocol stops at round 15 whether or not
  two consecutive clean rounds occurred, and they did not: no round from
  8 through 15 produced zero findings. Eight rounds ran, and every one of
  them found at least one defect: 5, 4, 3, 4, 4, 5, 4, and 3 findings,
  fifteen of them critical. The audit did not converge. A human should
  read the four handovers above before deciding this module is done.

## The audit files, renamed by subject

The audit closed at round 15. Each round-numbered spec file above still holds
its own round and lane in its header comment, but the file NAME no longer
carries that number. The round stays recorded here and in
[`docs/audit-round-8-protocol.md`](./audit-round-8-protocol.md), which states
the `roundN-hX-*` convention the audit followed while it was open. The table
below maps an old name to the current one, so a reader who meets a round
number in this ledger can find the file it names.

| Old name                              | New name                                        | Round |
| ------------------------------------- | ----------------------------------------------- | ----- |
| `round8-h1-request-input.spec.ts`     | `request-transport-selection.spec.ts`           | 8     |
| `round9-h1-request-input.spec.ts`     | `request-signal-source.spec.ts`                 | 9     |
| `round10-h1-request-input.spec.ts`    | `request-signal-under-caller-transport.spec.ts` | 10    |
| `round11-h1-request-input.spec.ts`    | `request-signal-read-totality.spec.ts`          | 11    |
| `round12-h1-request-input.spec.ts`    | `request-setup-cannot-refuse.spec.ts`           | 12    |
| `round13-h1-request-input.spec.ts`    | `request-transport-return-set.spec.ts`          | 13    |
| `round14-h1-request-input.spec.ts`    | `request-init-fidelity.spec.ts`                 | 14    |
| `round15-h1-request-input.spec.ts`    | `request-cross-call-isolation.spec.ts`          | 15    |
| `round8-h2-response-error.spec.ts`    | `response-body-lifecycle.spec.ts`               | 8     |
| `round9-h2-response-error.spec.ts`    | `response-body-concurrency.spec.ts`             | 9     |
| `round10-h2-response-error.spec.ts`   | `response-class-population.spec.ts`             | 10    |
| `round11-h2-response-error.spec.ts`   | `response-redaction-algebra.spec.ts`            | 11    |
| `round12-h2-response-error.spec.ts`   | `response-read-inventory.spec.ts`               | 12    |
| `round13-h2-response-error.spec.ts`   | `response-seam-and-status.spec.ts`              | 13    |
| `round14-h2-response-error.spec.ts`   | `response-construction-invariants.spec.ts`      | 14    |
| `round15-h2-response-error.spec.ts`   | `response-loop-bound.spec.ts`                   | 15    |
| `round8-h3-disclosure.spec.ts`        | `redaction-query-terminator.spec.ts`            | 8     |
| `round9-h3-disclosure.spec.ts`        | `redaction-authority-spelling.spec.ts`          | 9     |
| `round10-h3-disclosure.spec.ts`       | `redaction-query-promotion.spec.ts`             | 10    |
| `round11-h3-disclosure.spec.ts`       | `redaction-region-at-signs.spec.ts`             | 11    |
| `round12-h3-disclosure.spec.ts`       | `redaction-protocol-relative.spec.ts`           | 12    |
| `round13-h3-disclosure.spec.ts`       | `redaction-relative-base-scheme.spec.ts`        | 13    |
| `round14-h3-disclosure.spec.ts`       | `redaction-discarded-input-text.spec.ts`        | 14    |
| `round15-h3-disclosure.spec.ts`       | `redaction-normalisation-enumeration.spec.ts`   | 15    |
| `round12-f2-redaction-oracle.spec.ts` | `redaction-oracle.spec.ts`                      | 12    |
| `round8-h4-surface.spec.ts`           | `surface-type-contract.spec.ts`                 | 8     |
| `round9-h4-surface.spec.ts`           | `surface-deno-inspect-hook.spec.ts`             | 9     |
| `round10-h4-surface.spec.ts`          | `surface-solidus-count-claim.spec.ts`           | 10    |
| `round11-h4-surface.spec.ts`          | `surface-cause-channels.spec.ts`                | 11    |
| `round12-h4-surface.spec.ts`          | `surface-authority-mark-claim.spec.ts`          | 12    |
| `round13-h4-surface.spec.ts`          | `surface-encoded-delimiter-claims.spec.ts`      | 13    |
| `round14-h4-surface.spec.ts`          | `surface-raw-url-claim.spec.ts`                 | 14    |
| `round15-h4-surface.spec.ts`          | `surface-message-guarantee.spec.ts`             | 15    |

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
