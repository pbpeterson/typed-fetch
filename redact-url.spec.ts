import { describe, test, expect } from "vitest";
import { redactUrl, redactUrlInMessage } from "./src/errors/redact-url";

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

  // The stated cost of the wider region, so it is a known limit and not a
  // surprise: a malformed URL whose PATH holds an `@` after a `://` loses the
  // part before it. Userinfo is unconditionally a value; a path is structure
  // only until the two cannot be told apart.
  test("RESIDUAL: a path `@` after a `://` is over-redacted, by design", () => {
    expect(redactUrl("://host/path/@alice")).toBe("/://alice");
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
