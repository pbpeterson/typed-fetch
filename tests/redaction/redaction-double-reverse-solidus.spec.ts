import { describe, expect, test } from "vitest";
import { NetworkError } from "../../src/errors";
import { redactUrl, redactUrlInMessage } from "../../src/errors/redact-url";
import { everyChannel, leakingChannels } from "../../fixtures/channels";
import { mulberry } from "../../fixtures/responses";

/**
 * ROUND 23, LANE H3 — THE 4,163 ROWS, RUN THROUGH THE NEEDLE AT LAST.
 *
 * Round 22 named the most actionable item in this audit: `redaction-oracle.spec.ts`
 * builds its MESSAGE sweep from the input, so `replaceAll` removes the whole url
 * before `withoutUserinfos` runs and the sweep's 4,163 rows exercise the needle
 * pass on none of themselves. This round did the measurement rather than argue
 * it. The corpus below is that generator rebuilt inline — same axes, same seed,
 * same slices, and section 1 pins that it answers the same 4,163 rows — and it
 * is asked THREE quotings instead of one:
 *
 *   | quoting                          | rows | the needle decides |
 *   | -------------------------------- | ---- | ------------------ |
 *   | verbatim (the oracle's own)      | 4163 | 19                 |
 *   | the platform's fragment strip    | 4163 | 3830               |
 *   | the platform's re-serialization  | 3240 | 2593               |
 *
 * WHAT THE NEEDLE ANSWERS ON THEM IS CLEAN, in both directions and by the
 * oracle's own judge, which is rebuilt inline here too:
 *
 *  - not one credential the PARSER reports survives, on any row of any quoting;
 *  - the 139 answers the judge's PLANTED half still flags are two classes, and
 *    both are the judge's own bookkeeping rather than a leak: the generator
 *    writes its sentinel into a userinfo slot, and the caller's solidus count
 *    makes the URL Standard read that same text as the HOST — 134 where the
 *    parse accepted the host and 5 where a `file:` host state refused it. A
 *    record that dropped either would name a host the request never used;
 *  - the host the record names survives in the message on every row, and an
 *    unrelated diagnostic sentence carrying two ordinary `@` addresses comes
 *    back byte-identical on all 4,163.
 *
 * THE WIDENED JUDGE — `(rendered, secret, url)` — IS UNTESTABLE ON THAT CORPUS,
 * and section 2 is the reason: every sentinel the generator plants is ASCII
 * letters, so it has exactly one spelling and the wide judge is the raw judge on
 * all 7,986 asks. Re-spell the sentinels with the seven characters a URL parser
 * rewrites and the two come apart at once — 66,853 asks, 1,444 seen raw and
 * 2,046 seen wide — and every one of the 957 answers it sees alone carries a
 * REVERSE SOLIDUS. Which is how this round's finding was found: all 957 reach
 * `toJSON().url`, and section 3 reduces them to one shape.
 */

const BACKSLASH = String.fromCharCode(92);

/* -------------------------------------------------------------------------- */
/* THE ORACLE'S GENERATOR, REBUILT INLINE                                     */
/* -------------------------------------------------------------------------- */

const WHATWG_SPECIAL = ["http", "https", "ws", "wss", "ftp", "file"] as const;
const ORACLE_BASE = "http://oracle.invalid";

const USER = "USERSENTINELAA";
const PASS = "PASSSENTINELBB";
const QUERY = "QUERYSENTINELCC";
const FRAGMENT = "FRAGSENTINELDD";
const INNER_USER = "INNERUSERSENTEE";
const INNER_PASS = "INNERPASSSENTFF";
const OUTER_TAIL = "OUTERTAILSENTGG";
const SENTINELS = [USER, PASS, QUERY, FRAGMENT, INNER_USER, INNER_PASS, OUTER_TAIL] as const;

const SCHEMES = [...WHATWG_SPECIAL, "git", "svn+ssh", "data", "blob", ""] as const;
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
const PORTS = ["", ":8443", ":", ":99999", ":abc"] as const;
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
const EMBEDDED = [
  `https://${INNER_USER}:${INNER_PASS}@inner.test/x`,
  `http:${INNER_USER}:${INNER_PASS}@inner.test`,
  `git://${INNER_USER}:${INNER_PASS}@inner.test/x`,
  `git:/${INNER_USER}:${INNER_PASS}@inner.test`,
] as const;
const QUERIES = ["", `?t=${QUERY}`, `?a=1&b=${QUERY}`] as const;
const FRAGMENTS = ["", `#${FRAGMENT}`] as const;
const COMPOUND = [`x:/a@`, `${USER}:/`, `${USER}://`, `${USER}%3A/`, `x:/a@${USER}:`] as const;
const TAILS = ["/@bob", "/@", "/x/@bob", ""] as const;
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

const CANARY_USER = "CANARYUSERZZ";
const OPENING_CACHE = new Map<string, "userinfo" | "refused" | "none">();

