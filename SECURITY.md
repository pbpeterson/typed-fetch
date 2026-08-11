# Security Policy

## Supported Versions

Only the latest published version of `@pbpeterson/typed-fetch` receives
security updates.

## Known residuals

These are deliberate limits, not defects. Each one is tested, so it stays a
known limit rather than a surprise. An entry struck through is one a later
release closed. It stays on this list, with the correction under it, so a reader
who meets the old claim somewhere else finds the answer here instead of the
claim again.

One rule decides membership, and it decides every entry below. A limit belongs
here when this library's own output can harm the reader who acts on it. Two
shapes reach that bar. In the first, a secret the caller wrote in a URL or a
header reaches a reader through a channel this library controls. In the second,
a value this library emits misleads that reader. A record that names a host the
request never contacted is one such value. A guard that accepts a forged brand
is another.

A limit whose whole cost is a diagnostic does not reach the bar, and this list
names none. Four such limits ship in the current package:

1. the 128-character bound on the origin's reason phrase;
2. the character filter on that phrase;
3. the over-redaction that `redactUrlInMessage` performs on a message;
4. the `%28` and `%29` escaping of a path inside a message.

Each one costs a detail a reader wants. None of them emits a value an attacker
wants. So an absence from this list is a decision, and a reader can test any
limit found in the source against the rule above.

- **~~A protocol-relative forward loses the authority it names.~~ CLOSED.** A
  url whose embedded authority sat behind a bare pair of solidi, with an
  ordinary `@` in a later path segment, used to lose that authority:
  `https://api.test/proxy///cdn.test:8443/img/@alice` emitted
  `https://api.test/proxy///alice`, which named `alice` and dropped
  `cdn.test:8443`. The colon rule fired because no scheme wrote the mark, so the
  suppression that keeps the authority behind `https://` did not apply. The cost
  was over-redaction and never a leaked credential: over 97,344 generated urls
  the shape covered 504 rows, of which 414 emitted a misleading record and none
  lost a secret.

  It is closed. A region opened by a bare pair of solidi now buys the parser's
  reading of the authority at its start, exactly as a region a scheme mark opens
  does, because a bare pair of solidi is how the URL Standard itself opens an
  authority. Over the same 97,344 urls the residue is 0 rows and the misleading
  records are 0, no secret was lost, and no row was made worse. The url above is
  a fixed point of the redactor now. What the closure costs is text a reader
  reads as a path segment behind the embedded authority, which the path-segment
  residual below already records: 1,266 rows of a 140,640-url population keep
  such a segment, and on none of them does the platform report a credential.
  `round18-h3-disclosure.spec.ts` and `round18-h2-response.spec.ts` pin the
  closure, and turn red if it reopens.

- **A credential can reach a crash dump through `error.cause`.** A platform
  quotes the URL it refused back in its own message, credentials included.
  Every channel this library controls redacts that value: `error.message`,
  `toJSON()`, `toString()`, and the `util.inspect` hook. Two channels carry
  `error.cause` out unredacted, because both are platform algorithms with no
  hook. Node's fatal-exception printer renders `[cause]` on a crashing error
  and ignores every inspect hook, so an unhandled rejection or a `throw error`
  can print a password. `structuredClone` copies `error.cause` unchanged.
  `postMessage` uses the same algorithm, so passing an error to either one
  sends the password into another realm. Handle request failures as values,
  which is what this library returns them as. Do not copy `error.cause` into
  a log line. Do not pass an error to `structuredClone` or `postMessage`
  without removing `cause` first.
