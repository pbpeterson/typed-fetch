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
 *
 * THREE OF ITS PROPERTIES ARE LOAD-BEARING, and round 13 found the third by
 * being bitten by it. They are written down so the next reader does not have to
 * discover them the same way.
 *
 *  - The HOST never reaches an answer: this branch emits `pathname` alone, and
 *    {@link cleaned} only rebuilds on the base to re-parse. It must merely be
 *    unresolvable, which `.invalid` is.
 *  - The scheme is SPECIAL, and that decides how the parser reads the input:
 *    `\` is a solidus, two solidi are protocol-relative, and the emitted path
 *    can never hold a `\` the module would have to read differently from a `/`.
 *    {@link isSolidus} and the relative branch's loop both rest on it. A
 *    non-special base would leave a `\` in `pathname`, and the loop's own
 *    termination bound — leading solidi plus a non-empty host consumed every
 *    pass — would no longer hold.
 *  - The scheme's IDENTITY decides which inputs the parser resolves rather than
 *    refuses. A reference whose scheme EQUALS a special base's goes to the
 *    special-relative-or-authority state and then to the relative state, so the
 *    parser eats the scheme colon and answers with a path; every other scheme
 *    reaches the authority state and fails here exactly as it failed absolutely.
 *    So `http:alice:pw@api.test:99999/v1` resolved to a path holding its own
 *    credential with no mark in front of it, while `https:`, `ws:` and `ftp:`
 *    spelling the same thing collapsed to the empty answer.
 *
 * The identity is no longer load-bearing, and the constant is unchanged because
 * changing it is what could not fix this: every special scheme collides with
 * the input that spells it, and every non-special one gives up the second
 * property above. {@link bringsOwnAuthority} answers for all six schemes
 * instead, so the state where the parser consumes the mark is handled wherever
 * the base's scheme happens to sit.
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
 * The same six schemes by NAME, which is the spelling a path holds them in.
 * Derived rather than written twice, so a scheme cannot be hierarchical here
 * and unknown there.
 */
const HIERARCHICAL_SCHEMES = new Set(
  [...HIERARCHICAL_PROTOCOLS].map((protocol) => protocol.slice(0, -1)),
);

/**
 * The schemes that reach their authority over ANY number of solidi, INCLUDING
 * NONE — the one property {@link isSpecialScheme} asks about.
 *
 * FIVE, NOT SIX, and the two lists MUST disagree about `file:`. It is a special
 * scheme, and it is the one special scheme the URL Standard gives a state of its
 * own: the file state reads a reference under fewer than two solidi as a path
 * with an EMPTY HOST, and never as an authority. `new URL("file:/svc:pw@host")`
 * and `new URL("file:svc:pw@host")` both report no username and the pathname
 * `/svc:pw@host`, exactly as `git:/svc:pw@host` does.
 *
 * So a `file:` colon under fewer than two solidi opens NOTHING, and reading one
 * as a mark deleted a segment of a real path: `/go/file:/Users/alice@corp/x`
 * emitted `/go/file:/corp/x`, which names a file the caller never requested. Two
 * or more solidi are a different state and are opened by their COUNT, in
 * {@link authorityAt}, under every scheme including this one.
 *
 * `file:` stays in {@link HIERARCHICAL_PROTOCOLS}, because that list answers a
 * different question — is this path structure rather than a value — and for a
 * `file:` URL the path IS the structure.
 */
const SPECIAL_SCHEMES = new Set([...HIERARCHICAL_SCHEMES].filter((scheme) => scheme !== "file"));

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
    let path = resolvedPath(url);
    // RESOLVED UNTIL IT STOPS MOVING, and that loop is round 12's second
    // finding read from the output side. This branch emits a PATH, and a path
    // that begins with two solidi is not a path to the next reader of it: the
    // URL Standard reads a relative reference beginning with two solidi as
    // protocol-relative, so `//svc:pw@internal.test/v1` names a host and
    // carries a credential in the authority the emitted text spells. The value
    // this function returns is handed to a logger, quoted into a message, and
    // read back by the same parser, so it has to mean the same thing on the
    // second read as on the first. Each pass resolves the authority the leading
    // solidi open and emits what is left, which is strictly shorter, so the
    // loop ends. An input that reduces to bare solidi resolves to no url at all
    // and falls to the documented empty answer below.
    //
    // ONE AUTHORITY PER PASS, AND THAT IS THE PARSER'S ARITHMETIC RATHER THAN A
    // CURSOR'S. `new URL("//a//b//c/x", base)` names the host `a` and answers
    // the path `//b//c/x`: a parse consumes exactly one authority, so a
    // reference spelling N of them costs N parses of a text that shrinks by one
    // group each time. Recorded rather than closed, and the two halves of that
    // decision are: 16 KB of `//a//` took 606 ms before round 15's cursor fix
    // and 682 ms after, so it is neither caused by that fix nor helped by it;
    // and the value is the CALLER's own relative url, never a redirect target,
    // because `response.url` is absolute and reaches the branch above. Closing
    // it means deciding where the last authority ends WITHOUT parsing to it,
    // which is a guard reading a different text from the one emitted — the
    // exact class rounds 13, 14 and 15 each found a defect in. The bound that
    // matters is stated on {@link cleaned}, and it holds here: each pass is a
    // `cleaned` of its own, and each runs a constant number of times.
    while (isSolidus(path[0]) && isSolidus(path[1])) {
      path = resolvedPath(path);
    }
    return path;
  } catch {
    return "";
  }
}

/** One pass of the relative branch: resolve, clean, emit the path. */
function resolvedPath(text: string): string {
  return cleaned(new URL(text, RELATIVE_BASE), RELATIVE_BASE, bringsOwnAuthority(text)).pathname;
}

