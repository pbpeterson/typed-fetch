import http from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, test } from "vitest";
import { redactUrl } from "../../src/errors/redact-url";
import { isHttpError, typedFetch } from "../../src/index";

// ═══════════════════════════════════════════════════════════════════════════
// ROUND 18 — H2. THE CODE ROUND 17 CHANGED, read again from scratch.
//
// Round 17 changed three things in `./userinfo-spans`, and two of them are
// this lane's subject:
//
//   1. `popsBefore` stopped reading the colon as a CHARACTER and started
//      reading it as a grammar, with two floors — `run - 1` behind a special
//      scheme's colon, `run - 2` everywhere else. That gave the crossing a
//      budget behind a colon, where round 16 had given it none.
//   2. `readsAsHostAndPort` was added, to suppress `looksLikeUserinfo`'s colon
//      rule where the region's own text is an authority the parser reads. It
//      carries three conditions and it protects six named pinned answers.
//
// The two were built in one commit and they were not composed. Round 16's
// crossing moves the region's START forward without moving the TEXT; round
// 17's new question reads the text BEHIND that start. So every region a
// crossing resumes into is handed a mark the rebuild has not made yet — the
// `.` of an un-performed double dot instead of the scheme colon — and round
// 17's suppression is silently off. Section 1 is that input, and it is the
// url round 17 fixed with four characters put back in front of it.
//
// Section 2 is the same function's other half. Its second condition is a
// `lastIndexOf("@", …)`, which walks BACKWARDS to index 0 whenever no `@`
// precedes the region — the exact shape `userinfoSpans`' own comment already
// condemns and already solved with a forward pass and a binary search. One
// call per region, and a `Location` a server chooses can spell N of them.
//
// Section 3 is the first of the three conditions read against its own
// sentence. Sections 4 to 7 are the cleared halves of the lane: the floors,
// the other two conditions, the named `//` gap with its residue redrawn, the
// termination bound, and the relative branch's ownership.
//
// NOTHING HERE IS A TIME RATIO. Every claim is a count — parses, rebuilds, or
// characters walked backwards — read through the platform seam round 15
// opened: this module names `URL` as a global and resolves it on every call,
// and `String.prototype.lastIndexOf` is a global in the same sense.
// ═══════════════════════════════════════════════════════════════════════════

const ORIGIN = "https://api.test";

/**
 * One `redactUrl`, with four numbers read off the platform.
 *
 * REBUILDS AND PROBES ARE SEPARATED, and that separation is what makes section
 * 2 a finding rather than a re-report. A rebuild is one pass of `cleaned` —
 * `new URL(origin + clean)` — and it multiplies a whole-string scan. A probe is
 * `parsesAsAuthority`, one `new URL("https://" + slice)` per region, which is
 * linear in the marks and is meant to be. Round 16 and round 17 both found a
 * defect in the REBUILD count; section 2's defect leaves both counts exactly
 * where they should be and spends the time somewhere neither instrument looks.
 *
 * THE BACKWARD WALK IS THE THIRD NUMBER. `lastIndexOf(search, position)` reads
 * from `position` towards index 0 and stops at the first hit, so
 * `position - result` is the number of characters it looked at. Summed over a
 * call, it is the work no parse count can see.
 */
function measure(url: string, origin = ORIGIN) {
  const nativeUrl = globalThis.URL;
  const nativeLastIndexOf = String.prototype.lastIndexOf;
  let rebuilds = 0;
  let probes = 0;
  let backwardCalls = 0;
  let backwardWalk = 0;
  class Watched extends nativeUrl {
    constructor(argument: string | URL, base?: string | URL) {
      super(argument, base);
      if (base !== undefined) return;
      if (String(argument).startsWith(origin)) rebuilds += 1;
      else probes += 1;
    }
  }
  String.prototype.lastIndexOf = function (this: string, search: string, position?: number) {
    const found = nativeLastIndexOf.call(this, search, position);
    if (search === "@") {
      backwardCalls += 1;
      const from =
        position === undefined || Number.isNaN(position)
          ? this.length - 1
          : Math.min(position, this.length - 1);
      backwardWalk += from - found;
    }
    return found;
  } as typeof String.prototype.lastIndexOf;
  globalThis.URL = Watched as unknown as typeof URL;
  let answer = "";
  try {
    answer = redactUrl(url);
  } finally {
    globalThis.URL = nativeUrl;
    String.prototype.lastIndexOf = nativeLastIndexOf;
  }
  return { answer, length: url.length, rebuilds, probes, backwardCalls, backwardWalk };
}

// ── 0. THE GENERATORS, COMMITTED ─────────────────────────────────────────────
//
// Round 16 cited 119,070 urls that nothing reproduces and round 17 could not
// redraw them. So every population this file counts is built by a function in
// this file, from a fixed seed or from a full cross product, and re-running the
// spec redraws it exactly.

