import http from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, test } from "vitest";
import { redactUrl } from "../../src/errors/redact-url";
import { isHttpError, typedFetch } from "../../src/index";

// ═══════════════════════════════════════════════════════════════════════════
// ROUND 19 — H2. THE INTERACTION SURFACE, AND THE INSTRUMENT THAT CANNOT SEE.
//
// Round 18's own lesson, in the state file: "an instrument that counts the
// thing the last defect used cannot see the next one." Three instruments exist
// now and all three are counters of something a previous defect spent:
//
//   round 16 — REBUILDS, one `new URL(origin + clean)` per pass of `cleaned`.
//   round 16 — PROBES, one `new URL("https://" + slice)` per `parsesAsAuthority`.
//   round 18 — the BACKWARD WALK, `lastIndexOf("@", …)` towards index 0.
//
// Section 1 builds the fourth: every character `String.prototype.indexOf` and
// `String.prototype.lastIndexOf` step over inside one `redactUrl`, summed.
// It reads a shape on which all three earlier instruments are GREEN — one
// rebuild, zero probes, zero characters walked backwards — while the module
// steps over 6,019,009 characters for a 6,021-character url and emits its own
// input unchanged.
//
// Section 2 is the interaction surface itself, attacked the way frontier item 2
// asks: not the last fix, but the PAIR. Round 16's crossing is budgeted by
// `popsBefore` from the number of solidi in front of a region. The URL Standard
// says that number carries no information under a special scheme — the
// special-authority-ignore-slashes state leaves on the first character that is
// neither `/` nor `\`, so `https:`, `https:/`, `https://` and `https:\\` in
// front of one body are ONE url, with one `href`, on every runtime. The module
// says so too, in `userinfo-spans.ts`' own header: "`https:/host`,
// `https:host`, and `https:\\host` all name the host `https://host` names",
// and "A rule that answered differently for the same text under three
// spellings of one mark was closing the case rather than the class."
//
// The crossing budget reads exactly that number. So the answer does depend on
// it, and the rows where it depends are the rows round 17 was fixed for: the
// two-solidus spelling keeps `cdn.test:8443` and the one-solidus spelling —
// "the spelling every slash-collapsing proxy and every `path.join` produces",
// in the same header's words — names the handle `alice` as the host instead.
//
// Section 3 is the pairwise and triplewise grid that came out CLEAN, recorded
// so the next round does not redraw it.
//
// NOTHING HERE IS A TIME RATIO. Every claim is a count, and every cost claim
// carries the termination bound separately — section 1's last test.
// ═══════════════════════════════════════════════════════════════════════════

const ORIGIN = "https://api.test";
const SECRET = "hunter2";

/**
 * One `redactUrl`, with four numbers read off the platform.
 *
 * THE FOURTH NUMBER IS THE POINT. `indexOf(search, from)` and
 * `lastIndexOf(search, from)` each look at `|result - from|` characters before
 * they answer, and a miss looks at everything to the end of the string. Summed
 * over a call that is the work no parse count and no backward-walk count can
 * see, because neither a `URL` nor a backward scan is involved in spending it.
 *
 * The three earlier instruments are kept alongside it, unchanged, so a reader
 * can check for himself that all three stay green on the shape below.
 */
function measure(url: string, origin = ORIGIN) {
  const nativeUrl = globalThis.URL;
  const nativeIndexOf = String.prototype.indexOf;
  const nativeLastIndexOf = String.prototype.lastIndexOf;
  let rebuilds = 0;
  let probes = 0;
  let forward = 0;
  let backward = 0;
  class Watched extends nativeUrl {
    constructor(argument: string | URL, base?: string | URL) {
      super(argument, base);
      if (base !== undefined) return;
      if (String(argument).startsWith(origin)) rebuilds += 1;
      else probes += 1;
    }
  }
  String.prototype.indexOf = function (this: string, search: string, position?: number) {
    const found = nativeIndexOf.call(this, search, position);
    const from = position === undefined ? 0 : Math.max(0, position);
    forward += (found < 0 ? this.length : found) - from;
    return found;
  } as typeof String.prototype.indexOf;
  String.prototype.lastIndexOf = function (this: string, search: string, position?: number) {
    const found = nativeLastIndexOf.call(this, search, position);
    const from =
      position === undefined || Number.isNaN(position)
        ? this.length - 1
        : Math.min(position, this.length - 1);
    backward += from - found;
    return found;
  } as typeof String.prototype.lastIndexOf;
  globalThis.URL = Watched as unknown as typeof URL;
  let answer = "";
  try {
    answer = redactUrl(url);
  } finally {
    globalThis.URL = nativeUrl;
    String.prototype.indexOf = nativeIndexOf;
    String.prototype.lastIndexOf = nativeLastIndexOf;
  }
  return { answer, length: url.length, rebuilds, probes, forward, backward };
}

