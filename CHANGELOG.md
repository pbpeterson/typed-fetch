# Changelog

## [Unreleased]

This is a **major**, and most of the breaks are in runtime behavior. Six
runtime changes remove behavior that `1.1.0` had.

1. `error.headers` and `error.url` are no longer enumerable. A spread, an
   `Object.keys(error)` walk, and a `for...in` loop no longer reach them.
2. `error.cause` and `AbortedError.reason` are no longer enumerable either.
3. `error.headers` is a copy of the response headers. A write through it no
   longer reaches the response.
4. `clone(recreate)` refuses two more callback results: a copy built from a
   different response, and a Proxy or a delegate wrapped around the new error.
5. A custom Fetch implementation that resolves a response whose `headers` is
   `null` yields a `NetworkError` instead of an HTTP error.
6. `typedFetch` reads the `fetch` override as an own property of `options`. An
   override that arrives through the prototype chain is ignored.

One break is compile-time. `TypedFetchOptions["headers"]` rejects `undefined`
as a header value, so code that compiled against `1.1.0` on a Node consumer
without `lib.dom` no longer compiles.

Read the migration table before you upgrade.

### Migration

| What changed                            | How it shows up                                       | What to do                                                             |
| --------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------- |
| `headers` and `url` are not enumerable  | A log built from `{ ...error }` loses both fields     | Call `error.toJSON()`, or read `error.headers` and `error.url` by name |
| `cause` and `reason` are not enumerable | A deep log loses the transport detail                 | Read `error.cause` and `error.reason` by name                          |
| `error.headers` is a copy               | `error.headers.set(...)` no longer edits the response | Edit the `Response` you hold                                           |
| `clone(recreate)` refuses a wrapper     | A `TypeError` names the wrapper                       | Return the new error itself, never a Proxy around it                   |
| `headers: null` from a custom Fetch     | The result is a `NetworkError`                        | Give the response a real `Headers` value                               |
| `fetch` must be an own property         | The request goes to the global `fetch`                | Write `{ ...options, fetch }` or `Object.assign(options, { fetch })`   |
| `headers` rejects `undefined`           | TS2322 or TS2375 on a Node consumer without `lib.dom` | Write `...(token ? { Authorization: token } : {})`                     |

### Breaking

- `error.headers` and `error.url` are no longer enumerable own properties. They
  now carry the descriptor the platform gives `Error.cause`: readable and
  writable, never enumerable. They no longer appear in `{ ...error }`, in
  `Object.keys(error)`, in `Object.entries(error)`, or in a `for...in` loop.
  Reading `error.headers` and `error.url` is unchanged. A logger that walked an
  error's own enumerable properties instead of calling `toJSON()` recorded every
  header value and the full request URL. Node's output for an uncaught error
  walks exactly those properties with every formatting hook disabled. A crash
  dump therefore printed undici's internal header list, including its cookie
  array. That path accepts no hook. Enumerability is the only control over it.
- `cause` and `reason` are no longer enumerable, which matches
  `new Error(message, { cause })`. They no longer appear in
  `JSON.stringify(error)`, in `{ ...error }`, or in `Object.keys(error)`, so a
  deep structured log no longer records undici's transport detail — local and
  remote addresses and ports. Reading them is unchanged and both stay writable.
- `error.headers` is a copy of the response headers, not the same object. A
  write through it no longer reaches the response. The copy is faithful: it
  keeps every repeated `set-cookie` entry.
- `clone(recreate)` rejects a callback that builds from a response other than
  the one it receives. Only `copy === this` was caught before, so a callback
  that ignored its argument orphaned the teed branch: the platform never freed
  the source and `cancel()` on the original never settled. The orphan is
  released before the `TypeError` is thrown.
- `clone(recreate)` also rejects a copy that claims this package copy but
  carries no body. The callback's return value used to be accepted when the body
  table had no entry for it. The reasoning was that the owner can live in
  another package copy's table, which is sound for a real second copy. An empty
  result is also what the table returns for any object it cannot key: a Proxy
  wrapper, an `Object.create` delegate, or a membrane. Instrumentation libraries
  install a Proxy wrapper routinely. The clone then succeeded and `cancel()` on
  the original never settled. The branch could not be released through the copy
  either, because `this` inside its `cancel` is the wrapper. That cost one
  pinned connection and one unreleased stream per cloned error, with no recovery
  path. A copy that claims this package copy's prototype chain must be
  registered in this copy's table. It is now refused with a `TypeError` that
  releases the branch first. An instance built by a genuinely different package
  copy is still accepted.
- A custom Fetch implementation that resolves a response whose `headers` is
  `null` now yields a `NetworkError` instead of an HTTP error. The error
  constructor copies the response headers, and `new Headers(null)` throws. The
  throw happens inside the envelope, so `typedFetch` still resolves rather than
  rejecting, and the response body is released before the error is built. A test
  double that returns a partial response must give `headers` a real value.
- `typedFetch` reads the `fetch` override as an own property of `options`. An
  override that arrives through the prototype chain is ignored, and the request
  goes to the global `fetch`. Reading it off the prototype made a single
  `Object.prototype.fetch = …` write anywhere in the process redirect every
  request in it. That includes a call that passes no options object at all,
  because its default `{}` inherits the write. The write also handed the
  caller's headers to whoever performed it. Verified before the change: an
  injected prototype `fetch` captured an `Authorization` header and returned a
  forged 200. Every other option keeps the platform's rule. `fetch` reads
  `RequestInit` as a WebIDL dictionary, and an inherited member is part of that
  input. Migration: set `fetch` as an own property, with `{ ...options, fetch }`
  or `Object.assign(options, { fetch })`.
- `TypedFetchOptions["headers"]` no longer accepts `undefined` as a header
  value. A header set from an optional variable — `{ Authorization: token }`
  where `token` is `string | undefined` — reached the platform as the literal
  string `"undefined"` and was sent on the wire. Two separate leaks admitted it:
  the index signature on the internal `StrictHeaders`, and undici's
  `HeaderRecord`, an all-optional mapped type reached through the native branch
  of the union. Narrowing only the first is a no-op, because the type is a union
  and the native branch still accepts the value. Both had to close. A consumer
  with `lib.dom` was already protected by the platform's own `HeadersInit`, so
  this affects the no-DOM Node profile, which is the one the library targets.
  The option is now deliberately stricter than the platform there. Write
  `...(token ? { Authorization: token } : {})` rather than passing `undefined`.