/** mulberry32. A fixed seed draws the same corpus on every runtime, forever. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SECRET = "hunter2";

/** The parts every population below is spelled from. */
const ORIGINS = ["https://api.test", "http://api.test", "file://", "", "//"];
const MARKS = ["://", ":/", ":", "//", "///", "/", "\\\\", ":\\\\"];
const SCHEMES = ["https", "http", "ws", "ftp", "file", "git", "a", "9", "", "HTTPS"];
const HOSTS = ["cdn.test", "internal.test", "h.test", "a", "x", "YWxpY2U"];
const PORTS = ["", ":8443", ":1", ":99999", ":0", ":s3cret"];
const CREDENTIALS = ["", `svc:${SECRET}@`, `${SECRET}@`, `:${SECRET}@`, "alice@", "TOK@"];
const SEGMENTS = ["v1", "users", "@alice", "..", ".", "%2e%2e", "@..", "img", "@", "c:"];
const TAILS = ["", "?token=q", "#f", "?a=b@c", "/@alice"];

/** An origin and one to four embedded-url shapes: the structured grammar. */
function structuredUrl(next: () => number): string {
  const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)]!;
  let path = "";
  for (let part = 1 + Math.floor(next() * 4); part > 0; part -= 1) {
    if (next() < 0.5) path += `/${pick(SEGMENTS)}`;
    path += `/${pick(SCHEMES)}${pick(MARKS)}${pick(CREDENTIALS)}${pick(HOSTS)}${pick(PORTS)}`;
    if (next() < 0.6) path += `/${pick(SEGMENTS)}`;
  }
  return `${pick(ORIGINS)}${path}${pick(TAILS)}`;
}

/** A solidus run behind an optional mark, then dot-and-mark groups. */
function crossingUrl(next: () => number): string {
  const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)]!;
  const head = pick(["/x", "/x/https:", "/x/ws:", "/x/git:", "/x/:", "/x/9:", "/x/HTTPS:", ""]);
  const unit = pick(["@../", "@./", "@/", `svc:${SECRET}@../`, "@%2e%2e/", "@.%2e/", "@../../"]);
  const run = "/".repeat(1 + Math.floor(next() * 5));
  const groups = 1 + Math.floor(next() * 4);
  return `${pick(ORIGINS)}${head}${run}${unit.repeat(groups)}${pick(SEGMENTS)}${pick(TAILS)}`;
}

/** The two grammars, interleaved, from seed 18. */
function corpus(rows: number): string[] {
  const next = rng(18);
  const drawn: string[] = [];
  for (let row = 0; row < rows; row += 1) {
    drawn.push(row % 2 === 0 ? structuredUrl(next) : crossingUrl(next));
  }
  return drawn;
}

// ── 1. R18-H2-01 — a crossing turns round 17's suppression off ───────────────
//
// `https://api.test/go/https://cdn.test:8443/users/@alice` is round 17's own
// url, and `redaction-embedded-authority-port.spec.ts` pins the answer: the url unchanged.
// Its comment states the harm the pin exists to prevent — "a forward to the
// host `alice`, which the request never contacted and which is a user's handle
// rather than a host at all".
//
// Put a `..` in front of the embedded authority and the pin still holds: no `@`
// is removed, so nothing crosses. Put an EMPTY USERINFO in front of the `..` —
// four characters, `@../`, the exact unit round 16's crossing was built for —
// and the answer becomes `https://api.test/go/https:/alice`.
//
// ONE PASS OF THE LOOP, read off its own arguments:
//
//   /go/https://@../cdn.test:8443/users/@alice
//        ^ region start, `popsBefore` = run - 1 = 1 crossing
//   the `@` at the start goes; `cut` stops in front of the `..`
//   the crossing spends the budget: `pastOnePop` walks the `..` and its solidus
//   `open` and `cut` resume at `cdn.test:8443`
//   `looksLikeUserinfo` asks `readsAsHostAndPort(text, cut)`, and
//   `beforeSolidi` walks back over the single solidus onto the `.` of the `..`
//   the mark is not a colon, so the suppression declines, the colon rule fires,
//   and the span runs to the `@` of the handle.
//
// The slow spelling asks the same question of the text the REBUILD produced,
// where the `..` has been performed and the mark is the scheme colon, so it
// answers the other way. That is the whole defect: the crossing is a COST fix,
// its own comment says "the answer is a fact about the slow spelling and a cost
// fix may not move it", and it moves it.
//
// THE RULE THE CROSSING NEEDS is not stated anywhere in the module: a crossing
// may only be spent where every question the resumed region asks reads FORWARD
// from the cursor. `beforeSolidi` is the one that does not, and it has two
// callers — `popsBefore`, which is asked once per region and before any
// crossing, and `readsAsHostAndPort`, which round 17 added and which is asked
// after every one of them.

