import { describe, expect, test } from "vitest";
import { redactUrl, redactUrlInMessage } from "../../src/errors/redact-url";
import { mulberry } from "../../fixtures/responses";

/**
 * ROUND 12, LANE F2 — an independent oracle for `src/errors/redact-url.ts`.
 *
 * Five consecutive rounds found a critical in the redactor. Every round's fixer
 * shipped a fuzz harness, every harness was built out of the shapes the PREVIOUS
 * rounds had taught it, and every time the next round found the shape that
 * harness could not spell. Round 11 ran 853,684 urls and shipped two criticals.
 * A bigger corpus is not the instrument.
 *
 * The thing that DID catch a regression here was a property — `f(f(u)) === f(u)`
 * — written by a hunter who found no bug. So this file is a judge, not a corpus.
 * It answers, for ANY input, whether an output is acceptable, and it derives
 * that answer from two authorities that are not the implementation:
 *
 *   1. THE PLATFORM. What the input's credentials ARE is not this module's
 *      opinion. It is `new URL`'s. The judge parses the input, and every
 *      url-shaped substring of it, and treats every `username` and `password`
 *      the parser reports as a credential that must not survive. An attacker
 *      cannot spell past this half, because spelling past it means convincing
 *      the parser the text is not a credential — and then it is not one.
 *
 *   2. THE WRITTEN CONTRACT. `CONTEXT.md` ("Structure and value") and
 *      `SECURITY.md` ("Known residuals") say what the emitted url may contain:
 *      the same origin, a path that came from the parsed `pathname`, and no byte
 *      the caller wrote after a `?` or a `#`. That is the structural half.
 *
 * Nothing here was read out of `redact-url.ts`. The judge does not know how the
 * module decides anything; it only knows what the answer must look like.
 *
 * WHERE THE IDEAL ANSWER IS NOT REACHABLE, the residual is encoded by name and
 * as narrowly as it can be stated — see "the documented residuals" at the foot
 * of this file. A residual that silently widens is the failure mode this file
 * exists to catch, so each pin fails if the residual grows by one character.
 */

/* -------------------------------------------------------------------------- */
/* THE JUDGE — part one: the platform's answer                                */
/* -------------------------------------------------------------------------- */

/**
 * The oracle's OWN base for a relative reference. It is deliberately not the
 * module's base. Resolving a relative reference against any base whose path is
 * empty yields the same `pathname`, so the judge's structural answer does not
 * depend on which reserved host it picked.
 */
const ORACLE_BASE = "http://oracle.invalid";

/**
 * The WHATWG "special" schemes, quoted from the URL Standard rather than from
 * this module. They are named here only so the generator can cross them against
 * the solidus axis; the judge itself never branches on them.
 */
const WHATWG_SPECIAL = ["http", "https", "ws", "wss", "ftp", "file"] as const;

/** `new URL(text)`, or `null`. The parser is the authority on "is this a url?". */
function parseAbsolute(text: string): URL | null {
  try {
    return new URL(text);
  } catch {
    return null;
  }
}

/** `new URL(text, base)`, or `null`. Used for protocol-relative and rooted refs. */
function parseRelative(text: string): URL | null {
  try {
    return new URL(text, ORACLE_BASE);
  } catch {
    return null;
  }
}