### Added

- `toJSON()` on every error class. An `Error` keeps `message` and `stack`
  non-enumerable, so a structured logger recorded every field except the one
  that names the failure — and `headers` serialized as `{}`, which reads as "no
  headers were sent". HTTP errors emit
  `{ name, message, status, statusText, url, headers }`; `NetworkError`,
  `AbortedError`, and `TimeoutError` emit `{ name, message, url }`. `headers`
  holds header NAMES, never values: a response carries the session in
  `set-cookie` and arbitrary secrets in custom headers, and a logger calls
  `toJSON()` on whatever it is handed, so the record must not carry a value that
  nobody judged. A deny list does not solve this, because the dangerous name is
  the one this library has never heard of. `error.headers` still holds every
  value. `url` is redacted the same way: the record keeps the origin and the
  path, and `error.url` still holds the full href. The body and the stack are
  absent for a neighboring reason — the body is a single-use asynchronous
  stream, and the stack carries local file paths. This also fixes a case where
  `JSON.stringify(error)` threw: an abort reason holding a cycle. A consumer
  subclass inherits `toJSON()`, so a field it adds needs an override to reach
  `JSON.stringify`.
- `util.inspect.custom` on every error class. `console.log(error)`,
  `console.error(error)`, `util.inspect`, and a test runner's failure output
  never call `toJSON()`, so the record's redaction did not reach them. They
  printed the live `Headers` with the session cookie and every custom header
  value, and the full request URL. They also printed the platform cause chain,
  with undici's local and remote addresses and ports, because Node
  special-cases `cause` on an error regardless of enumerability.
  `AbortedError.reason` carries the identical defense as `cause`. It stayed
  hidden only because Node has no special case for it: the same defense, two
  members, one leaked. These calls now print the stack followed by the
  `toJSON()` record, so the two channels cannot drift. A consumer subclass that
  overrides `toJSON()` fixes both with one override. `cause` and `reason` are
  replaced by a marker that names
  the property that holds them. The hook is registered under
  `Symbol.for("nodejs.util.inspect.custom")`, which is what `util.inspect.custom`
  is. It needs no Node import, so it works on Node, Deno, and Bun.
- `"./package.json"` in the `exports` map. Tooling that reads a dependency's
  manifest through the resolver received `ERR_PACKAGE_PATH_NOT_EXPORTED`.
- `errors/package.json`, a redirect stub for resolvers that ignore `exports`
  (Jest 27 and older, webpack 4, Metro before 0.72). `typesVersions` pointed
  those consumers at `./errors` types that type-checked and then failed to load,
  because the tarball shipped no runtime file they could reach. `typesVersions`
  is removed, since the stub supersedes it.

### Changed

- The declared header names are request-side only. Sixteen of the thirty-one
  were wrong: thirteen are response headers a client never sends (`Set-Cookie`,
  `ETag`, `Last-Modified`, `Location`, `WWW-Authenticate`,
  `Content-Security-Policy`, the four `Access-Control-Allow-*`,
  `X-Frame-Options`, `X-Content-Type-Options`, `Strict-Transport-Security`), and
  three belong to the platform: `Content-Length` makes `fetch` throw when it
  disagrees with the body, `Host` is silently overwritten, and `Connection` is
  hop-by-hop. `If-Match` is added because it is the write validator. RFC 9110
  section 13.1.1 defines it as the precondition on a state-changing request, so
  it prevents a lost update, and no declared name covered that. It does not
  replace `ETag`: `ETag` is a response header that a client never sends. The two
  read validators, `If-None-Match` and `If-Modified-Since`, were already
  declared and are unchanged. `Cache-Control` no longer suggests `public`,
  `private`, or `must-revalidate`, which are response directives. Removing a
  name is not breaking: it still type-checks as a custom name with a string
  value, verified under both the DOM and the no-DOM profile.
- `error.message` and the `toJSON()` record hold a redacted URL: the origin and
  the path, with the userinfo, the query string, and the fragment removed. A
  query string routinely carries a credential, and `message` is the string every
  log line, crash dump, and test failure carries. A deny list of sensitive query
  keys fails for the reason it failed for header names. The dangerous key is the
  one this library has never heard of. The whole query is dropped instead.
  `error.url` still holds the full href, exactly as `error.headers` still holds
  every header value. A URL with no userinfo, query, or fragment produces a
  byte-identical message. A secret in a path segment still reaches the message
  and the record. Dropping the path would reduce `url` to the origin and remove
  the only thing the field is for. This is not a break. The semver
  contract already states that `error.message` text can change in any release,
  and `toJSON()` ships for the first time in this release.
- `TypedFetchOptions` replaces the native `method` and `headers` slots instead
  of intersecting with them. An intersection with `RequestInit["method"]`
  (`string`) collapses the union, so `method: "…"` offered zero completions
  while the README promised them. It now offers seven. Header-name completions
  on a Node consumer without `lib.dom` went from 116 to 42. That drops the 74
  names the platform contributed: every response-only name, plus
  `Content-Length`, `Host`, and `Connection`. The list is now the same 42 in
  both lib profiles. This is compile-time only, and both slots accept strictly
  more than before, so no consumer type stops compiling.
- `BaseHttpError.cancel()` resolves, rather than rejecting, when the body stream
  itself failed — a truncated response or a connection reset mid-body. The
  caller asked to discard these bytes, and a stream that errored already dropped
  its source, so there is nothing left to release and nothing actionable to
  report. The `TypeError` for the case that IS actionable — an external reader
  holds the stream and has read nothing through it — still rejects. The `1.1.0`
  notes described the rejection condition as exhaustive; it was not.

### Fixed

