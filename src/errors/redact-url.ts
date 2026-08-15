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
  ownUserinfo,
  pathEnd,
  pathScanText,
  pathUserinfoSpans,
  seamSpan,
  segmentUserinfos,
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
      return cleaned(absolute, origin, spilledAuthority(url)).href;
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
function cleaned(parsed: URL, origin: string, spilled = false): URL {
  for (;;) {
    const path = parsed.pathname;
    const seam = seamUserinfo(parsed, spilled);
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
 *
 * AND THE FIRST QUESTION IS WHETHER THE URL HAS AN AUTHORITY SLOT AT ALL, which
 * is round 21's R21-H2-02. `host` reports the empty string for two states, and
 * only one of them is the empty HOST this seam is about: an OPAQUE url has no
 * authority component, so there are no origin solidi for a mark to be written
 * across and no seam for {@link seamSpan} to read. Asked anyway, it read the
 * pathname of `mailto:alice@example.com` as a credential and answered the span
 * `alice@` — a needle {@link withoutUserinfos} then deleted from the message
 * wherever it appeared, so `…; alice@example.com was refused` became
 * `…; example.com was refused` and the record named a recipient the caller
 * never wrote. `sip:`, `xmpp:`, `urn:` and `im:` are the same url.
 *
 * THE SCHEME IS THE WHOLE OF IT, and it is the question {@link seamSpan} was
 * already written assuming: a seam exists only where the emitted origin spells
 * solidi of its own, which is the six hierarchical schemes and nothing else.
 * `redactUrl` reduces an opaque url to its scheme and never reaches
 * {@link cleaned}, so this arm is the message route's alone —
 * {@link slotUserinfos} asks every parsed url. `file:` is hierarchical and
 * keeps its answer, which is the one state the guard below is written for.
 *
 * AND `spilled` IS SPENT TWICE, ONCE ON EACH QUESTION, which is round 23's
 * R23-H3-01. It decides whether a url with a host of its own has a seam AT ALL,
 * and then it decides what `seamSpan` may read there: a scanner handed a
 * `pathname` cannot tell a solidus the parser FOLDED out of the caller's `\`
 * from one the caller typed, so `https://CORP\alice\service:hunter2@api.test/v1`
 * was asked the seam and then refused the credential, on the evidence of a
 * segment boundary that only the fold created. This function is where the raw
 * url has already been read, so it is where the fact belongs. `seamUserinfoEnd`
 * in `./userinfo-spans` holds the input and the grid.
 */
function seamUserinfo(parsed: URL, spilled: boolean): Span | null {
  if (!leadsWithHierarchicalScheme(parsed.protocol)) return null;
  if (parsed.host !== "" && !spilled) return null;
  return seamSpan(parsed.pathname, spilled);
}

/**
 * Did the caller's own authority SPILL into the path — did a `\` the caller
 * wrote inside it end it for the parser?
 *
 * THE THIRD STATE {@link seamUserinfo} NAMES, and round 20's R20-H4-08 is what
 * leaving it unnamed cost. Every one of the six hierarchical schemes is
 * SPECIAL, and under a special scheme the authority state terminates on `\`
 * exactly as it does on `/` — so `https://alice:\hunter2@api.test/p` parses
 * with the host `alice`, no username, no password, and the path
 * `/hunter2@api.test/p`. The parser is right and the caller wrote a credential:
 * `hunter2` reached `error.message` under every spelling a platform can quote,
 * and `toJSON().url` — the record a structured logger writes — kept it too,
 * because the url has an authority of its own so the seam was never asked and
 * the path spells no mark for a region to open on.
 *
 * ASKED OF THE RAW URL, which is the only text that knows: `pathname` holds the
 * `/` the parser folded and cannot be told from one the caller typed.
 * {@link bringsOwnAuthority} is the other question of this shape, and the two
 * answer the same thing for the two branches — the text the caller wrote as
 * authority is in the path now.
 *
 * ONE CHARACTER, READ WHERE THE AUTHORITY STOPPED. `afterOwnAuthority` answers
 * the first `/`, `\`, `?` or `#`, so the character sitting there says WHICH of
 * them stopped it, and only the `\` is a solidus the caller did not spell as
 * one. `https://api.test/x` reads `/` and answers `false`.
 */
function spilledAuthority(url: string): boolean {
  return url[afterOwnAuthority(url)] === "\\";
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
 * Every userinfo an authority the parser did not read hides inside `text`, as
 * far as `kept` for the needles that can move a HOST.
 *
 * `"@"` ALONE is not a credential, and it is the one needle that must never
 * reach `replaceAll`. `://@host/x` yields a span of exactly one character, and
 * stripping every `@` from a message deletes e-mail addresses, handles, and
 * anything else the diagnostic was carrying.
 *
 * `kept` IS WHERE THIS TEXT STOPS BEING TEXT THE EMITTED URL KEEPS, and past it
 * the WHOLE span is dropped and only {@link segmentUserinfos} answers. That is
 * round 17's R17-H3-02. A span can cover a HOST — RES-6 — and removing one from
 * a message joins the mark in front of it to text that was a path:
 * `https://api.test/v1?next=https://cdn.test/u/alice@example.com` is an
 * ordinary callback url, its query yields the needle `cdn.test/u/alice@`, and a
 * message quoting the callback TARGET read `…contacting https://example.com/…`.
 * So `toJSON().url` named `api.test` and `toJSON().message` named
 * `example.com` — a host neither the caller's url nor the platform's own
 * message ever named as one, and two records of one failure naming different
 * hosts.
 *
 * WHERE THE SPAN COMES FROM THE PATH IT IS KEPT WHOLE, whatever it covers, and
 * that is why this is a boundary rather than a rule: `redactUrl` removes the
 * same text from the url it emits, so both records move together and RES-6 stays
 * one residual instead of becoming two answers. A slot `redactUrl` drops WHOLE —
 * the query, the fragment — is the one place the url pass makes no answer for
 * the message to agree with.
 *
 * AND THE SEGMENTS ARE EMITTED ALONGSIDE IT, NEVER INSTEAD OF IT. That is round
 * 23's R23-H2-01, and the two halves of the sentence are two different harms.
 * THE WHOLE SPAN is what keeps the url's own quote answering exactly as
 * `redactUrl` does: the segments of `alice@sso.test/svc:hunter2@` are `alice@`
 * and `svc:hunter2@`, and removing only those leaves `sso.test/` standing in a
 * message while `url` names `internal.test` — two records of one failure naming
 * different hosts, which is R17-H3-02 again wearing the path's clothes. THE
 * SEGMENTS are what a SECOND MENTION loses. A needle is deleted from a message
 * wherever it appears, and a forwarding diagnostic names the upstream again in
 * the caller's own spelling:
 * `https://api.test/go/https://b.test/svc:hunter2@i.test/v1` draws ONE span,
 * `b.test/svc:hunter2@`, so `svc:hunter2@` was no needle at all — the record
 * clean, the password in `…; the upstream svc:hunter2@i.test was refused` and in
 * every render of it, on 48 of the 100 forwarding rows
 * `redaction-span-needle-derivation.spec.ts` crosses. Neither reading alone is the answer;
 * the union of the two is.
 *
 * RE-READ, NOT REFUSED, and the difference is a credential. Refusing the needle
 * leaves the whole of it in the message; the re-read keeps every part of it
 * that a parse could call a userinfo. Measured three ways over round 17's
 * structured and credential populations and over every slot of each url a
 * platform could quote: refusing the span left a planted credential in 84
 * messages, keeping its last segment alone left one in 50, and this leaves
 * none.
 *
 * WHAT IT COSTS is a credential that spells a solidus AND hides in a query or a
 * fragment AND is quoted by a message that does not quote the whole url: the
 * segments in front of its last solidus stay. `redactUrl` still drops the slot
 * from `url`, and the first line of {@link redactUrlInMessage} still removes
 * the whole url wherever it is quoted.
 *
 * The default keeps everything, which is the answer for a `pathname`.
 *
 * AND THE NEEDLE ENDS AT THE `@`, WHERE THE SPAN NEED NOT. That is round 21's
 * R21-H2-01 and R21-H3-01, found from the cost side and from the disclosure
 * side with the same three characters between them. A span is a POSITION to
 * `redactUrl`, so `pastFiller` in `./userinfo-spans` closes it past everything
 * the next parse would delete — a solidus, a single-dot segment — and removing
 * that filler is free there and buys the pass count that comment argues for. A
 * needle is TEXT, and {@link withoutUserinfos} can only ever match a slice that
 * ends at an `@` in the message. So the span `svc:hunter2@/` that
 * `https://api.test/go/https://svc:hunter2@/cdn.test/v1` answers is a needle no
 * `@` anywhere can terminate: it removed nothing, on any input, ever, while
 * `redactUrl` dropped the same credential from `url` — the record clean and the
 * message holding the password, on 104 of 156 forwarding rows.
 *
 * The span is left exactly as the scanner drew it and the SLICE is cut back to
 * the last `@` the span holds, because the width is right for the one route and
 * wrong for the other. Every span holds one: {@link seamSpan} ends AT an `@`,
 * {@link segmentUserinfos} answers only segments that do, and `userinfoSpans`
 * closes each span at `pastFiller` of an `@` it just read. Where the search
 * finds none the slice is empty and the length guard below refuses it, which is
 * the same answer it already gives `@` alone — so this needs no arm of its own.
 */
function hiddenUserinfos(text: string, seam: Span | null = null, kept = text.length): string[] {
  const found: string[] = [];
  for (const span of userinfoSpans(text, seam)) {
    const whole = span.start < kept ? [span] : [];
    for (const one of [...whole, ...segmentUserinfos(text, span)]) {
      const userinfo = text.slice(one.start, text.lastIndexOf("@", one.end - 1) + 1);
      if (userinfo.length > 1) found.push(userinfo);
    }
  }
  return found;
}

/**
 * Does this needle NAME a credential, or is it one of the two userinfos the URL
 * Standard writes down as nothing at all?
 *
 * THE GRAMMAR RATHER THAN A LENGTH. A userinfo is a username and an optional
 * password, and it is EMPTY when both are — which is exactly the two spellings
 * `@` and `:@`. The URL serializer writes neither: it appends the colon only
 * under a non-empty-password guard, and it appends the whole userinfo only
 * where there is one, so `new URL("https://:@api.test/v1").href` IS
 * `https://api.test/v1`. Both spellings carry no text a reader could recover.
 *
 * {@link hiddenUserinfos} refuses the first of the two outright and states why:
 * a needle is deleted from a message WHEREVER it appears, and `@` alone appears
 * in every e-mail address a diagnostic carries. The second is the same needle
 * two characters long, and round 19 made it reachable by reading the url's own
 * authority in the caller's spelling: `https://:@api.test/v1` answered `:@`,
 * and the pass turned `ratio 3:@4; key:@value` into `ratio 34; keyvalue`.
 * R20-H3-04.
 *
 * IT IS REFUSED WHERE IT NAMES NOTHING AND KEPT WHERE IT IS STRUCTURE, which is
 * what {@link withoutUserinfos} spends this on: an empty userinfo is a userinfo
 * only where a mark opened an authority in front of it. That keeps the url's
 * own `https://:@api.test/v1` reduced in the message the platform quoted, and
 * it is the whole difference between the two `:@`s of that message.
 */
function namesACredential(userinfo: string): boolean {
  const named = userinfo.slice(0, -1);
  return named !== "" && named !== ":";
}

/**
 * One node of the REVERSE needle trie: the needle that ends here, and the
 * characters that can precede it.
 *
 * `needle` is the empty string where no needle ends at this node, which is the
 * same "no match" spelling {@link withoutUserinfos} already used for its bucket
 * search. A needle is never empty itself — {@link hiddenUserinfos} refuses
 * anything one character long — so the two states cannot be confused.
 */
type NeedleNode = { needle: string; before: Map<number, NeedleNode> };

/**
 * The needle set as ONE trie, keyed by character code and read from each
 * needle's `@` BACKWARDS.
 *
 * THE SET, NOT A NEEDLE, IS WHAT THE MESSAGE PASS MAY WALK, and that is round
 * 23's R23-H2-02. Round 22 replaced a hash lookup on a copied slice with a
 * comparison in place, which is right about the copying and moved the whole cost
 * into character comparisons — the one quantity no instrument this audit owns
 * had ever counted. What it left behind is a walk over every needle that shares
 * a LENGTH, so the pass cost the message's `@` count times the needle count,
 * both chosen by a redirecting server: one out of a query slot the message
 * quotes, one out of the credentials a forward embeds. Measured over an
 * eightfold sweep of the COUNT — round 22's own sweep varied the LENGTH and held
 * the count at one — compares per input character climbed 41.6 → 82.4 → 163.9 →
 * 327.0, and 8,000 credentials took 1,325 ms inside ONE error construction
 * against 12 ms at 1,000.
 *
 * The trie answers the whole set in one walk: each character of the message is
 * read at most once per step of a walk that no needle's length bounds, and every
 * needle ending at that position is collected on the way past. So the search
 * costs the DEPTH reached rather than the count of needles that share a length,
 * and the needle count leaves the pass entirely.
 *
 * AND THE BOUND IS THE ONE THE BUCKET WALK ALREADY ARGUED FOR, now stated of the
 * set. A walk from an `@` of the message crosses a previous `@` of the message
 * only where some needle spells one INSIDE itself, so a set spelling none has
 * disjoint walks and the whole pass is linear in the message; a set spelling `k`
 * of them buys `k + 1` times that, and it has to spell them in the url for the
 * scanner to answer them. Read FORWARDS the bound is gone, and the same input
 * takes it away: every `@` of a quoted query tests a start that lands inside one
 * run of the character the needles open with.
 *
 * The trie costs one node per distinct needle suffix, which is at most the sum
 * of the needle lengths — and every needle is a slice of one of the six texts
 * {@link userinfosOf} scans, whose spans do not overlap, so that sum is linear
 * in the caller's url.
 */
function needleTrie(userinfos: string[]): NeedleNode {
  const root: NeedleNode = { needle: "", before: new Map() };
  for (const userinfo of userinfos) {
    let node = root;
    for (let at = userinfo.length - 1; at >= 0; at -= 1) {
      const code = userinfo.charCodeAt(at);
      let next = node.before.get(code);
      if (next === undefined) {
        next = { needle: "", before: new Map() };
        node.before.set(code, next);
      }
      node = next;
    }
    node.needle = userinfo;
  }
  return root;
}

/**
 * Does a mark open an authority immediately in front of `at`?
 *
 * A SOLIDUS, IN EITHER SPELLING, and that is the whole question a message can
 * answer. The scanner's own grammar lives in `./userinfo-spans`, and this is
 * not a region question: it reads a MESSAGE, which is arbitrary text with a url
 * quoted somewhere inside it, and asks only whether the two characters in front
 * of a match are the ones a url writes before its userinfo. `\` counts because
 * a special scheme reaches its authority over either one.
 */
function opensAnAuthority(message: string, at: number): boolean {
  return message[at - 1] === "/" || message[at - 1] === "\\";
}

/**
 * Every userinfo the FOUR SLOTS of one parsed url spell: its own credential,
 * and the ones hidden in the path, the query, and the fragment.
 *
 * ONE READING FOR BOTH BRANCHES OF {@link userinfosOf}, and it was two until
 * this became a function. The two copies were written a round apart and never
 * composed: one of them read only the path, and the comment over the other said
 * "the SAME three slots" while leaving `username`/`password` out.
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
 * THE QUERY AND THE FRAGMENT ARE SCANNED AT `kept = 0`, and round 17 is why.
 * They are scanned because a callback url carries its redirect target in
 * `?next=`, credential and all, more often than in a path segment, and
 * `redactUrl` drops both slots outright — so a message is the only place a
 * credential hidden there can still be removed. And dropping them outright is
 * exactly why a needle from either one may not spell a SOLIDUS: the url pass
 * removes nothing there, so a span that eats a host moves the message alone.
 * See {@link hiddenUserinfos}, which holds the rule and the input.
 *
 * The seam between the origin and the path carries a needle of its own, for
 * the reason {@link seamUserinfo} states, and a message quotes it in the same
 * spelling the path holds it. `consumed` is that question's other half: a
 * protocol-relative reference hands its authority to the parser, and
 * `redactUrl` emits the path alone. See {@link bringsOwnAuthority}.
 *
 * AND THE PATH IS READ IN BOTH OF THE TEXTS THE URL ROUTE READS IT IN, which is
 * round 22's R22-H2-01. `cleaned` scans `pathname` joined to the slot the outer
 * parse cut it off from, in the one state {@link pathScanText} names, and this
 * read `pathname` alone — so for `https://api.test/go/https://svc:hun<pw?ter3@h.test`
 * the parser's own spelling of the credential was never a needle. The raw scan
 * in {@link userinfosOf} covers the CALLER's spelling and only that, and the `<`
 * is one character of the path percent-encode set: the two texts a message can
 * quote disagreed, the platform quotes the one the parser serialized, and the
 * password reached every render of the message while `toJSON().url` was clean.
 *
 * BOTH, AND NEITHER SUBSUMES THE OTHER, which is the shape the head question
 * already has in {@link userinfosOf}. The joined text answers the `@` the outer
 * `?` put on the far side of the cut; it also answers a WIDER span for the same
 * credential, running to that `@` — and a platform that quotes the url with the
 * fragment or the query stripped holds neither the tail nor that needle. The
 * path alone answers the narrow one. Asked twice only where the two texts
 * differ, which {@link pathScanText} reports by answering `path` itself.
 *
 * `kept` IS `pathname`'s LENGTH FOR THE JOINED TEXT, and it is the boundary
 * {@link hiddenUserinfos} states: past it lies a slot `redactUrl` drops whole,
 * so a needle that spells a solidus there is a rewrite the url pass never makes.
 * It is the same boundary the raw scan draws with `pathEnd`.
 */
function slotUserinfos(parsed: URL, spilled: boolean): string[] {
  const { username, password } = parsed;
  const own = username || password ? [password ? `${username}:${password}@` : `${username}@`] : [];
  const path = parsed.pathname;
  const seam = seamUserinfo(parsed, spilled);
  const joined = pathScanText(path, parsed.search + parsed.hash);
  return [
    ...own,
    ...hiddenUserinfos(path, seam),
    ...(joined === path ? [] : hiddenUserinfos(joined, seam, path.length)),
    ...hiddenUserinfos(parsed.search, null, 0),
    ...hiddenUserinfos(parsed.hash, null, 0),
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
 * nothing else. Which parse supplies the slots, which text the RAW scan reads,
 * and whether the parser consumed the mark that opens the seam. The three are
 * the three lines below; the slots are {@link slotUserinfos}.
 *
 * A SET, because the answer is one. {@link withoutUserinfos} reads the needles
 * into one trie and matches them by position, so neither the order of this list
 * nor a repeat in it can reach a message. The two branches used to dedupe
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
  //
  // AND THE HEAD IS ASKED TOO, in the caller's own spelling, because the cut
  // took the url's OWN userinfo away from the raw scan and
  // {@link slotUserinfos} hands back only the parser's spelling of it. The two
  // agree for `hunter2` and differ for every password the userinfo encode set
  // touches — a space, a non-ASCII letter, `|`, `<` — so a message quoting the
  // url as the caller wrote it kept the password while the same message quoting
  // `hun%20ter2` lost it. That is round 19's R19-H3-01, and it is the same
  // "needle that no longer matches" the paragraph above names, wearing the one
  // slot the cut removed.
  //
  // AND IT IS ASKED TWICE, WITH TWO QUESTIONS, which is round 20's R20-H3-01
  // and R20-H3-02. Round 19 asked the head with `hiddenUserinfos` alone, and
  // that reaches the REGION rules — which open at a scheme colon under fewer
  // than two solidi only for the five schemes the URL Standard gives an
  // authority state, and which never skip the tab, CR and LF the parser removes
  // from the whole input before it reads anything. Both answers are right about
  // a colon found INSIDE a path and neither is the question the head asks, so
  // `file:/svc:hun ter2@api.test/v1` and `htt<TAB>ps:/svc:hun ter2@api.test/v1`
  // opened no region at all, the caller's spelling of the password was never a
  // needle, and it reached all seven channels. `ownUserinfo` in
  // `./userinfo-spans` asks the head question instead: the parse committed to
  // reading an authority at that offset, so the answer is the URL Standard's
  // own split and no region rule is consulted.
  //
  // BOTH, AND NEITHER SUBSUMES THE OTHER. The head question answers ONE span —
  // this authority's userinfo — and a head can spell more than one: a scheme
  // token inside it opens a region of its own, and the region scan finds the
  // shorter needle nested in the longer one. Dropping the region scan cost a
  // needle on a message quoting a `file:` url whose emitted form still held the
  // password, measured at 1 row in the 40,000-url credential population. The
  // union is what both slots of every other needle already are.
  //
  // THE PORT IS STILL SAFE, and that is why this reads the head rather than
  // moving the cut. An authority's LAST `@` ends its userinfo, so a span found
  // here stops in front of the host and `https://api.test:8443` yields no needle
  // at all. And what the span covers is text `redactUrl` drops from `url` too,
  // in `stripValues` — so the two records move together, which is the boundary
  // {@link hiddenUserinfos} states for every other needle.
  //
  // AND IT IS ONE STRING WITH THE SLOT BOUNDARY INSIDE IT, which is why the
  // raw scan carries `pathEnd` where {@link slotUserinfos} carries a slot. The
  // text runs from the path on into the query and the fragment, and a span may
  // legitimately cross the boundary — a credential the `?` cut in half is found
  // here and nowhere else. So the scan stays whole and the BOUNDARY is passed
  // instead: past it, a needle that spells a solidus is refused, exactly as it
  // is for the two slots. Without that the callback url in
  // {@link slotUserinfos} yields `cdn.test/u/alice@` here instead of there, and
  // one fix would close one route out of two.
  //
  // AND THE HEAD IS ASKED ONLY WHERE THERE IS AN AUTHORITY TO BE THE HEAD OF,
  // which is the other half of round 21's R21-H2-02. `ownUserinfo`'s own comment
  // opens "ASKED WHERE THE PARSER HAS ALREADY COMMITTED", and for an OPAQUE url
  // it never committed to anything: `mailto:alice@example.com` has no authority
  // component, so {@link ownAuthorityStart} lands on the local part, the last
  // `@` before the text ends is the address's own, and the head answered
  // `alice@` — a needle {@link withoutUserinfos} then deleted from the message
  // wherever it appeared. `sip:`, `xmpp:`, `urn:` and `im:` are the same url.
  //
  // THE SERIALIZER IS THE READ, and it is the parse's own report rather than a
  // second grammar written here. The URL Standard writes the two solidi after
  // the scheme colon exactly where the url HAS a host, so `href` starting with
  // `protocol` and `//` is the authority state having run and nothing else. It
  // is NOT the hierarchical-scheme question {@link seamUserinfo} asks: a
  // non-special scheme spelling `//` reaches the authority state too, and
  // `git://svc:hun\ter2@api.test/v1` is a userinfo the parser READS — the head
  // is the only place the caller's spelling of that password is a needle, and
  // the qualifier grid in `redaction-needle-filler.spec.ts` measures 2,550 rows of
  // it. `file:` keeps its answer under any solidus count, because the file state
  // serializes an empty host and writes the solidi anyway; that is R20-H3-01's
  // row, and it is why this is not `parsed.host !== ""` either.
  //
  // WHAT IT COSTS is an opaque path whose `@` closes a BARE NAME — `git:svc@h` —
  // whose text stops being a needle. It is the ONE state the two sentences above
  // leave, and naming `git:svc:pw@h` here instead named the state the guard was
  // written to KEEP: a colon is exactly what holds that needle, so
  // `git:svc:hunter2@api.test/v1` still loses `svc:hunter2@` from a message that
  // quotes it. R22-H3-02. The URL Standard reads no credential in either, which
  // is the scope `SECURITY.md`'s password claim already carries, and `redactUrl`
  // still reduces the whole url to its scheme.
  const absolute = parseProbe(url);
  // `null` when the text is unresolvable even against the base. The raw needles
  // are then all there are, and `redactUrl` answers with the empty string — so
  // there is no emitted url for a message to disagree with, and no slot of it to
  // draw the boundary at. The scan keeps every needle in that one state.
  const parsed = absolute ?? parseProbe(url, RELATIVE_BASE);
  const cut = absolute === null ? 0 : afterOwnAuthority(url);
  const raw = url.slice(cut);
  const head = absolute === null ? null : ownUserinfo(url);
  const spelled = head === null ? "" : url.slice(head.start, head.end);
  // WHERE THE PARSER READ AN AUTHORITY, its own split is the answer and the head
  // is spent whatever it spells. Where it read none, the text is an opaque path
  // and the URL Standard calls no part of it a userinfo — but a colon inside it
  // is a PASSWORD the caller wrote, and round 20's corpus measures 36 checks of
  // `git:svc:hun ter2@api.test/v1` losing theirs to this needle and to nothing
  // else. So the two states keep the head for two reasons, and only the state
  // that has neither — an opaque path whose `@` closes a bare name — gives it up.
  const authority = absolute !== null && absolute.href.startsWith(`${absolute.protocol}//`);
  // The seam's own question, asked exactly as `redactUrl` asks it on each of its
  // two branches: a reference that brought its own mark had its authority
  // CONSUMED, and an absolute url whose authority a `\` cut short had it SPILL
  // into the path. Both leave a userinfo where only the seam can find it, and
  // both are the state {@link seamUserinfo} spends the answer on twice.
  const spilled = absolute === null ? bringsOwnAuthority(url) : spilledAuthority(url);
  const needles = new Set([
    ...(spelled !== "" && (authority || spelled.includes(":")) ? [spelled] : []),
    ...hiddenUserinfos(url.slice(0, cut)),
    ...hiddenUserinfos(raw, null, parsed === null ? raw.length : pathEnd(raw)),
  ]);
  if (parsed !== null) {
    for (const needle of slotUserinfos(parsed, spilled)) {
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
 * so it is removed wherever it survives. `toJSON()` redacts `url`
 * independently, and copies `message` verbatim, so a miss here DOES reach the
 * record. `SECURITY.md` states what survives and where; it is not restated
 * here, because two copies of one rule is how this comment came to say the
 * opposite.
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
 * AND THE SEGMENT IS A NEEDLE OF ITS OWN, which widens the same residual by the
 * width round 23's R23-H2-01 must buy: `alice@` comes out of that span too, so
 * a message naming the tail alone loses it as well. {@link hiddenUserinfos}
 * holds the credential that reading is the answer to, and why the whole span
 * stays beside it.
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
 * the message is the only place a needle can end, so each one is asked of the
 * whole needle set at once, backwards, and no walk reads past the first
 * character no needle continues.
 *
 * COMPARED IN PLACE, AND THAT IS `spellsToken`'s OWN RULE (in `./userinfo-spans`)
 * APPLIED TO THE ROUTE IT WAS NEVER APPLIED TO. This used to cut the candidate
 * out of the message — `message.slice(start, at + 1)` — so that a `Set` could be
 * asked about it, unconditionally and before any character of it was looked at.
 * A needle is NOT short: it is a slice of the caller's url, so its length is the
 * url's, and the characters copied were the message's `@` count times the sum of
 * the distinct needle lengths — both of them chosen by a redirecting server, one
 * out of a query slot the message quotes and one out of an embedded credential.
 * Measured over an eightfold sweep, copied per input character climbed
 * 148.8 → 274.2 → 524.4 → 1024.5, and a 128 KB url copied 1.03e9 characters and
 * took 39,206 ms inside ONE error construction — which `toJSON()` never repeats,
 * because it copies the message, but which every construction pays. R22-H2-02.
 *
 * AND THE SET IS ASKED ONCE, NOT NEEDLE BY NEEDLE. Round 22 answered the copy
 * with a walk over the needles sharing one LENGTH, which removed the allocation
 * and left the needle COUNT multiplying the message's `@` count. That is round
 * 23's R23-H2-02 and it is the same two remote quantities the paragraph above
 * names, multiplied the other way round. {@link needleTrie} holds the numbers,
 * what the trie replaces the length buckets with, and why the bound the bucket
 * walk argued for per needle now holds for the SET.
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

  const root = needleTrie(userinfos);

  // EVERY match, before any of them is applied. A needle that starts inside an
  // earlier match is the case that matters, so nothing can be decided until all
  // of them are known.
  const spans: Span[] = [];
  for (let at = message.indexOf("@"); at >= 0; at = message.indexOf("@", at + 1)) {
    let node = root;
    for (let start = at; start >= 0; start -= 1) {
      const next = node.before.get(message.charCodeAt(start));
      // No needle of the SET continues here, so none of them can end at this
      // `@` from any earlier start either.
      if (next === undefined) break;
      node = next;
      const match = node.needle;
      if (match === "") continue;
      // AN EMPTY USERINFO IS A USERINFO ONLY BEHIND A MARK, and that is the one
      // needle whose text is not distinctive enough to stand for itself. `:@`
      // names nothing — see {@link namesACredential} — so what a match of it
      // removes is decided by what opened the authority in front of it. The
      // solidus is that mark wherever a message quotes one:
      // `https://:@api.test/v1` is the url reduced, and `ratio 3:@4` and
      // `key:@value` are the platform's own arithmetic and the platform's own
      // key. R20-H3-04 is the round that deleted all three.
      if (!namesACredential(match) && !opensAnAuthority(message, start)) continue;
      spans.push({ start, end: at + 1 });
    }
  }
  if (spans.length === 0) return message;

  // Sorted because {@link withoutSpans} reads them in order, and no needle
  // match arrives in one: the scan walks the `@`s forward, and a longer needle
  // ending on a later `@` starts before a shorter one ending on an earlier.
  spans.sort((left, right) => left.start - right.start);
  return withoutSpans(message, spans, message.length);
}
