/**
 * The URL, reduced to the part that is structure rather than a value.
 *
 * `toJSON()` emits header NAMES and never their values, because a logger calls
 * it on whatever it is handed and cannot judge a value nobody looked at. A URL
 * is the same problem wearing different syntax: `?access_token=…`, a signed
 * `?X-Amz-Signature=…`, and `https://user:password@host/` all carry a
 * credential in a slot the URL grammar marks as a VALUE.
 *
 * A deny list of sensitive query keys fails here for the reason it failed for
 * headers: the dangerous key is the one this library has never heard of.
 * {@link redactUrl} is structural instead. It keeps the origin and path of a
 * hierarchical URL. It drops userinfo, the whole query, and the fragment.
 *
 * RESIDUAL, stated rather than hidden: a secret in a hierarchical PATH SEGMENT
 * (`https://host/reset/RESET_TOKEN`) survives. Dropping the path would leave
 * `url` at the origin. That would prevent it from distinguishing concurrent
 * failures. The redactor treats a path as structure and a query as value.
 *
 * That trade only holds where the path NAMES something. A `data:` or `blob:`
 * URL carries its payload in the path instead, so the redactor keeps only the
 * scheme.
 *
 * The full href is never lost: `error.url` still holds it, exactly as
 * `error.headers` still holds every header value.
 */

/**
 * Base for a RELATIVE request URL. `fetch("/v1/thing?token=…")` is ordinary in
 * a browser or a worker, and it resolves against a document base this library
 * never sees. `.invalid` is reserved by RFC 2606 and can never be a real host.
 */
const RELATIVE_BASE = "http://url.invalid";

/** Clears every value slot in place and returns the same `URL`. */
function stripValues(parsed: URL): URL {
  parsed.username = "";
  parsed.password = "";
  parsed.search = "";
  parsed.hash = "";
  return parsed;
}

/**
 * The schemes whose PATH is structure rather than a value.
 *
 * These are the WHATWG "special" schemes, and the "path is structure" rule
 * above is a statement about them: the path names a resource on a host, and the
 * value slots are the separate ones this module clears.
 *
 * `fetch` also accepts OPAQUE schemes, and there the whole payload lives in the
 * path. A `data:` URL carries its bytes there, and a `blob:` URL carries an
 * unguessable handle to them. Emitting either verbatim would put the thing this
 * module exists to remove into `message` and into the `toJSON()` record, so an
 * the redactor reduces an opaque URL to its scheme.
 */
const HIERARCHICAL_PROTOCOLS = new Set(["http:", "https:", "ws:", "wss:", "ftp:", "file:"]);

/**
 * The href with every value slot removed: no userinfo, no query, no fragment.
 *
 * Total by construction. An empty string stays empty (the documented "no URL
 * could be resolved" value), a relative URL keeps its path, and an input that
 * parses as neither is emitted as a percent-encoded PATH — never as the raw
 * string, so a query or fragment hidden in it is still dropped. A userinfo
 * hidden in it is dropped too: the path is kept as structure, and userinfo is
 * unconditionally a value. See {@link malformedUserinfoSpans}.
 *
 * The redactor reduces an opaque URL to its scheme alone. See
 * {@link HIERARCHICAL_PROTOCOLS}.
 */
export function redactUrl(url: string): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return HIERARCHICAL_PROTOCOLS.has(parsed.protocol) ? stripValues(parsed).href : parsed.protocol;
  } catch {
    // Not absolute. Fall through rather than nest: the relative case is
    // ordinary, not exceptional.
  }
  try {
    // TWO resolutions, and the order is the point.
    //
    // The RAW input decides whether this resolves at all. That question must be
    // answered before any userinfo is taken out, or a parse error stops being
    // one: `file://alice:pw@host/v1` and `http://alice:pw@/v1` are invalid, and
    // they have to keep collapsing to the documented no-URL value instead of
    // becoming resolvable once the credential is removed.
    const resolved = stripValues(new URL(url, RELATIVE_BASE));
    if (malformedUserinfoSpans(url).length === 0) return resolved.pathname;

    // Once it does resolve, resolve again from the userinfo-free form. Removing
    // the spans from the EMITTED PATH instead is not enough: `stripValues`
    // clears the query first, so `://svc:hun?ter2@host/v1` arrives as
    // `/://svc:hun` — an authority truncated mid-credential, with no `@` left
    // to find and the first half of the password still in it.
    return stripValues(new URL(withoutMalformedUserinfo(url), RELATIVE_BASE)).pathname;
  } catch {
    return "";
  }
}

const AUTHORITY_MARK = "://";

/**
 * Every `[start, end)` span of userinfo in a string a URL parser did not treat
 * as one, in order.
 *
 * `://svc:hunter2@internal.test/v1` parses as neither absolute nor
 * protocol-relative, so it resolves against {@link RELATIVE_BASE} as a PATH —
 * and a path is the one slot this module keeps, so the credential rides inside
 * it. A template that produced an empty, spaced, or digit-led scheme is the
 * ordinary way to get here; the shape is malformed rather than exotic.
 *
 * Userinfo only exists in an AUTHORITY, and an authority only follows `://`.
 * That is what separates it from an ordinary `@` in a path (`/@scope/pkg`,
 * `/users/@alice`), which NAMES something and has to survive for the same
 * reason the rest of the path does.
 *
 * EVERY occurrence, not the first. Scanning one authority and giving up meant a
 * path with an embedded URL kept its credential —
 * `/go/http://plain.test/then/https://svc:hunter2@internal.test/v1` needs no
 * malformed scheme at all, only a forward or callback URL, which is the shape
 * that carries credentials in the first place.
 *
 * The region runs to the NEXT `://` rather than to the first `/`, `?`, or `#`.
 * Ending it at a delimiter let the password choose where the authority stopped:
 * a `\` in a credential is rewritten to `/` by the parser before this scan
 * runs, and `://svc:hun\ter2@internal.test/v1` then emitted the whole password.
 * The cost is over-redaction when a malformed URL's PATH holds an `@` after a
 * `://` (`://host/path/@alice` keeps only `alice`), and that is the trade this
 * module makes everywhere: userinfo is unconditionally a value, a path is
 * structure only until the two cannot be told apart.
 *
 * SPANS are returned rather than text: the same bytes can appear earlier in the
 * string (`svc:pw@x://svc:pw@host/`), and removing the wrong copy leaves the
 * credential exactly where it was.
 */
