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

  test("the port, and a non-http scheme, survive — they are structure", () => {
    expect(redactUrl("https://api.test:8443/x?t=SECRET")).toBe("https://api.test:8443/x");
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

  test("a message that does not mention the URL is untouched", () => {
    expect(redactUrlInMessage("fetch failed", "https://api.test/x?t=SECRET")).toBe("fetch failed");
  });

  test("no URL to redact leaves the message alone", () => {
    expect(redactUrlInMessage("fetch failed", "")).toBe("fetch failed");
  });

  test("a `$` in the path is not treated as a replacement pattern", () => {
    // `String.replaceAll` with a STRING replacement interprets `$&`, `$'`, …;
    // this uses a function replacer, so a `$` survives literally.
    const url = "https://api.test/a$b/c?t=SECRET";
    expect(redactUrlInMessage(`at ${url}`, url)).toBe("at https://api.test/a$b/c");
  });
});