/**
 * Does this relative reference bring its OWN authority, for the parser to
 * CONSUME the mark that opens it?
 *
 * TWO SPELLINGS, and they are the two ways the resolution against
 * {@link RELATIVE_BASE} can eat a mark the caller wrote:
 *
 *  - TWO SOLIDI. The reference is protocol-relative: the relative-slash state
 *    hands it to the authority state, so the parser takes its host from the
 *    reference and not from the base.
 *  - A HIERARCHICAL SCHEME at the head. `RELATIVE_BASE` is special, so a
 *    reference whose scheme EQUALS the base's goes to the
 *    special-relative-or-authority state and then to the relative state: the
 *    parser drops the scheme colon and reads the rest as a path against the
 *    base. `new URL("http:alice:pw@api.test:99999/v1", RELATIVE_BASE)` answers
 *    the path `/alice:pw@api.test:99999/v1` with the base's own host, and the
 *    mark that would have opened a region is gone. Asked of ALL SIX rather than
 *    of the base's own scheme: the other five reach this branch only when they
 *    already failed to parse absolutely, and they fail here for the same
 *    reason, so the answer never reaches a text — while a rule written around
 *    ONE scheme is a rule that a change of base silently invalidates. This is
 *    the one question in this module that reads all six, and `file:` belongs in
 *    it for a reason of its own: the file state eats the colon too, and hands
 *    what follows to the path state. See {@link SPECIAL_SCHEMES} for the
 *    question where the same scheme must answer the other way.
 *
 * WHAT THE PARSER DISCARDS IS SKIPPED IN BOTH, and the two removals are
 * DIFFERENT STEPS of the URL Standard rather than one set of characters. The
 * basic URL parser first removes every LEADING and trailing C0 control or space
 * — U+0000 to U+001F plus U+0020 — and then removes every ASCII tab and newline
 * WHEREVER it sits. So the head of the input is skipped with
 * {@link isStripped} and the inside with {@link isIgnored}, and one leading
 * space no longer moves the scheme out from under this walk while leaving it
 * exactly where the parser reads it. An interior space is removed by neither
 * step: it is a forbidden host code point, and in a path it is percent-encoded.
 *
 * `\` counts as a solidus because the base is special.
 *
 * ASKED OF THE INPUT, and it is the one question this module asks there. It is
 * a yes-or-no about the SHAPE of the parse, never a position in a text that
 * gets emitted — which is the whole of round 9's rule. What the answer selects
 * is {@link seamUserinfo}, and that span is the PARSER's, taken from the path
 * the parser itself produced.
 */
function bringsOwnAuthority(text: string): boolean {
  let at = 0;
  while (isStripped(text[at])) at += 1;
  if (isSolidus(text[at])) {
    at += 1;
    while (isIgnored(text[at])) at += 1;
    return isSolidus(text[at]);
  }
  return leadsWithHierarchicalScheme(text, at);
}

/**
 * Is the token at `from` one of the six {@link HIERARCHICAL_SCHEMES}, then a
 * colon?
 *
 * BOUNDED at the longest of them, so the walk costs the same whatever follows
 * it — the same reason {@link isSpecialScheme} reads forward from an offset
 * rather than backwards to a token start.
 */
const LONGEST_HIERARCHICAL_SCHEME = 5;

function leadsWithHierarchicalScheme(text: string, from: number): boolean {
  let scheme = "";
  for (let at = from; at < text.length; at += 1) {
    const character = text[at]!;
    if (isIgnored(character)) continue;
    if (character === ":") return HIERARCHICAL_SCHEMES.has(scheme.toLowerCase());
    if (scheme.length === LONGEST_HIERARCHICAL_SCHEME || !isSchemeCharacter(character))
      return false;
    scheme += character;
  }
  return false;
}

/**
 * `parsed` with every value slot cleared and every userinfo hidden after its
 * authority removed, rebuilt on `origin`.
 *
 * ONE TEXT, AND IT IS `pathname`. That is the whole of this module's redaction
 * rule, and the sentence below is the invariant every other comment here
 * serves: **every byte this function emits comes from `origin` or from
 * `parsed.pathname`.** Nothing from `search` or `hash` is ever emitted, under
 * any spelling, so the module's own header claim — "it drops userinfo, the
 * whole query, and the fragment" — holds by construction rather than by a rule
 * that has to be got right.
 *
 * Rounds 5, 8 and 9 each fixed a place where this module compared two texts the
 * URL parser does not agree about, and each fix was broken by a spelling the
 * previous rule had not anticipated. Round 9 answered by scanning
 * `pathname + search + hash` as one contiguous string, and that is what round 10
 * found: a removed span could OPEN in the path and CLOSE at an `@` in the
 * query, taking the `?` with it. Everything the query held after that `@` then
 * became ordinary path text in the rebuild —
 * `/proxy/https://cdn.test/img?owner=alice@example.com&sig=…` emitted a proxy to
 * `example.com` with the signature attached, naming a host the url never named
 * and shipping a query token through all seven channels. An `@` in a query
 * value is ordinary data, and treating it as a userinfo terminator is what
 * produced both halves of that.
 *
 * So a region never crosses a `?` or a `#`. The concatenated text is scanned in
 * exactly ONE state, and the parser decides which: the path state hands
 * everything after the first `?` or `#` to the query state, so `pathname` can
 * end INSIDE an embedded authority — `/go/https://svc:hun?ter2@host/v1` emits
 * the pathname `/go/https://svc:hun`, an authority truncated mid-credential with
 * no `@` left to find and half the password still in it. That is the one state
 * in which the cut is not a boundary of the embedded url, because the embedded
 * authority never reached one. {@link endsInsideAuthority} asks the question,
 * and the answer only ever widens where the `@` is LOOKED FOR. What is removed
 * is still clipped to `pathname`, so a credential the `?` cut in half goes and
 * the query still goes whole.
 *
 * RE-PARSED, not patched: `url.pathname = …` would percent-encode the marks a
 * kept embedded url spells, and the rebuild has to answer with a url a caller
 * can read.
 *
 * The rebuild takes `origin` and a path, and the path always begins with the
 * `/` no span can reach. Index 0 of `pathname` is already a `/`, so the
 * earliest colon sits at index 1 and the earliest span starts at index 2. So a
 * redaction can move text out of this url, and can never move the HOST it
 * names: a redaction that lies is worse than one that leaks.
 *
 * AND EVERY QUESTION IS ASKED OF THE TEXT THIS FUNCTION EMITS, which is what
 * the loop below is for and is the invariant rounds 13 and 14 each found a
 * third and fourth instance of. The rebuild is a PARSE, and a parse moves text:
 * the URL Standard's path state removes a `.` or `..` segment — under that
 * spelling or under `%2e`, in either case — and every byte after it moves left.
 * A removal can UNCOVER such a segment, so the answer to one question can slide
 * the next authority into the seam another question had just cleared.
 * `file:///x@./alice:pw@internal.test/v1` is that shape: removing `x@` leaves
 * `/./alice:pw@…`, and the rebuild collapses the dot to emit the credential at
 * the seam whole.
 *
 * RE-ASKING `redactUrl` OF ITS OWN ANSWER DOES NOT CLOSE THIS, and that is the
 * distinction worth keeping. A second call recomputes the origin and re-reads
 * `bringsOwnAuthority` from a text that no longer holds the mark, so it asks
 * DIFFERENT questions — and `//https:/x@./alice:pw@internal.test/v1` emits a
 * value that is already a fixed point of the whole redactor and still carries
 * the password. The loop asks the SAME questions, of the text that came out.
 *
 * IT ENDS, AND THE MEASURE IS `parsed.pathname.length`. Three steps, each of
 * which is a fact about one line below:
 *
 *  - `clean` is `scanned` with zero or more spans removed and everything past
 *    `path.length` clipped, so `clean.length <= path.length` — the scan only
 *    ever deletes, and the clip only ever deletes.
 *  - `clean === path` is the ONE case that returns, so a pass that continues has
 *    `clean.length < path.length` strictly.
 *  - `new URL(origin + clean).pathname` is never longer than `clean`. `clean` is
 *    a parser's own `pathname` with spans cut out of it, so the path
 *    percent-encode set is already a fixed point of it — a byte that needed
 *    encoding was encoded on the way in, and cutting a span encodes nothing new.
 *    The one rewrite the rebuild can still perform is dot-segment removal, and
 *    that only deletes. `clean` keeps index 0's `/`, which no span can reach, so
 *    the empty path the rebuild would answer with `/` never arises.
 *
 * So each pass that does not return strictly shortens a non-negative integer,
 * and the loop runs at most `pathname.length` times. `redact-url.spec.ts` pins
 * the third step directly, over every rebuild every url in its corpora performs.
 *
 * AND THAT BOUND IS REACHABLE, which is the sentence this comment used to stop
 * one step short of and the reason a tight case shipped twice. Termination needs
 * one character per pass; COST needs a constant number of passes, and nothing in
 * the three steps above supplies one. What supplies one is every cursor in this
 * module advancing past everything the next parse will delete — {@link pastFiller}
 * is that rule, and a cursor that stops one character short of it turns the
 * bound from an argument into a measurement: `/x//@./@./…` at 8 KB ran 2,731
 * passes and 204 ms in one error construction, and `toJSON()` paid it again per
 * log line. The pass count is a fact about the input's SHAPE, so it belongs to a
 * remote server whenever `url` came from a redirect.
 */
