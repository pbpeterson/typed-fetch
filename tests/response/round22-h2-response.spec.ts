import { describe, expect, test } from "vitest";
import { NetworkError } from "../../src/errors";
import { redactUrl, redactUrlInMessage } from "../../src/errors/redact-url";
import { pathUserinfoSpans, userinfoSpans } from "../../src/errors/userinfo-spans";
import { everyChannel, leakingChannels, PASSWORD } from "../../fixtures/channels";

// ═══════════════════════════════════════════════════════════════════════════
// ROUND 22 — H2. THE MESSAGE ROUTE, MEASURED.
//
// Five cost instruments exist in this suite — round 16's rebuild count, round
// 16's probe count, round 19's `indexOf` distance, round 20's copied and parsed
// characters, and round 21's grammar questions — and every one of them wraps
// `redactUrl`. The other half of `./redact-url` has never been read by any of
// them: `redactUrlInMessage`, and under it `userinfosOf`, `hiddenUserinfos` and
// `withoutUserinfos`. Both of round 21's critical findings lived there.
//
// This file measures that route and crosses it with the one it shares a scanner
// with.
//
// ── 1. R22-H2-01. THE TEXT THE TWO ROUTES ARE HANDED IS NOT THE SAME TEXT. ──
//
// `cleaned` hands the scanner the path AND the slots the outer parse cut it off
// from:
//
//   const clean = withoutMalformedUserinfo(path, parsed.search + parsed.hash, seam);
//   → userinfoSpans(tail !== "" && endsInsideAuthority(path) ? path + tail : path, seam)
//
// `pathUserinfoSpans`' own comment states what the widening buys: "the `@` of a
// credential the outer `?` cut in half". `/go/https://svc:hun?ter2@h.test`
// reaches the path state, the `?` hands everything after it to the query state,
// and `pathname` therefore ends INSIDE the embedded authority with no `@` left
// in it at all.
//
// `slotUserinfos` — the message route's reading of the SAME url — is handed the
// pathname alone:
//
//   ...hiddenUserinfos(parsed.pathname, seamUserinfo(parsed, spilled)),
//   ...hiddenUserinfos(parsed.search, null, 0),
//   ...hiddenUserinfos(parsed.hash, null, 0),
//
// Three texts, none of them the concatenation, so the one state
// `endsInsideAuthority` names produces NO needle in the parser's spelling.
//
// The raw scan in `userinfosOf` covers the caller's spelling and nothing else.
// So the two spellings decide it: where the parser rewrote one character of the
// credential — a space, a `<`, a `{`, a `"`, any member of the path
// percent-encode set — the caller's needle no longer matches the text a
// platform quotes, and the platform quotes what the parser serialized. That is
// the exact state the userinfo pass exists for, named on `redactUrlInMessage`:
// "a platform that re-serializes the URL before putting it in its message
// defeats the exact-string replacement. The userinfo pass is the second line".
//
// `toJSON().url` is clean on every url below, because the url route READ the
// tail and removed the credential. The password reaches `error.message`,
// `toJSON().message` and every channel that renders either. R21-H2-01's shape
// at a different value the two routes read differently.
//
// ── 2. R22-H2-02. THE SIXTH INSTRUMENT, AND WHAT IT READS. ─────────────────
//
// `withoutUserinfos` copies a slice of the message for EVERY `@` in the message
// and EVERY distinct needle length, before any character of it is looked at:
//
//   const match = message.slice(start, at + 1);
//   if (!needles.has(match)) continue;
//
// Its own comment says "each test is a lookup on a short slice rather than a
// scan of everything". A needle is not short and nothing bounds it: it is a
// slice of the url, so its length is the url's. The characters copied are
// (the message's `@` count) × (the sum of the DISTINCT needle lengths), and a
// redirecting server picks both — the `@` count out of a query slot the message
// quotes, the needle length out of one embedded credential.
//
// This is the shape round 20 fixed on the OTHER route and named while fixing
// it. `spellsToken` in `./userinfo-spans` exists because `isSpecialScheme` "used
// to cut five substrings out and lower-case each of them — seventeen characters
// copied per colon, whatever the first one said". The identical read sits here,
// unmeasured, because no instrument this audit owns wraps this route.
//
// ── 3. The two routes crossed: every value both of them read from one call.
// ── 4. The grid: round 21's three changes crossed with what predates round 20.
//
// NOTHING HERE IS A TIME RATIO. Section 2 states characters copied per input
// character over an eightfold sweep, with wall time as the cross-check
// anti-pattern 13 requires of an instrument that reports flat.
// ═══════════════════════════════════════════════════════════════════════════

