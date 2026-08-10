import { describe, expect, test } from "vitest";
import { NetworkError, NotFoundError } from "../../src/errors";
import { redactUrl, redactUrlInMessage } from "../../src/errors/redact-url";
import { userinfoSpans } from "../../src/errors/userinfo-spans";
import { everyChannel, leakingChannels } from "../../fixtures/channels";
import { responseWith } from "../../fixtures/responses";

/**
 * ROUND 18, LANE H3 — what round 17's fix opened, and what its judge cannot see.
 *
 * Round 17 suppressed `looksLikeUserinfo`'s colon rule where the parser reads
 * the region's pre-solidus text as host and port. The suppression fires under
 * THREE conditions, and this file asks the only question a hostile input asks
 * of a condition: can the text choose which side of it to land on?
 *
 * IT CAN, WITH ONE CHARACTER, AND THE CHARACTER CARRIES NO VALUE. `:@` is an
 * empty userinfo, and the URL Standard erases it —
 * `new URL("https://:@cdn.test/users/@alice").href` IS
 * `https://cdn.test/users/@alice`, the same normalisation round 13 recorded for
 * the seam. Those two spellings are ONE url, and the module answers them
 * differently: the control keeps every segment it names, and the `:@` spelling
 * emits `https://api.test/go/https://alice` — the handle named as a host,
 * `cdn.test` gone. That is R17-H3-01 restored by a character the platform
 * throws away, and it needs no port at all. R18-H3-01.
 *
 * The mechanism is both conditions failing in turn, on one region:
 *
 *  - AT THE REGION'S OPENING the authority text holds an `@`, so the second
 *    condition refuses. The `:` of `:@` also supplies the colon the colon rule
 *    reads, so a region that had no colon at all now has one.
 *  - AFTER THE CURSOR STEPS PAST THAT `@` the first condition refuses too,
 *    because `readsAsHostAndPort` reads the mark IN FRONT OF THE CURSOR and the
 *    cursor now sits behind the `@` the same region has just answered for. The
 *    region's opening `://` is no longer the mark the question sees.
 *
 * Both readings are of the CURSOR where the fix's own justification is about
 * the REGION — "behind `https://`, `https:/`, or `git://`, `cdn.test:8443` is an
 * authority someone wrote". The region is still behind `https://`. Section 3
 * exhibits a predicate that separates the four families from the two pinned
 * answers, so this is a fix that closed one spelling, not an undecidable shape.
 *
 * WHAT ELSE THIS LANE DID, and did not find a defect in:
 *
 *  - THE DIFFERENTIAL (section 6). Round 17's "1,823 answers changed, zero
 *    planted credentials newly surviving" is not reproducible — nothing commits
 *    its 651,604 urls — so this file draws its own and re-derives the safety
 *    half exactly. The suppression cannot fire on a region whose authority text
 *    holds an `@`, and a credential the PARSER reports lives behind exactly such
 *    an `@`. So no parser-reported credential can newly survive, by the second
 *    condition rather than by a count. What DOES newly survive is a path segment
 *    behind an embedded authority the parser reads — `SECURITY.md`'s
 *    path-segment residual, which the pre-fix tree removed by accident.
 *  - THE THIRD JUDGE (section 4). Round 17's two axes ask whether a host moved
 *    and whether a credential survived WHOLE. Three axes are added here —
 *    TRANSFORMED, PARTIAL, MOVED — and the one that fires is TRANSFORMED: 9,258
 *    rows of 86,880 emit the secret in the spelling the URL parser writes for it
 *    (`\` folded to `/`, a tab removed, a space as `%20`) while a raw substring
 *    search says it was removed. Not a leak the library causes — the same
 *    survival is there under the plain spelling, measured at 0 of 9,258 — but
 *    every removal count in this audit, and every `leakingChannels` sentinel,
 *    is a raw substring test.
 *  - THE MESSAGE PASS (section 5). Round 17's stated cost is confirmed word for
 *    word across the channel set, and it is not larger.
 *  - THE NAMED GAP (section 7). 504 rows of 97,344 with no credential lost,
 *    confirmed exactly, and all 504 fail the FIRST condition, so the ledger's
 *    attribution to the bare-`//` region is right. What is not right is that the
 *    residue is costless: 414 of the 504 are condemned by the calibrated
 *    over-redaction judge and 360 of those are urls the platform parses
 *    absolutely. R18-H3-02.
 *
 * NOT RE-REPORTED: RES-1 through RES-6 — RES-6 is decided and this file does
 * not reopen it — `showHidden`, `console.dir` with `cause`, the
 * accessor-pollution guard shape, and the round-16 pollution and header sweeps.
 *
 * A disclosure decision applies to the CHANNEL SET, so every sentinel here goes
 * through `everyChannel` in `fixtures/channels.ts`.
 */

/* -------------------------------------------------------------------------- */
/* 1. THE GENERATOR, COMMITTED                                                */
/* -------------------------------------------------------------------------- */

/**
 * The secret this lane plants. Distinctive on purpose: section 4 measures
 * FRAGMENTS of it, so a body that collides with a structural token — `8443`
 * does, against the `:8443` the token list spells — turns a substring hit into
 * a measurement of the generator rather than of the module.
 */
const SECRET = "PWSENTINEL18";

/**
 * POPULATION A — the condition cross product.
 *
 * One axis per condition of round 17's suppression, so a row exists on both
 * sides of each. `USERINFO` is the axis this lane adds and the one round 17's
 * corpus has no column for: an empty userinfo under both spellings, a
 * username-only one, and a full credential. `AUTHORITY` carries a port the
 * parser reads, a port it refuses, an IPv6 literal, and a label that is not a
 * host at all.
 */
const OUTER = ["https://api.test", "http://api.test:8443", "https://api.test/v1", ""] as const;
const MIDDLE = ["/go/", "/a/b/", "//", "/"] as const;
const OPENER = [
  "https://",
  "https:/",
  "https:",
  "//",
  "ftp://",
  "zz://",
  "://",
  "HTTPS://",
] as const;
const USERINFO = ["", "@", ":@", "u@", `svc:${SECRET}@`] as const;
const AUTHORITY = [
  "cdn.test",
  "cdn.test:8443",
  "cdn.test:99999",
  "[::1]:8443",
  "127.0.0.1:0",
  "svc:8443",
  "YWxpY2U",
] as const;
const TAIL = [
  "/users/@alice",
  "/img/alice@example.com/a.png",
  "/v1",
  `/${SECRET}/@internal.test/v1`,
  "/a/b@c/d",
  "/",
] as const;
const SUFFIX = ["", "?q=a@b", "#f@g"] as const;

function conditionUrls(): string[] {
  const seen = new Set<string>();
  for (const outer of OUTER) {
    for (const middle of MIDDLE) {
      for (const opener of OPENER) {
        for (const userinfo of USERINFO) {
          for (const authority of AUTHORITY) {
            for (const tail of TAIL) {
              for (const suffix of SUFFIX) {
                seen.add(`${outer}${middle}${opener}${userinfo}${authority}${tail}${suffix}`);
              }
            }
          }
        }
      }
    }
  }
  return [...seen];
}

