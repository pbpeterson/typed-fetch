import { describe, test, expect } from "vitest";
import { redactUrl, redactUrlInMessage } from "./src/errors/redact-url";
import { AbortedError, NetworkError, NotFoundError, TimeoutError } from "./src/errors";

describe("redactUrl — structure is kept, every value slot is dropped", () => {
  test("the query goes, origin and path stay", () => {
    expect(redactUrl("https://api.test/v1/things?access_token=SECRET")).toBe(
      "https://api.test/v1/things",
    );
    expect(redactUrl("https://api.test/v1/things?a=1&b=2")).toBe("https://api.test/v1/things");
  });

  test("userinfo goes, including the password", () => {
    expect(redactUrl("http://alice:hunter2@api.test/x")).toBe("http://api.test/x");
    expect(redactUrl("http://alice@api.test/x")).toBe("http://api.test/x");
  });

  test("the fragment goes", () => {
    expect(redactUrl("https://api.test/x#SECRET")).toBe("https://api.test/x");
  });

  test("a URL with nothing to redact is returned unchanged", () => {
    expect(redactUrl("https://api.test/v1/things")).toBe("https://api.test/v1/things");
  });

  test("the port survives — it is structure", () => {
    expect(redactUrl("https://api.test:8443/x?t=SECRET")).toBe("https://api.test:8443/x");
  });

  test("a hierarchical non-http scheme keeps its path", () => {
    expect(redactUrl("file:///var/log/app.log?t=SECRET")).toBe("file:///var/log/app.log");
    expect(redactUrl("ws://api.test/socket?token=SECRET")).toBe("ws://api.test/socket");
  });

  // An opaque scheme carries its payload in the path, so the "path is
  // structure" trade does not hold and there is nothing left to keep.
  test("an opaque scheme is reduced to the scheme — the payload IS the path", () => {
    expect(redactUrl("data:text/plain,SECRET_TOKEN")).toBe("data:");
    expect(redactUrl("data:application/json;base64,U0VDUkVU")).toBe("data:");
    expect(redactUrl("blob:https://api.test/9f8c-4a1e-b7d2")).toBe("blob:");
  });

  test("a relative URL keeps its path — ordinary in a browser or worker", () => {
    expect(redactUrl("/v1/things?access_token=SECRET")).toBe("/v1/things");
    expect(redactUrl("v1/things?access_token=SECRET")).toBe("/v1/things");
  });

  test("the empty string stays empty — the documented no-URL value", () => {
    expect(redactUrl("")).toBe("");
  });

  test("a value that is not a URL is emitted as a path, never as a raw string", () => {
    // It cannot be parsed as absolute, so it is treated as a relative path:
    // percent-encoded, and with any query or fragment still stripped.
    expect(redactUrl("not a url at all")).toBe("/not%20a%20url%20at%20all");
    expect(redactUrl("garbage?token=SECRET")).toBe("/garbage");
  });

  // A malformed scheme keeps the parser from seeing an authority, so the
  // userinfo lands inside the path the relative fallback emits. Userinfo is
  // unconditionally a value, so it goes even when it is wearing a path.
  test("a malformed scheme does not smuggle userinfo into the emitted path", () => {
    expect(redactUrl("://svc:hunter2@internal.test/v1/things")).toBe("/://internal.test/v1/things");
    expect(redactUrl("http s://svc:hunter2@internal.test/v1/things")).toBe(
      "/http%20s://internal.test/v1/things",
    );
    expect(redactUrl("1http://svc:hunter2@internal.test/v1/things")).toBe(
      "/1http://internal.test/v1/things",
    );
  });

  // An `@` outside an authority names something. Removing it would cost the
  // diagnostic and buy nothing: there is no credential slot there.
  test("an ordinary `@` in a path survives — it is structure, not userinfo", () => {
    expect(redactUrl("/@scope/pkg/-/pkg-1.0.0.tgz")).toBe("/@scope/pkg/-/pkg-1.0.0.tgz");
    expect(redactUrl("/users/@alice/posts")).toBe("/users/@alice/posts");
  });

  // Scanning one authority and giving up left a credential in the second. This
  // needs no malformed scheme: a forward or callback URL is the ordinary shape,
  // and it is the shape that carries credentials in the first place.
  test("EVERY embedded authority loses its userinfo, not just the first", () => {
    expect(redactUrl("/go/http://plain.test/then/https://svc:hunter2@internal.test/v1")).toBe(
      "/go/http://plain.test/then/https://internal.test/v1",
    );
    expect(redactUrl("://host1/x://u2:hunter2@host2/v1")).toBe("/://host1/x://host2/v1");
    expect(redactUrl("://a:pw1@h1/x://b:pw2@h2/v1")).toBe("/://h1/x://h2/v1");
  });

  // A delimiter-terminated authority let the PASSWORD choose where the
  // authority stopped. The parser rewrites `\` to `/` before this scan runs, so
  // the region ended inside the credential and emitted the whole thing.
  test("a delimiter inside the credential does not end the authority early", () => {
    for (const url of [
      "://svc:hun\\ter2@internal.test/v1",
      "://svc:hun/ter2@internal.test/v1",
      "://svc:hun?ter2@internal.test/v1",
      "://svc:hun#ter2@internal.test/v1",
    ]) {
      expect(redactUrl(url), url).not.toContain("hun");
    }
  });

  // The region is wide, so each `@` is asked whether what precedes it is a
  // credential or a path. No `/` at all is the username-only form a bearer URL
  // carries; a `:` before the first `/` is `user:password`, the shape whose
  // password can hold the delimiter that used to end the scan early.
  test("a path with an `@` after a `://` keeps every segment it names", () => {
    expect(redactUrl("://api.test/users/@alice")).toBe("/://api.test/users/@alice");
    expect(redactUrl("://host/path/@alice")).toBe("/://host/path/@alice");
  });

  test("a username-only credential is still removed", () => {
    expect(redactUrl("://token@internal.test/v1")).toBe("/://internal.test/v1");
  });

  // A path spells an `@` at the HEAD of a segment; a credential runs right up
  // to it. That is what separates a standard-base64 token — whose alphabet
  // includes `/`, so the slash-and-colon rules alone read it as a path — from
  // an authority with a port followed by a path `@`.
  test("a base64 credential containing a slash is still removed", () => {
    expect(redactUrl("://YWxpY2U/cGFzc3dvcmQ@internal.test/v1")).toBe("/://internal.test/v1");
  });

  // Both remaining residuals are over-redaction — the safe direction. Neither
  // can be resolved once a malformed scheme has taken away where the authority
  // ends: `a:1234` is indistinguishable from `user:password`, and an
  // e-mail-shaped path segment is indistinguishable from a credential.
  test.each([
    ["an authority with a port plus a path `@`", "://a:1234/x/@bob", "/://bob"],
    ["an `@` inside a path segment", "://host/a/b@c/d", "/://c/d"],
  ])("RESIDUAL: %s is over-redacted", (_label, url, expected) => {
    expect(redactUrl(url)).toBe(expected);
  });

  // The path of a WELL-FORMED url can embed another url, credential and all.
  // `stripValues` clears only this url's own value slots, so the absolute
  // branch returned the href and never looked — the relative branch had been
  // scanning for exactly this shape since the embedded-credential fix.
  test("an absolute URL whose path embeds a credentialed URL is redacted too", () => {
    expect(redactUrl("https://api.test/go/https://svc:hunter2@internal.test/v1")).toBe(
      "https://api.test/go/https://internal.test/v1",
    );
    // The port of the real authority is not read as userinfo: the scan runs
    // over the pathname, never the href.
    expect(redactUrl("https://api.test:8443/go/https://svc:pw@internal.test/v1")).toBe(
      "https://api.test:8443/go/https://internal.test/v1",
    );
  });

  // The scan runs once per call over each region, and `redactUrl` runs it
  // twice. Walking back from the end of every region made it quadratic in the
  // number of marks: 96 KB took 855 ms.
  test("the scan stays linear on an input of repeated `://` marks", () => {
    const hostile = "://".repeat(32_000);
    const started = performance.now();

    redactUrl(hostile);

    expect(performance.now() - started).toBeLessThan(100);
  });

  // Removing the userinfo must not make an invalid URL resolvable: these are
  // parse errors, and a parse error is the documented no-URL value.
  test("a URL the parser refuses still collapses to the no-URL value", () => {
    expect(redactUrl("http://alice:hunter2@/v1")).toBe("");
    expect(redactUrl("file://alice:hunter2@host/v1")).toBe("");
  });

  test("RESIDUAL: a secret in a PATH SEGMENT survives, by design", () => {
    // Dropping the path would leave `url` at the origin, which destroys the
    // only thing the field exists for: telling concurrent failures apart.
    expect(redactUrl("https://api.test/reset/RESET_TOKEN")).toContain("RESET_TOKEN");
  });
});