const ORIGIN = "https://api.test";

function parseEither(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    /* not absolute */
  }
  try {
    return new URL(url, "http://url.invalid");
  } catch {
    return null;
  }
}

// ── 1. R22-H2-01 — the tail the message route is never handed ──────────────

/**
 * Urls whose `pathname` ends INSIDE an embedded authority, and whose embedded
 * credential holds one character the path percent-encode set rewrites.
 *
 * Both halves are load-bearing and section 1's control below removes the second
 * one. The first puts the closing `@` on the far side of the outer `?` or `#`,
 * which is the state only `pathUserinfoSpans` reads. The second makes the
 * caller's spelling and the parser's differ, which is the state the raw scan in
 * `userinfosOf` cannot cover.
 */
const TAIL_SHAPES = [
  {
    name: "a `<` in the password, and the outer `?` cutting the authority",
    url: `${ORIGIN}/go/https://svc:hun<${PASSWORD}?ter3@h.test`,
  },
  {
    name: "a space in the password, and the outer `?` cutting the authority",
    url: `${ORIGIN}/go/https://svc:hun ${PASSWORD}?ter3@h.test`,
  },
  {
    name: "a `{` in the password, and the outer `?` cutting the authority",
    url: `${ORIGIN}/go/https://svc:hun{${PASSWORD}?y@h.test`,
  },
  {
    name: 'a `"` in the password, and the outer `#` cutting the authority',
    url: `${ORIGIN}/go/https://svc:hun"${PASSWORD}#y@h.test`,
  },
] as const;

/** The spelling a platform writes: the url as the URL parser serialized it. */
function quotedOf(url: string): string {
  return new URL(url).href;
}

describe("round 22 / H2 — the tail the url route reads and the message route does not", () => {
  test("R22-H2-01: NON-VACUITY — the parse succeeds, the url route removes it, the platform quotes it", () => {
    // Every url parses, so this is not the unparseable class.
    expect(TAIL_SHAPES.map((shape) => new URL(shape.url).protocol)).toEqual([
      "https:",
      "https:",
      "https:",
      "https:",
    ]);
    // THE SCANNER FOUND THE CREDENTIAL. `redactUrl` removes it, so what follows
    // is a defect of the needle route and never of the scan.
    expect(TAIL_SHAPES.filter((shape) => redactUrl(shape.url).includes(PASSWORD))).toEqual([]);
    // And the platform's own spelling really carries the password: the parser
    // rewrote one character of the credential, not the password itself.
    expect(TAIL_SHAPES.filter((shape) => !quotedOf(shape.url).includes(PASSWORD))).toEqual([]);
  });

  test("R22-H2-01: the userinfo pass removes the password the first line could not", () => {
    const leaking = TAIL_SHAPES.filter((shape) =>
      redactUrlInMessage(`TypeError: fetch failed for ${quotedOf(shape.url)}`, shape.url).includes(
        PASSWORD,
      ),
    ).map((shape) => shape.name);
    expect(leaking).toEqual([]);
  });

  test("R22-H2-01: no channel of a NetworkError carries the password", () => {
    // THE PUBLIC SURFACE. `preResponseFailureOf` cleans the caller's message
    // with `redactUrlInMessage` and copies the result into `toJSON().message`
    // verbatim; a consumer wrapping an adapter passes the platform's own text.
    const shape = TAIL_SHAPES[0];
    const error = new NetworkError(`TypeError: fetch failed for ${quotedOf(shape.url)}`, {
      url: shape.url,
    });
    expect(leakingChannels(everyChannel(error), [PASSWORD])).toEqual([]);
    // And the url channel is clean, so the two records of one failure disagree
    // about whether the caller wrote a credential.
    expect(String(error.toJSON().url).includes(PASSWORD)).toBe(false);
  });

  test("R22-H2-01: the mechanism is the text, and the control differs by one character", () => {
    // THE MECHANISM, ISOLATED, through the scanner's own two entry points. The
    // pathname alone spells no `@` at all, so it answers no span; the same
    // pathname with the slot the outer `?` cut it off from answers one.
    const parsed = new URL(TAIL_SHAPES[0].url);
    expect(userinfoSpans(parsed.pathname)).toEqual([]);
    expect(pathUserinfoSpans(parsed.pathname, parsed.search + parsed.hash, null).length).toBe(1);

    // THE CONTROL. The same url with the parser-rewritten character taken out of
    // the password loses it from the message, because the RAW scan's needle then
    // matches the platform's spelling too. So nothing about the quoting, the
    // channel, or the outer `?` differs — only whether the two spellings agree.
    const control = `${ORIGIN}/go/https://svc:${PASSWORD}?ter3@h.test`;
    expect(redactUrlInMessage(`boom ${quotedOf(control)} boom`, control)).not.toContain(PASSWORD);
  });
});