/** Whether the URL Standard opens an authority at this scheme and solidus run. */
function authorityOpening(scheme: string, solidi: string): "userinfo" | "refused" | "none" {
  const key = `${scheme}|${solidi}`;
  const remembered = OPENING_CACHE.get(key);
  if (remembered !== undefined) return remembered;
  const probe = `${scheme === "" ? "" : `${scheme}:`}${solidi}${CANARY_USER}:CANARYPASSZZ@canary.test/v1`;
  let answer: "userinfo" | "refused" | "none";
  try {
    const parsed = scheme === "" ? new URL(probe, ORACLE_BASE) : new URL(probe);
    answer = parsed.username === CANARY_USER ? "userinfo" : "none";
  } catch {
    answer = "refused";
  }
  OPENING_CACHE.set(key, answer);
  return answer;
}

/** The sentinels this row writes into an authority the Standard opens. */
function plantedIn(scheme: string, solidi: string, userinfo: string): readonly string[] {
  if (authorityOpening(scheme, solidi) === "none") return [];
  const authority = userinfo.split(/[/\\?#]/)[0] ?? "";
  return SENTINELS.filter((sentinel) => authority.includes(sentinel));
}

interface Case {
  input: string;
  planted: readonly string[];
}

function pick<T>(list: readonly T[], random: () => number): T {
  const item = list[Math.floor(random() * list.length) % list.length];
  if (item === undefined) throw new Error("an axis was empty");
  return item;
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

function buildCorpus(): Case[] {
  const random = mulberry(SEED);
  const seen = new Map<string, Case>();
  const add = (one: Case): void => {
    if (!seen.has(one.input)) seen.set(one.input, one);
  };

  for (let taken = 0; taken < SAMPLE_SIZE; taken += 1) {
    add(
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
  // Slice A — scheme x solidus.
  for (const scheme of SCHEMES)
    for (const solidi of SOLIDI)
      add(compose(scheme, solidi, `${USER}:${PASS}@`, "api.test", "", "/v1", "", ""));
  // Slice B — solidus x userinfo.
  for (const solidi of SOLIDI)
    for (const userinfo of USERINFO)
      add(compose("https", solidi, userinfo, "api.test", "", "/v1", "", ""));
  // Slice C — userinfo x path.
  for (const userinfo of USERINFO)
    for (const path of PATHS) add(compose("https", "//", userinfo, "api.test", "", path, "", ""));
  // Slice D — solidus x embedded url as the FIRST component.
  for (const solidi of SOLIDI)
    for (const embedded of EMBEDDED) {
      add({ input: `${solidi}${embedded}`, planted: [] });
      add({ input: `https://api.test/proxy/${solidi}${embedded}`, planted: [] });
    }
  // Slice E — compound userinfo x trailing `/@name`.
  for (const prefix of COMPOUND)
    for (const tail of TAILS)
      for (const solidi of ["", "/", "//", "///", "\\\\"]) {
        add({ input: `https://api.test${solidi}${prefix}${PASS}://h.test${tail}`, planted: [] });
        add({ input: `${solidi}${prefix}${PASS}://h.test${tail}`, planted: [] });
      }
  // Slice F — scheme x solidus x refused authority.
  for (const scheme of SCHEMES)
    for (const solidi of ["", "/", "//", "///"])
      for (const [host, port] of REFUSED_AUTHORITIES)
        add(compose(scheme, solidi, `${USER}:${PASS}@`, host, port, "/v1", "", ""));
  // Slice G — scheme x solidus with a percent-encoded colon.
  for (const scheme of SCHEMES)
    for (const solidi of SOLIDI)
      add(compose(scheme, solidi, `${USER}%3A${PASS}@`, "api.test", "", "/v1", "", ""));

  return [...seen.values()];
}

const CORPUS = buildCorpus();

/* -------------------------------------------------------------------------- */
/* THE ORACLE'S JUDGE, REBUILT INLINE                                         */
/* -------------------------------------------------------------------------- */

function parseAbsolute(text: string): URL | null {
  try {
    return new URL(text);
  } catch {
    return null;
  }
}

function parseRelative(text: string): URL | null {
  try {
    return new URL(text, ORACLE_BASE);
  } catch {
    return null;
  }
}

function decodeOnce(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** The space containment is asked in: strippable characters out, decoded, lower. */
function normalized(text: string): string {
  return decodeOnce(text.replace(/[\t\r\n]/g, "")).toLowerCase();
}

const SCHEME_TOKEN = /[a-zA-Z][a-zA-Z0-9+.-]*:/g;
const SOLIDUS_PAIR = /[/\\][/\\]/g;

function matchIndexes(text: string, pattern: RegExp): number[] {
  const found: number[] = [];
  pattern.lastIndex = 0;
  for (let hit = pattern.exec(text); hit !== null; hit = pattern.exec(text)) {
    found.push(hit.index);
    if (found.length >= 16) break;
  }
  return found;
}

/** Every credential the PLATFORM finds anywhere in `input`. Never this file's opinion. */
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

function isDistinctive(credential: string): boolean {
  return credential.length >= 3;
}

/** The bytes STRUCTURE compels the answer to carry: the input's own origin. */
function mandatedOrigin(input: string): string {
  const parsed = parseAbsolute(input);
  return parsed ? `${parsed.protocol}//${parsed.host}` : "";
}

function withoutMandatedOrigin(input: string, output: string): string {
  const origin = mandatedOrigin(input);
  if (origin === "") return output;
  const at = output.indexOf(origin);
  return at === -1 ? output : output.slice(0, at) + output.slice(at + origin.length);
}

/** Which of this row's credentials survived in `output`. The empty list is the pass. */
function survivors(input: string, output: string, planted: readonly string[]): string[] {
  const haystack = normalized(withoutMandatedOrigin(input, output));
  const found: string[] = [];
  for (const credential of new Set([
    ...credentialsOf(input).filter(isDistinctive),
    ...planted.filter(isDistinctive),
  ])) {
    if (haystack.includes(normalized(credential))) found.push(credential);
  }
  return found;
}

/** The one platform sentence this module exists for, with a url quoted in it. */
function messageFor(quoted: string): string {
  return `Request cannot be constructed from a URL that includes credentials: ${quoted}`;
}

/** The platform never sends a fragment, so it quotes the url without one. */
function withoutFragment(url: string): string {
  const hash = url.indexOf("#");
  return hash < 0 ? url : url.slice(0, hash);
}

/**
 * THE WIDENED JUDGE'S INPUT — every spelling of `secret` that `url` can produce.
 *
 * Round 22 measured why this takes the url and not the secret alone: the `\`→`/`
 * fold is the SCHEME's, the tab/CR/LF removal is the WHOLE INPUT's, and the
 * percent-encode set is the SLOT's. None of the three is recoverable from the
 * secret's characters. The closure always contains the raw spelling, so the wide
 * judge answers a SUPERSET of the raw judge's list and no `toEqual([])` pin can
 * slide to a different non-empty value by adopting it.
 */
function spellingsOf(secret: string, url: string): string[] {
  const found = new Set<string>([secret]);
  const add = (text: string): void => {
    if (text.length >= 4) found.add(text);
  };
  const scheme = url.slice(0, url.indexOf(":") + 1).toLowerCase();
  if (["http:", "https:", "ws:", "wss:", "ftp:", "file:"].includes(scheme))
    add(secret.replaceAll(BACKSLASH, "/"));
  add(secret.replace(/[\t\r\n]/g, ""));
  try {
    add(new URL(`http://s.invalid/${secret}`).pathname.slice(1));
  } catch {
    /* a secret the path state refuses has no path spelling */
  }
  try {
    add(new URL(`http://${secret.replaceAll("@", "")}@s.invalid/`).username);
  } catch {
    /* likewise for the userinfo state */
  }
  return [...found];
}

/** The judge as `leakingChannels` would take it once widened: rendered, secret, url. */
function leakingChannelsWide(
  rendered: Record<string, string>,
  secret: string,
  url: string,
): string[] {
  return leakingChannels(rendered, spellingsOf(secret, url));
}

/**
 * The two channels a sweep this size can afford, and they are the two the record
 * is written through: `error.message`, which every log line carries, and
 * `toJSON()`, which is what a structured logger writes. Section 3 renders all
 * twenty-two for the shape it reports.
 */
function twoChannels(url: string, message: string): Record<string, string> {
  const error = new NetworkError(message, { url });
  return { "4 error.message": error.message, "1 toJSON": JSON.stringify(error.toJSON()) };
}

/** One credential the judge still finds in an answer, and what it turned out to be. */
interface Flagged {
  input: string;
  secret: string;
  /** `parser` is a leak. The other two are the judge's own bookkeeping. */
  kind: "parser" | "host" | "other";
}

/** The whole corpus swept at the platform's fragment-stripped quoting, once. */
function sweepTheFragmentStrippedQuote(): { moved: number; flagged: Flagged[] } {
  let moved = 0;
  const flagged: Flagged[] = [];
  for (const { input, planted } of CORPUS) {
    const message = messageFor(withoutFragment(input));
    const answer = redactUrlInMessage(message, input);
    if (answer !== message) moved += 1;
    const confirmed = new Set(credentialsOf(input).filter(isDistinctive));
    const host = (parseAbsolute(input) ?? parseRelative(input))?.host ?? "";
    for (const secret of survivors(input, answer, planted)) {
      // The generator wrote the sentinel into a userinfo slot; the caller's
      // solidus count made the URL Standard read that same text as the HOST,
      // which `redactUrl` must keep and which the message quotes in the caller's
      // spelling, so `withoutMandatedOrigin` cannot excise it positionally.
      const isHost = host !== "" && normalized(host).includes(normalized(secret));
      flagged.push({
        input,
        secret,
        kind: confirmed.has(secret) ? "parser" : isHost ? "host" : "other",
      });
    }
  }
  return { moved, flagged };
}

const FRAGMENT_STRIPPED = sweepTheFragmentStrippedQuote();

/* -------------------------------------------------------------------------- */
/* 1. THE 4,163 ROWS, ON THE NEEDLE ROUTE FOR THE FIRST TIME                  */
/* -------------------------------------------------------------------------- */

describe("the corpus the oracle grades, asked the question it never asked", () => {
  test("EVIDENCE: this is the oracle's own corpus, row for row", () => {
    // Same axes, same seed, same slices. A generator that drifted would make
    // every number below a claim about a different population.
    expect(CORPUS.length).toBe(4163);
    expect(new Set(CORPUS.map((one) => one.input)).size).toBe(4163);
  });

  test("EVIDENCE: the verbatim quote decides 4,145 of 4,163 rows before a needle runs", () => {
    // The class round 22 named, measured over the whole corpus rather than over
    // ten rows: the sweep quotes the input back verbatim, so `replaceAll`
    // removes the whole url and `withoutUserinfos` is handed a message with
    // nothing left in it to decide.
    //
    // MOVED BY ONE ROW IN ROUND 23, and the row is `http:/@/@alice?a=1&b=`
    // `QUERYSENTINELCC`. This read 4,144. R23-H3-01 makes `seamUserinfo`
    // forward the spill, so the record for that row goes from `/@/@alice` to
    // `/alice` — which is the answer the MESSAGE already gave. The row joins
    // this set because the two passes now agree on it, not because a needle
    // stopped firing, and the direction is the one R17-H3-02 exists to defend:
    // one failure, one host, two records that say the same thing. No row left
    // the set.
    //
    // AND THE TWO HALVES OF THE FIX PULL AGAINST EACH OTHER HERE, which is why
    // this is pinned as an exact count. Measured separately: the segment union
    // alone takes this to 4,140, because four rows gain a needle that moves
    // text the whole-url pass did not; the seam alone takes it to 4,145; the
    // two together are 4,145, because the seam removes from the record exactly
    // the text those four needles remove from the message. A round that lands
    // one half without the other lands on 4,140 or 4,145 and this says which.
    const decidedByReplaceAll = CORPUS.filter(({ input }) => {
      const message = messageFor(input);
      return redactUrlInMessage(message, input) === message.replaceAll(input, redactUrl(input));
    });

    expect(decidedByReplaceAll.length).toBe(4145);
  }, 60_000);

  test("the fragment-stripped quote hands 1,540 rows to the needle, and it leaks on none", () => {
    // THE MEASUREMENT ROUND 22 ASKED FOR. One character of the platform's own
    // quoting, and the needle pass decides 3,832 rows instead of 19 — including
    // 1,540 on which the whole-url pass cannot fire at all, because the message
    // does not spell the url. The judge is the oracle's, not this file's, and
    // its verdict is that no credential the PARSER reports survives on any row.
    //
    // `needleMoved` MOVED BY TWO IN ROUND 23, from 3,830, and R23-H2-01 alone
    // moves it — measured against each half of the fix separately, the seam's
    // spill moves this count not at all. `hiddenUserinfos` emits a path span
    // AND its segments now, so two `data:` rows whose message the pass used to
    // leave byte-identical lose their embedded credential: `data:////USER…AA:/`
    // `PASS…BB@ünïcode.test:abc/go/git:/INNERUSERSENTEE:INNERPASSSENTFF@`
    // `inner.test` answers `data:////USER…AA:/ünïcode.test:abc/go/git:/`
    // `inner.test`. Two rows joined and none left.
    //
    // THE THREE GUARDED COUNTS DID NOT MOVE, and they are the reason this test
    // exists rather than the count that did. `parser` is the leak axis and it
    // is still the empty ARRAY, so a failure names the row; `host` at 134 and
    // `other` at 5 are the judge's own bookkeeping, and the next test names all
    // five of the `other`. A change that bought `needleMoved` with one row of
    // `parser` turns this red on the axis that matters.
    const handedToTheNeedle = CORPUS.filter(({ input }) => withoutFragment(input) !== input).length;
    const kinds = FRAGMENT_STRIPPED.flagged.map((one) => one.kind);

    expect({
      handedToTheNeedle,
      needleMoved: FRAGMENT_STRIPPED.moved,
      parser: FRAGMENT_STRIPPED.flagged.filter((one) => one.kind === "parser"),
      host: kinds.filter((kind) => kind === "host").length,
      other: kinds.filter((kind) => kind === "other").length,
    }).toEqual({
      handedToTheNeedle: 1540,
      needleMoved: 3832,
      parser: [],
      host: 134,
      other: 5,
    });
  });

  test("the five that are not the host are a `file:` authority the parser refused", () => {
    // The remainder of the 139, named rather than counted. Each is a `file:` url
    // over two solidi, where the URL Standard's file host state reads the text
    // the generator planted as the HOST and then REFUSES it — so the parse
    // answers nothing, `redactUrl` answers its documented empty string, and the
    // sentinel is left in the caller's own spelling of a host slot. The platform
    // reports no credential by that name on any of the five.
    const other = FRAGMENT_STRIPPED.flagged.filter((one) => one.kind === "other");

    expect({
      rows: other.length,
      allRefused: other.every((one) => parseAbsolute(one.input) === null),
      allFile: other.every((one) => one.input.startsWith("file:")),
      allTheHostSlot: other.every((one) => one.secret === USER),
      records: [...new Set(other.map((one) => redactUrl(one.input)))],
      neverACredential: other.every((one) => !credentialsOf(one.input).includes(one.secret)),
    }).toEqual({
      rows: 5,
      allRefused: true,
      allFile: true,
      allTheHostSlot: true,
      records: [""],
      neverACredential: true,
    });
  });

  test("the platform's re-serialized quote reaches the rows a fragment strip cannot", () => {
    // The second quoting `redactUrlInMessage` names as its own best-effort
    // limit: "a platform that re-serializes the URL before putting it in its
    // message defeats the exact-string replacement". It reaches 3,240 quotes,
    // 2,599 of which the needle moves, and it leaks on none of them.
    //
    // `needleMoved` MOVED BY SIX IN ROUND 23, from 2,593, and R23-H3-01 alone
    // moves it — measured against each half separately, the segment union moves
    // this count not at all. That is the opposite attribution from the
    // fragment-stripped sweep above, and the pair is the point: the two halves
    // of the fix reach this corpus through different quotings.
    //
    // The six are THREE INPUTS, each counted under both re-serialized quotes
    // because the parser's `href` carries no fragment for the second to strip.
    // All three are one shape — `https://api.test\\USERSENTINELAA%3A/`
    // `PASSSENTINELBB://h.test/@bob`, an authority the caller's `\` spilled into
    // the path — and the seam now reads it, so the answer is
    // `https://api.test//bob`. Three inputs joined and none left.
    //
    // `leaked` IS THE GUARDED EMPTY, and it stays an ARRAY so a failure names
    // the input and the secret rather than a count. `quotes` is the
    // non-vacuity floor beside it: a corpus that stopped re-serializing would
    // report an empty `leaked` too.
    let quotes = 0;
    let needleMoved = 0;
    const leaked: string[] = [];
    for (const { input, planted } of CORPUS) {
      const parsed = parseAbsolute(input);
      if (parsed === null) continue;
      for (const quoted of [parsed.href, withoutFragment(parsed.href)]) {
        if (quoted === input) continue;
        quotes += 1;
        const message = messageFor(quoted);
        const answer = redactUrlInMessage(message, input);
        if (answer !== message) needleMoved += 1;
        const confirmed = new Set(credentialsOf(input).filter(isDistinctive));
        for (const secret of survivors(input, answer, planted))
          if (confirmed.has(secret)) leaked.push(`${JSON.stringify(input)} -> ${secret}`);
      }
    }

    expect({ quotes, needleMoved, leaked }).toEqual({
      quotes: 3240,
      needleMoved: 2599,
      leaked: [],
    });
  }, 60_000);

  test("and the other direction: the record's host stays, and a diagnostic is untouched", () => {
    // A leak assertion is blind to an over-redaction fix, which is round 22's
    // second result, so the same sweep is asked the opposite question. The
    // message must still NAME the host the record names — two records of one
    // failure naming different hosts is R17-H3-02 — and a sentence the url has
    // nothing to do with must come back byte-identical.
    const TAIL = "; while contacting ops@example.test over https://cdn.test/u/bob@example.test";
    const lostHost: string[] = [];
    const damagedTail: string[] = [];
    for (const { input } of CORPUS) {
      const record = parseAbsolute(redactUrl(input));
      const answer = redactUrlInMessage(messageFor(withoutFragment(input)) + TAIL, input);
      // An IDN host is punycode in the record and unicode in the caller's
      // quoting, which is a spelling difference and not a loss.
      const punycoded = record !== null && record.host.includes("xn--") && !input.includes("xn--");
      if (
        record !== null &&
        !punycoded &&
        record.host.length >= 3 &&
        !normalized(answer).includes(normalized(record.host))
      )
        lostHost.push(`${JSON.stringify(input)} lost ${record.host}`);
      if (!answer.endsWith(TAIL)) damagedTail.push(JSON.stringify(input));
    }

    expect({ lostHost, damagedTail }).toEqual({ lostHost: [], damagedTail: [] });
  }, 60_000);
});

/* -------------------------------------------------------------------------- */
/* 2. THE WIDENED JUDGE, AND THE CORPUS THAT CANNOT EXERCISE IT               */
/* -------------------------------------------------------------------------- */

describe("the widened judge, over every corpus this lane can reach", () => {
  test("EVIDENCE: on the oracle's corpus the wide judge IS the raw judge", () => {
    // And the reason is the corpus, not the judge. Every sentinel the generator
    // plants is ASCII letters, so no fold, no strip and no percent-encode set
    // rewrites one — `spellingsOf` answers the singleton on all of them, and
    // 7,986 asks separate the two judges nowhere. A judge is worth exactly the
    // corpus it is asked about.
    let asked = 0;
    let differ = 0;
    for (const { input, planted } of CORPUS) {
      const secrets = new Set([...credentialsOf(input), ...planted].filter(isDistinctive));
      if (secrets.size === 0) continue;
      const rendered = twoChannels(input, messageFor(withoutFragment(input)));
      for (const secret of secrets) {
        asked += 1;
        const raw = leakingChannels(rendered, [secret]);
        if (leakingChannelsWide(rendered, secret, input).length !== raw.length) differ += 1;
      }
    }

    expect({ asked, differ }).toEqual({ asked: 7986, differ: 0 });
  }, 120_000);

  test("re-spell the sentinels and the wide judge sees nothing the raw judge does not", () => {
    // THIS TEST CHARACTERIZED R23-H3-01 AND NOW PINS ITS CLOSURE, INVERTED. It
    // read `it sees 957 answers the raw judge does not`, and those 957 were the
    // finding: `widerBy` was `957` on the reverse solidus and `0` on the other
    // six, and `alsoInTheRecord` was 957 — every one of them in `toJSON().url`
    // as well as in the message. `seamUserinfo` now forwards the spill to
    // `seamSpan`, the credential leaves the record and the message together, and
    // both counts are zero.
    //
    // THE ZEROS ARE THE ASSERTION AND THEY ARE WRITTEN THE WIDE WAY ROUND. The
    // same 4,163 rows are still swept with each of the seven characters a parser
    // rewrites planted INSIDE every sentinel, and `widerBy` still reports all
    // seven axes rather than the one that fired — so this goes red the moment
    // ANY delimiter makes the wide judge wider, and specifically the moment the
    // reverse-solidus class reappears. `alsoInTheRecord` is the second half:
    // it goes red if such an answer reaches `toJSON().url`, which is the record
    // `SECURITY.md` names, whatever the message does.
    //
    // WHY THE `\` WAS THE ONE THAT FIRED, kept because it says what a return
    // would look like. A space, a tab, `|`, `é`, `<` and `^` are percent-encoded
    // inside a slot and a message quotes the caller's spelling of that slot; the
    // reverse solidus is FOLDED, which rewrites the URL's STRUCTURE rather than
    // a value, and that is the rewrite a judge holding the secret alone cannot
    // follow.
    //
    // `asked` AND `rawSaw` ARE THE NON-VACUITY, and both are pinned exactly. A
    // corpus that stopped planting sentinels would report the same two zeros. It
    // was `rawSaw` 1,444 and `wideSaw` 2,046; the two are equal now, so the wide
    // judge and the raw judge answer alike on every one of the 66,853 asks. The
    // move is a strict subset in both: 529 asks left the raw judge and 1,131
    // left the wide one, and NOT ONE ask joined either.
    //
    // AND IT TAKES BOTH HALVES OF THE FIX TO REACH 915. Measured separately,
    // R23-H2-01 alone leaves the class untouched at `widerBy` 957 while pulling
    // `rawSaw` to 1,270; R23-H3-01 alone closes the class but pulls `rawSaw` UP
    // to 1,495. Only the two together are below where the round started, which
    // is the ordering claim this file makes about the two fixes.
    const DELIMITERS = [" ", "\t", "|", "é", "<", "^", BACKSLASH] as const;
    let asked = 0;
    let rawSaw = 0;
    let wideSaw = 0;
    let alsoInTheRecord = 0;
    const widerBy: Record<string, number> = {};
    for (const delimiter of DELIMITERS) {
      widerBy[JSON.stringify(delimiter)] = 0;
      const respell = (text: string): string =>
        text
          .replaceAll(USER, `USER${delimiter}SENTINELAA`)
          .replaceAll(PASS, `PASS${delimiter}SENTINELBB`)
          .replaceAll(INNER_USER, `INNER${delimiter}USERSENTEE`)
          .replaceAll(INNER_PASS, `INNER${delimiter}PASSSENTFF`);
      for (const one of CORPUS) {
        const input = respell(one.input);
        const secrets = new Set(
          [...credentialsOf(input), ...one.planted.map(respell)].filter(isDistinctive),
        );
        if (secrets.size === 0) continue;
        const rendered = twoChannels(input, messageFor(withoutFragment(input)));
        for (const secret of secrets) {
          asked += 1;
          const raw = leakingChannels(rendered, [secret]);
          const wide = leakingChannelsWide(rendered, secret, input);
          if (raw.length > 0) rawSaw += 1;
          if (wide.length > 0) wideSaw += 1;
          if (wide.length > raw.length) {
            widerBy[JSON.stringify(delimiter)] = (widerBy[JSON.stringify(delimiter)] ?? 0) + 1;
            if (leakingChannelsWide({ url: redactUrl(input) }, secret, input).length > 0)
              alsoInTheRecord += 1;
          }
        }
      }
    }

    expect({ asked, rawSaw, wideSaw, alsoInTheRecord, widerBy }).toEqual({
      asked: 66_853,
      rawSaw: 915,
      wideSaw: 915,
      alsoInTheRecord: 0,
      widerBy: {
        '" "': 0,
        '"\\t"': 0,
        '"|"': 0,
        '"é"': 0,
        '"<"': 0,
        '"^"': 0,
        '"\\\\"': 0,
      },
    });
  }, 300_000);
});

/* -------------------------------------------------------------------------- */
/* 3. R23-H3-01 — A SPILLED AUTHORITY THE SEAM WILL NOT READ                  */
/* -------------------------------------------------------------------------- */

/**
 * R20-H4-08 named this class and round 20 closed one solidus of it. Every one of
 * the six hierarchical schemes is SPECIAL, so the authority state ends on `\`
 * exactly as it ends on `/`: `https://CORP\alice:hunter2@api.test/v1` parses with
 * the host `corp`, no userinfo, and the path `/alice:hunter2@api.test/v1`.
 * `spilledAuthority` reads the raw url, the seam is asked, and `alice:hunter2@`
 * goes from the record and from the message.
 *
 * WRITE THE SECOND `\` AND IT STAYS. The parser folds that one into a `/` too,
 * so the spilled text now spells a segment boundary the caller never typed:
 * `https://CORP\alice\service:hunter2@api.test/v1` has the pathname
 * `/alice/service:hunter2@api.test/v1`. `seamUserinfoEnd` reads to
 * `authorityEnd`, which stops at the folded solidus; it finds no `@` in front of
 * it and hands the question to `spellsCredentialHead`, which answers about the
 * FIRST segment only — and `alice` holds no colon. The fallback is refused, the
 * seam answers `null`, and no other reader covers the text: `service:` is not a
 * hierarchical scheme, so the region scan opens nothing under one solidus.
 *
 * Everything in front of the first `/` the caller typed is authority text they
 * wrote, and `service:hunter2@api.test` comes back in `toJSON().url` — the record
 * `SECURITY.md` names — and in every render of the message.
 *
 * NOT THE DOCUMENTED RESIDUAL. `SECURITY.md` scopes its `\` exception to "a
 * reverse solidus under a scheme the URL Standard does not call special", and
 * these are the special ones; its `file:` bullet describes the colon fallback as
 * the thing that WITHHOLDS the credential and names the Windows drive letter as
 * the single carve-out. A first segment with no colon at all is neither.
 *
 * AND THE PARSER REPORTS NO CREDENTIAL HERE, which is the same evidence standard
 * R20-H4-08 was filed under: `new URL(url).username` is the empty string for the
 * one-solidus url too, and the module removes that one.
 *
 * CLOSED, and the two paragraphs above are the state before it. `seamUserinfo`
 * forwards the SPILL to `seamSpan`, so the fallback needs no evidence from a
 * path that cannot carry any: the caller wrote every character in front of the
 * first `/` they typed as authority. The colon question stays exactly where
 * round 20 put it for every url that spilled nothing, which is what keeps the
 * Windows drive letter — section 4 pins that trade from the other side. The
 * tests below were written to go green on the fix and are the regression guard
 * now.
 */
describe("R23-H3-01 — two reverse solidi in one authority, and the credential goes", () => {
  const SPILLED = `https://CORP${BACKSLASH}alice${BACKSLASH}service:hunter2@api.test/v1`;

  test("EVIDENCE: one reverse solidus is the shape round 20 closed", () => {
    // The non-vacuity control, and the whole width of the difference: one
    // character added to the same url, and the credential stops being removed.
    const closed = `https://CORP${BACKSLASH}alice:hunter2@api.test/v1`;

    expect(new URL(closed).username).toBe("");
    expect(new URL(closed).pathname).toBe("/alice:hunter2@api.test/v1");
    expect(redactUrl(closed)).toBe("https://corp/api.test/v1");
  });

  test("EVIDENCE: the parser reads the second one as a segment boundary", () => {
    expect(new URL(SPILLED).host).toBe("corp");
    expect(new URL(SPILLED).username).toBe("");
    expect(new URL(SPILLED).pathname).toBe("/alice/service:hunter2@api.test/v1");
  });

  test("the password reaches no channel", () => {
    const message = messageFor(SPILLED);

    expect(
      leakingChannels(everyChannel(new NetworkError(message, { url: SPILLED })), ["hunter2"]),
      "the authority ends at the FIRST `\\`, so everything the caller wrote in " +
        "front of the first `/` they typed is authority text. The seam reads to " +
        "`authorityEnd`, which stops at the SECOND folded `\\`, finds no `@` in " +
        "front of it, and refuses the fallback because `alice` holds no colon",
    ).toEqual([]);
  });

  test("and `toJSON().url`, the record a structured logger writes, does not carry it", () => {
    expect(redactUrl(SPILLED)).not.toContain("hunter2");
  });

  test("and the class is every special scheme, over a grid the one-solidus form leaves clean", () => {
    // A disclosure decision applies to the class. Five special schemes, three
    // spellings of the authority mark, four spellings of the folded break and
    // three password shapes — 180 rows, none of them a documented residual. The
    // same grid with ONE reverse solidus is the control that keeps this from
    // being vacuous, and it is empty.
    const schemes = ["https", "http", "ws", "wss", "ftp"] as const;
    const marks = ["//", "/\\", `\\${BACKSLASH}`] as const;
    const breaks = [BACKSLASH, `${BACKSLASH}x${BACKSLASH}`, `\t${BACKSLASH}`, `${BACKSLASH}%2e`];
    const secrets = ["service:hunter2", "svc:hun ter2", "hunter2"] as const;
    const reaches = (url: string): boolean =>
      leakingChannels(everyChannel(new NetworkError(messageFor(url), { url })), ["hunter2"])
        .length > 0 || redactUrl(url).includes("hunter2");

    let rows = 0;
    let leaking = 0;
    let control = 0;
    let firstLeak = "";
    for (const scheme of schemes)
      for (const mark of marks)
        for (const broken of breaks)
          for (const secret of secrets) {
            rows += 1;
            if (reaches(`${scheme}:${mark}CORP${BACKSLASH}alice${broken}${secret}@api.test/v1`)) {
              leaking += 1;
              if (firstLeak === "")
                firstLeak = `${scheme}: ${JSON.stringify(mark)} ${JSON.stringify(broken)}`;
            }
            if (reaches(`${scheme}:${mark}CORP${BACKSLASH}${secret}@api.test/v1`)) control += 1;
          }

    expect({ rows, control, leaking, firstLeak }).toEqual({
      rows: 180,
      control: 0,
      leaking: 0,
      firstLeak: "",
    });
  }, 60_000);
});

/* -------------------------------------------------------------------------- */
/* 4. THE FIFTH REVERT — the edit round 22's ledger cannot see                */
/* -------------------------------------------------------------------------- */

/**
 * `redaction-sentinel-ledger.spec.ts` pins twelve rows as exact text AND exact
 * channel membership, and each of the four reverts rounds 21 and 22 measured
 * moves at least one of them. This asks the sharper question round 23 was given:
 * is there a plausible FUTURE edit that it does not catch?
 *
 * THERE IS, AND IT IS THE NAIVE FIX FOR SECTION 3. `spellsCredentialHead` refuses
 * the seam's fallback where the first path segment holds no colon; letting it
 * through closes R23-H3-01 in one character. It also takes the head off every
 * ordinary path, which is the over-redaction the colon exists to prevent:
 * `file:///Users/alice@corp/report.pdf` would emit `file:///corp/report.pdf`, a
 * path the request never used and a record whose only remaining segments come
 * from the far side of an `@`.
 *
 * NOT ONE OF THE TWELVE ROWS CAN SEE THAT EDIT, and the reading below is why
 * rather than the claim. The arm decides an answer only where a seam is asked at
 * all, the first segment holds no colon, the primary read finds no `@` before
 * `authorityEnd`, and a later `@` exists to fall back to. Every ledger row fails
 * at least one of the four; the two rows here meet all four, in opposite
 * directions, and they are the next pin.
 */
describe("the fifth revert, and the rows that would catch it", () => {
  /** Where the caller's own authority ended, so a `\` sitting there is a spill. */
  function spillsIntoThePath(url: string): boolean {
    let at = url.indexOf(":") + 1;
    while (at < url.length && (url[at] === "/" || url[at] === BACKSLASH)) at += 1;
    while (at < url.length && !`/${BACKSLASH}?#`.includes(url[at] ?? "")) at += 1;
    return url[at] === BACKSLASH;
  }

  /** Does `spellsCredentialHead`'s colon test DECIDE this url's seam answer? */
  function theColonArmDecides(url: string): boolean {
    const parsed = parseAbsolute(url);
    if (parsed === null) return false;
    // There is a seam only under a hierarchical scheme, and only where this url
    // has no authority of its own or the caller's spilled into the path.
    const scheme = parsed.protocol.slice(0, -1) as (typeof WHATWG_SPECIAL)[number];
    if (!WHATWG_SPECIAL.includes(scheme)) return false;
    if (parsed.host !== "" && !spillsIntoThePath(url)) return false;
    const path = parsed.pathname;
    let from = 0;
    while (path[from] === "/") from += 1;
    let term = from;
    while (term < path.length && !`/${BACKSLASH}?#`.includes(path[term] ?? "")) term += 1;
    // The primary read answers, so the fallback is never asked.
    if (path.lastIndexOf("@", term - 1) > from) return false;
    // And there is nothing later to fall back to.
    if (path.lastIndexOf("@") <= from) return false;
    return !path.slice(from, term).includes(":");
  }

  test("no row of round 22's ledger reaches the arm", () => {
    const LEDGER = [
      `file:svc:hun ter2@api.test/v1#anchor`,
      `htt\tps:/svc:hun ter2@api.test/v1#anchor`,
      `https:/\t/svc:hunter2@api.test/v1#anchor`,
      `https://api.test/go/https://svc:hunter2@/cdn.test/v1#anchor`,
      `git:svc:hunter2@api.test:8443/go/https://u:hunter2@cdn.test/v1#anchor`,
      `git:///svc:hunter2@api.test/v1#anchor`,
      `file:///svc:hun${BACKSLASH}ter2@api.test/v1#anchor`,
      "mailto:alice@example.com",
      "sip:alice@example.com",
      `https://alice@svc:hunter2@api.test/v1#anchor`,
      `file:///x@./alice:hunter2@internal.test/v1#anchor`,
      `https://api.test/v1?next=https://u:hunter2@cdn.test/v1#anchor`,
    ];

    expect(LEDGER.filter(theColonArmDecides)).toEqual([]);
  });

  test("EVIDENCE: the two rows that do reach it, one in each direction", () => {
    // The leak the widening would close, and the ordinary path it would eat.
    const spilled = `https://CORP${BACKSLASH}alice${BACKSLASH}service:hunter2@api.test/v1`;
    const windows = "file:///Users/alice@corp/report.pdf";

    expect([theColonArmDecides(spilled), theColonArmDecides(windows)]).toEqual([true, true]);
    expect(redactUrl(windows)).toBe(windows);
  });
});