function cleaned(parsed: URL, origin: string, consumed = false): URL {
  for (;;) {
    const path = parsed.pathname;
    const scanned = endsInsideAuthority(path) ? path + parsed.search + parsed.hash : path;
    const clean = withoutMalformedUserinfo(scanned, path.length, seamUserinfo(parsed, consumed));
    if (clean === path) return stripValues(parsed);
    parsed = new URL(origin + clean);
  }
}

/**
 * The userinfo this url's ORIGIN and PATH spell between them, or `null`.
 *
 * A url with no host emits an origin that ends in the two solidi its own
 * authority left empty, and the mark that opens an authority is then written
 * across the seam by two texts neither of which holds it.
 * `file:///svc:pw@host/v1` has the empty host, so the parser reads
 * `svc:pw@host` as PATH — `username` is empty — while what this module emits is
 * `file://` joined to `/svc:pw@host/v1`, and the next reader of that value
 * reads the mark whole: `new URL("///svc:pw@host/v1", base)` answers `svc` and
 * `pw`. It is the same defect {@link nextAuthority} describes wearing the other
 * branch's clothes — the parser CONSUMED the mark, and the scan was handed the
 * text after it.
 *
 * THE PARSER ALONE DECIDES THIS SPAN, and that is the whole reason this is a
 * function rather than two solidi glued to the front of the scanned text.
 * Gluing them opens an ordinary region, and a region is WIDER than the parser
 * on purpose — {@link looksLikeUserinfo} keeps text the parser calls a host,
 * so that a credential holding a `/` still goes. That width is right where the
 * caller wrote the mark and wrong here, where the caller wrote no mark at all:
 * it reads `file:///c:/Users/alice@corp/x` as a credential ending at `alice@`,
 * and a Windows path loses its head. The parser separates the two exactly —
 * `///svc:pw@host/v1` reports a credential and `///c:/Users/alice@corp/x`
 * reports none — so at this seam the module holds only the parser's answer and
 * takes only what it names.
 *
 * TWO STATES REACH IT, and they are the two with no authority of this url's own
 * to protect. `api.test:8443` is a port, and reading it as a password is the
 * mistake {@link rawAfterAuthority} exists to prevent — but neither state has
 * an authority to make that mistake about.
 *
 *  - AN EMPTY HOST. The origin is then `scheme://` and the solidi are its.
 *    Among the six {@link HIERARCHICAL_PROTOCOLS} only `file:` reaches one.
 *  - AN AUTHORITY THE PARSER TOOK FROM A REFERENCE THAT BROUGHT ITS OWN MARK,
 *    which this branch DISCARDS: it emits the path alone. `//https:/svc:pw@host/v1`
 *    is the ordinary slash-collapsed spelling of a forward, and the parser
 *    reads `https` as the HOST and `:` as its port delimiter — so the embedded
 *    url's scheme, its solidus, and the mark they spell are all consumed, and
 *    the credential lands in `pathname` with nothing in front of it. Two
 *    solidi fewer and {@link nextAuthority} would have found it; one solidus
 *    fewer and the parser would have reported the credential itself. This is
 *    the state between them, and the seam is where it shows.
 *    {@link bringsOwnAuthority} names both spellings that reach it.
 *
 * AND IT READS THE PARSER'S SPLIT POINT, NEVER THE REPORT IT PRINTS. Round 13
 * confirmed the span with a parse of `https://<authority>/` and believed a
 * success that named neither a username nor a password. Exactly two texts
 * answer that way, and only one of them is empty: `@` has nothing in front of
 * it, and `:@` has a userinfo the parser CONSUMED and then normalised away —
 * `new URL("https://:@x/").href` is `https://x/`. So the seam read "no
 * credential" where the parser had read an empty one, and
 * `file:///:@./alice:pw@internal.test/v1` kept its password behind two
 * characters.
 *
 * The authority state consumes everything up to the LAST `@` before the
 * authority ends, so any text in front of that `@` IS the userinfo the parser
 * read, whatever the two accessors go on to say about it. The span ends there,
 * and nothing is left for a parse to decline — which is also how the failure
 * round 13 closed stays closed. Its parse THREW for an authority the caller got
 * wrong — an empty host, a port out of range, a space, a bracketed host that is
 * not an address — and reading a throw as "no credential here" inverted this
 * module's own answer about one text: `file:///alice:pw@internal.test/v1` lost
 * its password and `file:///alice:pw@/v1` emitted it whole, so two digits of
 * HOST, written after the credential, decided whether the credential went.
 * Neither text asks a parse anything now. Over-redaction stays the safe
 * direction, and it is the only direction available where the structure cannot
 * be determined at all.
 *
 * WHAT KEEPS AN ORDINARY PATH IS THE AUTHORITY'S END, not a verdict about the
 * text inside it. An authority ends at the first `/`, `\`, `?` or `#`, which is
 * the bound the URL parser itself uses, so `file:///c:/Users/alice@corp/x` has
 * no `@` before its end at all and the question is never even asked.
 *
 * AND IT IS ASKED AGAIN OF WHAT ITS OWN ANSWER LEAVES BEHIND, for the reason
 * {@link malformedUserinfoSpans} asks its two questions again: this span is
 * removed from a text that is REJOINED to the origin's solidi, so what follows
 * the span becomes the new seam. `file://\hunter2-:@/file..@` emits
 * `file:` plus `///hunter2-:@/file..@`; removing the first authority leaves
 * `file:////file..@`, whose `//file..@` is a consumed mark all over again, and
 * a second call removed what the first had not. The loop ends because each
 * answer consumes an `@` and the cursor only moves forward.
 */
