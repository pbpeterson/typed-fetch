import { describe, test, expect } from "vitest";
import { typedFetch, isNetworkError } from "./src/index";
import { NetworkError, NotFoundError } from "./src/errors";
import { redactUrl } from "./src/errors/redact-url";
import { PASSWORD, everyChannel, leakingChannels } from "./fixtures/channels";

/**
 * ROUND 10, LANE H3 — disclosure and security.
 *
 * The subject is round 9's rebuild. `cleaned` scans one text —
 * `pathname + search + hash`, the parser's own rendering of everything after
 * the authority — removes every malformed-userinfo span from it, and REBUILDS
 * the url as `origin + clean`. Its comment states the reason the three slots
 * are concatenated: "a removed span can cross the `?` or `#` that ended
 * `pathname`, so there is no single slot to write the result back to".
 *
 * A span that crosses the `?` takes the `?` WITH IT. Everything the query held
 * after the span's closing `@` is then ordinary path text in `origin + clean`,
 * the rebuilt url has no query at all, and `stripValues` has nothing left to
 * clear. The query survives into `error.url`, into the `toJSON()` record, and
 * into every channel that renders it.
 *
 * That is the one thing this module promises unconditionally. Its own header
 * says it: "It keeps the origin and path of a hierarchical URL. It drops
 * userinfo, the whole query, and the fragment." The stated residual is a secret
 * in a PATH SEGMENT, and `SECURITY.md` repeats the same limit. A query token is
 * on the other side of that line.
 *
 * The trigger is a span that OPENS in the path and CLOSES after the `?`, which
 * needs two ordinary things and no malformed spelling at all:
 *
 *  - a path that embeds a url — `/proxy/https://cdn.test/img`, the shape an
 *    image proxy, an oEmbed endpoint, a link shortener, and an OAuth callback
 *    all write, and the shape `malformedUserinfoSpans` exists to read;
 *  - an `@` in the query that is not this url's credential — `?owner=alice@
 *    example.com`, an e-mail address in a query parameter.
 *
 * The region opens after `https://` in the path. Nothing closes it, because a
 * region closes only at the next `://` and there is none, so it runs to the end
 * of the concatenated text and takes the LAST `@` in the url — the one in the
 * e-mail address. `looksLikeUserinfo` says userinfo, because that `@` does not
 * follow a `/`. The span removed is `cdn.test/img?owner=alice@`, and the `?`
 * goes with it.
 *
 * The same span also REWRITES the url it kept. The emitted string reads
 * `https://api.test/proxy/https://example.com&sig=…`: a diagnostic naming a
 * proxy to `example.com`, a host this url never named, in place of the
 * `cdn.test` it did. `cleaned` argues that a redaction can never move the host,
 * and that argument holds for the OUTER host, which lives in `origin`. It does
 * not hold for a host the path names.
 *
 * BOTH BRANCHES, because both call `cleaned`: the absolute branch rebuilds on
 * `${protocol}//${host}` and answers with `.href`, the relative branch rebuilds
 * on `RELATIVE_BASE` and answers with `.pathname`.
 *
 * ONE NOTE FOR WHOEVER FIXES THIS, because it is the reason the assertions
 * below say what they say. Round 8's shape
 * `https://api.test/go/https://svc:hunter2?tail@internal.test/v1` promotes the
 * query the same way — `internal.test/v1` is query text too — and
 * `redact-url.spec.ts` pins that promoted string EXACTLY as the expected value.
 * The password is gone there, so nothing about round 8's finding is disputed;
 * what is pinned is a byte count, not a rule. Every assertion here therefore
 * states only that a value slot's bytes must not be emitted, and none of them
 * states what replaces them — clipping a span at the `pathname` boundary and
 * dropping the query outright satisfies this file, `redaction-query-terminator.spec.ts`,
 * and `redaction-authority-spelling.spec.ts`, and changes the exact strings
 * `redact-url.spec.ts` pins for the round 8 shape.
 */

/** Planted in the query. `disclosure-channels.spec.ts` uses the same name. */
const QUERY_TOKEN_SECRET = "QUERY_TOKEN_SECRET";

/** Planted in the fragment, for the same reason. */
const FRAGMENT_SECRET = "FRAGMENT_SECRET";

/** An HTTP error whose response reports `url`, the way a real fetch would. */
function httpErrorFor(url: string): NotFoundError {
  const response = new Response(null, { status: 404 });
  // `response.url` is read-only and empty on a synthesised Response.
  Object.defineProperty(response, "url", { value: url });
  return new NotFoundError(response);
}

/**
 * R10-H3-01 — a removed span that crosses the `?` promotes the query into the
 * path the redactor keeps.
 *
 * Each shape below carries its secret in the QUERY or the FRAGMENT, the two
 * slots `redactUrl` drops outright. The assertion is only that: no byte the
 * caller wrote after the `?` or the `#` may appear in the redacted form. It
 * says nothing about how much of the path a fix keeps, so over-redacting the
 * path is a legal fix and under-redacting the query is not.
 */
