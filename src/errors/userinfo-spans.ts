/**
 * WHERE A TEXT SPELLS A CREDENTIAL THE URL PARSER DID NOT REPORT AS ONE.
 *
 * One question, asked of a string and answered with positions:
 * {@link userinfoSpans} takes text and returns every `[start, end)` region of
 * userinfo inside it. {@link seamSpan} answers the same question for the one
 * region an origin and a path spell BETWEEN them. Nothing here emits text,
 * removes text, or decides what a caller does with a span.
 *
 * WHY IT IS ITS OWN MODULE. `redact-url.ts` reaches this scan from two
 * directions — `redactUrl` through its rebuild loop, and `redactUrlInMessage`
 * through the needle pass it runs over a message — and the two routes had no
 * name in common. Three costs were measured before the seam was drawn: the
 * needle route scanned one url's four slots in two places that were fixed a
 * round apart and never composed; the two span-application loops were written
 * twice with different clipping; and a defect in a span could only be asserted
 * as a whole-string diff through `redactUrl`, which is a test of the emitter
 * for a bug in the scanner. Spans are the interface, so a span is now what a
 * test can write down. See `userinfo-spans.spec.ts`.
 *
 * NO `URL` OBJECT CROSSES THIS SEAM, and that is deliberate rather than
 * incidental. A `URL` is the answer of a parse, and this module exists to read
 * the text a parse EMITTED for the credentials that parse did not report. Two
 * questions here are about a url rather than about a text — whether a url has a
 * seam at all, and which slots of a url are worth scanning — and both stay with
 * the caller, where the `URL` object lives. `seamUserinfo` in `./redact-url` is
 * that split written out: it reads `host` and answers whether to ask, and this
 * module answers what the span IS. The rule keeps every function here callable
 * from a test with a string literal.
 *
 * EVERY GRAMMAR QUESTION IS ASKED HERE, and the character classes being private
 * is what that means. `isSolidus`, `isIgnored`, `isStripped`,
 * {@link isSchemeCharacter} and the narrower {@link SCHEME_HEAD} a scheme must
 * begin with are readings of the URL Standard's own grammar, and
 * a second file holding them is a second file that can answer a grammar
 * question for itself. It did: two functions said whether a scheme opens an
 * authority at a colon, and the two disagreed about `file:`, about the tab the
 * parser removes, and about which direction to read. So `./redact-url` asks
 * WHOLE questions — {@link leadsWithHierarchicalScheme},
 * {@link bringsOwnAuthority}, {@link afterOwnAuthority}, {@link pathEnd},
 * {@link segmentUserinfos} — and reads no character of the grammar itself.
 *
 * THE SCHEME LIST IS ONE LIST. {@link HIERARCHICAL_SCHEMES} holds the six the
 * URL Standard calls special. {@link SPECIAL_SCHEMES} and
 * {@link LONGEST_HIERARCHICAL_SCHEME} are derived from it, and every question
 * about a scheme reads one of the three, so a scheme cannot be known to one
 * question and unknown to another.
 *
 * INTERNAL. Never export it from a barrel.
 */

/**
 * A half-open `[start, end)` region of a text: `start` is included, `end` is
 * not. The one shape every answer in this module carries.
 *
 * @internal
 */
export type Span = { start: number; end: number };

/** ALPHA / DIGIT / `+` / `-` / `.` — the characters a scheme is spelled from. */
const SCHEME_CHARACTER = /[a-z0-9+\-.]/i;

/**
 * ALPHA — the characters a scheme may BEGIN with, which is a strictly narrower
 * set than {@link SCHEME_CHARACTER} and the whole of the difference between a
 * scheme and a token that looks like one.
 *
 * The URL Standard's scheme start state accepts an ASCII alpha and nothing
 * else, so `9x:`, `9:`, `.:` and `-:` are tokens no parser reads as a scheme
 * anywhere. {@link schemeWroteTheMark} is the one reader of this, and its own
 * comment holds what reading a single character instead had cost.
 */
const SCHEME_HEAD = /[a-z]/i;

/** Is this one of the characters a scheme is spelled from? */
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
 * `from`, advanced over every solidus: where the authority those solidi open
 * BEGINS.
 *
 * THE COUNT IS ANY, because the parser consumes every one of them — the
 * special-authority-ignore-slashes state leaves for the authority state on the
 * first character that is neither `/` nor `\`. {@link pastFiller},
 * {@link nextAuthority} and {@link authorityAt} each used to spell this walk
 * for themselves.
 *
 * READ OF TEXT A PARSE ALREADY PRODUCED, which is why nothing is skipped
 * BETWEEN the solidi. Two questions here read a RAW input instead, where the
 * tab, CR and LF the parser has not yet removed can still sit between two
 * solidi, and each counts its own: {@link bringsOwnAuthority} and
 * {@link afterOwnAuthority}.
 */
function pastSolidi(text: string, from: number): number {
  let at = from;
  while (isSolidus(text[at])) at += 1;
  return at;
}

/**
 * The index of the character IN FRONT of the solidus run that ends at `from`,
 * and `-1` where the run reaches the start of the text.
 *
 * The mirror of {@link pastSolidi}, and one of the two places this module reads
 * backwards. Two questions ask it, and both are about the MARK that opened a
 * region rather than about the region's own text: {@link popsBefore} needs the
 * run's length, and {@link schemeWroteTheMark} needs the character the run
 * hangs off. Neither walks over anything but solidi, so a text with N solidi
 * pays N for all of them together — the runs a forward cursor lands past are
 * disjoint. Both are asked ONCE per region, where the region opens, which is
 * what makes that disjointness a bound rather than an observation.
 */
function beforeSolidi(text: string, from: number): number {
  let at = from - 1;
  while (isSolidus(text[at])) at -= 1;
  return at;
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
 * Where the text the PARSER reads begins: past the leading run of characters
 * {@link isStripped} names.
 *
 * ONE WALK FOR THE TWO QUESTIONS THIS MODULE ASKS OF A RAW INPUT, and they have
 * to agree for the reason {@link ownAuthorityStart} is written once.
 * {@link bringsOwnAuthority} skips this run before it reads a scheme, and
 * {@link foldsReverseSolidus} asks the same text about the same scheme for the
 * other end of the parse. One leading space in front of
 * `https://alice:\hunter2@api.test/p` hides that scheme from a reader that does
 * not skip it, while the parser strips the space and reads `https` exactly
 * where it was — and a reader that calls that url non-special keeps a password.
 */
function pastStripped(text: string): number {
  let at = 0;
  while (isStripped(text[at])) at += 1;
  return at;
}

/**
 * The six schemes whose path is structure rather than a value, by NAME — which
 * is the spelling a path holds them in, and the spelling the URL grammar reads
 * them in.
 *
 * The BASE list, and the only place a scheme is written down.
 * {@link SPECIAL_SCHEMES} and {@link LONGEST_HIERARCHICAL_SCHEME} are derived
 * from it rather than written again, and {@link leadsWithHierarchicalScheme}
 * reads it whole, so a scheme cannot be hierarchical to one question and
 * unknown to another. `HIERARCHICAL_PROTOCOLS` in `./redact-url` was a fourth
 * expression of this list, and the `5` written into that file was a fifth.
 */
const HIERARCHICAL_SCHEMES = new Set(["http", "https", "ws", "wss", "ftp", "file"]);

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
 * `file:` stays in {@link HIERARCHICAL_SCHEMES}, because
 * {@link leadsWithHierarchicalScheme} answers a different question — is this
 * path structure rather than a value — and for a `file:` URL the path IS the
 * structure.
 */
const SPECIAL_SCHEMES = new Set([...HIERARCHICAL_SCHEMES].filter((scheme) => scheme !== "file"));

/**
 * The length of the longest {@link HIERARCHICAL_SCHEMES} name, which BOUNDS the
 * forward walk {@link leadsWithHierarchicalScheme} makes: the walk costs the
 * same whatever follows the token it reads.
 *
 * DERIVED, never written down. It was a `5` in `./redact-url`, a hand-kept fact
 * about a list this file owns, and a seventh scheme added here would have left
 * it silently wrong there.
 */
const LONGEST_HIERARCHICAL_SCHEME = Math.max(
  ...[...HIERARCHICAL_SCHEMES].map((scheme) => scheme.length),
);

