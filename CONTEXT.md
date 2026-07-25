# CONTEXT

How this codebase is _shaped_, and the words it uses. `README.md` is for
consumers, `CONTRIBUTING.md` is for the gates and the mechanical chores, and
`RELEASING.md` is for the semver policy. This file is for the vocabulary — read
it before designing anything here, so a change lands using the words already in
play instead of inventing new ones.

## Design vocabulary

These terms are used exactly, and nothing substitutes for them. Consistency is
the point.

- **Module** — anything with an interface and an implementation. Scale-agnostic:
  a function, a file, an entry point. Not "component", not "service", not
  "util".
- **Interface** — everything a caller must know to use a module correctly. Not
  just the type signature: also the invariants, the ordering constraints, the
  error modes, and which calls throw synchronously versus reject. In this
  repository, "the four readers claim the body and reject; `tee()` claims
  nothing and throws" is part of an interface.
- **Depth** — leverage at the interface: how much behaviour a caller can reach
  per unit of interface it must learn. `error-body` is deep — six members over
  ~200 lines of platform-divergence handling. A module is **shallow** when its
  interface is nearly as complicated as its implementation.
- **Seam** — the place where a module's interface lives; where behaviour can be
  altered without editing in that place. Say seam, never "boundary" (overloaded)
  and never "layer".
- **Adapter** — a concrete thing satisfying an interface at a seam. Describes a
  role, not a substance.
- **Leverage** — what callers get from depth. **Locality** — what maintainers
  get from depth: a change, a bug, and its test land in one place.
- **The deletion test** — imagine the module deleted. If complexity vanishes, it
  was a pass-through and should go. If complexity reappears across callers, it
  earns its keep. Apply this before adding any file.
- **The interface is the test surface.** Callers and tests cross the same seam.
  Needing to test _past_ an interface means the module is the wrong shape. The
  body-lifecycle extraction happened because 23 tests were minting a
  `NotFoundError` to reach something that was not about `NotFoundError`.

## Domain vocabulary

Words this codebase already uses, some of them only implicitly until now.

- **Error body** — the body of the `Response` that produced an HTTP error. A
  single-use stream owned by `src/errors/error-body.ts`. Every error body needs
  a read or a cancel; an unread one pins a connection.
- **Claim** — to take the body for a read. Claiming succeeds once; afterwards
  every reader and `tee()` refuse.
- **Available / unavailable** — one predicate (`claimable()`), four disjuncts:
  cancelled by us, read by us (`readStarted`), consumed (`bodyUsed`), or
  `body.locked`. It is written **once**; the reader guard and the tee guard
  differ only in the message they throw. They were written twice, once, and
  drifted.
- **`readStarted` vs `bodyUsed`** — never infer "we read this" from
  `response.bodyUsed`. Bun sets it when `getReader()` locks the stream; Node,
  Deno, and workerd do not. `readStarted` is _our_ read; `bodyUsed` is the
  platform's opinion.
- **Tee / branch / source / orphan** — `Response.clone()` tees the body stream
  into two **branches** over one **source**. The platform releases the source
  only once EVERY branch is read or cancelled, so a lone `cancel()` stays
  pending — that is native semantics and is kept, never papered over. A branch
  whose owner never came into existence is an **orphan** and must be released,
  or the source is pinned forever.
- **Decision order** — `cancel()` decides in a fixed sequence: repeated cancel →
  our own read → external lock (throws) → consumed body → release. The order is
  load-bearing; a completed read leaves the stream locked on some runtimes, so
  the lock test cannot come first.
- **Documented divergence** — a runtime difference the library characterises
  rather than papers over, choosing the behaviour that is right on the runtime
  reporting the state. Bun's `bodyUsed`-on-lock is the standing example.
- **Copy** — one instance of this library's classes in a process. Two entry
  points (`.`, `./errors`) × two formats (ESM, CJS) means a consumer can hold
  several. `instanceof` is per-copy and unreliable across them.
- **Brand** — a `Symbol.for`-keyed marker stamped on a root error prototype so
  the guards recognise a value across copies. The authority on "did this library
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
- **Roster** — the internal `httpErrors` array plus `statusCodeErrorMap`; the
  source of truth for the 40 dedicated classes, kept honest by the roster tests
  rather than by a generator.
- **Gate** — a check that must pass before a PR merges (`pnpm lint`,
  `format:check`, `typecheck`, `build`, `test`, `check-docs`, `verify-pack`,
  `check-consumer`, `audit`). See CONTRIBUTING.
- **Frozen surface** — the public export set, snapshotted on two axes (runtime
  values, and type-only exports read from the built `.d.mts`). Changing it is a
  deliberate, reviewed act.

## The modules

```
index.ts                    public barrel — deliberately small
src/index.ts                typedFetch + the guards; owns the envelope
src/errors/base-http-error  HTTP error IDENTITY: status, statusText, url,
                            headers, message. Delegates the body.
src/errors/error-body       the response-body lifecycle: claim, cancel, tee.
                            INTERNAL — never export it from a barrel.
src/errors/brand            cross-copy identity
src/errors/helpers          the roster and the public unions
```

`base-http-error` and `error-body` are one seam, drawn where the two concerns
meet: identity above it, a single-use stream below it. The seam exists for
locality (three consecutive rounds of defects lived in the lifecycle) and for
the test surface (a body is constructible in one line, with no error class),
not because anything varies across it. There is one caller and there will
never be a second implementation.