const PORT_URL = "https://api.test/go/https://cdn.test:8443/users/@alice";

describe("the crossing hands `readsAsHostAndPort` the wrong mark", () => {
  test("R18-H2-01: an empty userinfo in front of a `..` costs the embedded host", () => {
    // THE PIN ROUND 17 PUT IN, restated here so the failure below cannot be
    // read as a disagreement about what the answer should be.
    expect(redactUrl(PORT_URL)).toBe(PORT_URL);

    // THE CONTROL. The same url with a `..` in front of the authority. Nothing
    // is removed, so nothing crosses, and the authority survives the dot
    // segment the rebuild performs.
    expect(redactUrl("https://api.test/go/https://../cdn.test:8443/users/@alice")).toBe(
      "https://api.test/go/https:/cdn.test:8443/users/@alice",
    );

    // THE TWIN. One character more — the empty userinfo `@`, which names
    // nothing and which this module removes as a matter of course — and the
    // authority is gone and the handle is named as the host.
    expect(redactUrl("https://api.test/go/https://@../cdn.test:8443/users/@alice")).toBe(
      "https://api.test/go/https:/cdn.test:8443/users/@alice",
    );
  });

  test("R18-H2-01: the label the record invents is the server's to choose", () => {
    // The harm is not that a segment goes. It is that what is LEFT reads as an
    // authority, and every character of it came from the far side of the `@`.
    expect(redactUrl("https://api.test/go/https://@../cdn.test:8443/u/@evil.test/x")).toBe(
      "https://api.test/go/https:/cdn.test:8443/u/@evil.test/x",
    );
  });

  test("R18-H2-01: 640 of 1,200 protected rows lose their authority to a crossing", () => {
    // THE POPULATION IS A FULL CROSS PRODUCT, so it is redrawn exactly by
    // reading this loop. Each row is a forward to an authority the parser reads
    // whole, under a scheme mark, followed by an `@` at a segment head — the
    // class round 17's three conditions exist to protect.
    //
    // THE CONTROL IS THE ROW'S OWN TWIN, so no second checkout is needed: the
    // same url with the empty userinfo taken out of the filler. A row only
    // enters the count when the control KEEPS the host, which is round 17's
    // promise, and it fails when the twin loses it.
    const schemes = ["https", "http", "ws", "ftp", "HTTPS"];
    const runs = [1, 2, 3, 4, 5];
    const authorities = [
      ["cdn.test:8443", "cdn.test"],
      ["h.test:1", "h.test"],
      ["[::1]", "::1"],
      ["c:", "c:"],
    ];
    const tails = ["/users/@alice", "/@alice", "/img/@bob", "/u/v/@carol"];
    const fillers = ["../", "%2e%2e/", "../../"];

    let protectedRows = 0;
    const lost: string[] = [];
    for (const scheme of schemes) {
      for (const run of runs) {
        for (const [authority, label] of authorities) {
          for (const tail of tails) {
            for (const filler of fillers) {
              const head = `${ORIGIN}/go/${scheme}:${"/".repeat(run)}`;
              const control = `${head}${filler}${authority}${tail}`;
              if (!redactUrl(control).includes(label!)) continue;
              protectedRows += 1;
              const twin = `${head}@${filler}${authority}${tail}`;
              if (!redactUrl(twin).includes(label!)) lost.push(`${twin} -> ${redactUrl(twin)}`);
            }
          }
        }
      }
    }

    expect(protectedRows).toBe(1200);
    expect({ lost: lost.length, first: lost.slice(0, 3) }).toEqual({ lost: 0, first: [] });
  });
});

