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
    if (!HIERARCHICAL_PROTOCOLS.has(parsed.protocol)) return parsed.protocol;
    stripValues(parsed);
    // The PATH of a well-formed URL can embed another URL, credential and all —
    // `https://api.test/go/https://svc:pw@internal.test/v1` is an ordinary
    // forward, and `stripValues` only clears this URL's own value slots. The
    // relative branch below has scanned for that since the embedded-credential
    // fix; the absolute branch returned the href and never looked.
    //
    // The PATHNAME, never the href: the authority this URL really has is
    // `host:8443`, and a scan over the href would read that port as userinfo.
    parsed.pathname = withoutMalformedUserinfo(parsed.pathname);
    return parsed.href;
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
    // BOTH forms, because the parser CREATES the mark this scan looks for. The
    // raw text of `/go/https:\\svc:pw@internal.test/v1` spells `:\\`, and an
    // ASCII tab, CR, or LF inside `https:<TAB>//svc:pw@…` is removed outright —
    // in each case the emitted `pathname` holds a `://` the raw string never
    // had, so a scan of the raw input alone finds nothing and emits the
    // password. The absolute branch above has read the normalized `pathname`
    // since the embedded-credential fix; this one still read the raw string.
    //
    // The RAW scan stays, and it runs FIRST, because removing the spans from
    // the emitted path is not enough on its own: `stripValues` clears the query
    // before this point, so `://svc:hun?ter2@host/v1` arrives as
    // `/://svc:hun` — an authority truncated mid-credential, with no `@` left
    // to find and the first half of the password still in it.
    //
    // The RAW input also decides whether this resolves at all. That question
    // must be answered before any userinfo is taken out, or a parse error stops
    // being one: `file://alice:pw@host/v1` and `http://alice:pw@/v1` are
    // invalid, and they have to keep collapsing to the documented no-URL value
    // instead of becoming resolvable once the credential is removed.
    if (malformedUserinfoSpans(url).length === 0) {
      return withoutMalformedUserinfo(resolved.pathname);
    }
    return withoutMalformedUserinfo(
      stripValues(new URL(withoutMalformedUserinfo(url), RELATIVE_BASE)).pathname,
    );
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
 *
 * Which leaves ONE question per `@`: is the text before it an authority, or a
 * path that happens to contain an `@`? {@link looksLikeUserinfo} answers it.
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

    // FORWARD over the region, not `lastIndexOf` backward from its end. The
    // regions partition the string, so a forward scan totals one pass over the
    // input. `lastIndexOf("@", stop - 1)` walks back to index 0 whenever the
    // region holds no `@`, which made the whole scan quadratic in the number of
    // `://` marks: 96 KB of repeated marks took 855 ms, against 0.23 ms for the
    // single-region scan this replaced. `redactUrl` runs it twice per call.
    let at = -1;
    for (let i = start; i < stop; i += 1) {
      if (text[i] === "@") at = i;
    }
    if (at >= start && looksLikeUserinfo(text.slice(start, at))) {
      spans.push({ start, end: at + 1 });
    }
    if (next < 0) break;
    from = next;
  }
  return spans;
}

/**
 * Is the text between `://` and an `@` a credential, or a path?
 *
 * Three shapes are userinfo, and everything else is a path this module keeps:
 *
 *  - NO `/` at all. `://token@host/x` is the username-only credential a bearer
 *    URL carries, and there is nothing else it could be.
 *  - A `:` BEFORE the first `/`. A credential is `user:password`, and the
 *    password is the part that can contain the delimiter that used to end the
 *    scan early — `svc:hun\ter2`, `svc:hun?ter2`.
 *  - The `@` does NOT follow a `/`. A path spells an `@` at the head of a
 *    segment — `/users/@alice`, `/@scope/pkg` — while a credential runs right
 *    up to it. This is what catches a standard-base64 token, whose alphabet
 *    includes `/`: `YWxpY2U/cGFzc3dvcmQ@host` has a slash and no colon, so the
 *    first two rules read it as a path and the whole credential survived.
 *
 * So `://api.test/users/@alice` keeps every segment it names.
 *
 * THREE RESIDUALS, all stated because the ambiguity is real and unresolvable
 * once a malformed scheme has taken away where the authority ends. The first
 * two are over-redaction:
 *
 *  - An authority with a PORT, followed by a path `@` (`://a:1234/x/@bob`).
 *    The colon rule cannot tell `a:1234` from `user:password`.
 *  - An `@` INSIDE a path segment rather than at its head (`://host/a/b@c/d`,
 *    an e-mail-shaped path).
 *
 * Over-redaction is the safe direction. It costs a diagnostic on a URL that was
 * already malformed; the other direction costs a password.
 *
 * The third is UNDER-redaction, and it is the price of the third rule above:
 *
 *  - A credential whose LAST character is `/` (`://dG9rZW4vcGFzc3dvcmQ/@host`,
 *    one base64 alphabet position in 64). The `@` follows a `/`, which is the
 *    one signal that tells a path segment head from a credential, so the rule
 *    reads it as a path and the token survives.
 *
 * This one is NOT closed, and the reason is that closing it removes a path the
 * redactor is required to keep. `://host/users/@alice` and `://token/@host`
 * spell the same three characters in the same order, and no structural rule
 * separates them. Reading both as userinfo would delete a named segment from
 * every `/@scope/pkg` and `/users/@alice` diagnostic. Reading neither is what
 * happens today. `redactUrl` still drops the query and the fragment, and the
 * full href stays on `error.url` — this rule only decides where a MALFORMED
 * authority ends.
 */