/** `decodeURIComponent` that answers with the input on a malformed sequence. */
function decodeOnce(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * The form in which a disclosure counts.
 *
 * A credential that reaches the output percent-encoded, or split by a tab the
 * parser ignores, is disclosed: both spellings decode to the secret with no
 * knowledge the reader lacks. So containment is asked in a normalized space —
 * tab, CR and LF removed (the parser removes them too), percent-decoded once,
 * and lowercased. Every step widens what counts as a hit, which is the safe
 * direction for a judge.
 */
function normalized(text: string): string {
  return decodeOnce(text.replace(/[\t\r\n]/g, "")).toLowerCase();
}

/** Positions where the URL Standard could begin reading an authority. */
const SCHEME_TOKEN = /[a-zA-Z][a-zA-Z0-9+.-]*:/g;
const SOLIDUS_PAIR = /[/\\][/\\]/g;

/** Every index in `text` matched by `pattern`. */
function matchIndexes(text: string, pattern: RegExp): number[] {
  const found: number[] = [];
  pattern.lastIndex = 0;
  for (let hit = pattern.exec(text); hit !== null; hit = pattern.exec(text)) {
    found.push(hit.index);
    if (found.length >= 16) break;
  }
  return found;
}

/**
 * Every credential the platform can find anywhere in `input`.
 *
 * Four VIEWS of the input are scanned, because four are what the parser itself
 * can see: the raw text; the text with tab, CR and LF removed (the parser
 * removes them, so a scheme spelled `htt<TAB>p:` is a scheme); and the
 * `pathname` of the absolute and relative parses, which is where a nested url
 * lands after the outer authority is gone and after `\` has become `/`.
 *
 * In each view, a slice is taken at every scheme token and at every pair of
 * solidi — the two places the URL Standard opens an authority — and handed to
 * `new URL`. Whatever it calls `username` or `password` is a credential. The
 * judge never decides this itself.
 */
function credentialsOf(input: string): string[] {
  const views = new Set<string>([input, input.replace(/[\t\r\n]/g, "")]);
  const absolute = parseAbsolute(input);
  if (absolute) views.add(absolute.pathname);
  const relative = parseRelative(input);
  if (relative) views.add(relative.pathname);

  const slices = new Set<string>();
  for (const view of views) {
    slices.add(view);
    for (const at of matchIndexes(view, SCHEME_TOKEN)) slices.add(view.slice(at));
    for (const at of matchIndexes(view, SOLIDUS_PAIR)) slices.add(view.slice(at));
  }

  const found = new Set<string>();
  for (const slice of slices) {
    const parsed = parseAbsolute(slice) ?? parseRelative(slice);
    if (!parsed) continue;
    for (const value of [parsed.username, parsed.password]) {
      if (!value) continue;
      found.add(value);
      const decoded = decodeOnce(value);
      if (decoded !== value) found.add(decoded);
    }
  }
  return [...found];
}

/**
 * Whether a credential is distinctive enough to be judged on containment.
 *
 * A one- or two-character credential collides with ordinary structure by
 * accident: `http://a:b@a.test/` reports `a`, and the origin the redactor MUST
 * keep spells it. Three characters is the cut. It is a limit of the free-text
 * half only — every credential the generator plants is at least ten characters
 * and appears nowhere else in the input, so the corpus is judged in full.
 *
 * The cut is deliberately NOT the answer to a derived credential colliding with
 * the origin. That is a question about WHERE the text sits, not how long it is,
 * and {@link withoutMandatedOrigin} answers it by position instead.
 */
function isDistinctive(credential: string): boolean {
  return credential.length >= 3;
}

/** The credentials of `input` that the containment rule applies to. */
function judgedCredentialsOf(input: string): string[] {
  return credentialsOf(input).filter(isDistinctive);
}

/* -------------------------------------------------------------------------- */
/* THE JUDGE — part two: the written contract                                 */
/* -------------------------------------------------------------------------- */

/** Whether `needle` can be read out of `haystack` in order, with gaps. */
function isSubsequence(needle: string, haystack: string): boolean {
  let at = 0;
  for (const character of haystack) {
    if (at < needle.length && needle[at] === character) at += 1;
  }
  return at === needle.length;
}

/** One acceptable-failure. Reported as a measurement, never as a diff. */
interface Violation {
  property: string;
  input: string;
  output: string;
  detail: string;
}

function violation(property: string, input: string, output: string, detail: string): Violation {
  return { property, input, output, detail };
}

/**
 * A readable, pasteable rendering, capped so a red run stays legible.
 *
 * The count leads, because the size of a failure population is the measurement:
 * one input is a shape, three hundred is a rule that does not hold.
 */
function report(violations: Violation[]): string[] {
  if (violations.length === 0) return [];
  const distinct = new Set(violations.map((it) => it.input)).size;
  return [
    `${violations.length} acceptable-failures over ${distinct} inputs; first 8:`,
    ...violations
      .slice(0, 8)
      .map(
        (it) =>
          `${it.property}: ${it.detail} | in=${JSON.stringify(it.input)} out=${JSON.stringify(
            it.output,
          )}`,
      ),
  ];
}

/** `redactUrl` with the throw captured, because "nothing throws" is a property. */
function attempt(
  input: string,
): { threw: true; error: unknown } | { threw: false; output: string } {
  try {
    return { threw: false, output: redactUrl(input) };
  } catch (error) {
    return { threw: true, error };
  }
}

/**
 * The bytes STRUCTURE COMPELS the output to carry: the input's own origin.
 *
 * `${protocol}//${host}` rather than `.origin`, because `.origin` is the string
 * `"null"` for a non-special scheme and this has to be the literal text.
 */
function mandatedOrigin(input: string): string {
  const parsed = parseAbsolute(input);
  return parsed ? `${parsed.protocol}//${parsed.host}` : "";
}

/**
 * `output` with ONE occurrence of the compelled origin taken out.
 *
 * A credential is DERIVED text — `new URL` reports it, the caller never wrote it
 * in that form — so it can coincide with bytes the contract orders the redactor
 * to emit. `https://api.test/proxy//http:USER:PASS@inner.test` is the real case:
 * read relatively, the parser calls `http` the username, and the origin
 * `https://api.test` that STRUCTURE requires the output to KEEP spells those
 * four letters. No correct redactor can win that row, so it is not a row.
 *
 * This cannot mask a leak, for two reasons that hold together:
 *   - only the FIRST occurrence goes, and only if it matches the input's own
 *     origin exactly, so every other byte of the output is still searched —
 *     including a second occurrence of the same text inside the path;
 *   - STRUCTURE separately proves those bytes ARE the origin. If the origin ever
 *     moved, the prefix stops matching, nothing is excised, and CREDENTIAL runs
 *     at full strength on the whole output. The two halves fail open, not shut.
 *
 * The alternative was to raise the distinctiveness cut past four characters.
 * That was refused: it would stop judging every genuine four-character
 * credential everywhere, to describe one collision it does not name.
 */
function withoutMandatedOrigin(input: string, output: string): string {
  const origin = mandatedOrigin(input);
  if (origin === "") return output;
  const at = output.indexOf(origin);
  return at === -1 ? output : output.slice(0, at) + output.slice(at + origin.length);
}

/**
 * CREDENTIAL — no credential the platform reports for `input` survives in
 * `output`, under any spelling, anywhere the contract did not compel the bytes.
 */
function judgeCredentials(
  property: string,
  input: string,
  output: string,
  planted: readonly string[] = [],
): Violation[] {
  const haystack = normalized(withoutMandatedOrigin(input, output));
  const found: Violation[] = [];
  // The parser's answer, UNION what the generator planted in a userinfo slot the
  // URL Standard opens a region over. The second term is what keeps this half
  // from being vacuous on a refused authority, where the parser answers nothing.
  // It is still not the judge's own opinion: `opensRegion` is SECURITY.md's
  // sentence, and `withoutMandatedOrigin` excuses a planted token the parser
  // turned into the host, so a token the contract compels is never counted.
  for (const credential of new Set([
    ...judgedCredentialsOf(input),
    ...planted.filter(isDistinctive),
  ])) {
    if (haystack.includes(normalized(credential))) {
      found.push(
        violation(property, input, output, `credential ${JSON.stringify(credential)} survived`),
      );
    }
  }
  return found;
}

/**
 * STRUCTURE — the emitted url names the same origin, its path came from the
 * parsed `pathname`, and no value slot survives.
 *
 * `CONTEXT.md`: "A hierarchical `url` emits the origin and path, and only those:
 * every emitted byte comes from the origin or from the parsed `pathname`. It
 * never emits userinfo, a query, or a fragment. An opaque URL emits only its
 * scheme."
 *
 * The scheme-only answer is accepted for ANY absolute input, not only for the
 * schemes this module happens to call opaque. Emitting less is never a
 * disclosure, so a judge that forbade it would be grading style, not safety.
 */
function judgeStructure(input: string, output: string): Violation[] {
  const found: Violation[] = [];
  if (output.includes("?") || output.includes("#")) {
    found.push(violation("STRUCTURE/marks", input, output, "a raw ? or # reached the output"));
  }

  const parsed = parseAbsolute(input);
  if (!parsed) {
    // A relative or unparseable input has no authority of its own to name, so
    // the emitted value must be a path. `redactUrl` documents the empty string
    // as its "no URL could be resolved" answer.
    if (output !== "" && !output.startsWith("/")) {
      found.push(
        violation("STRUCTURE/relative", input, output, "a relative input gained a non-path prefix"),
      );
    }
    return found;
  }

  if (output === parsed.protocol) return found;

  const emitted = parseAbsolute(output);
  if (!emitted) {
    found.push(violation("STRUCTURE/parse", input, output, "the emitted url does not parse"));
    return found;
  }
  if (emitted.protocol !== parsed.protocol || emitted.host !== parsed.host) {
    found.push(
      violation(
        "STRUCTURE/origin",
        input,
        output,
        `origin moved to ${emitted.protocol}//${emitted.host}`,
      ),
    );
  }
  if (emitted.username !== "" || emitted.password !== "") {
    found.push(violation("STRUCTURE/userinfo", input, output, "the emitted url carries userinfo"));
  }
  if (emitted.search !== "" || emitted.hash !== "") {
    found.push(
      violation("STRUCTURE/value", input, output, "the emitted url carries a query or a fragment"),
    );
  }
  if (!isSubsequence(emitted.pathname, parsed.pathname)) {
    found.push(
      violation(
        "STRUCTURE/path",
        input,
        output,
        `path ${emitted.pathname} is not a subsequence of ${parsed.pathname}`,
      ),
    );
  }
  return found;
}

/* -------------------------------------------------------------------------- */
/* THE GENERATOR — axes from the URL Standard, not from the bug history       */
/* -------------------------------------------------------------------------- */

/**
 * The planted secrets. Each is at least ten characters and appears nowhere else
 * in any generated input, so a containment hit is a disclosure and never a
 * coincidence. Nothing about their spelling is special to this module.
 *
 * ONE SENTINEL, ONE ROLE. This is a rule about the corpus, not decoration.
 * `OUTER_TAIL` exists because the outer-userinfo axis used to spell its second
 * `@` half with `INNER_USER`, which the nested-url axis also plants. An input
 * drawing both then held the same token in two slots, one removed and one kept
 * as an ordinary path segment, and no judge could say which occurrence it was
 * looking at. A corpus that cannot tell a leak from a residual is a corpus bug,
 * and the answer is a distinct token, never an exception for the input.
 */
const USER = "USERSENTINELAA";
const PASS = "PASSSENTINELBB";
const QUERY = "QUERYSENTINELCC";
const FRAGMENT = "FRAGSENTINELDD";
const INNER_USER = "INNERUSERSENTEE";
const INNER_PASS = "INNERPASSSENTFF";
const OUTER_TAIL = "OUTERTAILSENTGG";

/** Every planted token, so the corpus can prove no two roles share one. */
const SENTINELS = [USER, PASS, QUERY, FRAGMENT, INNER_USER, INNER_PASS, OUTER_TAIL] as const;

/** Scheme: special, non-special, and absent (a relative reference). */
const SCHEMES = [...WHATWG_SPECIAL, "git", "svn+ssh", "data", "blob", ""] as const;

/**
 * Solidus count AND spelling. The URL Standard reads `\` as a solidus under a
 * special scheme, and it removes tab, CR and LF from the input before it reads
 * anything — so the same authority has many spellings and each one is an axis
 * value, not a special case.
 */
const SOLIDI = [
  "",
  "/",
  "//",
  "///",
  "////",
  "\\",
  "\\\\",
  "/\\",
  "\\/",
  "\t//",
  "/\t/",
  "\r\n//",
] as const;

/**
 * Userinfo presence and shape. Half of these SPELL a delimiter inside the
 * credential — `://`, `:/`, `@`, `?`, `#`, raw and percent-encoded — because a
 * credential that spells a mark is the shape that broke round 9 and round 12.
 */
const USERINFO = [
  "",
  `${USER}@`,
  `${USER}:${PASS}@`,
  `:${PASS}@`,
  "@",
  `${USER}%3A${PASS}@`,
  `${USER}%40${PASS}@`,
  `${USER}%2F%2F${PASS}@`,
  `${USER}%3F${PASS}@`,
  `${USER}%23${PASS}@`,
  `${USER}://${PASS}@`,
  `${USER}:/${PASS}@`,
  `${USER}@${PASS}@`,
  `${USER}:${PASS}@${OUTER_TAIL}@`,
] as const;

/**
 * Host form: registrable, IPv4, IPv6, IDN in both spellings, empty, and four the
 * parser REFUSES. A refused authority is not an exotic input — it is the state
 * in which every parse the module can lean on returns nothing, so whatever guard
 * stands there stands alone. Round 13 found that guard failing open.
 */
const HOSTS = [
  "api.test",
  "127.0.0.1",
  "[::1]",
  "xn--n3h.test",
  "ünïcode.test",
  "localhost",
  "",
  "in ternal.test",
  "[not-ipv6]",
  "in|ternal.test",
] as const;

/**
 * Port: absent, present, the empty port the Standard permits, and two the parser
 * refuses — out of range, and not a number.
 */
const PORTS = ["", ":8443", ":", ":99999", ":abc"] as const;

/**
 * Path shape, including nesting. The last four values nest a whole credentialed
 * url inside the path at depth one and depth two, which is where the "path is
 * structure" trade and the "an embedded url is not a path segment" rule meet.
 */
const PATHS = [
  "",
  "/",
  "/v1/things",
  "/a/./b",
  "/a/../b",
  "/%2Fa/b",
  "/@alice",
  "/users/@alice",
  "//x@y/z",
  `/go/git:/${INNER_USER}:${INNER_PASS}@inner.test`,
  `/redirect/https://${INNER_USER}:${INNER_PASS}@inner.test/x`,
  `/proxy/http:${INNER_USER}:${INNER_PASS}@inner.test`,
  `/deep//${INNER_USER}:${INNER_PASS}@inner.test/x`,
  `/one/https://mid.test/two/https://${INNER_USER}:${INNER_PASS}@inner.test/x`,
] as const;

/**
 * A whole credentialed url, used as the first component of a reference rather
 * than as a later path segment. Special and non-special, over two solidi and
 * over fewer, so the pair the URL Standard treats differently is both present.
 */
const EMBEDDED = [
  `https://${INNER_USER}:${INNER_PASS}@inner.test/x`,
  `http:${INNER_USER}:${INNER_PASS}@inner.test`,
  `git://${INNER_USER}:${INNER_PASS}@inner.test/x`,
  `git:/${INNER_USER}:${INNER_PASS}@inner.test`,
] as const;

/** Query and fragment: absent, and present carrying a sentinel. */
const QUERIES = ["", `?t=${QUERY}`, `?a=1&b=${QUERY}`] as const;
const FRAGMENTS = ["", `#${FRAGMENT}`] as const;

/** The full cross-product, stated so the sampling below has a denominator. */
const CROSS_PRODUCT_SIZE =
  SCHEMES.length *
  SOLIDI.length *
  USERINFO.length *
  HOSTS.length *
  PORTS.length *
  PATHS.length *
  QUERIES.length *
  FRAGMENTS.length;

function pick<T>(list: readonly T[], random: () => number): T {
  const item = list[Math.floor(random() * list.length) % list.length];
  if (item === undefined) throw new Error("an axis was empty");
  return item;
}

/**
 * One corpus entry: the text, and what the GENERATOR knows it planted.
 *
 * `planted` exists because the platform half goes silent exactly where round 13
 * found leaks. `new URL("https://alice:pw@/v1")` throws — an empty host is a
 * refused authority — and `new URL("file:///alice:pw@/v1")` succeeds but reports
 * `username === ""`, because the parser split the solidus run into an empty
 * authority and a path. Either way it names no credential, so a judge that asks
 * only the parser is VACUOUS on the whole refused-authority family.
 */
interface Case {
  input: string;
  /** Sentinels written into a userinfo slot the URL Standard opens a region over. */
  planted: readonly string[];
}

/**
 * Whether the URL Standard opens an authority here, decided from the SPELLING.
 *
 * DERIVED FROM THE PLATFORM, not from the contract. `SECURITY.md` says "at two
 * or more solidi under any scheme, and at a SPECIAL scheme (`http`, `https`,
 * `ws`, `wss`, `ftp`, `file`) over any number of solidi, including none", and
 * that sentence is WRONG about `file:`. Measured:
 *
 *     file:svc:pw@api.test/v1     -> username ""    host ""
 *     file:/svc:pw@api.test/v1    -> username ""    host ""
 *     file://svc:pw@api.test/v1   -> THROWS
 *     file:///svc:pw@api.test/v1  -> username ""    host ""
 *     git:/svc:pw@api.test/v1     -> username ""    host ""     (identical)
 *     http:svc:pw@api.test/v1     -> username "svc" host "api.test"
 *     http:/svc:pw@api.test/v1    -> username "svc" host "api.test"
 *
 * The URL Standard routes `file:` to the file state BEFORE the
 * special-authority-slashes state, so a `file:` reference reaches an authority
 * only over exactly two solidi, and a userinfo makes even that parse fail. Under
 * fewer than two it is a path with an empty host — exactly like `git:`, which
 * residual 2 already treats as a non-opener. Quoting a contract makes a judge
 * exactly as correct as the contract, and this one cost 14 false rows.
 *
 * So the question is put to the parser instead, with a canary userinfo at the
 * scheme and solidus spelling actually written. Three answers, and the middle
 * one matters: a REFUSED authority is still an opened one — `https://u:p@/v1`
 * throws on the empty host, and the credential in it is real. Only "none" means
 * no region.
 */
type Opening = "userinfo" | "refused" | "none";

const CANARY_USER = "CANARYUSERZZ";
const OPENING_CACHE = new Map<string, Opening>();

function authorityOpening(scheme: string, solidi: string): Opening {
  const key = `${scheme}|${solidi}`;
  const remembered = OPENING_CACHE.get(key);
  if (remembered !== undefined) return remembered;
  const probe = `${scheme === "" ? "" : `${scheme}:`}${solidi}${CANARY_USER}:CANARYPASSZZ@canary.test/v1`;
  let answer: Opening;
  try {
    // A base is passed ONLY for a scheme-less reference. Handing one to an
    // absolute reference changes the answer: when the reference's scheme equals
    // the base's, the Standard reads it as relative and eats the mark, so
    // `new URL("http:u:p@h/v1", "http://…")` reports no username while
    // `new URL("http:u:p@h/v1")` reports `u`. `redactUrl` tries the input on its
    // own first, so the un-based reading is the one that decides the slot.
    const parsed = scheme === "" ? new URL(probe, ORACLE_BASE) : new URL(probe);
    answer = parsed.username === CANARY_USER ? "userinfo" : "none";
  } catch {
    answer = "refused";
  }
  OPENING_CACHE.set(key, answer);
  return answer;
}

function opensRegion(scheme: string, solidi: string): boolean {
  return authorityOpening(scheme, solidi) !== "none";
}

/**
 * Which planted tokens sit in the AUTHORITY, given the solidi actually written.
 *
 * Two narrowings, and both matter. A region has to open at all — that is
 * {@link opensRegion}, and it is now the parser's answer rather than the
 * document's. And the authority ends where the URL Standard ends it: at the
 * first `/`, `\`, `?` or `#` after the solidus run. Only text before that is
 * unambiguously userinfo under every reading of the contract.
 *
 * The second narrowing is what keeps this half honest. Without it the axis value
 * `USER:/PASS@` claims BOTH tokens behind any special scheme — but the Standard
 * closed the authority at that interior solidus, so `PASS@…` is path text, and
 * whether a region re-opens over it is the question residuals 1 and 3 are about.
 * Claiming it here would have this half assert an answer the round has not
 * adjudicated, on 250-odd inputs, in a judge whose whole worth is that it does
 * not do that. Those rows are left to the parser half, which reads them without
 * an opinion, and to the residual pins.
 */
function plantedIn(scheme: string, solidi: string, userinfo: string): readonly string[] {
  if (!opensRegion(scheme, solidi)) return [];
  const authority = userinfo.split(/[/\\?#]/)[0] ?? "";
  return SENTINELS.filter((sentinel) => authority.includes(sentinel));
}

function compose(
  scheme: string,
  solidi: string,
  userinfo: string,
  host: string,
  port: string,
  path: string,
  query: string,
  fragment: string,
): Case {
  return {
    input: `${scheme === "" ? "" : `${scheme}:`}${solidi}${userinfo}${host}${port}${path}${query}${fragment}`,
    planted: plantedIn(scheme, solidi, userinfo),
  };
}

/**
 * Userinfo text that carries a SOLIDUS-COLON run, an embedded `://`, or both.
 * Slice E crosses these with a trailing `@` segment; see the slice for why.
 */
const COMPOUND = [`x:/a@`, `${USER}:/`, `${USER}://`, `${USER}%3A/`, `x:/a@${USER}:`] as const;

/** What follows the embedded host in slice E. `/@name` is the deciding one. */
const TAILS = ["/@bob", "/@", "/x/@bob", ""] as const;

/**
 * Authorities `new URL` refuses, as `[host, port]`. Empty host, port out of
 * range, port not a number, a space in the host, a bracket form that is not an
 * IPv6 address, and a forbidden host code point.
 */
const REFUSED_AUTHORITIES = [
  ["", ""],
  ["internal.test", ":99999"],
  ["internal.test", ":abc"],
  ["in ternal.test", ""],
  ["[not-ipv6]", ""],
  ["in|ternal.test", ""],
] as const;

const SEED = 20_261_212;
const SAMPLE_SIZE = 3000;

/**
 * The corpus: a seeded sample of the cross-product, plus the full enumeration of
 * three two-dimensional slices whose interaction the axes above cannot be
 * trusted to reach by sampling alone.
 */
function buildCorpus(): Case[] {
  const random = mulberry(SEED);
  const seen = new Map<string, Case>();
  const corpus = {
    add(one: Case): void {
      if (!seen.has(one.input)) seen.set(one.input, one);
    },
  };

  for (let taken = 0; taken < SAMPLE_SIZE; taken += 1) {
    corpus.add(
      compose(
        pick(SCHEMES, random),
        pick(SOLIDI, random),
        pick(USERINFO, random),
        pick(HOSTS, random),
        pick(PORTS, random),
        pick(PATHS, random),
        pick(QUERIES, random),
        pick(FRAGMENTS, random),
      ),
    );
  }

  // Slice A — scheme x solidus. Whether an authority opens at all is decided by
  // exactly this pair, under every spelling of a solidus.
  for (const scheme of SCHEMES) {
    for (const solidi of SOLIDI) {
      corpus.add(compose(scheme, solidi, `${USER}:${PASS}@`, "api.test", "", "/v1", "", ""));
    }
  }
  // Slice B — solidus x userinfo. Where a region opens, crossed with every
  // credential that spells a mark.
  for (const solidi of SOLIDI) {
    for (const userinfo of USERINFO) {
      corpus.add(compose("https", solidi, userinfo, "api.test", "", "/v1", "", ""));
    }
  }
  // Slice C — userinfo x path. The outer credential crossed with every nesting
  // depth, which is where one round's rule stops being local.
  for (const userinfo of USERINFO) {
    for (const path of PATHS) {
      corpus.add(compose("https", "//", userinfo, "api.test", "", path, "", ""));
    }
  }
  // Slice D — solidus x embedded url, with the embedded url as the FIRST
  // component rather than a later path segment. The composer above cannot reach
  // this: it always writes a host before the path, and the shape that matters is
  // the one where the embedded url IS what follows the solidi. The URL Standard
  // then reads the embedded scheme's own text as an authority, which is a
  // different question from "is there a url later in the path".
  for (const solidi of SOLIDI) {
    for (const embedded of EMBEDDED) {
      corpus.add({ input: `${solidi}${embedded}`, planted: [] });
      corpus.add({ input: `https://api.test/proxy/${solidi}${embedded}`, planted: [] });
    }
  }
  // Slice E — COMPOUND userinfo x trailing `/@name`, behind a solidus run.
  // A userinfo whose own text carries both a solidus-colon run and an embedded
  // `://`, with an `@` segment after it. Every axis above varies ONE feature of
  // a userinfo at a time; this varies two at once, which is what it takes for
  // one pass to end a region where the next pass ends it somewhere else. The
  // parser reports no credential in any of these — IDEMPOTENCE is the property
  // that reads them, and it only reads what the corpus spells.
  for (const prefix of COMPOUND) {
    for (const tail of TAILS) {
      for (const solidi of ["", "/", "//", "///", "\\\\"]) {
        corpus.add({
          input: `https://api.test${solidi}${prefix}${PASS}://h.test${tail}`,
          planted: [],
        });
        corpus.add({ input: `${solidi}${prefix}${PASS}://h.test${tail}`, planted: [] });
      }
    }
  }
  // Slice F — scheme x solidus x REFUSED AUTHORITY. Where every parse returns
  // nothing and the module's guard is the only thing standing. Crossing the
  // scheme axis in full also guarantees the row where the reference's scheme
  // EQUALS the scheme of whatever base a relative resolution uses, so a scheme
  // collision is always in the corpus rather than left to the sample.
  for (const scheme of SCHEMES) {
    for (const solidi of ["", "/", "//", "///"]) {
      for (const [host, port] of REFUSED_AUTHORITIES) {
        corpus.add(compose(scheme, solidi, `${USER}:${PASS}@`, host, port, "/v1", "", ""));
      }
    }
  }
  // Slice G — scheme x solidus, with the credential's colon PERCENT-ENCODED.
  // `%3A` at zero, one and two solidi are three different questions, and a
  // corpus that samples them reaches one.
  for (const scheme of SCHEMES) {
    for (const solidi of SOLIDI) {
      corpus.add(compose(scheme, solidi, `${USER}%3A${PASS}@`, "api.test", "", "/v1", "", ""));
    }
  }

  return [...seen.values()];
}

const CORPUS = buildCorpus();

/** Sweep the corpus with one judgement, collecting every acceptable-failure. */
function sweep(judge: (one: Case) => Violation[]): Violation[] {
  const found: Violation[] = [];
  for (const one of CORPUS) found.push(...judge(one));
  return found;
}

/* -------------------------------------------------------------------------- */
/* THE ORACLE'S OWN ASSUMPTIONS                                               */
/* -------------------------------------------------------------------------- */

describe("the oracle checks itself before it grades anything", () => {
  test("the corpus is the size it claims, from a fixed seed", () => {
    expect(CROSS_PRODUCT_SIZE).toBe(7_761_600);
    // Pinned exactly, not bounded: the seed and the axes are both fixed, so a
    // different number means an axis moved, which is a deliberate act.
    expect(CORPUS.length).toBe(4163);
    // The seed decides the sample, so two builds are the same corpus.
    expect(buildCorpus()).toEqual(CORPUS);
  });

  test("the generator plants credentials the PARSER confirms, not ones it names itself", () => {
    // If this ever went to zero the credential half would be vacuous: it would
    // be judging inputs the platform sees no credential in.
    const confirmed = CORPUS.filter(({ input }) => judgedCredentialsOf(input).length > 0);
    expect(confirmed.length).toBeGreaterThan(1500);
  });

  test("the PLANTED half is not vacuous, and never fires where a residual lives", () => {
    // It must reach the refused-authority family, where the parser is silent.
    const silentButPlanted = CORPUS.filter(
      ({ input, planted }) => planted.length > 0 && judgedCredentialsOf(input).length === 0,
    );
    expect(silentButPlanted.length).toBeGreaterThan(100);
    // And it must never fire on a non-special scheme under fewer than two
    // solidi, which is residual 2 — `plantedIn` returns nothing there.
    expect(plantedIn("git", "/", `${USER}:${PASS}@`)).toEqual([]);
    expect(plantedIn("svn+ssh", "", `${USER}:${PASS}@`)).toEqual([]);
    expect(plantedIn("", "/", `${USER}:${PASS}@`)).toEqual([]);
    // It fires where the PARSER opens an authority, and nowhere else.
    expect(plantedIn("git", "//", `${USER}:${PASS}@`)).toEqual([USER, PASS]);
    expect(plantedIn("http", "", `${USER}:${PASS}@`)).toEqual([USER, PASS]);
    expect(plantedIn("http", "/", `${USER}:${PASS}@`)).toEqual([USER, PASS]);
  });

  test("`file:` is NOT a region-opener, and the platform is what says so", () => {
    // SECURITY.md lists `file` among the schemes that reach an authority "over
    // any number of solidi, including none". That sentence is wrong, and the
    // judge believed it for 14 rows. Pinned from the platform so that if the
    // document is ever "corrected" back, this file fails instead of agreeing.
    //
    // The URL Standard routes `file:` to the file state BEFORE the
    // special-authority-slashes state.
    for (const solidi of ["", "/", "///", "////"]) {
      expect(new URL(`file:${solidi}svc:pw@api.test/v1`).username).toBe("");
      expect(authorityOpening("file", solidi)).toBe("none");
      expect(plantedIn("file", solidi, `${USER}:${PASS}@`)).toEqual([]);
    }
    // Exactly two solidi is the only spelling that reaches an authority at all,
    // and a userinfo makes even that parse fail — so it never carries one.
    expect(() => new URL("file://svc:pw@api.test/v1")).toThrow();
    expect(new URL("file://api.test/v1").host).toBe("api.test");
    // `file:` under fewer than two solidi is `git:` under fewer than two solidi.
    // Residual 2 already calls that a non-opener; the two now agree.
    expect(new URL("git:/svc:pw@api.test/v1").username).toBe("");
    expect(authorityOpening("git", "/")).toBe("none");
    // The other five special schemes DO open over no solidi at all. The
    // correction is about `file:` alone and must not have widened past it.
    for (const scheme of ["http", "https", "ws", "wss", "ftp"]) {
      expect(new URL(`${scheme}:svc:pw@api.test/v1`).username).toBe("svc");
      expect(authorityOpening(scheme, "")).toBe("userinfo");
      expect(plantedIn(scheme, "", `${USER}:${PASS}@`)).toEqual([USER, PASS]);
    }
  });

  test("a REFUSED authority is still an opened one — the planted half must fire", () => {
    // This is the round-13 family the fix closed, and the correction above must
    // not have taken it with it. The parser throws on every one of these, so
    // `judgedCredentialsOf` is silent and `planted` is the only thing carrying
    // the row. If these ever return "none", the half has been softened.
    expect(authorityOpening("https", "//")).toBe("userinfo");
    expect(authorityOpening("http", "")).toBe("userinfo");
    for (const [input, scheme, solidi] of [
      [`https://${USER}:${PASS}@/v1`, "https", "//"],
      [`https://${USER}:${PASS}@internal.test:99999/v1`, "https", "//"],
      [`http:${USER}:${PASS}@internal.test:99999/v1`, "http", ""],
      [`https://${USER}:${PASS}@[not-ipv6]/v1`, "https", "//"],
    ] as const) {
      expect(judgedCredentialsOf(input)).toEqual([]);
      const planted = plantedIn(scheme, solidi, `${USER}:${PASS}@`);
      expect(planted).toEqual([USER, PASS]);
      expect(judgeCredentials("SELFTEST", input, input, planted).length).toBeGreaterThan(0);
    }
  });

  test("the judge's containment rule sees through encoding, case, and a stripped tab", () => {
    expect(normalized("USER%53ENT")).toBe("usersent");
    expect(normalized("USER\tSENT")).toBe("usersent");
    expect(normalized("%2F%2F")).toBe("//");
  });

  test("the judge's subsequence rule is the one the contract states", () => {
    expect(isSubsequence("/a/c", "/a/b/c")).toBe(true);
    expect(isSubsequence("/a/d", "/a/b/c")).toBe(false);
    expect(isSubsequence("", "/anything")).toBe(true);
  });

  test("a deliberately broken redactor is caught by every half", () => {
    // A redactor that emits its input unchanged. The judge must reject it.
    const secret = `https://${USER}:${PASS}@api.test/v1?t=${QUERY}`;
    expect(judgeCredentials("SELFTEST", secret, secret).length).toBeGreaterThan(0);
    // The origin excision must not blunt this: the leaky output above begins
    // with the compelled origin, and the credential is still caught after it.
    expect(judgeStructure(secret, secret).length).toBeGreaterThan(0);
    // And an origin swap is caught even with nothing else wrong.
    expect(judgeStructure("https://api.test/v1", "https://evil.test/v1").length).toBeGreaterThan(0);
  });

  test("the origin excision is POSITIONAL — it cannot swallow the same text in the path", () => {
    // A credential that also occurs in the origin is still caught the moment a
    // SECOND occurrence sits outside it. Only the compelled bytes are excused.
    const input = "https://api.test/proxy//http:USERSENTINELAA:PASSSENTINELBB@inner.test";
    expect(credentialsOf(input)).toContain("http");
    // Excused: the only "http" left is the outer scheme, inside the origin.
    expect(judgeCredentials("SELFTEST", input, "https://api.test/proxy//inner.test")).toEqual([]);
    // Caught: the same four letters one byte past the origin are a disclosure.
    expect(
      judgeCredentials("SELFTEST", input, "https://api.test/proxy//http:@inner.test").length,
    ).toBeGreaterThan(0);
    // And the planted secrets are never excused, wherever they sit.
    expect(
      judgeCredentials("SELFTEST", input, "https://api.test/proxy//USERSENTINELAA@inner.test")
        .length,
    ).toBeGreaterThan(0);
  });

  test("the excision fails OPEN — a moved origin restores full-strength containment", () => {
    // If STRUCTURE's premise breaks, the prefix stops matching and nothing is
    // excised. A redactor cannot buy an exemption by emitting a wrong origin.
    const input = "https://api.test/proxy//http:USERSENTINELAA:PASSSENTINELBB@inner.test";
    expect(withoutMandatedOrigin(input, "https://evil.test/proxy//inner.test")).toBe(
      "https://evil.test/proxy//inner.test",
    );
    expect(judgeCredentials("SELFTEST", input, "https://evil.test/x").length).toBeGreaterThan(0);
  });

  test("the excision does not un-find what this round found", () => {
    // The three region-opening classes round 12 caught, paired with the answer
    // the module ACTUALLY gave before the redesign landed. If any of these ever
    // stops being flagged, the judge has been softened and this file is worth
    // nothing. They are pinned here because the excision was added after they
    // were found, and a change to a judge must be shown not to unfind a leak.
    const caught: [string, string][] = [
      // A bare `//` inside the path opened no region.
      [
        `https://api.test//${USER}:${PASS}@inner.test/x`,
        `https://api.test//${USER}:${PASS}@inner.test/x`,
      ],
      // A credential spelling `://` ended its own region (round 12, H4).
      [`https://${USER}://${PASS}@api.test/x`, `https://usersentinelaa//${PASS}@api.test/x`],
      // A protocol-relative url ate the embedded mark (round 12, H3).
      [`//https://${USER}:${PASS}@inner.test/x`, `//${USER}:${PASS}@inner.test/x`],
    ];
    for (const [input, leaked] of caught) {
      expect(judgeCredentials("SELFTEST", input, leaked).length).toBeGreaterThan(0);
    }
  });

  test("the corpus REACHES each of the four shapes round 13 found", () => {
    // The gap round 13 exposed was in the generator, not the judge: IDEMPOTENCE
    // was green because no input spelled the shape. Presence is therefore the
    // thing to pin. If an axis edit ever drops one of these, this fails loudly
    // instead of the corpus going quietly blind again.
    const spelled = new Set(CORPUS.map((one) => one.input));
    for (const shape of [
      // 1 — compound userinfo behind a bare `//`, with a trailing `/@name`.
      `https://api.test//x:/a@${PASS}://h.test/@bob`,
      // 2 — a refused authority: empty host, and a port out of range.
      `file:///${USER}:${PASS}@/v1`,
      `file:///${USER}:${PASS}@internal.test:99999/v1`,
      // 3 — a reference whose scheme equals the resolution base's scheme.
      `http:${USER}:${PASS}@internal.test:99999/v1`,
      // 4 — `%3A` at zero, one and two solidi.
      `http:${USER}%3A${PASS}@api.test/v1`,
      `http:/${USER}%3A${PASS}@api.test/v1`,
      `http://${USER}%3A${PASS}@api.test/v1`,
    ]) {
      expect(spelled.has(shape)).toBe(true);
    }
  });

  test("the judge CATCHES each round-13 leak, given the answer that leaked it", () => {
    // Paired with the pre-fix answer, the way the round-12 classes are pinned
    // above. A future change that re-opens one of these fails here rather than
    // passing silently.
    //
    // The last flag records WHICH HALF has to carry the row, and the four are
    // not alike. On the three refused-or-split authorities the parser names no
    // credential at all, and only `planted` makes them judgeable. On the `%3A`
    // row the parser DOES answer — it reports the percent-encoded username — so
    // that row was never a judge gap at all, only a corpus gap. Pinning the
    // difference stops a later reader from believing `planted` is load-bearing
    // where it is not.
    const caught: [string, string, readonly string[], boolean][] = [
      // A refused authority, guard failing open — the credential rode out whole.
      [
        `https://${USER}:${PASS}@/v1`,
        `https://${USER}:${PASS}@/v1`,
        plantedIn("https", "//", `${USER}:${PASS}@`),
        true,
      ],
      [
        `https://${USER}:${PASS}@internal.test:99999/v1`,
        `https://${USER}:${PASS}@internal.test:99999/v1`,
        plantedIn("https", "//", `${USER}:${PASS}@`),
        true,
      ],
      // The reference's scheme matched the base's, so the mark was consumed.
      [
        `http:${USER}:${PASS}@internal.test:99999/v1`,
        `/${USER}:${PASS}@internal.test:99999/v1`,
        plantedIn("http", "", `${USER}:${PASS}@`),
        true,
      ],
      // `%3A` at zero and one solidus kept the credential.
      [
        `http:${USER}%3A${PASS}@api.test/v1`,
        `/${USER}%3A${PASS}@api.test/v1`,
        plantedIn("http", "", `${USER}%3A${PASS}@`),
        false,
      ],
    ];
    for (const [input, leaked, planted, parserSilent] of caught) {
      expect(judgedCredentialsOf(input).length === 0).toBe(parserSilent);
      expect(planted.length).toBeGreaterThan(0);
      expect(judgeCredentials("SELFTEST", input, leaked, planted).length).toBeGreaterThan(0);
    }

    // NEGATIVE pin, and it replaces two rows this test used to carry. Round 13
    // reported `file:///alice:hunter2@/v1` as a leak, but that report rested on
    // the same SECURITY.md sentence this oracle used to quote: no authority
    // opens there, so nothing in it is a credential and the module is right to
    // keep it as a path. The judge must NOT claim these, and saying so here is
    // the guard against re-deriving the document's error a third time.
    for (const input of [`file:///${USER}:${PASS}@/v1`, `file:/${USER}:${PASS}@localhost/v1`]) {
      expect(judgedCredentialsOf(input)).toEqual([]);
      expect(plantedIn("file", "///", `${USER}:${PASS}@`)).toEqual([]);
      expect(judgeCredentials("SELFTEST", input, input, [])).toEqual([]);
    }
  });

  test("ONE SENTINEL, ONE ROLE — no generated input holds a token in two slots", () => {
    // The corpus bug this rule closes: a token planted in both an outer userinfo
    // and a nested url is removed in one place and kept in the other, and the
    // judge cannot say which occurrence it found.
    const doubled: string[] = [];
    for (const { input } of CORPUS) {
      for (const sentinel of SENTINELS) {
        if (input.split(sentinel).length > 2) doubled.push(`${sentinel} in ${input}`);
      }
    }
    expect(doubled.slice(0, 5)).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* THE PROPERTIES                                                             */
/* -------------------------------------------------------------------------- */

describe("the oracle grades redactUrl over the generated corpus", () => {
  test("TOTALITY — nothing throws, for any input", () => {
    const found = sweep(({ input }) => {
      const result = attempt(input);
      return result.threw ? [violation("TOTALITY", input, "<threw>", String(result.error))] : [];
    });
    expect(report(found)).toEqual([]);
  });

  test("CREDENTIAL — no credential the platform reports survives the redaction", () => {
    const found = sweep(({ input, planted }) => {
      const result = attempt(input);
      return result.threw ? [] : judgeCredentials("CREDENTIAL", input, result.output, planted);
    });
    expect(report(found)).toEqual([]);
  });

  test("STRUCTURE — same origin, path from the parsed pathname, no value slot", () => {
    const found = sweep(({ input }) => {
      const result = attempt(input);
      return result.threw ? [] : judgeStructure(input, result.output);
    });
    expect(report(found)).toEqual([]);
  });

  test("SENTINEL — no byte the caller wrote after a ? or a # is emitted", () => {
    const found = sweep(({ input }) => {
      const result = attempt(input);
      if (result.threw) return [];
      const haystack = normalized(result.output);
      const leaked = [QUERY, FRAGMENT].filter((planted) => haystack.includes(normalized(planted)));
      return leaked.map((planted) =>
        violation("SENTINEL", input, result.output, `${planted} came from a query or a fragment`),
      );
    });
    expect(report(found)).toEqual([]);
  });

  test("IDEMPOTENCE — f(f(u)) === f(u)", () => {
    const found = sweep(({ input }) => {
      const first = attempt(input);
      if (first.threw) return [];
      const second = attempt(first.output);
      if (second.threw) {
        return [violation("IDEMPOTENCE", input, first.output, "the second pass threw")];
      }
      return second.output === first.output
        ? []
        : [
            violation(
              "IDEMPOTENCE",
              input,
              first.output,
              `second pass gave ${JSON.stringify(second.output)}`,
            ),
          ];
    });
    expect(report(found)).toEqual([]);
  });

  test("AGREEMENT — redactUrlInMessage(u, u) === redactUrl(u) wherever the parser accepts u", () => {
    const found = sweep(({ input }) => {
      // Gated on an ABSOLUTE parse. A relative url differs from its redacted
      // form through normalization alone, and the message pass is documented as
      // a replacement of a value the error already holds, not a normalizer.
      if (!parseAbsolute(input)) return [];
      const direct = attempt(input);
      if (direct.threw) return [];
      let viaMessage: string;
      try {
        viaMessage = redactUrlInMessage(input, input);
      } catch (error) {
        return [
          violation("AGREEMENT", input, direct.output, `the message pass threw: ${String(error)}`),
        ];
      }
      return viaMessage === direct.output
        ? []
        : [
            violation(
              "AGREEMENT",
              input,
              direct.output,
              `the message pass gave ${JSON.stringify(viaMessage)}`,
            ),
          ];
    });
    expect(report(found)).toEqual([]);
  });

  test("MESSAGE — the message channel drops every credential the url channel drops", () => {
    const found = sweep(({ input, planted }) => {
      // The platform quotes the url it refused back verbatim. This is that
      // message, built the way undici builds it.
      const message = `Request cannot be constructed from a URL that includes credentials: ${input}`;
      try {
        return judgeCredentials("MESSAGE", input, redactUrlInMessage(message, input), planted);
      } catch (error) {
        return [violation("MESSAGE", input, "<threw>", String(error))];
      }
    });
    expect(report(found)).toEqual([]);
  });
});

/**
 * MONOTONICITY, and the shape of it that is actually true.
 *
 * The literal cross-input form — `f(base + suffix)` is a subsequence of
 * `f(base)` — is false, and cheaply: `f("https://h/p")` is `https://h/p` and
 * `f("https://h/p" + "/more")` is `https://h/p/more`, which is longer. So the
 * property is encoded in the two directions that ARE laws:
 *
 *   - a suffix that is only a query or a fragment changes nothing at all;
 *   - a suffix of ordinary path characters can only EXTEND what was emitted, so
 *     the old answer is a subsequence of the new one. It is guarded to inputs
 *     with a path, because appending to `https://h` grows the HOST instead.
 *
 * Either direction failing means a byte's meaning depends on text that comes
 * after it, which is exactly how round 9 and round 12 were spelled.
 */
describe("the oracle grades monotonicity", () => {
  const withoutMarks = CORPUS.map((one) => one.input).filter(
    (input) => !input.includes("?") && !input.includes("#"),
  );

  test("the guarded populations are not empty", () => {
    expect(withoutMarks.length).toBeGreaterThan(500);
  });

  test("MONOTONE/mark — appending a query or a fragment changes nothing", () => {
    const found: Violation[] = [];
    for (const input of withoutMarks) {
      if (input.trim() === "") continue;
      const base = attempt(input);
      if (base.threw) continue;
      for (const suffix of [`?t=${QUERY}`, `#${FRAGMENT}`]) {
        const grown = attempt(input + suffix);
        if (grown.threw || grown.output === base.output) continue;
        found.push(
          violation(
            "MONOTONE/mark",
            input + suffix,
            grown.output,
            `without the suffix it was ${JSON.stringify(base.output)}`,
          ),
        );
      }
    }
    expect(report(found)).toEqual([]);
  });

  test("MONOTONE/growth — an appended path character only extends the answer", () => {
    const found: Violation[] = [];
    for (const input of withoutMarks) {
      const parsed = parseAbsolute(input);
      // Guarded: the input must already have a path, or the appended characters
      // land in the host and the comparison is between two different origins.
      if (!parsed || parsed.pathname.length <= 1) continue;
      const base = attempt(input);
      const grown = attempt(`${input}zz9`);
      if (base.threw || grown.threw) continue;
      if (isSubsequence(base.output, grown.output)) continue;
      found.push(
        violation(
          "MONOTONE/growth",
          `${input}zz9`,
          grown.output,
          `dropped bytes it kept in ${JSON.stringify(base.output)}`,
        ),
      );
    }
    expect(report(found)).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* THE DOCUMENTED RESIDUALS, ENCODED NARROWLY                                 */
/* -------------------------------------------------------------------------- */

/**
 * `SECURITY.md` names three residuals in `redactUrl`. Each one is a place where
 * the ideal answer is not reachable, so each is pinned here BY NAME and as
 * narrowly as it can be written: every pin asserts both that the residual is
 * still open AND that it stops exactly where the document says it stops. A
 * residual that widens by one character turns one of these red.
 *
 * The load-bearing observation is that all three coincide with a case the URL
 * parser does NOT call a credential. That is why the CREDENTIAL property above
 * needs no exception list: the residuals live entirely outside its reach, and
 * the day one of them grows to cover a parser-confirmed credential, CREDENTIAL
 * turns red without anyone editing this file.
 */
describe("the documented residuals — open, and bounded", () => {
  test("RESIDUAL 1 — a secret in a PATH SEGMENT survives, and userinfo does not", () => {
    // "A secret in a URL PATH SEGMENT survives in `error.url`."
    expect(redactUrl("https://api.test/reset/RESETTOKEN")).toContain("RESETTOKEN");
    // The bound: the same text one slot over is removed. If the residual ever
    // widened from "path" to "anything textual", this line fails.
    expect(redactUrl("https://RESETTOKEN@api.test/x")).not.toContain("RESETTOKEN");
    expect(redactUrl("https://u:RESETTOKEN@api.test/x")).not.toContain("RESETTOKEN");
    // And the parser agrees the surviving one is not a credential.
    expect(new URL("https://api.test/reset/RESETTOKEN").username).toBe("");
  });

  test("RESIDUAL 2 — a non-special scheme under fewer than two solidi keeps its text", () => {
    // "`/go/git:/svc:pw@host` keeps `svc:pw@host` as an ordinary path."
    expect(redactUrl("/go/git:/svc:pw@host")).toContain("svc:pw@host");
    // The bound, quoted from the document: the parser sees no credential there.
    expect(new URL("git:/svc:pw@host").username).toBe("");
    expect(new URL("git:/svc:pw@host").password).toBe("");
    // One more solidus and the parser DOES see one — so the residual stops.
    expect(new URL("git://svc:pw@host").username).toBe("svc");
    expect(redactUrl("/go/git://svc:pw@host")).not.toContain("svc:pw@");
    // A SPECIAL scheme reaches its authority over no solidi at all, so the
    // residual never covers one.
    expect(new URL("http:svc:pw@host").username).toBe("svc");
    expect(redactUrl("/go/http:svc:pw@host")).not.toContain("svc:pw@");
  });

  test("RESIDUAL 3 — a credential whose LAST character is a solidus survives", () => {
    // "`://host/users/@alice` and `://token/@host` spell the same three
    // characters, and no structural rule tells them apart."
    const open = "https://api.test//TOKENSENTINEL/@inner.test/x";
    expect(redactUrl(open)).toContain("TOKENSENTINEL");
    // The bound, and it is one character wide: remove the solidus and the same
    // text must go. If the residual ever widened to the no-solidus spelling,
    // this line fails.
    expect(redactUrl("https://api.test//TOKENSENTINEL@inner.test/x")).not.toContain(
      "TOKENSENTINEL",
    );
    // And the parser agrees the surviving one is not a credential: it is path.
    expect(new URL(open).username).toBe("");
    expect(new URL(open).password).toBe("");
  });

  test("RESIDUAL 4 — redactUrlInMessage over-redacts, and only ever over-redacts", () => {
    // "a needle from one of those slots is removed from the message WHEREVER it
    // appears". Over-redaction is the safe direction; the bound is that it may
    // never put a credential back.
    const url = "https://api.test/avatar/https://gravatar.test/u/alice@example.com";
    const message = `failed contacting https://gravatar.test/u/alice@example.com`;
    expect(judgeCredentials("RESIDUAL4", url, redactUrlInMessage(message, url))).toEqual([]);
  });
});
