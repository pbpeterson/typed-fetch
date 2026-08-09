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
 *
 * WHERE THE SCAN LIVES. Finding a credential a URL parser did not report is its
 * own module, `./userinfo-spans`, and this file holds only what a caller does
 * with the spans it answers: emit a url without them, or remove them from a
 * message. Both exports here reach the scan through that one interface. No
 * `URL` object crosses it — see {@link seamUserinfo} for the one question that
 * splits across the seam, and the scanner's own header for why.
 *
 * AND THE GRAMMAR LIVES THERE TOO. The scanner owns every question about what
 * the URL Standard reads: which schemes name a hierarchy, where an authority
 * opens, where one ends, and what a parse consumes before it answers. This file
 * holds no character class and no scheme list. It asks WHOLE questions —
 * {@link leadsWithHierarchicalScheme}, {@link bringsOwnAuthority},
 * {@link afterOwnAuthority} — and spends the answers on **structure and value**.
 * Two grammar answers written on both sides of the seam is what this replaced,
 * and the two had drifted apart about `file:`.
 */

import {
  afterOwnAuthority,
  bringsOwnAuthority,
  leadsWithHierarchicalScheme,
  pathUserinfoSpans,
  seamSpan,
  type Span,
  userinfoSpans,
} from "./userinfo-spans";

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
 *    `isSolidus` in `./userinfo-spans` and the relative branch's loop both rest
 *    on it. A non-special base would leave a `\` in `pathname`, and the loop's
 *    own termination bound — leading solidi plus a non-empty host consumed every
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
 * property above. `bringsOwnAuthority` in `./userinfo-spans` answers for all six
 * schemes instead, so the state where the parser consumes the mark is handled
 * wherever the base's scheme happens to sit.
 */
const RELATIVE_BASE = "http://url.invalid";

/**
 * `new URL(url)` — or `new URL(url, base)` where a base is given — and `null`
 * when the text does not parse.
 *
 * THE RETURNED VALUE IS THE READ, and the read is what makes this a parse rather
 * than a discarded `new`. Three callers here ask it for three different answers
 * — {@link redactUrl} wants the parsed url, {@link hasRedactableSlot} wants only
 * whether the parse succeeded, and {@link userinfosOf} wants both plus a second
 * parse against a base — so none of them owns the idiom and it is written once.
 *
 * IT IS THE EMITTER'S PARSE, not the scanner's. `./userinfo-spans` parses too,
 * in `parsesAsAuthority`, and that is one call site asking one thing about a
 * candidate authority. Two modules that each parse in one place do not share an
 * idiom; they share `URL`, and a shared wrapper would be a third name for it on
 * a seam whose whole rule is that no `URL` crosses.
 *
 * `URL.canParse` would say the same thing and is not on every runtime this
 * `try`/`catch` already supports.
 */
function parseProbe(url: string, base?: string): URL | null {
  try {
    return new URL(url, base);
  } catch {
    return null;
  }
}

/** Clears every value slot in place and returns the same `URL`. */
function stripValues(parsed: URL): URL {
  parsed.username = "";
  parsed.password = "";
  parsed.search = "";
  parsed.hash = "";
  return parsed;
}

/**
 * The href with every value slot removed: no userinfo, no query, no fragment.
 *
 * Total by construction. An empty string stays empty (the documented "no URL
 * could be resolved" value), a relative URL keeps its path, and an input that
 * parses as neither is emitted as a percent-encoded PATH — never as the raw
 * string, so a query or fragment hidden in it is still dropped. A userinfo
 * hidden in it is dropped too: the path is kept as structure, and userinfo is
 * unconditionally a value. See `userinfoSpans` in `./userinfo-spans`.
 *
 * AN OPAQUE URL IS REDUCED TO ITS SCHEME. A hierarchical scheme names a resource
 * on a host, so its path is structure and the value slots are the separate ones
 * this module clears. `fetch` also accepts opaque schemes, and there the whole
 * payload lives in the path: a `data:` URL carries its bytes there, and a
 * `blob:` URL carries an unguessable handle to them. Emitting either verbatim
 * would put the thing this module exists to remove into `message` and into the
 * error record. The six hierarchical schemes are the scanner's own list, and
 * `URL.protocol` reports a scheme and a colon, which is what
 * `leadsWithHierarchicalScheme` in `./userinfo-spans` reads.
 */
export function redactUrl(url: string): string {
  if (!url) return "";
  const absolute = parseProbe(url);
  if (absolute !== null) {
    if (!leadsWithHierarchicalScheme(absolute.protocol)) return absolute.protocol;
    const origin = `${absolute.protocol}//${absolute.host}`;
    try {
      return cleaned(absolute, origin).href;
    } catch {
      // THE REBUILD'S THROW IS NOT A PARSE FAILURE, and holding both under one
      // `catch` is what made this worth its own line. The absolute parse used to
      // sit inside this block, so a rebuild that could not parse fell through to
      // the RELATIVE branch — which resolves an absolute url against
      // {@link RELATIVE_BASE} and emits the path alone, silently dropping the
      // origin this module promises never to move. The rebuild is the one step
      // that can lose text, and the origin is the part it cannot touch, so the
      // origin is the answer. Over-redaction, and the url still names its host.
      //
      // NO INPUT IS KNOWN TO REACH IT, and the arm stays because the argument
      // that says so is spread across three functions and no one of them
      // states it. {@link cleaned} rebuilds on a host the parser itself
      // serialized for a scheme that is always special; `clean` keeps index
      // 0's `/`, because the earliest span starts at index 1; and everything
      // the parser reads past that `/` is path state, which refuses nothing.
      // Move any one of the three and this arm is live. `redact-url.spec.ts`
      // drives it through the `URL` global rather than through an input, so
      // what it answers is pinned instead of argued.
      return origin;
    }
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
    // second read as on the first. Each pass resolves the authority the text
    // brings and emits what is left, which is strictly shorter, so the loop
    // ends. An input that reduces to bare solidi resolves to no url at all and
    // falls to the documented empty answer below.
    //
    // THE CONDITION IS THE PARSE'S OWN QUESTION, asked of the text about to be
    // emitted rather than of two characters read here. `bringsOwnAuthority` is
    // what the NEXT pass hands the parser, so the loop runs exactly while a pass
    // would consume a mark. Reading `path[0]` and `path[1]` for it was a second
    // spelling of a rule the scanner owns.
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
    while (bringsOwnAuthority(path)) {
      path = resolvedPath(path);
    }
    return path;
  } catch {
    return "";
  }
}