function seamUserinfo(parsed: URL, consumed: boolean): { start: number; end: number } | null {
  if (parsed.host !== "" && !consumed) return null;
  const path = parsed.pathname;
  let start = 0;
  while (isSolidus(path[start])) start += 1;
  let end = -1;
  for (let from = start; ; ) {
    const at = seamUserinfoEnd(path, from);
    if (at < 0) break;
    end = at + 1;
    from = pastFiller(path, end, DOT_SEGMENTS);
  }
  return end < 0 ? null : { start, end };
}

/**
 * THE SPELLINGS ARE THE URL STANDARD'S OWN CLOSED LIST, and they are two lists
 * because the two deletions are not the same deletion. A single-dot path segment
 * is `.` or `%2e` and deletes ITSELF. A double-dot path segment is `..`, `.%2e`,
 * `%2e.`, or `%2e%2e` and deletes itself AND ONE SEGMENT IN FRONT OF IT. Each is
 * ASCII case-insensitive.
 *
 * {@link pastFiller} holds why the difference decides which list a cursor may
 * use.
 */
const DOT_SEGMENTS = new Set([".", "%2e", "..", ".%2e", "%2e.", "%2e%2e"]);
const SINGLE_DOT_SEGMENTS = new Set([".", "%2e"]);

/**
 * `from`, advanced over everything the next parse will DROP from the front of
 * what a removal leaves behind: solidi, and the `dropped` dot segments.
 *
 * ONE RULE FOR BOTH CURSORS, and it is the last class this audit named. The seam
 * and the ordinary region are two walks over one text; round 14 taught this to
 * the seam's walk and left the ordinary one advancing over solidi alone, so the
 * same shape spelled where no seam exists stayed quadratic for one more round.
 * See {@link malformedUserinfoSpans}.
 *
 * THE SOLIDI GO because the parser consumes every one of them, which is the same
 * rule {@link nextAuthority} states for an authority's opening. THE DOT SEGMENTS
 * GO for the same reason one step later: a removed span is rejoined to the text
 * in front of it, so what follows the span starts a segment, and a segment the
 * path state removes leaves the text after it at the cursor.
 * `file:///a@./b:pw@h` is that shape — take away `a@` and the parser reads
 * `/./b:pw@h` as `/b:pw@h`.
 *
 * COST, NOT CORRECTNESS, and the difference is worth stating because it decides
 * how much this rule has to be right. {@link cleaned} re-asks every question of
 * the text its own rebuild produced, so a dot spelling missed here is found on
 * the next pass — it costs one pass and never a credential. What this buys is
 * the pass COUNT: without it a path spelling one credential and one dot segment
 * per group drains one group per pass, and `redactUrl` becomes quadratic in a
 * value a redirecting server chooses. Measured: 16 KB of them took 465 ms in one
 * error construction, against 0.9 ms with this.
 *
 * WHICH IS WHY `dropped` IS A PARAMETER AND NOT THE WHOLE LIST. Advancing this
 * cursor WIDENS the span the caller removes, and a `..` swallowed by the span is
 * a `..` the rebuild will never perform — so the segment it would have popped
 * survives instead. That is the one direction this module calls unsafe, and it
 * is reachable: `/svc:PW@http:/@bob//tok@internal.testsvc:PW@..` answers `/`
 * today, because the trailing `..` pops the segment the residual on
 * {@link authorityAt} leaves standing, and it answers `/svc:PW@http:/` — the
 * password in the emitted path — the moment the span eats the `..` instead.
 * Six inputs in 200,000 generated ones showed it, and the round-12 oracle judged
 * every one of them a credential that survived.
 *
 * So a cursor passes {@link DOT_SEGMENTS} only where NOTHING a pop could shorten
 * lies in front of it, and {@link SINGLE_DOT_SEGMENTS} everywhere else.
 * {@link seamUserinfo} is the one caller that qualifies: its span starts at the
 * first character after the path's leading solidi, so the segment list in front
 * of it is empty or holds only the empty segments those solidi spell, and a pop
 * there can take a solidus and never a name. An ordinary region starts wherever
 * a mark sits in the path, with arbitrary text in front of it.
 *
 * A SEGMENT ENDS AT A SOLIDUS OR AT THE END OF THE TEXT. A `pathname` holds no
 * literal `?` or `#` — the path percent-encode set covers both — so for the
 * seam's call that is the whole story. The ordinary region's text can run past
 * `pathname` into the query, in the one state {@link endsInsideAuthority}
 * names, and there a `?` reads as an ordinary character: the segment holding it
 * matches no dot spelling, so the cursor stops in front of it. Stopping early
 * is the direction that costs a pass and never an answer.
 */
function pastFiller(text: string, from: number, dropped: ReadonlySet<string>): number {
  let at = from;
  for (;;) {
    while (isSolidus(text[at])) at += 1;
    let segment = at;
    while (segment < text.length && !isSolidus(text[segment])) segment += 1;
    if (!dropped.has(text.slice(at, segment).toLowerCase())) return at;
    at = segment;
  }
}

/**
 * Where the userinfo of the authority at `from` ends, or `-1` when it holds
 * none. One answer of {@link seamUserinfo}'s loop.
 */
function seamUserinfoEnd(path: string, from: number): number {
  let term = from;
  while (term < path.length && !isSolidus(path[term]) && path[term] !== "?" && path[term] !== "#") {
    term += 1;
  }
  // The last `@` before the authority ends is where the parser splits userinfo
  // from host, so it is where the span ends. Asked of the TEXT rather than of
  // the parsed values, which percent-encoding rewrites and which report an
  // empty userinfo and an absent one with the same two empty strings.
  //
  // An `@` AT `from` has no text in front of it, so it names no userinfo and
  // there is nothing to remove: `file:///@api.test/v1` keeps its mark.
  const at = path.lastIndexOf("@", term - 1);
  return at <= from ? -1 : at;
}