/** xorshift32, the seed generator every round of this audit has used. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}

/**
 * POPULATION B — concatenated tokens with one credential spliced in.
 *
 * The token list is round 15's with three columns added for this lane: `u@`
 * and `:@`, which are the userinfo spellings the condition cross product
 * isolates, and `:99999`, a port the parser refuses. The BODIES list is what
 * section 4 needs: a plain secret, one that spells a solidus, one that spells a
 * backslash the parser folds INTO a solidus, one broken by a tab the parser
 * removes, and one holding a space the parser percent-encodes.
 */
const TOKENS = [
  "/",
  "//",
  "///",
  "\\",
  "\\\\",
  ":",
  "://",
  ":/",
  "@",
  "svc:",
  "@bob",
  "u@",
  ":@",
  "http:",
  "https:",
  "ws:",
  "ftp:",
  "file:",
  "git:",
  "zz:",
  ".",
  "..",
  "%2e",
  "%40",
  "%3A",
  "a",
  "x",
  "h.test",
  "internal.test",
  "cdn.test",
  "localhost",
  "127.0.0.1",
  "[::1]",
  ":8443",
  ":0",
  ":99999",
  "?",
  "#",
  "?q=",
  "#f",
  "\t",
  "\n",
  "\r",
  " ",
  "%2f",
  "|",
] as const;

const BODIES = [SECRET, `${SECRET}/x`, `${SECRET}\\x`, "PW\tSENT18", "PW SENT18"] as const;

interface Planted {
  url: string;
  secret: string;
}

function credentialUrls(seed: number, count: number): Planted[] {
  const random = seeded(seed);
  const out: Planted[] = [];
  for (let made = 0; made < count; made += 1) {
    const secret = BODIES[Math.floor(random() * BODIES.length)]!;
    const pieces = 2 + Math.floor(random() * 10);
    const at = Math.floor(random() * (pieces + 1));
    let url = "";
    for (let piece = 0; piece < pieces; piece += 1) {
      if (piece === at) url += `svc:${secret}@`;
      url += TOKENS[Math.floor(random() * TOKENS.length)]!;
    }
    if (at === pieces) url += `svc:${secret}@internal.test/v1`;
    out.push({ url, secret });
  }
  return out;
}

/** The two populations this lane draws, as one list. */
function drawn(): Planted[] {
  return [
    ...conditionUrls().map((url) => ({ url, secret: SECRET })),
    ...credentialUrls(0x18a17d, 60_000),
  ];
}

/**
 * ROUND 17's TWO POPULATIONS, reproduced exactly so section 7 can confirm a
 * number this file did not draw. The seed, the alphabet, and every cross-product
 * axis are copied from `round17-h3-disclosure.spec.ts`; importing that file
 * would declare its three thousand tests a second time.
 */
const R17_PASSWORD = "ZQ7XKPWV";

const R17_TOKENS = [
  "/",
  "//",
  "///",
  "\\",
  "\\\\",
  ":",
  "://",
  ":/",
  "@",
  "svc:",
  "@bob",
  `svc:${R17_PASSWORD}@`,
  "http:",
  "https:",
  "ws:",
  "wss:",
  "ftp:",
  "file:",
  "git:",
  "zz:",
  "HTTPS:",
  "FiLe:",
  ".",
  "..",
  "%2e",
  "%2E%2E",
  "%2f",
  "%3A",
  "%40",
  "%5C",
  "|",
  "c|",
  "a",
  "b",
  "x",
  "h.test",
  "internal.test",
  "localhost",
  "127.0.0.1",
  "[::1]",
  ":8443",
  ":443",
  ":0",
  "?",
  "#",
  "?q=",
  "#f",
  "\t",
  "\n",
  "\r",
  "\0",
  " ",
  "\v",
  "\f",
  "%2e%2e",
  "é",
  "／",
  "：",
] as const;

function r17CredentialUrls(seed: number, count: number): string[] {
  const random = seeded(seed);
  const out: string[] = [];
  for (let made = 0; made < count; made += 1) {
    const pieces = 2 + Math.floor(random() * 10);
    const at = Math.floor(random() * (pieces + 1));
    let url = "";
    for (let piece = 0; piece < pieces; piece += 1) {
      if (piece === at) url += `svc:${R17_PASSWORD}@`;
      url += R17_TOKENS[Math.floor(random() * R17_TOKENS.length)]!;
    }
    if (at === pieces) url += `svc:${R17_PASSWORD}@internal.test/v1`;
    out.push(url);
  }
  return out;
}

const R17_OUTER = ["https://api.test", "http://api.test:8443", "https://api.test/v1", ""] as const;
const R17_MIDDLE = ["/proxy/", "/go/", "/a/b/", "//"] as const;
const R17_OPENER = [
  "https://",
  "http://",
  "//",
  "ftp://",
  "https:/",
  "https:",
  "HTTPS://",
  "wss://",
] as const;
const R17_CREDENTIAL = ["", "svc:hunter2@"] as const;
const R17_AUTHORITY = [
  "cdn.test",
  "cdn.test:8443",
  "127.0.0.1",
  "[::1]",
  "xn--n3h.test",
  "localhost",
  "cdn.test:0",
  "YWxpY2U",
] as const;
const R17_TAIL = [
  "/img/alice@example.com/avatar.png",
  "/u/bob@example.com",
  "/mail/alice@example.com",
  "/a/b@c/d",
  "/img/@alice",
  "/users/@alice/photo",
  "/v1/things",
  "/",
  "",
  "/x/y@z",
  "/@alice",
  "/a/./b@c",
  "/a/../b@c",
  "/deep/a/b/c@d/e",
] as const;
const R17_SUFFIX = ["", "?q=a@b"] as const;

function r17StructuredUrls(): string[] {
  const seen = new Set<string>();
  for (const outer of R17_OUTER) {
    for (const middle of R17_MIDDLE) {
      for (const opener of R17_OPENER) {
        for (const credential of R17_CREDENTIAL) {
          for (const authority of R17_AUTHORITY) {
            for (const tail of R17_TAIL) {
              for (const suffix of R17_SUFFIX) {
                seen.add(`${outer}${middle}${opener}${credential}${authority}${tail}${suffix}`);
              }
            }
          }
        }
      }
    }
  }
  return [...seen];
}

function r17Population(): Planted[] {
  return [
    ...r17StructuredUrls().map((url) => ({ url, secret: "hunter2" })),
    ...r17CredentialUrls(0xdeadbeef, 40_000).map((url) => ({ url, secret: R17_PASSWORD })),
  ];
}

/* -------------------------------------------------------------------------- */
/* 2. THE INSTRUMENTS ROUND 17 LEFT, AND THE GRAMMAR THIS LANE MODELS WITH     */
/* -------------------------------------------------------------------------- */

const JUDGE_BASE = "http://judge.invalid";