function looksLikeUserinfo(candidate: string): boolean {
  if (candidate === "") return true;
  const slash = candidate.indexOf("/");
  if (slash < 0) return true;
  const colon = candidate.indexOf(":");
  if (colon >= 0 && colon < slash) return true;
  return !candidate.endsWith("/");
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
 * Every userinfo an authority the parser did not read hides inside `text`.
 *
 * `"@"` ALONE is not a credential, and it is the one needle that must never
 * reach `replaceAll`. `://@host/x` yields a span of exactly one character, and
 * stripping every `@` from a message deletes e-mail addresses, handles, and
 * anything else the diagnostic was carrying.
 */
function hiddenUserinfos(text: string): string[] {
  return malformedUserinfoSpans(text)
    .map((span) => text.slice(span.start, span.end))
    .filter((userinfo) => userinfo.length > 1);
}

/**
 * Every userinfo the URL carries: `["user:password@"]`, `["user@"]`, or `[]`.
 *
 * A URL can carry MORE than one, which is why this answers with a list. A
 * malformed scheme hides userinfo from the parser, and a well-formed URL hides
 * it in the PATH, because a path can embed another URL, credential and all.
 * See {@link malformedUserinfoSpans}.
 */
function userinfosOf(url: string): string[] {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // A malformed scheme hides userinfo from the parser, not from a reader.
    //
    // BOTH forms, for the reason {@link redactUrl}'s relative branch reads
    // both: the parser CREATES the `://` this scan looks for when it rewrites
    // a backslash or removes an ASCII tab. The raw text carries the credential
    // a message quotes; the resolved path carries the mark that finds it.
    const needles = hiddenUserinfos(url);
    try {
      // The SAME three slots the parseable branch reads. Reading only the path
      // here left a credential that the parser normalized into a QUERY — the
      // two halves of this pass were fixed one round apart and never composed.
      const resolved = new URL(url, RELATIVE_BASE);
      for (const slot of [resolved.pathname, resolved.search, resolved.hash]) {
        for (const needle of hiddenUserinfos(slot)) {
          if (!needles.includes(needle)) needles.push(needle);
        }
      }
    } catch {
      // Unresolvable even against the base. The raw needles are all there are.
    }
    return needles;
  }
  const { username, password } = parsed;
  const own = username || password ? [password ? `${username}:${password}@` : `${username}@`] : [];
  // The path carries the SAME shape `redactUrl` scans for on this branch:
  // `https://api.test/go/https://svc:pw@internal.test/v1` is an ordinary
  // forward, and the parser reads only the outer authority. This pass is the
  // second line of {@link redactUrlInMessage} and removes userinfo wherever it
  // survives, so it reads the same slot the redactor does.
  //
  // The PATHNAME, never the href: the authority this URL really has is
  // `host:8443`, and a scan over the href would read that port as userinfo.
  //
  // The QUERY and the FRAGMENT are scanned for the same reason and carry none
  // of that risk. That argument is about THIS url's authority, which cannot
  // appear in either slot, and `redactUrl` drops both outright — so the only
  // place a credential hidden there can still surface is a message, which is
  // exactly what this pass exists to clean. A callback url carries its
  // redirect target in `?next=`, credential and all, more often than in a path
  // segment.
  const embedded = [
    ...hiddenUserinfos(parsed.pathname),
    ...hiddenUserinfos(parsed.search),
    ...hiddenUserinfos(parsed.hash),
  ];
  return [...own, ...embedded];
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
 * `message` is not always ours. `classifyRequestFailure` writes a library
 * constant now, but the three pre-response classes are PUBLIC API, and a
 * consumer wrapping an adapter passes the platform's own text: undici rejects a
 * credentialed URL with `TypeError: Request cannot be constructed from a URL
 * that includes credentials: http://alice:hunter2@host/x` — a password,
 * verbatim, in the one string every log line carries.
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
 *
 * RESIDUAL, and it is the price of reading the path, the query, and the
 * fragment for a hidden authority: a needle from one of those slots is removed
 * from the message WHEREVER it appears, including where it is not this url's
 * credential. A proxy url like
 * `https://api.test/avatar/https://gravatar.test/u/alice@example.com` yields
 * the needle `gravatar.test/u/alice@`, so a message naming that resource loses
 * the host and reads `…contacting example.com…`. The redactor keeps the same
 * segment in `url`, because there it is a path — so the two can name different
 * resources.
 *
 * Over-redaction is the safe direction, and it costs a diagnostic rather than a
 * password. It stays a residual rather than a fix because narrowing the needle
 * needs the caller's value a second time, which is the read the whole
 * library-authored-message rule exists to avoid.
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
  const out =
    url === redacted || !hasRedactableSlot(url) ? message : message.replaceAll(url, () => redacted);
  return withoutUserinfos(out, userinfosOf(url));
}