/**
 * Does the text from `start` READ as an authority?
 *
 * This is the question that ends a region, and it is asked of the URL parser
 * rather than of a mark, because five rounds proved that no mark survives being
 * spelled by the value it is supposed to delimit. Round 9 measured the wide
 * mark: a password spelling `:/` ends its own region and emits the prefix,
 * 5,241 leaking urls. Round 12 measured the narrow one: a password spelling
 * `://` does the same, three characters instead of two. A mark the attacker can
 * write is a terminator the attacker chooses.
 *
 * The parser cannot be written. It reads from `start` to the first `/`, `\`,
 * `?`, or `#` — the four characters that end an authority — and then either
 * finds a host there or fails. When it finds one, the authority is COMPLETE:
 * the parser itself said where it ends, so a later `://` starts a url of its
 * own and bounds the region. When it fails, there is no authority for a mark to
 * be the end of, and the region has no end: every `@` after it is a candidate.
 * `alice:s3cret://x@internal.test/v1` fails, because `s3cret` is not a port —
 * so the `@` the `://` used to hide behind is asked, and the whole credential
 * goes.
 *
 * UNDER A SPECIAL SCHEME, whatever scheme the region's own mark spelled. The
 * question this module asks is always "is this the authority a special-scheme
 * parse would produce", and a non-special scheme that answers `false` where its
 * own grammar would answer `true` only ever WIDENS the region. Over-redaction
 * is this module's safe direction.
 */
function parsesAsAuthority(text: string, start: number): boolean {
  let end = start;
  while (end < text.length && !isSolidus(text[end]) && text[end] !== "?" && text[end] !== "#") {
    end += 1;
  }
  try {
    // The read is what makes this a parse rather than a discarded `new`, and
    // the answer is the host: a special scheme with no host is a parse failure
    // on every runtime, and reading it says so without depending on that.
    return Boolean(new URL(`https://${text.slice(start, end)}/`).host);
  } catch {
    return false;
  }
}

/**
 * Does `path` END inside an authority?
 *
 * The `?` or the `#` that ended `pathname` is the OUTER url's delimiter, placed
 * by the outer parse. For an embedded url it is a boundary only once that url's
 * own authority has ended — and an authority ends at the first `/`. So a mark
 * with no `/` after it anywhere in `path` is an authority the cut interrupted,
 * and the `@` that would close it, if it has one, is on the other side.
 *
 * That is the ONLY state in which {@link cleaned} looks past `pathname`, and it
 * is why `/proxy/https://cdn.test/img?owner=alice@example.com` does not: the
 * embedded url reached `/img`, so its authority is complete, the `?` starts its
 * query, and the `@` in that query is an e-mail address rather than a
 * terminator.
 *
 * THE LAST `/`, not a scan per mark. `indexOf("/", start)` walks to the end of
 * the string for every mark that has no `/` after it, which is quadratic on
 * `/go/` + `https:`-repeated; one `lastIndexOf` answers the same question for
 * every mark at once.
 */
function endsInsideAuthority(path: string): boolean {
  const lastSlash = path.lastIndexOf("/");
  for (let from = 0; ; ) {
    const start = nextAuthority(path, from);
    if (start === null) return false;
    if (start > lastSlash) return true;
    from = start;
  }
}

/**
 * The authority mark spelled IN FULL.
 *
 * It bounds a region, and it does so only where {@link parsesAsAuthority} has
 * already said the region's own authority ENDS — a complete authority is
 * followed by a url of its own, and this is where that url starts. It is not
 * the end of a region by itself, and round 12 is why: a password can spell it.
 * What OPENS a region is wider still — see {@link nextAuthority}.
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
 * A region STARTS where {@link authorityAt} or {@link leadingAuthority} says
 * the URL Standard opens one, and it ENDS where {@link parsesAsAuthority} says
 * the parser ends an authority it can read. The start is a mark; the end is not
 * one, and round 12 is why.
 *
 * The START has to be the wide mark. A special scheme reaches its authority
 * over any number of solidi, INCLUDING NONE, so `https:/svc:pw@host` and
 * `https:svc:pw@host` inside a path are embedded credentials — and neither is
 * exotic: every slash-collapsing proxy and every `path.join` turns an ordinary
 * `/go/https://svc:pw@host` into one of those spellings before this library ever
 * sees it.
 *
 * THE END CANNOT BE A MARK AT ALL, and both halves of that were measured rather
 * than argued. Round 9 tried the wide mark and reverted it: a password spelling
 * `:/` ends its own region and emits the prefix, 5,241 leaking urls and 13,435
 * leaking messages. Round 12 found the narrow mark loses the same way — a
 * password spelling `://` ends its own region, and
 * `/go/https://alice:s3cret://x@internal.test/v1` emitted `alice:s3cret`. Both
 * choices hand the terminator to the attacker, which is the evidence that no
 * third choice of mark is left to make. The end is a QUESTION now, asked of the
 * parser: a region ends at the next `://` only when the parser can read a
 * complete authority at the region's start, and a region whose start is not an
 * authority the parser can read does not end. See {@link parsesAsAuthority}.
 *
 * The regions a wide start opens OVERLAP, where a partition would not. Each is
 * tried in turn and the first that holds a credential wins, so the span is the
 * OUTERMOST reading — over-redaction, which is this module's safe direction,
 * and never a second span nested inside a removed one.
 *
 * A REGION IS STILL WHAT A LATER MARK CAN CUT SHORT, and that is the rule's own
 * residual, stated because it is under-redaction rather than over. It is
 * narrower than it was: the cut only happens where the parser reads a complete
 * authority at the start, so the surviving text is text the PARSER calls a host.
 * `/go/https://YWxpY2U/cGFzc3dvcmQ://x@host` keeps its base64 credential,
 * because `YWxpY2U` is a host the parser accepts and the `://` after it starts a
 * url of its own. It is not closable here, for the reason residual 4 is not:
 * `://host1/x://u2:pw@host2/v1` spells the same characters in the same order and
 * the suite pins `host1` as a path this module keeps, so no structural rule
 * separates them. What it costs is bounded by residual 2: the surviving text is
 * a path segment, the query and the fragment are still dropped, and
 * `error.url` still holds the whole href.
 *
 * SPANS ARE FOUND HERE AND CLIPPED BY THE CALLER. This function reads whatever
 * text it is handed, which for {@link cleaned} may run past `pathname` into the
 * query — see {@link endsInsideAuthority} for the one state in which it does.
 * What that widening buys is the `@` of a credential the outer `?` cut in half.
 * It never buys the right to EMIT the text after that `@`, which is why the
 * clip lives in {@link withoutMalformedUserinfo} rather than in this scan.
 *
 * Which leaves ONE question per `@`: is the text before it an authority, or a
 * path that happens to contain an `@`? {@link looksLikeUserinfo} answers it,
 * and it is asked of EVERY `@` in the region rather than of the last one. Round
 * 11 found the difference: `/go/https://TOKEN@cdn.test/img/@alice` ends in an
 * ordinary user handle, so the region's last `@` is `/@alice`'s, and the text
 * before it — `TOKEN@cdn.test/img/` — reads as a path because it ends in `/`.
 * One answer for the whole region meant the `@` that closes the real credential
 * was never asked about at all. See {@link userinfoEnd}.
 *
 * SPANS are returned rather than text: the same bytes can appear earlier in the
 * string (`svc:pw@x://svc:pw@host/`), and removing the wrong copy leaves the
 * credential exactly where it was.
 */