function parseAbsolute(text: string): URL | null {
  try {
    return new URL(text);
  } catch {
    return null;
  }
}

function parseRelative(text: string): URL | null {
  try {
    return new URL(text, JUDGE_BASE);
  } catch {
    return null;
  }
}

const SCHEME_TOKEN = /[a-zA-Z][a-zA-Z0-9+.-]*:/g;
const SOLIDUS_PAIR = /[/\\][/\\]/g;
const OWN_DELIMITER = /^[a-zA-Z][a-zA-Z0-9+.-]*:$/;

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
 * Round 17's CALIBRATED over-redaction reader, reproduced. It answers about a
 * url rather than about one spelling of it: the `href` is a view, and a solidus
 * pair the text's own scheme consumed is not a slice.
 */
function hostsNamedBy(text: string): Set<string> {
  const views = new Set<string>([text, text.replace(/[\t\r\n]/g, "")]);
  const absolute = parseAbsolute(text);
  if (absolute) {
    views.add(absolute.href);
    views.add(absolute.pathname);
  }
  const relative = parseRelative(text);
  if (relative) {
    views.add(relative.href);
    views.add(relative.pathname);
  }

  const slices = new Set<string>();
  for (const view of views) {
    slices.add(view);
    for (const at of matchIndexes(view, SCHEME_TOKEN)) slices.add(view.slice(at));
    for (const at of matchIndexes(view, SOLIDUS_PAIR)) {
      if (OWN_DELIMITER.test(view.slice(0, at))) continue;
      slices.add(view.slice(at));
    }
  }

  const hosts = new Set<string>();
  for (const slice of slices) {
    const parsed = parseAbsolute(slice) ?? parseRelative(slice);
    if (parsed && parsed.host !== "" && parsed.host !== "judge.invalid") hosts.add(parsed.host);
  }
  return hosts;
}

interface Verdict {
  input: string;
  output: string;
  invented: string[];
  dropped: string[];
}

function judgeHosts(input: string): Verdict | null {
  const output = redactUrl(input);
  if (output === input) return null;
  const before = hostsNamedBy(input);
  const after = hostsNamedBy(output);
  const invented = [...after].filter((host) => !before.has(host));
  if (invented.length === 0) return null;
  return { input, output, invented, dropped: [...before].filter((host) => !after.has(host)) };
}

function line(verdict: Verdict): string {
  return `in=${verdict.input} out=${verdict.output} invented=${verdict.invented.join(",")} dropped=${verdict.dropped.join(",")}`;
}

/**
 * THE GRAMMAR, MODELLED RATHER THAN IMPORTED. `src/errors/userinfo-spans.ts`
 * keeps every one of these private, and this lane needs them to say WHERE the
 * module asked its question rather than what it answered. Each one is the
 * module's own reading, transcribed; `readsAsHostAndPort` below is the exact
 * predicate round 17 added, so the model can be checked against the module on
 * named rows before any count rests on it.
 */
const SCHEME_CHARACTER = /[a-z0-9+\-.]/i;
const SPECIAL_SCHEMES = ["http", "https", "ws", "wss", "ftp"] as const;

function isSchemeCharacter(character: string | undefined): boolean {
  return character !== undefined && SCHEME_CHARACTER.test(character);
}

function isSolidus(character: string | undefined): boolean {
  return character === "/" || character === "\\";
}

function pastSolidi(text: string, from: number): number {
  let at = from;
  while (isSolidus(text[at])) at += 1;
  return at;
}

function beforeSolidi(text: string, from: number): number {
  let at = from - 1;
  while (isSolidus(text[at])) at -= 1;
  return at;
}

function authorityEnd(text: string, from: number): number {
  let at = from;
  while (at < text.length && !isSolidus(text[at]) && text[at] !== "?" && text[at] !== "#") {
    at += 1;
  }
  return at;
}

function isSpecialScheme(text: string, colon: number): boolean {
  for (const scheme of SPECIAL_SCHEMES) {
    const start = colon - scheme.length;
    if (start < 0 || text.slice(start, colon).toLowerCase() !== scheme) continue;
    return !isSchemeCharacter(text[start - 1]);
  }
  return false;
}

function authorityAt(text: string, colon: number): number | null {
  const start = pastSolidi(text, colon + 1);
  if (start > colon + 2) return start;
  return isSpecialScheme(text, colon) ? start : null;
}

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

function parsesAsAuthority(text: string, start: number): boolean {
  try {
    return new URL(`https://${text.slice(start, authorityEnd(text, start))}/`).host !== "";
  } catch {
    return false;
  }
}

/** Round 17's three conditions, reported one at a time. */
interface Conditions {
  mark: boolean;
  free: boolean;
  reads: boolean;
}

function conditionsAt(text: string, start: number): Conditions {
  const mark = beforeSolidi(text, start);
  return {
    mark: text[mark] === ":" && isSchemeCharacter(text[mark - 1]),
    free: text.lastIndexOf("@", authorityEnd(text, start) - 1) < start,
    reads: parsesAsAuthority(text, start),
  };
}

function readsAsHostAndPort(text: string, start: number): boolean {
  const answered = conditionsAt(text, start);
  return answered.mark && answered.free && answered.reads;
}

/** The path a url reaches the scan as, or `null` where nothing parses it. */
function pathOf(url: string): string | null {
  const absolute = parseAbsolute(url);
  if (absolute) return absolute.pathname;
  try {
    return new URL(url, "http://url.invalid").pathname;
  } catch {
    return null;
  }
}

