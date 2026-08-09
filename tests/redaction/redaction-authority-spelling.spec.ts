import { describe, test, expect } from "vitest";
import { typedFetch, isNetworkError } from "../../src/index";
import { NetworkError, NotFoundError } from "../../src/errors";
import { redactUrl } from "../../src/errors/redact-url";
import { PASSWORD, everyChannel, leakingChannels } from "../../fixtures/channels";

/**
 * ROUND 9, LANE H3 — disclosure and security.
 *
 * The subject is round 8's fix to `redactUrl`'s ABSOLUTE branch. That branch now
 * removes raw userinfo spans occurring after this url's own authority and parses
 * again, because the URL path state ends `pathname` at the first `?` or `#` and
 * `stripValues` then drops the half that carried the `@`.
 *
 * Both passes of that fix are anchored on the LITERAL three characters `://`,
 * and the URL Standard does not require an authority to be spelled with them:
 *
 *  - `rawAfterAuthority` takes the FIRST `://` in the raw text to be this url's
 *    own authority mark. A special scheme reaches the authority state from
 *    `https:/host`, `https:host`, and `https:\\host` too — the standard's
 *    special-authority-slashes state raises a validation error and carries on —
 *    so the first `://` in those spellings is the EMBEDDED url's, and the raw
 *    region the fix scans starts after the credential instead of before it.
 *    That is R9-H3-01.
 *  - `malformedUserinfoSpans` searches the raw text for `://`, and the parser
 *    CREATES that mark: it rewrites a backslash pair for a special scheme and
 *    removes every ASCII tab, CR, and LF before parsing. So an embedded
 *    authority spelled `https:\\` or `https:<TAB>//` is invisible to the raw
 *    pass — and by the time the mark exists, on `parsed.pathname`, the `?` or
 *    `#` has already cut the credential in half and taken the `@` away. Neither
 *    pass sees it. That is R9-H3-02.
 *
 * Each shape below therefore emits `https://api.test/go/https://svc:hunter2` —
 * the password, whole, in `error.url`'s redacted form, which is what `toJSON()`
 * records and what every channel that renders the record then prints.
 *
 * NO LITERAL CONTROL CHARACTER APPEARS IN THIS FILE. The tab, CR, and LF below
 * are `\t`, `\r`, and `\n` escapes, for the reason
 * `disclosure-channels.spec.ts` states about its own bytes.
 */

/** An HTTP error whose response reports `url`, the way a real fetch would. */
function httpErrorFor(url: string): NotFoundError {
  const response = new Response(null, { status: 404 });
  // `response.url` is read-only and empty on a synthesised Response.
  Object.defineProperty(response, "url", { value: url });
  return new NotFoundError(response);
}

/**
 * What a redaction must do with one of these shapes: lose the credential and
 * keep the origin, which is the whole trade `redact-url.ts` documents. Asserted
 * together so a fix cannot pass by collapsing the url to the empty string.
 */
function expectRedacted(url: string): void {
  const redacted = redactUrl(url);

  expect(redacted, `redactUrl kept the password: ${redacted}`).not.toContain(PASSWORD);
  expect(new URL(redacted).host).toBe(new URL(url).host);
}

/**
 * R9-H3-01 — the raw pass anchors on the first `://`, which is not this url's
 * own authority when the authority is spelled without one.
 *
 * `https:/api.test/…`, `https:api.test/…`, and `https:\\api.test/…` all parse
 * to host `api.test` (the special-authority-slashes state treats the missing
 * solidus as a validation error and continues), so a caller's string in any of
 * those spellings reaches the same server and is recorded verbatim as
 * `error.url`. `rawAfterAuthority` then reads the EMBEDDED url's `://` as this
 * url's own, cuts the raw region after the credential, and the fix scans a
 * region the password is not in.
 */