function malformedUserinfoSpans(
  text: string,
  seam: { start: number; end: number } | null = null,
): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  // EVERY `@`, FOUND ONCE, in one forward pass before any region is read.
  //
  // The regions used to end in increasing order, so three forward cursors could
  // summarize the candidates of each one in turn. They no longer do: a region
  // whose start the parser cannot read has no end at all, and the next region
  // along may have one, so the ends move backwards as often as forwards. The
  // positions are collected up front instead and located by a binary search
  // over them, which is not the backward SCAN that made an earlier form
  // quadratic — `lastIndexOf("@", stop - 1)` walks to index 0 whenever a region
  // holds no `@`, and 96 KB of repeated marks took 855 ms against 0.23 ms for
  // one forward pass.
  //
  // Two lists, because {@link looksLikeUserinfo} asks exactly one thing about
  // an `@` itself: whether a `/` precedes it. See {@link userinfoEnd}.
  const ats: number[] = [];
  const loneAts: number[] = [];
  for (let at = text.indexOf("@"); at >= 0; at = text.indexOf("@", at + 1)) {
    ats.push(at);
    if (text[at - 1] !== "/") loneAts.push(at);
  }
  const lastAtOfText = ats.length === 0 ? -1 : ats[ats.length - 1]!;

  // THE SEAM'S SPAN IS A FLOOR, NOT A SPAN OF ITS OWN, wherever an ordinary
  // region opens at the same place — which is whenever the path's leading
  // solidi are two, since {@link nextAuthority} opens one there. The two are
  // then one region with two answers, and the union of them is what this
  // module removes everywhere else. Kept apart, the parser's answer would MASK
  // the heuristic's: the scan would resume past the credential and never ask
  // the region's later `@`, so a second pass removed what the first had not.
  // Where the leading solidus is single there is no ordinary region to merge
  // with, and the parser's answer stands by itself. See {@link seamUserinfo}.
  let from = 0;
  let floor = -1;
  if (seam !== null) {
    if (nextAuthority(text, 0) === seam.start) floor = seam.end;
    else {
      spans.push(seam);
      from = seam.end;
    }
  }
  // The next `://`, read forward and never re-read. It bounds a region only
  // where the parser has already said the region's authority ENDS — see
  // {@link parsesAsAuthority}.
  let stop = text.indexOf(AUTHORITY_MARK);
  for (;;) {
    const start = nextAuthority(text, from);
    if (start === null) break;
    if (stop >= 0 && stop < start) stop = text.indexOf(AUTHORITY_MARK, start);
    // ASKED ONLY WHERE THE ANSWER CAN MATTER. With no `@` past `stop` the
    // bounded and the unbounded region hold the same candidates, so the parse
    // is skipped — which is what keeps a path of nothing but marks linear.
    const bounded = stop >= 0 && (lastAtOfText <= stop || parsesAsAuthority(text, start));
    let end = bounded ? stop : text.length;
    let lastAt = lastBelow(ats, end);
    let lastLoneAt = lastBelow(loneAts, end);
    // ASKED AGAIN OF WHAT THE ANSWER LEAVES BEHIND. Removing a credential moves
    // the region's first `/` and first `:`, and {@link looksLikeUserinfo} reads
    // both, so what is left can answer differently from how it answered as part
    // of a longer candidate. One pass that stopped at the first answer was NOT
    // this module applied to its own output: round 11 measured 1,925 urls where
    // `redactUrl(redactUrl(u))` removed more than `redactUrl(u)` did, which is
    // under-redaction by this module's own rule in the string every channel
    // carries.
    //
    // Three answers at most, so this is a constant and the pass stays linear.
    // `lastAt` and `lastLoneAt` are each spent by the answer that returns them,
    // and an `@` at the cut itself is preceded by the `@` the previous answer
    // ended on — which makes it a lone `@` and therefore the last one.
    let cut = floor > start ? floor : start;
    floor = -1;
    for (;;) {
      const at = userinfoEnd(text, cut, lastAt, lastLoneAt);
      if (at < 0) break;
      // WHAT THE ANSWER EXPOSES GOES WITH IT, and that is the same rule as the
      // re-ask rather than a second one: what the removal leaves behind at
      // `start` is read by {@link authorityAt}, which consumes every solidus,
      // and then by the REBUILD's parse, which deletes the dot segments the
      // removal has just moved to the head of a segment. Leaving the solidi
      // made `redactUrl` fall short of being a fixed point of itself — the
      // second pass consumed them and reached one more `@`. Leaving the dot
      // segments cost the PASS COUNT, which is the same defect round 14 fixed
      // at the seam's cursor and left standing here: `/x//@./@./@./…` spells one
      // empty userinfo per dot segment, the cursor stopped on the `.` that the
      // `@`'s own removal had just turned into a dot segment, and the pass
      // drained one group. 8 KB of them took 204 ms inside one error
      // construction, against 0.6 ms with this, and `toJSON()` paid it again
      // per log line. The two cursors are one rule now — {@link pastFiller} —
      // asked of one text.
      //
      // SINGLE DOTS ONLY HERE, and that is not a narrowing of the rule but the
      // rule read at this position. Advancing this cursor WIDENS the span, so a
      // `..` swallowed here is a `..` the rebuild never performs, and the
      // segment it would have popped survives — text in front of a region is
      // arbitrary path, where in front of the seam it is solidi. See
      // {@link pastFiller}, which names the input that turns the difference
      // into a password in the emitted path.
      cut = pastFiller(text, at + 1, SINGLE_DOT_SEGMENTS);
      // AND THE END QUESTION IS RE-ASKED TOO, of the same text the `@` question
      // is re-asked of. A region is BOUNDED only where the parser reads a
      // complete authority at its start, and removing a credential MOVES that
      // start — so the text now at `cut` can be an authority the parser cannot
      // read where the text at `start` was one it could. `//x:/a@b:PW://h.test/@bob`
      // is that shape: `x:` is a host, so the region ends at the `://` and only
      // `x:/a@` goes; `b:PW` is not, so the region that remains has no end and
      // reaches `@bob`. A SECOND CALL found that and the first did not, which is
      // this module failing to be a fixed point of itself — the property round
      // 11 measured and round 12 recorded as a defect.
      //
      // ONE WAY ONLY, and that is what keeps this constant rather than one pass
      // per `@`. A region can lose its bound and can never regain one, so `end`
      // moves at most once, and the three-answers-at-most argument above holds
      // on each side of the move. The parse is skipped where the answer cannot
      // matter: with no `@` past `end`, a wider region holds the same candidates.
      if (end < text.length && lastAtOfText >= end && !parsesAsAuthority(text, cut)) {
        end = text.length;
        lastAt = lastBelow(ats, end);
        lastLoneAt = lastBelow(loneAts, end);
      }
    }
    if (cut > start) spans.push({ start, end: cut });
    // Past the `@` this region ended on: any region opening inside the span
    // just removed reads the same `@` and nests inside it.
    from = cut;
  }
  return spans;
}

