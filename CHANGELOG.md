# Changelog

## [Unreleased]

## [2.1.0] - 2026-08-15

Every published version carries at least one of the defects this section
fixes. `2.0.1` carries them too, and `2.0.1` was cut in this repository and
never published. A URL that carries userinfo can reach `error.message` and
`toJSON()` with a credential intact. The same is true when the userinfo sits
inside an embedded URL: a path segment, a protocol-relative reference, or a
bare `//` with no scheme. Upgrade past this release to close every shape
below. `SECURITY.md` lists what remains open after the fixes land.

<!-- redaction-directions: removes-more -->

### Security

- **`redactUrl` now opens a credential-hiding region everywhere the URL
  Standard opens an authority, and closes one only where `new URL` reads a
  complete authority at its start.** A region used to close at a fixed
  textual mark, and a credential can spell almost any mark a fixed rule
  chooses — including the mark that used to close a region and the scheme
  colon that used to open one — so the parser's own read of the text is now
  the only authority for both. This closes several shapes that previously
  carried a credential through `error.message`, `toJSON()`, and every other
  redacted channel unredacted: a credential that spells `://` inside itself,
  a protocol-relative url (`//host/…`), and a bare `//` with no scheme in
  front of it anywhere in the path. See `SECURITY.md` for the shapes that
  remain open.
- **`redactUrl` is a fixed point of itself for every url, including a
  relative one.** Redacting an already-redacted relative url could change it
  again, because the relative branch could emit a path beginning with `//`,
  and reading that value a second time resolved it as protocol-relative. The
  relative branch now resolves until re-reading it changes nothing.
- **`console.log`, `util.inspect`, and `Deno.inspect` no longer print an
  error's raw, unredacted properties on Deno when `Object.prototype` carries
  a polluted `Symbol.for("Deno.customInspect")`.** The inspect hook stamped
  only Node's inspect key. Deno resolves its own key first, so a polluted
  prototype rendered the built-in error's own properties instead of the
  redacted `toJSON()` record. Both keys are stamped now.
- **`redactUrl` no longer trusts a userinfo scan that throws.** The scan
  that asks whether the text in front of a parseable authority is userinfo
  can itself throw — an empty host and an out-of-range port both throw
  inside `new URL` — and a thrown scan answered null, so the credential in
  front of it never entered a region and reached `error.message`,
  `toJSON()`, and every other redacted channel unredacted. 112 of a
  200-url seam population leaked this way. The scan no longer asks a parse
  to confirm a credential at all. It reads the parser's own SPLIT POINT
  directly — the last `@` before the authority ends. A `file:` drive
  letter (`file:///c:/Users/alice@corp/x`) stays whole because `file:`
  opens no region under fewer than two solidi, not because a parse
  reported no credential. See `SECURITY.md` for the shapes that remain
  open.
- **`redactUrl` no longer loses a credential behind a scheme that matches
  its own internal resolution base.** A relative reference whose scheme
  equals the internal base's resolves to a path with its scheme colon eaten
  by the URL Standard itself, so no mark was ever there to open a region
  and the credential rode out whole:
  `http:alice:pw@api.test:99999/v1` kept its credential while `https:`,
  `ws:`, and `ftp:` spelling the same shape did not. The internal base now
  answers for every special scheme, not only its own spelling.
- **`redactUrl` is a fixed point of itself for a userinfo that carries both
  a solidus-colon run and an embedded `://` behind a bare `//`.** Redacting
  an already-redacted url in that family could change it again, because
  only the region's `@` question was re-asked of what the previous answer
  left behind. The region's END question is now re-asked at each new cut,
  too.
- **`redactUrl` no longer misreads a scheme shifted by a leading space or
  another C0 control character.** The basic URL parser strips a leading run
  of C0 controls and spaces before it reads a scheme. This module skipped
  only tab, CR, and LF at the same position, so a leading space in front of
  a scheme that equals the internal resolution base's shifted the scheme by
  one character for this module while the parser read it correctly, and the
  credential behind it rode out unredacted. The head of the input is now
  skipped with the parser's own wider set.
- **`redactUrl` re-parses a cleaned url until a pass changes nothing,
  instead of once.** The rebuild is a parse, and a parse removes a dot
  segment (`.` or `..`, under any case or percent-encoded spelling).
  Removing one credential could uncover a dot segment that collapses on the
  next parse and slides a second credential into the seam the first removal
  had just cleared. A cursor now skips a dot segment at the seam without a
  second pass in the ordinary case, which keeps the cost of a hostile input
  bounded instead of quadratic.
- **`redactUrl` no longer opens a credential-hiding region for `file:`
  under fewer than two solidi.** The URL Standard gives `file:` its own
  state, which reads a reference under fewer than two solidi as a path with
  an empty host, never an authority — exactly like `git:/svc:pw@host`. This
  module had still listed `file:` among the schemes that open a region at
  any solidus count, so it deleted a path segment a `file:` reference never
  offered as a credential, such as the username in
  `/go/file:/Users/alice@corp/report.pdf`.
- **The seam between an emitted origin and its path now removes a
  credential by the parser's split point, not by its `username` and
  `password` report.** The parser normalizes an empty userinfo away —
  `new URL("https://:@x/").href` is `https://x/` — so a userinfo of `:@` at
  the seam reported no username and no password while the parser had still
  read it as userinfo. That span kept its credential. The scan now reads
  the split point directly and no longer parses to confirm it.
- **A credential-hiding region that a bare `//` opens now ends where the URL
  parser reads its authority ending, exactly as a region a scheme mark opens
  does.** Two solidi with no scheme in front of them are how the URL Standard
  itself opens an authority, so the rule that keeps an embedded host behind
  `https://` had no reason to ask for a scheme as well — and while it did, one
  reference answered two ways.
  `https://api.test/go/https://media.test:8443/img/@alice` kept the authority
  it names, and `https://api.test//media.test:8443/img/@alice` emitted
  `https://api.test//alice`, a record that names a handle taken from a later
  path segment in place of the host the reference named. The redactor leaves
  both urls unchanged now. The `2.0.1` tree leaves both unchanged too, so the
  record for this shape is the same at both ends of this unreleased window.
  The other answer came from a build inside the window, and `2.0.1` was never
  published, so no consumer received it. `SECURITY.md` recorded this limit and
  now carries it struck through, with the correction.