// ── 1. R19-H2-01 — the colon search is unbounded, and no instrument saw it ───
//
//   function looksLikeUserinfo(text, scheme, start, end) {
//     if (end === start) return true;
//     const slash = text.indexOf("/", start);
//     if (slash < 0 || slash >= end) return true;
//     if (text[end - 1] !== "/") return true;
//     const colon = text.indexOf(":", start);              // <— no floor
//     return colon >= 0 && colon < slash && !readsAsHostAndPort(text, scheme, start);
//   }
//
// The rule the last line spells is the function's own third bullet: "A `:`
// BEFORE the first `/`". `slash` IS that bound and it is already computed one
// line above. The search ignores it and reads to the end of the string, so a
// text with no colon after the region pays its whole remaining length — per
// REGION.
//
// THE SHAPE. `/x` then `//a` repeated, then `/@b`. Every `//` is a region
// `nextAuthority` opens with no scheme in front of it, so `schemeWroteTheMark`
// answers `false` and the region never reaches a probe. The single `@` sits at
// the far end preceded by a `/`, so no region can end on it: nothing is
// removed, the answer is the input, and every character walked buys nothing.
// No colon appears anywhere after `https://api.test`, which is what makes each
// region's search read to the end.
//
// This is round 18's own finding wearing the other direction. Round 18 clipped
// the two BACKWARD searches inside `readsAsHostAndPort` — "BOTH SEARCHES ARE
// CLIPPED TO THE AUTHORITY" — and left the two FORWARD searches one call above
// it unclipped. The instrument it built to prove the first cannot see the
// second, because `lastIndexOf` is never called on this input at all.

function forwardPath(units: number): string {
  return `/x${"//a".repeat(units)}/@b`;
}

