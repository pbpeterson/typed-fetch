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

- **Identity** — the four fields an HTTP error takes from its `Response`:
  `status`, `statusText`, `url`, and `headers`. The identity module records each
  successful read immediately in a `WeakMap`. A later failure cannot cause an
  earlier field to run again.

  The recorded status selects the error class. The same value appears in
  `error.status`, `error.message`, and the `toJSON()` record.

  The copy from `clone()` inherits the original error's identity when the same
  package **copy** builds both. The identity is **lent** to the **branch** during
  construction. The lender removes it when construction ends.

  The identity module normalizes fields where an injected `Response` can differ.
  `status` uses `Number()` on its first successful read. Non-string `statusText`
  and `url` values become empty strings.

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
- **The ownership query** — the one member under this package's OWN
  `Symbol.for` keys that is callable rather than a marker (the inspect hook is
  callable too, but its key is the platform's):
  `ownsResponse`, stamped on `BaseHttpError.prototype`,
  answering "do you own this exact `Response`?". It is the cross-copy
  counterpart of `ErrorBody.owns`. A brand cannot carry it, because a brand has
  one answer per class and this one is computed per instance and per response.
  `clone()` asks it when the returned error is absent from this **copy**'s body
  table, which is the only state in which the branch's owner is invisible from
  here. The key, the argument, and the boolean answer are a protocol between
  package **versions**, not merely between copies: a copy released before the
  query existed cannot answer, so `clone()` releases the **branch** and throws
  rather than reading silence as consent. A new question gets a new key; this
  one keeps its meaning forever.
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
  `format:check`, `check-doc-style`, `typecheck`, `build`, `test`, `check-docs`,
  `verify-pack`, `check-consumer`, `audit:prod`, `audit:ci`). CI adds
  `check-deno-consumer`, `smoke:deno`, `smoke:node-min`, and a Bun runtime
  smoke. CONTRIBUTING holds the authoritative list and run order.
- **Frozen surface** — the public export set, snapshotted on two axes (runtime
  values, and type-only exports read from the built `.d.mts`). Changing it is a
  deliberate, reviewed act.
- **Channel** — one mechanism through which an error's data reaches a reader.
  Seven exist, and they are exactly the seven `disclosure-channels.spec.ts`
  numbers: `JSON.stringify` with `toJSON`, `util.inspect` with `console.*`,
  `toString` with template interpolation, the `message` on its own,
  own enumerable properties (`Object.keys` and the spread), `structuredClone`
  with `postMessage`, and the fatal-exception printer.

  A test runner's diff and assertion output is **not** on this list. It is a
  residual, recorded below: it reads own property names including
  non-enumerable ones, so it cannot satisfy the rule every channel here does.
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
    cross-format assignability hazard (`TS2741`). Five members are stamped
    this way: the brands, the inspect hook under Node's key, the same hook
    under Deno's key, the ownership query, and the string-conversion hook. One
    key per gated runtime, not one key: Bun resolves Node's key, and Deno
    resolves `Symbol.for("Deno.customInspect")` first. The brands and the
    query are stamped `writable: false, configurable: false`, because a
    replaced answer to "do you own this branch?" strands a stream that only
    that method can vouch for. The inspect hook stays replaceable under both
    keys, because a consumer may legitimately install their own. The
    string-conversion hook stays replaceable, for the reason the inspect hook
    stays replaceable. It delegates to `toString`, so a subclass override
    still decides the channel.

- **Residual** — something the library cannot close, stated rather than left
  undiscovered. Five exist, and the first three are disclosures a **channel**
  keeps. `cause` survives `structuredClone` and the fatal-exception printer,
  because both are platform algorithms with no hook. vitest's assertion-message
  stringifier reads own property names including non-enumerable ones, and it
  short-circuits errors before its custom-inspect branch. A secret in the path
  of a hierarchical URL survives redaction by design. Dropping that path would
  reduce the URL to its origin.

  The other two are limits on a guarantee rather than disclosures, and they
  are named here so the next reader meets them as decisions.
  - A **copy** that answers the ownership query `true` while holding a different
    response is believed. The query is a protocol across a **seam**, not a
    proof, and nothing on this side of the seam can check it. The alternative is
    to hand a foreign object the `Response` and let it prove custody, which is
    what `recreate` already does.
  - The **identity** a **branch** inherits reaches at most one error: the one
    built from that branch, by the cloning package **copy**, inside the
    `clone()` call. Four cases fall outside that sentence, and none of the four
    is a resource or a disclosure defect.

    Two of them are the scope of the loan. A `recreate` callback that returns an
    instance from a DIFFERENT package **copy** runs that copy's constructor
    against that copy's identity tables, which never saw the loan, so that
    instance reads the branch. So does any error built from the branch after
    `clone()` returns.

    Two of them keep the loan from reaching even the copy. A branch this library
    has ALREADY read keeps the identity it read: `lendIdentity` refuses a loan
    over a record, so the copy reports the record and the two errors disagree.
    That refusal is the correct trade, because a loan that shadowed a record
    would BE the poisoning the loan exists to prevent. Separately, a `recreate`
    callback that calls `clone()` again lands a second loan on the same key,
    when a double answers `clone()` with one `Response` every time. The inner
    revoke removes the outer loan, and the outer copy reads the branch. That is
    copy divergence, not poisoning: the branch is still read once, the record is
    true about it, and a later request that resolves it reports its own status.
    A per-key stack of loans closes it and is refused — see
    `src/errors/response-identity.ts` for the cost.

    For a real `Response` none of the four is observable. A platform branch
    answers with the same four values the source did, it carries no earlier
    record, and a platform `clone()` never answers twice with one object. Each
    shows only through a shadowed or hostile own-property getter — where the
    re-read values are the truer ones, since they come from the platform's
    internal slots. The loan is deliberately this narrow: it is written into a
    table keyed by an object that a custom Fetch implementation chose, so
    anything wider would let one lie about one response reach a request that has
    nothing to do with it.