// ── 2. R22-H2-02 — the sixth instrument, and the first one on this route ────

/**
 * What one call spends, counted rather than timed.
 *
 * `copied` is characters cut out of a string, `restarts` is the distance an
 * `indexOf` walked, and `slices` is the number of cuts. The message pass spends
 * all three: `withoutUserinfos` walks the message with `indexOf("@")` and cuts a
 * candidate out of it per `@` per distinct needle length.
 */
function counted(run: () => void) {
  const nativeSlice = String.prototype.slice;
  const nativeIndexOf = String.prototype.indexOf;
  let copied = 0;
  let slices = 0;
  let restarts = 0;
  String.prototype.slice = function (this: string, start?: number, end?: number) {
    const answer = nativeSlice.call(this, start, end);
    copied += answer.length;
    slices += 1;
    return answer;
  } as typeof String.prototype.slice;
  String.prototype.indexOf = function (this: string, search: string, position?: number) {
    const found = nativeIndexOf.call(this, search, position);
    const from = position === undefined ? 0 : Math.max(0, position);
    restarts += (found < 0 ? this.length : found) - from;
    return found;
  } as typeof String.prototype.indexOf;
  const started = performance.now();
  try {
    run();
  } finally {
    String.prototype.slice = nativeSlice;
    String.prototype.indexOf = nativeIndexOf;
  }
  const elapsed = performance.now() - started;
  return { copied, slices, restarts, elapsed };
}

/**
 * The MESSAGE route's own spend, which is the whole call less the url route's.
 *
 * `redactUrlInMessage` runs `redactUrl` once itself, and every instrument this
 * audit owns already reads that half. Subtracting it leaves exactly the half
 * none of them reaches: `userinfosOf`, `hiddenUserinfos` and `withoutUserinfos`.
 */
function messagePass(message: string, url: string) {
  const whole = counted(() => void redactUrlInMessage(message, url));
  const urlRoute = counted(() => void redactUrl(url));
  return {
    size: message.length + url.length,
    copied: whole.copied - urlRoute.copied,
    slices: whole.slices - urlRoute.slices,
    restarts: whole.restarts - urlRoute.restarts,
    elapsed: whole.elapsed,
    urlRouteCopied: urlRoute.copied,
  };
}

/**
 * One `@` per unit in a slot the emitted url DROPS and the message keeps, and
 * one embedded credential whose needle is as long as the caller made it.
 *
 * EVERY BYTE IS REMOTE. `response.url` after a redirect is the text a server
 * chose, and the message is the platform's own serialization of it — which is
 * why the trailing `\q` is there: the parser folds it, so the href differs from
 * the input and `replaceAll` cannot remove the url from the message. That is the
 * documented state the userinfo pass is the answer to, not an evasion of it.
 */
function sweepRow(units: number) {
  const url = `${ORIGIN}/go/https://${"p".repeat(units)}:${PASSWORD}@h.test/v1\\q?a=${"@".repeat(units)}`;
  return messagePass(`TypeError: fetch failed for ${quotedOf(url)}`, url);
}