- **A password whose raw spelling differs from the spelling the URL parser
  writes no longer survives in `error.message`.** The message pass removes the
  whole url wherever the message quotes it, and then removes each userinfo the
  url carries as a second pass. That second pass read this url's OWN userinfo
  out of the parser's report, and the parser percent-encodes a space, a
  non-ASCII letter, `<`, `|`, `` ` `` and a dozen more characters inside a
  userinfo. So a message quoting the url as the caller wrote it, in any
  spelling the whole-url replacement misses — a stripped fragment, a
  normalized default port — kept the password in full, and it reached
  `message`, `toJSON().message`, `stack`, `String(error)`,
  `JSON.stringify(error)`, `util.inspect(error)`, and `structuredClone`. The
  pass now reads this url's own userinfo in the caller's spelling as well as
  the parser's.
- **That same pass now covers a `file:` url under fewer than two solidi, and
  a scheme token that a tab, CR, or LF breaks.** It read this url's OWN head
  with the rules written for a colon found INSIDE a path. Those rules open a
  region at a scheme colon under fewer than two solidi only for the five
  schemes the URL Standard gives an authority state, which excludes `file:`
  on purpose, and they do not skip the tab, CR, and LF that the parser
  removes from the whole input before it reads anything. Both answers are
  correct for a path and wrong for the url's own scheme colon, which is the
  one place the parser has already committed to reading an authority. So
  `file:/svc:hun ter2@api.test/v1` and `htt<TAB>ps:/svc:hun ter2@api.test/v1`
  produced no needle for the caller's spelling, and the password reached
  `message`, `toJSON().message`, `stack`, `String(error)`,
  `JSON.stringify(error)`, `util.inspect(error)`, and `structuredClone`. Both
  urls are one url with a cleanly spelled twin — `new URL` answers
  `file:///svc:hun%20ter2@api.test/v1` and
  `https://svc:hun%20ter2@api.test/v1` — and the twin never leaked, so the
  character the caller typed decided it. The head is now asked its own
  question: the parse committed to an authority at that offset, so the answer
  is the URL Standard's own split, the last `@` before the authority ends.
- **A `\` inside a `file:` password no longer reaches `toJSON().url`.** A
  `file:` url has an empty host, so its credential lands in the path and the
  seam between the emitted origin and that path is what removes it. The seam
  read to the first `/`, `\`, `?`, or `#`, and `file:` is a special scheme,
  so a `\` the caller wrote inside the password had already been folded into
  a `/` before the seam saw it. The authority therefore appeared to end in
  the middle of the password, no `@` sat before that end, and the whole
  credential was emitted as path:
  `redactUrl("file:///svc:hun\ter2@api.test/v1")` was
  `file:///svc:hun/ter2@api.test/v1`, while the same password spelled `%5C`
  was removed in full. Both answer `file:///api.test/v1` now. This one
  reaches the record a structured logger writes, not only the message. The
  seam falls back to the path's last `@` only where the first segment holds a
  colon that no Windows drive letter wrote, so
  `file:///c:/Users/alice@corp/report.pdf` keeps every byte. See
  `SECURITY.md` for the over-redaction that fallback costs.
- **A password behind a leading backslash no longer survives under a special
  scheme.** Every hierarchical scheme is special, and under a special scheme
  the authority state ends on `\` exactly as it ends on `/`. So
  `https://alice:\hunter2@api.test/p` parses with the host `alice`, no
  username, no password, and the path `/hunter2@api.test/p`. The parser is
  right and the caller still wrote a credential: `hunter2` reached
  `error.message` under every spelling a platform can quote, and
  `toJSON().url` kept it too, because the url has an authority of its own so
  the seam was never asked and the path spells no mark for a region to open
  on. The redactor now asks the raw url whether its own authority SPILLED
  into the path, and reads the seam where it did. The record is
  `https://alice/api.test/p`.
- **An empty password's colon no longer costs an embedded url the authority
  it names.** The rule that keeps an embedded host behind `https://` asks
  whether the text at the region's start reads as a host and a port. It
  accepted the colon of an EMPTY password as that host-and-port colon and
  declined to suppress the colon rule, so the span ran on to a later `@` and
  the record named a handle in place of the host:
  `https://api.test/go/https://APIKEY:@media.test:8443/users/@alice` emitted
  `https://api.test/go/https://alice`, and the same url without the colon
  kept `media.test:8443`. `redactUrl` now removes an empty password's colon
  from the reading that suppresses the colon rule, so
  `https://APIKEY:@host/` and `https://APIKEY@host/` are recorded alike.
- **A message no longer loses every `:@` it carries.** Reading this url's own
  authority in the caller's spelling made the two-character span `:@` a
  needle, because the URL Standard erases an empty userinfo —
  `new URL("https://:@api.test/v1").href` is `https://api.test/v1` — and a
  needle is deleted from a message wherever it appears. A message reading
  `ratio 3:@4; key:@value` became `ratio 34; keyvalue`. `@` alone was already
  refused for exactly that reason; `:@` names no credential either, and an
  empty userinfo is now removed only where a solidus opens an authority in
  front of it. No released version carries this shape: it came from a build
  inside this unreleased window.
- **A redirect target that a server chose no longer costs one redaction pass
  per embedded url.** A credential-hiding region ended at the three literal
  characters `://`, and `://` is one SPELLING of a mark this module opens
  over any solidus count. A path spelling `https:/@` per unit therefore held
  no region bound anywhere: every region ran to the end of the text, every
  region's only candidate was the last `@` of the whole text, and each pass
  removed one `@`. An 8 KB `response.url` cost 1,001 rebuild passes and
  999,000 parses in one error construction, and paid it again on every
  `toJSON()`, while the SAME embedded url spelled with two solidi cost 2
  passes and 1,998 parses. A region now ends where the next scheme mark opens
  an authority, under any solidus count, so the one-solidus spelling costs 2
  passes and 1,997 parses. `response.url` after a redirect is text the server
  chose, so the shape of that text is a remote party's to pick.

### Fixed

- **A native `Request` reaches the transport whole, even when caller code
  replaces the global `Request` after this module loads.** The setup phase
  recognized a `Request` with an `instanceof` test against the current
  global. A replaced or patched global therefore sent the request to one URL
  and filed the error against another, and a patched `url` or `signal` getter
  on `Request.prototype` changed what the transport read. This module now
  captures the `Request` constructor and its `url` and `signal` descriptors at
  import, and it recognizes a native `Request` with the captured constructor.
  The current global remains a compatibility path for a polyfill that a
  caller installs later. This module leases the captured descriptors around
  the ambient `fetch` call and restores the caller's own descriptor after it.
  A late `fetch` key that a `signal` getter adds no longer reaches the
  transport through the init proxy, and a polluted `Object.prototype` setter
  no longer swallows the signal snapshot.
