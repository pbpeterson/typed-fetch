import { describe, expect, test } from "vitest";
import { NotFoundError } from "./src/errors";
import { BaseHttpError } from "./src/errors/base-http-error";
import { httpErrorBrand, ownsResponseSymbol } from "./src/errors/brand";
import { denoCustomInspect, inspectCustom } from "./src/errors/inspect";
import { NetworkError } from "./src/errors/network-error";
import { AbortedError } from "./src/errors/aborted-error";
import { TimeoutError } from "./src/errors/timeout-error";
import { everyChannel } from "./fixtures/channels";
import { redactUrl, redactUrlInMessage } from "./src/errors/redact-url";

/**
 * ROUND 11, LANE H3 — disclosure and security.
 *
 * The subject is round 10's redaction rule. Round 10 replaced a textual rule
 * with a STRUCTURAL invariant — every emitted byte comes from the origin or
 * from the parser-produced `pathname` — and that invariant holds; the pins at
 * the bottom of this file re-measure it on the committed tree and it is sound
 * over a generated corpus, as is the seven-channel inventory for every
 * credential that never travels in a URL.
 *
 * What round 10 did NOT touch is where a userinfo region ENDS, and that is
 * where this round's finding is. `malformedUserinfoSpans` reads exactly one
 * `@` per region — the LAST one before the region's closing `://` — and asks
 * `looksLikeUserinfo` about the text up to it. An earlier `@` in the same
 * region is never asked about at all. So a later `@` that reads as a path
 * decides the whole region, and a real credential sitting at an earlier `@`
 * inside it survives untouched.
 */

/** Every value planted below. No channel may emit any of them. */
const SECRETS = [
  "BEARER_SECRET",
  "SESSION_SECRET",
  "AUTHZ_SECRET",
  "COOKIE_SECRET",
  "PROXYAUTH_SECRET",
  "QUERY_TOKEN_SECRET",
  "FRAGMENT_SECRET",
  "BODY_SECRET",
] as const;