describe("round 22 / H2 — a sixth instrument, on the route the other five do not reach", () => {
  test("R22-H2-02: the message pass copies a bounded number of characters per input character", () => {
    const rows = [500, 1000, 2000, 4000].map((units) => sweepRow(units));

    // NON-VACUITY, TWICE. The instrument reads a quantity the five existing
    // ones cannot: every one of them wraps `redactUrl`, and `redactUrl` on this
    // very input is flat in the same sweep.
    const urlRatios = rows.map((row) => row.urlRouteCopied / row.size);
    expect(urlRatios[3]! / urlRatios[0]!).toBeLessThan(2);
    // AND THE PASS REALLY IS ON THIS INPUT, said with a quantity a fix does not
    // move. `restarts` is the distance `withoutUserinfos` walks the message
    // with `indexOf("@")`, which is the loop this finding is about and is the
    // same number before and after any change to what the loop does per `@`. A
    // non-vacuity row that read the DEFECT instead — the candidate cuts — is
    // the shape that made four instruments in round 20 and a fifth in round 21
    // unable to survive their own fix.
    expect(rows[0]!.restarts).toBeGreaterThan(rows[0]!.size);

    // THE BOUND. Characters copied per input character, over an eightfold
    // sweep. A reader that spends a constant per character keeps this flat; one
    // whose spend is the product of two remote quantities multiplies it by the
    // sweep factor.
    const ratios = rows.map((row) => row.copied / row.size);
    const climbing =
      ratios[3]! > 2 * ratios[0]!
        ? [`copied/char: ${ratios.map((ratio) => ratio.toFixed(1)).join(" -> ")}`]
        : [];
    expect(climbing).toEqual([]);
  }, 30_000);

  test("R22-H2-02: wall time is the cross-check a flat reading needs", () => {
    // ANTI-PATTERN 13. Time per character is coarse and it is the only number
    // that sees every quantity, including the allocation the copy pays for and
    // no counter here can reach.
    const small = sweepRow(500);
    const large = sweepRow(2000);
    const perChar = (row: { elapsed: number; size: number }) => row.elapsed / row.size;
    // Generous: a linear reader keeps the ratio inside one order of magnitude
    // across a fourfold sweep.
    const climbing =
      perChar(large) > 10 * perChar(small) + 0.01
        ? [`ms/char: ${perChar(small).toFixed(5)} -> ${perChar(large).toFixed(5)}`]
        : [];
    expect(climbing).toEqual([]);
  }, 30_000);
});

// ── 3. The two routes crossed, value by value ──────────────────────────────

/**
 * Every value `redactUrl` and `redactUrlInMessage` read from the SAME scanner
 * call, with the question round 21 proved has to be asked of each: do the two
 * routes SPEND it the same way?
 *
 * `spend` is a url; `url` names what the emitted value must lose, and `message`
 * names what a message quoting the platform's spelling must lose. Where the two
 * routes are allowed to differ the row says so and pins the difference.
 */
const SHARED_VALUES = [
  {
    value: "the SEAM span — `seamUserinfo(parsed, spilled)`, one function, both callers",
    url: `file:///svc:${PASSWORD}@internal.test/v1`,
  },
  {
    value: "`spilled` — a `\\` the caller wrote inside this url's own authority",
    url: `https://alice:\\${PASSWORD}@api.test/p`,
  },
  {
    value: "`consumed` — a reference that brought its own mark, so the parser ate it",
    url: `//https:/svc:${PASSWORD}@internal.test/v1`,
  },
  {
    value: "span.start — a region the grammar opens at a special scheme's colon",
    url: `${ORIGIN}/go/https:/svc:${PASSWORD}@h.test/v1`,
  },
  {
    value: "span.end — the width is the url route's, the last `@` is the message route's",
    url: `${ORIGIN}/go/https://svc:${PASSWORD}@/v1`,
  },
  {
    value: "the CLIP — a span found past the path is query text the url route drops whole",
    url: `${ORIGIN}/v1?next=https://cdn.test/u/svc:${PASSWORD}@h.test/x`,
  },
  {
    value: "the PASS COUNT — the url route loops to a fixed point, the message route asks once",
    url: `file:///x@./alice:${PASSWORD}@internal.test/v1`,
  },
  {
    value: "the TEXT — the path alone, or the path and the slot the outer `?` cut it from",
    url: TAIL_SHAPES[0].url,
  },
] as const;

