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
    return cleaned(parsed, `${parsed.protocol}//${parsed.host}`).href;
  } catch {
    // Not absolute. Fall through rather than nest: the relative case is
    // ordinary, not exceptional.
  }
  try {
    // The RAW input decides whether this resolves at all, and it is asked
    // FIRST. A parse error has to stay one: `file://alice:pw@host/v1` and
    // `http://alice:pw@/v1` are invalid, and they must keep collapsing to the
    // documented no-URL value instead of becoming resolvable once a credential
    // is removed. Nothing below edits the input — {@link cleaned} scans what
    // the parser EMITTED — so that ordering is structural here rather than a
    // rule to remember.
    return cleaned(new URL(url, RELATIVE_BASE), RELATIVE_BASE).pathname;
  } catch {
    return "";
  }
}

/**
 * `parsed` with every value slot cleared and every userinfo hidden after its
 * authority removed, rebuilt on `origin`.
 *
 * ONE TEXT, and that is the whole of this module's redaction rule.
 *
 * Rounds 5 and 8 each fixed a place where this module compared two texts the
 * URL parser does not agree about — the raw input, and the normalized parse.
 * Round 9 broke that comparison twice more, in both directions at once, which
 * is the signal that the comparison itself was the defect:
 *
 *  - The parser CREATES marks the raw text never spelled. It removes every
 *    ASCII tab, CR, and LF from the input before parsing, and it reads `\` as
 *    `/` for a special scheme, so `/go/https:\\svc:pw@host` and
 *    `/go/https:<TAB>//svc:pw@host` are authorities only after parsing.
 *  - The parser accepts marks the raw scan cannot find. `https:/host`,
 *    `https:host`, and `https:\\host` all reach the authority state — the
 *    special-authority-slashes state raises a validation error and carries on —
 *    so "the first `://` in the raw text" is not this url's own authority, and
 *    a raw scan anchored on it started AFTER an embedded credential.
 *
 * So the scan reads no raw text at all. `pathname + search + hash` is the
 * parser's own rendering of everything after this url's authority, in one
 * contiguous string, which answers both halves at once: the marks are the ones
 * the parser wrote, and the authority is wherever the parser found it, however
 * the caller spelled it.
 *
 * CONCATENATED, not `pathname` alone, because the parser CUTS. The path state
 * hands everything after the first `?` or `#` to the query state, so
 * `/go/https://svc:hun?ter2@host/v1` emits the pathname `/go/https://svc:hun` —
 * an authority truncated mid-credential, with no `@` left to find and half the
 * password still in it. The three slots put back what the cut took apart.
 *
 * RE-PARSED, not patched: a removed span can cross the `?` or `#` that ended
 * `pathname`, so there is no single slot to write the result back to, and
 * `url.pathname = …` would percent-encode a surviving `?` into the path instead
 * of letting it start a query that `stripValues` then drops.
 *
 * The rebuild takes `origin` and a path, and the path always begins with the
 * `/` no span can reach. The narrowest mark this module reads is a colon and
 * one solidus, and index 0 of `pathname` is already a `/`, so the earliest
 * colon sits at index 1 and the earliest span starts at index 3. So a redaction
 * can move text out of this url, and can never move the HOST it names: a
 * redaction that lies is worse than one that leaks.
 */
function cleaned(parsed: URL, origin: string): URL {
  const afterAuthority = parsed.pathname + parsed.search + parsed.hash;
  const clean = withoutMalformedUserinfo(afterAuthority);
  return stripValues(clean === afterAuthority ? parsed : new URL(origin + clean));
}