describe("the model reads the same grammar the module does", () => {
  test("the three conditions answer as round 17's own rows report them", () => {
    // The row round 17 fixed: all three hold, so the colon rule is suppressed
    // and the authority survives.
    const fixed = pathOf("https://api.test/go/https://cdn.test:8443/users/@alice")!;
    expect(conditionsAt(fixed, nextAuthority(fixed, 0)!)).toEqual({
      mark: true,
      free: true,
      reads: true,
    });
    expect(redactUrl("https://api.test/go/https://cdn.test:8443/users/@alice")).toBe(
      "https://api.test/go/https://cdn.test:8443/users/@alice",
    );

    // The named gap: a bare `//` region has no scheme mark.
    const gap = pathOf("https://api.test//cdn.test:8443/img/@alice")!;
    expect(conditionsAt(gap, nextAuthority(gap, 0)!).mark).toBe(false);

    // A port the parser refuses.
    const refused = pathOf("https://api.test/go/https://cdn.test:99999/users/@alice")!;
    expect(conditionsAt(refused, nextAuthority(refused, 0)!).reads).toBe(false);

    // And an authority whose text holds an `@`.
    const held = pathOf("https://api.test/go/https://:@cdn.test:8443/users/@alice")!;
    expect(conditionsAt(held, nextAuthority(held, 0)!).free).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* 3. R18-H3-01 — ONE CHARACTER THE PLATFORM ERASES CHOOSES THE CONDITION      */
/* -------------------------------------------------------------------------- */

/** The control: the url the module already answers correctly. */
const CONTROL_URL = "https://api.test/go/https://cdn.test/users/@alice";
/** The same embedded url, spelled with the empty userinfo the parser erases. */
const EMPTY_USERINFO_URL = "https://api.test/go/https://:@cdn.test/users/@alice";
/** The same, with a port, which is the spelling round 17 filed and fixed. */
const EMPTY_USERINFO_PORT_URL = "https://api.test/go/https://@cdn.test:8443/users/@alice";
/** And with a credential in front of the port, which must still be removed. */
const NAMED_USERINFO_PORT_URL = "https://api.test/go/https://svctoken@cdn.test:8443/users/@alice";

describe("R18-H3-01 — an empty userinfo restores R17-H3-01", () => {
  test("the platform says the two embedded urls are ONE url", () => {
    // Not the judge's opinion and not this lane's: the URL Standard normalises
    // an empty userinfo away, which is the same fact round 13 recorded for the
    // seam and `SECURITY.md` states as "the parser normalizes an empty userinfo
    // away".
    expect(new URL("https://:@cdn.test/users/@alice").href).toBe("https://cdn.test/users/@alice");
    expect(new URL("https://@cdn.test:8443/users/@alice").href).toBe(
      "https://cdn.test:8443/users/@alice",
    );
  });

  test("the module answers them differently, and one answer names the handle", () => {
    // The control is a fixed point, which is what a url with no credential
    // must be, and `looksLikeUserinfo` promises it in those words.
    expect(redactUrl(CONTROL_URL)).toBe(CONTROL_URL);

    // FAILS ON HEAD. The `:` of `:@` supplies the colon the colon rule reads,
    // and the `@` of `:@` refuses the suppression that would have answered it.
    // The emitted url forwards to the host `alice`.
    expect(redactUrl(EMPTY_USERINFO_URL)).toBe(EMPTY_USERINFO_URL);
  });

  test("with a port it is R17-H3-01 verbatim, on a url that carries no credential", () => {
    // FAILS ON HEAD, and the row is round 17's own PORT_URL with one `@` in
    // front of the host. Round 17 pinned the fixed answer for the `@`-less
    // spelling; this is the same url to the platform.
    expect(redactUrl(EMPTY_USERINFO_PORT_URL)).toBe(EMPTY_USERINFO_PORT_URL);
  });

  test("a named userinfo must go and the authority must stay", () => {
    // The credential is real, so the span must cover it — and it must stop
    // there. The first half holds today; the second FAILS ON HEAD, because the
    // whole authority and the path go with the credential.
    const answer = redactUrl(NAMED_USERINFO_PORT_URL);
    expect(answer).not.toContain("svctoken");
    expect(answer).toContain("cdn.test:8443");
  });

  test("the judge condemns it in RES-6's own words, and RES-6 is not what it is", () => {
    // FAILS ON HEAD. Stated through the calibrated reader so the verdict cannot
    // be dismissed as a spelling defect of the instrument, and stated apart
    // from the answers above so a fixer sees which axis moved.
    expect(judgeHosts(EMPTY_USERINFO_URL)).toBeNull();

    // Why this is not RES-6: RES-6 is the THIRD rule of `looksLikeUserinfo`,
    // an `@` INSIDE a later segment. Here the `@` sits at a segment HEAD, the
    // spelling the same function promises to keep, and the control one line
    // above proves it keeps it. The difference is one erased character.
    expect(judgeHosts(CONTROL_URL)).toBeNull();
  });

  test("and the record disagrees with itself on every channel that carries it", async () => {
    const error = new NotFoundError(responseWith(EMPTY_USERINFO_PORT_URL));
    const rendered = everyChannel(error);

    // The channel-set rule: whatever the record says, it says once. This half
    // holds today and must keep holding through any fix.
    expect(error.toJSON().url).toBe(redactUrl(EMPTY_USERINFO_PORT_URL));

    // FAILS ON HEAD, both halves. The authority the request contacted reaches
    // no channel, and the handle reaches every channel that carries a url.
    expect(leakingChannels(rendered, ["cdn.test:8443"]).length).toBeGreaterThan(0);
    expect(leakingChannels(rendered, ["https://alice"])).toEqual([]);

    await error.cancel();
  });
});

/**
 * THE SEPARATING PREDICATE, exhibited so this is a fix that closed one spelling
 * rather than a shape no rule can decide.
 *
 * Two reads move, and each is the module's own question asked at the position
 * it is about:
 *
 *  - THE MARK IS THE REGION'S, NOT THE CURSOR'S. `readsAsHostAndPort` takes the
 *    cursor, and after a region answers for one `@` the cursor sits behind it,
 *    so `beforeSolidi` finds that `@` where the region's `://` used to be. The
 *    question "did a scheme write this port" is about the region.
 *  - THE `@` MUST HAVE SOMETHING TO DELIMIT. The second condition refuses every
 *    `@` in the authority, on the argument that `svc:PW@i.test` has a
 *    password's colon. True, and it is an argument about a colon with TEXT in
 *    front of it: `:@` has none, and `u@cdn.test:8443` has its colon on the
 *    other side of the `@` entirely.
 *
 * `separates` below is that pair of reads. It is a predicate over the text and
 * the parser's answers about it — no label is read, so section 3 of round 17's
 * file does not apply to it.
 */
function separates(text: string, start: number): boolean {
  const opening = beforeSolidi(text, start);
  if (!(text[opening] === ":" && isSchemeCharacter(text[opening - 1]))) return false;
  const end = authorityEnd(text, start);
  const at = text.lastIndexOf("@", end - 1);
  const colon = text.indexOf(":", start);
  // A colon in front of the authority's last `@` is a password's only where
  // some text precedes it. `:@` is an empty userinfo and delimits nothing.
  if (at >= start && colon >= 0 && colon < at && colon > start) return false;
  return parsesAsAuthority(text, at >= start ? at + 1 : start);
}

describe("R18-H3-01 — the predicate that separates it from the pinned answers", () => {
  test.each([
    ["the empty userinfo", "/go/https://:@cdn.test/users/@alice", true],
    ["the empty userinfo with a port", "/go/https://@cdn.test:8443/users/@alice", true],
    ["a username-only userinfo", "/go/https://svctoken@cdn.test:8443/users/@alice", true],
    ["the row round 17 fixed", "/go/https://cdn.test:8443/users/@alice", true],
    ["RESIDUAL 1: the empty scheme a template leaves", "/://a:1234/x/@bob", false],
    ["RESIDUAL 1: a password in front of the host", "//svc:PW@i.test/users/@alice", false],
    ["RESIDUAL 1: a port the parser refuses", "/go/https://cdn.test:99999/users/@alice", false],
    ["the bare `//` region, which is the named gap", "//cdn.test:8443/img/@alice", false],
  ])("%s", (_label, path, expected) => {
    const start = nextAuthority(path, 0);
    expect(start).not.toBeNull();
    expect(separates(path, start!)).toBe(expected);
  });

  test("the two pinned residual answers cannot move under it", () => {
    // Both are pinned in `redact-url.spec.ts` and in `userinfo-spans.spec.ts`,
    // and the predicate answers `false` for both, so a fix built on it cannot
    // reach them. Asserted through the module so the pin and the predicate are
    // read together.
    expect(redactUrl("://a:1234/x/@bob")).toBe("/://bob");
    expect(userinfoSpans("//svc:PW@i.test/users/@alice")).toEqual([{ start: 2, end: 23 }]);
  });
});

/**
 * WHAT THE PREDICATE COSTS, over the populations it would run on.
 *
 * The span the module removes today for such a region runs to the region's last
 * `@`; under the predicate it stops after the userinfo the parser reads. What
 * is LOST from the span is the text between the two, and the only question that
 * matters is whether a planted credential lives there. It cannot: the userinfo
 * the parser reads ends at the authority's last `@`, and a credential the
 * parser reports is in front of it.
 */
function shortenedBy(path: string): string[] {
  const spans = userinfoSpans(path);
  const lost: string[] = [];
  for (let from = 0; ; ) {
    const start = nextAuthority(path, from);
    if (start === null) break;
    from = start + 1;
    if (readsAsHostAndPort(path, start) || !separates(path, start)) continue;
    const span = spans.find((one) => one.start === start);
    if (span === undefined) continue;
    // Where the third rule already answers, the colon rule was not decisive,
    // and neither is the suppression that would have refused it. Both of the
    // earlier rules are read the way `looksLikeUserinfo` reads them.
    const slash = path.indexOf("/", start);
    const colon = path.indexOf(":", start);
    if (slash < 0 || slash >= span.end - 1) continue;
    if (colon < 0 || colon > slash) continue;
    if (path[span.end - 2] !== "/") continue;
    const at = path.lastIndexOf("@", authorityEnd(path, start) - 1);
    lost.push(path.slice(at >= start ? at + 1 : start, span.end));
  }
  return lost;
}

/** Does the platform read `text` as an authority carrying a userinfo? */
function reportsACredential(text: string): boolean {
  try {
    const parsed = new URL(`https://${text}`);
    return parsed.username !== "" || parsed.password !== "";
  } catch {
    return false;
  }
}

describe("R18-H3-01 — what the separating predicate costs, measured", () => {
  test("over both populations it costs no credential", { timeout: 300_000 }, () => {
    let touched = 0;
    let lostSecret = 0;
    let lostCredential = 0;
    // Round 17's two populations are in this sweep because they are what its
    // own residue number was measured against, and the predicate touches none
    // of their 97,344 rows: not one spells an `@` in front of an embedded
    // authority. That absence is why the shape survived a fix lane and a hunt
    // lane both, and it is the reason this file draws its own corpus.
    const population = [...r17Population(), ...drawn()];
    for (const { url, secret } of population) {
      const path = pathOf(url);
      if (path === null) continue;
      const lost = shortenedBy(path);
      if (lost.length === 0) continue;
      touched += 1;
      const holding = lost.find((text) => text.includes(secret));
      if (holding === undefined) continue;
      lostSecret += 1;
      // The span shortens to the end of the userinfo the PARSER reads, so
      // everything it gives up begins at a host. The platform says so: a text
      // it reads as an authority plus a path reports no userinfo at all, and
      // that is `SECURITY.md`'s path-segment residual rather than a credential.
      if (reportsACredential(holding)) lostCredential += 1;
    }
    expect({ size: population.length, touched, lostSecret, lostCredential }).toEqual({
      size: 237_984,
      touched: 0,
      lostSecret: 0,
      lostCredential: 0,
    });
  });
});

/**
 * THE DIFFERENTIAL THE DEFECT IS, counted rather than exhibited.
 *
 * Every pair of urls that differ only by an empty userinfo the platform erases
 * must name the same hosts after redaction, because they are one url. The pairs
 * are drawn from the same axes as population A, restricted to the openers under
 * which the embedded text is a url a parser reads absolutely — that is the only
 * state in which "these two are one url" is the platform's answer and not this
 * lane's.
 */
const PAIR_OPENER = ["https://", "http://", "ftp://", "wss://", "zz://", "HTTPS://"] as const;

interface Differential {
  pairs: number;
  oneUrl: number;
  differ: number;
}

function emptyUserinfoDifferential(): Differential {
  const measured: Differential = { pairs: 0, oneUrl: 0, differ: 0 };
  for (const outer of OUTER) {
    for (const middle of MIDDLE) {
      for (const opener of PAIR_OPENER) {
        for (const authority of AUTHORITY) {
          for (const tail of TAIL) {
            for (const suffix of SUFFIX) {
              for (const userinfo of ["@", ":@"] as const) {
                measured.pairs += 1;
                const one = parseAbsolute(`${opener}${userinfo}${authority}${tail}`);
                const two = parseAbsolute(`${opener}${authority}${tail}`);
                if (one === null || two === null || one.href !== two.href) continue;
                measured.oneUrl += 1;
                const before = hostsNamedBy(
                  redactUrl(`${outer}${middle}${opener}${userinfo}${authority}${tail}${suffix}`),
                );
                const after = hostsNamedBy(
                  redactUrl(`${outer}${middle}${opener}${authority}${tail}${suffix}`),
                );
                const same =
                  before.size === after.size && [...before].every((host) => after.has(host));
                if (!same) measured.differ += 1;
              }
            }
          }
        }
      }
    }
  }
  return measured;
}

describe("R18-H3-01 — the differential over the population", () => {
  test("one url under two spellings names one set of hosts", { timeout: 300_000 }, () => {
    // FAILS ON HEAD at `differ`, which is 5,400: 2,160 pairs where the bare `@`
    // moves the answer — all of them behind a port, which supplies the colon —
    // and 3,240 where `:@` does, of which 1,080 carry no port at all, because
    // `:@` brings its own colon. The other two counts are the corpus and hold.
    expect(emptyUserinfoDifferential()).toEqual({ pairs: 24_192, oneUrl: 20_736, differ: 0 });
  });
});

/* -------------------------------------------------------------------------- */
/* 4. THE THIRD JUDGE — the axes the first two cannot see                     */
/* -------------------------------------------------------------------------- */

/**
 * The spelling the URL parser writes for a text placed in a path.
 *
 * This is the whole of the third judge's TRANSFORMED axis. `redactUrl` emits a
 * parser's own `pathname`, so a secret that reaches the answer reaches it
 * REWRITTEN: `\` is a solidus under a special scheme, a tab is removed before
 * parsing, and a space, a `<`, a `` ` `` or a `{` is percent-encoded. A judge
 * that searches for the raw secret answers "removed" for every one of them.
 */
function emittedSpelling(secret: string): string {
  try {
    return new URL(`http://spelling.invalid/${secret}`).pathname.slice(1);
  } catch {
    return secret;
  }
}

/** The longest run of `secret` that appears anywhere in `output`. */
function longestRun(secret: string, output: string): number {
  let best = 0;
  for (let from = 0; from < secret.length; from += 1) {
    for (let to = secret.length; to - from > best; to -= 1) {
      if (output.includes(secret.slice(from, to))) {
        best = to - from;
        break;
      }
    }
  }
  return best;
}

/**
 * Which structural slot each occurrence of `needle` sits in, read the way a log
 * reader reads a url: the caller's own `?` and `#`, and the authority of the
 * first mark the text spells.
 */
function slotsOf(text: string, needle: string): Set<string> {
  const slots = new Set<string>();
  const query = text.indexOf("?");
  const fragment = text.indexOf("#");
  const mark = text.indexOf("://");
  const opens = mark < 0 ? -1 : mark + 3;
  let closes = opens;
  while (opens >= 0 && closes < text.length && !"/\\?#".includes(text[closes]!)) closes += 1;
  for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + 1)) {
    if (fragment >= 0 && at > fragment) slots.add("fragment");
    else if (query >= 0 && at > query) slots.add("query");
    else if (opens >= 0 && at >= opens && at < closes) {
      slots.add(text.lastIndexOf("@", closes - 1) > at ? "userinfo" : "host");
    } else slots.add("path");
  }
  return slots;
}

/**
 * THE THIRD JUDGE. Round 17 grades two axes — did a host move, did the
 * credential survive whole — and a credential has three more ways to reach a
 * reader:
 *
 *  - TRANSFORMED: absent verbatim, present in the spelling the parser writes.
 *  - PARTIAL: neither, but a run of four or more of its characters is emitted.
 *  - MOVED: it survives, and the slot it lands in is not one it occupied in the
 *    input — a path segment emitted where a reader reads a host, a query value
 *    emitted into a path.
 */
interface Escapes {
  size: number;
  carried: number;
  whole: number;
  transformed: number;
  causedByRewrite: number;
  partial: number;
  moved: number;
}

function gradeEscapes(population: readonly Planted[]): Escapes {
  const measured: Escapes = {
    size: population.length,
    carried: 0,
    whole: 0,
    transformed: 0,
    causedByRewrite: 0,
    partial: 0,
    moved: 0,
  };
  for (const { url, secret } of population) {
    if (!url.includes(secret)) continue;
    measured.carried += 1;
    const output = redactUrl(url);
    const spelling = emittedSpelling(secret);
    const survivor = output.includes(secret)
      ? secret
      : spelling !== secret && output.includes(spelling)
        ? spelling
        : null;
    if (survivor === null) {
      if (longestRun(secret, output) >= 4) measured.partial += 1;
      continue;
    }
    if (survivor === secret) measured.whole += 1;
    else {
      measured.transformed += 1;
      // Is the REWRITE what saved it? The same url with the secret already
      // written the way the parser writes it answers that, and the answer is
      // what separates an instrument gap from a leak.
      const plain = url.split(secret).join(spelling);
      if (!redactUrl(plain).includes(spelling)) measured.causedByRewrite += 1;
    }
    const before = new Set([...slotsOf(url, secret), ...slotsOf(url, spelling)]);
    if ([...slotsOf(output, survivor)].some((slot) => !before.has(slot))) measured.moved += 1;
  }
  return measured;
}

describe("the third judge, over the populations this lane draws", () => {
  test("three axes, and the one that fires is a rewrite", { timeout: 300_000 }, () => {
    expect(gradeEscapes(drawn())).toEqual({
      size: 140_640,
      carried: 86_880,
      whole: 13_237,
      transformed: 9_258,
      causedByRewrite: 0,
      partial: 4,
      moved: 0,
    });
  });

  test("what TRANSFORMED means, on one row of each rewrite", () => {
    // A backslash the parser folds into a solidus. The credential survives —
    // `git:` under fewer than two solidi is an opaque path, which `SECURITY.md`
    // records — and it survives spelled with a `/`.
    const folded = "https://api.test/go/git:/svc:PW\\SENT@internal.test/v1";
    expect(redactUrl(folded)).toBe("https://api.test/go/git:/svc:PW/SENT@internal.test/v1");
    expect(redactUrl(folded).includes("PW\\SENT")).toBe(false);

    // A tab the parser removes before parsing.
    const broken = "https://api.test/go/git:/svc:PW\tSENT@internal.test/v1";
    expect(redactUrl(broken)).toBe("https://api.test/go/git:/svc:PWSENT@internal.test/v1");

    // A space the parser percent-encodes.
    const spaced = "https://api.test/go/git:/svc:PW SENT@internal.test/v1";
    expect(redactUrl(spaced)).toBe("https://api.test/go/git:/svc:PW%20SENT@internal.test/v1");
  });

  test("a raw sentinel cannot see any of the three, on any channel", async () => {
    // THE CONSEQUENCE, and the reason this axis is worth a judge. Every
    // disclosure assertion in this suite reaches `leakingChannels`, which is a
    // raw substring test. A caller whose password holds a space ships it
    // through seven channels while the harness reports no leak.
    const url = "https://api.test/go/git:/svc:PW SENT@internal.test/v1";
    const error = new NotFoundError(responseWith(url));
    const rendered = everyChannel(error);

    expect(leakingChannels(rendered, ["PW SENT"])).toEqual([]);
    expect(leakingChannels(rendered, ["PW%20SENT"]).length).toBeGreaterThan(3);

    await error.cancel();
  });

  test("MOVED is empty, and the reason is structural", () => {
    // The emitted origin is the parser's own, and everything else the module
    // emits comes from one `pathname`. So a value can be dropped and can never
    // change slot — the property `cleaned` states as "every byte this function
    // emits comes from `origin` or from `parsed.pathname`".
    const query = "https://api.test/v1?token=SENTINELQ";
    expect(redactUrl(query)).toBe("https://api.test/v1");
    const fragment = "https://api.test/v1#token=SENTINELF";
    expect(redactUrl(fragment)).toBe("https://api.test/v1");
    // And a host the caller wrote in a protocol-relative path is consumed by
    // the resolution rather than emitted somewhere else.
    expect(redactUrl("//svc:pw@internal.test/v1")).toBe("/v1");
  });
});

/* -------------------------------------------------------------------------- */
/* 5. THE MESSAGE PASS — round 17's stated cost, graded on the channel set     */
/* -------------------------------------------------------------------------- */

/**
 * Round 17 stopped `segmentUserinfos` past `kept`, and stated the cost in one
 * sentence: "a credential that spells a solidus AND hides in a query or
 * fragment AND is quoted by a message that does not quote the whole url keeps
 * the segments before its last solidus."
 *
 * Each conjunct is drawn below, and the sentence holds on every one of them.
 * The cost is not larger, and the three conjuncts are each load-bearing: drop
 * the solidus and the needle is whole; move the credential to the path and the
 * needle is whole; quote the whole url and the first line of
 * `redactUrlInMessage` removes it before the needle pass runs.
 */
const QUOTED = `connect ECONNREFUSED while contacting https://svc:${SECRET}/more@internal.test/x`;

describe("the message pass — the stated cost, and no more than it", () => {
  test("the three conjuncts each hold, one row apiece", () => {
    // ALL THREE: the segments before the last solidus stay, which is the
    // sentence, verbatim.
    const all = `https://api.test/v1?next=https://svc:${SECRET}/more@internal.test/x`;
    expect(redactUrlInMessage(QUOTED, all)).toBe(
      `connect ECONNREFUSED while contacting https://svc:${SECRET}/internal.test/x`,
    );

    // NO SOLIDUS in the credential: the span is one segment, so it is one
    // needle and the whole credential goes.
    const plain = `https://api.test/v1?next=https://svc:${SECRET}@internal.test/x`;
    expect(
      redactUrlInMessage(`fetch failed contacting https://svc:${SECRET}@internal.test/x`, plain),
    ).toBe("fetch failed contacting https://internal.test/x");

    // NOT IN A DROPPED SLOT: the same credential in the PATH is scanned at the
    // default `kept`, so the needle is the whole span.
    const inPath = `https://api.test/go/https://svc:${SECRET}/more@internal.test/x`;
    expect(redactUrlInMessage(QUOTED, inPath)).toBe(
      "connect ECONNREFUSED while contacting https://internal.test/x",
    );

    // THE WHOLE URL QUOTED: the exact-string replacement fires first.
    expect(redactUrlInMessage(`fetch failed: ${all}`, all)).toBe(
      "fetch failed: https://api.test/v1",
    );
  });

  test("the fragment slot costs exactly what the query slot costs", () => {
    const inFragment = `https://api.test/v1#next=https://svc:${SECRET}/more@internal.test/x`;
    expect(redactUrlInMessage(QUOTED, inFragment)).toBe(
      `connect ECONNREFUSED while contacting https://svc:${SECRET}/internal.test/x`,
    );
  });

  test("a backslash is a solidus here too, which the sentence's word covers", () => {
    // `isSolidus` reads `\` as a solidus, and `segmentUserinfos` walks with it,
    // so the cost is the same under the spelling a Windows path or a
    // `path.join` produces.
    const url = `https://api.test/v1?next=https://svc:${SECRET}\\more@internal.test/x`;
    const message = `connect ECONNREFUSED while contacting https://svc:${SECRET}\\more@internal.test/x`;
    expect(redactUrlInMessage(message, url)).toBe(
      `connect ECONNREFUSED while contacting https://svc:${SECRET}\\internal.test/x`,
    );
  });

  test("and the cost reaches the channel set as one decision", async () => {
    const url = `https://api.test/v1?next=https://svc:${SECRET}/more@internal.test/x`;
    const error = new NetworkError(QUOTED, { url });
    const rendered = everyChannel(error);

    // The url channel drops the slot whole, so it never carries the secret.
    expect(error.toJSON().url).toBe("https://api.test/v1");
    expect(redactUrl(url).includes(SECRET)).toBe(false);

    // The message channels carry it, all of them, which is what makes this one
    // decision rather than one channel's slip. Recorded, not asserted away.
    expect(leakingChannels(rendered, [SECRET]).length).toBeGreaterThan(3);
    expect(error.toJSON().message).toBe(redactUrlInMessage(QUOTED, url));
  });
});

/* -------------------------------------------------------------------------- */
/* 6. THE DIFFERENTIAL ROUND 17 REPORTED, RE-DERIVED                          */
/* -------------------------------------------------------------------------- */

/**
 * Round 17's F3 reported 1,823 answers changed over 651,604 urls, "all keeping
 * an embedded authority, zero planted credentials newly surviving". The corpus
 * is not in the tree, so the number cannot be re-run — this is the third time
 * this audit has met a headline number whose population nothing reproduces, and
 * the generator above is committed for that reason.
 *
 * WHAT CAN BE RE-DERIVED IS THE SAFETY HALF, and it is stronger than a count.
 * The suppression's SECOND condition refuses every region whose authority text
 * holds an `@`. A credential the parser reports IS an authority text with an
 * `@` in it. So no answer the fix changed can have lost a parser-reported
 * credential — not rarely, but never, and by the predicate rather than by the
 * corpus that happened to be drawn.
 *
 * What the fix does newly keep is measured below: text the parser reads as a
 * PATH SEGMENT behind an embedded authority. `SECURITY.md`'s second residual
 * says a secret in a path segment survives, so the pre-fix tree was removing it
 * by accident and the fix is the module agreeing with its own document.
 */
function suppressedSpans(path: string): string[] {
  const found: string[] = [];
  for (let from = 0; ; ) {
    const start = nextAuthority(path, from);
    if (start === null) break;
    from = start + 1;
    if (!readsAsHostAndPort(path, start)) continue;
    const end = path.lastIndexOf("@") + 1;
    if (end <= start) continue;
    const slash = path.indexOf("/", start);
    if (slash < 0 || slash >= end - 1) continue;
    // Where the `@` does not follow a solidus the third rule answers first, so
    // the colon rule was not what the suppression took away.
    if (path[end - 2] !== "/") continue;
    const colon = path.indexOf(":", start);
    if (colon < 0 || colon > slash) continue;
    found.push(path.slice(start, end - 1));
  }
  return found;
}

interface Residue {
  size: number;
  touched: number;
  keptPathSegment: number;
  keptParserCredential: number;
}

function suppressionResidue(population: readonly Planted[]): Residue {
  const measured: Residue = {
    size: population.length,
    touched: 0,
    keptPathSegment: 0,
    keptParserCredential: 0,
  };
  for (const { url, secret } of population) {
    const path = pathOf(url);
    if (path === null) continue;
    const spans = suppressedSpans(path);
    if (spans.length === 0) continue;
    measured.touched += 1;
    const holding = spans.find((text) => text.includes(secret));
    if (holding === undefined || !redactUrl(url).includes(secret)) continue;
    // Does the PLATFORM read the kept text as a credential, or as an authority
    // and a path? That is the whole question, and the platform answers it.
    let reported = false;
    try {
      const parsed = new URL(`https://${holding}`);
      reported = parsed.username !== "" || parsed.password !== "";
    } catch {
      reported = false;
    }
    if (reported) measured.keptParserCredential += 1;
    else measured.keptPathSegment += 1;
  }
  return measured;
}

describe("round 17's F3 differential, re-derived over a population this file draws", () => {
  test("no credential the PARSER reports can newly survive", { timeout: 300_000 }, () => {
    expect(suppressionResidue(drawn())).toEqual({
      size: 140_640,
      touched: 2_167,
      keptPathSegment: 1_008,
      keptParserCredential: 0,
    });
  });

  test("the second condition is why, and it is a predicate rather than a count", () => {
    // A credential the parser reports sits in front of an `@` inside the
    // region's authority text, and that `@` is exactly what the second
    // condition refuses on. So the suppression never reaches one.
    const path = pathOf("https://api.test/go/https://svc:hunter2@cdn.test:8443/users/@alice")!;
    const start = nextAuthority(path, 0)!;
    expect(conditionsAt(path, start).free).toBe(false);
    expect(readsAsHostAndPort(path, start)).toBe(false);
    expect(
      redactUrl("https://api.test/go/https://svc:hunter2@cdn.test:8443/users/@alice"),
    ).not.toContain("hunter2");
  });

  test("what it DOES newly keep is a path segment, which the document allows", () => {
    // The parser reads `cdn.test:8443` as the authority, so `RESET_TOKEN` is a
    // path segment of the embedded url — the residual `SECURITY.md` records in
    // its second bullet. The pre-fix tree removed it as part of a credential it
    // had guessed at.
    const url = "https://api.test/go/https://cdn.test:8443/RESET_TOKEN/@internal.test/v1";
    const embedded = new URL("https://cdn.test:8443/RESET_TOKEN/@internal.test/v1");
    expect([embedded.host, embedded.username, embedded.password]).toEqual([
      "cdn.test:8443",
      "",
      "",
    ]);
    expect(redactUrl(url)).toBe(url);
  });
});

/* -------------------------------------------------------------------------- */
/* 7. R18-H3-02 — THE NAMED GAP, CONFIRMED AND RE-GRADED                      */
/* -------------------------------------------------------------------------- */

/** Round 17's `portOnlySpans`, reproduced so the 504 is the same 504. */
function portOnlySpans(path: string): string[] {
  const lost: string[] = [];
  for (const span of userinfoSpans(path)) {
    const candidate = path.slice(span.start, span.end - 1);
    const slash = candidate.indexOf("/");
    const colon = candidate.indexOf(":");
    if (slash < 0) continue;
    if (colon < 0 || colon > slash) continue;
    if (candidate.at(-1) !== "/") continue;
    let readsAsAuthority = false;
    try {
      readsAsAuthority = new URL(`https://${candidate.slice(0, slash)}/`).host !== "";
    } catch {
      readsAsAuthority = false;
    }
    if (!readsAsAuthority) continue;
    let lone = false;
    for (let at = span.start; at < span.end; at += 1) {
      if (path[at] === "@" && path[at - 1] !== "/") lone = true;
    }
    if (lone || path[span.start] === "@") continue;
    lost.push(path.slice(span.start, span.end));
  }
  return lost;
}

interface Gap {
  size: number;
  residue: number;
  lostSecret: number;
  failsTheMarkCondition: number;
  condemned: number;
  wellFormed: number;
}

function gradeTheGap(): Gap {
  const measured: Gap = {
    size: 0,
    residue: 0,
    lostSecret: 0,
    failsTheMarkCondition: 0,
    condemned: 0,
    wellFormed: 0,
  };
  const population = r17Population();
  measured.size = population.length;
  for (const { url, secret } of population) {
    const path = pathOf(url);
    if (path === null) continue;
    const spans = portOnlySpans(path);
    if (spans.length === 0) continue;
    measured.residue += 1;
    if (spans.some((text) => text.includes(secret))) measured.lostSecret += 1;
    const start = path.indexOf(spans[0]!);
    if (!conditionsAt(path, start).mark) measured.failsTheMarkCondition += 1;
    if (judgeHosts(url) === null) continue;
    measured.condemned += 1;
    if (parseAbsolute(url) !== null) measured.wellFormed += 1;
  }
  return measured;
}

describe("R18-H3-02 — the residue the ledger calls costless", () => {
  test("the count and the zero are exactly what round 17 reported", { timeout: 300_000 }, () => {
    // CONFIRMED, and this half passes. 504 rows of 97,344, no planted
    // credential in any of them, and all 504 fail the FIRST condition — so the
    // ledger's attribution of the gap to the bare `//` region is right.
    const graded = gradeTheGap();
    expect({
      size: graded.size,
      residue: graded.residue,
      lostSecret: graded.lostSecret,
      failsTheMarkCondition: graded.failsTheMarkCondition,
    }).toEqual({
      size: 97_344,
      residue: 504,
      lostSecret: 0,
      failsTheMarkCondition: 504,
    });
  });

  test(
    "414 of the 504 cost more than a diagnostic, and that is RES-7",
    { timeout: 300_000 },
    () => {
      // ADJUDICATED IN ROUND 18, AND THE VERDICT IS A RESIDUAL.
      //
      // The finding is correct: `lostSecret: 0` measures the UNDER-redaction axis
      // and the gap's cost is on the other one. 414 rows emit a record that names
      // a host the request never contacted, and 360 of them are urls the platform
      // parses absolutely.
      //
      // The fixer built the separation the hunter said did not exist — a region no
      // COLON opened buys the parse's reading — and measured it: 738 of 97,344
      // rows move, zero planted credentials newly survive, residual 1 holds and
      // the base64 pin holds. The orchestrator first ruled to land it. The fixer
      // then reported the full scope, which the ruling had not been made on: it
      // moves FIVE pinned answers across THREE spec files, and one of them is
      // behavioural — `round17-h3-disclosure.spec.ts` line 881, the row round 17
      // wrote deliberately as this gap's definition. On that row the region's own
      // text is `https:`, so the "authority" the parser reads is a scheme token
      // with an empty port. Suppressing the colon rule there rests on an
      // accidental parse, which is a weaker case than the two HIGH fixes stood on.
      //
      // So the ruling was reversed. The cost is over-redaction, never a leaked
      // credential, and this module's own history is three consecutive rounds in
      // which a new condition became the next round's surface. The limit is
      // written down instead, as RES-7 in `SECURITY.md`, with the number.
      //
      // The pin holds the residual in BOTH directions. A round that turns it red
      // has closed RES-7 — delete the pin and the SECURITY.md entry together — or
      // widened it, and must say which.
      const graded = gradeTheGap();
      expect({ condemned: graded.condemned, wellFormed: graded.wellFormed }).toEqual({
        condemned: 414,
        wellFormed: 360,
      });
    },
  );

  test("the row, and the answer it emits, pinned as RES-7", () => {
    // The documented example, quoted in `SECURITY.md`, exactly as it emits. A
    // forward through a protocol-relative reference to a host on a port.
    // Nothing here is a credential: the platform reads the embedded authority
    // whole and reports none. The record names `alice`.
    const verdict = judgeHosts("https://api.test/proxy///cdn.test:8443/img/@alice");
    expect(verdict === null ? "no host invented" : line(verdict)).toBe(
      "in=https://api.test/proxy///cdn.test:8443/img/@alice" +
        " out=https://api.test/proxy///alice invented=alice dropped=cdn.test:8443",
    );
  });

  test("and it is the same defect round 17 filed, under the spelling it left", () => {
    // The two rows differ only in whether a scheme wrote the mark, and the
    // module answers them oppositely. This half PASSES — it is the pin round 17
    // wrote — and it is here so a fixer reads the pair together.
    expect(redactUrl("https://api.test/go/https://cdn.test:8443/img/@alice")).toBe(
      "https://api.test/go/https://cdn.test:8443/img/@alice",
    );
    expect(redactUrl("https://api.test//cdn.test:8443/img/@alice")).toBe("https://api.test//alice");
  });
});