- **`clone()` refuses a branch that is not an independent `Response`.** The
  response's own `clone()` is an untrusted seam, and it could answer with an
  object-like partial double, with the original response, or with a branch
  that reuses the original body stream. Each answer passed the object-like
  test and reached the error constructor. A partial double became an
  `UnknownHttpError` with a `NaN` status, and a returned original made the
  release step cancel the body of the error that is still in use. `clone()`
  now reads the whole operational contract of the branch: the platform slots
  or the `Response` tag, the visible fields, the `Response` and `Headers`
  methods, and a body that is `null` or a real stream. It also asks whether
  the branch is the original response and whether the branch owns an
  independent stream, and it rejects the branch with a `TypeError` when
  either answer is wrong. A rejected original releases nothing, because
  there is no branch to release.
- **This library keeps custody of the first body a response shows.** A
  foreign response can answer `body` with a different stream on each read.
  Cleanup then canceled a stream that nobody owned while the live one stayed
  open. A hostile `bodyUsed` or `locked` getter could also re-enter and
  release the same stream a second time, or make a nested refusal release a
  body that an outer classification still owned. This library now records the
  first body read for each response, and validation, read, cancel, and
  cleanup all use that record. It reads `bodyUsed` from the native slot, so a
  shadow property cannot reopen a used body. It observes a cancel result
  through the captured `Promise.prototype.then`, so a hostile thenable cannot
  turn cleanup into an unhandled rejection. Release and classification refuse
  re-entry, and the body release goes to the classification that owns it.
- **A re-entrant read of `status`, `statusText`, `url`, or `headers` throws a
  `TypeError`.** An injected getter can call back into classification before
  its own first read gives a value. The read then started a second time and
  recorded an answer that the nested call produced. Each response now carries
  the set of identity reads in progress. No identity value is safe to give
  back before the first read is complete, so the second read is refused.

### Changed

- **`redactUrl`'s output moved for an ordinary input, not only for an
  attack shape.** An embedded credential in an ordinary path segment is
  now removed where it used to survive — see the region rules above. A
  `file:` path segment that a build inside this unreleased window deleted
  is kept again, because `file:` opens no region under fewer than two
  solidi; the `2.0.1` tree keeps it too, so only a build inside this
  window deleted it. See the `file:` bullet above. A path segment
  behind a bare `//` authority is kept again for the same kind of reason:
  the region there ends at the authority the parser reads, so the segment
  behind it was never a credential to remove. Over the 140,640-url
  population the disclosure suite draws, 1,266 rows keep such a segment
  that a build inside this window removed, and on none of them does the
  platform report a credential. The `2.0.1` tree did not remove them
  either: over that same population, the record this release emits is
  never longer than the `2.0.1` tree's, on any row. A credential-free
  proxy url shows the
  direction an ordinary input actually took: `redactUrl` turns
  `https://api.test/relay/https://media.test/photos/mia@example.com/pic.png`
  into `https://api.test/relay/https://example.com/pic.png`. The record
  drops `media.test`, the host the request contacted, and names
  `example.com`, a host it never reached. See `SECURITY.md` for the
  residual this shape leaves open. Anything that greps or alerts on
  `error.message` or `toJSON().url` sees a different string after this
  upgrade. That is true even for a url that carried no credential at all
  before this release.

## [2.0.1] - 2026-08-03 — NEVER PUBLISHED

WARNING: `2.0.1` is not on npm, and no `v2.0.1` git tag exists. It was prepared,
dated, and cut in this repository, and nothing was published. The published
versions end at `2.0.0`. Do not try to install `2.0.1`, and do not follow a
`v2.0.1` compare link.

Your upgrade path is `2.0.0` → `2.1.0`. Nothing in this section was ever
published on its own, so the real migration delta is the union of this section
and the `[2.1.0]` one above. Read both.

