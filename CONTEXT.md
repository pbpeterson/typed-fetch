# CONTEXT

The structure of this codebase, and the words it uses. `README.md` is for
consumers, `CONTRIBUTING.md` is for the gates and the mechanical procedures, and
`RELEASING.md` is for the semver policy. This file is for the vocabulary. Read
it before you design anything here, so that a change uses the existing terms
instead of new ones.

## Design vocabulary

These terms are used exactly, and nothing substitutes for them. Repetition of a
defined term is correct here.

- **Module** — anything with an interface and an implementation. Scale-agnostic:
  a function, a file, an entry point. Not "component", not "service", not
  "util".
- **Interface** — everything a caller must know to use a module correctly. Not
  just the type signature: also the invariants, the ordering constraints, the
  error modes, and which calls throw synchronously versus reject. In this
  repository, "the four readers claim the body and reject; `tee()` claims
  nothing and throws" is part of an interface.
- **Depth** — leverage at the interface: how much behavior a caller can reach
  per unit of interface it must learn. `error-body` is deep — the `ErrorBody`
  interface has eight members (`teed`, `owns`, the four readers, `cancel`,
  `tee`) over roughly 290 lines of platform-divergence handling. A module is
  **shallow** when its interface is nearly as complicated as its
  implementation.
- **Seam** — the place where a module's interface lives; where behavior can be
  altered without editing in that place. Say seam, never "boundary" (overloaded)
  and never "layer".
- **Adapter** — a concrete thing satisfying an interface at a seam. Describes a
  role, not a substance.
- **Leverage** — what callers get from depth. **Locality** — what maintainers
  get from depth: a change, a bug, and its test land in one place.
- **The deletion test** — imagine the module deleted. If complexity vanishes, it
  was a pass-through and should go. If complexity reappears across callers, the
  module is worth keeping. Apply this before adding any file.
- **The interface is the test surface.** Callers and tests cross the same seam.
  Needing to test _past_ an interface means the module is the wrong shape. The
  body-lifecycle extraction happened because a large group of tests constructed
  a `NotFoundError` to reach behavior that was not about `NotFoundError`.
  Those tests now call `errorBodyOf` directly.

## Domain vocabulary

Words this codebase already uses, some of them only implicitly until now.

- **Error body** — the body of the `Response` that produced an HTTP error. A
  single-use stream owned by `src/errors/error-body.ts`. Every error body must
  be read or canceled. An unread body keeps its stream open, and the open stream
  holds the underlying connection until the runtime collects it.
- **Claim** — to take the body for a read. Claiming succeeds once; afterwards
  every reader and `tee()` refuse.
- **Available / unavailable** — one predicate (`claimable()`), four disjuncts:
  canceled by us, read by us (`readStarted`), consumed (`bodyUsed`), or
  `body.locked`. It is written **once**; the reader guard and the tee guard
  differ only in the message they raise. An earlier version wrote the predicate
  out twice, and the two copies disagreed about what "unusable" meant.
- **`readStarted` vs `bodyUsed`** — never infer "we read this" from
  `response.bodyUsed`. Bun sets it when `getReader()` locks the stream; Node,
  Deno, and workerd do not. `readStarted` is _our_ read; `bodyUsed` is the
  platform's opinion.
- **Tee / branch / source / orphan** — `Response.clone()` tees the body stream
  into two **branches** over one **source**. The platform releases the source
  only once EVERY branch is read or canceled, so a lone `cancel()` stays
  pending. That is native semantics, and the library keeps it: resolving early
  would report a release that did not happen. A branch whose owner never came
  into existence is an **orphan**. Release an orphan, or the source is never
  freed.
- **Decision order** — `cancel()` decides in a fixed sequence: repeated cancel →
  our own read → external lock (throws) → consumed body → release. The order is
  required: a completed read leaves the stream locked on some runtimes, so the
  lock test cannot come first.
- **Documented divergence** — a runtime difference the library describes and
  handles explicitly, choosing the behavior that is correct on the runtime
  reporting the state. Bun's `bodyUsed`-on-lock is the standing example.
- **Copy** — one instance of this library's classes in a process. Two entry
  points (`.`, `./errors`) × two formats (ESM, CJS) means a consumer can hold
  several. `instanceof` is per-copy and unreliable across them.
- **Brand** — a `Symbol.for`-keyed marker stamped on a root error prototype so
  the guards recognize a value across copies. The authority on "did this library
  make this?" — not `instanceof`, and not assignability.
- **Structural, deliberately** — the error classes carry no `#private`,
  `private`, or `protected` member, because TypeScript emits a nominal
  `#private;` marker that makes the `.d.ts` and `.d.mts` copies of every class
  mutually unassignable. The accepted cost is that a same-shaped object is
  assignable to `BaseHttpError`; the brands, not the type system, decide
  provenance. **This is a hard rule.** It also binds internal modules: prefer a
  factory over closures to a class with private fields.
- **Envelope** — the `{ response, error }` discriminated union `typedFetch`
  returns. Anything that could throw inside a request goes inside the envelope
  and comes out as an error value.