describe("round 22 / H2 — the values both routes read from one call", () => {
  test("R22-H2 cross: every shared value is spent by both routes", () => {
    const kept: string[] = [];
    for (const row of SHARED_VALUES) {
      if (redactUrl(row.url).includes(PASSWORD)) kept.push(`url: ${row.value}`);
      const parsed = parseEither(row.url);
      // Both spellings a message can quote: the caller's own text, and the one
      // the URL parser serialized. The second is the one the pass exists for.
      const quotes = new Set([row.url, parsed === null ? row.url : parsed.href]);
      for (const quoted of quotes) {
        if (!quoted.includes(PASSWORD)) continue;
        if (
          redactUrlInMessage(`TypeError: fetch failed for ${quoted}`, row.url).includes(PASSWORD)
        ) {
          kept.push(`message: ${row.value}`);
        }
      }
    }
    expect(kept).toEqual([]);
  });

  test("R22-H2 cross: the one difference round 21 settled is still a difference", () => {
    // NOT EVERY VALUE IS SPENT ALIKE, and this is the row that may not be
    // "fixed". A span is a POSITION to `redactUrl` and `pastFiller` closes it
    // past the filler behind its `@`; a needle is TEXT and can only end at an
    // `@`. The two answers differ by design, and both are right.
    const url = `${ORIGIN}/go/https://svc:${PASSWORD}@/v1`;
    const path = new URL(url).pathname;
    const spans = userinfoSpans(path).map((span) => path.slice(span.start, span.end));
    expect(spans).toEqual([`svc:${PASSWORD}@/`]);
    // And the message route still loses the credential, from the needle the
    // same span is cut back to.
    expect(redactUrlInMessage(`boom ${path} boom`, url)).not.toContain(PASSWORD);
  });
});

// ── 4. The grid: round 21's three changes crossed with what predates round 20

/**
 * ONE FRAGMENT PER CONDITION THAT PREDATES ROUND 20, chosen so any two or three
 * concatenate into one url. Round 20's grid crossed its own six changes with
 * each other; round 21's crossed its two with round 20's seven. This is the
 * half neither covered.
 */
const FRAGMENTS = [
  // nextAuthority / authorityAt / isSpecialScheme — the region OPENINGS (r10, r12)
  `https://svc:${PASSWORD}@h.test/`,
  `https:/svc:${PASSWORD}@h.test/`,
  `https:svc:${PASSWORD}@h.test/`,
  `//svc:${PASSWORD}@h.test/`,
  `://svc:${PASSWORD}@h.test/`,
  `file:/svc:${PASSWORD}@h.test/`,
  // looksLikeUserinfo — its three rules, and the base64 residual (r9, r10, r11)
  "users/@alice/",
  "@scope/pkg/",
  "tok@",
  "YWxpY2U/cGFzc3dvcmQ@h.test/",
  // parsesAsAuthority — a region the parser can read, and one it cannot (r12)
  `https://alice:${PASSWORD}://x@i.test/`,
  "https://YWxpY2U/cGFzc3dvcmQ://x@h.test/",
  // pastFiller and the dot segments (r14, r16)
  "@./",
  "@../",
  "///@../",
  // seamSpan and its drive-letter carve-out (r13)
  "c:/Users/alice@corp/",
  // segmentUserinfos and RES-6 — a span that covers a HOST (r17)
  "cdn.test/u/alice@",
  // the span that ends past its `@`, which is round 21's needle cut
  `https://svc:${PASSWORD}@/`,
  `https://svc:${PASSWORD}@\\v1/`,
  // ordinary path, so a cross can be one condition alone
  "deep/",
  "x:y/",
] as const;

/**
 * The outer shapes, chosen to ACTIVATE round 21's three changes on this route:
 * the needle cut, the seam's hierarchical guard, and the head's authority
 * guard. The last four are opaque urls, which is the state round 21 taught both
 * guards about.
 */
const OUTER = [
  (body: string) => `${ORIGIN}/x/${body}v1`,
  (body: string) => `${ORIGIN}/x/${body}v1?q=1`,
  (body: string) => `${ORIGIN}/x/${body}v1#f`,
  (body: string) => `https://svc:${PASSWORD}@api.test/x/${body}v1`,
  (body: string) => `file:///x/${body}v1`,
  (body: string) => `//api.test/x/${body}v1`,
  (body: string) => `git://svc:hun\\ter2@api.test/x/${body}v1`,
  (body: string) => `mailto:${body}`,
  (body: string) => `urn:${body}`,
] as const;