/**
 * Does the token at `from` spell one of the six {@link HIERARCHICAL_SCHEMES},
 * then a colon?
 *
 * TWO QUESTIONS ABOUT ONE LIST LIVE IN THIS FILE, AND THEY MUST ANSWER
 * DIFFERENTLY. This one reads all SIX and asks whether a scheme names a
 * hierarchy at all. {@link isSpecialScheme} reads FIVE and asks whether a colon
 * already inside a text opens an authority under fewer than two solidi, which
 * `file:` does not — its own comment holds the path a `file:` answer of `true`
 * deleted. The two were one name in two files once, and they disagreed about
 * `file:`, about the tab, and about which direction to read; they are two names
 * in one file now, so the disagreement is a decision a reader meets rather than
 * a drift.
 *
 * FOUR CALLERS, and the six are right for all of them. Two ask it of a RAW
 * reference: {@link bringsOwnAuthority}, for the state where the parser eats
 * the scheme colon, and {@link foldsReverseSolidus}, for whether this url's own
 * authority reads a `\` as a solidus. Two more, both in `./redact-url`, ask it
 * of a `URL.protocol` — which is a scheme and a colon, and nothing else.
 * `redactUrl` asks it to tell a hierarchical url from an opaque one, because an
 * opaque url carries its payload in the path and is reduced to its scheme;
 * `seamUserinfo` asks it because a seam exists only where the emitted origin
 * spells solidi of its own, which is round 21's R21-H2-02.
 *
 * ASKED OF A RAW INPUT, so the three characters {@link isIgnored} names are
 * skipped INSIDE the token: the parser removes them before it reads the scheme,
 * so a scheme broken by one is still that scheme. A `URL.protocol` holds none of
 * them, so the same walk serves the other caller unchanged.
 *
 * BOUNDED at {@link LONGEST_HIERARCHICAL_SCHEME}, so the walk costs the same
 * whatever follows it — the same reason {@link isSpecialScheme} reads forward
 * from an offset rather than backwards to a token start.
 *
 * @internal
 */
