import { describe, expect, test } from "vitest";
import { typedFetch } from "./src/index";
import { NetworkError } from "./src/errors/network-error";
import { redactUrl, redactUrlInMessage } from "./src/errors/redact-url";
import { PASSWORD, everyChannel } from "./fixtures/channels";

/**
 * ROUND 12, LANE H3 — disclosure and security.
 *
 * Four rounds of criticals in `src/errors/redact-url.ts` came from finding the
 * one thing the current rule does not ask. Round 11 made the rule ask every
 * `@` inside a userinfo region, and that rule holds: a generated population of
 * credentials the URL parser itself confirms is removed, the emitted path stays
 * a subsequence of `parsed.pathname`, the origin never moves, and no query or
 * fragment byte is emitted.
 *
 * What no round has asked is where a region can OPEN — and that question is not
 * settled by the scan at all. It is settled one line earlier, by which parse
 * `redactUrl` hands the scan. The absolute branch hands it `parsed.pathname`
 * after the url's OWN authority is gone, so every `://` an embedded url spells
 * is still in the text. The relative branch hands it the pathname of the input
 * resolved against `http://url.invalid` — and there the FIRST authority is not
 * this url's own. A relative url that begins with two solidi is
 * protocol-relative, so the parser reads the text after them as an authority
 * and eats the embedded scheme's `://` to build a host out of it.
 *
 * The mark the scan looks for is then gone from the text the scan reads, no
 * region opens anywhere, and the credential rides out inside the one slot this
 * module keeps: the path.
 */

/**
 * A protocol-relative request url whose path is a forward to a credentialed
 * service.
 *
 * Nothing here is malformed or exotic. The leading `//` is the ordinary
 * protocol-relative form a browser and a worker both resolve against the
 * document base, which is the exact case `RELATIVE_BASE` exists for. The
 * embedded url is spelled with the two-solidus `://` under a SPECIAL scheme,
 * its credential is `user:password`, and the character before its `@` is `2`.
 * None of the four recorded residuals applies: no later `://` cuts the region
 * short, the scheme is special and carries two solidi, no delimiter is
 * percent-encoded, and the credential does not end in `/`.
 */
const PROTOCOL_RELATIVE_FORWARD = `//https://svc:${PASSWORD}@internal.test/v1`;

/* ────────────────────────────────────────────────────────────────────────────
 * R12-H3-01 — a protocol-relative url hides the mark that opens a region.
 * ──────────────────────────────────────────────────────────────────────────── */