describe("R10-H3-01 — the query survives a span that swallows its `?`", () => {
  const SHAPES = [
    [
      "an image proxy, an e-mail in the query, and a signature",
      `https://api.test/proxy/https://cdn.test/img?owner=alice@example.com&sig=${QUERY_TOKEN_SECRET}`,
      QUERY_TOKEN_SECRET,
    ],
    [
      "an embedded credential the redactor does remove, and a token it does not",
      `https://api.test/go/https://svc:${PASSWORD}@internal.test/v1?invite=bob@example.com&token=${QUERY_TOKEN_SECRET}`,
      QUERY_TOKEN_SECRET,
    ],
    [
      "a single-solidus embedded authority, the round 9 spelling",
      `https://api.test/a:/b?invite=bob@example.com&token=${QUERY_TOKEN_SECRET}`,
      QUERY_TOKEN_SECRET,
    ],
    [
      "the fragment, through the same span",
      `https://api.test/proxy/https://cdn.test/img#thread@post-${FRAGMENT_SECRET}`,
      FRAGMENT_SECRET,
    ],
  ] as const;

  test.each(SHAPES)("redactUrl drops the query and the fragment — %s", (_label, url, secret) => {
    const redacted = redactUrl(url);

    expect(redacted, `redactUrl kept ${secret}: ${redacted}`).not.toContain(secret);
    // The other half of the trade, asserted together so a fix cannot pass by
    // collapsing the url to nothing.
    expect(new URL(redacted).host).toBe(new URL(url).host);
  });

  test("the relative branch rebuilds on the same text", () => {
    // `fetch("/proxy/…")` in a browser or a worker. The branch answers with
    // `.pathname`, so the promoted query reaches the caller the same way.
    const url = `/proxy/https://cdn.test/img?owner=alice@example.com&sig=${QUERY_TOKEN_SECRET}`;
    const redacted = redactUrl(url);

    expect(redacted, `redactUrl kept the query: ${redacted}`).not.toContain(QUERY_TOKEN_SECRET);
  });

  test("CONTROL: the same query with no span to swallow its `?` is dropped", () => {
    // No embedded authority in the PATH, so no region opens before the `?` and
    // `stripValues` clears the query it still has. This is what makes the
    // shapes above a defect in the rebuild rather than a gap in the drop.
    expect(
      redactUrl(
        `https://api.test/proxy/img?src=https://cdn.test/a.png&owner=alice@example.com&sig=${QUERY_TOKEN_SECRET}`,
      ),
    ).toBe("https://api.test/proxy/img");
  });

  test("CONTROL: a span that ends BEFORE the `?` leaves the query to be dropped", () => {
    // The same region, the same `looksLikeUserinfo` verdict, the same removal —
    // and the `?` survives it, so `stripValues` still clears the query. The one
    // difference from the shapes above is where the span ENDS.
    expect(
      redactUrl(
        `https://api.test/proxy/https://cdn.test/img/alice@example.com?sig=${QUERY_TOKEN_SECRET}`,
      ),
    ).toBe("https://api.test/proxy/https://example.com");
  });

  test("the redaction does not name a host the url never named", () => {
    // The span removed `cdn.test/img?owner=alice@`, so the text after the `@`
    // moved up against the `https://` that opened the region. A reader of
    // `error.url` is told this request proxied `example.com`.
    const redacted = redactUrl(
      `https://api.test/proxy/https://cdn.test/img?owner=alice@example.com&sig=${QUERY_TOKEN_SECRET}`,
    );

    expect(redacted, `redactUrl invented an authority: ${redacted}`).not.toContain(
      "https://example.com",
    );
  });

  test("no channel of an HTTP error carries the query token", async () => {
    const error = httpErrorFor(
      `https://api.test/proxy/https://cdn.test/img?owner=alice@example.com&sig=${QUERY_TOKEN_SECRET}`,
    );

    try {
      expect(leakingChannels(everyChannel(error), [QUERY_TOKEN_SECRET])).toEqual([]);
      // The escape hatch still holds the whole href, as it does for every
      // other value the redactor removes.
      expect(error.url).toContain(QUERY_TOKEN_SECRET);
    } finally {
      await error.cancel();
    }
  });

  test("no channel of a request failure carries the query token", async () => {
    // Through the public interface, with no hostile input at all: a string url
    // is serialized once, so `error.url` is the caller's own spelling and the
    // redactor is the only thing between it and the record.
    const url = `https://api.test/proxy/https://cdn.test/img?owner=alice@example.com&sig=${QUERY_TOKEN_SECRET}`;
    const result = await typedFetch(url, {
      fetch: () => Promise.reject(new TypeError("fetch failed")),
    });

    expect(isNetworkError(result.error)).toBe(true);
    expect(
      leakingChannels(everyChannel(result.error as NetworkError), [QUERY_TOKEN_SECRET]),
    ).toEqual([]);
  });

  test("a message that quotes the url loses the query token too", () => {
    // The pre-response constructors are public API, and a consumer wrapping an
    // adapter passes the platform's own text — which quotes the caller's url
    // back in full.
    const url = `https://api.test/proxy/https://cdn.test/img?owner=alice@example.com&sig=${QUERY_TOKEN_SECRET}`;
    const error = new NetworkError(`Failed to parse URL from ${url}`, { url });

    expect(leakingChannels(everyChannel(error), [QUERY_TOKEN_SECRET])).toEqual([]);
    expect(error.url).toContain(QUERY_TOKEN_SECRET);
  });
});