function malformedUserinfoSpans(text: string): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  let from = 0;
  for (;;) {
    const mark = text.indexOf(AUTHORITY_MARK, from);
    if (mark < 0) break;
    const start = mark + AUTHORITY_MARK.length;
    const next = text.indexOf(AUTHORITY_MARK, start);
    const stop = next < 0 ? text.length : next;
    const at = text.lastIndexOf("@", stop - 1);
    if (at >= start) spans.push({ start, end: at + 1 });
    if (next < 0) break;
    from = next;
  }
  return spans;
}

/**
 * The same string with every malformed authority's userinfo removed.
 *
 * Applied to the input only AFTER the raw input has proved it resolves — see
 * {@link redactUrl}. Which URLs resolve is the raw input's answer to give.
 *
 * Percent-encoding does not weaken the scan: it removes the whole span up to
 * the `@`, so an encoded password (`hunter%202`) goes with it.
 */
function withoutMalformedUserinfo(path: string): string {
  const spans = malformedUserinfoSpans(path);
  if (spans.length === 0) return path;

  let out = "";
  let cursor = 0;
  for (const span of spans) {
    out += path.slice(cursor, span.start);
    cursor = span.end;
  }
  return out + path.slice(cursor);
}

/**
 * Every userinfo the URL carries: `["user:password@"]`, `["user@"]`, or `[]`.
 *
 * A malformed URL can carry MORE than one, which is why this answers with a
 * list. See {@link malformedUserinfoSpans}.
 */
function userinfosOf(url: string): string[] {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // A malformed scheme hides userinfo from the parser, not from a reader.
    return malformedUserinfoSpans(url).map((span) => url.slice(span.start, span.end));
  }
  const { username, password } = parsed;
  if (!username && !password) return [];
  return [password ? `${username}:${password}@` : `${username}@`];
}

/**
 * Does this URL carry a slot a secret can sit in?
 *
 * An ABSOLUTE URL always can — userinfo, query, fragment, and an opaque scheme
 * whose whole body is the datum. A RELATIVE one only carries a slot when it
 * spells one, and without a slot its redacted form differs from the original
 * through normalization alone (`a` becomes `/a`), which is a rewrite with
 * nothing to gain and a diagnostic to lose.
 */
function hasRedactableSlot(url: string): boolean {
  try {
    // The read is what makes this a parse rather than a discarded `new`.
    // `URL.canParse` would say the same thing and is not on every runtime this
    // module already supports through `try`/`catch`.
    return Boolean(new URL(url).protocol);
  } catch {
    return url.includes("@") || url.includes("?") || url.includes("#");
  }
}

/**
 * Replace a URL this error already holds wherever it appears in a message.
 *
 * `message` is not always ours. `classifyRequestFailure` copies the platform's
 * rejection message into `NetworkError`, and undici rejects a credentialed URL
 * with `TypeError: Request cannot be constructed from a URL that includes
 * credentials: http://alice:hunter2@host/x` — a password, verbatim, in the one
 * string every log line carries.
 *
 * This is NOT a search for secrets in free text; that would be the deny list
 * again. It replaces a value we ALREADY HOLD (`url`) with its redacted form,
 * which is deterministic and needs no knowledge of the message's wording, so it
 * works on every runtime.
 *
 * BEST EFFORT, and deliberately so: a platform that re-serializes the URL
 * before putting it in its message defeats the exact-string replacement. The
 * userinfo pass is the second line — userinfo is unconditionally a credential,
 * so it is removed wherever it survives — and `toJSON()` redacts `url`
 * independently, so a miss here never reaches the record.
 */
export function redactUrlInMessage(message: string, url: string): string {
  if (!url) return message;
  const redacted = redactUrl(url);
  // The replacer is a FUNCTION, not a string: a string replacement interprets
  // `$&`, `$'` and friends, and a path may legitimately contain `$`.
  //
  // BOUNDED, the way `redactRefusedHeaderValues` is bounded. `replaceAll` has
  // no notion of how distinctive its needle is, and this needle is the caller's
  // url — which can be one character. `typedFetch("a")` rejects with
  // `Failed to parse URL from a`; `redactUrl("a")` is `/a`, so the pass fired
  // and rewrote every `a` in the platform's own wording:
  // `F/ailed to p/arse URL from /a`.
  //
  // The pass only ever has work to do when the url carries a slot a secret can
  // sit in. An absolute url always might. A RELATIVE one differs from its
  // redacted form through normalization alone unless it holds a userinfo, a
  // query, or a fragment — and with none of those there is nothing to remove,
  // so running the replacement can only corrupt the diagnostic.
  let out =
    url === redacted || !hasRedactableSlot(url) ? message : message.replaceAll(url, () => redacted);
  for (const userinfo of userinfosOf(url)) out = out.replaceAll(userinfo, () => "");
  return out;
}