describe("redactUrlInMessage — a URL we already hold, removed from a foreign message", () => {
  test("undici's credential TypeError loses the password", () => {
    const url = "http://alice:hunter2@api.test/v1/things";
    const message = `Request cannot be constructed from a URL that includes credentials: ${url}`;

    const redacted = redactUrlInMessage(message, url);

    expect(redacted).not.toContain("hunter2");
    expect(redacted).toBe(
      "Request cannot be constructed from a URL that includes credentials: " +
        "http://api.test/v1/things",
    );
  });

  test("a query token in a message is replaced too", () => {
    const url = "https://api.test/x?access_token=SECRET";
    expect(redactUrlInMessage(`failed for ${url}`, url)).toBe("failed for https://api.test/x");
  });

  test("userinfo is removed even when the platform re-serialized the href", () => {
    // The exact-href replacement misses, so the second pass has to catch it.
    const message = "connect failed: http://alice:hunter2@api.test:80/v1/things";
    const redacted = redactUrlInMessage(message, "http://alice:hunter2@api.test/v1/things");

    expect(redacted).not.toContain("hunter2");
  });

  // `userinfoOf` has three shapes and the suite only ever exercised one. Both
  // halves of its guard and both arms of its ternary were free to be wrong: a
  // password-only credential could return `""` (no second pass at all) and a
  // username-only one could return `alice:@` (a needle that matches nothing).
  // Either way the credential survives whenever the platform re-serialized the
  // href, which is the case the second pass exists for.
  test.each([
    ["both halves", "http://alice:hunter2@api.test/v1", "hunter2"],
    ["a password only", "http://:hunter2@api.test/v1", "hunter2"],
    ["a username only", "http://alice@api.test/v1", "alice"],
  ])("userinfo with %s is removed from a re-serialized message", (_label, url, secret) => {
    // undici adds the default port, so the exact-href pass misses and only the
    // userinfo pass can catch this.
    const message = `connect failed: ${url.replace("api.test", "api.test:80")}`;

    expect(redactUrlInMessage(message, url)).not.toContain(secret);
  });

  // `userinfoOf` parses absolutely, so a malformed scheme used to hide the
  // credential from the second pass as well as from the first.
  test("userinfo is removed even when the scheme is too malformed to parse", () => {
    const url = "://svc:hunter2@internal.test/v1/things";
    const message = `connect failed: ${url.replace("internal.test", "internal.test:80")}`;

    expect(redactUrlInMessage(message, url)).not.toContain("hunter2");
  });

  // `"@"` alone is not a credential, and it is the one needle that must never
  // reach `replaceAll`. `://@host/x` yields a span of exactly one character,
  // and stripping every `@` from a message deletes e-mail addresses, handles,
  // and anything else the diagnostic was carrying. The parsed branch has always
  // refused an empty userinfo for the same reason.
  test("an empty userinfo does not strip every `@` from the message", () => {
    const url = "://@host/x";
    const message = `delivery to ops@corp.test failed for ${url}`;

    expect(redactUrlInMessage(message, url)).toContain("ops@corp.test");
  });

  test("a real userinfo in the same shape is still removed", () => {
    const url = "://svc:hunter2@host/x";
    const message = `delivery to ops@corp.test failed for ${url.replace("host", "host:80")}`;

    const redacted = redactUrlInMessage(message, url);
    expect(redacted).not.toContain("hunter2");
    expect(redacted).toContain("ops@corp.test");
  });

  test("a message that does not mention the URL is untouched", () => {
    expect(redactUrlInMessage("fetch failed", "https://api.test/x?t=SECRET")).toBe("fetch failed");
  });

  test("a relative URL carries no userinfo, so the message keeps its path", () => {
    // `userinfoOf` parses the url ABSOLUTELY and returns "" when that throws.
    // A relative URL — `fetch("/v1/things")` is ordinary in a browser — always
    // takes that path, and it is also the case where the first pass is a no-op
    // (`redactUrl("/v1/things")` is `/v1/things`), so the second pass acts on
    // an untouched message. Returning the url from that catch instead of ""
    // would strike the whole path out of the very message it is meant to keep
    // readable, and nothing failed.
    expect(redactUrlInMessage("Failed to fetch /v1/things", "/v1/things")).toBe(
      "Failed to fetch /v1/things",
    );
  });

  test("no URL to redact leaves the message alone", () => {
    expect(redactUrlInMessage("fetch failed", "")).toBe("fetch failed");
  });

  // `replaceAll` has no notion of how distinctive its needle is, and the needle
  // here is the caller's url — which can be one character. The pass fired for a
  // relative url whose redacted form differed by NORMALIZATION alone, and
  // rewrote the platform's own wording: `typedFetch("a")` produced
  // `F/ailed to p/arse URL from /a`.
  //
  // The earlier relative-url case used `/v1/things`, where the redacted form is
  // identical and the pass is a no-op — the one shape that dodges this.
  test.each([
    ["a", "Failed to parse URL from a", "Failed to parse URL from a"],
    ["from", "Failed to parse URL from from", "Failed to parse URL from from"],
    ["URL", "Failed to parse URL from URL", "Failed to parse URL from URL"],
  ])(
    "a relative url with nothing to redact (%s) leaves the wording alone",
    (url, message, want) => {
      expect(redactUrlInMessage(message, url)).toBe(want);
    },
  );

  test.each([
    ["a query", "/v1/things?token=SECRET", "/v1/things"],
    ["a fragment", "/v1/things#SECRET", "/v1/things"],
  ])("a relative url carrying %s is still redacted", (_label, url, want) => {
    expect(redactUrlInMessage(`Failed to fetch ${url}`, url)).toBe(`Failed to fetch ${want}`);
  });

  test("a `$` in the path is not treated as a replacement pattern", () => {
    // `String.replaceAll` with a STRING replacement interprets `$&`, `$'`, …;
    // this uses a function replacer, so a `$` survives literally.
    //
    // The pattern has to be a REAL one. `$b` is not special to `replaceAll`, so
    // a version of this test using it passed just as well with a string
    // replacement — it proved nothing. `$&` is the whole match, so a string
    // replacement would reinsert the full unredacted url, secret and all.
    const url = "https://api.test/a$&b/c?t=SECRET";
    const redacted = redactUrlInMessage(`at ${url}`, url);

    expect(redacted).toBe("at https://api.test/a$&b/c");
    expect(redacted).not.toContain("SECRET");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ROUND 4 — the userinfo pass and the path scan
//
// Round 3 fixed one channel per commit. These cases ask what the SIBLING
// channel of each fix does, which is where rounds 2 and 3 both found their
// defects.
// ═══════════════════════════════════════════════════════════════════════════

describe("D1 — the userinfo pass in a message never scans an absolute url's path", () => {
  // A forward URL carrying an inner, credentialed URL in its path: the exact
  // shape `da46b4f` named.
  const forwardUrl = "https://api.test/go/https://svc:hunter2@internal.test/v1";
  // A platform message that names only the INNER url. undici reports the
  // redirect target it refuses, not the URL the caller typed:
  // `TypeError: Request cannot be constructed from a URL that includes
  // credentials: https://svc:hunter2@internal.test/v1`.
  const platformMessage =
    "Request cannot be constructed from a URL that includes credentials: " +
    "https://svc:hunter2@internal.test/v1";

  test("CONTROL — redactUrl itself removes the embedded credential", () => {
    expect(redactUrl(forwardUrl)).toBe("https://api.test/go/https://internal.test/v1");
  });

  test("CONTROL — the MALFORMED sibling IS scrubbed by the userinfo pass", () => {
    const malformed = "://api.test/go/https://svc:hunter2@internal.test/v1";
    expect(redactUrlInMessage(platformMessage, malformed)).not.toContain("hunter2");
  });

  test("the ABSOLUTE sibling keeps the password in the message", () => {
    expect(redactUrlInMessage(platformMessage, forwardUrl)).not.toContain("hunter2");
  });

  test("and it reaches NetworkError.message and the toJSON record", () => {
    const error = new NetworkError(platformMessage, { url: forwardUrl });
    expect(error.message).not.toContain("hunter2");
    expect(JSON.stringify(error)).not.toContain("hunter2");
  });
});

describe("the residual a trailing slash leaves open", () => {
  test("CONTROL — the shape the rule was added for is redacted", () => {
    expect(redactUrl("://YWxpY2U/cGFzc3dvcmQ@internal.test/v1")).not.toContain("cGFzc3dvcmQ");
  });

  // STATED, not fixed. `://host/users/@alice` and `://token/@host` spell the
  // same three characters, so no structural rule separates them, and reading
  // both as userinfo would delete a named segment from every diagnostic. The
  // JSDoc on `looksLikeUserinfo` carries the reasoning; this pins the
  // behaviour so a future change to that rule is a deliberate one.
  test("a token whose last character is a slash is read as a path", () => {
    expect(redactUrl("://dG9rZW4vcGFzc3dvcmQ/@internal.test/v1")).toBe(
      "/://dG9rZW4vcGFzc3dvcmQ/@internal.test/v1",
    );
  });
});

describe("C4 — redactUrl's absolute pathname scan (da46b4f) keeps ordinary paths", () => {
  test("an embedded credential in a well-formed path goes", () => {
    expect(redactUrl("https://api.test/go/https://svc:pw@internal.test/v1")).toBe(
      "https://api.test/go/https://internal.test/v1",
    );
  });

  test("an ordinary @-headed segment survives", () => {
    expect(redactUrl("https://api.test/users/@alice")).toBe("https://api.test/users/@alice");
    expect(redactUrl("https://api.test/go/https://cdn.test/users/@alice")).toBe(
      "https://api.test/go/https://cdn.test/users/@alice",
    );
  });

  test("the port of THIS url is never read as userinfo", () => {
    expect(redactUrl("https://api.test:8443/users/@alice")).toBe(
      "https://api.test:8443/users/@alice",
    );
  });

  test("a second embedded authority is scanned, not only the first", () => {
    expect(
      redactUrl("https://api.test/a/http://x:1@b.test/c/https://svc:hunter2@internal.test/v1"),
    ).not.toContain("hunter2");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ROUND 4 — the values Deno and Bun answered with.
//
// The ledger's "Other runtimes" entry was measured on Deno 1.46.3, BEFORE the
// reason-phrase filter, the absolute-path userinfo scan, and the message
// layout's escaping existed. Round 4 re-ran all three on Deno 2.9.5 and Bun
// 1.3.13 against `dist/index.mjs`, and every case below produced the SAME
// string on all three runtimes. They are pinned here as the Node side of that
// comparison, so a future divergence shows up as a plain failure.
//
// One runtime fact came out of it and belongs with the cases: Deno's client
// DISCARDS the origin's reason phrase and substitutes the canonical one, so
// the filter has nothing to filter there. Bun exercises it fully and answers
// exactly as Node does.
// ═══════════════════════════════════════════════════════════════════════════

describe("control — redaction of an embedded credential", () => {
  test.each([
    [
      "an absolute url whose PATH embeds a credentialed url",
      "https://api.test/go/https://svc:pw@internal.test/v1",
      "https://api.test/go/https://internal.test/v1",
    ],
    [
      "two embedded urls, only the credentialed one loses its userinfo",
      "https://api.test/go/http://plain.test/then/https://svc:hunter2@internal.test/v1",
      "https://api.test/go/http://plain.test/then/https://internal.test/v1",
    ],
    ["a malformed authority", "://svc:hunter2@internal.test/v1", "/://internal.test/v1"],
    ["a password holding the old scan terminator", "://svc:hun?ter2@host/v1", "/://host/v1"],
    ["an empty userinfo keeps the host", "://@host/x", "/://host/x"],
    ["a standard-base64 token", "://YWxpY2U/cGFzc3dvcmQ@host/v1", "/://host/v1"],
    ["an opaque url keeps only its scheme", "data:text/plain,secret", "data:"],
  ])("%s", (_id, url, redacted) => {
    const error = new NetworkError("Network error", { url });
    expect(error.message).toBe("Network error");
    expect(error.url).toBe(url);
    expect(JSON.parse(JSON.stringify(error)).url).toBe(redacted);
  });

  test("the userinfo pass removes a credential the platform quoted back", () => {
    const url = "https://alice:hunter2@api.test/v1";
    const error = new NetworkError(`Request cannot be constructed from a URL: ${url}`, { url });
    expect(error.message).not.toContain("hunter2");
    expect(error.message).toBe("Request cannot be constructed from a URL: https://api.test/v1");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ROUND 5 — the scan reads the raw text, the parser emits a normalized path.
//
// The absolute branch has read the normalized `pathname` since the
// embedded-credential fix. The relative branch, and `userinfosOf`'s malformed
// branch, still read the raw string — so a shape whose authority mark the
// PARSER creates escaped both of them.
// ═══════════════════════════════════════════════════════════════════════════
// ───────────────────────────────────────────────────────────────────────────
// DEFECT 1 (RESIDUAL) — the scan runs on the RAW string, the parser emits a
// NORMALIZED path. A backslash pair, or a stripped tab/CR/LF, spells an
// authority the raw text never contained, so `malformedUserinfoSpans(url)`
// finds nothing and `redactUrl` emits the credential verbatim.
// ───────────────────────────────────────────────────────────────────────────
describe("a credential the parser normalizes into the path", () => {
  // The literal string is: /go/https:\\svc:hunter2@internal.test/v1
  const backslashUrl = "/go/https:\\\\svc:hunter2@internal.test/v1";
  // The literal string is: /go/https:<TAB>//svc:hunter2@internal.test/v1
  const tabUrl = "/go/https:\t//svc:hunter2@internal.test/v1";

  test("the parser really does normalize both shapes into an authority", () => {
    // Not an assertion about this library — an assertion about the platform,
    // so the two tests below cannot be read as a mistake about the input.
    expect(new URL(backslashUrl, "http://url.invalid").pathname).toBe(
      "/go/https://svc:hunter2@internal.test/v1",
    );
    expect(new URL(tabUrl, "http://url.invalid").pathname).toBe(
      "/go/https://svc:hunter2@internal.test/v1",
    );
    expect(backslashUrl.includes("://")).toBe(false);
    expect(tabUrl.includes("://")).toBe(false);
  });

  test("redactUrl keeps the password", () => {
    expect(redactUrl(backslashUrl)).not.toContain("hunter2");
    expect(redactUrl(tabUrl)).not.toContain("hunter2");
  });

  test("the password reaches toJSON().url, the record a logger ships off-box", () => {
    const error = new NetworkError("Network error", { url: backslashUrl });
    expect(error.toJSON().url).not.toContain("hunter2");
    expect(JSON.stringify(error)).not.toContain("hunter2");
  });

  test("the password reaches message on all three pre-response classes", () => {
    const platformMessage = `Request cannot be constructed from a URL that includes credentials: ${backslashUrl}`;
    expect(new NetworkError(platformMessage, { url: backslashUrl }).message).not.toContain(
      "hunter2",
    );
    expect(new AbortedError(platformMessage, { url: backslashUrl }).message).not.toContain(
      "hunter2",
    );
    expect(new TimeoutError(platformMessage, { url: backslashUrl }).message).not.toContain(
      "hunter2",
    );
  });

  test("an HTTP error built from a response reporting that url leaks it too", async () => {
    const body = new Response("{}", { status: 404 });
    Object.defineProperty(body, "url", { value: backslashUrl, configurable: true });
    const error = new NotFoundError(body);
    try {
      expect(error.message).not.toContain("hunter2");
      expect(error.toJSON().url).not.toContain("hunter2");
    } finally {
      await error.cancel();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ROUND 5 — one pass over the message, not one pass per needle.
//
// The needle list grows with the credentials the caller's url embeds, and a
// `replaceAll` per needle read the whole message once for each of them. The
// single pass below has two states a chained `replaceAll` never had — two
// needles of the same length, and an `@` whose candidate reaches back into a
// span this pass already removed — so both are pinned here against the
// behaviour the chained version produced for the same input.
// ═══════════════════════════════════════════════════════════════════════════

describe("removing every userinfo in one pass", () => {
  test("two credentials of the same length are both removed", () => {
    expect(redactUrlInMessage("refused aa:bb@x and cc:dd@y", "://aa:bb@x/://cc:dd@y/")).toBe(
      "refused x and y",
    );
  });

  test("a candidate that reaches back into a removed span is skipped, not applied", () => {
    // The needles are `q@` and `@w@`. At the second `@`, the three-character
    // candidate starts inside the span the first removal already took, so the
    // pass declines it — which is what the chained version did by having
    // nothing left to match.
    expect(redactUrlInMessage("X q@w@ Y", "://q@x/://@w@host/")).toBe("X w@ Y");
  });

  test("a message with no userinfo needle is returned unchanged", () => {
    expect(redactUrlInMessage("plain diagnostic with an @ in it", "https://api.test/x")).toBe(
      "plain diagnostic with an @ in it",
    );
  });
});
