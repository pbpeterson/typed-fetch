import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { isHttpError, typedFetch } from "../../src/index";
import { redactUrl } from "../../src/errors/redact-url";

// ═══════════════════════════════════════════════════════════════════════════
// ROUND 17 — H2. The code round 16 changed, read again from scratch.
//
// Round 16 closed R16-H2-01: the ordinary region's cursor now CROSSES a double
// dot and closes its span in front of it, and the crossings are counted against
// the solidus run in front of the region. The fix took a 16 KB redirect target
// from 131.7 ms to 1.2 ms with no answer changes over 519,070 urls.
//
// `popsBefore` is the counter, and it is three decisions in two lines:
//
//   function popsBefore(text, start) {
//     let run = 0;
//     while (isSolidus(text[start - run - 1])) run += 1;
//     return run >= 2 && text[start - run - 1] !== ":" ? run - 2 : 0;
//   }
//
// a floor (`run >= 2`), an arithmetic (`run - 2`), and a SPECIAL CASE (`!== ":"`).
// Its own comment states the reason for the special case, and the reason is
// about SAFETY rather than about cost: "a run behind a scheme colon opens one
// over ANY count including none — so the pop that shortens it does not close
// it, and the arithmetic above does not describe it. Both answer zero, which is
// the behaviour of every round before this one."
//
// "The behaviour of every round before this one" is exactly the defect. A region
// an `authorityAt` colon opens re-opens after every pop — MORE reliably than a
// bare pair of solidi, because a special scheme reaches its authority over any
// count including none — so it is the spelling that most needs a crossing
// budget, and it is the one spelling that gets none. Section 1 is that input,
// section 2 drives it from a real `node:http` 302, and section 5 states the
// termination bound apart from the cost, because a cost claim is a claim about
// the number of passes and not about whether the loop ends.
//
// Sections 3 and 4 are the cleared halves of the lane: the re-enumerated cursor
// advances that DO hold their pass count constant on the current source, and the
// counting attack in the other direction — an input that makes the module cross
// a `..` it should not — which was hunted over 2.6 million generated urls
// against a checkout of the pre-fix tree and did not land.
// ═══════════════════════════════════════════════════════════════════════════

const ORIGIN = "https://api.test";

/**
 * Every REBUILD `redactUrl` performs for `url`: one `new URL(origin + clean)`
 * per pass of `cleaned`.
 *
 * The seam is round 15's and belongs to the platform — `./redact-url` names
 * `URL` as a global and resolves it on every call, so a subclass installed for
 * the length of one synchronous call reads the loop's own steps without the
 * module holding a counter for anyone.
 *
 * REBUILDS ONLY, and the split is what keeps a linear scan from reading as a
 * cost defect. `parsesAsAuthority` in `./userinfo-spans` performs a
 * single-argument `new URL` too, once per region over a slice bounded by the
 * next `://`, so a path of N marks performs N probes and stays linear. Only a
 * rebuild is a pass of `cleaned`, and only a rebuild multiplies a whole-string
 * scan. A probe is `https://` plus a slice of the path, and no path below spells
 * `api.test`, so the prefix test separates the two exactly.
 */
function rebuildsOf(url: string, origin = ORIGIN): number {
  const native = globalThis.URL;
  let rebuilds = 0;
  class Watched extends native {
    constructor(argument: string | URL, base?: string | URL) {
      super(argument, base);
      if (base === undefined && String(argument).startsWith(origin)) rebuilds += 1;
    }
  }
  globalThis.URL = Watched as unknown as typeof URL;
  try {
    redactUrl(url);
  } finally {
    globalThis.URL = native;
  }
  return rebuilds;
}

/** `groups` `@../` groups behind `2 * groups` solidi — round 16's own unit. */
function groupsAfter(run: string, groups: number): string {
  return `${run}${"/".repeat(2 * groups)}${"@../".repeat(groups)}v1`;
}

/** The shape round 16 fixed: the run opens the region with no colon in front. */
function barePath(groups: number): string {
  return groupsAfter("/x", groups);
}

/**
 * The same shape with a scheme colon in front of the run — the spelling every
 * slash-collapsing proxy and every `path.join` produces for a forwarding url,
 * and the one `./userinfo-spans` names in its own header as the reason the
 * region's start has to be the WIDE mark.
 */