describe("R12-H3-01 — a protocol-relative url keeps its embedded credential", () => {
  test("the embedded credential is removed from the redacted url", () => {
    expect(redactUrl(PROTOCOL_RELATIVE_FORWARD)).not.toContain(PASSWORD);
  });

  test("the two entry points agree that this text is a credential", () => {
    // The message pass reads the RAW input, finds the `://` the parser ate,
    // opens a region there and removes `svc:hunter2@` — so the module already
    // holds the verdict. `redactUrl` reads the parser's pathname instead and
    // emits the same bytes. Two implementations of one rule, and the one that
    // disagrees is the one `error.url`, `toJSON()`, and every channel that
    // renders the record all carry.
    expect(redactUrlInMessage(PROTOCOL_RELATIVE_FORWARD, PROTOCOL_RELATIVE_FORWARD)).not.toContain(
      PASSWORD,
    );
    expect(redactUrl(PROTOCOL_RELATIVE_FORWARD)).not.toContain(PASSWORD);
  });

  test("no channel of a request failure carries the embedded credential", () => {
    const error = new NetworkError("Request failed", { url: PROTOCOL_RELATIVE_FORWARD });
    for (const [channel, rendered] of Object.entries(everyChannel(error))) {
      expect(rendered, `channel ${channel} emitted the password`).not.toContain(PASSWORD);
    }
  });

  test("a request failure through typedFetch does not carry the embedded credential", async () => {
    const transport = (() =>
      Promise.reject(new TypeError("fetch failed"))) as unknown as typeof fetch;
    const { error } = await typedFetch(PROTOCOL_RELATIVE_FORWARD, { fetch: transport });
    expect(error).not.toBeNull();
    const record = JSON.stringify((error as NetworkError).toJSON());
    expect(record, "toJSON() emitted the password").not.toContain(PASSWORD);
  });

  test("every leading-solidus spelling loses the credential", () => {
    // The trigger is the number of solidi in FRONT of the embedded url, not
    // anything about the credential. `\` is a solidus to the parser under a
    // special base, and a third `/` changes nothing, so a slash-adding join and
    // a Windows-shaped path reach the same state.
    for (const url of [
      `//https://svc:${PASSWORD}@internal.test/v1`,
      `///https://svc:${PASSWORD}@internal.test/v1`,
      `\\\\https://svc:${PASSWORD}@internal.test/v1`,
      `//ws://svc:${PASSWORD}@internal.test/v1`,
      `//ftp://svc:${PASSWORD}@internal.test/v1`,
      `//foo://svc:${PASSWORD}@internal.test/v1`,
      `//https://token${PASSWORD}@internal.test/v1`,
    ]) {
      expect(redactUrl(url), `redactUrl kept the password of ${url}`).not.toContain(PASSWORD);
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * CONTROLS. Each one passes on the committed tree, and together they draw the
 * line the finding above crosses: the defect is the leading `//`, and nothing
 * else about the url.
 * ──────────────────────────────────────────────────────────────────────────── */

describe("R12-H3-01 controls — where the line sits today", () => {
  test("ONE leading solidus loses the credential", () => {
    // Identical text with one solidus fewer. The parser then resolves it as a
    // path against the base, `https://` survives in `pathname`, a region opens
    // and the span is found.
    expect(redactUrl(`/https://svc:${PASSWORD}@internal.test/v1`)).toBe(
      "/https://internal.test/v1",
    );
  });

  test("the module's own docstring example loses the credential", () => {
    expect(redactUrl(`://svc:${PASSWORD}@internal.test/v1`)).toBe("/://internal.test/v1");
  });

  test("a protocol-relative url with a REAL host loses an embedded credential", () => {
    // The same two solidi, but the authority the parser builds from them is a
    // host rather than the embedded scheme, so the embedded `://` stays in the
    // path and the scan reaches it.
    expect(redactUrl(`//api.test/go/https://svc:${PASSWORD}@internal.test/v1`)).toBe(
      "/go/https://internal.test/v1",
    );
  });

  test("a protocol-relative url whose OWN userinfo is the credential loses it", () => {
    // The parser recognises this one, so `stripValues` clears the slot before
    // any scan runs. The finding is only about a credential the parse hides.
    expect(redactUrl(`//svc:${PASSWORD}@internal.test/v1`)).toBe("/v1");
  });

  test("the absolute sibling of the finding's url loses the credential", () => {
    // The same path, under an absolute url. The outer authority is consumed by
    // the outer host, so the embedded mark survives into `pathname`.
    expect(redactUrl(`https://api.test//https://svc:${PASSWORD}@internal.test/v1`)).toBe(
      "https://api.test//https://internal.test/v1",
    );
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * What this lane measured and found sound. These pass on the committed tree.
 * They are written down because round 11's claims were measured while the fix
 * was being made, and a measurement nothing asserts does not travel.
 * ──────────────────────────────────────────────────────────────────────────── */

/** A seeded generator, so a failure names an input a reader can paste. */
function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

describe("round 11's rule, re-measured on the committed tree", () => {
  const SCHEMES = ["https://", "https:/", "https:", "http://", "ws://", "ftp://", "foo://", "://"];
  const HOSTS = ["h.test", "h2.test", "[::1]", "h.test:8443"];
  const TAILS = ["/v1", "/", "", "/a/b", "/img/@alice"];
  const PREFIXES = ["/", "/go/", "/a/b/", "/@x/", "/x:/", "/(", "/~", "/!", "/,", "/*", "/a:b/"];
  const NOISE = [
    "@",
    "@@",
    ":",
    "/",
    "//",
    "://",
    "a",
    ".",
    "%40",
    "[",
    "]",
    "1",
    "-",
    "_",
    ";",
    ",",
    "=",
    "&",
    "+",
    "~",
    "!",
    "$",
    "(",
    ")",
    "*",
    "\t",
    "\n",
  ];
  const SECRET = "ZQSECRETQZ";

  /** `text` is a subsequence of `whole`. */
  function isSubsequence(text: string, whole: string): boolean {
    let at = 0;
    for (const character of whole) if (at < text.length && text[at] === character) at += 1;
    return at === text.length;
  }

  test(
    "a credential the URL parser confirms is never emitted, over 30,000 urls",
    { timeout: 60_000 },
    () => {
      const random = generator(20260808);
      const pick = <T>(values: readonly T[]): T => values[Math.floor(random() * values.length)]!;
      const noise = (count: number) => Array.from({ length: count }, () => pick(NOISE)).join("");

      let confirmed = 0;
      const leaked: string[] = [];
      while (confirmed < 30_000) {
        const userinfo = noise(Math.floor(random() * 3)) + SECRET + noise(Math.floor(random() * 3));
        const scheme = pick(SCHEMES);
        const embedded = `${scheme}${userinfo}@${pick(HOSTS)}${pick(TAILS)}`;
        let parsed: URL;
        try {
          parsed = new URL(embedded.startsWith("://") ? `https${embedded}` : embedded);
        } catch {
          continue;
        }
        if (!parsed.username.includes(SECRET) && !parsed.password.includes(SECRET)) continue;
        confirmed += 1;
        const url = `https://api.test${pick(PREFIXES)}${embedded}${noise(Math.floor(random() * 3))}`;
        const emitted = redactUrl(url);
        if (!emitted.includes(SECRET)) continue;
        // RESIDUAL 4, excluded here rather than silently passed: a credential
        // whose last character is `/` in the text the parser emitted. A `\`
        // inside a non-special scheme's userinfo becomes one, because the OUTER
        // special-scheme parse rewrites it.
        const path = new URL(url).pathname;
        const at = path.indexOf("@", path.indexOf(SECRET));
        if (at > 0 && path[at - 1] === "/") continue;
        if (leaked.length < 5) leaked.push(url);
      }
      expect(leaked, "urls whose parser-confirmed credential survived").toEqual([]);
    },
  );

  test(
    "the emitted url never moves the host and never carries a query byte",
    { timeout: 60_000 },
    () => {
      const random = generator(4242);
      const pick = <T>(values: readonly T[]): T => values[Math.floor(random() * values.length)]!;
      const alphabet = [...NOISE, "https:", "https://", "foo://", "ftp:", "?q=", "#f", "..", "%2F"];

      const wrong: string[] = [];
      for (let round = 0; round < 40_000; round += 1) {
        const length = 2 + Math.floor(random() * 10);
        const url = `https://api.test/${Array.from({ length }, () => pick(alphabet)).join("")}`;
        let parsed: URL;
        try {
          parsed = new URL(url);
        } catch {
          continue;
        }
        const origin = `${parsed.protocol}//${parsed.host}`;
        const emitted = redactUrl(url);
        const wrongOrigin = !emitted.startsWith(origin);
        const wrongPath =
          wrongOrigin || !isSubsequence(emitted.slice(origin.length), parsed.pathname);
        const wrongSlot = emitted.includes("?") || emitted.includes("#");
        if ((wrongOrigin || wrongPath || wrongSlot) && wrong.length < 5) wrong.push(url);
      }
      expect(wrong, "urls whose redaction moved the host or leaked a value slot").toEqual([]);
    },
  );
});