- `BaseHttpError.cancel()` no longer ends the process when the body stream is in
  an errored state. `cancel` is an async function, so the promise it returns and
  the promise a repeated call derives from it are both distinct objects from the
  one the `.catch()` was attached to; a single dropped cleanup call left a
  rejection unhandled, and Node's default `--unhandled-rejections=throw` turns
  that into an exit-1 crash. The failure is now swallowed at the source.
- `typedFetch` releases the response body when reading `status` off an injected
  `fetch` implementation throws. The guard added in `1.1.0` started below the
  status read, so a hostile getter stranded a live body with no owner — the
  caller receives `response: null` and never gets a handle to it. Related, on
  the same lines: `status` is now read once into a local, so a getter reporting
  a different value on a second read can no longer select an error class that
  answers a status the branch was never taken on; and the release itself is
  wrapped, so a throwing `body` getter can no longer replace the cause being
  reported.
- `NetworkError` no longer copies a password into `message`. undici rejects a
  URL that carries credentials with a `TypeError` whose message contains the URL
  verbatim. That message was copied into `message`, and from there into the
  record, so
  `{"name":"NetworkError","message":"Request cannot be constructed from a URL that includes credentials: http://alice:hunter2@host/x","url":"http://alice:hunter2@host/x"}`
  was a normal log line. The URL the error was told about is now removed from
  the message before the error is built. The replacement is exact-string, so it
  is best effort. The userinfo is stripped separately wherever it survives.
- `fetch?: typeof fetch | undefined`. The dependency-injection pattern the
  README recommends failed with TS2379 under `exactOptionalPropertyTypes`. Under
  that flag an optional property whose type does not name `undefined` rejects a
  `typeof fetch | undefined` value. The other optional members still do not name
  `undefined`. `{ method: maybeString }` and `{ body: maybeBody }` continue to
  fail, and the second is native `RequestInit` behavior.
- The published JSDoc for `cancel()` listed the conditions under which it
  resolves and omitted the errored body stream. `cancel()` was changed to
  resolve rather than crash the process on a truncated response or a connection
  reset mid-body. The README and the internal documentation were updated, and
  this block was not. It is what a consumer sees on hover, because it ships in
  `dist/index.d.ts`.
- The `README.md` examples used browser-relative URLs such as `/api/users`,
  which reject on Node with `TypeError: Failed to parse URL`. Installation names
  Node 20 as the target. The first example therefore could not run on the
  runtime the document recommends. Every example URL is now absolute.

### Documentation

- The retry guidance for `NetworkError` no longer states a test that does not
  work. It said permanent input errors "have a `TypeError` in `cause`" and told
  the reader to check `cause` before retrying. Measured across six failure
  modes, `error.cause instanceof TypeError` answers `true` in every one,
  including a DNS failure and a refused connection — so the documented rule told
  callers never to retry the two most retryable failures there are. The cause is
  the rejection `fetch` produced, and that is always a `TypeError`. No portable
  test separates the two kinds: on Deno every failure in that section arrives as
  a bare `TypeError` with no `cause` and no error code, so the section now says
  to put the retry policy in a layer that knows the request.
- A documentation pass verified every prose claim in `README.md` against the
  code and corrected four false statements. "A repeated header appears once per
  arrival" held only for `set-cookie`. `Headers` combines duplicates of every
  other name, so two `warning` headers produce one record entry. "This is the
  only condition that makes `cancel()` reject" missed a second condition, an
  instance that the constructor never initialized. The `If-Match` rationale was
  inverted; it is the write validator, and the two read validators were kept.
  The examples used browser-relative URLs.
- `README.md` documents that a success body carries the same obligation as an
  error body. `typedFetch` hands the caller the `Response` and never reads it,
  so a result that the caller discards holds its connection. Measured on Node
  20.15.0 with ten sequential requests: an unread 1 MB body pins ten
  connections on a 200. It pins the same ten on a 500. The obligation is
  invisible in development, because a small body is fully buffered and releases
  its connection on its own. The threshold is an internal buffer size.
- `README.md` documents the constructors of `NetworkError`, `AbortedError`, and
  `TimeoutError`. Their properties were documented and their signatures were
  not, so a consumer who fabricated one in a test had to read
  `dist/errors/index.d.ts`.
- `README.md` shows how a wrapper merges headers. The previous wrapper example
  passed `options` straight through. The naive `{ ...options?.headers }` spread
  type-checks, and it silently drops every entry of a `Headers` instance.
  `new Headers(options?.headers)` compiles with no cast in both lib profiles.

### Internal

- Three wire-level tests prove that a header passed through the `headers` option
  reaches the server, for the record, `Headers`, and pair-list forms. Nothing
  proved it before: removing the forwarding on the path every consumer takes
  left the whole suite green. Two further tests were strengthened — the 407 case
  now drives `statusCodeErrorMap` instead of asserting its own literal, and
  `forwards request options to fetch` echoes the method, a header, and the body
  rather than asserting a 200.
- The release gates (`validate-release`, `verify-pack`, `check-docs`,
  `check-consumer`) compared `resolve(process.argv[1])` against
  `fileURLToPath(import.meta.url)` to decide whether they were the entry point.
  Node realpaths the module URL but leaves `argv[1]` as typed, so any symlink in
  the invocation path made every gate print nothing and exit 0. Since
  `validate-release` is the only validation gating the publish job, a skipped run
  sent an unvalidated tag to `npm publish`. The guard now resolves both sides —
  resolving only `argv[1]` still fails under `--preserve-symlinks-main`, which
  keeps `import.meta.url` on the symlink — and lives in one place,
  `scripts/lib/is-main-module.mjs`, instead of four copies that had already
  drifted.
- The publish step passes the dist-tag through the environment and refuses an
  empty value, so a gate that did not run stops the publish by name instead of
  handing npm a bare `--tag`.
- `scripts/smoke/node-min.mjs` compares all three version components. Both its
  warning guard and its refusal guard compared major and minor only, so with a
  non-zero minor floor a runtime below the floor passed both and reported `OK` —
  in the one script whose entire purpose is proving the declared floor ran.
- `scripts/validate-release.spec.mjs` pins the three places that must agree
  about the supported floor: `engines.node`, the CI test matrix, and the smoke
  script's `MINIMUM`. Dropping `20` from the matrix previously broke no test.