/**
 * The message with every needle in `userinfos` removed, in ONE pass over it.
 *
 * A `replaceAll` per needle reads the WHOLE message once per needle, and the
 * needle list grows with the credentials the caller's url embeds — so a
 * forwarding url with N of them cost N full scans of a message that also grows
 * with N. Measured before this: 1000 credentials took 10 ms, 4000 took 126 ms,
 * and 8000 took 435 ms, against 4.9 ms for the same input before the path scan
 * existed. Doubling the input multiplied the cost by nearly four.
 *
 * Every needle ends with `@`, which is what makes one pass possible: an `@` in
 * the message is the only place a needle can end, so each one is tested against
 * the lengths the needle set actually holds. The work is now the message's `@`
 * count times the number of DISTINCT needle lengths, and each test is a lookup
 * on a short slice rather than a scan of everything.
 *
 * UNION, not first-match-wins. Two needles OVERLAP whenever one authority's
 * userinfo runs to the last `@` in its region and another needle ends at an `@`
 * inside it — `alice@sso.test/svc:hunter2@` and `alice@` both come out of
 * `https://api.test/go/https://alice@sso.test/svc:hunter2@internal.test/v1`.
 * Taking the first match and skipping anything that reaches back into it left
 * the longer needle's tail — the password — in the message. Chained
 * `replaceAll` did not have that hole, because it resolved overlaps by NEEDLE
 * order rather than by position. So every match is collected and the
 * overlapping ones are merged: the union removes at least what the chained form
 * removed, and where the two differ it removes more, which is the safe
 * direction this module already takes everywhere else.
 */
function withoutUserinfos(message: string, userinfos: string[]): string {
  if (userinfos.length === 0) return message;

  const byLength = new Map<number, Set<string>>();
  for (const userinfo of userinfos) {
    const bucket = byLength.get(userinfo.length);
    if (bucket === undefined) byLength.set(userinfo.length, new Set([userinfo]));
    else bucket.add(userinfo);
  }

  // EVERY match, before any of them is applied. A needle that starts inside an
  // earlier match is the case that matters, so nothing can be decided until all
  // of them are known.
  const spans: { start: number; end: number }[] = [];
  for (let at = message.indexOf("@"); at >= 0; at = message.indexOf("@", at + 1)) {
    for (const [length, needles] of byLength) {
      const start = at + 1 - length;
      if (start < 0) continue;
      if (needles.has(message.slice(start, at + 1))) spans.push({ start, end: at + 1 });
    }
  }
  if (spans.length === 0) return message;

  spans.sort((left, right) => left.start - right.start);
  let out = "";
  let cursor = 0;
  for (const span of spans) {
    // Wholly inside the run already removed.
    if (span.end <= cursor) continue;
    if (span.start > cursor) out += message.slice(cursor, span.start);
    // Otherwise it overlaps the run, and the run simply extends over it.
    cursor = span.end;
  }
  return out + message.slice(cursor);
}
