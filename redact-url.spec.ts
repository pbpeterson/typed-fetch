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

  test("overlapping needles are merged, so neither one leaves a tail", () => {
    // The needles are `q@` and `@w@`, and the second starts inside the first's
    // match. Chained `replaceAll` removed `q@` and then found nothing left of
    // `@w@` to match, so it kept `w@` — which is userinfo the url really
    // carries. The union removes the whole run.
    expect(redactUrlInMessage("X q@w@ Y", "://q@x/://@w@host/")).toBe("X  Y");
  });

  test("a needle whose match ends inside a longer needle does not truncate it", () => {
    // The regression this replaced: `userinfosOf` yields the LONG needle first
    // for a path with two authorities, the short one matched at an earlier
    // `@`, and the long one was then skipped — leaving its tail, the password,
    // in the message.
    const url =
      "https://api.test/go/https://alice@sso.test/svc:hunter2@internal.test/v1" +
      "/next/https://alice@cdn.test/";
    const message =
      "Request cannot be constructed from a URL that includes credentials: " +
      "https://alice@sso.test/svc:hunter2@internal.test/v1";

    expect(redactUrlInMessage(message, url)).not.toContain("hunter2");
  });

  test("a needle longer than the text before an at sign cannot match", () => {
    // The candidate would start before index 0. It is declined rather than
    // sliced from a negative index, which would silently match a suffix.
    expect(redactUrlInMessage("@x", "://verylongcredential@host/")).toBe("@x");
  });

  test("a match wholly inside an earlier removal is absorbed by it", () => {
    // The needles are `pq@r@` and `q@`. Sorted by start, the long one comes
    // first and covers the short one entirely, so the short one adds nothing.
    expect(redactUrlInMessage("X pq@r@ Y", "://pq@r@host/://q@x/")).toBe("X  Y");
  });

  test("a message with no userinfo needle is returned unchanged", () => {
    expect(redactUrlInMessage("plain diagnostic with an @ in it", "https://api.test/x")).toBe(
      "plain diagnostic with an @ in it",
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
// DEFECT 3 (RESIDUAL, LOW) — the round-4 pathname scan has a sibling slot it
// still does not read. `redactUrl` drops the query and the fragment, so
// scanning them costs nothing and cannot misread a port as userinfo — the one
// reason the comment gives for reading `pathname` instead of `href`.
// ───────────────────────────────────────────────────────────────────────────
describe("a credential the url hides in its query or its fragment", () => {
  test("a credential in the query survives in a message that quotes it", () => {
    const url = "https://api.test/cb?next=https://svc:hunter2@internal.test/v1";
    const message =
      "Failed to fetch https://api.test/cb (next=https://svc:hunter2@internal.test/v1)";
    expect(redactUrlInMessage(message, url)).not.toContain("hunter2");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. `redact-url` — the three round-4 rules nothing pinned.
// ═══════════════════════════════════════════════════════════════════════════

describe("redact-url — the round-4 rules the suite left undefended", () => {
  // `malformedUserinfoSpans` walks its region forward and keeps the LAST `@`
  // it sees. Taking the FIRST one instead survived the whole suite, and it
  // leaks: the authority ends mid-password and the tail of the credential
  // rides out inside the emitted path. This is the same class of case the
  // module already pins for `\` and `?` inside a credential — an `@` inside
  // one had no test.
  test("an `@` inside the credential does not end the authority early", () => {
    const url = "://svc:hun@ter2@internal.test/v1";

    expect(redactUrl(url)).toBe("/://internal.test/v1");
    expect(redactUrl(url)).not.toContain("hun");
    expect(redactUrl(url)).not.toContain("ter2");
    expect(redactUrlInMessage(`cannot fetch ${url}`, url)).toBe(
      "cannot fetch /://internal.test/v1",
    );
  });

  // `userinfosOf` reads `parsed.pathname`, never `parsed.href`, and states why:
  // "the authority this URL really has is `host:8443`, and a scan over the href
  // would read that port as userinfo". `redactUrl`'s copy of that claim has a
  // test ("the port of THIS url is never read as userinfo"); `userinfosOf`'s
  // did not, and scanning the href there survived the suite — it deletes the
  // host and the whole path prefix from the diagnostic.
  test("the userinfo pass reads the pathname, so this url's port is not userinfo", () => {
    const url = "https://host:8443/users/@alice";

    // Nothing to redact: no userinfo, no query, no fragment. The message must
    // come back byte-identical.
    expect(redactUrlInMessage(`refused ${url}`, url)).toBe(`refused ${url}`);
    expect(redactUrlInMessage(`refused ${url}`, url)).toContain("host:8443");
  });

  // `hiddenUserinfos` filters `userinfo.length > 1`, and the bound is exact:
  // length 1 is the bare `@` that must never reach `replaceAll`, and length 2
  // is a one-character credential that must. Only the lower side had a test, so
  // tightening the filter to `> 2` survived.
  test("a one-character credential is still removed from a re-serialized message", () => {
    // The platform quoted the authority without the scheme marks, so the
    // whole-url replacement misses and only the userinfo pass can reach it.
    expect(redactUrlInMessage("cannot fetch a@host/x", "://a@host/x")).toBe("cannot fetch host/x");
    // CONTROL, the side that was already pinned: a bare `@` is not a needle.
    expect(redactUrlInMessage("mail alice@example.test", "://@host/x")).toBe(
      "mail alice@example.test",
    );
  });

  // `hasRedactableSlot`'s fallback names three slots a relative url can spell.
  // `?` and `#` each have a test; `@` did not, and dropping it survived.
  test("a relative url whose only redactable slot is an `@` is still rewritten", () => {
    const url = "://svc:hunter2@internal.test/v1";

    expect(redactUrlInMessage(`refused ${url}`, url)).toBe("refused /://internal.test/v1");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// DEFECT 2 (REGRESSION) — round 4 made `userinfosOf` scan `parsed.pathname` of
// a WELL-FORMED url and feed every span to `message.replaceAll(needle, "")`.
// A path that embeds another URL and spells an `@` inside a segment produces a
// needle that is not a credential, and the message loses it.
// ───────────────────────────────────────────────────────────────────────────
describe("the diagnostic a path-derived needle costs", () => {
  test("an e-mail-shaped segment in an embedded URL is cut out of the diagnostic", () => {
    const url = "https://api.test/avatar/https://gravatar.test/u/alice@example.com";
    const message = "Timed out contacting gravatar.test/u/alice@example.com via the avatar proxy";
    // STATED, not fixed: the needle is removed wherever it appears, and
    // narrowing it needs the caller's value a second time — the read the
    // library-authored-message rule exists to avoid. See `redactUrlInMessage`.
    expect(new TimeoutError(message, { url }).message).toBe(
      "Timed out contacting example.com via the avatar proxy",
    );
  });

  // CONTROL for the blast radius: the needle always starts at the character
  // after `://`, so it carries the embedded host. A message that names only the
  // tail of the segment keeps it.
  test("CONTROL — the needle is host-anchored, so a bare segment survives", () => {
    const url = "https://registry.test/proxy/https://npm.test/left-pad@1.2.3";
    expect(redactUrlInMessage("cache miss for left-pad@1.2.3", url)).toBe(
      "cache miss for left-pad@1.2.3",
    );
    // The same message WITH the host is the one that loses text.
    expect(redactUrlInMessage("cache miss for npm.test/left-pad@1.2.3", url)).toBe(
      "cache miss for 1.2.3",
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ROUND 5 — a url that embeds thousands of credentials.
//
// COST, recorded where it can be read rather than asserted as a timing. A
// `replaceAll` per needle read the whole message once for each credential the
// url embeds: 1000 of them took 10 ms, 4000 took 126 ms, and 8000 took 435 ms,
// against 4.9 ms before the path scan existed. The single pass in
// `withoutUserinfos` costs 6 ms at 8000 and grows linearly.
//
// A timing assertion was written for this and REMOVED. It has to be a ratio,
// because a millisecond budget is a claim about the machine that ran it; and
// the ratio needs a control measured in the same run, because `pnpm coverage`
// slows everything down. v8's instrumentation does not slow the two functions
// by the same factor, so the control did not cancel it and the guard failed
// one run in two on code that had not changed. A guard that lies once is worse
// than the paragraph above. What stays is the correctness half, at a size
// where the quadratic form took minutes rather than milliseconds.
// ═══════════════════════════════════════════════════════════════════════════

describe("a url that embeds thousands of credentials", () => {
  /** A forwarding url with `count` embedded, credentialed URLs in its path. */
  function forwarding(count: number): string {
    let url = "https://api.test";
    for (let i = 0; i < count; i += 1) url += `/go/https://svc${i}:pw@internal${i}.test`;
    return url;
  }

  test("every credential is removed from the url and from the message", () => {
    const url = forwarding(4000);
    const message = `Request cannot be constructed from a URL that includes credentials: ${url}`;

    expect(redactUrl(url)).not.toContain(":pw@");
    const cleaned = redactUrlInMessage(message, url);
    expect(cleaned).not.toContain(":pw@");
    // The needles go, and the surrounding wording stays.
    expect(cleaned).toContain(
      "Request cannot be constructed from a URL that includes credentials:",
    );
  });

  test("a path of nothing but authority marks is still reduced", () => {
    // The shape the `malformedUserinfoSpans` comment already measured: 96 KB of
    // repeated `://` took 855 ms through the backward scan it replaced.
    const url = `https://api.test/${"https://".repeat(12000)}`;
    expect(redactUrl(url).startsWith("https://api.test/")).toBe(true);
  });
});

describe("a malformed url whose query hides a parser-created authority", () => {
  // The two halves of the userinfo pass were fixed one round apart: the
  // malformed branch learned to read the RESOLVED form, and the parseable
  // branch learned to read the query and the fragment. Neither covered a
  // malformed url whose QUERY holds the mark the parser creates.
  const url = "://api.test/x?next=https:\t//svc:hunter2@evil.test";
  const normalizedInner = "https://svc:hunter2@evil.test";

  test("the parser really does create the authority mark inside the query", () => {
    expect(new URL(url, "http://url.invalid").search).toContain("://svc:hunter2@");
    expect(url.includes("://svc")).toBe(false);
  });

  test("the credential is removed from a message that quotes the normalized form", () => {
    expect(redactUrlInMessage(`refused ${normalizedInner}`, url)).not.toContain("hunter2");
  });

  test("and the redacted url never carried it in the first place", () => {
    expect(redactUrl(url)).not.toContain("hunter2");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ROUND 6 — the states the one pass added, and the shapes both branches read.
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// ROUND 7 — the fourth slot, the raw-text mirror, and the residual a previous
// comment denied.
//
// `userinfosOf`'s parseable branch reads FOUR things and its malformed branch
// read three; the missing one is the resolved url's own `username`/`password`,
// which is where a protocol-relative form hides a credential. The mirror is
// that the parseable branch never read the RAW text, so a password holding a
// backslash or a tab became a needle that no longer matched what a platform
// quoted.
// ═══════════════════════════════════════════════════════════════════════════

// ───────────────────────────────────────────────────────────────────────────
// DEFECT 3a — the FOURTH slot. Round 6 made the unparseable branch of
// `userinfosOf` read "the SAME three slots the parseable branch reads". The
// parseable branch reads FOUR things: `username`/`password` FIRST, then
// `pathname`, `search`, `hash`. The unparseable branch still never reads the
// resolved url's own userinfo, so a protocol-relative input whose credential
// the base resolution recovers yields NO needle at all.
// ───────────────────────────────────────────────────────────────────────────

// The message a platform writes after IT resolved the input against its own
// document base — the base `redactUrl` never sees.
const RESOLVED_MESSAGE =
  "Request cannot be constructed from a URL that includes credentials: https://alice:hunter2@sso.test/v1";

describe("DEFECT 3a — the resolved url's own userinfo is never a needle", () => {
  test.each([
    ["a backslash pair", "\\\\alice:hunter2@sso.test/v1"],
    ["slash then backslash", "/\\alice:hunter2@sso.test/v1"],
    ["backslash then slash", "\\/alice:hunter2@sso.test/v1"],
    ["an embedded tab", "/\t/alice:hunter2@sso.test/v1"],
    ["an embedded CR", "/\r/alice:hunter2@sso.test/v1"],
    ["an embedded LF", "/\n/alice:hunter2@sso.test/v1"],
  ])("%s", (_name, raw) => {
    const resolved = new URL(raw, "http://url.invalid");
    // The parser recovers the credential; the needle scan never asks it for one.
    expect({ user: resolved.username, password: resolved.password }).toEqual({
      user: "alice",
      password: "hunter2",
    });
    expect(redactUrl(raw)).toBe("/v1");

    const error = new NetworkError(RESOLVED_MESSAGE, { url: raw });

    expect(error.message).not.toContain("hunter2");
    expect(error.toJSON().message).not.toContain("hunter2");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// DEFECT 3b — the mirror asymmetry round 6 left. The relative branch of
// `redactUrl` reads BOTH the raw string and the normalized path, because "the
// parser CREATES the mark this scan looks for". `userinfosOf`'s PARSEABLE
// branch reads only the normalized `pathname`/`search`/`hash` and never the
// raw url — so the needle it produces is text the message never contained.
// ───────────────────────────────────────────────────────────────────────────

describe("DEFECT 3b — a needle normalized away from the text a message carries", () => {
  test.each([
    ["a backslash in the password", "https://svc:hun\\ter2@internal.test/v1"],
    ["a tab in the password", "https://svc:hun\tter2@internal.test/v1"],
    ["a CR in the password", "https://svc:hun\rter2@internal.test/v1"],
    ["an LF in the password", "https://svc:hun\nter2@internal.test/v1"],
  ])("%s", (_name, embedded) => {
    // A forwarding url. This request's own authority is `api.test`; the target
    // it forwards to rides in the PATH, credential and all. The platform names
    // the target it could not reach.
    const forwarding = `https://api.test/go/${embedded}`;
    const message = `connect ECONNREFUSED while contacting ${embedded}`;

    const error = new NetworkError(message, { url: forwarding });

    expect(error.message).not.toContain("ter2");
    expect(error.toJSON().message).not.toContain("ter2");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// DEFECT 4 — the claim round 6 wrote over the residual round 5 had stated.
//
// Round 5: "chained `replaceAll` can match text that only became adjacent when
// an earlier needle was removed, and a single pass cannot."
// Round 6 deleted that and wrote: "the union removes AT LEAST what the chained
// form removed, and where the two differ it removes MORE."
//
// The union is a correct union of the spans that exist in the ORIGINAL string.
// It is not an upper bound on the chained form, which sees strings the first
// removal creates. The password below is what the chained form removed and the
// merged single pass keeps.
// ───────────────────────────────────────────────────────────────────────────

// ───────────────────────────────────────────────────────────────────────────
// ROUND 9 — the raw scan is gone, and with it the whole class.
//
// Round 8 taught the absolute branch to read the RAW input, because the parser
// cuts `pathname` at the first `?` or `#`. Round 9 broke that raw scan twice,
// from both sides at once:
//
//   R9-H3-01 — `rawAfterAuthority` took the first `://` to be THIS url's own
//   authority. The URL Standard reaches the authority state from `https:/host`,
//   `https:host`, and `https:\\host` as well, so in those spellings the first
//   `://` is the EMBEDDED url's and the raw region began AFTER the credential.
//   R9-H3-02 — the raw scan looked for a mark the PARSER creates. It removes
//   every ASCII tab, CR, and LF before parsing and reads `\` as `/`, so
//   `https:\\svc:pw@…` spells an authority the raw text never contains.
//
// Neither is patched. `redactUrl` reads no raw text at all now: it scans
// `pathname + search + hash`, the parser's own rendering of everything after
// the authority, in one contiguous string. The marks are then the ones the
// parser wrote, the authority is wherever the parser found it, and the `?` no
// longer takes the `@` away.
// ───────────────────────────────────────────────────────────────────────────

describe("R9 — one text: what the parser emitted, never the raw input", () => {
  // R9-H3-01. Every spelling of THIS url's authority the parser accepts, each
  // hiding the same embedded credential behind a terminator.
  test.each([
    ["a single solidus", "https:/api.test/go/https://svc:hunter2?tail@internal.test/v1"],
    ["no solidus at all", "https:api.test/go/https://svc:hunter2?tail@internal.test/v1"],
    ["backslashes", "https:\\\\api.test/go/https://svc:hunter2?tail@internal.test/v1"],
    ["a solidus and a CR", "https:/\r/api.test/go/https://svc:hunter2?tail@internal.test/v1"],
    ["an LF inside the scheme", "ht\ntps://api.test/go/https://svc:hunter2?tail@internal.test/v1"],
  ])("an authority spelled %s does not move the scan", (_label, url) => {
    expect(redactUrl(url)).toBe("https://api.test/go/https://internal.test/v1");
  });

  // R9-H3-02. Every spelling of the EMBEDDED authority the parser has to write
  // out, each with the terminator that used to take the `@` away.
  test.each([
    ["backslashes", "https://api.test/go/https:\\\\svc:hunter2?tail@internal.test/v1"],
    ["an ASCII tab", "https://api.test/go/https:\t//svc:hunter2?tail@internal.test/v1"],
    ["a CR", "https://api.test/go/https:\r//svc:hunter2?tail@internal.test/v1"],
    ["an LF", "https://api.test/go/https:/\n/svc:hunter2?tail@internal.test/v1"],
    ["backslashes and a `#`", "https://api.test/go/https:\\\\svc:hunter2#tail@internal.test/v1"],
    [
      "a tab inside the password",
      "https://api.test/go/https://svc:hun\tter2?tail@internal.test/v1",
    ],
  ])("an embedded authority the parser writes out — %s", (_label, url) => {
    expect(redactUrl(url)).toBe("https://api.test/go/https://internal.test/v1");
  });

  // The RELATIVE branch had the same hole and nobody reported it: it read the
  // raw string first for exactly the reason the absolute branch did, so a
  // terminator inside a credential the PARSER had to spell out defeated both
  // of its passes too. One text closes both branches at once.
  test.each([
    ["backslashes and a `?`", "/go/https:\\\\svc:hunter2?tail@i.test/v1"],
    ["a tab and a `#`", "/go/https:\t//svc:hunter2#tail@i.test/v1"],
    ["a CR and a `?`", "/go/https:\r//svc:hunter2?tail@i.test/v1"],
  ])("the relative branch loses it too — %s", (_label, url) => {
    expect(redactUrl(url)).toBe("/go/https://i.test/v1");
  });

  // The rebuild takes an origin and a PATH, and a path always keeps the leading
  // `/` no span can reach. So the redactor can move text out of a url and can
  // never move the host it names: a redaction that LIES is worse than one that
  // leaks.
  test.each([
    ["an IPv6 host", "https://[::1]:8443/go/https://svc:hunter2?t@i.test/v1", "[::1]:8443"],
    [
      "a host with a port",
      "https://api.test:8443/go/https://svc:hunter2?t@i.test/v1",
      "api.test:8443",
    ],
    [
      "this url's own userinfo",
      "https://a:pw@api.test/go/https://svc:hunter2?t@i.test/v1",
      "api.test",
    ],
    ["an authority with no path", "https://svc:hunter2@api.test", "api.test"],
  ])("the host survives redaction — %s", (_label, url, host) => {
    const redacted = redactUrl(url);

    expect(redacted).not.toContain("hunter2");
    expect(new URL(redacted).host).toBe(host);
  });

  // The shapes the one-text rule does NOT change, pinned beside the ones it
  // does, so a later narrowing has to say which of the two it touches.
  test.each([
    [
      "an `@` inside an encoded span",
      "https://api.test/go/https://svc:hunter2%40x@i.test/v1",
      "https://api.test/go/https://i.test/v1",
    ],
    [
      "a second authority after a removed span",
      "https://api.test/go/https://svc:hunter2?t@i.test/v1/https://svc2:pw@j.test/z",
      "https://api.test/go/https://i.test/v1/https://j.test/z",
    ],
    [
      "a dot segment before the mark",
      "https://api.test/go/../go2/https://svc:hunter2?t@i.test/v1",
      "https://api.test/go2/https://i.test/v1",
    ],
    [
      "an uppercase embedded scheme",
      "https://api.test/go/HTTPS://svc:hunter2?t@i.test/v1",
      "https://api.test/go/HTTPS://i.test/v1",
    ],
    [
      "a `#` before a `?`",
      "https://api.test/go/https://svc:hunter2#a?b@i.test/v1",
      "https://api.test/go/https://i.test/v1",
    ],
    [
      "a credential in the query alone",
      "https://api.test?next=https://svc:hunter2@i.test",
      "https://api.test/",
    ],
    [
      "an @-headed segment under a fragment `@`",
      "https://api.test/users/@alice#invite=bob@example.com",
      "https://api.test/users/@alice",
    ],
    [
      "a file url with an embedded credential",
      "file:///var/go/https://svc:hunter2?t@i.test/v1",
      "file:///var/go/https://i.test/v1",
    ],
    [
      "a drive letter is not an authority",
      "file:///c:/Users/alice@corp/x",
      "file:///c:/Users/alice@corp/x",
    ],
    ["an IPv6 host carrying userinfo", "https://alice:hunter2@[::1]/x", "https://[::1]/x"],
  ])("%s", (_label, url, expected) => {
    expect(redactUrl(url)).toBe(expected);
  });

  // A url the parser refuses does not become resolvable once a credential is
  // taken out, and nothing here edits the input, so the question is asked of
  // the raw string by construction rather than by an ordering rule.
  test("an authority whose port is a password still collapses to the no-URL value", () => {
    expect(redactUrl("https://alice:pw?x@api.test/y")).toBe("");
  });
});

describe("R9 — the message pass reads the raw text, anchored on the SCHEME", () => {
  // `userinfosOf` still reads the raw url, and it must: a needle has to match
  // the spelling a platform QUOTED, and the parser rewrites what it reads. The
  // anchor moved with the finding — the cut is made after the scheme's own
  // authority, whatever spelling it uses, so an embedded credential is inside
  // the region and this url's port is still outside it.
  test.each([
    ["a single solidus", "https:/api.test/go/https://svc:hun\\ter2@i.test/v1"],
    ["no solidus at all", "https:api.test/go/https://svc:hun\\ter2@i.test/v1"],
    ["backslashes", "https:\\\\api.test/go/https://svc:hun\\ter2@i.test/v1"],
    ["a tab between the solidi", "https:/\t/api.test/go/https://svc:hun\\ter2@i.test/v1"],
  ])("a raw needle survives an authority spelled %s", (_label, url) => {
    // The platform quotes the target it could not reach, in the caller's own
    // spelling — so only the RAW scan can produce this needle.
    const message = "connect ECONNREFUSED while contacting https://svc:hun\\ter2@i.test/v1";

    expect(redactUrlInMessage(message, url)).not.toContain("ter2");
  });

  test("this url's own port is still not read as a credential", () => {
    const url = "https://host:8443/users/@alice";

    expect(redactUrlInMessage(`refused ${url}`, url)).toBe(`refused ${url}`);
  });

  test("a url with no path at all yields no raw region", () => {
    expect(redactUrlInMessage("refused ops@corp.test", "https://api.test")).toBe(
      "refused ops@corp.test",
    );
  });
});

describe("the residual any single pass has", () => {
  test("a needle whose removal would create the next one is not matched", () => {
    // STATED on `withoutUserinfos`. Chained `replaceAll` re-scanned the string
    // after each removal and so matched text that only became adjacent then;
    // one pass reads the original. The shape is contrived, and the residual is
    // written down rather than denied — a previous version of that comment
    // claimed the union dominates the chained form, which is false.
    const url = "://tok@a/://svc:hunter2@b/";
    expect(redactUrlInMessage("connecting to svc:huntok@ter2@internal.test failed", url)).toBe(
      "connecting to svc:hunter2@internal.test failed",
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
// ROUND 8 — the absolute branch never read the raw input.
//
// The relative branch reads the RAW string first, and its comment states why:
// `stripValues` clears the query and the fragment, and the parser has already
// cut `pathname` at the `?` or `#` that started them. The absolute branch
// scanned the emitted `pathname` and nothing else, so the same shape inside a
// well-formed url emitted an authority truncated mid-credential —
// `https://api.test/go/https://svc:hunter2` — with half the password in it.
//
// The ledger recorded this closed in round 5 ("Both branches now read both
// forms"). That sentence was true of the relative branch alone.
// ───────────────────────────────────────────────────────────────────────────

describe("R8 — a terminator inside a credential the PATH embeds", () => {
  test.each([
    [
      "a `?` ends the pathname mid-credential",
      "https://api.test/go/https://svc:hunter2?tail@internal.test/v1",
      "https://api.test/go/https://internal.test/v1",
    ],
    [
      "a `#` ends it the same way",
      "https://api.test/go/https://svc:hunter2#tail@internal.test/v1",
      "https://api.test/go/https://internal.test/v1",
    ],
    [
      "a username-only bearer token is cut too",
      "https://api.test/callback/https://tok_hunter2?x@internal.test/v1",
      "https://api.test/callback/https://internal.test/v1",
    ],
    [
      "this url's OWN userinfo still goes with it",
      "https://alice:pw@api.test/go/https://svc:hunter2?t@internal.test/v1",
      "https://api.test/go/https://internal.test/v1",
    ],
    [
      "the port of THIS url is still not read as userinfo",
      "https://api.test:8443/go/https://svc:hunter2?t@internal.test/v1",
      "https://api.test:8443/go/https://internal.test/v1",
    ],
  ])("%s", (_label, url, expected) => {
    expect(redactUrl(url)).toBe(expected);
  });

  // The twins the parser does NOT cut, pinned beside the ones it does, so a
  // future narrowing of the raw pass has to state which of the two it changes.
  test.each([
    [
      "a percent-encoded terminator never leaves the pathname",
      "https://api.test/go/https://svc:hunter2%3Ftail@internal.test/v1",
      "https://api.test/go/https://internal.test/v1",
    ],
    [
      "an empty userinfo keeps the host it precedes",
      "https://api.test/go/https://@internal.test/v1",
      "https://api.test/go/https://internal.test/v1",
    ],
  ])("%s", (_label, url, expected) => {
    expect(redactUrl(url)).toBe(expected);
  });

  // The raw pass reads the text AFTER this url's own authority, so an ordinary
  // path keeps every segment it names even when a query carries an `@`.
  test("an @-headed segment survives a query that also holds an `@`", () => {
    expect(redactUrl("https://api.test/users/@alice?invite=bob@example.com")).toBe(
      "https://api.test/users/@alice",
    );
    expect(redactUrl("https://api.test/go/https://cdn.test/users/@alice?x=1")).toBe(
      "https://api.test/go/https://cdn.test/users/@alice",
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
// ROUND 9, RESIDUAL LANE — the single-solidus embedded authority.
//
// `/go/https:/svc:pw@host` kept `svc:pw`. Round 9's fixer widened the anchor,
// which closed it, and reverted because widening the SAME constant also widened
// where a region ENDS — and then a password that spells `:/` ends its own
// region. That cost was real and it is pinned below: under the reverted form
// `//svc:hun:/ter2@host` emitted `svc:hun`, which is a password prefix, not two
// characters.
//
// The two are different marks and this round separates them. A region OPENS at
// a scheme colon and every solidus after it — the spelling every slash-
// collapsing proxy and every `path.join` produces from an ordinary
// `/go/https://svc:pw@host`. A region CLOSES only at `://`, which is the rule
// that exists so a password cannot choose where its own authority stops.
// ───────────────────────────────────────────────────────────────────────────

describe("R9 residual — a scheme colon and its solidi open an authority", () => {
  // CLOSED. Each of these kept its credential before this round.
  test.each([
    [
      "a user and a password",
      "https://api.test/go/https:/svc:hunter2@internal.test/v1",
      "https://api.test/go/https:/internal.test/v1",
    ],
    [
      "a bearer token with no colon",
      "https://api.test/go/https:/token@internal.test/v1",
      "https://api.test/go/https:/internal.test/v1",
    ],
    [
      "a `?` terminator inside the credential",
      "https://api.test/go/https:/svc:hunter2?tail@internal.test/v1",
      "https://api.test/go/https:/internal.test/v1",
    ],
    [
      "a `#` terminator inside the credential",
      "https://api.test/go/https:/svc:hunter2#tail@internal.test/v1",
      "https://api.test/go/https:/internal.test/v1",
    ],
    [
      "a single backslash the parser rewrites",
      "https://api.test/go/https:\\svc:hunter2@internal.test/v1",
      "https://api.test/go/https:/internal.test/v1",
    ],
    [
      "more solidi than the parser needs",
      "https://api.test/go/https:///svc:hunter2@internal.test/v1",
      "https://api.test/go/https:///internal.test/v1",
    ],
  ])("a single-solidus embedded authority loses its credential — %s", (_label, url, expected) => {
    expect(redactUrl(url)).toBe(expected);
  });

  // THE TRADE-OFF THE REVERT WAS ABOUT, pinned so the next round cannot take
  // the shortcut that reopens it. Widening the region's END as well would cut
  // each of these at the `:/` the PASSWORD wrote and emit everything before it.
  test.each([
    [
      "a `:/` in the middle",
      "https://api.test/go/https://svc:hun:/ter2@internal.test/v1",
      "svc:hun",
    ],
    ["a `:/` at the head", "https://api.test/go/https://svc::/hunter2@internal.test/v1", "svc:"],
    [
      "a `:/` at the tail",
      "https://api.test/go/https://svc:hunter2:/@internal.test/v1",
      "svc:hunter2",
    ],
    ["four of them", "https://api.test/go/https://svc:a:/b:/c:/d@internal.test/v1", "svc:a:/b:/c:"],
  ])("a password that spells `:/` does not end its own region — %s", (_label, url, prefix) => {
    // The whole credential goes, and in particular the prefix a widened region
    // end would have left behind.
    expect(redactUrl(url)).toBe("https://api.test/go/https://internal.test/v1");
    expect(redactUrl(url)).not.toContain(prefix);
  });

  test("the same password behind a single solidus loses both halves too", () => {
    expect(redactUrl("https://api.test/go/https:/svc:hun:/ter2@internal.test/v1")).toBe(
      "https://api.test/go/https:/internal.test/v1",
    );
  });

  // The invariant the whole module is built on, restated for the new mark: a
  // redaction that moves the host it names is worse than one that leaks. The
  // narrowest mark is two characters and index 0 of a pathname is already a
  // `/`, so the earliest span starts at index 3 and the origin is unreachable.
  test.each([
    "https://api.test/go/https:/svc:hunter2@evil.test/v1",
    "https://api.test:8443/go/https:/svc:hunter2@evil.test/v1",
    "https://api.test/a:/b@evil.test",
    "https://api.test/go/https:/svc:hun:/ter2@evil.test/v1",
  ])("the host survives the widened anchor — %s", (url) => {
    const redacted = redactUrl(url);

    expect(redacted).not.toContain("hunter2");
    expect(new URL(redacted).host).toBe(new URL(url).host);
  });

  // What the widened anchor COSTS, all of it over-redaction, which is this
  // module's safe direction. Stated as pins so a later round narrowing the
  // anchor has to say which of these it is buying back.
  test.each([
    [
      "a chain of single-solidus authorities collapses to the last host",
      "https://api.test/go/https:/svc:pw@h1/then/http:/u2:pw2@h2/v1",
      "https://api.test/go/https:/h2/v1",
    ],
    [
      "an ordinary path segment ending in `:/` before an `@`",
      "https://api.test/a:/b@c",
      "https://api.test/a:/c",
    ],
  ])("RESIDUAL: %s", (_label, url, expected) => {
    expect(redactUrl(url)).toBe(expected);
  });

  // The shapes the widened anchor deliberately does NOT reach, each pinned
  // with the reason, so a later widening has to name which one it takes.
  test.each([
    // A Windows drive letter spells a colon and one solidus in an ordinary
    // path. This is why a SINGLE solidus does not get `looksLikeUserinfo`'s
    // third rule — the one that reads a `/`-bearing token as a credential.
    ["a drive letter is still not an authority", "file:///c:/Users/alice@corp/x"],
    // The price of that: a standard-base64 token containing a `/`, behind a
    // single-solidus scheme. Two solidi still reach it — the row below.
    [
      "RESIDUAL: a base64 credential with a `/` behind ONE solidus",
      "https://api.test/go/https:/YWxpY2U/cGFzc3dvcmQ@internal.test/v1",
    ],
    // No colon before the solidi at all, and a percent-encoded one, which the
    // `disclosure-channels.spec.ts` CONTROL rows record as residual 2.
    ["a scheme-relative embedded url", "https://api.test/go//svc:pw@internal.test/v1"],
    ["a percent-encoded scheme colon", "https://api.test/go/https%3A//svc:pw@i.test/v1"],
    // The paths the module is required to keep, unchanged by the new mark.
    ["an @-headed segment", "https://api.test/users/@alice"],
    ["a scoped package", "https://api.test/@scope/pkg"],
  ])("%s", (_label, url) => {
    expect(redactUrl(url)).toBe(url);
  });

  test("two solidi still reach the base64 credential the single one does not", () => {
    expect(redactUrl("https://api.test/go/https://YWxpY2U/cGFzc3dvcmQ@internal.test/v1")).toBe(
      "https://api.test/go/https://internal.test/v1",
    );
  });

  // The regions a wide start opens OVERLAP, where a `://` mark partitions. The
  // forward `@` cursor is what keeps that one pass over the input; re-reading a
  // shared region end per mark, or slicing each candidate out to test it, is
  // the same quadratic the backward scan had. Measured before the cursor:
  // 3924 ms for the first input below, 1499 ms for the second.
  test.each([
    ["repeated `:/` marks", ":/".repeat(32_000)],
    ["repeated `:/x/` marks ending in an `@`", ":/x/".repeat(20_000) + "@h"],
  ])("the scan stays linear on %s", (_label, hostile) => {
    const started = performance.now();

    redactUrl(hostile);

    expect(performance.now() - started).toBeLessThan(100);
  });

  test("a message quoting the single-solidus form loses the credential too", () => {
    const url = "https://api.test/go/https:/svc:hunter2@internal.test/v1";
    const message = `connect ECONNREFUSED while contacting https:/svc:hunter2@internal.test/v1`;

    expect(redactUrlInMessage(message, url)).toBe(
      "connect ECONNREFUSED while contacting https:/internal.test/v1",
    );
  });
});