- The two `AbortSignal.any` tests are gated on the method being present. It does
  not exist on Node 20.0 to 20.2, which `engines.node` claims to support. Nothing
  in `src/` calls it, so the published artifact genuinely runs on the floor and
  the declared range stays honest; only the suite needed the gate.
- `disclosure-channels.spec.ts` holds one test per channel an error's data can
  reach: `JSON.stringify`, `util.inspect` and `console.*`, the fatal-exception
  printer, `toString`, `structuredClone`, a test runner's assertion output, and
  `Object.keys` with the spread. Each plants a sentinel and asserts that it does
  not appear. Three channels cannot be closed, and each is asserted as a
  residual. `cause` survives `structuredClone` and the fatal-exception printer.
  vitest's assertion-message stringifier reads non-enumerable own property
  names. A secret in a URL path segment survives redaction by design.
- `scripts/check-consumer.mjs` gains a sixth typecheck pass, `node-eopt`: no
  DOM, `@types/node`, and `exactOptionalPropertyTypes: true`, compiling
  `typedFetch(url, { fetch: maybeFetch })` against the published declarations.
  It is the only executable gate for that contract, because this repository does
  not compile its own sources with the flag. The suite now runs 35 consumer
  assertions.

## [1.1.0] - 2026-07-24

This release is a **minor**, not the patch it was originally numbered. Nothing
is removed or narrowed and no error class changes, but two public additions —
`BaseHttpError.cancel()` and the optional `clone(recreate?)` callback — grow the
API surface, and the repo's semver policy is silent on additions, so
conventional SemVer governs. Everything else here is a fix.

### Added

- `BaseHttpError.cancel(reason?)` releases an error response body without
  buffering it. An unread error body keeps its stream open and pins the
  underlying connection, which defeats keep-alive for code that logs
  `error.message` and drops the error. It resolves when the response carries no
  body, when the body was already consumed — including by a consumer holding
  the `Response` — and when this library already started reading it; a repeated
  call settles with the first one; and it rejects with a `TypeError` when an
  EXTERNAL reader holds the stream and has read nothing through it. Canceling
  does not download the remaining bytes, so the runtime may close the connection
  instead of returning it to the keep-alive pool — read the body with `text()`
  when connection reuse matters more than the transfer.
- `BaseHttpError.clone()` accepts an optional recreation callback, so
  consumer-defined subclasses can preserve custom constructor and private state.
  Calling `clone()` without a callback keeps the response-only behavior from
  `1.0.0`. A callback that returns the same error instead of a new one is
  rejected with a `TypeError`: one instance cannot own both branches of a teed
  body, so releasing it could never release the source.
- A minimum-runtime smoke (`scripts/smoke/node-min.mjs`, wired as the
  `node-min-smoke` CI job) executes the built artifact on Node **20.0.0**, the
  declared `engines` floor. The existing matrix uses `node-version: 20`, which
  resolves to the latest 20.x, so the floor itself was never run. The toolchain
  is not installed there: CI builds on Node 22 and switches to 20.0.0 for the
  smoke alone. Under `CI` the script FAILS rather than warns when the runtime is
  not the floor, so a misconfigured setup-node step cannot report a green run
  that proved nothing. Locally it warns, so it stays runnable without a 20.0.0
  binary on hand.

### Fixed

- Abort and timeout classification now also covers Fetch implementations that
  reject with their **own** abort error instead of `signal.reason`. Only an
  identity match (`err === signal.reason`) took the abort path before, so
  `whatwg-fetch` (jsdom), `node-fetch@3`, and other injected implementations
  produced a `NetworkError` for a canceled request — and a retry loop keyed on
  `NetworkError` would reissue calls the caller had explicitly canceled. A
  governing signal that reports `aborted` plus an error-shaped rejection named
  `"AbortError"` or `"TimeoutError"` is now classified as the cancellation, and
  the signal's `reason` still decides `AbortedError` vs `TimeoutError`. An
  aborted signal remains necessary but not sufficient: an unrelated rejection
  (a `TypeError` from `Request` construction, a `SecurityError`, a bare object
  carrying a `name`) still returns `NetworkError`.
- `typedFetch` no longer rejects when an injected Fetch implementation resolves
  a value that is not a `Response`, or a `Response` whose `status`/`url` getter
  throws. Response inspection now runs inside the never-rejecting envelope and
  returns a `NetworkError` carrying the original error in `cause`. Valid
  responses keep their existing classification.
- The body readers `json()`, `text()`, `blob()`, and `arrayBuffer()` now detect
  a **locked** stream, not only a consumed one, and throw the library's clear
  `TypeError` instead of the platform's opaque "Body is unusable". `clone()`
  already had this check. Native parse failures for an empty or invalid JSON
  body are unchanged.
- `cancel()` no longer decides "this body is already gone" from
  `response.bodyUsed`, which is runtime-specific: **Bun** reports it as soon as
  `getReader()` locks the stream, while Node, Deno, and workerd keep it `false`
  until the stream is disturbed. On Bun an externally locked body therefore
  reported success without releasing anything, and then permanently blocked the
  readers. The library now tracks its own reads and decides in a fixed order —
  repeated cancel, library read, external lock, consumed body, releasable body.
- `cancel()` after `clone()` is now correct and idempotent. Cloning tees the
  body stream, and the platform releases the source only once every branch is
  read or canceled, so the promise stays pending until the sibling is released.
  That native semantics is kept deliberately (resolving early would report a
  release that did not happen), and it is now documented with the
  `Promise.all([error.cancel(), copy.cancel()])` pattern. A repeated `cancel()`
  settles **with** the in-flight one instead of reporting success while the
  first is still waiting, and a late rejection can no longer surface as an
  unhandled rejection. Canceling one branch never cancels its sibling.
- `BaseHttpError` keeps its per-instance state in a module-scoped `WeakMap`
  instead of ECMAScript `#private` fields. TypeScript emits a nominal
  `#private;` marker into each declaration file, so `dist/index.d.ts` and
  `dist/index.d.mts` declared two incompatible `NotFoundError` types: a
  CJS-typed wrapper package could not hand an error to an ESM app without a cast
  (`TS2741: Property '#private' is missing`). The response stays out of
  `JSON.stringify`, spreads, and `Object.keys` exactly as before. Tradeoff: the
  error classes are now purely structural, so a same-shaped object is
  assignable — the brand guards (`isHttpError`), not assignability, remain the
  authority on provenance.
