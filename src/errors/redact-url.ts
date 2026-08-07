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
 * unconditionally a value. See {@link malformedUserinfoSpan}.
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
    return withoutMalformedUserinfo(stripValues(new URL(url, RELATIVE_BASE)).pathname);
  } catch {
    return "";
  }
}

/**
 * Where the userinfo sits in a string a URL parser did not treat as one, or
 * `null`.
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
 * The SPAN is returned rather than the text: the same bytes can appear earlier
 * in the string (`svc:pw@x://svc:pw@host/`), and removing the wrong copy leaves
 * the credential exactly where it was.
 */
function malformedUserinfoSpan(text: string): { start: number; end: number } | null {
  const mark = text.indexOf("://");
  if (mark < 0) return null;
  const start = mark + "://".length;
  let stop = text.length;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "/" || ch === "\\" || ch === "?" || ch === "#") {
      stop = i;
      break;
    }
  }
  const at = text.lastIndexOf("@", stop - 1);
  return at >= start ? { start, end: at + 1 } : null;
}

/**
 * The same string with a malformed authority's userinfo removed.
 *
 * Applied to the PATH the redactor is about to emit, never to the input. The
 * input decides which URLs resolve at all — `file://alice:pw@host/v1` and
 * `http://alice:pw@/v1` are parse errors, and they have to stay parse errors
 * that collapse to `""` rather than become resolvable once a credential is
 * taken out of them.
 *
 * Percent-encoding does not weaken the scan: it removes the whole span up to
 * the `@`, so an encoded password (`hunter%202`) goes with it.
 */
function withoutMalformedUserinfo(path: string): string {
  const span = malformedUserinfoSpan(path);
  return span ? path.slice(0, span.start) + path.slice(span.end) : path;
}

/** `"user:password@"`, `"user@"`, or `""` when the URL carries no userinfo. */
function userinfoOf(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // A malformed scheme hides userinfo from the parser, not from a reader.
    const span = malformedUserinfoSpan(url);
    return span ? url.slice(span.start, span.end) : "";
  }
  const { username, password } = parsed;
  if (!username && !password) return "";
  return password ? `${username}:${password}@` : `${username}@`;
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
  const userinfo = userinfoOf(url);
  if (userinfo) out = out.replaceAll(userinfo, () => "");
  return out;
}