/**
 * The authority mark spelled IN FULL, which is the only thing that ever CLOSES
 * a region. What opens one is wider — see {@link nextAuthority} and the rule on
 * {@link malformedUserinfoSpans}.
 */
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
 * A region STARTS at a scheme colon and every solidus after it, and it ENDS at
 * the next `://`. Those are two different marks on purpose, and round 9 closed
 * a leak by separating them.
 *
 * The START has to be the wide mark. A special scheme reaches its authority
 * over any number of solidi, so `https:/svc:pw@host` inside a path is an
 * embedded credential — and it is not exotic: every slash-collapsing proxy and
 * every `path.join` turns an ordinary `/go/https://svc:pw@host` into exactly
 * that spelling before this library ever sees it.
 *
 * The END has to stay the narrow one. Ending a region at a delimiter let the
 * password choose where its own authority stopped: a `\` in a credential is
 * rewritten to `/` by the parser before this scan runs, and
 * `://svc:hun\ter2@internal.test/v1` then emitted the whole password. Widening
 * the END to the start mark hands a password the same power back through a
 * different spelling — `://svc:hun:/ter2@host` would cut its region at the
 * `:/` the password itself wrote and emit `svc:hun`. So the wide mark opens a
 * region and only the three characters the parser itself writes ever close one.
 *
 * The regions a wide start opens OVERLAP, where the marks the narrow end reads
 * partition. Each is tried in turn and the first that holds a credential wins,
 * so the span is the OUTERMOST reading — over-redaction, which is this module's
 * safe direction, and never a second span nested inside a removed one.
 *
 * A REGION IS ALSO WHAT A LATER MARK CAN CUT SHORT, and that is the rule's own
 * residual, stated because it is under-redaction rather than over. A credential
 * with no `@` of its own inside its region keeps nothing to anchor on when the
 * text after it spells a mark:
 * `/go/https://svc:hunter2?a=://b@c` puts the only `@` in the NEXT region, so
 * `svc:hunter2` reads as a host and a port and survives. It is not closable
 * here — a region that ran on past a mark whenever it found no `@` would delete
 * `host1` from `://host1/x://u2:pw@host2/v1`, which the suite pins as a path
 * this module keeps. What it costs is bounded by residual 2: the surviving text
 * is a path segment, the query and the fragment are still dropped, and
 * `error.url` still holds the whole href.
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
  // Three cursors, all of which only ever move FORWARD, which is what keeps
  // this one pass over the input now that the regions overlap. `stop` is the
  // end of the current region, `scanned` is how much of `text` the `@` search
  // has read, and `lastAt` is the last `@` it found there.
  //
  // Backward searches are what made an earlier form quadratic in the number of
  // marks — `lastIndexOf("@", stop - 1)` walks to index 0 whenever a region
  // holds no `@`, and 96 KB of repeated marks took 855 ms against 0.23 ms for
  // one forward pass. Overlapping regions would have brought that cost back
  // through the other side: re-reading a shared `stop` per region, or slicing
  // the candidate out to test it, is the same quadratic wearing a new mark.
  let stop = text.indexOf(AUTHORITY_MARK);
  let scanned = 0;
  let lastAt = -1;
  for (;;) {
    const authority = nextAuthority(text, from);
    if (authority === null) break;
    const start = authority.start;
    if (stop >= 0 && stop < start) stop = text.indexOf(AUTHORITY_MARK, start);
    const end = stop < 0 ? text.length : stop;
    while (scanned < end) {
      if (text[scanned] === "@") lastAt = scanned;
      scanned += 1;
    }
    if (lastAt >= start && looksLikeUserinfo(text, start, lastAt, authority.solidi)) {
      spans.push({ start, end: lastAt + 1 });
      // Past the `@` this region ended on: any region opening inside the span
      // just removed reads the same `@` and nests inside it.
      from = lastAt + 1;
    } else {
      from = start;
    }
  }
  return spans;
}

/**
 * Where the authority after the next scheme colon begins, and how many solidi
 * spelled the mark. `null` once no mark is left.
 *
 * EVERY solidus is consumed, because the parser consumes every one:
 * `https:///host` and `https:/host` name the host `https://host` names. See
 * {@link isSolidus}.
 */
function nextAuthority(text: string, from: number): { start: number; solidi: number } | null {
  for (let colon = text.indexOf(":", from); colon >= 0; colon = text.indexOf(":", colon + 1)) {
    let start = colon + 1;
    while (isSolidus(text[start])) start += 1;
    if (start > colon + 1) return { start, solidi: start - colon - 1 };
  }
  return null;
}

/**
 * `/` and `\`.
 *
 * A special scheme reaches its authority over either one, in any number: the
 * special-authority-slashes state treats a missing solidus as a validation
 * error and continues, and the special-authority-ignore-slashes state skips `\`
 * exactly as it skips `/`. So `https:/host`, `https:host`, and `https:\\host`
 * all name the host `https://host` names.
 */
function isSolidus(character: string | undefined): boolean {
  return character === "/" || character === "\\";
}