describe("R9-H3-01 — an authority spelled without `://` moves the raw scan", () => {
  const SHAPES = [
    ["a single solidus", `https:/api.test/go/https://svc:${PASSWORD}?tail@internal.test/v1`],
    ["no solidus at all", `https:api.test/go/https://svc:${PASSWORD}?tail@internal.test/v1`],
    ["backslashes", `https:\\\\api.test/go/https://svc:${PASSWORD}?tail@internal.test/v1`],
    [
      "a single solidus and a `#` terminator",
      `https:/api.test/go/https://svc:${PASSWORD}#tail@internal.test/v1`,
    ],
  ] as const;

  test.each(SHAPES)("redactUrl drops the embedded credential — %s", (_label, url) => {
    expectRedacted(url);
  });

  test("CONTROL: the same url spelled with `://` is already redacted", () => {
    // Round 8's shape, unchanged. It is what makes the four above a defect in
    // the ANCHOR rather than a gap in the scan.
    //
    // ROUND 10 changed the BYTES this control pins, and nothing about what it
    // controls for. `internal.test/v1` is QUERY text — the parser hands
    // everything after `?tail` to the query state — and round 9 emitted it as
    // path because the removed span had swallowed the `?` that started it. That
    // is R10-H3-01: a span that crosses the `?` promotes the query into the
    // path the redactor keeps, and names a host the request never named. The
    // same mechanism carried `sig=QUERY_TOKEN_SECRET` out through all seven
    // channels for `/proxy/https://cdn.test/img?owner=alice@example.com&sig=…`,
    // so the two are one defect and no rule separates them. A query byte is
    // never emitted now: the `@` is still LOOKED FOR past the cut, so the
    // truncated password still goes, and the removal is clipped at `pathname`.
    // The control's own claim — this shape needs no raw anchor to be redacted —
    // is asserted below exactly as it always was.
    const url = `https://api.test/go/https://svc:${PASSWORD}?tail@internal.test/v1`;

    expect(redactUrl(url)).toBe("https://api.test/go/https://");
    expect(redactUrl(url)).not.toContain(PASSWORD);
    expect(new URL(redactUrl(url)).host).toBe(new URL(url).host);
  });

  test("no channel of an HTTP error carries the password", async () => {
    const error = httpErrorFor(`https:/api.test/go/https://svc:${PASSWORD}?tail@internal.test/v1`);

    try {
      expect(leakingChannels(everyChannel(error), [PASSWORD])).toEqual([]);
      // The escape hatch still holds the whole href, as it does for every
      // other shape the redactor removes.
      expect(error.url).toContain(PASSWORD);
    } finally {
      await error.cancel();
    }
  });

  test("no channel of a request failure carries the password", async () => {
    // Through the public interface, with no hostile input at all: a string url
    // is serialized once with `String(url)`, so `error.url` is the caller's own
    // spelling and the redactor is the only thing between it and the record.
    const url = `https:/api.test/go/https://svc:${PASSWORD}?tail@internal.test/v1`;
    const result = await typedFetch(url, {
      fetch: () => Promise.reject(new TypeError("fetch failed")),
    });

    expect(isNetworkError(result.error)).toBe(true);
    expect(leakingChannels(everyChannel(result.error as NetworkError), [PASSWORD])).toEqual([]);
  });
});

/**
 * R9-H3-02 — the raw pass looks for a mark the PARSER creates.
 *
 * `malformedUserinfoSpans` searches for the literal `://`. For a special scheme
 * the URL parser rewrites `\` to `/`, and it removes every ASCII tab, CR, and
 * LF from the input before parsing at all — so `https:\\svc:…` and
 * `https:<TAB>//svc:…` spell an authority the raw text does not contain. The
 * absolute branch's other pass reads `parsed.pathname`, where the mark does
 * exist; but a `?` or `#` inside the credential has already ended the path
 * there, so the `@` the scan needs is gone and the password stays.
 *
 * Each half is separately known. `redact-url.spec.ts` pins the backslash form
 * without a terminator, and round 8 pinned the terminator with a `://`. Their
 * composition is what neither pass sees.
 */
describe("R9-H3-02 — an embedded authority the parser has to spell out", () => {
  const SHAPES = [
    ["backslashes", `https://api.test/go/https:\\\\svc:${PASSWORD}?tail@internal.test/v1`],
    ["an ASCII tab", `https://api.test/go/https:\t//svc:${PASSWORD}?tail@internal.test/v1`],
    ["a CR", `https://api.test/go/https:\r//svc:${PASSWORD}?tail@internal.test/v1`],
    ["an LF", `https://api.test/go/https:/\n/svc:${PASSWORD}?tail@internal.test/v1`],
    [
      "backslashes and a `#` terminator",
      `https://api.test/go/https:\\\\svc:${PASSWORD}#tail@internal.test/v1`,
    ],
  ] as const;

  test.each(SHAPES)("redactUrl drops the embedded credential — %s", (_label, url) => {
    expectRedacted(url);
  });

  test("CONTROL: the same spelling without a terminator is already redacted", () => {
    // The pathname scan reaches it here, because nothing cut the path before
    // the `@`. That is what makes the five above a defect in the RAW pass.
    expect(redactUrl(`https://api.test/go/https:\\\\svc:${PASSWORD}@internal.test/v1`)).toBe(
      "https://api.test/go/https://internal.test/v1",
    );
  });

  test("no channel of an HTTP error carries the respelled password", async () => {
    const error = httpErrorFor(
      `https://api.test/go/https:\\\\svc:${PASSWORD}?tail@internal.test/v1`,
    );

    try {
      expect(leakingChannels(everyChannel(error), [PASSWORD])).toEqual([]);
      expect(error.url).toContain(PASSWORD);
    } finally {
      await error.cancel();
    }
  });

  test("a message that quotes the url loses the password too", () => {
    // The public pre-response constructors take the platform's own text, which
    // is the case `redactUrlInMessage` exists for: undici reports a refused
    // credentialed url by quoting it back, verbatim, into the one string every
    // log line carries.
    const url = `https://api.test/go/https:\\\\svc:${PASSWORD}?tail@internal.test/v1`;
    const error = new NetworkError(
      `Request cannot be constructed from a URL that includes credentials: ${url}`,
      { url },
    );

    expect(leakingChannels(everyChannel(error), [PASSWORD])).toEqual([]);
    expect(error.url).toContain(PASSWORD);
  });
});