- **Roster** — the internal `httpErrors` array and the `ClientErrors` /
  `ServerErrors` unions: the source of truth for the 40 dedicated classes, kept
  correct by the roster tests rather than by a generator. `statusCodeErrorMap`
  is **not** part of the roster. It is a **projection** of it, derived in
  `src/http-status-codes.ts` from each class's own `static status`, so a map
  entry can no longer disagree with the class it names.
- **Gate** — a check that must pass before a PR merges (`pnpm lint`,
  `format:check`, `typecheck`, `build`, `test`, `check-docs`, `verify-pack`,
  `check-consumer`, `audit:prod`, `audit`). CI adds `check-deno-consumer` and
  `smoke:node-min`. CONTRIBUTING holds the authoritative list and the order to
  run them in.
- **Frozen surface** — the public export set, snapshotted on two axes (runtime
  values, and type-only exports read from the built `.d.mts`). Changing it is a
  deliberate, reviewed act.
- **Channel** — one mechanism through which an error's data reaches a reader.
  Seven exist: `JSON.stringify` with `toJSON`, `util.inspect` with `console.*`,
  the fatal-exception printer, `toString`, `structuredClone`, a test runner's
  diff and assertion output, and `Object.keys` with the spread.
  **A disclosure decision applies to the channel set, never to one channel.**
  `toJSON()` was fixed to withhold header values while `util.inspect` printed
  them in full, because only one of the two had been considered. The inventory
  lives in `disclosure-channels.spec.ts` as executable tests, one per channel,
  each asserting that a planted sentinel does not appear. Add a channel there
  before adding a member anywhere.

  Three corollaries are load-bearing.
  - The inspect hook renders the `toJSON()` record rather than its own member
    list, so the two channels cannot drift and one subclass override fixes both.
  - Node's fatal-exception printer disables every formatting hook. Property
    **enumerability** is the only control over that channel.
  - Symbol-keyed behavior is stamped onto the prototype with `defineProperty`,
    never declared as a computed class member. A computed member emits a
    `unique symbol` into both declaration files and reintroduces the `#private`
    cross-format assignability hazard (`TS2741`).

- **Residual** — a disclosure a channel keeps, stated rather than left
  undiscovered. Three exist. `cause` survives `structuredClone` and the
  fatal-exception printer, because both are platform algorithms with no hook.
  vitest's assertion-message stringifier reads own property names including
  non-enumerable ones, and it short-circuits errors before its custom-inspect
  branch. A secret in a URL path segment survives redaction by design, because
  dropping the path would reduce `url` to the origin.

- **Structure and value** — the rule that decides what a channel may carry.
  `headers` emits names, never values. `url` emits the origin and the path,
  never the userinfo, the query, or the fragment. Every redaction names the
  property that holds the full thing. Read `error.headers` for header values,
  `error.url` for the full href, and `error.cause` or `error.reason` for the
  platform detail.

## The modules

```
index.ts                    public barrel — deliberately small
src/index.ts                typedFetch + the guards; owns the envelope and the
                            transport seam. The `fetch` override is read as an
                            OWN property, never through the prototype chain.
src/request-failure.ts      classifies a rejected request attempt as an abort,
                            a timeout, or a network failure. The AbortSignal is
                            the authority, never the rejection's name.
                            INTERNAL.
src/headers.ts              StrictHeaders / TypedHeaders — autocomplete only,
                            no validation. INTERNAL.
src/methods.ts              HttpMethods; excludes CONNECT and TRACE, which the
                            Fetch spec forbids. INTERNAL.
src/http-status-codes.ts    statusCodeErrorMap — a ReadonlyMap DERIVED from the
                            roster, not a source of truth. INTERNAL.
src/errors/base-http-error  HTTP error IDENTITY: status, statusText, url,
                            headers, message. Delegates the body.
src/errors/error-body       the response-body lifecycle: claim, cancel, tee.
                            INTERNAL — never export it from a barrel.
src/errors/known-http-error the branded base the 40 dedicated classes extend.
                            INTERNAL — it is what isKnownHttpError requires,
                            and what a consumer subclass cannot obtain.
src/errors/brand            cross-copy identity
src/errors/helpers          the roster and the public unions
```

`base-http-error` and `error-body` are one seam, drawn where the two concerns
meet: identity above it, a single-use stream below it. `base-http-error` holds
an `ErrorBody` handle per instance in a module-scoped `WeakMap` and delegates
every body method to it. The `Response` itself stays captured in a closure
inside `error-body`, so it is not reachable from the error a consumer holds.

The seam exists for locality (successive rounds of defects all landed in the
lifecycle: a locked-body guard the readers missed, Bun's `bodyUsed` divergence,
a tee branch left without an owner, and a body consumed outside the library) and
for the test surface (a body is constructible in one line, with no error class).
It does not exist because anything varies across it. There is one caller and
there will never be a second implementation.

One follow-up is open and deliberately not done. `headers` and `url` could stop
being own properties, and prototype getters backed by a `WeakMap` could serve
them, in the way `bodies` already works. That would also close vitest's
assertion-message channel, which reads non-enumerable own property names. It is
rejected for now. It refactors two released public properties for the
lowest-value sink in the inventory.