/**
 * Is `text[start, end)` — an authority mark, then everything up to an `@` — a
 * credential, or a path?
 *
 * BOUNDS rather than a substring, and that is not a micro-optimization. The
 * regions overlap now, so one `@` is tested once per mark before it, and
 * slicing each candidate out would make the scan quadratic in the number of
 * marks all over again. See {@link malformedUserinfoSpans}.
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
 * The third rule needs the mark spelled IN FULL, and `solidi` is why this
 * function counts them. A single solidus is the weakest mark there is, and an
 * ordinary path spells one: `file:///c:/Users/alice@corp/x` holds a Windows
 * drive letter, not a scheme, and the URL Standard carves that shape out by
 * name. The first two rules still read `https:/svc:pw@host` as the credential
 * it is — a credential is `user:password`, or a token with no `/` in it — but
 * reading a `/`-bearing token as one takes the two solidi the parser's own
 * spelling has. That leaves a residual, stated rather than hidden: a
 * standard-base64 token containing a `/`, behind a single-solidus scheme, is
 * kept as a path segment.
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
function looksLikeUserinfo(text: string, start: number, end: number, solidi: number): boolean {
  if (end === start) return true;
  const slash = text.indexOf("/", start);
  if (slash < 0 || slash >= end) return true;
  const colon = text.indexOf(":", start);
  if (colon >= 0 && colon < slash) return true;
  return solidi > 1 && text[end - 1] !== "/";
}

/**
 * The same string with every malformed authority's userinfo removed.
 *
 * Never applied to the INPUT — {@link cleaned} hands it what a URL parser
 * emitted, and {@link userinfosOf} hands it a slot of one. Which URLs resolve
 * stays the raw input's own answer to give.
 *
 * Percent-encoding does not weaken the scan where the delimiters are literal:
 * it removes the whole span up to the `@`, so an encoded password
 * (`hunter%202`) goes with it. An encoded DELIMITER is a different question and
 * the answer is residual 2 — `%3A%2F%2F` and `%40` spell no authority any
 * parser reads, so the text they hold is a path segment. See
 * `disclosure-channels.spec.ts`, which pins the shapes on each side of that
 * line.
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
 * The raw text after this URL's OWN authority.
 *
 * An embedded url can only hide past the outer authority, and the outer
 * authority is the one thing a raw scan must not read — `host:8443` is a port,
 * not a credential. Cutting at the first delimiter the URL grammar allows
 * gives the scan the region where an embedded credential lives, in the
 * spelling a message actually quotes.
 *
 * Anchored on the SCHEME, never on the first `://`. `https:/api.test/x`,
 * `https:api.test/x`, and `https:\\api.test/x` all name the host `api.test`,
 * and in each of them the first `://` belongs to an EMBEDDED url — so a cut
 * made there starts after the credential this scan exists to find. The scheme's
 * colon is the first colon a url that parsed can have, the solidi after it are
 * optional, and the authority runs to the first `/`, `\`, `?`, or `#`.
 *
 * The three characters the parser removes before parsing — ASCII tab, CR, and
 * LF — are skipped with the solidi, so a mark broken by one is still a mark.
 * They cannot appear in {@link cleaned}'s text at all, which is why this is the
 * one place that says so.
 */
function rawAfterAuthority(url: string): string {
  // TOTAL, with no guard for a missing colon: this only ever reads a url that
  // PARSED, and a url that parsed has a scheme. `indexOf` answering -1 would
  // start the scan at index 0, which is the same answer as an empty scheme.
  let at = url.indexOf(":") + 1;
  while (isSolidus(url[at]) || isIgnored(url[at])) at += 1;
  for (; at < url.length; at += 1) {
    const character = url[at];
    if (isSolidus(character) || character === "?" || character === "#") return url.slice(at);
  }
  return "";
}

/** The three characters the URL parser removes from its input before parsing. */
function isIgnored(character: string | undefined): boolean {
  return character === "\t" || character === "\n" || character === "\r";
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
      // FOUR slots, not three. The parseable branch reads `username`/`password`
      // FIRST, and the comment that said "the SAME three slots" left that one
      // out: a protocol-relative form — `\\alice:pw@host/v1` and every
      // tab/CR/LF variant the parser strips — hides a credential the parser
      // recovers into the authority rather than into a path.
      const resolvedOwn = resolved.password
        ? `${resolved.username}:${resolved.password}@`
        : `${resolved.username}@`;
      if ((resolved.username || resolved.password) && !needles.includes(resolvedOwn)) {
        needles.push(resolvedOwn);
      }
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
  //
  // And the RAW text too, for the mirror of the reason the relative branch
  // reads both forms: the parser REWRITES what it reads. A password holding a
  // backslash, a tab, a CR, or an LF becomes a needle that no longer matches
  // the text a platform quoted. The raw scan starts AFTER this url's own
  // authority, which is what keeps `host:8443` from being read as a
  // credential — the same guarantee "pathname, never href" buys.
  const embedded = [
    ...hiddenUserinfos(parsed.pathname),
    ...hiddenUserinfos(parsed.search),
    ...hiddenUserinfos(parsed.hash),
    ...hiddenUserinfos(rawAfterAuthority(url)),
  ];
  return [...own, ...embedded.filter((needle, at) => embedded.indexOf(needle) === at)];
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
 * overlapping ones are merged.
 *
 * TWO RESIDUALS, both stated because a previous version of this comment claimed
 * the union dominates the chained form, and it does not:
 *
 *  - The union is a union of the matches present in the ORIGINAL string.
 *    Chained `replaceAll` also matches text that only became adjacent when an
 *    earlier needle was removed. With the needles `tok@` and `svc:hunter2@`,
 *    the message `svc:huntok@ter2@host` loses both halves to the chained form
 *    and keeps `svc:hunter2@` here. Any single pass has this shape.
 *  - Where the two differ on OVERLAP, the union removes more, which is the safe
 *    direction this module takes everywhere else — and it costs the diagnostic
 *    the residual on {@link redactUrlInMessage} already names.
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