- **Structure and value** — the rule that decides what a channel may carry.
  `headers` emits names, never values. A hierarchical `url` emits the origin and
  path, and only those: every emitted byte comes from the origin or from the
  parsed `pathname`. It never emits userinfo, a query, or a fragment. An opaque
  URL emits only its scheme. Every redaction names the property that holds the
  full value. Read `error.headers`, `error.url`, `error.cause`, or
  `error.reason` for deliberate access.
- **Library-authored message** — the rule for a request failure's `message`. It
  is a constant this library wrote, never a string a platform produced. A
  platform reports a request it refused by quoting the caller's value back — a
  header name or value, the URL, the referrer, the method, an enum member — and
  striking that echo out needs the caller's value a second time, which the
  caller controls. The platform error stays on `error.cause`.
- **Phase** — one of the three parts of a `typedFetch` call, each with its own
  catch: SETUP (reading the options, building the init), TRANSPORT (the awaited
  `fetch` call), and RESPONSE (inspecting the resolved value). Only the
  transport phase can produce an `AbortedError` or a `TimeoutError`, because it
  is the only phase whose failure the governing signal can have caused.

## The modules

```
index.ts                      public barrel — deliberately small
src/index.ts                  typedFetch + the guards; owns the envelope and
                              the transport seam. The `fetch` override is read
                              as an OWN property, never through the prototype
                              chain. `typedFetch` captures the governing signal
                              once — a handed-over `Request` contributes that
                              signal through `Request.prototype`'s accessor
                              when the AMBIENT transport runs, and through its
                              own property when caller code runs as the
                              transport — and serializes the request input
                              once. It
                              never reads `headers`; the transport does. It runs
                              in THREE PHASES with a catch each — setup,
                              transport, response — and only the transport can
                              produce an abort or a timeout. It validates the
                              visible Response surface before handoff, then
                              returns the same object unmodified.
src/request-failure.ts        classifies a rejected request attempt as an
                              abort, a timeout, or a network failure. The
                              AbortSignal is the authority, never the
                              rejection's name. INTERNAL.
src/headers.ts                StrictHeaders / TypedHeaders — autocomplete
                              only, no validation. INTERNAL.
src/methods.ts                HttpMethods; excludes CONNECT and TRACE, which
                              the Fetch spec forbids. PUBLIC: the root barrel
                              re-exports the type.
src/http-status-codes.ts      statusCodeErrorMap — a ReadonlyMap DERIVED from
                              the roster, not a source of truth. INTERNAL.
src/errors/base-http-error    HTTP error IDENTITY: status, statusText, url,
                              headers, message. Delegates the body.
src/errors/response-identity  records the first successful read of each
                              Response identity field. INTERNAL — never export
                              it from a barrel.
src/errors/error-body         the response-body lifecycle: claim, cancel, tee.
                              Rejection cleanup can use captured Response and
                              ReadableStream operations when own properties or
                              replaced prototypes hide a native live body.
                              INTERNAL — never export it from a barrel.
src/errors/known-http-error   the branded base the 40 dedicated classes
                              extend. INTERNAL — it is what isKnownHttpError
                              requires, and what a consumer subclass cannot
                              obtain.
src/errors/brand              cross-copy identity: the brands, and the
                              ownership query one copy asks another
src/errors/helpers            the roster and the public unions
```

`base-http-error` and `error-body` are one seam, drawn where the two concerns
meet: identity above it, a single-use stream below it. `base-http-error` holds
an `ErrorBody` handle per instance in a module-scoped `WeakMap` and delegates
every body method to it. The `Response` itself stays captured in a closure
inside `error-body`, so it is not reachable from the error a consumer holds.

`response-identity` sits on the identity side of that seam, and it is keyed the
other way round: the body table is keyed by the ERROR, and the identity tables
are keyed by the RESPONSE. That is the whole design. One response has one
identity, so two errors built from it — the original and the **copy** `clone()`
produces — report the same four fields, and a getter that answers differently on
a second read cannot make them disagree. `base-http-error` keeps a second
per-instance table so `clone()` can hand the copy the identity it inherits
instead of letting it read the **branch** again. It hands it over as a **loan**
against a third table, revoked in a `finally` once the copy is built. The branch
is whatever `response.clone()` answered with, and a custom Fetch implementation
can answer with a `Response` it did not create; a permanent record would bind
that `Response` to this error's identity for as long as it lives.

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