/**
 * The classes of wrong answer one url can produce, asked of the module's own
 * answers so that no planted string has to be calibrated.
 *
 *  - `redactUrl` is a fixed point of itself, never throws, never moves the host.
 *  - EVERY NEEDLE ENDS AT AN `@`, because `withoutUserinfos` tests a message
 *    slice only there.
 *  - EVERY USERINFO THE SCANNER FOUND IN A TEXT IS SPENT ON THAT TEXT.
 *  - AND THE TWO ROUTES READ ONE TEXT: a span the url route's own entry point
 *    finds in `path + tail` is a userinfo the message route has to spend too.
 */
function classesOf(url: string, answers: { n: number }): Set<string> {
  const bad = new Set<string>();
  let redacted: string;
  try {
    redacted = redactUrl(url);
    answers.n += 1;
  } catch {
    bad.add("throw:url");
    return bad;
  }
  try {
    answers.n += 1;
    if (redactUrl(redacted) !== redacted) bad.add("fixedpoint");
  } catch {
    bad.add("throw:fixedpoint");
  }
  const parsed = parseEither(url);
  if (parsed !== null && parsed.host !== "" && redacted.startsWith(`${parsed.protocol}//`)) {
    const again = parseEither(redacted);
    if (again !== null && again.host !== parsed.host) bad.add("movedhost");
  }
  const path = parsed === null ? url : parsed.pathname;
  const tail = parsed === null ? "" : parsed.search + parsed.hash;
  const userinfos: string[] = [];
  const collect = (text: string, spans: readonly { start: number; end: number }[]) => {
    for (const span of spans) {
      const needle = text.slice(span.start, span.end);
      if (needle.length > 1 && !needle.endsWith("@")) bad.add("unmatchable-needle");
      const at = text.lastIndexOf("@", span.end - 1);
      if (at < span.start) continue;
      const userinfo = text.slice(span.start, at + 1);
      // A userinfo the emitted url KEEPS is a path this module keeps on both
      // routes, and only what the url route removed has to leave the message.
      if (userinfo.length > 1 && !redacted.includes(userinfo)) userinfos.push(userinfo);
    }
  };
  collect(path, userinfoSpans(path));
  const whole = tail === "" ? path : path + tail;
  collect(whole, pathUserinfoSpans(path, tail, null));
  if (userinfos.length > 0) {
    answers.n += 1;
    let out = "";
    try {
      out = redactUrlInMessage(`boom ${whole} boom`, url);
    } catch {
      bad.add("throw:message");
    }
    for (const userinfo of userinfos) if (out.includes(userinfo)) bad.add("unspent-needle");
  }
  return bad;
}

describe("round 22 / H2 — the grid, round 21's changes crossed with what predates round 20", () => {
  test("R22-H2 grid: no interaction produces a class its parts do not", () => {
    const answers = { n: 0 };
    const solo = new Map<string, Set<string>>();
    for (const [index] of OUTER.entries()) {
      for (const fragment of FRAGMENTS) {
        solo.set(`${index}|${fragment}`, classesOf(OUTER[index]!(fragment), answers));
      }
    }
    const unknown = new Set<string>();
    // TWO CLASSES THE CROSS IS ALLOWED TO ADD. `unspent-needle` is section 1's
    // finding: a userinfo only `path + tail` names, which the message route
    // never reads. `unmatchable-needle` is the difference round 21 SETTLED and
    // did not close — a span is a position and closes past the filler behind
    // its `@`, and only the needle cut from it has to end at one.
    const known = new Set(["unspent-needle", "unmatchable-needle"]);
    let urls = solo.size;
    const cross = (index: number, parts: readonly string[]) => {
      urls += 1;
      const found = classesOf(OUTER[index]!(parts.join("")), answers);
      const base = new Set(parts.flatMap((part) => [...solo.get(`${index}|${part}`)!]));
      for (const one of found) if (!base.has(one) && !known.has(one)) unknown.add(one);
    };
    for (const index of OUTER.keys()) {
      for (const a of FRAGMENTS) for (const b of FRAGMENTS) cross(index, [a, b]);
    }
    for (const a of FRAGMENTS) {
      for (const b of FRAGMENTS) for (const c of FRAGMENTS) cross(0, [a, b, c]);
    }
    // NON-VACUITY: the grid is the size it claims, and it read that many answers
    // out of the module.
    expect(urls).toBe(9 * 21 + 9 * 21 * 21 + 21 * 21 * 21);
    expect(answers.n).toBeGreaterThan(30_000);
    expect([...unknown]).toEqual([]);
  }, 60_000);
});