- `TypedHeaders` no longer names the global `HeadersInit`, which is declared
  only in `lib.dom.d.ts`. A Node consumer without DOM failed to compile the
  published declarations (`TS2304: Cannot find name 'HeadersInit'`) or, with
  `skipLibCheck` on, silently degraded `TypedHeaders` to `any` and lost the
  whole `StrictHeaders` layer. The headers arm is now derived from the ambient
  `fetch` signature, which resolves identically with and without DOM.
- Error detection is realm-safe. `instanceof Error` is bound to the current
  realm, so an error from a `node:vm` context, an iframe, or a worker failed it:
  a cross-realm rejection lost its message (`NetworkError: Network error`) and a
  cross-realm implementation `AbortError` was misclassified as a
  `NetworkError` even with the governing signal aborted. Detection now falls
  back to the platform tag and, for a subclass that overrides
  `Symbol.toStringTag`, to a tight structural test. A bare object literal named
  `"AbortError"` is still never an error, and an abort name with no aborted
  signal is still a `NetworkError`.
- A `clone()` that FAILS no longer strands the body. `clone()` tees the stream
  before it can know the copy will exist, so a throwing recreate callback — or a
  subclass constructor that rejects a response-only call — left a branch with no
  owner. Since the platform frees the source only once every branch is released,
  `cancel()` on the surviving error then never settled, and the error was
  unusable in both directions. Every failure path now releases the branch it
  drops.
- `cancel()` no longer rejects on a body someone else already read. The
  external-lock check ran before the consumed-body check, and a completed
  external `text()` leaves the stream both `locked` and `bodyUsed` on Node 20/24,
  Bun 1.3, and Deno — so the common case, a consumer reading the `Response` its
  own injected `fetch` returned, rejected instead of resolving as documented.
  The lock check now also requires `bodyUsed` to be false. Documented
  divergence: on a runtime that reports `bodyUsed` for a bare `getReader()`
  (Bun today), an unread lock is indistinguishable from a consumed body and
  `cancel()` resolves.
- `typedFetch` now preserves inherited `RequestInit` properties, WebIDL
  getters, proxied/cross-realm `Request` objects, and abort signals while
  removing its `fetch` override. Errors thrown while reading or
  normalizing request options are returned as `NetworkError` instead of
  escaping the never-rejecting request envelope.
- Release validation now rejects impossible calendar dates such as
  `2026-02-30`, not only malformed date strings.

### Release engineering

- `verify-pack` is now an ALLOW-list. Its denylist was structurally unable to do
  its job: `files: ["dist"]` means only `dist/` plus metadata can ever ship, and
  the denylist covered exactly the paths `files` already excluded while covering
  nothing inside `dist/`. A `dist/.env`, a sourcemap carrying `sourcesContent`
  (which re-ships every source file), and a `dist/src/index.ts` all packed with
  a clean "no leaks" report. Every packed path must now match the expected
  entry points, build chunks, or metadata, and a `MAX_FILE_COUNT` sits beside
  the existing minimum. `scripts/verify-pack.spec.mjs` proves each leak fails.
- `check-docs` now globs every file under `src/` for public JSDoc instead of
  reading a hand-maintained list of one. The list omitted
  `src/errors/base-http-error.ts`, so the published `clone()` example shipped
  with four TypeScript errors — undefined `CustomHttpError`, undefined `error`,
  and an implicit `any`. That example is now self-contained and compiles.
- `check-consumer` typechecks five configurations instead of two: `bundler`,
  `nodenext`, Node **without** DOM, Node **with** DOM, and a CJS→ESM
  assignability pass. Both new passes fail against the previous build and pass
  against this one.
- Added an installed-tarball Deno typecheck that resolves the package by its
  bare npm name and verifies the published `.d.mts` declarations.
- Tag releases now wait for the reusable full CI workflow (Node 20/22/24,
  security, Bun, and Deno) before the publish job can receive OIDC permission.
  The publish job still repeats the release gates against the tagged commit.

### Documentation

- Unified the SemVer contract: registering a dedicated HTTP error class is a
  major change because it replaces `UnknownHttpError` for an existing runtime
  path and widens the returned union.
- Refreshed the v1 release state and clarified that aborts and timeouts are not
  `NetworkError` cases.
- Documented `cancel()`, the widened abort classification for custom Fetch
  implementations, and the hardened response inspection. Added an
  `AbortSignal.any()` recipe that combines a manual controller with a deadline.
- Corrected the `cancel()` documentation: it no longer claims resources are
  freed "immediately". The README now states what `await cancel()` waits for,
  that a cloned body requires every branch to be released, and the explicit
  trade-off — canceling skips the remaining bytes but can cost connection
  reuse, while reading them keeps the connection but pays the transfer.
- Noted that the `AbortSignal.any()` deadline recipe requires Node 20.3 or
  later, while the package floor stays at Node 20, and added a single-controller
  alternative for Node 20.0–20.2. The `engines` floor is unchanged.

## [1.0.0] - 2026-07-17

### Breaking

