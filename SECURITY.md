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
  `toJSON()`, `toString()`, and the `util.inspect` hook. Node's
  fatal-exception printer renders `[cause]` on a crashing error and ignores
  every inspect hook, so an unhandled rejection or a `throw error` can print a
  password. Handle request failures as values, which is what this library
  returns them as, and do not copy `error.cause` into a log line.
- **A secret in a URL PATH SEGMENT survives in `error.url`.** The redactor
  drops userinfo, the query, and the fragment, and keeps the origin and path.
  Dropping the path would leave `url` unable to tell concurrent failures
  apart. An embedded url inside that path is not a path segment. A region
  opens where the URL Standard opens an authority: at two or more solidi
  under any scheme, and at a SPECIAL scheme (`http`, `https`, `ws`, `wss`,
  `ftp`, `file`) over any number of solidi, including none. A non-special
  scheme under fewer than two solidi is an opaque path and keeps its text.
  `error.url` never emits a byte the caller wrote after a `?` or a `#`, under
  any spelling. The one residual left is a credential whose LAST character is
  `/`. It stays open, because `://host/users/@alice` and `://token/@host`
  spell the same three characters, and no structural rule tells them apart.
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