- **A secret in a URL PATH SEGMENT survives in `error.url`.** The redactor
  drops userinfo, the query, and the fragment, and keeps the origin and path.
  Dropping the path would leave `url` unable to tell concurrent failures
  apart. An embedded url inside that path is not a path segment.

  A region opens where the URL Standard opens an authority: at two or more
  solidi under any scheme, at a SPECIAL scheme (`http`, `https`, `ws`, `wss`,
  `ftp`) over any number of solidi, including none, and at two or more
  solidi with NO scheme in front of them, anywhere in the path, because a
  relative reference beginning with two solidi is protocol-relative. `file:`
  is the one special scheme this rule excludes: the URL Standard gives it its
  own state, so a `file:` reference under fewer than two solidi is a path
  with an empty host, exactly as `git:/svc:pw@host` is, and keeps its text.

  Where the parser CONSUMED the opening mark instead of leaving it in the
  text, the removed span is the parser's SPLIT POINT. That point is the last
  `@` before the authority ends, never the `username` or `password` the
  parser reports. The parser normalizes an empty userinfo away:
  `new URL("https://:@x/").href` is `https://x/`. So a report of nothing is
  not proof there was nothing to remove. Three seams reach this rule: a
  host-less origin's `scheme://` seam, the path a protocol-relative
  reference leaves behind, and a reference whose scheme equals the
  resolution base's scheme, which the URL Standard resolves as a relative
  path with its scheme colon eaten.

  A region ends at the next `://`, and only where the parser reads a complete
  authority at the region's START. `parsesAsAuthority` decides whether that
  `://` is BELIEVED. It never reports where the authority finished, so a
  region runs PAST the embedded host it opened on. Where the parser cannot
  read an authority at the start, no `://` ends the region. A region with no
  `://` after it ends at the end of the text.
  Inside a region, each `@` is asked, on its own, whether the text before it
  is userinfo, and the removed span is the union of the `@` marks that
  answer yes. The target path's trailing segments cannot decide whether the
  credential before them is removed, because each `@` is asked
  independently. A non-special scheme under fewer than two solidi is an
  opaque path and keeps its text.

  A relative answer never begins with two solidi. The rebuild is a parse,
  and a parse removes a dot segment. Redacting an answer re-asks every
  question of the text the rebuild produced, not of what the previous
  answer left behind. The three questions are a region's `@` question, its
  END question, and the seam's own span. So `redactUrl` is a fixed point of
  itself: `redactUrl(redactUrl(u)) === redactUrl(u)`.

  `toJSON().url` never emits a byte the caller wrote after a `?` or a `#`,
  under any spelling. It is `redactUrl(this.url)`, and `redactUrl` never
  reads a query or a fragment.

  `error.message` holds that property only for a message this library
  writes. `classifyRequestFailure` is the single construction site, and it
  passes a library constant built from `redactUrl`. `NetworkError`'s
  message is public API, and a caller can pass a platform's own text
  instead. The constructor cleans that text with `redactUrlInMessage`, an
  exact-string replacement of the url the caller also supplied. The
  replacement is best effort: a message that quotes a different spelling of
  the same url finds no match. A stripped fragment, a normalized default
  port, and a case-folded host are three such spellings. The query or
  fragment byte in that spelling survives in `error.message`, and in
  `toJSON().message`, which is the record a structured logger writes. A
  PASSWORD THE PARSER READS AS USERINFO does not survive it. The url's own
  userinfo is removed in the spelling the caller wrote as well as in the
  spelling the parser writes, so a password holding a space, a non-ASCII
  letter, a reverse solidus under a scheme the URL Standard does not call
  special, or any other character the parser percent-encodes inside a
  userinfo goes even when the whole-url replacement finds no match. The
  qualifier is load-bearing: where the parser reads NO userinfo, this pass
  has nothing it can name as a credential. A `file:` url is the first such
  shape, because `file:` has no authority state and can carry no
  credentials; a url the parser rejects outright is the second. See
  `redactUrlInMessage`'s own comment for the full best-effort contract.

  `error.url` keeps every byte regardless, because it is the raw href — see
  the escape-hatch bullet below. Two residuals are left in what `redactUrl`
  itself withholds, reachable through `toJSON().url` and through any
  message this library writes. Neither can be told apart from an ordinary
  path by a structural rule.
  The first is a credential whose LAST character is `/`. It stays open,
  because `://host/users/@alice` and `://token/@host` spell the same three
  characters. The second is a credential holding a `://` behind text the
  parser reads as a host, such as `/go/https://YWxpY2U/cGFzc3dvcmQ://x@host`.
  It stays open for the same reason: `://host1/x://u2:pw@host2/v1` spells
  the same characters and must keep `host1`.

- **An embedded URL loses the authority the parser reads, when a later path
  segment holds an ordinary `@`.** The region opens at the embedded `://` and
  runs past the embedded host, because the region's end is the NEXT `://` and
  there is none. `looksLikeUserinfo` then reads the host and the segments
  after it as one credential, and the span takes the host with it.
  `https://api.test/proxy/https://cdn.test/img/alice@example.com/avatar.png`
  emits `https://api.test/proxy/https://example.com/avatar.png`. That record
  NAMES `example.com`, a host the request never contacted, and it drops
  `cdn.test`, the host the request did contact. The url is well formed, and
  `response.url` after a redirect is text the SERVER chose.

  It stays open because no structural rule separates it from a credential the
  suite requires this library to remove.
  `https://api.test/go/https://YWxpY2U/cGFzc3dvcmQ@internal.test/v1` spells
  the same characters in the same order, and its base64 credential must go.
  Ending a region at the authority the parser reads keeps 2,425 further
  planted credentials of 4,375 in the emitted url, up from 750.
  `tests/redaction/round16-h3-disclosure.spec.ts` pins the answer, so a change
  in either direction fails.