function colonPath(groups: number): string {
  return groupsAfter("/x/https:", groups);
}

// ── 1. R17-H2-01 — the crossing budget is zero wherever a colon opens ────────
//
// One pass, read off the loop's own arguments at four groups. The left column is
// `parsed.pathname` as the rebuild received it:
//
//   /x/https:////////@../@../@../@../v1    the input
//   /x/https:///////@../@../@../v1         one `@` removed; the cursor stopped
//                                          in front of the `..` its own removal
//                                          created, and `popsBefore` answered 0
//                                          because `text[start - run - 1]` is
//                                          the `:` of `https:`
//   /x/https://////@../@../v1              the rebuild popped one empty segment
//   /x/https:///@../v1  … and so on, one group per whole-string pass.
//
// Every line is a scan of a text that is still Θ(N) long, so N groups cost
// N + 1 passes. Measured on this tree outside the runner: 401 rebuilds and
// 10.4 ms at 2.4 KB, 1,601 and 149 ms at 9.6 KB, 2,401 and 332 ms at 14.4 KB.
// Node's default `http.maxHeaderSize` is 16384, so a single `Location` reaches
// the last of those. The bare twin costs 2 rebuilds and 1.0 ms at 14.4 KB.
//
// THE ANSWER IS THE SAME AT EVERY SIZE, and it is the same answer the pre-fix
// tree gives, so the passes buy nothing: `/x/https:` plus `groups` solidi.

describe("a colon in front of the run keeps the pass count remote", () => {
  test("R17-H2-01: behind a colon, N `@../` groups still cost N passes", () => {
    // NON-VACUITY FIRST. Both sizes are answered, both keep their origin, and
    // the answer is the same shape at both — so nothing the extra passes do is
    // visible in what a caller reads.
    expect(redactUrl(ORIGIN + colonPath(4))).toBe(`${ORIGIN}/x/https:////v1`);
    expect(redactUrl(ORIGIN + colonPath(32))).toBe(`${ORIGIN}/x/https:${"/".repeat(32)}v1`);

    // AND THE TWIN IS CONSTANT, which is what makes this the same defect round
    // 16 closed rather than a new claim about the loop. Take the `https:` away
    // and the crossing budget is `run - 2`; put it back and the budget is 0.
    const bare = [4, 8, 16, 32].map((groups) => rebuildsOf(ORIGIN + barePath(groups)));
    expect(new Set(bare).size).toBe(1);

    // CONSTANCY, not a literal. A literal taken from this tree pins this tree's
    // arithmetic, which is the mistake round 16 recorded three hunters making.
    const counts = [4, 8, 16, 32].map((groups) => rebuildsOf(ORIGIN + colonPath(groups)));
    expect(new Set(counts).size).toBe(1);
    // A ceiling alone would hide a slower growth, so it rides beside the
    // constancy check and only catches a gross regression.
    expect(counts[0]).toBeLessThanOrEqual(8);
  });

  test("R17-H2-01: every colon the grammar opens a region on pays it", () => {
    // `authorityAt` opens a region at a colon in two ways — a special scheme
    // over any number of solidi, and any scheme at all over two or more — and
    // the counter's special case reads NEITHER of them. It reads the character.
    // So the budget is zero wherever a `:` happens to sit in front of the run,
    // whether or not that `:` is what opened the region: the unknown scheme two
    // solidi carry, the empty scheme a template leaves behind, and the Windows
    // drive letter, which pays it through the seam branch rather than through an
    // origin.
    const spellings: Array<[string, (groups: number) => [string, string]]> = [
      ["a special scheme", (n) => [`${ORIGIN}${groupsAfter("/x/https:", n)}`, ORIGIN]],
      ["its uppercase spelling", (n) => [`${ORIGIN}${groupsAfter("/x/HTTPS:", n)}`, ORIGIN]],
      ["another special scheme", (n) => [`${ORIGIN}${groupsAfter("/x/ftp:", n)}`, ORIGIN]],
      [
        "a scheme the grammar never heard of",
        (n) => [`${ORIGIN}${groupsAfter("/x/git:", n)}`, ORIGIN],
      ],
      ["the empty scheme a template leaves", (n) => [`${ORIGIN}${groupsAfter("/x/:", n)}`, ORIGIN]],
      ["a Windows drive letter", (n) => [`file://${groupsAfter("/c:", n)}`, "file://"]],
    ];

    const growing = spellings
      .filter(([, make]) => {
        const counts = [4, 8, 16].map((groups) => rebuildsOf(...make(groups)));
        return new Set(counts).size !== 1;
      })
      .map(([name]) => name);
    expect(growing).toEqual([]);
  });
});