/** The last position in the ascending `positions` below `limit`, or `-1`. */
function lastBelow(positions: number[], limit: number): number {
  let low = 0;
  let high = positions.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (positions[middle]! < limit) low = middle + 1;
    else high = middle;
  }
  return low === 0 ? -1 : positions[low - 1]!;
}

/**
 * Where the userinfo a region reading from `start` ends, or `-1` when the text
 * from `start` holds none.
 *
 * THE UNION OF EVERY CANDIDATE, not one reading of the region. Each `@` in the
 * region is its own question — "is `text[start, at)` a credential?" — and every
 * candidate that answers yes is removed. All of them share `start`, so their
 * union is the span reaching the LAST one that answers yes, and that is what
 * this returns. Over-redaction is this module's safe direction, and asking
 * about one `@` per region is what let a credential ride out under a later `@`
 * that reads as a path.
 *
 * TWO CURSORS ANSWER FOR EVERY `@`, which is what keeps this one forward pass.
 * Testing each `@` in each region is quadratic on overlapping regions, and a
 * backward search from `lastAt` is the same cost wearing a different mark — the
 * shape whose 855 ms {@link malformedUserinfoSpans} records. It is also
 * unnecessary. Only the THIRD rule of {@link looksLikeUserinfo} reads the
 * candidate's own end, and it reads exactly one character: whether a `/`
 * precedes the `@`. So:
 *
 *  - When the last `@` answers yes, it is the union by itself.
 *  - When it answers no, the region has a `/` after `start` with no `:` before
 *    it, and every `@` a `/` precedes answers no for the same reason. What is
 *    left is the last `@` that NO `/` precedes — `lastLoneAt` — plus the `@` at
 *    `start` itself, which is the empty userinfo rule 1 admits.
 *
 * An `@` before the region's first `/` needs no case of its own: nothing but
 * `start` can put a `/` immediately before it, so it is already a lone `@`.
 */
function userinfoEnd(text: string, start: number, lastAt: number, lastLoneAt: number): number {
  if (lastAt < start) return -1;
  if (looksLikeUserinfo(text, start, lastAt)) return lastAt;
  if (lastLoneAt >= start) return lastLoneAt;
  return text[start] === "@" ? start : -1;
}

/**
 * Where the next authority in `text` begins, at or after `from`. `null` once no
 * mark is left.
 *
 * TWO OPENINGS, and they are the URL Standard's own two places for one:
 *
 *  - After a SCHEME COLON. See {@link authorityAt}, which holds the whole of
 *    that half.
 *  - After a pair of SOLIDI, with no scheme in front of them at all. A relative
 *    reference that begins with two solidi is protocol-relative: the
 *    relative-slash state hands it to the authority state, so everything up to
 *    the next `/` is userinfo, host and port.
 *    `new URL("//svc:pw@internal.test/v1", base)` answers `svc` and `pw`.
 *
 * The second was missing until round 12, and three shapes rode out through it.
 * `//https://svc:pw@host/v1` is protocol-relative, so the parser reads `https`
 * as the HOST and consumes the `://` with it; what reaches the scan is
 * `//svc:pw@host/v1`, the embedded url's own solidi with the scheme that wrote
 * them taken away, and no mark left to open on. `https://api.test//svc:pw@host/x`
 * and `https://api.test/deep//svc:pw@host/x` never had a scheme there to begin
 * with. All three are a protocol-relative url the caller wrote, and the
 * document already said so: a region opens "at two or more solidi under any
 * scheme", and no scheme is one of the cases that phrase covers.
 *
 * EVERY solidus is consumed, in both openings, because the parser consumes
 * every one. See {@link isSolidus}.
 *
 * ONE FORWARD WALK. The colon half used `indexOf` per mark, and a pair of
 * solidi is not a character `indexOf` can find, so both halves are read in the
 * one pass that has to happen anyway. `from` only ever moves forward across the
 * calls {@link malformedUserinfoSpans} makes, so the whole scan stays linear.
 */
function nextAuthority(text: string, from: number): number | null {
  for (let at = from; at < text.length; at += 1) {
    if (text[at] === ":") {
      const start = authorityAt(text, at);
      if (start !== null) return start;
      continue;
    }
    if (!isSolidus(text[at]) || !isSolidus(text[at + 1])) continue;
    let start = at;
    while (isSolidus(text[start])) start += 1;
    return start;
  }
  return null;
}

/**
 * The authority this colon opens, or `null` when the colon opens none.
 *
 * TWO SPELLINGS, and they are the URL Standard's own two, not an approximation
 * of them:
 *
 *  - TWO OR MORE solidi. `://` is the mark the grammar writes for an authority
 *    under ANY scheme, valid or not — the path-or-authority state reads it for a
 *    scheme this module has never heard of, and for the empty scheme a template
 *    left behind.
 *  - A SPECIAL scheme, over any number of solidi INCLUDING NONE. The
 *    special-authority-slashes state raises
 *    `special-scheme-missing-following-solidus`, moves to the
 *    special-authority-ignore-slashes state, and decreases the pointer by one;
 *    that state then leaves for the authority state on the first character that
 *    is neither `/` nor `\`. So `https:svc:pw@host` names the host `host` with
 *    the username `svc` and the password `pw`, exactly as `https://svc:pw@host`
 *    does, and round 10 found the credential riding out through every channel
 *    because `start > colon + 1` had made ZERO the one count that opened nothing.
 *
 * Both halves matter, and the second is what makes the FIRST safe to narrow.
 * The old rule opened a region for one solidus after any colon at all, which
 * read `/a:/b` as an authority — an ordinary path segment, and the shape that
 * let an `@` in a QUERY reach back through it. A non-special scheme does NOT
 * reach an authority over one solidus: the URL Standard sends it to the opaque
 * path state instead. So a colon with fewer than two solidi opens a region only
 * where the parser would open one, which is where the scheme is special —
 * `/go/https:/svc:pw@host`, the spelling every slash-collapsing proxy and every
 * `path.join` produces — and nowhere else. A Windows drive letter
 * (`file:///c:/Users/alice@corp/x`) is now excluded by the same rule rather than
 * by a separate carve-out in {@link looksLikeUserinfo}.
 */
function authorityAt(text: string, colon: number): number | null {
  let start = colon + 1;
  while (isSolidus(text[start])) start += 1;
  if (start > colon + 2) return start;
  return isSpecialScheme(text, colon) ? start : null;
}