describe("the colon search walks the rest of the url, per region", () => {
  test("R19-H2-01: the characters examined grow with the square of a server's path", () => {
    const rows = [500, 1000, 2000].map((units) => {
      const url = ORIGIN + forwardPath(units);
      return { units, ...measure(url) };
    });

    // NON-VACUITY. Nothing is redacted at any size — the answer is the input —
    // so every character below is examined for an answer that never changes.
    for (const row of rows) expect(row.answer).toBe(ORIGIN + forwardPath(row.units));

    // ALL THREE EARLIER INSTRUMENTS ARE GREEN. One rebuild at every size, so
    // `cleaned`'s pass count is untouched and this is not round 16's or round
    // 17's defect. Zero probes, so it is not `parsesAsAuthority`. Zero
    // characters walked backwards, so round 18's instrument reads nothing at
    // all — the defect below never calls `lastIndexOf`.
    expect(rows.map((row) => row.rebuilds)).toEqual([1, 1, 1]);
    expect(rows.map((row) => row.probes)).toEqual([0, 0, 0]);
    expect(rows.map((row) => row.backward)).toEqual([0, 0, 0]);

    // AND THE FOURTH IS NOT. A linear reader of a text looks at each character
    // a bounded number of times; eight is generous and scale-free, and a tree
    // that stops the colon search at `slash` walks under three.
    const overLinear = rows
      .filter((row) => row.forward > 8 * row.length)
      .map((row) => `${row.units} units, ${row.length} chars: ${row.forward} examined`);
    expect(overLinear).toEqual([]);
  });

  test("R19-H2-01: five more spellings of the same region reach it", () => {
    // The defect is a property of the REGION, not of one unit, so it fires
    // under every spelling that opens a colon-free region. Each row is its own
    // full cross product of a head and a unit, redrawn by reading this table.
    const shapes: Record<string, (units: number) => string> = {
      "a bare pair of solidi": (n) => `${ORIGIN}/x${"//a".repeat(n)}/@b`,
      "two segments per unit": (n) => `${ORIGIN}/x${"//a/b".repeat(n)}/@b`,
      "an empty userinfo per unit": (n) => `${ORIGIN}/x${"//@".repeat(n)}/@b`,
      "the backslash spelling": (n) => `${ORIGIN}/x${"//a\\b".repeat(n)}/@b`,
      "a handle at every segment head": (n) => `${ORIGIN}/x${"/@a/".repeat(n)}/@b`,
      "behind a digit-led token": (n) => `${ORIGIN}/x/9:${"//a".repeat(n)}/@b`,
    };
    const overLinear: string[] = [];
    for (const [name, make] of Object.entries(shapes)) {
      const row = measure(make(1000));
      // Every one of them keeps both earlier instruments flat.
      expect(row.probes).toBe(0);
      expect(row.rebuilds).toBeLessThanOrEqual(2);
      if (row.forward > 8 * row.length) {
        overLinear.push(`${name}: ${row.length} chars, ${row.forward} examined`);
      }
    }
    expect(overLinear).toEqual([]);
  });

  test("R19-H2-01: one toJSON() of a 12 KB redirect target pays it whole", async () => {
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
      const { error } = await typedFetch(`${origin}/go${forwardPath(4000)}`);
      if (!error || !isHttpError(error)) throw new TypeError("expected an http error");
      try {
        // THE INPUT IS REMOTE, and it arrived unchanged: `//a` inside a path
        // spells an empty segment and a named one, and neither is a dot
        // segment, so the platform's own redirect resolution normalises
        // nothing away before the library sees it.
        expect(error.url).toBe(`${origin}${forwardPath(4000)}`);

        const native = String.prototype.indexOf;
        let forward = 0;
        String.prototype.indexOf = function (this: string, search: string, position?: number) {
          const found = native.call(this, search, position);
          const from = position === undefined ? 0 : Math.max(0, position);
          forward += (found < 0 ? this.length : found) - from;
          return found;
        } as typeof String.prototype.indexOf;
        try {
          error.toJSON();
        } finally {
          String.prototype.indexOf = native;
        }

        // One structured log line, one `redactUrl`, and this many characters
        // examined over a 12 KB string the SERVER chose. The constructor
        // already paid it once for `message`.
        expect(forward).toBeLessThanOrEqual(8 * error.url.length);
      } finally {
        await error.cancel();
      }
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 60_000);

  test("the termination bound is separate, and it is untouched", () => {
    // A cost finding proves termination on its own, or a reader cannot tell a
    // quadratic from a hang. Section 1's defect lives inside ONE pass of
    // `cleaned`, so the measure `cleaned` states — `parsed.pathname.length`,
    // strictly decreasing across rebuilds — is unmoved by it. Both halves are
    // measured here: the rebuild count does not grow with the input, and no
    // rebuild ever answers with a path at least as long as the one before.
    const counts = [250, 500, 1000, 2000].map((units) => measure(ORIGIN + forwardPath(units)));
    expect(new Set(counts.map((row) => row.rebuilds)).size).toBe(1);

    const native = globalThis.URL;
    const grew: string[] = [];
    let rebuilds = 0;
    for (const units of [250, 500, 1000]) {
      const url = ORIGIN + forwardPath(units);
      let previous: number | null = null;
      class Watched extends native {
        constructor(argument: string | URL, base?: string | URL) {
          super(argument, base);
          if (base !== undefined || !String(argument).startsWith(ORIGIN)) return;
          rebuilds += 1;
          const length = this.pathname.length;
          if (previous !== null && length >= previous)
            grew.push(`${units}: ${previous}, ${length}`);
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
    expect(grew).toEqual([]);
    expect(rebuilds).toBeGreaterThan(0);
  });
});

// ── 2. R19-H2-02 — the crossing budget reads a number the grammar discards ───
//
// `popsBefore` counts the solidi in front of a region and hands the count to
// the crossing as a budget. Under a SPECIAL scheme that count is not part of
// the url: the special-authority-slashes state raises
// `special-scheme-missing-following-solidus` and continues, and the
// special-authority-ignore-slashes state skips `/` and `\` alike until the
// first character that is neither. So `https:`, `https:/`, `https://`,
// `https:///` and `https:\\` in front of one body are one url with one `href`,
// which the first assertion of every test below reads off the platform rather
// than asserting from the standard.
//
// The module's own two sentences, in `userinfo-spans.ts`:
//
//   "`https:/host`, `https:host`, and `https:\\host` all name the host
//    `https://host` names."
//   "A rule that answered differently for the same text under three spellings
//    of one mark was closing the case rather than the class."
//
// `popsBefore` is such a rule, and round 16's crossing is what spends its
// answer. The harm it decides is round 17's own: with two solidi the record
// keeps `cdn.test:8443`, and with one it names the handle `alice` as the host
// of the forward and drops the authority the url named — R17-H3-01 verbatim,
// on the spelling `userinfo-spans.ts` calls the one "every slash-collapsing
// proxy and every `path.join`" produces.

const CROSSING_BODY = "@..//cdn.test:8443/users/@alice";

describe("one url, five spellings of its mark, three answers", () => {
  test("R19-H2-02: the platform says the five are ONE url", () => {
    const spellings = ["https:", "https:/", "https://", "https:///", "https:\\\\"];
    const hrefs = new Set(spellings.map((mark) => new URL(mark + CROSSING_BODY).href));
    expect([...hrefs]).toEqual(["https://..//cdn.test:8443/users/@alice"]);
  });

  test("R19-H2-02: and the redactor names the handle under two of them", () => {
    // TWO SOLIDI: round 17's promise. The embedded authority survives, and the
    // handle stays a path segment.
    expect(redactUrl(`${ORIGIN}/go/https://${CROSSING_BODY}`)).toBe(
      `${ORIGIN}/go/https://cdn.test:8443/users/@alice`,
    );

    // ONE SOLIDUS, and NONE. The same url, and `cdn.test:8443` is gone while
    // `alice` — a user's handle, a host the request never contacted — is what
    // the forward now names.
    //
    // The exact string is NOT asserted, because the scheme's own segment is
    // legitimately popped by the `..` under these two spellings and the
    // two-solidus row's is not. What is asserted is the property round 17's
    // pin exists for: the authority the url named survives, and the handle
    // does not become the last thing the record names.
    for (const mark of ["https:/", "https:"]) {
      const answer = redactUrl(`${ORIGIN}/go/${mark}${CROSSING_BODY}`);
      expect({ mark, keeps: answer.includes("cdn.test:8443"), answer }).toEqual({
        mark,
        keeps: true,
        answer,
      });
      expect(answer.endsWith("/alice")).toBe(false);
    }
  });

  test("R19-H2-02: 1,440 of 6,912 one-url families split on the solidus count", () => {
    // THE POPULATION IS A FULL CROSS PRODUCT, so it is redrawn exactly by
    // reading this loop. A FAMILY is one body under seven spellings of one
    // mark; it enters the count only when the platform reports one `href` for
    // all seven, which is the definition of "one url" this test uses. It
    // SPLITS when the seven answers disagree about whether the embedded
    // authority's label survives — round 18's own judge, applied across the
    // spellings of one mark instead of across two twins.
    const schemes = ["https", "http", "ws", "wss", "ftp", "HTTPS"];
    const spellings = ["", "/", "//", "///", "////", "\\\\", "/\\"];
    const openers = ["@", ":@", `svc:${SECRET}@`, "tok@", "", `:${SECRET}@`];
    const fillers = ["..", "%2e%2e", ".%2e", "../.."];
    const runs = ["/", "//", "///"];
    const authorities = ["cdn.test:8443", "cdn.test", "h.test:1", "a:1234"];
    const tails = ["/users/@alice", "/@alice", "/img/@bob", "/u/v/@carol"];

    let families = 0;
    const split: string[] = [];
    for (const scheme of schemes)
      for (const opener of openers)
        for (const filler of fillers)
          for (const run of runs)
            for (const authority of authorities)
              for (const tail of tails) {
                const body = `${opener}${filler}${run}${authority}${tail}`;
                const urls = spellings.map((mark) => `${scheme}:${mark}${body}`);
                let href: string | null = null;
                let one = true;
                for (const url of urls) {
                  let parsed: URL;
                  try {
                    parsed = new URL(url);
                  } catch {
                    one = false;
                    break;
                  }
                  if (href === null) href = parsed.href;
                  else if (parsed.href !== href) one = false;
                  if (!one) break;
                }
                if (!one) continue;
                families += 1;
                const label = authority.split(":")[0]!;
                const verdicts = new Set(
                  urls.map((url) => redactUrl(`${ORIGIN}/go/${url}`).includes(label)),
                );
                if (verdicts.size > 1 && split.length < 3) split.push(urls[1]!);
                else if (verdicts.size > 1) split.push("");
              }

    // Non-vacuity: the grid really does draw 6,912 one-url families.
    expect(families).toBe(6912);
    expect({ split: split.length, first: split.slice(0, 3) }).toEqual({ split: 0, first: [] });
  });

  test("R19-H2-02: a 302 Location picks which host the record names", async () => {
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
      const { error } = await typedFetch(`${origin}/go/x/https:/${CROSSING_BODY}`);
      if (!error || !isHttpError(error)) throw new TypeError("expected an http error");
      try {
        // The redirect target arrived unchanged — the value is the SERVER's.
        expect(error.url).toBe(`${origin}/x/https:/${CROSSING_BODY}`);
        const record = error.toJSON();
        // The record must not invent a host, and `alice` is a handle.
        expect(record.url).toContain("cdn.test:8443");
        expect(record.url.endsWith("/alice")).toBe(false);
      } finally {
        await error.cancel();
      }
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 60_000);
});

// ── 3. THE GRID THAT CAME OUT CLEAN ──────────────────────────────────────────
//
// Frontier item 2 asks for the pairwise and triplewise crossing of every
// condition rounds 16, 17 and 18 landed. The conditions are: the crossing and
// its budget, the two `popsBefore` floors, the three conditions of
// `readsAsHostAndPort`, round 18's single anchor at the region open, the
// authority-slice clip, the ALPHA scheme head, the dot-segment host refusal,
// the empty-userinfo fallback guard, the seam floor, and the one-way loss of a
// region's bound.
//
// Round 18's own grid could draw none of these five shapes, which is why they
// are here: a SEAM (`file://`, an empty host) crossed with a crossing; a
// query or fragment terminator, so the clip and `endsInsideAuthority` are live;
// a SECOND embedded mark after the filler, so a region can lose its bound
// mid-crossing; a bare `//` region with no scheme at all; and a planted
// credential PAST the crossing, which is the only way an under-redaction is
// visible at all.
//
// 470,400 rows, and the three properties below hold on every one of them.

describe("the triplewise grid, and what it cleared", () => {
  test(
    "no planted credential survives, and every answer is a fixed point",
    { timeout: 300_000 },
    () => {
      const origins = [ORIGIN, "file://", "//", ""];
      const marks = ["https:", "ws:", "HTTPS:", "git:", "9:", ":", ""];
      const runs = [1, 2, 3, 4];
      const fillers = ["", "../", "%2e%2e/", "./", "../../", ".%2e/"];
      const openers = ["", "@", ":@", `svc:${SECRET}@`, "u@"];
      const authorities = [
        "cdn.test:8443",
        "cdn.test",
        "a:1234",
        "a:99999",
        `svc:${SECRET}@i.test`,
        "[::1]",
        "..",
      ];
      const tails = [
        "/users/@alice",
        "/@alice",
        "/img/dG9rZW4vcGFzc3dvcmQ/@h.test/v1",
        "/a/b@c/d",
        "/x/@bob",
      ];
      const terminators = ["", "?q=1@z", "#f@z", "/end"];

      let rows = 0;
      const reported: string[] = [];
      const notFixed: string[] = [];
      for (const origin of origins)
        for (const mark of marks)
          for (const run of runs)
            for (const filler of fillers)
              for (const opener of openers)
                for (const authority of authorities)
                  for (const tail of tails)
                    for (const terminator of terminators) {
                      const url = `${origin}/go/${mark}${"/".repeat(run)}${opener}${filler}${authority}${tail}${terminator}`;
                      rows += 1;
                      const once = redactUrl(url);
                      // A credential the PLATFORM itself reports may never
                      // survive the emitted url.
                      let parsed: URL | null = null;
                      try {
                        parsed = new URL(url);
                      } catch {
                        parsed = null;
                      }
                      if (
                        parsed !== null &&
                        parsed.password !== "" &&
                        once.includes(parsed.password)
                      )
                        reported.push(url);
                      // And the answer is a fixed point of the redactor, which
                      // is round 11's property and round 12's recorded defect.
                      if (redactUrl(once) !== once && notFixed.length < 3) notFixed.push(url);
                    }

      expect(rows).toBe(470_400);
      expect(reported.slice(0, 3)).toEqual([]);
      expect(notFixed).toEqual([]);
    },
  );
});