- **The type guards (`isHttpError`, `isKnownHttpError`, `isNetworkError`,
  `isAbortError`, `isTimeoutError`) now identify errors by a cross-realm brand
  (`Symbol.for`) instead of `instanceof`.** This fixes them across multiple
  copies of the package's classes in one process — the dual-package hazard
  (`require()` ↔ `import()`) and cross-entry-point duplication (`.` vs
  `./errors`), where a raw `instanceof` returned `false` for a value that
  genuinely was one. The guards' _behavior_ is unchanged for the common
  single-copy case; the break is that a value which forges the brand symbol now
  passes a guard (a guard answers "did this library make this?", not "is this
  trusted?"), and that guards no longer depend on prototype identity. If you
  relied on the guards returning `false` for a same-shape object that lacked
  the brand, that still holds.
- **Removed the second `ErrorType` type parameter from `typedFetch<T, E>`.**
  It was enforced by an unchecked cast at the error-construction site: asking
  for `typedFetch<User, NotFoundError>(...)` and receiving a 403 still gave
  you a `ForbiddenError` at runtime, just typed as `NotFoundError` — the type
  system was lying. `typedFetch` now has a single type parameter (the
  response body type); `error` is always the full `TypedFetchError` union.
  See [Migrating from 0.x](#migrating-from-0x) below.
- **Aborts and timeouts now return `AbortedError` / `TimeoutError` instead of
  `NetworkError`.** Both are new classes that extend `Error` directly (not
  `NetworkError`), so **`isNetworkError()` no longer returns `true` for
  canceled or timed-out requests.** Cancellation and timeouts are not
  network failures, and collapsing all three into `NetworkError` forced an
  untyped `error.cause` cast to tell them apart. See
  [Migrating from 0.x](#migrating-from-0x) below.
- **Abort/timeout detection now keys on the request's `AbortSignal`
  (`signal.aborted`), not on the rejected error's `.name`.** The previous
  implementation matched `err.name === "AbortError"` / `"TimeoutError"`, which
  (a) missed the mainstream `controller.abort(reason)` pattern — passing a
  reason makes `fetch` reject with _that_ value, whose `.name` is usually not
  `"AbortError"`, so it was misclassified as a `NetworkError` — and (b) could
  false-positive on any unrelated rejection that merely happened to be named
  `"AbortError"`. The signal is now the sole authority: a request is treated
  as aborted only when its own signal reports `aborted`.
- **`statusCodeErrorMap` and `httpErrors` are no longer public exports.** They
  were internal registries (the status-code → error-class map and the array of
  all 40 error classes) with no demonstrated consumer use case, and every
  public export is a semver liability. They remain available internally but are
  no longer part of the published API surface.
- **The `HttpErrors` type is no longer a public export.** It was the union of
  error class _constructors_ derived from the (now-private) `httpErrors` array —
  the same internal registry privatized above, so the same reasoning applies: no
  demonstrated consumer use case, and every public export is a semver liability.
  For the type of an error _instance_, use `ClientErrors | ServerErrors`. It
  remains available internally but is no longer part of the published API surface.
- **`TypedHeaders` and `StrictHeaders` are no longer public exports.** They were
  autocomplete-only types — they suggest common header names but validate no
  values — and every named export is a semver liability. The **behavior is
  unchanged**: they still shape `TypedFetchOptions["headers"]`, so writing
  `typedFetch(url, { headers: { "Content-Type": "..." } })` still gives header-name
  IntelliSense (the suggestions are structural and need no import). Only the
  named exports are gone; if you imported either type by name, inline the shape
  or use `TypedFetchOptions["headers"]` instead.
- **The literal `statusText` values for 413 and 422 now follow RFC 9110:**
  `"Payload Too Large"` → `"Content Too Large"`, and
  `"Unprocessable Entity"` → `"Unprocessable Content"`. The historical class
  names remain exported for source compatibility.

### Added

- A built-artifact invariant now proves that both `.` and `./errors` export
  every dedicated class in the internal roster; the existing surface snapshots
  alone could not detect a future class registered internally but omitted from
  the barrels.
- `dist/`-level cross-copy / cross-format regression tests that exercise the
  _built_ artifacts (both entry points, both ESM and CJS), so a regression to
  `instanceof`-based guards is caught — the previous suite only imported
  `src/`, which masked the bug.
- `isKnownHttpError(error): error is ClientErrors | ServerErrors` — a type
  guard for a _known_, dedicated HTTP error class (excludes
  `UnknownHttpError`). Narrowing on `error.status` after this guard is
  exhaustive over the mapped status codes, which makes `switch (error.status)`
  actually useful (previously `UnknownHttpError.status: number` absorbed
  every case).
- `isAbortError(error): error is AbortedError` and
  `isTimeoutError(error): error is TimeoutError` guards, alongside the new
  `AbortedError` and `TimeoutError` classes.
- `AbortedError.reason` (`unknown`) — the `AbortSignal`'s cancellation reason,
  i.e. whatever the caller passed to `controller.abort(reason)`. Typed
  `unknown` so the consumer narrows it. When `abort()` is called with no
  argument, the platform supplies a `DOMException` named `"AbortError"`.
- `error.url` (`string`) on **every** error class — the URL of the failed
  request, so concurrent requests produce distinguishable errors in logs.
  It was already on HTTP errors (from `response.url`); it is now also on
  `NetworkError`, `AbortedError`, and `TimeoutError` — the pre-response
  failures that dominate flaky-network logs, where a bare
  `NetworkError: fetch failed` previously gave nothing to correlate. For a
  `Request` input the resolved `request.url` is used; for a `URL` its `href`;
  for a `string` the string itself. Because all six families now carry
  `readonly url: string`, code written against the full `TypedFetchError`
  union can read `error.url` unconditionally, with no narrowing.
- `options.fetch` — override the underlying `fetch` implementation
  (testing, DI, custom agents, polyfills) without patching `globalThis`.

### Changed

- `error.message` on HTTP errors now includes the request URL when
  available, e.g. `"HTTP 404 Not Found (https://api.example.com/users/123)"`.
  **Message text is not part of the semver contract** — assert on
  `.status` / `.name`, not `.message` (see `RELEASING.md`).
- Every error class's `name` (e.g. `NotFoundError`, `NetworkError`) is now a
  hardcoded string literal instead of being derived from
  `this.constructor.name`, so it survives consumer minification
  (`.name` used to collapse to a mangled identifier like `"a"` under
  production minifiers).

### Security

- Updated the development toolchain and pinned patched transitive `vite` and
  `esbuild` versions. Both the full dependency audit and the production-only
  audit now report zero known vulnerabilities; TypeScript remains on 6.x until
  tsup's declaration build supports TypeScript 7.

### Release engineering

- Package identity and release tags must now exactly match the reviewed
  metadata, point at the current `origin/main` tip, have a dated changelog
  entry, and leave `[Unreleased]` empty before publication can start.
- The tag workflow now reruns formatting, documentation, tarball-consumer, and
  dependency-audit gates; pins Node and npm; disables release dependency
  caching; verifies all eight CJS/ESM declaration/runtime entries; and
  serializes publish jobs.
- Documented the required trusted-publisher setup for token-free OIDC releases
  and enabled provenance in both package metadata and the publish command.

### Fixed

- Rejections from an injected `options.fetch` can no longer escape the
  errors-as-values envelope when their `message`/`name` properties throw.
  Abort/timeout inspection now uses the same defensive access, preserving the
  hostile value on `cause`/`reason` while returning `NetworkError` or
  `AbortedError` safely.
- **`isKnownHttpError` no longer misclassifies consumer-defined
  `BaseHttpError` subclasses as one of the library's dedicated status
  classes.** Dedicated errors now carry a separate cross-copy brand, keeping
  the guard's `ClientErrors | ServerErrors` type predicate sound while
  preserving ESM/CJS and cross-entry behavior. The guard also verifies the
  receiving version's status map, so an older copy rejects dedicated statuses
  introduced by a newer package version.
- **`BaseHttpError` no longer leaks its internal `Response` as an own enumerable
  property.** It was a constructor parameter property, so `JSON.stringify(err)`,
  `{...err}`, and `Object.keys(err)` exposed a live `Response` handle. It is now
  a native private field.
- **`NetworkError` / `AbortedError` / `TimeoutError`: `"cause" in err` (and
  `"reason" in err`) are honest again.** Under ES2022 class-field semantics the
  field declarations defined an own `cause: undefined` on every instance, so
  `"cause" in err` was always `true`. The property now exists only when a cause
  is actually supplied.
- **Error body readers (`json()`/`text()`/`blob()`/`arrayBuffer()`) throw a
  clear `TypeError` on a second read**, matching `clone()`, instead of the
  platform's opaque `Body is unusable`. (An empty/non-JSON body still rejects
  with `SyntaxError` — use `text()` when unsure.)
- **`clone()` also guards a locked (reader-held) body**, not only a consumed one.
- **Abort/timeout classification tightened for polyfilled signals**: a
  reason-less aborted signal only takes the abort path when the rejection is a
  DOMException named `AbortError` or `TimeoutError` (not any DOMException), and a
  polyfilled timeout signal now yields `TimeoutError` rather than `AbortedError`.
- **Timeout classification now requires a `DOMException`, not a forgeable
  `reason.name`.** Detection previously matched a `reason` that was any `Error`
  whose `.name` was `"TimeoutError"`, so a caller doing
  `controller.abort(Object.assign(new Error("canceled"), { name: "TimeoutError" }))`
  was misclassified as a `TimeoutError` — and, worse, the caller's meaningful
  reason was demoted to `cause` and lost from `error.reason`. This is the
  mirror of the `err.name === "AbortError"` bug already fixed above, on the
  `reason.name` axis. Classification now requires the exact shape
  `AbortSignal.timeout()` produces — a `DOMException` named `"TimeoutError"`
  (guarded by `typeof DOMException !== "undefined"` for polyfilled runtimes) —
  which a plain `Error` cannot forge. The `name` check stays load-bearing (a
  bare `controller.abort()` also produces a `DOMException`, named
  `"AbortError"`). A caller who hand-builds a `DOMException` named
  `"TimeoutError"` is still treated as a timeout — that shape is
  indistinguishable from a real one, by design.
- **`instanceof` across the package's own entry points.** The build previously
  shipped `splitting: false`, so the `.` and `./errors` entry points each
  bundled their _own_ copy of every error class. A `NotFoundError` created by
  `typedFetch` (from `.`) was therefore not `instanceof` the `NotFoundError`
  imported from `./errors` — the exact pattern the README teaches. Enabling
  code-splitting makes both entry points share one copy of each class per
  module format, so raw `instanceof` now works across entry points within a
  single ESM (or single CJS) graph. Across the ESM/CJS boundary, use the
  brand-based type guards — no bundler can merge those two module graphs.
- The guards now work regardless of which copy or module format created the
  error (see Breaking above). Bundle size drops ~9% as a side effect of
  splitting removing the duplicated classes.
- **An `AbortSignal` carried by a `Request` in the url slot is now honored.**
  `typedFetch(new Request(url, { signal }))` — the canonical fetch pattern used
  by service workers, middleware, and request factories — put the signal on the
  first argument, where it is a prototype getter (`url.signal`), not on `init`.
  The catch block keyed abort/timeout classification solely off `init.signal`,
  so every cancellation on this path misclassified as a `NetworkError` instead
  of `AbortedError`/`TimeoutError`. The governing signal is now resolved from
  either slot. Precedence matches native `fetch(request, init)`: an
  options-slot `signal` overrides the `Request`'s own signal entirely.
- **A `Request` object passed in the `options` slot is no longer corrupted.**
  A `Request` is a host exotic object: its `method`, `headers`, `body`, and
  `signal` are prototype getters, not own enumerable properties. The
  `options.fetch` change (b00380e) introduced an object rest spread
  (`const { fetch, ...init } = options`) that copied none of them, silently
  downgrading `typedFetch(url, new Request(url, { method: "POST", ... }))` to a
  bodyless, header-less `GET` and dropping the abort signal (so a pre-aborted
  or timed-out `Request` produced no error at all). A `Request` is now passed
  through to `fetch()` untouched; the spread only applies on the plain-object
  options path.
- The README no longer documents an "Error Response Bodies" pattern that
  reads the body with `error.json()` and then calls `error.clone()` — that
  order throws `TypeError: Response.clone: Body has already been consumed`.
  The example now clones before the first read.
- `statusText` is now documented (README and JSDoc) as the library's canonical
  protocol label for the status code (normally the current IANA phrase), not
  necessarily what the server sent on the wire — the two could already disagree
  (`error.message` uses the real `response.statusText`; `error.statusText` is a
  hardcoded literal per class), and the docs previously implied they were the
  same value. The historical 418/510 registry exceptions are explicit.

### Documentation

- Qualified the errors-as-values promise across package metadata, README, and
  public JSDoc: request failures resolve as `error`, while native body readers
  can still reject for malformed/empty data or a consumed body. An explicit
  204 regression test locks that boundary down.
- Corrected the status-0 body guidance: filtered responses remain on the
  success branch, but `Response.error().text()` resolves to an empty string
  while `.json()` rejects for that empty body.
- Public JSDoc examples are now compiled by `pnpm check-docs`, alongside the
  Markdown and agent-skill examples.
- Documented the complete 1.x semantic-versioning contract and corrected the
  4xx/5xx error-class counts.
- Clarified that `NetworkError` also covers permanent, non-retryable
  request-construction `TypeError`s (invalid URL, forbidden method) — warn
  against blind retry loops.
- Clarified that status-0 / `type: "error"` / opaque responses return on the
  success branch; consumers must check `response.ok` / `response.type`.

### Migrating from 0.x

Breaking changes to handle:

**1. The second `ErrorType` type parameter is gone.**

```typescript
// Before (0.x)
const { response, error } = await typedFetch<User, NotFoundError>("/api/users/123");
if (error) {
  // error was typed as NotFoundError | ServerErrors | UnknownHttpError | NetworkError,
  // but a 403 response would still construct a ForbiddenError at runtime —
  // the second type argument was never checked against what actually came back.
}

// After
import { isKnownHttpError } from "@pbpeterson/typed-fetch";

const { response, error } = await typedFetch<User>("/api/users/123");
if (error && isKnownHttpError(error)) {
  switch (error.status) {
    case 404:
      console.log("User not found"); // error: NotFoundError
      break;
    case 403:
      console.log("Forbidden"); // error: ForbiddenError
      break;
    default:
      // Keep a default for forward compatibility and mixed package versions.
      console.log(`HTTP ${error.status}`);
  }
}
```

Prefer `instanceof` if you only care about one class:

```typescript
import { NotFoundError } from "@pbpeterson/typed-fetch";

if (error instanceof NotFoundError) {
  console.log("User not found");
}
```

**2. Aborts and timeouts are no longer `NetworkError`.**

```typescript
// Before (0.x)
const { response, error } = await typedFetch<User[]>("/api/users", {
  signal: AbortSignal.timeout(5000),
});
if (isNetworkError(error)) {
  if ((error.cause as Error)?.name === "AbortError") {
    console.log("Request was canceled");
  } else {
    console.log("Network error:", error.message);
  }
}

// After
import { isNetworkError, isAbortError, isTimeoutError } from "@pbpeterson/typed-fetch";

const { response, error } = await typedFetch<User[]>("/api/users", {
  signal: AbortSignal.timeout(5000),
});
if (isAbortError(error)) {
  console.log("Request was canceled");
} else if (isTimeoutError(error)) {
  console.log("Request timed out");
} else if (isNetworkError(error)) {
  console.log("Network error:", error.message);
}
```

If you only checked `error instanceof NetworkError` (or `isNetworkError`) to
catch _any_ pre-response failure, add the two new branches above it —
`isNetworkError` on its own will silently stop matching aborted and
timed-out requests.

**3. Internal registries and autocomplete-only aliases are no longer named exports.**

The public surface now contains the runtime functions, error classes, and
consumer-facing types. Replace imports of the removed implementation details:

```typescript
// Before (0.x)
import {
  statusCodeErrorMap,
  httpErrors,
  type HttpErrors,
  type TypedHeaders,
  type StrictHeaders,
} from "@pbpeterson/typed-fetch";

// After (1.x)
import {
  isKnownHttpError,
  type ClientErrors,
  type ServerErrors,
  type TypedFetchOptions,
} from "@pbpeterson/typed-fetch";

type KnownHttpError = ClientErrors | ServerErrors;
type RequestHeaders = NonNullable<TypedFetchOptions["headers"]>;
```

Use `isKnownHttpError()` plus `switch (error.status)` (or an individual error
class) instead of consulting `statusCodeErrorMap` / `httpErrors`. Use
`ClientErrors | ServerErrors` instead of `HttpErrors`, and derive the accepted
header input from `TypedFetchOptions["headers"]` instead of importing
`TypedHeaders` or `StrictHeaders`.

## 0.8.0 (2026-06-09)

### Breaking

- Responses with unmapped status codes >= 400 (e.g. 420, 599) now return an
  `UnknownHttpError` instead of being passed through as a successful response.
- Requires Node.js >= 20 (Node 18 is end-of-life).
- `HttpMethods` no longer includes `CONNECT` and `TRACE` — the Fetch spec
  forbids them and `fetch` throws a `TypeError` if they are used.

### Added

- `UnknownHttpError` — covers any status >= 400 without a dedicated class.
  Its `status`/`statusText` reflect what the server actually sent.
- `NetworkError.cause` — the original error thrown by `fetch` (e.g. the
  `TypeError` with an `ECONNREFUSED` cause chain, or an `AbortError`) is
  preserved instead of discarded.
- HTTP errors now have a useful `message` (e.g. `"HTTP 404 Not Found"`);
  previously it was empty.
- `TypedResponse.clone()` keeps the typed `json()` method.
- The main entry now exports the `TypedResponse`, `TypedFetchReturnType`,
  `TypedFetchOptions`, `TypedHeaders`, `StrictHeaders`, and `HttpMethods`
  types for building typed wrappers around `typedFetch`.
- `method` option accepts any string (fetch parity) while keeping
  IntelliSense for standard verbs.

### Changed

- `statusCodeErrorMap` is now typed as `ReadonlyMap`.
- Compile target raised to ES2022 (Node 18+ baseline).
- Removed the `is-network-error` dependency — the package now has zero
  runtime dependencies.

### Fixed

- 3xx responses with `redirect: "manual"` are returned as successful
  responses instead of being misclassified.
- `TypedFetchError` no longer mixes constructor and instance types.

## 0.7.2 and earlier

See the [commit history](https://github.com/pbpeterson/typed-fetch/commits/main).

[Unreleased]: https://github.com/pbpeterson/typed-fetch/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/pbpeterson/typed-fetch/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/pbpeterson/typed-fetch/compare/v0.8.1...v1.0.0
