# Security Policy

## Supported Versions

Only the latest published version of `@pbpeterson/typed-fetch` receives
security updates.

## Known residuals

These are deliberate limits, not defects. Each one is tested, so it stays a
known limit rather than a surprise.

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

  A region ends where the parser ends an authority it can read. A region
  whose start is not an authority the parser can read does not end at all.
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
  `toJSON().message`, which is the record a structured logger writes. See
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
- **`error.url` and `error.headers` hold the raw values.** They are the escape
  hatches, non-enumerable so no structured logger reaches them by accident.
- **A forged brand passes a type guard.** The guards answer "does this claim to
  be one of ours?", which is what makes them work across package copies. See
  `docs/adr/0003-the-untrusted-fetch-conformance-boundary.md`.

## Reporting a Vulnerability

Please report vulnerabilities privately via
[GitHub Security Advisories](https://github.com/pbpeterson/typed-fetch/security/advisories/new)
or by email to petersonbozza7@gmail.com.

Do not open a public issue for security reports. You can expect an initial
response within a few days.
