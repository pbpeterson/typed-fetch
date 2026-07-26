---
name: typed-fetch-maintainer
description: Maintainer guide for @pbpeterson/typed-fetch — a zero-dependency, type-safe fetch wrapper with Go-style errors-as-values. Use when working in this repository — adding HTTP error classes, changing typedFetch behavior, editing TypedHeaders/HttpMethods, writing tests, or cutting a release. Triggers on typedFetch, BaseHttpError, UnknownHttpError, NetworkError, AbortedError, TimeoutError, statusCodeErrorMap, ClientErrors/ServerErrors.
---

# typed-fetch Maintainer Guide

Type-safe `fetch` wrapper that resolves request failures through a
`{ response, error }` discriminated union. Body readers are separate operations
and can reject. Zero runtime dependencies. Published to npm via OIDC trusted
publishing.

Three companion documents are authoritative; follow them at the source rather
than a copy. **CONTEXT.md** — design vocabulary, module map, seams.
**CONTRIBUTING.md** — the gates and every mechanical procedure.
**RELEASING.md** — semver policy and the release process.

## Architecture

CONTEXT.md holds the module map. This tree adds only `src/errors/`:

```
base-http-error.ts      → HTTP error IDENTITY (status, statusText, url,
                          headers, message); body methods delegate
response-identity.ts    → the four identity fields of one Response, read once
                          per response (INTERNAL)
error-body.ts           → internal single-use body lifecycle (see below)
known-http-error.ts     → internal branded base for the 40 dedicated classes
network-error.ts        → NetworkError with cause (original fetch rejection)
aborted-error.ts        → AbortedError (controller.abort()); NOT NetworkError
timeout-error.ts        → TimeoutError (AbortSignal.timeout()); NOT NetworkError
unknown-http-error.ts   → any status >= 400 not in the map (non-literal status)
helpers.ts              → public unions + internal HttpErrors/httpErrors roster
index.ts                → re-export barrel for the ./errors subpath
<40 status files>       → dedicated classes, see pattern below
```

## Core flow (src/index.ts)

1. Inside the request `try`, read an optional `options.fetch` override. When
   present, build a descriptor/prototype-preserving facade that hides the
   extension while a proxy delegates property reads to the original receiver;
   otherwise forward `options` unchanged. Resolve the effective abort signal
   with realm-safe `Request` detection.
2. `const res = await fetchImpl(url, init)` inside the `try`, which also covers
   option getters and normalization. `src/request-failure.ts` then classifies
   any failure as `AbortedError` (original rejection as `cause`), `TimeoutError`
   (from `AbortSignal.timeout()`), or `NetworkError`. It never rethrows. The
   abort path is taken when `err === signal.reason` OR the governing signal
   reports `aborted` and the rejection is error-shaped and named
   `"AbortError"`/`"TimeoutError"` — an injected fetch (whatwg-fetch,
   node-fetch@3) builds its own abort error. `reason ?? err` then decides
   timeout vs abort. An aborted signal alone is never sufficient.
3. `statusOf(res) >= 400` → mapped class from `statusCodeErrorMap`, else
   `UnknownHttpError`. `statusOf` (`src/errors/response-identity.ts`) records
   the value it read, so the SAME read reaches the `BaseHttpError` constructor
   and `UnknownHttpError` — the status that selected the class is the status in
   `error.status`, in `error.message`, and in the `toJSON()` record. It is
   `Number(raw)`, so an injected fetch answering `"404"` reaches `NotFoundError`
   with a numeric `404`. Never read `res.status` directly here. This runs INSIDE
   the same `try`: an injected fetch can resolve a non-`Response` or a hostile
   getter, the numeric conversion can throw through a hostile `valueOf`, and
   both must stay an error value.
4. Otherwise success — body NOT parsed; consumer calls `response.json()`. 3xx with `redirect: "manual"` is success.

No broad internal throw/catch control flow beyond the single `fetch` envelope.
Narrow defensive readers may catch hostile property/prototype access only to
keep a rejected custom-fetch value inside that envelope. They must not drive
normal request control flow.

### The error contract (consumer-facing — keep it stable)

- `AbortedError` and `TimeoutError` do NOT extend `NetworkError`, so `isNetworkError()` returns **false** for both. Consumers discriminate with `isAbortError` / `isTimeoutError`, never by inspecting `error.cause.name`.
- `AbortedError` carries the abort reason as `error.reason` (plus the original rejection as `cause`); `TimeoutError` is the sub-case produced by `AbortSignal.timeout()`.
- HTTP errors carry `error.url` and fold the server's wire reason phrase into `error.message`. `error.message` is NOT part of the semver contract. Assert on `.status`/`.name`/`.statusText` in behavior tests; a narrow constructor regression test may characterize a message branch without promoting the text to a guarantee.

## Type guards (src/index.ts)