// ── 2. R18-H2-02 — the second condition walks the whole prefix, per region ───
//
//   function readsAsHostAndPort(text, start) {
//     const mark = beforeSolidi(text, start);
//     if (text[mark] !== ":" || !isSchemeCharacter(text[mark - 1])) return false;
//     if (text.lastIndexOf("@", authorityEnd(text, start) - 1) >= start) return false;
//     return parsesAsAuthority(text, start);
//   }
//
// The middle line is a BACKWARD SCAN with no floor. Where the text holds no `@`
// in front of the region, it reads every character from the region back to
// index 0 and answers -1. `userinfoSpans` names that exact shape as the reason
// it collects every `@` in one forward pass and locates them with `lastBelow`:
// "`lastIndexOf("@", stop - 1)` walks to index 0 whenever a region holds no
// `@`, and 96 KB of repeated marks took 855 ms against 0.23 ms for one forward
// pass." The answer this line needs is already computed — the `ats` array — and
// round 17 asked the question a second way.
//
// THE SHAPE. `/ws:a:1` repeated, then `/@b`. Each unit opens a region: `ws:` is
// a special scheme, so `authorityAt` opens over ZERO solidi, and `a:1` is an
// authority the parser reads with a colon before its first solidus — so every
// region reaches the colon rule and every one of them calls this function. The
// `@` sits at the far end, and it is preceded by a `/`, so no region can end on
// it and nothing is ever removed: the answer is the input, a fixed point, and
// every character walked is work that buys nothing.
//
// NO `://` ANYWHERE IN IT, which is what keeps every region unbounded and is
// why the two-solidus spelling of the same forward is linear: with a `://` in
// the text `stop` bounds each region, `lastBelow` answers -1, and the candidate
// is never asked about. This is the slash-collapsed spelling — the one
// `userinfoSpans`' own header says "every slash-collapsing proxy and every
// `path.join`" produces.
//
// CLOSED IN ROUND 20, BY THE SENTENCE ABOVE. The paragraph names the whole
// defect without naming the fix: the two spellings of ONE embedded url differ
// only in a solidus, and only one of them bounded the region. R20-H2-01 asks
// `nextSchemeAuthority` for the bound instead of scanning for three literal
// characters, so a colon mark bounds a region under any solidus count and the
// slash-collapsed spelling is now as linear as the other one. The condition is
// unchanged and its floor is unchanged; it is simply never reached. The pin
// below is inverted to hold the closure and states what turns it red again.

function probePath(units: number): string {
  return `/x${"/ws:a:1".repeat(units)}/@b`;
}