/**
 * Is the text immediately before `colon` one of the six {@link SPECIAL_SCHEMES}?
 *
 * READ FORWARD FROM A BOUNDED OFFSET, never scanned backwards to the start of
 * the token. A backward walk over scheme characters is linear in the token it
 * walks, and a path can spell one token per colon; each candidate here is at
 * most five characters long, so the whole question costs the same however long
 * the text before the colon is.
 *
 * The character BEFORE the match decides it, because a scheme is a whole token:
 * `xhttps:` is not `https:`, and `/go/https:` is. `text[-1]` is `undefined` when
 * the scheme starts the string, which is not a scheme character, so the mark at
 * index 0 of a raw url needs no separate case.
 */
function isSpecialScheme(text: string, colon: number): boolean {
  for (const scheme of SPECIAL_SCHEMES) {
    const start = colon - scheme.length;
    if (start < 0 || text.slice(start, colon).toLowerCase() !== scheme) continue;
    return !isSchemeCharacter(text[start - 1]);
  }
  return false;
}

/** ALPHA / DIGIT / `+` / `-` / `.` — the characters a scheme is spelled from. */
const SCHEME_CHARACTER = /[a-z0-9+\-.]/i;

function isSchemeCharacter(character: string | undefined): boolean {
  return character !== undefined && SCHEME_CHARACTER.test(character);
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
 * ONE `@`, ASKED INDEPENDENTLY. This decides a single candidate, and
 * {@link userinfoEnd} asks it about every `@` a region holds — the union of the
 * yes answers is the span. Round 11 widened WHICH `@`s are asked; it did not
 * change what any of them is asked, so the three residuals below are exactly
 * the ones round 10 left.
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
 * THE THREE RULES DO NOT COUNT SOLIDI, and round 10 removed the count they used
 * to carry. Round 9 gated the third rule on two solidi for ONE reason: a Windows
 * drive letter spells a colon and one solidus in an ordinary path
 * (`file:///c:/Users/alice@corp/x`), and reading `Users/alice@` there as a
 * credential would delete a named segment. That guard was in the wrong place.
 * `c` is not a SPECIAL scheme, so the URL Standard never reaches an authority
 * from `c:/…` at all, and {@link authorityAt} now says so — the drive letter
 * opens no region and never reaches this function. Paying for it here instead
 * cost a credential: `https:/YWxpY2U/cGFzc3dvcmQ@host` and
 * `https:YWxpY2U/cGFzc3dvcmQ@host` are the same embedded credential as the
 * two-solidus spelling, and both were kept as path segments. A rule that
 * answered differently for the same text under three spellings of one mark was
 * closing the case rather than the class.
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
function looksLikeUserinfo(text: string, start: number, end: number): boolean {
  if (end === start) return true;
  const slash = text.indexOf("/", start);
  if (slash < 0 || slash >= end) return true;
  const colon = text.indexOf(":", start);
  if (colon >= 0 && colon < slash) return true;
  return text[end - 1] !== "/";
}

/**
 * The first `limit` characters of `text` with every malformed authority's
 * userinfo removed.
 *
 * Never applied to the INPUT — {@link cleaned} hands it what a URL parser
 * emitted, and {@link userinfosOf} hands it a slot of one. Which URLs resolve
 * stays the raw input's own answer to give.
 *
 * CLIPPED, and that is round 10's whole correction. `limit` is the length of
 * `pathname`, so a span may be FOUND past it — the `@` that closes a credential
 * the `?` cut in half is on the other side — and can never be EMITTED past it.
 * A span that crosses the limit removes everything from its start to the limit;
 * a span that starts at or after the limit is query or fragment text, which this
 * function's caller drops whole either way.
 *
 * Percent-encoding does not weaken the scan where the delimiters are literal:
 * it removes the whole span up to the `@`, so an encoded password
 * (`hunter%202`) goes with it. An encoded DELIMITER is a different question and
 * the answer is residual 2 — `%3A%2F%2F` and `%40` spell no authority any
 * parser reads, so the text they hold is a path segment. See
 * `disclosure-channels.spec.ts`, which pins the shapes on each side of that
 * line.
 */
function withoutMalformedUserinfo(
  text: string,
  limit: number,
  seam: { start: number; end: number } | null,
): string {
  let out = "";
  let cursor = 0;
  for (const span of malformedUserinfoSpans(text, seam)) {
    if (span.start >= limit) break;
    out += text.slice(cursor, span.start);
    cursor = span.end < limit ? span.end : limit;
  }
  return out + text.slice(cursor, limit);
}

/**
 * Every userinfo an authority the parser did not read hides inside `text`.
 *
 * `"@"` ALONE is not a credential, and it is the one needle that must never
 * reach `replaceAll`. `://@host/x` yields a span of exactly one character, and
 * stripping every `@` from a message deletes e-mail addresses, handles, and
 * anything else the diagnostic was carrying.
 */
function hiddenUserinfos(
  text: string,
  seam: { start: number; end: number } | null = null,
): string[] {
  return malformedUserinfoSpans(text, seam)
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

/**
 * The three characters the URL parser removes from ANYWHERE in its input before
 * parsing: ASCII tab, LF and CR.
 */
function isIgnored(character: string | undefined): boolean {
  return character === "\t" || character === "\n" || character === "\r";
}

/**
 * A character the URL parser removes from the two ENDS of its input: a C0
 * control or a space, which is U+0000 to U+001F plus U+0020.
 *
 * A SEPARATE STEP from {@link isIgnored}, and reading the two as one set is
 * round 14's critical. The basic URL parser strips the leading and trailing run
 * of these characters FIRST, and only then removes every tab and newline
 * wherever it sits. So this set is wider — it holds the space, the NUL, the
 * vertical tab, the form feed — and it applies at the head alone. One leading
 * space in front of `http:alice:pw@api.test:99999/v1` is enough to move the
 * scheme by one character for a reader that skips only the narrow set, while the
 * parser goes on reading the scheme exactly where it was.
 */
function isStripped(character: string | undefined): boolean {
  return character !== undefined && character.charCodeAt(0) <= 0x20;
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
      // The pathname carries the seam's needle too, for the reason
      // {@link seamUserinfo} states: a protocol-relative reference hands its
      // authority to the parser, and `redactUrl` emits the path alone.
      const slots: [string, { start: number; end: number } | null][] = [
        [resolved.pathname, seamUserinfo(resolved, bringsOwnAuthority(url))],
        [resolved.search, null],
        [resolved.hash, null],
      ];
      for (const [slot, seam] of slots) {
        for (const needle of hiddenUserinfos(slot, seam)) {
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
    // The seam between the origin and the path carries a needle of its own,
    // for the reason {@link seamUserinfo} states, and a message quotes it in
    // the same spelling the path holds it.
    ...hiddenUserinfos(parsed.pathname, seamUserinfo(parsed, false)),
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