Five, from the main entry: `isHttpError`, `isKnownHttpError`, `isNetworkError`,
`isAbortError`, `isTimeoutError`. The constraint to preserve: a consumer-defined
`BaseHttpError` subclass passes `isHttpError` but must NOT pass
`isKnownHttpError`, which requires the internal known-error brand AND a status
in the receiving copy's map. That second condition keeps `ClientErrors |
ServerErrors` sound across copies, entries, and mixed versions — a newer copy's
status cannot narrow into an older copy's union.

## Error class pattern

```typescript no-check
import { KnownHttpError } from "./known-http-error";

/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/404 */
export class NotFoundError extends KnownHttpError {
  override readonly name = "NotFoundError" as const;
  public readonly status = 404 as const;
  public readonly statusText = "Not Found" as const;
  static readonly status = 404 as const;
  static readonly statusText = "Not Found" as const;
}
```

Extend the internal `KnownHttpError`; set an explicit literal `name`; use
`as const`; provide instance AND static status properties; add no constructor
and no `clone()`. `statusText` is the library's canonical protocol label, never
the server's wire value — documented exceptions are 418 and 510.

### Adding a new status code

**CONTRIBUTING.md, "Adding a new HTTP status code", is the authoritative
procedure. Follow it there, not a copy.** The roster is hand-maintained in
`src/errors/helpers.ts` — the `httpErrors` array and the
`ClientErrors`/`ServerErrors` unions. Three points are read wrong most often:

- `statusCodeErrorMap` in `src/http-status-codes.ts` is **derived** from
  `httpErrors`, which reads each class's own `static status`. There is no Map
  literal and no import block. A hand-written `[NNN, NnnError]` entry is not
  possible, and the file needs no edit at all. The map is a projection of the
  roster, not a second source of truth.
- There are **no cardinality numbers to change**. `roster-sync.spec.ts` asserts
  against `allErrors.length`. The literal `40` survives only in test titles.
- The `errorCases` table in `typed-fetch.spec.ts` is enforced by **no test**.
  If you omit the row, `test.each` runs one case fewer, the suite still passes,
  and the new status code never goes through a live request.

Adding a class changes the public API surface, so refresh the snapshot with
`pnpm build && pnpm test -u`. It is a `major`; see RELEASING.md. For `clone()`
on consumer subclasses, see CONTRIBUTING.md, "Consumer subclasses and cloning".

## Error body lifecycle (`src/errors/error-body.ts`)

**CONTRIBUTING.md, "Error response bodies", holds the invariants** — the
`claimable()` predicate, the fixed `cancel()` order, the `bodyUsed` rule, and
the tee contract. Four facts about the seam, because they are read wrong most
often:

- The lifecycle is NOT in `base-http-error.ts`. That file owns HTTP error
  identity (status, statusText, url, headers, message); its body methods delegate.
  It keeps TWO module-scoped `WeakMap`s keyed by the error instance: `bodies`
  (the `ErrorBody` handle) and `identities` (the `ResponseIdentity` the
  constructor read). Both live outside the class for the same reason: a
  `#private` field emits a nominal `#private;` marker into both declaration
  files and makes the two declarations of every class mutually unassignable.
  The identity tables in `response-identity.ts` are keyed the other way round,
  by the RESPONSE, so two errors built from one response report one identity.
- `errorBodyOf(response)` captures the `Response` in a **closure**, never as a
  property, so it is unreachable from the error a consumer holds.
  `base-http-error.ts` keys one `ErrorBody` handle per instance in a
  `WeakMap<BaseHttpError, ErrorBody>`, read through `bodyOf(error)` — which also
  rejects a structurally-assignable impostor and any subclass that skipped
  `super(response)`.
- State inside `errorBodyOf` is closure variables (`cancelled`, `readStarted`,
  `cancelling`); `teed` is the only property on the returned object. There is no
  `State` record and no `response` field.
- `clone()` does two things beyond teeing. It calls
  `lendIdentity(teed.branch, identity)` BEFORE it builds the copy, so a copy this
  package copy builds inherits this error's identity instead of reading the
  branch — a real `Response.clone()` reports the platform's internal slots, not
  the own-property getter that produced the original identity. LENT, not
  recorded: the returned revoke runs in a `finally` around the construction.
  `teed.branch` is whatever `response.clone()` answered with, and a custom Fetch
  implementation can answer with a `Response` it did not create, so a permanent
  record would bind a real, unrelated `Response` to this error's identity for the
  life of the process. Never widen that window, and never let `statusOf` consult
  the loan — that is the read `typedFetch` performs on every resolved response.
  An instance from a DIFFERENT package copy inherits nothing, because the
  identity tables are per copy; it reads the branch.
- `clone()` then decides ownership of the branch, and the last open case crosses
  a package copy seam: when the returned
  error is absent from this copy's `bodies` table and does not claim this copy,
  `asksOwnsResponse(copy, teed.branch)` asks it directly, through the
  `Symbol.for("@pbpeterson/typed-fetch.ownsResponse")` method that
  `stampOwnsResponse` puts on `BaseHttpError.prototype`. `true` accepts;
  `false` and `undefined` both release the branch and throw, with different
  messages. Never make `adopt()` decide that — the question is about identity
  and prototypes, which live above this seam.