export function leadsWithHierarchicalScheme(text: string, from = 0): boolean {
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
 * Is the text immediately before `colon` one of the five {@link SPECIAL_SCHEMES}?
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
 *
 * NO TAB, CR OR LF IS SKIPPED, which is the second way this differs from
 * {@link leadsWithHierarchicalScheme} and is a consequence of the first. That
 * question reads a reference the parser has not touched yet; this one reads a
 * text a parse already produced, where those three characters are gone. The one
 * caller that hands raw text to {@link userinfoSpans} is the needle pass in
 * `./redact-url`, and a scheme broken by a tab is a mark it does not open on.
 * The cost is a needle, never an emitted url, and it is under-redaction of a
 * message rather than of `url`.
 */
function isSpecialScheme(text: string, colon: number): boolean {
  for (const scheme of SPECIAL_SCHEMES) {
    const start = colon - scheme.length;
    if (start < 0 || !spellsToken(text, start, scheme)) continue;
    return !isSchemeCharacter(text[start - 1]);
  }
  return false;
}

/**
 * Does `text` spell `token` from `start`, ASCII case-insensitively?
 *
 * READ IN PLACE, and that is a cost fix rather than a taste. Every colon in a
 * text is asked {@link isSpecialScheme}, and the question used to cut five
 * substrings out and lower-case each of them — seventeen characters copied per
 * colon, whatever the first one said. Round 20 gave the colon a second reader:
 * {@link nextSchemeAuthority} seeks the bound of a region over the same colons
 * {@link nextAuthority} opens on, and doubling seventeen characters per colon
 * put `//@h.test:1` repeated over the linear bound `round20-h2-response.spec.ts`
 * states. Compared in place the walk stops at the first character that differs,
 * which for a path segment is the first one.
 *
 * `| 0x20` IS THE ASCII LOWER-CASING AND NOTHING WIDER. Every name in
 * {@link HIERARCHICAL_SCHEMES} is ASCII lower-case letters, and the only code
 * points that map onto one of those under `| 0x20` are that letter and its
 * upper case — which is exactly the URL Standard's ASCII case-insensitive
 * match for a scheme.
 */
function spellsToken(text: string, start: number, token: string): boolean {
  for (let at = 0; at < token.length; at += 1) {
    if ((text.charCodeAt(start + at) | 0x20) !== token.charCodeAt(at)) return false;
  }
  return true;
}

/**
 * Does this relative reference bring its OWN authority, for the parser to
 * CONSUME the mark that opens it?
 *
 * TWO SPELLINGS, and they are the two ways a resolution against a base whose
 * scheme is SPECIAL — `RELATIVE_BASE` in `./redact-url` — can eat a mark the
 * caller wrote:
 *
 *  - TWO SOLIDI. The reference is protocol-relative: the relative-slash state
 *    hands it to the authority state, so the parser takes its host from the
 *    reference and not from the base.
 *  - A HIERARCHICAL SCHEME at the head. The base is special, so a reference
 *    whose scheme EQUALS the base's goes to the special-relative-or-authority
 *    state and then to the relative state: the parser drops the scheme colon and
 *    reads the rest as a path against the base.
 *    `new URL("http:alice:pw@api.test:99999/v1", RELATIVE_BASE)` answers the
 *    path `/alice:pw@api.test:99999/v1` with the base's own host, and the mark
 *    that would have opened a region is gone. Asked of ALL SIX rather than of
 *    the base's own scheme: the other five reach this branch only when they
 *    already failed to parse absolutely, and they fail here for the same reason,
 *    so the answer never reaches a text — while a rule written around ONE scheme
 *    is a rule that a change of base silently invalidates. `file:` belongs in it
 *    for a reason of its own: the file state eats the colon too, and hands what
 *    follows to the path state. See {@link SPECIAL_SCHEMES} for the question
 *    where the same scheme must answer the other way.
 *
 * WHAT THE PARSER DISCARDS IS SKIPPED IN BOTH, and the two removals are
 * DIFFERENT STEPS of the URL Standard rather than one set of characters. The
 * basic URL parser first removes every LEADING and trailing C0 control or space
 * — U+0000 to U+001F plus U+0020 — and then removes every ASCII tab and newline
 * WHEREVER it sits. So the head of the input is skipped with {@link isStripped}
 * and the inside with {@link isIgnored}, and one leading space no longer moves
 * the scheme out from under this walk while leaving it exactly where the parser
 * reads it. An interior space is removed by neither step: it is a forbidden host
 * code point, and in a path it is percent-encoded.
 *
 * WHICH IS ALSO WHY THE SOLIDI ARE COUNTED HERE AND NOT BY {@link pastSolidi}.
 * That walk reads text a parse produced, where a tab between two solidi cannot
 * occur; this one reads the input the parser has not touched, where it can, and
 * `/`, tab, `/` is one mark to the parser.
 *
 * `\` counts as a solidus because the base is special.
 *
 * ASKED OF THE INPUT, and it is one of the two questions this module asks there.
 * It is a yes-or-no about the SHAPE of the parse, never a position in a text
 * that gets emitted — which is the whole of round 9's rule. What the answer
 * selects is `seamUserinfo` in `./redact-url`, and that span is the PARSER's,
 * taken from the path the parser itself produced.
 *
 * THE REBUILD LOOP ASKS IT TOO, of the path it is about to emit. That is the
 * same question rather than a second one: a path beginning with two solidi is a
 * protocol-relative reference to whoever reads the emitted value next, so
 * `redactUrl` resolves it again until it brings no authority of its own.
 *
 * @internal
 */
export function bringsOwnAuthority(text: string): boolean {
  let at = pastStripped(text);
  if (isSolidus(text[at])) {
    at += 1;
    while (isIgnored(text[at])) at += 1;
    return isSolidus(text[at]);
  }
  return leadsWithHierarchicalScheme(text, at);
}

/**
 * Where the authority reading from `from` ENDS: the first `/`, `\`, `?` or `#`,
 * or `limit`, which defaults to the end of the text.
 *
 * The bound the URL parser itself uses, and the one place this module states it.
 * Four questions rest on it, and each walked the four characters for itself
 * until this existed: where a consumed mark's userinfo can still sit
 * ({@link seamUserinfoEnd}), what text a parse is offered
 * ({@link parsesAsAuthority}), where a url's own authority stops
 * ({@link afterOwnAuthority}), and how far the userinfo of that authority can
 * reach ({@link ownUserinfo}).
 *
 * `limit` IS A COST BOUND AND NEVER A DIFFERENT ANSWER, and one caller needs it.
 * {@link userinfoSpans} asks whether this authority ends at or before the next
 * mark, which is a question about the text BETWEEN the two — so it stops the
 * walk one character past the mark instead of running to the end of a text the
 * mark already answered for. The unbounded walk is the same walk with the same
 * answer wherever the answer is below `limit`.
 *
 * `folds` IS THE ONE CHARACTER THE SCHEME DECIDES, and it defaults to the
 * module's own convention: every text read here that is not a raw url is read
 * as the authority a special-scheme parse would produce, which is the rule
 * {@link parsesAsAuthority} states. {@link afterOwnAuthority} is the one caller
 * that reads a url with a scheme of its own, and {@link endsAuthority} holds
 * what the difference cost.
 */
function authorityEnd(text: string, from: number, folds = true, limit = text.length): number {
  let at = from;
  while (at < limit && !endsAuthority(text[at], folds)) {
    at += 1;
  }
  return at;
}

/**
 * Does this character END an authority — `/`, `?`, `#`, and, where the scheme
 * FOLDS it, `\`?
 *
 * THE REVERSE SOLIDUS IS THE ONE A SCHEME DECIDES, and R20-ORCH-01 is what
 * reading it as a solidus everywhere cost. The URL Standard's authority state
 * terminates on U+005C only where the url is special: under `https:` the parser
 * ends the authority at a `\` exactly as at a `/`, and under `git:` — or any
 * scheme the special table does not name — the `\` stays an ordinary code
 * point, the `@` branch still fires, and
 * `new URL("git://svc:hun\\ter2@api.test/v1")` reports the username `svc` and
 * the password `hun%5Cter2`. That is the url's OWN userinfo, so the walk
 * bounding {@link ownUserinfo} has to reach the `@` behind the `\`. It stopped
 * in front of it, the caller's own spelling of the password was never a needle,
 * and the only needle left was the percent-encoded one no message quotes.
 *
 * See the authority state and the special scheme table:
 * https://url.spec.whatwg.org/#authority-state and
 * https://url.spec.whatwg.org/#special-scheme
 *
 * The other three characters end an authority under EVERY scheme, special or
 * not, so only this one takes an answer from the caller.
 */
function endsAuthority(character: string | undefined, folds: boolean): boolean {
  if (character === "\\") return folds;
  return character === "/" || character === "?" || character === "#";
}

/**
 * Where the caller's own spelling of the PATH ends: the first `?` or `#`, or
 * the end of the text.
 *
 * The path state hands everything from the first `?` to the query state and
 * everything from the first `#` to the fragment state, and it does so for a
 * reference exactly as for an absolute url. So this offset is where the text
 * `redactUrl` KEEPS stops and the two slots it drops whole begin, read in the
 * caller's spelling rather than in the parser's.
 *
 * `@internal`, and exported for one caller: `userinfosOf` in `./redact-url`
 * scans the caller's own text for needles, and a needle from a dropped slot is
 * a rewrite the url pass never makes. See its own comment for what that cost.
 * The grammar question stays here, where every other one is.
 *
 * @internal
 */
export function pathEnd(text: string): number {
  const query = text.indexOf("?");
  const fragment = text.indexOf("#");
  if (query < 0) return fragment < 0 ? text.length : fragment;
  return fragment < 0 || query < fragment ? query : fragment;
}

/**
 * Where this url's OWN authority ends: the offset at which a raw scan of it may
 * start.
 *
 * An embedded url can only hide past the outer authority, and the outer
 * authority is the one thing a raw scan must not read — `host:8443` is a port,
 * not a credential. Cutting at the first delimiter the URL grammar allows gives
 * the scan the region where an embedded credential lives, in the spelling a
 * message actually quotes.
 *
 * Anchored on the SCHEME, never on the first `://`. `https:/api.test/x`,
 * `https:api.test/x`, and `https:\\api.test/x` all name the host `api.test`,
 * and in each of them the first `://` belongs to an EMBEDDED url — so a cut
 * made there starts after the credential this scan exists to find. The scheme's
 * colon is the first colon a url that parsed can have, the solidi after it are
 * optional, and the authority runs to the first `/`, `\`, `?`, or `#`.
 *
 * AN OFFSET, NOT THE TEXT. Nothing in this module emits text, and the caller
 * that slices is the caller that emits.
 *
 * The three characters the parser removes before parsing — ASCII tab, CR, and
 * LF — are skipped with the solidi, so a mark broken by one is still a mark.
 * This is one of the two questions here that reads a RAW input;
 * {@link bringsOwnAuthority} is the other, and neither can use
 * {@link pastSolidi}, which reads text a parse produced.
 *
 * @internal
 */
export function afterOwnAuthority(url: string): number {
  return authorityEnd(url, ownAuthorityStart(url), foldsReverseSolidus(url));
}

/**
 * Does the parser read a `\` inside THIS url's own authority as a solidus?
 *
 * ASKED OF THE SIX, and the two scheme lists have to disagree here exactly as
 * they disagree everywhere else. {@link SPECIAL_SCHEMES} answers about a colon
 * found INSIDE a text and leaves `file:` out, because a `file:` colon under
 * fewer than two solidi opens no authority. This question is about the FOLD,
 * and `file:` is one of the URL Standard's special schemes: the file and file
 * host states read `\` exactly as `/`, so `file://api.test\svc:pw@h/x` carries
 * the path `/svc:pw@h/x` and the `\` the caller wrote is where the authority
 * stopped. Reading the five here would answer `false` for it,
 * `spilledAuthority` in `./redact-url` would stop seeing that spill, and the
 * credential would stay in the emitted url. {@link HIERARCHICAL_SCHEMES} is the
 * six, and {@link leadsWithHierarchicalScheme} is the whole question.
 *
 * ASKED OF A RAW INPUT, so both of the parser's own removals are skipped: the
 * leading run with {@link pastStripped}, and the tab, CR and LF inside the
 * scheme token with the walk {@link leadsWithHierarchicalScheme} already makes.
 * A reader that misses either one calls ` https:` or `htt<TAB>ps:` non-special,
 * and a non-special answer under a special scheme keeps a password.
 */
function foldsReverseSolidus(url: string): boolean {
  return leadsWithHierarchicalScheme(url, pastStripped(url));
}

/**
 * Where this url's OWN authority begins: past the scheme's colon and past every
 * solidus and every character the parser removes behind it.
 *
 * TOTAL, with no guard for a missing colon: this only ever reads a url that
 * PARSED, and a url that parsed has a scheme. `indexOf` answering -1 would
 * start the walk at index 0, which is the same answer as an empty scheme.
 *
 * Written once because {@link afterOwnAuthority} and {@link ownUserinfo} are
 * the two ends of ONE region, and the two walks to its start had to agree.
 */
function ownAuthorityStart(url: string): number {
  let at = url.indexOf(":") + 1;
  while (isSolidus(url[at]) || isIgnored(url[at])) at += 1;
  return at;
}

/**
 * The userinfo THIS url's own authority spells, in the CALLER's spelling, or
 * `null` where it spells none.
 *
 * A NARROW QUESTION, ASKED WHERE THE PARSER HAS ALREADY COMMITTED. Every other
 * span in this module is found by a REGION rule, which has to decide for itself
 * whether some colon or some pair of solidi inside a text opens an authority at
 * all. Here nothing is in doubt: the text starts with this url's scheme, the
 * parse succeeded, and {@link ownAuthorityStart} is where the parser began
 * reading the authority. So the answer is the URL Standard's own split — the
 * LAST `@` before the authority ends — and no region rule is consulted.
 *
 * WHICH IS THE WHOLE REASON IT EXISTS. `userinfosOf` in `./redact-url` used to
 * ask {@link userinfoSpans} of this same text, and a region opens at a scheme
 * colon under fewer than two solidi only where {@link isSpecialScheme} accepts
 * the token. That question answers `false` for `file:` — correctly, because a
 * `file:` colon under fewer than two solidi opens no authority: the file state
 * reads a path with an EMPTY host instead, which is what
 * {@link SPECIAL_SCHEMES} leaves it out for. `file:` is not a scheme without an
 * authority state; the `///` and the `\` spellings DO reach the file host
 * state, and reach it with that same empty host. And that question does not
 * skip the tab, CR and LF the parser removes before it reads anything. Both
 * answers are right for a colon found INSIDE a path and wrong for the url's own
 * scheme colon, so `file:/svc:pw@api.test/v1` and
 * `htt<TAB>ps:/svc:pw@api.test/v1` opened no region, the caller's own spelling
 * of the password was never a needle, and it rode out through every channel.
 * R20-H3-01 and R20-H3-02. The head question and the embedded-authority
 * question are different questions, and this is the head one.
 *
 * WHAT `file:` STILL COSTS THIS QUESTION is one character, and round 21's H3
 * lane is what states it. `file:` is one of the URL Standard's SPECIAL schemes,
 * so {@link foldsReverseSolidus} answers `true` for it and
 * {@link authorityEnd} folds a `\` the caller wrote inside the password into a
 * solidus. The bound the backward search below starts from then lands INSIDE
 * that password, the `@` behind it is never read, and
 * `file:///svc:hun\ter2@api.test/v1` answers `null` here. `SECURITY.md` carries
 * that scope on its qualified password claim.
 *
 * THE PORT IS SAFE FOR THE REASON THE PARSER MAKES IT SAFE: an authority's
 * userinfo ends at its LAST `@`, so `https://api.test:8443/v1` holds no `@`
 * before {@link authorityEnd} and answers `null`, and
 * `https://svc:pw@api.test:8443/v1` stops in front of the host.
 *
 * AN `@` AT THE START NAMES NOTHING, which is {@link seamUserinfoEnd}'s rule
 * read at the other end of the url: there is no text in front of it to be a
 * userinfo. The other empty spelling — `:@` — is a span of two delimiters, and
 * the caller refuses it: see `hiddenUserinfos` in `./redact-url`.
 *
 * @internal
 */
export function ownUserinfo(url: string): Span | null {
  const start = ownAuthorityStart(url);
  // Bounded by {@link afterOwnAuthority}, so the backward walk costs the
  // authority and never the url — the floor round 18 put under the same search
  // in {@link readsAsHostAndPort}. IT IS THE SAME BOUND THAT FUNCTION ANSWERS,
  // asked here rather than spelled again: the two are the ends of ONE region,
  // for the reason {@link ownAuthorityStart} is written once, and a `\` that
  // ends the authority for one of them has to end it for the other.
  const at = url.lastIndexOf("@", afterOwnAuthority(url) - 1);
  return at <= start ? null : { start, end: at + 1 };
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
 * See {@link userinfoSpans}.
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
 * how much this rule has to be right. `cleaned` in `./redact-url` re-asks every
 * question of the text its own rebuild produced, so a dot spelling missed here
 * is found on the next pass — it costs one pass and never a credential. What
 * this buys is the pass COUNT: without it a path spelling one credential and one
 * dot segment per group drains one group per pass, and `redactUrl` becomes
 * quadratic in a value a redirecting server chooses. Measured: 16 KB of them
 * took 465 ms in one error construction, against 0.9 ms with this.
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
 * {@link seamSpan} is the one caller that qualifies: its span starts at the
 * first character after the path's leading solidi, so the segment list in front
 * of it is empty or holds only the empty segments those solidi spell, and a pop
 * there can take a solidus and never a name. An ordinary region starts wherever
 * a mark sits in the path, with arbitrary text in front of it.
 *
 * AND AN ORDINARY REGION CROSSES ONE ANYWAY, WITHOUT PASSING IT. That is round
 * 16's separation and it is not a widening of the rule above: {@link pastOnePop}
 * moves the cursor over a `..` and {@link userinfoSpans} CLOSES the span in front
 * of it, so the `..` is still emitted and the rebuild still performs it. What the
 * crossing buys is the pass COUNT — see {@link popsBefore} for the input, and for
 * why the crossings are counted rather than allowed.
 *
 * A SEGMENT ENDS AT A SOLIDUS OR AT THE END OF THE TEXT, which is why the walk
 * below is not {@link authorityEnd}. A `pathname` holds no literal `?` or `#` —
 * the path percent-encode set covers both — so for the seam's call that is the
 * whole story. The ordinary region's text can run past `pathname` into the
 * query, in the one state {@link endsInsideAuthority} names, and there a `?`
 * reads as an ordinary character: the segment holding it matches no dot
 * spelling, so the cursor stops in front of it. Stopping early is the direction
 * that costs a pass and never an answer.
 */
function pastFiller(text: string, from: number, dropped: ReadonlySet<string>): number {
  let at = from;
  for (;;) {
    at = pastSolidi(text, at);
    let segment = at;
    while (segment < text.length && !isSolidus(text[segment])) segment += 1;
    if (!dropped.has(text.slice(at, segment).toLowerCase())) return at;
    at = segment;
  }
}

/** The {@link DOT_SEGMENTS} spellings that POP: the ones a single dot is not. */
const DOUBLE_DOT_SEGMENTS = new Set(
  [...DOT_SEGMENTS].filter((segment) => !SINGLE_DOT_SEGMENTS.has(segment)),
);

/**
 * `from`, advanced over ONE double-dot segment and the filler behind it, or
 * `from` where the segment there is not a double dot.
 *
 * ONE, because each one costs a POP, and the caller has a budget of them. See
 * {@link popsBefore}.
 */
function pastOnePop(text: string, from: number): number {
  let segment = from;
  while (segment < text.length && !isSolidus(text[segment])) segment += 1;
  if (!DOUBLE_DOT_SEGMENTS.has(text.slice(from, segment).toLowerCase())) return from;
  return pastFiller(text, segment, SINGLE_DOT_SEGMENTS);
}

/**
 * How many pops the text in front of a region opening at `start` can PAY FOR
 * without moving the region's own opening.
 *
 * THE COST FIX AND THE ANSWER ARE ONE QUESTION HERE, which is why this counts
 * rather than answering yes or no. `pastFiller` stops the ordinary cursor in
 * front of a `..` so that a span never swallows one, and the price round 16
 * measured is that a path spelling one credential and one `..` per group drains
 * ONE group a pass: the removal exposes the `..`, the rebuild pops the empty
 * segment a solidus spells, and the next group's region opens only on the pass
 * after that. `/x` + 2N solidi + N `@../` groups cost N + 1 passes over a text
 * that stays Θ(N) long, and `response.url` after a redirect is a text the
 * SERVER wrote.
 *
 * The cursor may CROSS such a `..` — leaving it in the emitted text, so the
 * rebuild still performs it and round 15's rule is untouched — exactly as often
 * as the slow spelling would have re-opened the region, and no more often, or
 * the answer moves. Each pop eats one segment in front of the region, and a run
 * of `run` solidi spells `run - 1` empty ones before the segment that wrote it.
 * So the question is only ever: how many of those segments can go before the
 * region stops opening where it opened?
 *
 * TWO FLOORS, AND THEY ARE {@link authorityAt}'s OWN TWO. A region needs two
 * solidi to open, EXCEPT behind a special scheme's colon, which opens one over
 * any count including none. So:
 *
 *  - A bare run, or one behind a colon the grammar does not read as a special
 *    scheme, re-opens while it still holds two solidi: `run - 2` crossings.
 *  - A run behind a SPECIAL scheme's colon re-opens at any length, so what ends
 *    the re-opening is the pop that takes the scheme's own segment. That pop is
 *    the one made when the run is down to a single solidus, so the segments
 *    before it pay for `run - 1` crossings, and `/x/https:/@../@../v1` — a run
 *    of one — still pays for none.
 *
 * THE COLON WAS READ AS A CHARACTER, AND THAT IS ROUND 17'S FINDING. The
 * previous form answered ZERO for every run behind a `:`, on the argument that
 * the pop which shortens such a run does not close the region. The argument is
 * true and it is a reason for a LARGER budget, not for none: the spelling every
 * slash-collapsing proxy writes — `/x/https:` and 2N solidi and N `@../` groups
 * — drained one group per whole-string pass, 2,401 rebuilds for a 14.4 KB
 * `Location` the SERVER chose, and `toJSON()` paid the count again per log line.
 * Reading the grammar instead of the character also gives the two spellings the
 * character hid — a colon under an unknown scheme and the empty scheme a
 * template leaves — the `run - 2` they always had: neither opens a region under
 * fewer than two solidi, so neither was ever the case the argument described.
 */
function popsBefore(text: string, start: number): number {
  const before = beforeSolidi(text, start);
  const run = start - before - 1;
  const floor = text[before] === ":" && isSpecialScheme(text, before) ? 1 : 2;
  return run > floor ? run - floor : 0;
}

/**
 * Where the userinfo of the authority at `from` ends, or `-1` when it holds
 * none. One answer of {@link seamSpan}'s loop.
 */
function seamUserinfoEnd(path: string, from: number): number {
  const term = authorityEnd(path, from);
  // The last `@` before the authority ends is where the parser splits userinfo
  // from host, so it is where the span ends. Asked of the TEXT rather than of
  // the parsed values, which percent-encoding rewrites and which report an
  // empty userinfo and an absent one with the same two empty strings.
  //
  // An `@` AT `from` has no text in front of it, so it names no userinfo and
  // there is nothing to remove: `file:///@api.test/v1` keeps its mark.
  const at = path.lastIndexOf("@", term - 1);
  if (at > from) return at;
  // THE LAST `@` IN THE PATH, and it is asked at most once per seam: the answer
  // moves the loop's cursor past every `@` there is, so the call after it finds
  // none in front of `from` and the seam closes. Over-redaction is the safe
  // direction, and where the authority's own end is a solidus the caller never
  // wrote there is no narrower end to read.
  const folded = spellsCredentialHead(path, from, term) ? path.lastIndexOf("@") : -1;
  return folded > from ? folded : -1;
}

/**
 * Does the first segment at `from` spell the HEAD of a credential — a colon
 * that no Windows drive letter wrote — so that the solidus ending it can be one
 * the parser FOLDED out of the caller's `\`?
 *
 * A FALLBACK AND NEVER A WIDENING, and the difference is the whole of round
 * 20's R20-H3-03. {@link seamUserinfoEnd} reads to {@link authorityEnd}, and
 * that bound is right whenever the authority holds an `@` — `/svc:pw@api.test`
 * ends its userinfo where the parser ends it, and `/svc:pw@api.test/users/@alice`
 * must keep the handle at the segment head that round 17 fought for. This is
 * asked ONLY where that reading found no `@` at all, which is the one state in
 * which the bound can be a solidus the caller never wrote: `file:` is a special
 * scheme, so `\` inside `file:///svc:hun\ter2@api.test/v1` is a `/` by the time
 * `pathname` exists, the authority "ends" in the middle of the password, and
 * the whole credential was emitted as path — into `toJSON().url`, the record.
 *
 * THE DRIVE LETTER IS THE URL STANDARD'S OWN CARVE-OUT, not a heuristic about
 * this text. A Windows drive letter is an ASCII alpha and a `:`, and the file
 * path start state gives it a case of its own — so `file:///c:/Users/alice@corp/x`
 * spells a colon that no credential wrote, and `seamSpan`'s own comment records
 * that reading it as one takes the head off a Windows path. A segment that is
 * not two characters long is not one, whatever else it spells: `svc:hun` is the
 * head of `svc:hun/ter2@api.test`, and `Users` holds no colon at all, so
 * `file:///Users/alice@corp/report.pdf` is never asked.
 *
 * `pathname` holds the NORMALIZED drive letter, so `:` is the only second
 * character to test: the parser rewrites `c|` to `c:` before this text exists.
 *
 * WHAT IT COSTS is over-redaction, and it is the direction this module takes
 * everywhere: a `file:` path whose FIRST segment holds a colon that is not a
 * drive letter and whose later text holds an `@` loses everything up to that
 * `@`. `file:///a:b/c/mail@example.com/x` is that shape.
 */
function spellsCredentialHead(path: string, from: number, term: number): boolean {
  if (term === from + 2 && SCHEME_HEAD.test(path[from]!) && path[from + 1] === ":") return false;
  // SOUGHT FORWARD, inside the segment and no further. A backward `lastIndexOf`
  // reads to index 0 whenever the segment holds no colon, and this is asked once
  // per answer of a loop — the shape round 18 measured and `userinfoSpans` puts
  // a floor under everywhere else.
  for (let at = from; at < term; at += 1) if (path[at] === ":") return true;
  return false;
}

/**
 * The span at the head of `path` that a url's ORIGIN and PATH spell between
 * them, or `null`.
 *
 * WHO ASKS, AND WHEN, IS THE CALLER'S QUESTION. `seamUserinfo` in
 * `./redact-url` reads the `URL` and decides whether this url has a seam at
 * all; this function is handed the path alone and answers what the span IS.
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
 * text inside it. {@link authorityEnd} is that bound, so
 * `file:///c:/Users/alice@corp/x` has no `@` before its end at all and the
 * question is never even asked.
 *
 * AND IT IS ASKED AGAIN OF WHAT ITS OWN ANSWER LEAVES BEHIND, for the reason
 * {@link userinfoSpans} asks its two questions again: this span is removed from
 * a text that is REJOINED to the origin's solidi, so what follows the span
 * becomes the new seam. `file://\hunter2-:@/file..@` emits `file:` plus
 * `///hunter2-:@/file..@`; removing the first authority leaves
 * `file:////file..@`, whose `//file..@` is a consumed mark all over again, and
 * a second call removed what the first had not. The loop ends because each
 * answer consumes an `@` and the cursor only moves forward.
 *
 * @internal
 */
export function seamSpan(path: string): Span | null {
  const start = pastSolidi(path, 0);
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
 * The parser cannot be written. It reads to {@link authorityEnd} — the first
 * `/`, `\`, `?`, or `#` — and then either finds a host there or fails. When it
 * finds one, the authority is COMPLETE: the parser itself said where it ends, so
 * a later `://` starts a url of its own and bounds the region. When it fails,
 * there is no authority for a mark to be the end of, and the region has no end:
 * every `@` after it is a candidate. `alice:s3cret://x@internal.test/v1` fails,
 * because `s3cret` is not a port — so the `@` the `://` used to hide behind is
 * asked, and the whole credential goes.
 *
 * UNDER A SPECIAL SCHEME, whatever scheme the region's own mark spelled. The
 * question this module asks is always "is this the authority a special-scheme
 * parse would produce", and a non-special scheme that answers `false` where its
 * own grammar would answer `true` only ever WIDENS the region. Over-redaction
 * is this module's safe direction.
 *
 * THE RETURNED VALUE IS THE READ, and the read is what makes this a parse rather
 * than a discarded `new`. The answer is the HOST: a special scheme with no host
 * is a parse failure on every runtime, and reading `host` says so without
 * depending on that. A throw is the other way of saying the same thing, so it
 * answers `false` by the same rule. `URL.canParse` would report only half of it,
 * and it is not on every runtime this `try`/`catch` already supports.
 */
function parsesAsAuthority(text: string, start: number): boolean {
  try {
    return new URL(`https://${text.slice(start, authorityEnd(text, start))}/`).host !== "";
  } catch {
    return false;
  }
}

/**
 * Did a SCHEME write the mark the region opening at `region` hangs off?
 *
 * Condition 1 of {@link readsAsHostAndPort}, and a fact about the region's
 * OPENING rather than about any cursor inside it — which is why it is asked
 * here, once, and carried to every question the cursor goes on to ask. Round
 * 16's crossing is the reason it cannot be re-read later: it advances the
 * cursor over a `..` WITHOUT moving the text, so a backward read taken from the
 * cursor lands on the `.` of a double dot the rebuild has not performed yet and
 * finds no mark at all. `/go/https://@../cdn.test:8443/users/@alice` is that
 * input — round 17's own pinned url with an empty userinfo and a dot segment in
 * front of it — and the answer named the handle `alice` as the host of the
 * forward, which is the exact harm round 17 fixed. The crossing is a COST fix
 * and may not move an answer; anchoring the question here is what keeps that
 * true.
 *
 * A SCHEME BEGINS WITH ALPHA, and one character in front of the colon is not
 * that question. The condition's sentence names the empty scheme a template
 * leaves as a case where no scheme wrote a port, and `isSchemeCharacter` alone
 * admitted `9:`, `.:`, `-:` and `9x:` — tokens no URL parser reads as a scheme
 * anywhere — while refusing the `://` the sentence names. So the token is read
 * whole: the run of scheme characters in front of the colon spells a scheme
 * when it is not empty and its first character is {@link SCHEME_HEAD}.
 *
 * A MARK THAT IS NOT A COLON ANSWERS NO HERE, and {@link grammarWroteTheMark}
 * is where round 19 answered it the other way for the one question that reads
 * it. This function keeps the NARROW question — did a scheme write the mark —
 * because one caller still needs exactly that. See both.
 *
 * THE WALK IS BOUNDED BY DISJOINTNESS, not by a length. A token stops at the
 * first character that cannot spell a scheme, and a colon is one of those, so
 * no two marks in one text walk the same characters. That is the argument
 * {@link beforeSolidi} makes for its solidus runs, and it holds here only
 * because the question is asked at the opening rather than once per candidate
 * `@`.
 */
function schemeWroteTheMark(text: string, region: number): boolean {
  const mark = beforeSolidi(text, region);
  if (text[mark] !== ":") return false;
  let at = mark - 1;
  while (isSchemeCharacter(text[at])) at -= 1;
  return at < mark - 1 && SCHEME_HEAD.test(text[at + 1]!);
}

/**
 * Did the GRAMMAR write the mark the region opening at `region` hangs off — a
 * scheme's colon, OR the bare pair of solidi that is protocol-relative?
 *
 * The WIDE reading of {@link schemeWroteTheMark}'s question, and round 19 is
 * why the two are separate. Two or more solidi with no scheme slot in front of
 * them are the URL Standard's own protocol-relative authority —
 * `new URL("//cdn.test:8443/x", base)` answers the host `cdn.test:8443` — so
 * the bare-`//` region is separable from the empty scheme a template leaves by
 * the MARK, and not only by the LABEL the deny list this module's header
 * rejects. R18-H3-02 recorded that and left it, because landing it moves pinned
 * answers.
 *
 * WHAT MADE IT A FIX is a url no earlier round drew: one whose leading solidi
 * are POPPED. `/go/https:/@..//cdn.test:8443/users/@alice` — the spelling every
 * slash-collapsing proxy and every `path.join` produces — reaches the rebuild
 * as `/go//cdn.test:8443/users/@alice`, because the `..` the removed credential
 * exposes takes the scheme's OWN segment when the run is a single solidus. The
 * two-solidus spelling pops an empty segment instead and keeps `https:`. So the
 * bare-`//` reading is not a separate class at all: it is the class every
 * special-scheme url falls into once its run is short enough, and the narrow
 * question answered one url two ways — `cdn.test:8443` kept under `https://`
 * and the handle `alice` named as the host under `https:/`. 1,440 of 6,912
 * one-url families split on the solidus count, and none do now.
 *
 * ASKED FOR THE COLON RULE ALONE, and that bound is a cost measurement rather
 * than a doubt about the reading. {@link userinfoEnd}'s empty-userinfo guard
 * reads {@link schemeWroteTheMark} still. Widening the guard too moves no
 * answer — `/x/@a//@a//…/@b` emits the same text either way — and costs a PASS
 * per unit: the guard declines the region, and rule 1 of
 * {@link looksLikeUserinfo} then removes the same `@` on the next whole-string
 * rebuild because it has become the text's last one. 1,000 units took 1,001
 * rebuilds and 499,500 parses against 2 and 0, on a path a redirect chooses.
 * `round19-h2-response.spec.ts` reads both counts.
 *
 * TWO WALKS OVER ONE RUN, and the disjointness {@link beforeSolidi} argues for
 * is what pays for it: the runs two regions hang off are disjoint, so walking
 * one of them twice is twice a bound rather than a new one.
 */
function grammarWroteTheMark(text: string, region: number): boolean {
  return text[beforeSolidi(text, region)] !== ":" || schemeWroteTheMark(text, region);
}

/**
 * Does the text from `start` read as an AUTHORITY the parser can name — a
 * colon that belongs to `host:port`, rather than to `user:password`?
 *
 * The one question {@link looksLikeUserinfo}'s colon rule cannot answer for
 * itself, and round 17's finding is what it costs to leave it unasked.
 * `https://api.test/go/https://cdn.test:8443/users/@alice` is a forward to a
 * host on a non-default port; the port supplies a colon before the region's
 * first solidus, so the colon rule fired before the `@`-at-a-segment-head rule
 * was consulted, and the record named the handle `alice` as the host while
 * `cdn.test:8443` — the authority the url did name — went. The url is well
 * formed at every level, so the cost is a record that LIES, and the ambiguity
 * the colon rule is built on is not there to be paid: the parser reads the
 * authority, so the colon is its.
 *
 * THREE CONDITIONS, AND NOT ONE OF THEM IS SPARE.
 *
 *  - THE MARK WAS WRITTEN, and the CALLER says which reading of that it needs.
 *    {@link parsesAsAuthority} asks what a special-scheme parse would read, and
 *    the module's rule for that answer is that a `false` only ever WIDENS a
 *    region — over-redaction, the safe direction. Using its `true` to NARROW
 *    one is the other direction, and it is sound only where the text invoked a
 *    parse at all: behind `https://`, `https:/`, `git://` or a bare `//`,
 *    `cdn.test:8443` is an authority the grammar reads. Behind the empty scheme
 *    a template leaves (`://a:1234/x/@bob`), or a token no parser reads as a
 *    scheme (`9://a:1234/x/@bob`), nothing wrote a port and the reading is the
 *    module's own assumption. `redact-url.spec.ts` pins that shape's
 *    over-redaction as a residual in those words — it cannot be resolved "once
 *    a malformed scheme has taken away where the authority ends" — and this
 *    condition is what leaves that pin exactly where it is.
 *    {@link grammarWroteTheMark} and {@link schemeWroteTheMark} are the two
 *    readings, both answered of the REGION, and the parameter is that answer
 *    rather than a position because the cursor cannot re-derive it.
 *  - THE AUTHORITY'S COLON IS NOT A PASSWORD'S. `svc:PW@i.test` parses, and
 *    its colon delimits a credential — so an `@` inside the authority refuses
 *    this. It refuses only a colon that DELIMITS something: one with text on
 *    BOTH sides of it, in front of the authority's last `@`. `:@` has none and
 *    `u@cdn.test:8443` keeps its colon on the far side of the `@` entirely, and
 *    reading every `@` as a refusal is what let one erased character choose the
 *    answer — `https://:@cdn.test/users/@alice` IS `https://cdn.test/users/@alice`
 *    to the platform, and the module answered the two differently. Read of the
 *    TEXT rather than of the parse's report, for the reason {@link seamSpan}
 *    states: an empty userinfo normalises away, and a report of two empty
 *    strings does not tell an absent userinfo from a consumed one.
 *
 *    A USERINFO HAS TWO EMPTY SPELLINGS AND BOTH ARE ERASED, which is why the
 *    colon must delimit a NON-EMPTY password. Round 18 asked only about `:@`.
 *    The other spelling is an empty PASSWORD: the URL serializer appends the
 *    colon only under a non-empty-password guard, so `u:@` and `u@` produce one
 *    URL record and one href on every runtime, and
 *    `https://api.test/go/https://u:@cdn.test:8443/users/@alice` IS
 *    `https://api.test/go/https://u@cdn.test:8443/users/@alice`. Reading that
 *    colon as a delimiter refused the suppression, the colon rule fired, and
 *    the span ran to the handle at a segment head: `cdn.test:8443` — the
 *    authority the url named — went, and `alice`, a user's handle, was what the
 *    forward named. R20-H2-02, and `https://APIKEY:@host/` is how a client
 *    writes an API key into basic auth with no password. So the colon is a
 *    delimiter at `colon < at - 1` and not at `colon < at`.
 *  - THE AUTHORITY READS, from AFTER the userinfo the parser would consume. A
 *    port the parser refuses (`://a:99999/x/@bob`) is not a port, and the
 *    region is back to the ambiguity residual 1 records.
 *
 * A DOT SEGMENT IS NOT A HOST, whatever a parse of it alone answers.
 * `new URL("https://../")` reports the host `..`, and the path state deletes
 * that same text before any reader of the emitted url sees it — so a region
 * whose host is one is not an authority anybody wrote. It is the crossing's own
 * input that reaches this: `/go/https://@../cdn.test:8443/users/@alice` opens
 * its region at the `@`, and reading `@..` as an authority with an empty
 * userinfo would keep the `@`, leave the `..` unexposed, and stop the rebuild
 * from ever reaching the authority the url does name. {@link pastFiller} states
 * the same fact for a cursor: what the next parse drops is not text this module
 * may read as structure.
 *
 * BOTH SEARCHES ARE CLIPPED TO THE AUTHORITY, and that is round 18's cost
 * finding rather than a tidying. The `@` search was
 * `text.lastIndexOf("@", authorityEnd(text, start) - 1)`, a backward scan with
 * no floor: where nothing in front of the region holds an `@` it reads back to
 * index 0. A `Location` of `/x` plus `/ws:a:1` repeated plus `/@b` opens one
 * region per unit, every one of them reaches the colon rule, and no `://`
 * anywhere leaves every region unbounded — so one `redactUrl` of 14,021
 * characters walked 14,011,000 of them backwards and emitted its own input.
 * {@link userinfoSpans} names that exact shape as the reason it indexes every
 * `@` in one forward pass. The slice is the authority {@link authorityEnd}
 * already measured, so both reads now cost what that walk costs and no more.
 *
 * WHAT IT CAN COST is a span whose every `@` follows a solidus, since
 * {@link userinfoEnd} asks the last `@` first and then the last `@` no solidus
 * precedes. That is the under-redaction residual {@link looksLikeUserinfo}
 * records as open — a credential whose last character is `/` — and over the
 * 97,344 urls of round 17's structured and credential populations it costs no
 * planted credential at all.
 *
 * The cheap questions are asked first: the mark is a boolean the region already
 * settled, the two searches read the authority, and only what survives all
 * three is handed a parse.
 */
function readsAsHostAndPort(text: string, marked: boolean, start: number): boolean {
  if (!marked) return false;
  const authority = text.slice(start, authorityEnd(text, start));
  const at = authority.lastIndexOf("@");
  const colon = authority.indexOf(":");
  if (at >= 0 && colon > 0 && colon < at - 1) return false;
  if (DOT_SEGMENTS.has(authority.slice(at + 1).toLowerCase())) return false;
  return parsesAsAuthority(text, at < 0 ? start : start + at + 1);
}

/**
 * `span`, read as the userinfos the URL GRAMMAR could read inside it: every
 * `@` it holds, back to the segment that `@` ends.
 *
 * A SPAN CAN HOLD A HOST, and that is the whole of why one caller needs this. A
 * region opens at a mark, and {@link looksLikeUserinfo} may reach an `@` in a
 * segment past the authority's end — RES-6 — so the span then covers a host,
 * the path behind it, and the `@`. In the url that is one documented residual,
 * because `redactUrl` removes the same text from what it emits. In a MESSAGE,
 * for a slot the emitted url drops whole, it is a rewrite nothing balances:
 * removing `cdn.test/u/alice@` from a message leaves the `https://` in front of
 * it joined to `example.com`, and the record names a host the request never
 * contacted. `hiddenUserinfos` in `./redact-url` is the one caller, and its own
 * comment holds the input and what this costs.
 *
 * A SOLIDUS ENDS THE AUTHORITY A USERINFO LIVES IN, so a userinfo any parse can
 * read is exactly one segment: this answers the span itself wherever the span
 * is one, which is every ordinary `svc:hunter2@`. Where it is not, it answers
 * the segments that END at an `@` and never the ones that end at a solidus —
 * the second kind is a host, and a host is what may not go.
 *
 * EVERY `@`, not the last: one region can cover several credentials, and a
 * fragment holding `svc:pw@h.test\\@bob/svc:pw@` is one span with three. Taking
 * the last segment alone left the first credential in the message, measured at
 * 50 rows of round 17's credential population.
 *
 * @internal
 */
export function segmentUserinfos(text: string, span: Span): Span[] {
  const found: Span[] = [];
  let start = span.start;
  for (let at = span.start; at < span.end; at += 1) {
    if (isSolidus(text[at])) start = at + 1;
    else if (text[at] === "@") {
      found.push({ start, end: at + 1 });
      start = at + 1;
    }
  }
  return found;
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
 * That is the ONLY state in which {@link pathUserinfoSpans} looks past
 * `pathname`, and it is why `/proxy/https://cdn.test/img?owner=alice@example.com`
 * does not: the embedded url reached `/img`, so its authority is complete, the
 * `?` starts its query, and the `@` in that query is an e-mail address rather
 * than a terminator.
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
 * every one. See {@link pastSolidi}.
 *
 * ONE FORWARD WALK. The colon half used `indexOf` per mark, and a pair of
 * solidi is not a character `indexOf` can find, so both halves are read in the
 * one pass that has to happen anyway. `from` only ever moves forward across the
 * calls {@link userinfoSpans} makes, so the whole scan stays linear.
 */
function nextAuthority(text: string, from: number): number | null {
  for (let at = from; at < text.length; at += 1) {
    if (text[at] === ":") {
      const start = authorityAt(text, at);
      if (start !== null) return start;
      continue;
    }
    if (!isSolidus(text[at]) || !isSolidus(text[at + 1])) continue;
    return pastSolidi(text, at);
  }
  return null;
}

/**
 * Where the next authority a SCHEME's COLON opens begins, at or after `from`.
 * `null` once no such mark is left.
 *
 * THE HALF OF {@link nextAuthority} THAT NAMES A NEW URL, and the two are kept
 * apart because they answer for different ends of a region. What OPENS a region
 * is the wider question: a bare pair of solidi is protocol-relative, so it opens
 * one. What ENDS a region is the narrower one, and round 20 measured the
 * difference. `/svc:hunter2@http:/@bob//tok@internal.testsvc:hunter2@..` spells
 * a bare pair inside a region that has to run past it — the region is the one
 * {@link pastFiller} names, where the trailing `..` pops the segment holding the
 * password — and ending it at the pair left `svc:hunter2@` in the emitted path.
 * Over-redaction is this module's safe direction, and a narrower END is the
 * other one.
 *
 * WHAT IT IS WIDE ENOUGH FOR is the whole of round 20's H2-01: `://` is one
 * SPELLING of a colon mark, and {@link authorityAt} opens the same mark over one
 * solidus, over none, and over a backslash. Reading the three literal characters
 * instead meant a path spelling `https:/@` per unit held no bound anywhere, every
 * region ran to the end of the text, and `cleaned` in `./redact-url` drained one
 * `@` per whole-string pass.
 *
 * A FORWARD WALK, over the colons alone: `from` only moves forward across the
 * calls {@link userinfoSpans} makes, and each call stops at the first colon that
 * opens something, so the whole seek stays linear in the text.
 */
function nextSchemeAuthority(text: string, from: number): number | null {
  for (let at = text.indexOf(":", from); at >= 0; at = text.indexOf(":", at + 1)) {
    const start = authorityAt(text, at);
    if (start !== null) return start;
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
  const start = pastSolidi(text, colon + 1);
  if (start > colon + 2) return start;
  return isSpecialScheme(text, colon) ? start : null;
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
 * marks all over again. See {@link userinfoSpans}.
 *
 * Three shapes are userinfo, and everything else is a path this module keeps:
 *
 *  - NO `/` at all. `://token@host/x` is the username-only credential a bearer
 *    URL carries, and there is nothing else it could be.
 *  - The `@` does NOT follow a `/`. A path spells an `@` at the head of a
 *    segment — `/users/@alice`, `/@scope/pkg` — while a credential runs right
 *    up to it. This is what catches a standard-base64 token, whose alphabet
 *    includes `/`: `YWxpY2U/cGFzc3dvcmQ@host` has a slash and no colon, so the
 *    other two rules read it as a path and the whole credential survived.
 *  - A `:` BEFORE the first `/`, WHERE THE REGION DOES NOT SPELL `host:port`.
 *    A credential is `user:password`, and the password is the part that can
 *    contain the delimiter that used to end the scan early — `svc:hun\ter2`,
 *    `svc:hun?ter2`. A PORT spells the same colon, and
 *    {@link readsAsHostAndPort} is the module's own question about which of the
 *    two this is.
 *
 * So `https://api.test/go/https://cdn.test/users/@alice` keeps every segment it
 * names, and round 17 found the same url with a PORT on the embedded host
 * losing them: the colon rule fired before the `@`-at-a-segment-head rule was
 * consulted, and the record named the handle `alice` as a host.
 *
 * THE THIRD RULE IS READ FIRST, and the order is what keeps the parse off the
 * ordinary path. The three rules are a disjunction, so their order cannot move
 * an answer; but the colon rule is the only one that parses, and it can only
 * decide a candidate the `@`-at-a-segment-head rule already reads as a path. So
 * that rule answers first and the parse is paid on nothing else.
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
 *  - An authority the colon rule cannot hand to {@link readsAsHostAndPort},
 *    followed by a path `@`. Three shapes reach it: a port the parser refuses
 *    (`://a:99999/x/@bob`), a region whose mark spells no scheme the grammar
 *    reads (`://a:1234/x/@bob`, the empty scheme a template leaves, and
 *    `9://a:1234/x/@bob`, a token no parser reads as one), and a region whose
 *    authority holds a colon
 *    that DELIMITS something in front of an `@` (`://svc:PW@i.test/users/@bob`).
 *    In each of them nothing separates `a:1234` from `user:password`, which is
 *    the sentence this residual has always carried. An `@` with no delimiting
 *    colon in front of it is NOT one of them any more — `:@` and `u@` are
 *    userinfo the parser reads and erases or reports, and neither leaves the
 *    port behind them ambiguous.
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
function looksLikeUserinfo(text: string, marked: boolean, start: number, end: number): boolean {
  if (end === start) return true;
  const slash = text.indexOf("/", start);
  if (slash < 0 || slash >= end) return true;
  if (text[end - 1] !== "/") return true;
  const colon = text.slice(start, slash).indexOf(":");
  return colon >= 0 && !readsAsHostAndPort(text, marked, start);
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
 * shape whose 855 ms {@link userinfoSpans} records. It is also unnecessary.
 * Only the THIRD rule of {@link looksLikeUserinfo} reads the candidate's own
 * end, and it reads exactly one character: whether a `/` precedes the `@`. So:
 *
 *  - When the last `@` answers yes, it is the union by itself.
 *  - When it answers no, the region has a `/` after `start` with no `:` before
 *    it, and every `@` a `/` precedes answers no for the same reason. What is
 *    left is the last `@` that NO `/` precedes — `lastLoneAt` — plus the `@` at
 *    `start` itself, which is the empty userinfo rule 1 admits.
 *
 * An `@` before the region's first `/` needs no case of its own: nothing but
 * `start` can put a `/` immediately before it, so it is already a lone `@`.
 *
 * AND A FALLBACK LOOKS FOR A CREDENTIAL THE LAST `@` HID, so where there is
 * none to find it may not answer. Both fallbacks reach the head of the region,
 * and the head of a region can be an EMPTY userinfo — `@`, or the `:@` the URL
 * Standard erases. Empty is exactly what the parser calls it:
 * `new URL("https://:@cdn.test/users/@alice").href` IS
 * `https://cdn.test/users/@alice`, so those two are ONE url and this module has
 * to answer them alike. It did not. The `:` of `:@` is also a colon the third
 * rule reads, so a region that spelled no colon at all suddenly spelled one,
 * {@link readsAsHostAndPort} refused it on the `@` of the same two characters,
 * and the span ran to a handle at a segment head — R17-H3-01 restored by a
 * character the platform throws away.
 *
 * SO THE FALLBACK STOPS WHERE THE PARSER HAS ALREADY NAMED THE USERINFO, and
 * nowhere else. The region has to read as an authority for that, which is the
 * one question {@link readsAsHostAndPort} answers; where it does not, an empty
 * userinfo goes exactly as it always did — `://@host/x` still yields a span of
 * one character, `redact-url.spec.ts` pins that row, and the crossing in
 * {@link userinfoSpans} needs it to. The PRIMARY answer is untouched either
 * way: an `@` that is the region's own last one is rule 1's, and rule 1 has
 * always read it as a credential.
 */
function userinfoEnd(
  text: string,
  scheme: boolean,
  marked: boolean,
  start: number,
  lastAt: number,
  lastLoneAt: number,
): number {
  if (lastAt < start) return -1;
  if (looksLikeUserinfo(text, marked, start, lastAt)) return lastAt;
  const fallback = lastLoneAt >= start ? lastLoneAt : text[start] === "@" ? start : -1;
  if (fallback < 0) return -1;
  const empty = fallback === start || (fallback === start + 1 && text[start] === ":");
  return empty && readsAsHostAndPort(text, scheme, start) ? -1 : fallback;
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
 * Every `[start, end)` span of userinfo in a string a URL parser did not treat
 * as one, in order.
 *
 * `://svc:hunter2@internal.test/v1` parses as neither absolute nor
 * protocol-relative, so it resolves against `RELATIVE_BASE` (in `./redact-url`)
 * as a PATH — and a path is the one slot the redactor keeps, so the credential
 * rides inside it. A template that produced an empty, spaced, or digit-led
 * scheme is the ordinary way to get here; the shape is malformed rather than
 * exotic.
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
 * A region STARTS where {@link nextAuthority} says the URL Standard opens one —
 * at a scheme colon that {@link authorityAt} accepts, or at a bare pair of
 * solidi — and it ENDS where {@link parsesAsAuthority} says
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
 * text it is handed, which for {@link pathUserinfoSpans} may run past `pathname`
 * into the query — see {@link endsInsideAuthority} for the one state in which it
 * does. What that widening buys is the `@` of a credential the outer `?` cut in
 * half. It never buys the right to EMIT the text after that `@`, which is why
 * the clip lives in `withoutMalformedUserinfo` (in `./redact-url`) rather than
 * in this scan.
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
 *
 * @internal
 */
export function userinfoSpans(text: string, seam: Span | null = null): Span[] {
  const spans: Span[] = [];
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
  // with, and the parser's answer stands by itself. See {@link seamSpan}.
  let from = 0;
  let floor = -1;
  if (seam !== null) {
    if (nextAuthority(text, 0) === seam.start) floor = seam.end;
    else {
      spans.push(seam);
      from = seam.end;
    }
  }
  // WHERE THE NEXT AUTHORITY BEGINS, read forward and never re-read. It bounds
  // a region only where the parser has already said the region's own authority
  // ENDS — see {@link parsesAsAuthority}.
  //
  // ASKED WITH THE MODULE'S OWN QUESTION FOR IT — {@link nextSchemeAuthority},
  // which holds why the bound is the colon half alone — and round 20's H2
  // finding is what reading three literal characters cost instead. `://` is one
  // spelling of a mark {@link authorityAt} opens over any solidus count, so a
  // path spelling `https:/@` per unit held no `://` anywhere: every region ran
  // to the end of the text, every region's only candidate was the LAST `@` of
  // the whole text, and each pass of `cleaned` in `./redact-url` removed one
  // `@`. An 8 KB `response.url` a redirecting server chose cost 621 ms in one
  // error construction and 614 ms again per `toJSON()`, while the SAME embedded
  // url spelled with two solidi and a thousand characters LONGER cost 3 ms and
  // 2 ms. One question for the opening and another for the bound is what let
  // the two spellings of one url disagree about the cost of reading it.
  //
  // `0` IS A SEED AND NEVER A BOUND: a bound is at or before no region's own
  // start, so the first region always re-seeks.
  let stop = 0;
  for (;;) {
    const start = nextAuthority(text, from);
    if (start === null) break;
    // THE MARK IS THE REGION'S, AND IT IS SETTLED HERE. Every other question
    // below reads forward from a cursor; this one reads BEHIND the region's
    // opening, and the crossing moves the cursor over text the rebuild has not
    // performed yet. Asked from the cursor it answered about a `..`; asked once,
    // here, it answers about the mark that opened the region. See
    // {@link schemeWroteTheMark} and its wide reading
    // {@link grammarWroteTheMark}, and {@link popsBefore} for the other
    // question this opening settles.
    const scheme = schemeWroteTheMark(text, start);
    const marked = grammarWroteTheMark(text, start);
    if (stop >= 0 && stop <= start) stop = nextSchemeAuthority(text, start + 1) ?? -1;
    // ASKED ONLY WHERE THE ANSWER CAN MATTER. With no `@` past `stop` the
    // bounded and the unbounded region hold the same candidates, so neither
    // question below is asked — which is what keeps a path of nothing but marks
    // linear.
    //
    // AND A MARK INSIDE THE REGION'S OWN AUTHORITY IS NOT WHERE A URL STARTS.
    // The bound's whole warrant is that a COMPLETE authority is followed by a
    // url of its own; a mark the authority itself spells is part of that
    // authority instead, and cutting there hides the credential the authority
    // carries. `://https:8443@host/v1` is the shape: `https:` inside it opens a
    // region of its own, and bounding the outer region there left the username
    // `https` standing. So the mark bounds only where this authority has
    // already ended, asked as a walk over the text BETWEEN the two rather than
    // over everything past the mark.
    const bounded =
      stop >= 0 &&
      (lastAtOfText <= stop ||
        (authorityEnd(text, start, true, stop + 1) <= stop && parsesAsAuthority(text, start)));
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
    // Three answers at most per CROSSING, and the pass stays linear either way.
    // `lastAt` and `lastLoneAt` are each spent by the answer that returns them,
    // and an `@` at the cut itself is preceded by the `@` the previous answer
    // ended on — which makes it a lone `@` and therefore the last one. A
    // crossing resets that count, and it also consumes a `..` and an `@` that
    // no later region can read again, because `cut` never moves backwards and
    // `from` leaves each region at it. So the whole scan runs at most once per
    // `@` in the text.
    let open = start;
    let pops = popsBefore(text, start);
    let cut = floor > start ? floor : start;
    floor = -1;
    for (;;) {
      const at = userinfoEnd(text, scheme, marked, cut, lastAt, lastLoneAt);
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
      // AND THE `..` IS CROSSED RATHER THAN PASSED, which is round 16's finding
      // and the one thing the cursor above still could not do. Stopping in front
      // of a `..` is correct for the SPAN and wrong for the SCAN: the removal
      // exposes the `..`, the rebuild pops the empty segment a solidus spells,
      // and the group behind it only becomes a region on the pass after that. So
      // `/x` + 2N solidi + N `@../` groups drained ONE group a pass — 1,601
      // rebuilds and 143 ms for a 9.6 KB `Location` the SERVER chose, and
      // `toJSON()` paid it again per log line.
      //
      // The span CLOSES here instead of stretching over the `..`, so the `..` is
      // emitted, the rebuild performs it, and the paragraph above keeps every
      // word. What moves is only where the scan looks next. `open` is the span's
      // own start for exactly that reason: a region can now answer with SEVERAL
      // spans, and the text between them is the dot segments it refused to eat.
      //
      // COUNTED, NOT ALLOWED, because the answer is a fact about the slow
      // spelling and a cost fix may not move it. {@link popsBefore} holds the
      // arithmetic and the input that shows the difference.
      let resumed = cut;
      for (; pops > 0; pops -= 1) {
        const next = pastOnePop(text, resumed);
        if (next === resumed) break;
        resumed = next;
      }
      if (resumed > cut) {
        // `cut` is past an `@` this region already answered for, and `open` is
        // at or before that `@`, so the span closing here is never empty.
        spans.push({ start: open, end: cut });
        open = resumed;
        cut = resumed;
      }
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
    if (cut > open) spans.push({ start: open, end: cut });
    // Past the `@` this region ended on: any region opening inside the span
    // just removed reads the same `@` and nests inside it.
    from = cut;
  }
  return spans;
}

/**
 * Every userinfo span in a parser's own `pathname`, read as far as `tail` in the
 * one state where the path ends inside an authority.
 *
 * `tail` is `search + hash`: the text the outer parse cut the path off from.
 * {@link endsInsideAuthority} decides whether the scan crosses that cut, and it
 * is the only question that can widen the text this module reads past the path.
 * The answer never widens what a caller may EMIT — the caller clips at
 * `path.length` — so the widening buys exactly one thing: the `@` of a
 * credential the outer `?` cut in half.
 *
 * The question is skipped where `tail` is empty, because the two answers are
 * then the same text.
 *
 * @internal
 */
export function pathUserinfoSpans(path: string, tail: string, seam: Span | null): Span[] {
  return userinfoSpans(tail !== "" && endsInsideAuthority(path) ? path + tail : path, seam);
}