describe("the host-and-port question is asked where a url starts", () => {
  test("R18-H2-02: the backward walk does not grow with a server's path at all", () => {
    // THIS PIN'S SUBJECT NO LONGER EXISTS, AND THE PIN IS INVERTED RATHER THAN
    // DELETED. Round 18 measured one backward `lastIndexOf("@", …)` per region
    // and N regions in a path the SERVER chose: 500, 1,000 and 2,000 calls at
    // the three sizes below, growing exactly with the mark count.
    //
    // R20-H2-01 removed the reason the question was ever reached. A region's
    // END used to be the three literal characters `://`, which `/ws:a:1` never
    // writes, so every region ran to the end of the text, every region's
    // candidate `@` was the last one in the whole string, and every region
    // therefore reached the colon rule. The end is now `nextSchemeAuthority` —
    // the colon mark under ANY solidus count — so each region is bounded by the
    // next `ws:` and holds no candidate at all. The question is asked ONCE,
    // whatever the path costs, and `readsAsHostAndPort` is the only caller.
    //
    // SO THE ASSERTION IS THE CONSTANT AND NOT A BOUND. `[1, 1, 1]` is red the
    // moment a per-region backward search returns, at [500, 1000, 2000]; a
    // per-region bound of "eight characters" would have stayed green through
    // exactly that regression, which is why the count is pinned and not the
    // work. The walked characters are pinned the same way, at a flat 3.
    const rows = [500, 1000, 2000].map((units) => {
      const url = ORIGIN + probePath(units);
      return { units, ...measure(url) };
    });

    // NON-VACUITY. Nothing is redacted at any size — the answer is the input —
    // so a tree that stopped reading this text would report the same zeros.
    for (const row of rows) expect(row.answer).toBe(ORIGIN + probePath(row.units));

    // THE TWO INSTRUMENTS ROUNDS 16 AND 17 USED ARE BOTH STILL GREEN, and both
    // are unmoved. One rebuild at every size, so `cleaned`'s bound is untouched;
    // one probe per region, which is the linear cost `parsesAsAuthority` is
    // supposed to have and which round 20 did not buy this fix with.
    expect(rows.map((row) => row.rebuilds)).toEqual([1, 1, 1]);
    expect(rows.map((row) => row.probes)).toEqual([500, 1000, 2000]);

    // AND THE BACKWARD SEARCH IS NOW SIZE-INDEPENDENT, on both counts.
    expect(rows.map((row) => row.backwardCalls)).toEqual([1, 1, 1]);
    expect(rows.map((row) => row.backwardWalk)).toEqual([3, 3, 3]);

    // The bound round 18 wrote, kept as the weaker statement it always was: a
    // linear reader looks at each character a bounded number of times. It
    // passed before the fix too, which is the whole reason the counts above are
    // exact.
    const overLinear = rows
      .filter((row) => row.backwardWalk > 8 * row.length)
      .map((row) => `${row.units} units, ${row.length} chars: ${row.backwardWalk} walked`);
    expect(overLinear).toEqual([]);
  });

  test("R18-H2-02: one `toJSON()` of a 14 KB redirect target stays within the bound", async () => {
    const server = http.createServer((request, response) => {
      const path = request.url ?? "/";
      if (path.startsWith("/go/")) {
        response.writeHead(302, { location: path.slice("/go".length) });
        response.end();
        return;
      }
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("no");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    try {
      const { error } = await typedFetch(`${origin}/go${probePath(2000)}`);
      if (!error || !isHttpError(error)) throw new TypeError("expected an http error");
      try {
        // THE INPUT IS REMOTE, and it arrived unchanged: `ws:` inside a path is
        // an ordinary segment and `a:1` is another, so the platform's own
        // redirect parse normalises nothing away before the library sees it.
        expect(error.url).toBe(`${origin}${probePath(2000)}`);

        const native = String.prototype.lastIndexOf;
        let walk = 0;
        String.prototype.lastIndexOf = function (this: string, search: string, position?: number) {
          const found = native.call(this, search, position);
          if (search === "@" && position !== undefined) {
            walk += Math.min(position, this.length - 1) - found;
          }
          return found;
        } as typeof String.prototype.lastIndexOf;
        try {
          error.toJSON();
        } finally {
          String.prototype.lastIndexOf = native;
        }

        // One structured log line, one `redactUrl`, and this many characters
        // read backwards over a 14 KB string. The constructor already paid it
        // once for `message`.
        expect(walk).toBeLessThanOrEqual(8 * error.url.length);
      } finally {
        await error.cancel();
      }
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 60_000);
});

// ── 3. R18-H2-03 — the first condition reads a character, not a scheme ───────
//
// The condition's own sentence: "THE MARK SPELLS A SCHEME. … it is sound only
// where the text invoked a parse at all: behind `https://`, `https:/`, or
// `git://`, `cdn.test:8443` is an authority someone wrote. Behind a bare pair
// of solidi, or behind the empty scheme a template leaves (`://a:1234/x/@bob`),
// no scheme wrote a port and the reading is the module's own assumption."
//
// The code asks `isSchemeCharacter(text[mark - 1])` — ONE character. A URL
// scheme is ALPHA followed by ALPHA / DIGIT / `+` / `-` / `.`, so `9:`, `.:`,
// `-:` and `9x:` are tokens no URL parser reads as a scheme anywhere, and every
// one of them satisfies this condition. `://` — the one the sentence names —
// does not. Two spellings of "no scheme wrote a port" answer differently, and
// the module's own list of five is two lines away in `isSpecialScheme`.
//
// THE REMEDY CAN BE EITHER SIDE, and this is written down because the tests
// below choose one. They assert the SENTENCE's rule, on the module's own
// argument that a `true` from `parsesAsAuthority` may only NARROW a region
// "where the text invoked a parse at all" — and `9://cdn.test:8443` invokes
// none, since a scheme cannot begin with a digit and the parser reads the whole
// token as a path segment. A round that decides the other way — that any token
// before a colon is close enough to a scheme — owes residual 1's `://a:1234`
// bullet the same answer, and owes these two tests an edit.

describe("a mark that spells no scheme still suppresses the rule", () => {
  test("R18-H2-03: `9:` buys the parse's reading and the empty scheme does not", () => {
    // The pinned residual: no scheme, so the module's assumption stands and the
    // region is over-redacted. `looksLikeUserinfo` names this url by hand.
    expect(redactUrl(`${ORIGIN}/go/://a:1234/x/@bob`)).toBe(`${ORIGIN}/go/://bob`);

    // The same url with a digit in front of the colon. No parser reads `9:` as
    // a scheme — a scheme cannot start with a digit — so by the sentence above
    // nothing here invoked a parse and the answer must be the same shape.
    const digit = redactUrl(`${ORIGIN}/go/9://a:1234/x/@bob`);
    const dot = redactUrl(`${ORIGIN}/go/.://a:1234/x/@bob`);
    expect([digit, dot]).toEqual([`${ORIGIN}/go/9://bob`, `${ORIGIN}/go/.://bob`]);
  });

  test("R18-H2-03: and it carries the `/`-terminated credential residual with it", () => {
    // The span the suppression can lose is the one `looksLikeUserinfo` records
    // as open — a credential whose last character is `/`. Behind a real scheme
    // that is round 17's accepted cost. Behind `9:` it is a cost the sentence
    // says was never paid for.
    const kept = redactUrl(`${ORIGIN}/go/9://a:1234/x/dG9rZW4vcGFzc3dvcmQ/@h.test/v1`);
    const gone = redactUrl(`${ORIGIN}/go/://a:1234/x/dG9rZW4vcGFzc3dvcmQ/@h.test/v1`);
    expect(gone).toBe(`${ORIGIN}/go/://h.test/v1`);
    expect(kept).toBe(`${ORIGIN}/go/9://h.test/v1`);
  });
});

// ── 4. THE FLOORS, RE-ENUMERATED AND CLEARED ─────────────────────────────────
//
// `popsBefore` has two floors and they are `authorityAt`'s own. The arithmetic
// each one claims is a claim about the SLOW spelling: a run of `run` solidi
// spells `run - 1` empty segments in front of the segment that wrote it, each
// pass removes one `@` and the rebuild performs one pop, and the region stops
// re-opening when the pop that would shorten the run takes something the
// opening needs.
//
//  - Behind a SPECIAL scheme's colon the region opens at any run including
//    none, so what ends it is the pop that takes the scheme's own segment,
//    which is the pop made at run 1: `run - 1` re-openings.
//  - Everywhere else two solidi are needed, so the last opening is at run 2:
//    `run - 2`.
//
// Both are exact, and this section is the measurement: the pass count is
// CONSTANT as the group count grows, for every spelling of the mark, which is
// what an exact budget buys and what an undercount would break. What is NOT
// exact is where the budget leaves the cursor — section 1.

describe("the two floors hold the pass count constant", () => {
  const groupsAfter = (run: string, groups: number) =>
    `${run}${"/".repeat(2 * groups)}${"@../".repeat(groups)}v1`;

  const SPELLINGS: Record<string, (groups: number) => [string, string]> = {
    "a bare run": (n) => [`${ORIGIN}${groupsAfter("/x", n)}`, ORIGIN],
    "a special scheme's colon": (n) => [`${ORIGIN}${groupsAfter("/x/https:", n)}`, ORIGIN],
    "its uppercase spelling": (n) => [`${ORIGIN}${groupsAfter("/x/HTTPS:", n)}`, ORIGIN],
    "the two-character scheme": (n) => [`${ORIGIN}${groupsAfter("/x/ws:", n)}`, ORIGIN],
    "a scheme the grammar never heard of": (n) => [`${ORIGIN}${groupsAfter("/x/git:", n)}`, ORIGIN],
    "the empty scheme a template leaves": (n) => [`${ORIGIN}${groupsAfter("/x/:", n)}`, ORIGIN],
    "a digit-led token": (n) => [`${ORIGIN}${groupsAfter("/x/9:", n)}`, ORIGIN],
    "a Windows drive letter": (n) => [`file://${groupsAfter("/c:", n)}`, "file://"],
    "the backslash spelling of the run": (n) => [
      `${ORIGIN}/x${"\\".repeat(2 * n)}${"@../".repeat(n)}v1`,
      ORIGIN,
    ],
    "two pops per group": (n) => [
      `${ORIGIN}/x${"/".repeat(4 * n)}${"@../../".repeat(n)}v1`,
      ORIGIN,
    ],
    "the encoded pop": (n) => [`${ORIGIN}/x${"/".repeat(2 * n)}${"@%2e%2e/".repeat(n)}v1`, ORIGIN],
    "the seam, at an empty host": (n) => [
      `file://${"/".repeat(2 * n)}${"@../".repeat(n)}v1`,
      "file://",
    ],
  };

  test("every spelling of the mark costs the same at 4 groups and at 32", () => {
    const growing: string[] = [];
    for (const [name, make] of Object.entries(SPELLINGS)) {
      const counts = [4, 8, 16, 32].map((groups) => {
        const [url, origin] = make(groups);
        return measure(url, origin).rebuilds;
      });
      if (new Set(counts).size !== 1) growing.push(`${name}: ${counts.join(",")}`);
    }
    expect(growing).toEqual([]);
  });

  test("and each of them answers, and answers a fixed point of itself", () => {
    for (const make of Object.values(SPELLINGS)) {
      const [url] = make(4);
      const once = redactUrl(url);
      expect(once).not.toBe("");
      expect(redactUrl(once)).toBe(once);
    }
  });
});

// ── 5. THE OTHER TWO CONDITIONS, ATTACKED ────────────────────────────────────
//
// Three conditions is three places to be wrong, so each one is attacked with an
// input that satisfies the other two. Condition 1 is section 3. These two hold:
// the attack lands on the documented answer in both cases, and in both cases
// the direction is over-redaction.

describe("conditions two and three answer for their own reason", () => {
  test("an `@` inside the authority keeps the colon a password's", () => {
    // Satisfies condition 1 (a real scheme mark) and condition 3 (`svc:PW@i.test`
    // parses, host `i.test`). Condition 2 refuses it, so the colon rule fires
    // and the credential goes with the span. Residual 1's third shape.
    expect(new URL("https://svc:PW@i.test/").host).toBe("i.test");
    expect(redactUrl(`${ORIGIN}/go/https://svc:PW@i.test/users/@bob`)).toBe(
      `${ORIGIN}/go/https://bob`,
    );
  });

  test("a `%40` is not an `@`, to the parser or to the condition", () => {
    // The one way condition 2 could read a text the parser reads differently:
    // an encoded mark. The parser does not decode inside an authority either —
    // `PW%40i.test` is a port it refuses — so condition 3 declines and the two
    // agree.
    expect(() => new URL("https://svc:PW%40i.test/")).toThrow();
    expect(redactUrl(`${ORIGIN}/go/https://svc:PW%40i.test/users/@bob`)).toBe(
      `${ORIGIN}/go/https://bob`,
    );
  });

  test("a port the parser refuses is not a port", () => {
    // Satisfies conditions 1 and 2. Condition 3 declines, and the region is
    // back to the ambiguity residual 1 records.
    expect(redactUrl(`${ORIGIN}/go/https://a:99999/x/@bob`)).toBe(`${ORIGIN}/go/https://bob`);
    // The same text with a port the parser accepts, so all three hold.
    expect(redactUrl(`${ORIGIN}/go/https://a:1234/x/@bob`)).toBe(
      `${ORIGIN}/go/https://a:1234/x/@bob`,
    );
  });

  test("the authority ends where the grammar ends it, on all four characters", () => {
    // Condition 2 and condition 3 read the same bound — `authorityEnd` — so a
    // `?`, a `#` or a `\` cuts both of them at the same character. If they
    // disagreed, an `@` past the cut would be invisible to one and visible to
    // the other.
    for (const terminator of ["/", "\\", "?", "#"]) {
      const url = `${ORIGIN}/go/https://a:1234${terminator}x/@bob`;
      expect(redactUrl(url)).not.toContain("bob@");
    }
  });
});

// ── 6. THE NAMED GAP, WITH ITS RESIDUE REDRAWN — CLOSED IN ROUND 19 ─────────
//
// A bare `//` region had no scheme mark, so condition 1 declined and the old
// answer stood. Round 17 measured the residue at 504 rows of 97,344 with no
// credential lost, and left the gap open so a later round could widen it one
// condition at a time.
//
// The number cannot be checked — that population is not in the tree — so the
// residue is redrawn here from a cross product this file spells out, and what
// is checked is the PROPERTY the number was cited for: every row in it is
// over-redaction, and none of them costs more than a diagnostic. A row is in
// the residue when the bare `//` spelling loses an authority that the same
// region behind a scheme mark keeps.
//
// ROUND 19 CLOSED THE GAP. R19-H2-02 replaced condition 1's question — did a
// SCHEME write the region's mark — with the question the URL Standard answers:
// did the GRAMMAR write it. A bare `//` opens a protocol-relative authority, so
// the grammar wrote that mark and the region buys the parser's reading. The
// redrawn residue is empty now, and the test below is inverted to say so.

describe("the bare `//` gap is closed, and closing it cost nothing", () => {
  test("no row of the redrawn residue loses the authority any more", () => {
    // CLOSED IN ROUND 19, BY R19-H2-02. Round 18 measured this residue and
    // asserted only that it was over-redaction on every row, with
    // `residue > 0` as the non-vacuity guard that the gap existed. The gap does
    // not exist now: a region a bare `//` opens buys the parser's reading of
    // the authority at its start, exactly as a scheme-marked region does, so
    // the bare spelling keeps every label its scheme-marked twin keeps.
    //
    // THE GUARD IS INVERTED RATHER THAN DROPPED, and it is stronger than the
    // `> 0` it replaces. `reaches` counts the rows where the scheme-marked twin
    // keeps the label at all — the rows on which the question can be asked —
    // and it is pinned exactly, so this test cannot pass by drawing a
    // population that never reaches the shape. `residue` is then the count of
    // rows where the bare spelling loses what the marked one keeps, and one
    // such row turns it red.
    const authorities = ["cdn.test:8443", "h.test:1", "[::1]", "a:1234"];
    const middles = ["/x", "/users", "", "/x/y"];
    const tails = ["/@alice", "/@bob", "/img/@carol", "/dG9rZW4vcGFzc3dvcmQ/@h.test"];
    const credentials = ["", `svc:${SECRET}@`, `${SECRET}@`];

    let rows = 0;
    let reaches = 0;
    let residue = 0;
    const worse: string[] = [];
    for (const authority of authorities) {
      for (const middle of middles) {
        for (const tail of tails) {
          for (const credential of credentials) {
            const body = `${credential}${authority}${middle}${tail}`;
            const bare = redactUrl(`${ORIGIN}/go//${body}`);
            const marked = redactUrl(`${ORIGIN}/go/https://${body}`);
            const label = authority.split(":")[0]!;
            rows += 1;
            if (marked.includes(label)) reaches += 1;
            if (marked.includes(label) && !bare.includes(label)) residue += 1;
            // COSTS MORE THAN A DIAGNOSTIC in exactly two ways: the gap keeps a
            // planted credential the scheme-marked twin removes, or the gap's
            // answer is LONGER than the twin's, which would make it
            // under-redaction rather than over. Both were empty while the gap
            // was open, and closing it left both empty.
            if (bare.includes(SECRET) && !marked.includes(SECRET)) worse.push(`keeps: ${body}`);
            if (bare.length > marked.length - "https:".length) worse.push(`longer: ${body}`);
          }
        }
      }
    }

    expect(worse).toEqual([]);
    expect({ rows, reaches, residue }).toEqual({ rows: 192, reaches: 148, residue: 0 });
  });

  test("and no credential the parser itself reports rides out of the corpus", () => {
    // The corpus's own use: 20,000 urls from the two grammars, and the
    // property is the one round 17 measured for its own populations — a
    // credential the PLATFORM reports is never left in the emitted url. The
    // heuristic's own residuals are not asserted here; they are named in
    // `SECURITY.md` and pinned elsewhere.
    const reported: string[] = [];
    for (const url of corpus(20_000)) {
      let parsed: URL | null = null;
      try {
        parsed = new URL(url);
      } catch {
        continue;
      }
      if (parsed.password === "" && parsed.username === "") continue;
      const answer = redactUrl(url);
      if (parsed.password !== "" && answer.includes(parsed.password)) reported.push(url);
      if (parsed.username !== "" && answer.includes(`${parsed.username}@`)) reported.push(url);
    }
    expect(reported.slice(0, 3)).toEqual([]);
  });
});

// ── 7. THE TERMINATION BOUND, AND THE RELATIVE BRANCH ────────────────────────
//
// A cost finding proves the termination bound separately, or a reader cannot
// tell a quadratic from a hang. Section 2's defect is inside ONE pass, so the
// bound `cleaned` states — `parsed.pathname.length`, strictly decreasing —
// is untouched by it, and this section says so with a measurement rather than
// by leaving it unsaid.
//
// The relative branch is the other half of frontier item 4. Its own loop costs
// one resolution per authority the reference brings, which is the caller's own
// arithmetic; nothing a server writes reaches it, because `response.url` is an
// absolute serialization.

describe("the loop ends, and the relative branch stays the caller's", () => {
  test("no rebuild answers with a pathname longer than the path it was given", () => {
    const urls: Array<[string, string]> = [4, 8, 16, 32].flatMap((groups) => [
      [`${ORIGIN}/x/https:${"/".repeat(2 * groups)}${"@../".repeat(groups)}v1`, ORIGIN],
      [`file:///x/https:${"/".repeat(2 * groups)}${"@../".repeat(groups)}v1`, "file://"],
      [`${ORIGIN}${probePath(groups)}`, ORIGIN],
    ]);
    const native = globalThis.URL;
    const grew: string[] = [];
    let rebuilds = 0;

    for (const [url, origin] of urls) {
      let previous: number | null = null;
      class Watched extends native {
        constructor(argument: string | URL, base?: string | URL) {
          super(argument, base);
          // The rebuild alone: a `parsesAsAuthority` probe is `https://` and a
          // slice of the path, and it is not a pass of `cleaned`.
          if (base !== undefined || !String(argument).startsWith(origin)) return;
          rebuilds += 1;
          const length = this.pathname.length;
          if (previous !== null && length >= previous) grew.push(`${url}: ${previous}, ${length}`);
          previous = length;
        }
      }
      globalThis.URL = Watched as unknown as typeof URL;
      try {
        redactUrl(url);
      } finally {
        globalThis.URL = native;
      }
    }

    expect(grew.slice(0, 3)).toEqual([]);
    expect(rebuilds).toBeGreaterThan(urls.length);
  });

  // The relative branch's own arithmetic — one resolution per authority the
  // caller spelled — is the same measurement over the same corpus in
  // `tests/response/response-crossing-budget-cost.spec.ts`, which records the
  // pre-fix differential beside it.

  test("a server cannot reach it: a relative Location leaves response.url absolute", async () => {
    const server = http.createServer((request, response) => {
      if ((request.url ?? "/") === "/one") {
        response.writeHead(302, { location: `/x${"/ws:a:1".repeat(8)}/@b` });
        response.end();
        return;
      }
      response.writeHead(404);
      response.end("no");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;

    try {
      const { error } = await typedFetch(`http://127.0.0.1:${port}/one`);
      if (!error) throw new TypeError("expected an error");
      expect(() => new URL(error.url)).not.toThrow();
      expect(error.url.startsWith("http://")).toBe(true);
      if (isHttpError(error)) await error.cancel();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