- **A percent-encoded delimiter is not a delimiter, for a scheme colon and
  for `@` alike.** The scan that opens a region needs a LITERAL colon, and
  the scan that ends userinfo needs a LITERAL `@`. A `%3A` and a `%40` are
  neither, so both still shield a credential at zero and one solidus:
  `https://api.test/go/https%3A/svc:SECRET@i.test/v1` and
  `https://api.test/go/https%3Asvc:SECRET@i.test/v1` keep `svc:SECRET@` in
  full, and `https://api.test/go/https://svc%3APW%40host/v1` keeps
  `svc%3APW%40host` in full. The two-solidus spelling,
  `https://api.test/go/https%3A//svc:SECRET@i.test/v1`, DOES redact to
  `https://api.test/go/https%3A//i.test/v1` — but not because the colon
  opened anything. Its LITERAL `//` opens a region under the bare-`//` rule,
  which fires whatever text precedes it: swapping `https%3A` for `zz%3A` in
  that url redacts the same way. Opening a region on a percent-decoded copy
  of the text would be the first rule in this module that fires where no
  parser opens an authority — the same defect rounds 5, 8, and 9 each found
  under a different name: two texts the parser does not agree about. All
  three spellings THROW as a standalone url
  (`new URL("https%3A/svc:pw@i.test/v1")` is Invalid URL).
- **A non-special scheme, or `file:`, under fewer than two solidi keeps its
  text.** `/go/git:/svc:pw@host` keeps `svc:pw@host` as an ordinary path,
  because the URL Standard reads a non-special scheme under fewer than two
  solidi as an opaque path with no authority: `new URL("git:/svc:pw@host").username`
  is the empty string. `file:` is a special scheme that keeps the same shape
  under the same count, for the reason residual 2 above states. This
  narrowing is deliberate. It stops `/a:/b` from being read as an authority,
  and it also stops `/a:/b@c` from losing a path segment it must keep.
- **A `file:` path whose FIRST segment holds a colon that is not a Windows
  drive letter, and whose later text holds an `@`, loses everything up to
  that `@`.** `file:///a:b/c/mail@example.com/x` emits
  `file:///example.com/x`. The emitted record is a path the request never
  used, and its only remaining segments are text taken from the far side of
  an `@`. It is the price of reading a solidus the parser folded out of a
  `\` as part of the authority: `file:` is special, so the parser has
  already turned `file:///svc:hun\ter2@api.test/v1` into
  `file:///svc:hun/ter2@api.test/v1` before the seam sees it, the authority
  therefore appears to end inside the password, and the seam cannot tell
  that solidus from one the caller typed. Falling back to the path's last
  `@` is what withholds the credential, and over-redaction is the safe
  direction. The fallback is asked only where the first segment's colon is
  not a drive letter, so `file:///c:/Users/alice@corp/report.pdf` and
  `file:///C:/c/mail@example.com/x` keep every byte, and a colon in any
  later segment is not read at all:
  `file:///a/b:c/mail@example.com/x` is a fixed point.
  `tests/redaction/round20-h3-disclosure.spec.ts` pins both sides.
- **`error.url` and `error.headers` hold the raw values.** They are the escape
  hatches, non-enumerable so no structured logger reaches them by accident.
- **A forged brand passes a type guard.** The guards answer "does this claim to
  be one of ours?", which is what makes them work across package copies. See
  `docs/adr/0003-the-untrusted-fetch-conformance-boundary.md`.

## Reporting a Vulnerability

Report a vulnerability privately through
[GitHub Security Advisories](https://github.com/pbpeterson/typed-fetch/security/advisories/new),
or by email to petersonbozza7@gmail.com. Use whichever channel you can reach.

A report through GitHub Security Advisories creates a private draft advisory,
and release-checklist step 9 adds the fixed version to that draft. A report by
email creates no draft, so step 9 opens one before it publishes. Neither
channel is preferred, and neither changes what you can expect.

Do not open a public issue for a security report. You can expect an initial
response within a few days.