This section keeps its own heading and its own date, and it carries no footer
link, because there is no tag for one to name.
[`RELEASING.md`](https://github.com/pbpeterson/typed-fetch/blob/main/RELEASING.md)
requires every publication to be reconstructable from an immutable tag, so a
dated heading on its own reads as a publication. Folding this section into
`[2.0.0]` would hide a version number that `package.json` carries and that this
file records. Leaving it dated and unmarked would let it claim a publication
that never happened.

### Security

- **A request failure's `message` is now a library constant, such as
  `Network error`.** The platform's rejection message is never copied. A
  platform reports a request it refused by quoting the caller's value back — a
  header name or value, the URL, the referrer, the method, or an enum member —
  and that message reached `message`, `stack`, `String(error)`,
  `JSON.stringify(error)`, and `util.inspect(error)`.

  The previous release struck a refused header part back out of that message.
  That could not hold: striking it out needs the caller's value a SECOND time,
  after the transport has consumed it, and the second read is the caller's to
  choose. A record getter, an index getter on either header container, and a
  `toString` each answer differently, and the search string then matches
  nothing. The URL, the referrer, the method, and the enum slots were never
  covered at all.

  CAUTION: `error.cause` holds the platform error, unmodified, and it is the
  supported way to read what the platform reported. `toJSON()` and the inspect
  hook withhold it. Decide what a log line may carry before you copy
  `error.cause` into one.

- `typedFetch` no longer reads the caller's `headers`. The transport is the only
  reader of that slot, so a header getter runs exactly once, as it does under a
  bare `fetch`. The snapshot of one-shot header containers is gone with the
  redactor that needed it.

- The release workflow now gives `id-token: write` to a minimal publish job.
  Checkout, dependency installation, build, tests, audits, and packaging run in
  a separate job without OIDC. The publish job verifies the artifact checksums
  and publishes the prepared tarball with lifecycle scripts disabled.

### Fixed

- **Only a rejected transport call can produce an `AbortedError` or a
  `TimeoutError`.** `typedFetch` ran three phases under one `try`: reading the
  caller's options, awaiting the transport, and inspecting the resolved value.
  The classifier trusts the governing signal by design, so a `status`,
  `headers`, `bodyUsed`, `ok`, or `type` getter that aborted the signal and then
  threw an abort-shaped exception was answered with an `AbortedError` — for a
  failure the abort never caused. Each phase now has its own catch.
- **The request input is serialized once.** The transport performs a
  `USVString` conversion on anything that is not a `Request`, and `error.url`
  was resolved by converting the input a second time. A `toString` with state
  sent the request to one URL and filed the error against another. `typedFetch`
  now serializes once and hands the transport that exact string; a `Request` is
  passed through unchanged.
- **The dependency audit gate fails on ANY known advisory, in the whole
  toolchain.** The gate ran with `--audit-level high`, so a moderate advisory in
  a build dependency passed it. The script is now `audit:ci`, which also removes
  the collision between `pnpm audit` the script and `pnpm audit` the command,
  and `postcss` is overridden to `8.5.25` to clear GHSA-fxqj-rqcc-2cmp. This
  package still ships zero runtime dependencies.
- **The release workflow publishes the staged tarball by absolute path.** npm
  reads that argument as a package specifier, and a specifier is a file only
  when it starts with `.`, `/`, `~/`, or a drive letter. `package/<name>.tgz`
  was read as a GitHub shorthand, so npm ran `git ls-remote` against
  `github.com` from a job with no checkout and no git credentials. The workflow
  also validates the staged tarball itself, not only a dry-run manifest.

## [2.0.0] - 2026-07-30

### Documented

- **The untrusted-`fetch` conformance boundary.** `typedFetch` invites an
  injected `fetch`, which makes the resolved value, the rejection, the signal,
  and the options object untrusted. How far the library distrusts them is now a
  decision rather than an open question:
  [ADR 0003](./docs/adr/0003-the-untrusted-fetch-conformance-boundary.md) names
  26 in-scope behaviors and what the caller gets for each, and eight that are
  permanently out of scope with the reason each cannot be closed. No runtime
  behavior changed; every row records what the library already did.

  The record has an executable half. `fixtures/hostile-fetch.ts` drives every
  row end to end, and `conformance.spec.ts` asserts that the rows and the
  scenarios are the same set with the same titles — so a guard added without a
  row fails the suite, and so does a row with no guard.

### Fixed

1. A request header value the platform REFUSES no longer reaches
   `NetworkError.message`. undici reports a refused header by quoting the value
   back (`Headers.append: "…" is an invalid header value.`), and that message
   was copied verbatim, carrying an `Authorization` or `Cookie` value into
   `message`, `toJSON()`, `util.inspect`, the fatal-exception printer, and
   `String(error)`. The value is replaced with `<redacted>`, which also removes
   the raw CR or LF that made the message a log-injection primitive. Only
   refused values are struck out, and the definition is the platform's: the
   Fetch Standard forbids NUL, CR, and LF inside a header value and normalizes
   edge whitespace away rather than refusing it. An accepted value never
   reaches a rejection message, and striking every held value would replace
   `1` or `application/json` wherever they appeared.
2. `typedFetch` no longer rejects when the request input is `Request`-shaped and
   its `url` answers with a value that is not a string. `requestUrl` normalizes
   the read, so the envelope returns `{ response: null, error }` as documented
   and `error.url` — declared `readonly string` — can no longer hold a number
   that then flows into `redactUrl` and into the `toJSON()` record.
3. `NetworkError`, `AbortedError`, and `TimeoutError` read `cause`, `reason`,
   and `url` as OWN properties of their options object. A polluted
   `Object.prototype` could forge a cause and put a URL the request never
   touched into the `toJSON()` record. `typedFetch` itself was unaffected: it
   always builds an own-property literal.
4. `error.cancel()` re-entered from the body stream's own cancel algorithm now
   settles with the first call instead of reporting success while the real
   release is outstanding. `ReadableStreamCancel` runs the underlying source's
   algorithm synchronously, so a consumer-constructed stream could call back
   before the in-flight call was observable.
5. `isResponse` no longer records a status or headers for a value it goes on to
   REFUSE. Presented with the same object twice — first incomplete, then
   completed and reporting a failure — the recorded status from the refused
   call decided the second, and a failed request escaped through the success
   branch. Every structural check now runs before the identity reads. This also
   changes which exception becomes the `NetworkError` cause when a response has
   several hostile getters: the body's shape is inspected before any identity
   field.
6. A refused header value is now redacted as the platform NORMALIZES it, not as
   the caller wrote it. The Fetch Standard strips leading and trailing HTTP
   whitespace before it validates, and undici quotes the stripped value back —
   so a credential padded with a newline, the shape a key read from a file has,
   was searched for in a message that never contained it and reached
   `NetworkError.message` intact. The value is also read the way WebIDL reads
   it (`String()`), which covers the `string | string[]` shape a JavaScript
   caller forwards from Node's `req.headers`. The same change removes a false
   positive in the other direction: a value padded with ONLY whitespace is
   accepted by the platform and is no longer put on the strike list.
   (ADR 0003, row H-25.)
7. `isResponse` records the status LAST of the identity reads. Reading `headers`
   is itself a refusal point — a throwing getter answers with a `NetworkError`,
   ADR 0003 row H-13 — so a status was still filed against a value the function
   then refused. Item 5 above closed that across the structural checks; this
   closes it across the identity reads. The same object presented twice, first
   with a throwing `headers` getter and then complete and reporting `404`, was
   answered with the recorded `200` and escaped through the success branch.
8. `error.cancel()` no longer rejects when the body stream's own `cancel()`
   answers with a non-thenable or throws synchronously. It rejected with a
   `TypeError` about reading `catch` of `undefined`, which under Node's default
   `--unhandled-rejections=throw` ends the process for a fire-and-forget
   cleanup call — the exact failure the swallow was written to prevent. The
   release now prefers the captured `ReadableStream.prototype.cancel`, so an
   own `cancel` that resolves without releasing anything can no longer report a
   freed connection that is still open.
9. A body reader that throws SYNCHRONOUSLY gives the claim back. `readStarted`
   latches before the platform reader, because a read that has started must
   refuse every later reader — but a reader that threw never touched the
   stream, and the latch left the body both unreadable and uncancellable:
   `cancel()` took its `readStarted` early return and reported success over an
   open connection. A REJECTED reader still keeps the claim; those bytes are
   gone.
10. Identity reads are STAGED, and a refused value keeps nothing. Ordering them
    could never close this: whichever read ran first was filed before the second
    could refuse the value. Reading `headers` before `status` only moved which
    field was stranded — and a stranded `headers` is not harmless, because
    `hasCompatibleSuccessSurface` reads through the same cache. A response whose
    `status` getter threw had its `headers` filed anyway, and the same object
    presented again, honest and stable but carrying a `headers` that was not a
    `Headers`, escaped as a typed success whose `headers` had no `get`. The
    rollback drops only what the refused call recorded; a field fixed by an
    earlier accepted call is still that response's identity.
11. A refused header NAME no longer reaches the message. A name is refused on
    the same footing as a value and quoted back the same way, so
    `{ "X-Foo\r\nSet-Cookie: forged=1": "v" }` put a raw CRLF into `message` —
    the log-forging half of the hazard that item 1 closed for values. The bound
    stays the platform's: a name refused merely for holding a space is echoed
    intact, because it forges nothing. (ADR 0003, row H-26.)
12. Header containers WebIDL accepts are read the way WebIDL reads them. A
    `sequence` is converted through the value's own iterator, so
    `[new Set([name, value])]` is a valid pair — and `Array.isArray` refused it,
    which put the credential back in the message. A callable carrying own
    enumerable properties is a record to the platform for the same reason.
    A one-shot inner iterable stays a stated residual: `fetch` consumed it
    first, and there is nothing left to read.
13. `redactUrlInMessage` no longer rewrites the parts of a message that are not
    the URL. `replaceAll` has no notion of how distinctive its needle is, and
    the needle is the caller's url — which can be one character. `typedFetch("a")`
    rejects with `Failed to parse URL from a`, and because `redactUrl("a")` is
    `/a` the pass fired and rewrote every `a` in the platform's own wording:
    `F/ailed to p/arse URL from /a`. The pass is now bounded the way the header
    pass already was — it runs when the url can hold a secret at all, which a
    relative url does only when it spells a userinfo, a query, or a fragment.
    Nothing was disclosed; the redacted form is redacted by construction. The
    one relative-url test this function had used a path whose redacted form is
    identical, which is exactly the shape that dodges it.
14. A refused header NAME is collected as the caller wrote it, not as a VALUE
    would be normalized. Item 11 collected names through the value normalizer,
    which strips leading and trailing HTTP whitespace — and CR and LF are HTTP
    whitespace. A name refused for an EDGE newline, `{ "\nX-Secret": "v" }` or
    `{ "X-Secret\n": "v" }`, normalized to a name that tests as accepted, so it
    never reached the strike list and undici's quoted echo carried the raw CR or
    LF into `NetworkError.message` — the log-injection primitive item 11 was
    written to close, reopened for every name whose newline sits at the edge.
    Only an interior newline survived the normalization, which is the one shape
    item 11's test used. Nothing normalizes a name before the platform validates
    it, so nothing normalizes one here; values keep the normalization item 6
    gave them. (ADR 0003, row H-26.)

### Changed

- **`engines.node` is now `>=20.13.0`.** The declared floor was `>=20`, and it
  was wrong: on Node 20.0 through 20.12 the two-branch cleanup this package
  documents — `await Promise.all([error.cancel(), copy.cancel()])` — never
  settles, and 16 of this repository's own tests fail. undici 5.x gives
  `Response.clone()` the opposite tee polarity, so cancelling the branch hangs
  forever while cancelling the source returns at once; undici 6.13.0, which
  ships in Node 20.13.0, has the polarity this library was written against.
  Raw `ReadableStream.tee()` is correct on every runtime measured, so the
  comments calling this "native `ReadableStream` behavior" described `clone()`,
  not the primitive.

  `scripts/smoke/node-min.mjs` is the gate that exists to execute the floor, and
  it ran for months without ever calling `clone()`. It does now, with a timeout,
  because the failure mode is a hang and a hung smoke reports nothing.

### Documented (corrections)

- `TypedResponse` omits `Response.bytes()` and `Headers.getSetCookie()` for
  DIFFERENT reasons, and the second was stated wrongly. `bytes()` is absent from
  the floor. `getSetCookie()` is present there — undici has shipped it since
  5.19 — and is omitted because a foreign response is not validated for it.
  `error.headers` is a real `Headers`, so it is available there.
- The `ByteString` conversion is `ToString` FOLLOWED BY a range check, not
  `String(value)` alone. A value above Latin-1 is refused by the platform and
  classified as accepted by the collector; that costs nothing today, because the
  rejection quotes an index and a code point rather than the value. Three files
  reasoned from the shorter version of this sentence.

### Release context

This is a **major**, and most of the breaks are in runtime behavior.

The baseline is `1.0.0`, not `1.1.0`. This repository prepared `1.1.0`.
It was never published to npm or tagged. Read its section below. Every consumer
upgrades `1.0.0` → `2.0.0`. The migration delta combines this section with the
`[1.1.0]` section.

The numbered list below compares against `1.1.0`. One item does not reach a
`1.0.0` consumer. Version `1.1.0` added the `clone(recreate)` callback that break
4 narrows. Every other item applies from `1.0.0` unchanged.

These runtime changes remove behavior that `1.1.0` had.

1. `error.headers` and `error.url` are no longer enumerable. A spread, an
   `Object.keys(error)` walk, and a `for...in` loop no longer reach them.
2. `error.cause` and `AbortedError.reason` are no longer enumerable either.
3. `error.headers` is a copy of the response headers. A write through it no
   longer reaches the response.
4. `clone(recreate)` refuses callback results that cannot own the cloned body
   branch. This includes a different response, a wrapper, an unconfirmed copy,
   and a non-object result.
5. A custom Fetch implementation that resolves a response whose `headers` is
   `null` yields a `NetworkError` instead of an HTTP error.
6. `typedFetch` reads the `fetch` override as an own property of `options`. An
   override that arrives through the prototype chain is ignored.
7. `typedFetch` records the first successful read of `status`, `statusText`,
   `url`, and `headers`. It converts `status` to a number. A custom Fetch
   implementation can therefore produce a different error.
8. A custom Fetch implementation must resolve with a platform `Response` or a
   compatible polyfill. Other values yield a `NetworkError`.

Two breaks are compile-time.

- `TypedFetchOptions["headers"]` rejects `undefined` as a header value.
- `TypedResponse` names a stable response baseline instead of extending the
  ambient `Response` type.

Read the migration table before you upgrade.

### Migration

| What changed                                           | How it shows up                                                        | What to do                                                             |
| ------------------------------------------------------ | ---------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `headers` and `url` are not enumerable                 | A log built from `{ ...error }` loses both fields                      | Call `error.toJSON()`, or read `error.headers` and `error.url` by name |
| `cause` and `reason` are not enumerable                | A deep log loses the transport detail                                  | Read `error.cause` and `error.reason` by name                          |
| `error.headers` is a copy                              | `error.headers.set(...)` no longer edits the response                  | Edit the `Response` you hold                                           |
| `clone(recreate)` refuses a wrapper                    | A `TypeError` names the wrapper                                        | Return the new error itself, never a Proxy around it                   |
| `clone(recreate)` refuses an unconfirmed copy          | A `TypeError` names a copy that cannot confirm the branch              | Upgrade the other copy, or construct the error with this copy          |
| `clone(recreate)` refuses a non-object result          | A `TypeError` names what the callback returned                         | Return the new error itself                                            |
| A string `status` from a custom Fetch                  | The error class changes from `UnknownHttpError` to the dedicated class | Assert on `error.status` as a number                                   |
| A non-string `statusText` or `url` from a custom Fetch | The field is the empty string                                          | Answer with a string, as the platform does                             |
| The library records identity fields                    | A successful getter runs once per response                             | Update the count in the test                                           |
| `headers: null` from a custom Fetch                    | The result is a `NetworkError`                                         | Give the response a real `Headers` value                               |
| A custom Fetch resolves a non-`Response`               | The result is a `NetworkError`                                         | Return a platform `Response` or compatible polyfill                    |
| `fetch` must be an own property                        | The request goes to the global `fetch`                                 | Write `{ ...options, fetch }` or `Object.assign(options, { fetch })`   |
| `headers` rejects `undefined`                          | TS2322 or TS2375 on a Node consumer without `lib.dom`                  | Write `...(token ? { Authorization: token } : {})`                     |
| `TypedResponse` uses a stable baseline                 | New ambient Fetch members are not promised                             | Narrow or cast when the target runtime provides a newer member         |

### Breaking

- `TypedResponse` no longer extends the ambient `Response` type. It explicitly
  names the Fetch surface available on Node 20.0, the package runtime floor.

  A newer TypeScript library can add `Response.bytes()` or
  `Headers.getSetCookie()` before every supported runtime implements them.
  Inheriting that type made a toolchain update silently expand this package's
  promise. The runtime value remains the unmodified platform response. Narrow
  or cast it when the target runtime provides a newer member.

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
  releases the branch first.
- `clone(recreate)` refuses a copy that cannot confirm ownership of the cloned
  branch. Each package copy has its own body table. Another copy's body is
  therefore invisible.

  That invisibility was previously consent. A callback could return an instance
  from another copy that held a different response. The teed branch became an
  orphan, and `cancel()` never settled. Every copy now stamps a
  `Symbol.for("@pbpeterson/typed-fetch.ownsResponse")` method on
  `BaseHttpError.prototype`, and `clone()` asks it. An instance from a
  different package copy is accepted when it confirms that it took the branch.
  An instance from a package copy older than this one cannot answer, and
  `clone()` throws a `TypeError` after it releases the branch. Migration:
  upgrade the other copy, or build the new error with the copy that is cloning.

- `clone(recreate)` refuses a callback result that is not an object.
  `clone(() => null)` resolved with `null` and stranded the branch. It now
  throws a `TypeError` that names what the callback returned.
- `typedFetch` records the first successful read of `status`, `statusText`,
  `url`, and `headers`. This prevents an error class and its fields from using
  different answers. A failed getter can run again. Earlier successful fields
  remain recorded. Response validation reads `headers` through the same cache.
  An identity loan cannot shadow any complete or partial record.
- A custom Fetch implementation must resolve with a platform `Response` or a
  standards-compatible polyfill. A string, bare object, or partial test double
  now yields `NetworkError`. Before, it could escape as typed success.
  `NetworkError.cause` holds the validation or inspection failure on this path.

  `typedFetch` recognizes a platform response through the platform's `status`
  getter. A foreign response must tag itself `[object Response]`. It must expose `body`,
  `bodyUsed`, `headers`, `ok`, `redirected`, `status`, `statusText`, `type`, and
  `url`. It must also expose `arrayBuffer`, `blob`, `clone`, `formData`, `json`,
  and `text`. Its body must be `null` or a WHATWG `ReadableStream`.

  Every response must expose those operational members and report `bodyUsed` as
  a boolean. This also rejects own properties or a replaced prototype that hides
  a platform response's native surface. Before `typedFetch` returns a success,
  its headers must expose the standard iterable operations. It also requires
  boolean `ok` and `redirected`, numeric `status`, string `statusText` and `url`,
  and a standard response `type`. A mismatch yields `NetworkError`. HTTP errors
  retain the identity and `HeadersInit` normalization below.

  Validation occurs at handoff. `typedFetch` returns the same object without
  freezing it or adding a Proxy. A custom implementation must keep its getters
  and members compatible after validation.

  Rejection cleanup now uses captured platform operations when a modified native
  response hides `body`, replaces its prototype, or shadows the stream's
  `cancel`. It restores a temporarily repaired response prototype. A foreign
  response follows normal property precedence and releases its nearest visible
  body, not a different ancestor's body. A foreign Node stream still falls back
  to `destroy()`. Cleanup remains best effort when a hostile object refuses both
  native access and scoped prototype repair.

  `node-fetch` and `cross-fetch` use a Node stream in Node.js. They also omit
  required members. `whatwg-fetch` exposes no WHATWG body stream. These
  implementations now yield `NetworkError`.

- `typedFetch` converts `status` to a number before it compares it with 400. A
  custom Fetch implementation that answers `status` with `"404"` now resolves
  with `NotFoundError` and a numeric `status` of `404`. It resolved with
  `UnknownHttpError` carrying the string `"404"` before, which broke the
  declared `number` type and made `isKnownHttpError` return `false`.
- `statusText` and `url` are the empty string when the response answers with a
  value that is not a string. A `URL` object in the `url` slot of a test double
  no longer reaches `error.url`. Give the double a string.
- A copy from `clone()` reports the identity of the error it was cloned from. It
  no longer re-reads the cloned response. This covers a copy that the cloning
  package copy builds, which is every copy that a built-in error, a subclass, or
  a same-copy recreation callback produces. A recreation callback that returns an
  instance from a different package copy runs that copy's constructor, and that
  instance reads the response it receives. For a real `Response` the two answer
  with the same four values.
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
  and the native branch still accepts the value. Both required correction. A consumer
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
- `error.message` and the `toJSON()` record hold a redacted URL. A hierarchical
  URL keeps its origin and path. An opaque URL keeps only its scheme. Both drop
  userinfo, the query string, and the fragment.

  A query string routinely carries a credential, and `message` reaches every
  log line, crash dump, and test failure. A deny list of sensitive query keys
  fails for the reason it failed for header names. The dangerous key is the one
  this library has never heard of. The redactor drops the whole query instead.
  `error.url` still holds the full href, exactly as `error.headers` still holds
  every header value. A URL with no userinfo, query, or fragment produces a
  byte-identical message. A secret in a hierarchical path segment still reaches
  the message and record. Dropping that path would prevent request correlation.
  This is not a break. The semver
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
  that into an exit-1 crash. Cleanup now catches the failure at its source.
- `typedFetch` releases the response body when reading `status` off an injected
  `fetch` implementation throws. The guard added in `1.1.0` started below the
  status read, so a hostile getter stranded a live body with no owner — the
  caller receives `response: null` and never gets a handle to it. Related, on
  the same lines: `statusOf` now records the first successful read. A getter
  reporting a different value later cannot select a class that reports another
  status. Cleanup catches its own failures, so a throwing `body` getter cannot
  replace the reported cause.
- `typedFetch` reads the governing `AbortSignal` once and materializes it in the
  `RequestInit` given to the transport. Previously, `typedFetch` and the
  transport could read different values from one getter. Classification could
  then use a signal that did not govern the request.

  A real abort could become `NetworkError`. A later signal could also abort a
  request that the recorded signal did not govern. The captured value now
  controls both the transport and classification.

- `error.message` and the `toJSON()` record no longer carry the payload of an
  opaque URL. Hierarchical URLs keep paths because those paths identify
  resources. A `data:` URL instead carries its bytes in the path. A `blob:` URL
  carries an unguessable handle there.

  `redactUrl` previously emitted both values. A `NetworkError` for
  `data:text/plain,SECRET` therefore exposed `SECRET` in its message and record.
  Paths remain for `http:`, `https:`, `ws:`, `wss:`, `ftp:`, and `file:`.
  The redactor reduces every other scheme to that scheme. `error.url` keeps the
  full href.

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
- The examples used browser-relative URLs such as `/api/users`, which reject on
  Node with `TypeError: Failed to parse URL`. Installation names Node 20 as the
  target. The first example therefore could not run on the runtime the document
  recommends. Every example URL is now absolute in `README.md`, in
  `skills/typed-fetch/SKILL.md`, in the public JSDoc, and in the migration
  examples in this file. `pnpm check-docs` fails a `typedFetch` example whose
  first argument is a relative URL literal.

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
  The correction reached `README.md` only. `src/errors/network-error.ts` and
  `skills/typed-fetch/SKILL.md` still told the reader to inspect `cause` before
  retrying, so the package shipped two contradictory rules — one of them in the
  `.d.ts` a consumer reads on hover. All three now carry the same rule.
- The README Terms table was missing `resolves with`, `rejects`, and `throws`,
  the three terms the controlled vocabulary is built on. It now carries the same
  eleven terms as `docs/writing-standard.md`, in the same order. `reason phrase`
  and `error record` moved into that standard, so no term is defined in the
  consumer document alone. `pnpm check-doc-style` compares the two tables.
- The README linked to `./LICENSE` from its license badge and its closing
  section. `README.md` is the only document in the npm tarball, so a reader
  opening it from `node_modules` followed a dead link twice. Both are absolute
  URLs now, and `pnpm check-doc-style` fails any relative link in `README.md`.
- Nine occurrences in this file used the error-body word for an abort. A request
  is aborted; an error body is canceled. The wording changed; no recorded fact
  did.
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
  not, so test authors inspected `dist/errors/index.d.ts` for those signatures.
- `README.md` shows how a wrapper merges headers. The previous wrapper example
  passed `options` straight through. The naive `{ ...options?.headers }` spread
  type-checks, and it silently drops every entry of a `Headers` instance.
  `new Headers(options?.headers)` compiles with no cast in both lib profiles.

### Internal

- `prepublishOnly` verifies the artifact instead of rebuilding it. It ran
  `npm run build`, so `npm publish` fired tsup with `clean: true` after
  `verify-pack` and `check-consumer` had already inspected `dist/`. The tarball
  npm uploaded was a rebuild of the one the gates passed rather than that one.
  It now runs `scripts/verify-pack.mjs`, which fails a missing or incomplete
  `dist/` instead of silently regenerating it.
- The Deno job pins `deno-version: v2.x`. `scripts/check-deno-consumer.mjs`
  refuses anything below Deno 2. Previously, an action default selected the
  validated major, although the workflow pins every action by SHA.
- `errors/package.json`, the Node 10 resolution stub, declares
  `"sideEffects": false` like the root manifest. A bundler that reads the stub
  as the description file for `@pbpeterson/typed-fetch/errors` can now treat the
  subpath as free of side effects.
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
  names. A secret in a hierarchical URL path survives redaction by design.
- `scripts/check-consumer.mjs` gains a sixth typecheck pass, `node-eopt`: no
  DOM, `@types/node`, and `exactOptionalPropertyTypes: true`, compiling
  `typedFetch(url, { fetch: maybeFetch })` against the published declarations.
  It is the only executable gate for that contract, because this repository does
  not compile its own sources with the flag. The suite now runs 38 consumer
  assertions.
- `scripts/check-consumer.mjs` also gains a cross-copy clone probe. The ESM copy
  of the installed tarball clones an error, and the CJS copy supplies the
  recreated instance. It proves the one thing nothing else proves: that the
  `ownsResponse` stamp survives `npm pack`, `npm install`, and the `exports` map
  in both formats. `Symbol.for` is process-global, so the ESM copy can ask a CJS
  instance — but only when each format ran its own stamping side effect, which a
  packaging change could drop. Three assertions: a copy from the other format
  that took the handed branch is accepted and both bodies release; a copy built
  from a different response is refused with the branch released first; and every
  `cancel()` is raced against a timer, so a stranded branch reports a verdict
  instead of hanging the gate.
- `pnpm check-docs` now compiles the TypeScript examples in `CHANGELOG.md`.
  All four failed: three put a `// Before (0.x)` half and an `// After` half in
  one fence, so the halves collided with `TS2451` before either was judged, and
  the After halves were missing their imports. Two obtained an HTTP error and
  never released its body. The migration examples are now one fence per half.
  A half that documents a removed API carries the new `historical` marker, which
  is valid only in `CHANGELOG.md`, is never compiled, and — unlike `no-check` —
  leaves the skip ratio untouched, because a changelog accumulates historical
  examples forever and that ratio must not drift toward its cliff on their
  account. `historical` used in any other file fails the gate. `check-docs` also
  fails a `typedFetch` example whose first argument is a relative URL literal.
- `pnpm check-doc-style` is a new gate. It reads Markdown and public JSDoc as
  text, needs no `dist/` and no `tsc`, and reports three classes at once: a
  relative link in `README.md`, a controlled-vocabulary violation in prose, and
  a README Terms table that has drifted from `docs/writing-standard.md`. It runs
  before `pnpm build` in CI, because none of its checks needs a build.
- `scripts/validate-release.mjs` now also reads the CHANGELOG FOOTER. It
  requires a `[X.Y.Z]:` compare link that ends at `vX.Y.Z`, and an
  `[Unreleased]:` link that compares from `vX.Y.Z` to `HEAD`. The dated heading
  it already checked proves the section exists and proves nothing about the link
  the heading resolves through, and no other gate reads the footer. The base of
  the `[X.Y.Z]:` range stays unchecked, because this gate cannot see the
  previous version. `RELEASING.md` gains the matching checklist step.
- `response-identity.spec.ts` is new and drives the identity module directly.
  Counting getters pin the first successful read per response. Other cases pin
  numeric conversion, text normalization, clone inheritance, and partial
  identity failures.
  `base-http-error.spec.ts` gains the `clone()` decision table — one case per
  refusal condition, each closed by one helper that asserts the teed branch
  reports `bodyUsed === true` and that `cancel()` on the original settles. The
  two assertions are independent: the first alone would pass if `release()` ran
  on the wrong branch, the second alone would pass if the platform changed its
  tee semantics. One existing case changed rather than being papered over — an
  instance from a package copy that cannot answer the ownership query is now
  refused. It also gains the four `BH-17` to `BH-20` cases that pin the
  inherited identity as a LOAN, one of which pins the revoke's position: a
  `recreate` callback that throws is the only exit a revoke written below the
  construction block misses, and moving the revoke there leaves that loan alive
  for the life of the process. `brand.spec.ts` covers the reader's three
  answers, its refusal to throw for a hostile value, and the frozen descriptor
  of the stamped method.
- `docs/adr/0002-refuse-a-clone-copy-that-cannot-confirm-the-branch.md` records
  why the unconfirmed copy is refused instead of accepted, including the
  lenient policy as an evaluated and rejected alternative. Without it the next
  reader sees a refusal and re-proposes leniency.

## [1.1.0] - 2026-07-24 — NEVER PUBLISHED

WARNING: `1.1.0` is not on npm, and no `v1.1.0` git tag exists. It was prepared,
dated, and superseded by `2.0.0` before anything was published. The published
versions end at `1.0.0`. Do not try to install `1.1.0`, and do not follow a
`v1.1.0` compare link.

Your upgrade path is `1.0.0` → `2.0.0`. Everything in this section shipped as
part of `2.0.0`, so the real migration delta is the union of the `[2.0.0]`
section and this one. Read both.

This section keeps its own heading and its own date, and it carries no footer
link, because there is no tag for one to name.
[`RELEASING.md`](https://github.com/pbpeterson/typed-fetch/blob/main/RELEASING.md)
requires every publication to be reconstructable from an immutable tag, so a
dated heading on its own reads as a publication. Folding this section into
`[2.0.0]` would hide a version number that existed in `package.json` and in this
file. Leaving it dated and unmarked would let it claim a publication that never
happened.

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
  produced a `NetworkError` for an aborted request — and a retry loop keyed on
  `NetworkError` would reissue calls the caller had explicitly aborted. A
  governing signal that reports `aborted` plus an error-shaped rejection named
  `"AbortError"` or `"TimeoutError"` is now classified as the abort, and
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
  aborted or timed-out requests.** An abort and a timeout are not
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
- `AbortedError.reason` (`unknown`) — the `AbortSignal`'s abort reason,
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
  so every abort on this path misclassified as a `NetworkError` instead
  of `AbortedError`/`TimeoutError`. The governing signal is now resolved from
  either slot. Precedence matches native `fetch(request, init)`: an
  options-slot `signal` overrides the `Request`'s own signal entirely.
- **A `Request` object passed in the `options` slot keeps its WebIDL state.**
  A `Request` is a host exotic object: its `method`, `headers`, `body`, and
  `signal` are prototype getters, not own enumerable properties. The
  `options.fetch` change (b00380e) introduced an object rest spread
  (`const { fetch, ...init } = options`) that copied none of them, silently
  downgrading `typedFetch(url, new Request(url, { method: "POST", ... }))` to a
  bodyless, header-less `GET` and dropping the abort signal (so a pre-aborted
  or timed-out `Request` produced no error at all). A proxy now preserves the
  original prototype and delegates getters to the original object. The
  governing signal is the exception: the proxy materializes the captured value
  for the transport.
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

```typescript historical
// 0.x. This block documents a removed API and cannot compile against 1.x.
const { response, error } = await typedFetch<User, NotFoundError>(
  "https://api.example.com/users/123",
);
if (error) {
  // error was typed as NotFoundError | ServerErrors | UnknownHttpError | NetworkError,
  // but a 403 response would still construct a ForbiddenError at runtime —
  // the second type argument was never checked against what actually came back.
  if ("cancel" in error) await error.cancel();
}
```

Replace it with:

```typescript
import { typedFetch, isKnownHttpError } from "@pbpeterson/typed-fetch";

interface User {
  id: number;
}

const { error } = await typedFetch<User>("https://api.example.com/users/123");

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
  // No branch above reads the body, so cancel it.
  await error.cancel();
}
```

Prefer `instanceof` if you only care about one class:

```typescript
import { typedFetch, isHttpError, NotFoundError } from "@pbpeterson/typed-fetch";

const { error } = await typedFetch("https://api.example.com/users/123");

if (error instanceof NotFoundError) {
  console.log("User not found");
  await error.cancel();
} else if (isHttpError(error)) {
  await error.cancel();
}
```

**2. Aborts and timeouts are no longer `NetworkError`.**

```typescript historical
// 0.x. This block documents a removed API and cannot compile against 1.x.
const { response, error } = await typedFetch<User[]>("https://api.example.com/users", {
  signal: AbortSignal.timeout(5000),
});
if (isNetworkError(error)) {
  if ((error.cause as Error)?.name === "AbortError") {
    console.log("Request was aborted");
  } else {
    console.log("Network error:", error.message);
  }
} else if (error && "cancel" in error) {
  await error.cancel();
}
```

Replace it with:

```typescript
import {
  typedFetch,
  isNetworkError,
  isAbortError,
  isTimeoutError,
  isHttpError,
} from "@pbpeterson/typed-fetch";

interface User {
  id: number;
}

const { error } = await typedFetch<User[]>("https://api.example.com/users", {
  signal: AbortSignal.timeout(5000),
});

if (isAbortError(error)) {
  console.log("Request was aborted");
} else if (isTimeoutError(error)) {
  console.log("Request timed out");
} else if (isNetworkError(error)) {
  console.log("Network error:", error.message);
} else if (isHttpError(error)) {
  await error.cancel();
}
```

If you only checked `error instanceof NetworkError` (or `isNetworkError`) to
catch _any_ pre-response failure, add the two new branches above it —
`isNetworkError` on its own will silently stop matching aborted and
timed-out requests.

**3. Internal registries and autocomplete-only aliases are no longer named exports.**

The public surface now contains the runtime functions, error classes, and
consumer-facing types. Replace imports of the removed implementation details:

```typescript historical
// 0.x. Every name below was removed in 1.0 and cannot resolve against 1.x.
import {
  statusCodeErrorMap,
  httpErrors,
  type HttpErrors,
  type TypedHeaders,
  type StrictHeaders,
} from "@pbpeterson/typed-fetch";
```

Replace them with:

```typescript
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

[Unreleased]: https://github.com/pbpeterson/typed-fetch/compare/v2.1.0...HEAD
[2.1.0]: https://github.com/pbpeterson/typed-fetch/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/pbpeterson/typed-fetch/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/pbpeterson/typed-fetch/compare/v0.8.1...v1.0.0