/**
 * One pass of the relative branch: resolve, clean, emit the path.
 *
 * THE PARSE IS RAW, AND ITS THROW IS THE ANSWER. Both throws this line can raise
 * — a reference the base cannot resolve, and a rebuild inside {@link cleaned}
 * that cannot parse — land in {@link redactUrl}'s relative `catch`, which is the
 * documented "no URL could be resolved" value. They mean the same thing there,
 * so neither is swallowed into a different answer. The ABSOLUTE branch cannot
 * say that, which is why its rebuild has a `catch` of its own.
 */
function resolvedPath(text: string): string {
  return cleaned(new URL(text, RELATIVE_BASE), RELATIVE_BASE, bringsOwnAuthority(text)).pathname;
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
 * authority never reached one. `endsInsideAuthority` in `./userinfo-spans` asks
 * the question, and the answer only ever widens where the `@` is LOOKED FOR.
 * What is removed is still clipped to `pathname`, so a credential the `?` cut
 * in half goes and the query still goes whole.
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
 * `bringsOwnAuthority` (in `./userinfo-spans`) from a text that no longer holds
 * the mark, so it asks DIFFERENT questions — and
 * `//https:/x@./alice:pw@internal.test/v1` emits a value that is already a fixed
 * point of the whole redactor and still carries the password. The loop asks the
 * SAME questions, of the text that came out.
 *
 * IT ENDS, AND THE MEASURE IS `parsed.pathname.length`. Three steps, each of
 * which is a fact about one line below:
 *
 *  - `clean` is the scanned text with zero or more spans removed and everything
 *    past `path.length` clipped, so `clean.length <= path.length` — the scan only
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
 * module advancing past everything the next parse will delete — `pastFiller` in
 * `./userinfo-spans` is that rule, and a cursor that stops one character short
 * of it turns the bound from an argument into a measurement: `/x//@./@./…` at
 * 8 KB ran 2,731 passes and 204 ms in one error construction, and `toJSON()`
 * paid it again per log line. The pass count is a fact about the input's SHAPE,
 * so it belongs to a remote server whenever `url` came from a redirect.
 */
function cleaned(parsed: URL, origin: string, consumed = false): URL {
  for (;;) {
    const path = parsed.pathname;
    const seam = seamUserinfo(parsed, consumed);
    const clean = withoutMalformedUserinfo(path, parsed.search + parsed.hash, seam);
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
 * `pw`. It is the same defect `nextAuthority` in `./userinfo-spans` describes
 * wearing the other branch's clothes — the parser CONSUMED the mark, and the
 * scan was handed the text after it.
 *
 * TWO STATES REACH IT, and they are the two with no authority of this url's own
 * to protect. `api.test:8443` is a port, and reading it as a password is the
 * mistake `afterOwnAuthority` in `./userinfo-spans` exists to prevent — but
 * neither state has an authority to make that mistake about.
 *
 *  - AN EMPTY HOST. The origin is then `scheme://` and the solidi are its.
 *    Among the six hierarchical schemes only `file:` reaches one.
 *  - AN AUTHORITY THE PARSER TOOK FROM A REFERENCE THAT BROUGHT ITS OWN MARK,
 *    which this branch DISCARDS: it emits the path alone. `//https:/svc:pw@host/v1`
 *    is the ordinary slash-collapsed spelling of a forward, and the parser
 *    reads `https` as the HOST and `:` as its port delimiter — so the embedded
 *    url's scheme, its solidus, and the mark they spell are all consumed, and
 *    the credential lands in `pathname` with nothing in front of it. Two
 *    solidi fewer and `nextAuthority` in `./userinfo-spans` would have found
 *    it; one solidus fewer and the parser would have reported the credential
 *    itself. This is the state between them, and the seam is where it shows.
 *    `bringsOwnAuthority` in `./userinfo-spans` names both spellings that reach
 *    it.
 *
 * THE `URL` IS READ HERE AND NOWHERE BELOW, which is the one deliberate split
 * in this seam. `host` is the whole of the question this function answers, and
 * no text can be asked it — a path that begins with two solidi is the same text
 * whether the parser took an authority from it or left the host empty. So the
 * decision to ASK stays here, with the parsed object, and {@link seamSpan}
 * answers what the span IS from the path alone. Handing the scanner the `URL`
 * instead would put a parse's own report on both sides of a seam whose whole
 * subject is what that parse did NOT report, and it would cost every function
 * below the ability to be called from a test with a string literal.
 */
function seamUserinfo(parsed: URL, consumed: boolean): Span | null {
  if (parsed.host !== "" && !consumed) return null;
  return seamSpan(parsed.pathname);
}

/**
 * The first `limit` characters of `text` with every span in `spans` removed.
 *
 * ONE LOOP BODY FOR BOTH ROUTES, and the two callers differ only in what they
 * hand it. {@link withoutMalformedUserinfo} passes the scanner's own spans,
 * which are ascending and never overlap, and a limit shorter than the text.
 * {@link withoutUserinfos} passes needle matches over a message, which DO
 * overlap, and no limit at all. Written twice, the two loops disagreed about
 * both facts: one clipped and could not merge, the other merged and could not
 * clip.
 *
 * MERGING COSTS THE FIRST CALLER NOTHING, which is why this takes no parameter
 * for it. Two of the three lines below are inert on spans that do not overlap —
 * a span starting at or after the cursor never enters either arm — so the
 * merging form IS the clipping form for input that needs no merge. A parameter
 * would name a difference that the code does not have.
 *
 * `spans` must be sorted by `start`. Both callers supply that: the scanner
 * emits in order, and the needle pass sorts.
 *
 * CLIPPED, and that is round 10's whole correction. `limit` is the length of a
 * `pathname`, so a span may be FOUND past it — the `@` that closes a credential
 * the `?` cut in half is on the other side — and can never be EMITTED past it.
 * A span that crosses the limit removes everything from its start to the limit;
 * a span that starts at or after the limit is query or fragment text, which this
 * function's caller drops whole either way.
 */
function withoutSpans(text: string, spans: Span[], limit: number): string {
  let out = "";
  let cursor = 0;
  for (const span of spans) {
    if (span.start >= limit) break;
    // Wholly inside the run already removed.
    if (span.end <= cursor) continue;
    if (span.start > cursor) out += text.slice(cursor, span.start);
    // Otherwise it overlaps the run, and the run extends over it.
    cursor = span.end < limit ? span.end : limit;
  }
  return out + text.slice(cursor, limit);
}

/**
 * The path with every malformed authority's userinfo removed, read as far as
 * `tail` where the scanner says the path ends inside an authority.
 *
 * Never applied to the INPUT — {@link cleaned} hands it what a URL parser
 * emitted, and {@link userinfosOf} hands it a slot of one. Which URLs resolve
 * stays the raw input's own answer to give.
 *
 * THE CLIP IS `path.length`, AND IT IS NOT A PARAMETER. A span found past the
 * path is a span found in the query or the fragment, which this function's
 * caller drops whole — so the one correct limit is the one the path itself
 * gives, and the only caller cannot pass a different one. See
 * {@link withoutSpans} for what the clip does, and `pathUserinfoSpans` in
 * `./userinfo-spans` for the one state in which a span is looked for past the
 * path at all.
 *
 * Percent-encoding does not weaken the scan where the delimiters are literal:
 * it removes the whole span up to the `@`, so an encoded password
 * (`hunter%202`) goes with it. An encoded DELIMITER is a different question and
 * the answer is residual 2 — `%3A%2F%2F` and `%40` spell no authority any
 * parser reads, so the text they hold is a path segment. See
 * `disclosure-channels.spec.ts`, which pins the shapes on each side of that
 * line.
 */
function withoutMalformedUserinfo(path: string, tail: string, seam: Span | null): string {
  return withoutSpans(path, pathUserinfoSpans(path, tail, seam), path.length);
}

/**
 * Every userinfo an authority the parser did not read hides inside `text`.
 *
 * `"@"` ALONE is not a credential, and it is the one needle that must never
 * reach `replaceAll`. `://@host/x` yields a span of exactly one character, and
 * stripping every `@` from a message deletes e-mail addresses, handles, and
 * anything else the diagnostic was carrying.
 */
function hiddenUserinfos(text: string, seam: Span | null = null): string[] {
  return userinfoSpans(text, seam)
    .map((span) => text.slice(span.start, span.end))
    .filter((userinfo) => userinfo.length > 1);
}

/**
 * Every userinfo the FOUR SLOTS of one parsed url spell: its own credential,
 * and the ones hidden in the path, the query, and the fragment.
 *
 * ONE READING FOR BOTH BRANCHES OF {@link userinfosOf}, and it was two until
 * this became a function. The two copies were written a round apart and never
 * composed. The resolved branch read only the path, and lost a credential the
 * parser had normalized into a QUERY; when the query and the fragment were
 * added there, the comment over them still said "the SAME three slots" and left
 * `username`/`password` out.
 *
 * FOUR SLOTS, NOT THREE. A protocol-relative form — `\\alice:pw@host/v1` and
 * every tab/CR/LF variant the parser strips — hides a credential the parser
 * recovers into the AUTHORITY rather than into a path, so this url's own
 * credential is a slot like the other three.
 *
 * The path carries the SAME shape `redactUrl` scans for:
 * `https://api.test/go/https://svc:pw@internal.test/v1` is an ordinary
 * forward, and the parser reads only the outer authority. This pass is the
 * second line of {@link redactUrlInMessage} and removes userinfo wherever it
 * survives, so it reads the same slot the redactor does.
 *
 * The PATHNAME, never the href: the authority this URL really has is
 * `host:8443`, and a scan over the href would read that port as userinfo.
 *
 * The QUERY and the FRAGMENT are scanned for the same reason and carry none
 * of that risk. That argument is about THIS url's authority, which cannot
 * appear in either slot, and `redactUrl` drops both outright — so the only
 * place a credential hidden there can still surface is a message, which is
 * exactly what this pass exists to clean. A callback url carries its
 * redirect target in `?next=`, credential and all, more often than in a path
 * segment.
 *
 * The seam between the origin and the path carries a needle of its own, for
 * the reason {@link seamUserinfo} states, and a message quotes it in the same
 * spelling the path holds it. `consumed` is that question's other half: a
 * protocol-relative reference hands its authority to the parser, and
 * `redactUrl` emits the path alone. See {@link bringsOwnAuthority}.
 */
function slotUserinfos(parsed: URL, consumed: boolean): string[] {
  const { username, password } = parsed;
  const own = username || password ? [password ? `${username}:${password}@` : `${username}@`] : [];
  return [
    ...own,
    ...hiddenUserinfos(parsed.pathname, seamUserinfo(parsed, consumed)),
    ...hiddenUserinfos(parsed.search),
    ...hiddenUserinfos(parsed.hash),
  ];
}

/**
 * Every userinfo the URL carries: `["user:password@"]`, `["user@"]`, or `[]`.
 *
 * A URL can carry MORE than one, which is why this answers with a list. A
 * malformed scheme hides userinfo from the parser, and a well-formed URL hides
 * it in the PATH, because a path can embed another URL, credential and all.
 * See {@link userinfoSpans}.
 *
 * A URL THE PARSER REFUSED AND ONE IT READ DIFFER IN THREE THINGS, and in
 * nothing else. Which parse supplies the four slots, which text the RAW scan
 * reads, and whether the parser consumed the mark that opens the seam. The
 * three are the three lines below; the slots are {@link slotUserinfos}.
 *
 * A SET, because the answer is one. {@link withoutUserinfos} buckets the
 * needles by length and matches them by position, so neither the order of this
 * list nor a repeat in it can reach a message. The two branches used to dedupe
 * separately, and each dedupe was quadratic in the needle count.
 */
function userinfosOf(url: string): string[] {
  // A malformed scheme hides userinfo from the parser, not from a reader.
  //
  // BOTH forms, for the reason {@link redactUrl}'s relative branch reads
  // both: the parser CREATES the `://` this scan looks for when it rewrites
  // a backslash or removes an ASCII tab. The raw text carries the credential
  // a message quotes; the resolved path carries the mark that finds it.
  //
  // Where the parse SUCCEEDED the raw scan starts AFTER this url's own
  // authority, and the reason is the mirror of that one: the parser REWRITES
  // what it reads, so a password holding a backslash, a tab, a CR, or an LF
  // becomes a needle that no longer matches the text a platform quoted. The cut
  // is what keeps `host:8443` from being read as a credential — the same
  // guarantee "pathname, never href" buys. `afterOwnAuthority` answers WHERE the
  // cut is, and the slice is made here, because the scanner answers positions
  // and never text.
  const absolute = parseProbe(url);
  // `null` when the text is unresolvable even against the base. The raw needles
  // are then all there are.
  const parsed = absolute ?? parseProbe(url, RELATIVE_BASE);
  const raw = absolute === null ? url : url.slice(afterOwnAuthority(url));
  const needles = new Set(hiddenUserinfos(raw));
  if (parsed !== null) {
    for (const needle of slotUserinfos(parsed, absolute === null && bringsOwnAuthority(url))) {
      needles.add(needle);
    }
  }
  return [...needles];
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
  // THE PARSE ITSELF IS THE ANSWER for the absolute half: a url that parsed has
  // a scheme, so a protocol read could only ever say `true` again. See
  // {@link parseProbe} for why the parse is a read rather than a discarded
  // `new`.
  if (parseProbe(url) !== null) return true;
  return url.includes("@") || url.includes("?") || url.includes("#");
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
 * overlapping ones are merged, in {@link withoutSpans}.
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
  const spans: Span[] = [];
  for (let at = message.indexOf("@"); at >= 0; at = message.indexOf("@", at + 1)) {
    for (const [length, needles] of byLength) {
      const start = at + 1 - length;
      if (start < 0) continue;
      if (needles.has(message.slice(start, at + 1))) spans.push({ start, end: at + 1 });
    }
  }
  if (spans.length === 0) return message;

  // Sorted because {@link withoutSpans} reads them in order, and no needle
  // match arrives in one: the scan walks the `@`s forward, and a longer needle
  // ending on a later `@` starts before a shorter one ending on an earlier.
  spans.sort((left, right) => left.start - right.start);
  return withoutSpans(message, spans, message.length);
}
