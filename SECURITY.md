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
  `ftp`, `file`) over any number of solidi, including none, and at two or
  more solidi with NO scheme in front of them, anywhere in the path, because
  a relative reference beginning with two solidi is protocol-relative. Where
  the parser CONSUMED the opening mark instead of leaving it in the text — a
  host-less origin's `scheme://` seam, and the path a protocol-relative
  reference leaves behind — the removed span is the parser's own answer and
  nothing wider.

  A region ends where the parser ends an authority it can read. A region
  whose start is not an authority the parser can read does not end at all.
  Inside a region, each `@` is asked, on its own, whether the text before it
  is userinfo, and the removed span is the union of the `@` marks that
  answer yes. The target path's trailing segments cannot decide whether the
  credential before them is removed, because each `@` is asked
  independently. A non-special scheme under fewer than two solidi is an
  opaque path and keeps its text.

  A relative answer never begins with two solidi. It is resolved until it
  stops moving, so `redactUrl` is a fixed point of itself.

  `error.url` never emits a byte the caller wrote after a `?` or a `#`,
  under any spelling. Two residuals are left, and neither can be told apart
  from an ordinary path by a structural rule. The first is a credential
  whose LAST character is `/`. It stays open, because
  `://host/users/@alice` and `://token/@host` spell the same three
  characters. The second is a credential holding a `://` behind text the
  parser reads as a host, such as `/go/https://YWxpY2U/cGFzc3dvcmQ://x@host`.
  It stays open for the same reason: `://host1/x://u2:pw@host2/v1` spells
  the same characters and must keep `host1`.

- **A percent-encoded scheme colon no longer shields a credential, and a
  percent-encoded `@` still does.** The scan that opens a region needs a
  LITERAL colon; a `%3A` is not one, so it no longer stops the bare-`//`
  rule from opening a region at the solidi that follow it:
  `https://api.test/go/https%3A//svc:SECRET@i.test/v1` redacts to
  `https://api.test/go/https%3A//i.test/v1`. The scan that ends userinfo
  needs a LITERAL `@`; a `%40` is not one, so it hides the credential it
  stands in for:
  `https://api.test/go/https://svc%3APW%40host/v1` keeps
  `svc%3APW%40host` in full. Only the second shape is open.
- **A non-special scheme under fewer than two solidi keeps its text.**
  `/go/git:/svc:pw@host` keeps `svc:pw@host` as an ordinary path, because the
  URL Standard reads a non-special scheme under fewer than two solidi as an
  opaque path with no authority: `new URL("git:/svc:pw@host").username` is
  the empty string. This narrowing is deliberate. It stops `/a:/b` from
  being read as an authority, and it also stops `/a:/b@c` from losing a path
  segment it must keep.
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
