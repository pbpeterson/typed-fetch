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
  call and the success return is covered by the inner `try` in `typedFetch`, and
  `releaseResponseBody` is total: every read is guarded, and a primitive, a
  hostile Proxy body, and a non-object `body` all fall through. No path strands
  a body.
- **No leaked listener, timer, or table entry survives a rejected call.** The
  library adds no listener to a signal and sets no timer. The only keyed tables
  written on the failure path are the identity `WeakMap`s.
- **The options snapshot's proxy invariants.** A frozen `options` carrying an own
  `fetch` does not trip a proxy `get` invariant; the `signal` slot is always
  re-declared configurable and writable, and the trap delegates with `options`
  as the receiver.
- **The init dictionary stays empty when the caller passes nothing**, so
  `typedFetch(request)` does not trip the Fetch Standard's "init is not empty"
  branch and does not detach the `Request`'s own signal.
- **Signal, abort, and timeout interleaving.** The abort state is snapshotted
  under one guard. A network failure that merely coincides with an abort stays a
  `NetworkError`, and the three synchronous steps in the catch admit no
  interleaving. Note the premise moved: `normalizeHeaderValue` calls `String()`,
  so caller `toString`/`Symbol.toPrimitive` code CAN run there now. It is
  synchronous, so the conclusion holds.
- **Header-container coverage** matches WebIDL's `HeadersInit` conversion for a
  record, an array of pairs, a `Headers` instance, an inner pair that is any
  iterable rather than an `Array`, and a callable carrying own enumerable
  properties. Names and values are both collected. The residual is a ONE-SHOT
  inner iterable, exhausted by `fetch` before the failure path reads it — pinned
  by a test so it cannot become silent.
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
  properties only, so `url`, `headers`, `cause`, and `reason` stay out.
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
  `verify-pack` uses an allowlist plus exact file-count bounds; `validate-release`
  ties tag, version, changelog heading, footer links, and the `origin/main` tip
  together; `check-docs` fails loudly on a missing or partial `dist/`;
  `is-main-module` resolves symlinks on both sides.

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

6. **A platform message that echoes a header value the platform ACCEPTED.** Only
   a refused value reaches a rejection message, and striking every held value
   would replace `1` or `application/json` wherever they appeared.

7. **The eight permanent exclusions in ADR 0003.** Read them before reporting a
   hostile-`fetch` behavior; a report that the library does not handle one of
   them is not a defect.

## What this file is not

It is not a promise that nothing is left. It is a record of what was examined
and what was decided, so the next pass starts from the frontier instead of the
beginning. A finding that clears the evidence bar and contradicts an entry here
is welcome — and it should say which entry, and why the reasoning there fails.