/** Asserts a rendered channel carries none of the planted values. */
function expectNoSecrets(rendered: string, only?: readonly string[]): void {
  for (const secret of only ?? SECRETS) {
    expect(rendered, `channel emitted the secret ${secret}`).not.toContain(secret);
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * R11-H3-01 — a userinfo region tests only its LAST `@`.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * A forwarding url: the outer service is asked to fetch an inner one, and the
 * inner one carries a username-only bearer credential. Nothing here is
 * malformed, exotic, or percent-encoded — the mark is the two-solidus `://`
 * the parser itself writes, under a SPECIAL scheme, and the credential's last
 * character is not `/`. None of the four recorded residuals applies.
 *
 * The only unusual thing is the inner url's own path: it ends in a segment that
 * BEGINS with `@`. That is the shape `redact-url.ts` itself names as the reason
 * `looksLikeUserinfo` exists — `/users/@alice`, `/@scope/pkg` — an npm scope, a
 * Mastodon handle, a user page. It has to survive redaction, and it does.
 *
 * What goes with it is the credential. The region opens after `https://`, runs
 * to the end of the text (no second `://` closes it), and takes the LAST `@` in
 * it, which is `/@alice`'s. `looksLikeUserinfo` is then asked about
 * `BEARER_SECRET@cdn.test/img/`: it holds a `/`, it holds no `:` before that
 * `/`, and it ends in `/` — so rule 3 reads it as a path, no span is recorded,
 * and the scan moves `from` to the region start and finds no further mark. The
 * `@` that DOES close a credential, three segments earlier, is never asked
 * about, because a region only ever tests one.
 */
const FORWARDED_CREDENTIAL_URL = "https://api.test/go/https://BEARER_SECRET@cdn.test/img/@alice";

/** The same url as the identity of a real HTTP error. */
function forwardedCredentialError(): NotFoundError {
  const response = new Response("BODY_SECRET", { status: 404, statusText: "Not Found" });
  // `response.url` is read-only and empty for a synthesised Response; this is
  // the only way to exercise the URL a real fetch would have set.
  Object.defineProperty(response, "url", { value: FORWARDED_CREDENTIAL_URL });
  return new NotFoundError(response);
}

describe("R11-H3-01 — a region tests only its last `@`, so an earlier credential survives", () => {
  test("the embedded bearer credential is removed from the redacted url", () => {
    expect(redactUrl(FORWARDED_CREDENTIAL_URL)).not.toContain("BEARER_SECRET");
  });

  test("CONTROL: the same url without the trailing `@` segment loses the credential", () => {
    // Identical in every other respect. This is what proves the trigger is the
    // LATER `@`, not the credential's own shape: with nothing after `/img`, the
    // region's last `@` IS the credential's and the span is found.
    expect(redactUrl("https://api.test/go/https://BEARER_SECRET@cdn.test/img")).toBe(
      "https://api.test/go/https://cdn.test/img",
    );
  });

  test("CONTROL: the same credential spelled `user:password` loses it", () => {
    // A colon before the region's first `/` reaches `looksLikeUserinfo`'s
    // second rule, which answers before the third one can read the trailing
    // `/`. So the identical url with a two-part credential IS redacted — the
    // module answers differently for two spellings of one credential.
    expect(
      redactUrl("https://api.test/go/https://svc:BEARER_SECRET@cdn.test/img/@alice"),
    ).not.toContain("BEARER_SECRET");
  });

  test("CONTROL: the query and the fragment are still dropped whole", () => {
    // Round 10's structural invariant is intact. This finding is about the
    // rule that decides a userinfo span, not about where the emitted bytes
    // come from.
    expect(
      redactUrl(`${FORWARDED_CREDENTIAL_URL}?access_token=QUERY_TOKEN_SECRET#FRAGMENT_SECRET`),
    ).not.toContain("QUERY_TOKEN_SECRET");
  });

  test("no channel of an HTTP error carries the embedded bearer credential", async () => {
    const error = forwardedCredentialError();
    try {
      for (const [channel, rendered] of Object.entries(everyChannel(error))) {
        expect(rendered, `channel ${channel} emitted the credential`).not.toContain(
          "BEARER_SECRET",
        );
      }
    } finally {
      await error.cancel();
    }
  });

  test("no channel of a request failure carries the embedded bearer credential", () => {
    const error = new NetworkError("Request failed", { url: FORWARDED_CREDENTIAL_URL });
    for (const [channel, rendered] of Object.entries(everyChannel(error))) {
      expect(rendered, `channel ${channel} emitted the credential`).not.toContain("BEARER_SECRET");
    }
  });

  test("a message that quotes the url loses the credential too", () => {
    // The second line of `redactUrlInMessage` — "userinfo is unconditionally a
    // credential, so it is removed wherever it survives" — reads the same
    // spans, so it misses the same one.
    expect(
      redactUrlInMessage(`Failed to fetch ${FORWARDED_CREDENTIAL_URL}`, FORWARDED_CREDENTIAL_URL),
    ).not.toContain("BEARER_SECRET");
  });

  test("the relative branch answers the same way", () => {
    // A relative request url — `fetch("/go/https://…")` in a browser or a
    // worker — reaches `cleaned` through the second branch and the same scan.
    expect(redactUrl("/go/https://BEARER_SECRET@cdn.test/img/@alice")).not.toContain(
      "BEARER_SECRET",
    );
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * CLEAN PINS — measured on the committed tree, not inherited from rounds 9/10.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * The credentials that never travel inside a URL, and therefore have no
 * redactor between them and a reader: the request's `Authorization`, `Cookie`,
 * and `Proxy-Authorization`, the response's `Set-Cookie`, and a token in the
 * response body.
 *
 * No round has pinned these as a set. They are clean, and the reason is
 * structural rather than incidental: `headers` is a non-enumerable own property
 * holding a COPY of the response's `Headers`, `toJSON()` emits `keys()` and
 * never `values()`, the inspect hook renders the `toJSON()` record, and the
 * body is a stream nothing renders. Channel 7 has no hook at all, so
 * enumerability is what keeps it clean there.
 */
function credentialLadenError(): NotFoundError {
  const response = new Response("BODY_SECRET", {
    status: 404,
    statusText: "Not Found",
    headers: [
      ["set-cookie", "session=SESSION_SECRET"],
      ["set-cookie", "csrf=COOKIE_SECRET"],
      ["authorization", "Bearer AUTHZ_SECRET"],
      ["proxy-authorization", "Basic PROXYAUTH_SECRET"],
      ["content-type", "text/plain"],
    ],
  });
  Object.defineProperty(response, "url", {
    value: "https://api.test/v1?access_token=QUERY_TOKEN_SECRET#FRAGMENT_SECRET",
  });
  return new NotFoundError(response);
}

describe("CLEAN — a credential that never travels in a URL reaches no channel", () => {
  test("all seven channels withhold every header value, the query, and the body", async () => {
    const error = credentialLadenError();
    try {
      for (const [channel, rendered] of Object.entries(everyChannel(error))) {
        for (const secret of SECRETS) {
          if (secret === "BEARER_SECRET") continue;
          expect(rendered, `channel ${channel} emitted ${secret}`).not.toContain(secret);
        }
      }
    } finally {
      await error.cancel();
    }
  });

  test("a clone() copy withholds them on all seven channels too", async () => {
    const error = credentialLadenError();
    const copy = error.clone();
    try {
      for (const [channel, rendered] of Object.entries(everyChannel(copy))) {
        for (const secret of SECRETS) {
          if (secret === "BEARER_SECRET") continue;
          expect(rendered, `channel ${channel} emitted ${secret}`).not.toContain(secret);
        }
      }
    } finally {
      // Both branches, together: a lone cancel stays pending until the sibling
      // is released too.
      await Promise.all([error.cancel(), copy.cancel()]);
    }
  });

  test("the names survive, so the record still says what the server sent", async () => {
    const error = credentialLadenError();
    try {
      expect(error.toJSON().headers).toContain("set-cookie");
      expect(error.toJSON().headers).toContain("authorization");
      // The escape hatch still holds the values, and it is not enumerable.
      expect(error.headers.get("authorization")).toBe("Bearer AUTHZ_SECRET");
      expect(Object.keys(error)).not.toContain("headers");
    } finally {
      await error.cancel();
    }
  });
});

describe("CLEAN — round 10's structural invariant, re-measured here", () => {
  /** Is `needle` a subsequence of `haystack`? */
  function isSubsequence(needle: string, haystack: string): boolean {
    let at = 0;
    for (let index = 0; index < haystack.length && at < needle.length; index += 1) {
      if (needle[at] === haystack[index]) at += 1;
    }
    return at === needle.length;
  }

  const SCHEMES = ["https", "http", "file", "ws", "ftp", "HTTPS", "git", "", "a1+b-c."];
  const SOLIDI = ["//", "/", "", "///", "\\\\", "/\\", "\t//"];
  const HOSTS = ["api.test", "[::1]", "host:8443", "ⓐ.test", "host%2Fx", ""];
  const SEGMENTS = [
    "v1",
    "..",
    ".",
    "%2e%2e",
    "%2F",
    "a:b",
    "c:",
    "c|",
    "@alice",
    "%40",
    "x%3A%2F%2Fy",
    "YWxpY2U/cGFzc3dvcmQ",
    "\\",
    "%",
    "%zz",
    "‽",
  ];
  const CREDENTIALS = ["svc:PW", "TOK", "svc:PW/", "a:1234", "u%40v:PW", "svc:PW\\x", "svc:PW?x"];
  const QUERIES = ["", "?q=1", "?a=x@y.com", "?a=://b@c", "?p=https://u:PW@h/v"];
  const HASHES = ["", "#f", "#a@b", "#://u:PW@h"];

  /** A deterministic generator, so a failure names one exact input. */
  function corpus(count: number): string[] {
    let seed = 20260808;
    const next = (bound: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % bound;
    };
    const pick = <T>(values: T[]): T => values[next(values.length)] as T;
    const path = (): string => {
      let out = "";
      for (let index = next(4); index > 0; index -= 1) {
        out +=
          next(4) === 0
            ? `/${pick(SCHEMES)}:${pick(SOLIDI)}${next(2) ? `${pick(CREDENTIALS)}@` : ""}${pick(HOSTS)}`
            : `/${pick(SEGMENTS)}`;
      }
      return out;
    };
    const urls: string[] = [];
    for (let index = 0; index < count; index += 1) {
      urls.push(
        `${pick(SCHEMES)}:${pick(SOLIDI)}${next(3) === 0 ? `${pick(CREDENTIALS)}@` : ""}` +
          `${pick(HOSTS)}${path()}${pick(QUERIES)}${pick(HASHES)}`,
      );
    }
    return urls;
  }

  const HIERARCHICAL = ["http:", "https:", "ws:", "wss:", "ftp:", "file:"];
  const URLS = corpus(20000);

  test("the emitted url is a subsequence of the parsed origin plus pathname", () => {
    const broken: string[] = [];
    for (const url of URLS) {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        continue;
      }
      if (!HIERARCHICAL.includes(parsed.protocol)) continue;
      const emitted = redactUrl(url);
      if (!isSubsequence(emitted, `${parsed.protocol}//${parsed.host}${parsed.pathname}`)) {
        broken.push(`${url} -> ${emitted}`);
      }
    }
    expect(broken).toEqual([]);
  });

  test("the redaction never moves the host the url names, and never throws", () => {
    const moved: string[] = [];
    for (const url of URLS) {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        // Total by construction: an input that parses as neither absolute nor
        // relative still answers, and never throws.
        expect(() => redactUrl(url)).not.toThrow();
        continue;
      }
      const emitted = redactUrl(url);
      if (!HIERARCHICAL.includes(parsed.protocol)) {
        if (emitted !== parsed.protocol) moved.push(`${url} -> ${emitted}`);
        continue;
      }
      const out = new URL(emitted);
      if (out.host !== parsed.host || out.protocol !== parsed.protocol) {
        moved.push(`${url} -> ${emitted}`);
      }
    }
    expect(moved).toEqual([]);
  });

  test("a credential the parser itself recognized never survives", () => {
    const survived: string[] = [];
    for (const url of URLS) {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        continue;
      }
      if (!parsed.password && !parsed.username) continue;
      const emitted = redactUrl(url);
      if (parsed.password && emitted.includes(parsed.password)) survived.push(url);
      const message = redactUrlInMessage(`Failed to fetch ${url}`, url);
      if (parsed.password && message.includes(parsed.password)) survived.push(`message: ${url}`);
    }
    expect(survived).toEqual([]);
  });
});

describe("CLEAN — the five stamped members, on the committed tree", () => {
  const ROOTS = [
    ["BaseHttpError", BaseHttpError.prototype],
    ["NetworkError", NetworkError.prototype],
    ["AbortedError", AbortedError.prototype],
    ["TimeoutError", TimeoutError.prototype],
  ] as const;

  test.each(ROOTS)("%s owns the three replaceable channel hooks", (_name, prototype) => {
    for (const key of [inspectCustom, denoCustomInspect, Symbol.toPrimitive]) {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, key);
      expect(descriptor, String(key)).toBeDefined();
      expect(descriptor?.enumerable, String(key)).toBe(false);
      // Replaceable on purpose: a consumer may install their own renderer.
      expect(descriptor?.writable, String(key)).toBe(true);
      expect(descriptor?.configurable, String(key)).toBe(true);
    }
  });

  test("the brand and the ownership query are frozen, not replaceable", () => {
    for (const key of [httpErrorBrand, ownsResponseSymbol]) {
      const descriptor = Object.getOwnPropertyDescriptor(BaseHttpError.prototype, key);
      expect(descriptor, String(key)).toBeDefined();
      expect(descriptor?.enumerable, String(key)).toBe(false);
      expect(descriptor?.writable, String(key)).toBe(false);
      expect(descriptor?.configurable, String(key)).toBe(false);
    }
  });

  test("no stamped member reaches channel 5 on an instance", async () => {
    const error = credentialLadenError();
    try {
      expect(Object.getOwnPropertySymbols(error)).toEqual([]);
      expectNoSecrets(JSON.stringify(Object.keys(error)));
    } finally {
      await error.cancel();
    }
  });
});