// ── 2. The same input, chosen by a server rather than by the caller ──────────
//
// `error.url` is `response.url`, and after a redirect that is the text the
// SERVER wrote into `Location`. The constructor redacts it once for `message`
// and `toJSON()` redacts it again, so a structured logger pays the count a
// second time per log line. The count is read around `toJSON()` alone: it is
// synchronous, it performs exactly one `redactUrl`, and no transport parse can
// reach it. `CONTRIBUTING.md` forbids a time ratio as the whole of a cost
// finding, so the assertion is a parse count.

describe("a 302 Location behind a colon picks the toJSON() cost", () => {
  let server: http.Server;
  let origin: string;

  beforeAll(async () => {
    server = http.createServer((request, response) => {
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
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  /** The number of parses one `toJSON()` performs for a server-chosen url. */
  async function parsesPerLogLine(groups: number): Promise<{ parses: number; url: string }> {
    const { error } = await typedFetch(`${origin}/go${colonPath(groups)}`);
    if (!error || !isHttpError(error)) throw new TypeError("no http error");
    try {
      const native = globalThis.URL;
      let parses = 0;
      class Watched extends native {
        constructor(argument: string | URL, base?: string | URL) {
          super(argument, base);
          if (base === undefined) parses += 1;
        }
      }
      globalThis.URL = Watched as unknown as typeof URL;
      try {
        error.toJSON();
      } finally {
        globalThis.URL = native;
      }
      return { parses, url: error.url };
    } finally {
      await error.cancel();
    }
  }

  test("R17-H2-01: the url is the server's, and the log line's cost grows with it", async () => {
    const few = await parsesPerLogLine(4);
    const many = await parsesPerLogLine(400);

    // THE INPUT IS REMOTE. The path came back verbatim in `Location` and the
    // platform's own redirect parse did not shorten it: `@..` is not a
    // double-dot path segment and `https:` inside a path is an ordinary
    // segment, so nothing normalises either away before the library sees it.
    expect(few.url).toBe(`${origin}${colonPath(4)}`);
    expect(many.url).toBe(`${origin}${colonPath(400)}`);

    expect(many.parses).toBe(few.parses);
  }, 30_000);
});

// ── 3. The cursor advances, re-enumerated on the CURRENT source ──────────────
//
// Round 16 enumerated sixteen advances and cleared fifteen. Its own fix added
// three and changed what two of the old ones do, so the list is redone here from
// the current source rather than inherited. The grain is one statement that
// moves a position forward through a text, and the two whole-string loops in
// `./redact-url` count as one each. THIRTY, by the function that makes them:
//
//   leadsWithHierarchicalScheme  1  the bounded scheme walk
//   pastSolidi                   1  the solidus run
//   bringsOwnAuthority           3  the stripped head, the solidus, the ignored
//                                   run between two solidi
//   authorityEnd                 1  the walk to `/ \ ? #`
//   afterOwnAuthority            2  past the scheme colon, then its run
//   pastFiller                   3  the solidi, the segment walk, the dropped
//                                   segment
//   pastOnePop                   2  the segment walk, the filler behind the pop
//   popsBefore                   1  the backward run
//   seamSpan                     2  the leading solidi, and the re-ask cursor
//   endsInsideAuthority          1  `from = start`
//   nextAuthority                2  the forward walk, and the run it lands past
//   authorityAt                  1  the run after the colon
//   userinfoSpans                7  the `@` collection, the seam's `from`,
//                                   `stop`, the floor, `cut`, `resumed`/`open`,
//                                   and `from = cut`
//   withoutSpans                 1  the emit cursor
//   withoutUserinfos             1  the `@` walk over a message
//   redactUrl                    1  the relative branch's resolve loop
//   cleaned                      1  the rebuild loop
//
// For each one the question is round 16's: build an input where the next parse
// deletes text in front of the cursor, and count the passes. Twenty-nine hold
// their pass count constant as the repeated unit grows, and the table below is
// that measurement — one shape per advance that a repeated unit can defeat, plus
// the loops of `./redact-url` in section 6. The thirtieth is `popsBefore`, and
// it is section 1.

describe("every other advance holds its pass count", () => {
  const run = (groups: number) => "/".repeat(2 * groups);
  const SHAPES: Record<string, (groups: number) => [string, string]> = {
    "the bare run round 16 fixed": (n) => [ORIGIN + barePath(n), ORIGIN],
    "%2e%2e, the encoded pop": (n) => [`${ORIGIN}/x${run(n)}${"@%2e%2e/".repeat(n)}v1`, ORIGIN],
    ".%2e, the half-encoded pop": (n) => [`${ORIGIN}/x${run(n)}${"@.%2e/".repeat(n)}v1`, ORIGIN],
    "%2e., the other half": (n) => [`${ORIGIN}/x${run(n)}${"@%2e./".repeat(n)}v1`, ORIGIN],
    "the single dot, which deletes itself": (n) => [
      `${ORIGIN}/x${run(n)}${"@./".repeat(n)}v1`,
      ORIGIN,
    ],
    "the encoded single dot": (n) => [`${ORIGIN}/x${run(n)}${"@%2e/".repeat(n)}v1`, ORIGIN],
    "no dot at all": (n) => [`${ORIGIN}/x${run(n)}${"@/".repeat(n)}v1`, ORIGIN],
    "a whole credential per group": (n) => [
      `${ORIGIN}/x${run(n)}${"svc:PW@../".repeat(n)}v1`,
      ORIGIN,
    ],
    "a dot segment in front of the run": (n) => [
      `${ORIGIN}/x/..${run(n)}${"@../".repeat(n)}v1`,
      ORIGIN,
    ],
    "a run of bare marks": (n) => [`${ORIGIN}/x${run(n)}${"@".repeat(n)}../v1`, ORIGIN],
    "single dots and pops alternating": (n) => [
      `${ORIGIN}/x${run(n)}${"@./@../".repeat(n)}v1`,
      ORIGIN,
    ],
    "the backslash spelling of the run": (n) => [
      `${ORIGIN}/x${"\\".repeat(2 * n)}${"@../".repeat(n)}v1`,
      ORIGIN,
    ],
    "the seam, at an empty host": (n) => [`file://${run(n)}${"@../".repeat(n)}v1`, "file://"],
    "the seam, at the userinfo a parse normalised away": (n) => [
      `file://${run(n)}${":@../".repeat(n)}v1`,
      "file://",
    ],
    "the path that ends inside an authority": (n) => [
      `${ORIGIN}/x${run(n)}${"@../".repeat(n)}svc:hun?ter2@h.test`,
      ORIGIN,
    ],
    "the fragment spelling of the same cut": (n) => [
      `${ORIGIN}/x${run(n)}${"@../".repeat(n)}svc:hun#ter2@h.test`,
      ORIGIN,
    ],
    "authority marks, where the probes are the cost": (n) => [
      `${ORIGIN}/x/${"https://@".repeat(n)}v1`,
      ORIGIN,
    ],
    "a reference that brings its own authority": (n) => [
      `//x${run(n)}${"@../".repeat(n)}v1`,
      "http://url.invalid",
    ],
  };

  test("the cleared advances cost the same at four groups and at thirty-two", () => {
    const growing: string[] = [];
    for (const [name, make] of Object.entries(SHAPES)) {
      const counts = [4, 8, 16, 32].map((groups) => {
        const [url, origin] = make(groups);
        return rebuildsOf(url, origin);
      });
      if (new Set(counts).size !== 1) growing.push(`${name}: ${counts.join(",")}`);
    }
    expect(growing).toEqual([]);
  });

  test("and each of them still answers, and answers a fixed point of itself", () => {
    for (const make of Object.values(SHAPES)) {
      const [url] = make(4);
      const once = redactUrl(url);
      expect(once).not.toBe("");
      expect(redactUrl(once)).toBe(once);
      expect(once).not.toContain("PW");
    }
  });
});

// ── 4. The counting attack, in the direction that would move the answer ──────
//
// A counter with a floor and a special case can be wrong in two directions. The
// section above is the undercount, which costs passes. The overcount would cost
// an ANSWER: the crossing exists only because the slow spelling would have
// re-opened the region in a later pass, so a crossing the slow spelling would
// not have made is a span the redactor emits where the pre-fix tree emitted
// something else.
//
// It was hunted rather than argued. A checkout of the pre-fix `userinfo-spans`
// and `redact-url` was run beside the current pair over 2.6 million generated
// urls, drawn from three grammars: an unstructured token soup over solidus runs,
// dot spellings, marks, colons and planted secrets; a crossing-shaped generator
// that emits a run and then credential-dot-solidus groups; and the enumerated
// shapes of section 3 at five sizes each. Four urls answered differently, all four
// in the OVER-redaction direction and three of them removing a `://` the pre-fix
// tree kept. NONE kept a planted secret the pre-fix tree removed, and none broke
// the fixed point. The corpus is not in the tree — a differential needs two
// trees — so what stays here is the class of input it searched, pinned as
// answers, and the two properties it checked.

describe("the crossing does not move what the redactor emits", () => {
  // Each answer was verified identical on a checkout of the pre-fix tree, so a
  // change here is a change the crossing made.
  const PINNED: Array<[string, string]> = [
    [`${ORIGIN}/x////@../@../v1`, `${ORIGIN}/x//v1`],
    [`${ORIGIN}/x//////@../@../@../v1`, `${ORIGIN}/x///v1`],
    [`${ORIGIN}/x////svc:PW@../@../v1`, `${ORIGIN}/x///v1`],
    [`${ORIGIN}/x////@%2e%2e/@../v1`, `${ORIGIN}/x//v1`],
    [`${ORIGIN}/x/////@../@../h.test://y@bob/z`, `${ORIGIN}/x///h.test://bob/z`],
    [`${ORIGIN}/x////@../@../svc:hun?ter2@h.test`, `${ORIGIN}/x//svc:hun`],
    [`${ORIGIN}/go/https://api2.test/x////@../@../v1`, `${ORIGIN}/go/https://api2.test/x//v1`],
    [`${ORIGIN}/x////@../@/v1`, `${ORIGIN}/x///v1`],
    [`${ORIGIN}/x/////@../@../@/v1`, `${ORIGIN}/x///v1`],
    ["file://////@../@../v1", "file:////v1"],
  ];

  test("the crossing shapes answer exactly what the pre-fix tree answered", () => {
    for (const [url, answer] of PINNED) expect(redactUrl(url)).toBe(answer);
  });

  test("a span never eats the `..` it crossed: every pop is still performed", () => {
    // The rule the crossing may not break is round 15's: a `..` an ordinary
    // region's span swallows is a `..` the rebuild never performs, and the
    // segment it would have popped survives. It is countable from the outside.
    // `2 * groups` solidi spell `2 * groups - 1` empty segments, each `@../`
    // group removes its `@` and leaves its `..` behind, and the rebuild pops one
    // empty segment per `..` — so the answer holds exactly `groups` solidi. One
    // swallowed `..` is one pop that never happens, and one solidus too many.
    for (const groups of [2, 3, 4, 8, 16]) {
      const url = `${ORIGIN}/x${"/".repeat(2 * groups)}${"@../".repeat(groups)}v1`;
      expect(redactUrl(url)).toBe(`${ORIGIN}/x${"/".repeat(groups)}v1`);
    }
  });
});

// ── 5. The termination bound, stated apart from the cost ─────────────────────
//
// A cost finding names the growth and proves the termination bound separately,
// or a reader cannot tell a quadratic from a hang. The measure is
// `parsed.pathname.length`: `clean` is the scanned path with zero or more spans
// removed and everything past `path.length` clipped, `clean === path` is the one
// case that returns, and `new URL(origin + clean).pathname` is never longer than
// `clean` because the path percent-encode set is already a fixed point of a
// parser's own `pathname` and dot-segment removal only deletes.
//
// Asserted over the shape section 1 names, which is the shape that REACHES the
// bound. Section 1 is quadratic; this section is why it cannot hang.

describe("the loop's measure holds over the shape that reaches its bound", () => {
  const urls = [4, 8, 16, 32].flatMap((groups) => [
    ORIGIN + colonPath(groups),
    `file:///x/https:${"/".repeat(2 * groups)}${"@../".repeat(groups)}v1`,
    colonPath(groups),
  ]);

  test("no rebuild answers with a pathname longer than the path it was given", () => {
    const grew: string[] = [];
    const native = globalThis.URL;
    let rebuilds = 0;

    for (const url of urls) {
      let previous: number | null = null;
      class Watched extends native {
        constructor(argument: string | URL, base?: string | URL) {
          super(argument, base);
          if (base !== undefined) return;
          rebuilds += 1;
          const length = this.pathname.length;
          if (previous !== null && length >= previous)
            grew.push(`${url}: ${previous} then ${length}`);
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

    expect(grew.slice(0, 5)).toEqual([]);
    // Liveness: the shortening property means nothing unless some url ran more
    // than one pass. The bound is `pathname.length`, and section 1 is the
    // evidence that a remote input can walk most of the way to it.
    expect(rebuilds).toBeGreaterThan(urls.length);
  });

  test("every answer keeps its origin and is a fixed point of the redactor", () => {
    for (const url of urls) {
      const once = redactUrl(url);
      expect(redactUrl(once)).toBe(once);
      if (url.startsWith(ORIGIN)) expect(once.startsWith(ORIGIN)).toBe(true);
      if (url.startsWith("file:")) expect(once.startsWith("file:")).toBe(true);
    }
  });
});

// ── 6. Frontier item 4 — the relative branch, and what the fix did to it ─────
//
// The branch's own loop is still quadratic: `//a` repeated N times costs N
// resolutions of a text that shrinks by one group each time, because a parse
// consumes exactly one authority. Round 16 recorded that as the CALLER's own
// bill, and the fix did not change the order — it is the same N resolutions
// before and after, measured on both trees at 200, 400 and 800 groups.
//
// What decides the ownership is the second test: `response.url` is always an
// absolute serialization, so nothing a server writes reaches this branch. The
// defect in section 1 reaches it too, and reaches it from the caller's own
// relative url alone, which is why section 1 is driven from a 302 instead.

describe("the relative branch, on both sides", () => {
  test("its own loop is linear in the authorities the CALLER spelled", () => {
    // A two-argument parse is this branch's own step — `resolvedPath` resolving
    // the reference against `RELATIVE_BASE` — where the absolute branch's step
    // is the single-argument rebuild counted everywhere above.
    const resolutions = (url: string): number => {
      const native = globalThis.URL;
      let parses = 0;
      class Watched extends native {
        constructor(argument: string | URL, base?: string | URL) {
          super(argument, base);
          if (base !== undefined) parses += 1;
        }
      }
      globalThis.URL = Watched as unknown as typeof URL;
      try {
        redactUrl(url);
      } finally {
        globalThis.URL = native;
      }
      return parses;
    };

    // One resolution per authority the reference brings, and no more: a parse
    // consumes exactly one authority, so the count tracks the group count. That
    // is the arithmetic round 16 recorded, and the crossing did not move it —
    // the same three numbers come out of a checkout of the pre-fix tree.
    expect([8, 16, 32].map((groups) => resolutions(`${"//a".repeat(groups)}/x`))).toEqual([
      8, 16, 32,
    ]);
    expect(redactUrl(`${"//a".repeat(8)}/x`)).toBe("/x");
  });

  // The caller-side half of this claim — a relative request url reaching the
  // branch — is pinned in `response-loop-pass-cost.spec.ts`, which states both
  // halves of the reachability argument in its own comments.

  test("a server cannot reach it: a relative Location still leaves response.url absolute", async () => {
    const server = http.createServer((request, response) => {
      if ((request.url ?? "/") === "/one") {
        response.writeHead(302, { location: "/x/https:////@../@../v1" });
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