A refused read **rejects** (the readers are `async`); a refused `clone()`
**throws** (`tee()` is synchronous). Keep that split. Never resolve a teed
`cancel()` early, and never auto-cancel the sibling branch.

## Guardrail tests (roster-sync.spec.ts, public-surface.spec.ts)

Run and read these when touching errors. They make the hand-written roster
checkable rather than trusted.

- **Roster sync** (`roster-sync.spec.ts`): compile-time `InstanceType<HttpErrors>`
  vs `ClientErrors | ServerErrors` exhaustiveness; runtime cardinality asserted
  against the independently authored `allErrors.length` (no literal count);
  `httpErrors` ↔ `statusCodeErrorMap` agreement; and 40 per-class
  `expectTypeOf<XError["status"]>().toEqualTypeOf<NNN>()` assertions — the
  array/union checks do NOT catch a single class's literal being widened.
- **Frozen public surface** (`public-surface.spec.ts`): THREE
  `describe.skipIf(!distExists)` blocks, not one — `"public API surface is
frozen"` (runtime named exports), `"public TYPE surface is frozen"` (type-only
  exports read from the built `.d.mts` with the TypeScript compiler API), and
  `"guards work across module copies (dist)"`. The value and type axes are
  independent: `Object.keys()` is blind to type-only exports. See
  CONTRIBUTING.md, "The public surface is frozen — both axes".

Both read `dist/`, so build BEFORE test or they silently skip. An intentional
export change needs `pnpm build && pnpm test -u`.

## Verification

**CONTRIBUTING.md, "The gates", is the authoritative list and run order.** Run
every gate before you commit. With Deno 2 installed, also run
`pnpm check-deno-consumer` after `pnpm build` — the manual `node_modules` mode
requires Deno 2. Facts that live only here:

- `pnpm typecheck` uses `tsconfig.test.json` — it includes the root `*.spec.ts` files so `expectTypeOf` assertions are real. Plain `tsc --noEmit` skips them. Spec files must stay at the repo root: the include glob is root-only, and one test reads `src/errors/base-http-error.ts` via a CWD-relative path.
- Tests hit a real local HTTP server (no mocks). Query params drive responses: `?status=`, `?body=`, `?header=Key:Value`.
- 407 cannot go through Node's fetch (rejected at the network level) — tested via direct construction, and deliberately excluded from `errorCases`.
- Abort/timeout are exercised against the live server (`controller.abort()` and `AbortSignal.timeout()`), asserting `AbortedError`/`TimeoutError` and that `isNetworkError` is false for both.

## Gotchas

- `tsconfig.json` sets `"lib": ["ES2022", "DOM"]` for THIS repository's own
  build. It is not a consumer requirement, and it is NOT what makes `headers.ts`
  work: `src/headers.ts` deliberately REFUSES to name `HeadersInit`. That name
  lives only in `lib.dom.d.ts`, so naming it made the published declarations
  fail for a Node consumer without DOM (`TS2304`), or — with `skipLibCheck` —
  collapse `TypedHeaders` to `any`. `NativeFetchHeaders` derives from
  `Parameters<typeof fetch>` instead. Never put a `lib.dom` type name into the
  published surface.
- `tsup.config.ts` carries `ignoreDeprecations: "6.0"` in dts compilerOptions — tsup injects deprecated `baseUrl`; remove when tsup fixes it.
- oxfmt formats and sorts `package.json`. Accept its output rather than reverting it.
- `statusCodeErrorMap` is `ReadonlyMap` by type; never mutate. It iterates in
  `httpErrors` order (alphabetical by class name), not ascending status; nothing
  depends on that, because both call sites are key lookups.
- `options.fetch` is stripped before the init reaches the underlying fetch, via
  a sanitized facade/proxy that reads getters against the original receiver.
  Never replace it with an object spread: inherited/WebIDL properties,
  private-backed getters, and cross-realm `Request` behavior must survive, and
  accessor failures must stay inside the error envelope.
- CI verifies Node 20, 22, and 24, a Node-floor job pinned to 20.0.0, plus Bun
  and Deno. The floor job runs `pnpm smoke:node-min`, which proves nothing
  unless it runs on a real Node 20.0.0 binary — on a newer runtime it warns
  instead of failing. Browser and edge support follows from the Web-standard-only
  implementation, but a runtime is not verified until its smoke test exists.
  Keep Node APIs outside production source.

## Release

Releases are PR-reviewed and tag-driven. **RELEASING.md is the binding process
and the authoritative semver policy — follow it exactly.** Nothing publishes
except a pushed `vX.Y.Z` tag on a merged, reviewed commit. Never retry a release
by moving or reusing a published tag. The semver rule most often missed:
**registering a dedicated error class is a `major`**, because it widens the
returned union and moves that status off `UnknownHttpError`.
