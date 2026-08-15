import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { isHttpError, typedFetch } from "../../src/index";
import { redactUrl } from "../../src/errors/redact-url";

// ═══════════════════════════════════════════════════════════════════════════
// ROUND 16 — H2. The cursor class, read through the seam round 15 found.
//
// Round 15 closed R15-H2-01 with a cursor rule that takes a SET: the seam's
// cursor advances past every dot-segment spelling, and the ordinary region's
// cursor advances past the SINGLE-dot spellings only. The narrowing is correct
// and must stay — `redact-url.spec.ts`'s "the cursor swallows what deletes
// itself, never what pops a name" holds the input that loses a password the
// moment an ordinary region's span eats a `..`.
//
// What round 15 did NOT establish is that the narrowing costs nothing. It
// measured the pass count over one opener — `/x//` — and recorded the worst
// repeated-unit count as 3. The opener is the load-bearing part of that
// measurement, and it was held fixed. The region the `@` sits in opens at two
// solidi; a pop consumes ONE of the empty segments those solidi spell; so with
// two solidi the second pass finds no region and the loop stops, and with 2N
// solidi it finds one N times over.
//
// Section 1 is that input. Section 2 drives it from a real `node:http` 302, so
// the growth belongs to a server rather than to a caller. Section 3 is the
// termination bound, stated separately, because a cost finding is a claim about
// the number of passes and not about whether the loop ends.
//
// Section 4 is frontier item 4: where the relative branch is reachable from
// `typedFetch`, and why its own quadratic still belongs to the caller.
// ═══════════════════════════════════════════════════════════════════════════

const ORIGIN = "https://api.test";

/**
 * Every single-argument `new URL(…)` the redactor performs for `url`, split
 * into the loop's REBUILDS and the scanner's authority probes.
 *
 * The seam is round 15's and belongs to the platform: `./redact-url` names
 * `URL` as a global and resolves it on every call, so a subclass installed for
 * the length of one synchronous call reads the loop's own steps without the
 * module holding a counter for anyone.
 *
 * The split matters here in a way it did not in round 15. `parsesAsAuthority`
 * in `./userinfo-spans` also performs a single-argument `new URL`, once per
 * region and over a slice bounded by the next `://`, so a path of N marks
 * performs N probes and stays linear. `https://api.test/x` + `\\@https:`
 * repeated is that shape: 8,000 probes for 36 KB and 4 ms, with two rebuilds.
 * Counting the two together would call it a cost defect. Only the REBUILD count
 * is a pass of `cleaned`, and only it multiplies a whole-string scan.
 */
function rebuildsOf(url: string): number {
  const native = globalThis.URL;
  let rebuilds = 0;
  class Watched extends native {
    constructor(argument: string | URL, base?: string | URL) {
      super(argument, base);
      if (base === undefined && String(argument).startsWith(ORIGIN)) rebuilds += 1;
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

// ── 1. R16-H2-01 — the ordinary cursor's `..` still drains one group a pass ──
//
// The unit is `@../`, which round 15 already lists in its own UNITS array. What
// is new is the OPENER: `2 * groups` solidi in front of it rather than two.
//
// One pass, read off the loop's own arguments at four groups:
//
//   /x////////@../@../@../@../      the input
//   /x////////../@../@../@../       one `@` removed; the cursor stopped on the
//                                   `..` its own removal created
//   /x///////../@../@../            the rebuild popped one empty segment, and
//                                   the next group moved into the same place
//   /x//////../@../
//   /x/////../
//   /x////                          the answer
//
// Every line is a whole-string scan of a text that is still Θ(N) long, so N
// groups cost N + 1 passes and the response phase is quadratic in the length of
// a url the SERVER chose. Measured on this tree, outside the runner:
// 401 rebuilds and 10 ms at 2.4 KB, 801 and 37 ms at 4.8 KB, 1,601 and 143 ms
// at 9.6 KB. Node's default `http.maxHeaderSize` is 16384, so a `Location` may
// be half again as long as the last of those.
//
// THE SEAM'S CURSOR IS NOT THE ONE AT FAULT, which is why this is a cost
// finding and not a correction to round 15. `pastFiller`'s `dropped` parameter
// is right: a `..` an ordinary region's span swallows is a `..` the rebuild
// never performs, and the segment it would have popped survives instead. The
// pass count has to come down some other way — the region loop gives up at the
// `..` and `nextAuthority` finds nothing after it, so the pass emits one
// character of progress and re-scans everything.

/** A redirect target of `groups` `@../` groups behind enough solidi to feed them. */
function popPath(groups: number): string {
  return `/x${"/".repeat(2 * groups)}${"@../".repeat(groups)}v1`;
}

describe("the pass count is still a number the redirect target picks", () => {
  test("R16-H2-01: 400 `@../` groups cost 400 passes where four cost four", () => {
    const few = rebuildsOf(ORIGIN + popPath(4));
    const many = rebuildsOf(ORIGIN + popPath(400));

    // NON-VACUITY FIRST. Both urls are answered, both keep their origin, and
    // the answer is the same shape at both sizes — so the passes buy nothing
    // the four-group url did not already get.
    expect(redactUrl(ORIGIN + popPath(4))).toBe(`${ORIGIN}/x////v1`);
    expect(redactUrl(ORIGIN + popPath(400))).toBe(`${ORIGIN}/x${"/".repeat(400)}v1`);

    // EQUAL, not merely bounded, which is the property round 15 pinned for its
    // own opener: "four groups and four hundred groups cost the same number of
    // parses". A count the input still moves is a count a server chooses.
    expect(many).toBe(few);
  });

  test("R16-H2-01: the count does not track the group count", () => {
    // The defect was that the count tracked the group count one for one, so a
    // server chose the work by choosing how long the redirect target was. The
    // property that closes it is CONSTANCY, and the assertion compares the
    // counts with each other rather than with a literal: a literal taken from
    // one tree pins that tree's arithmetic, and the first version of this test
    // pinned the defective tree's four-group value.
    const counts = [4, 8, 16, 32].map((groups) => rebuildsOf(ORIGIN + popPath(groups)));
    expect(new Set(counts).size).toBe(1);
    // A ceiling alone would hide a slower growth, so it rides beside the
    // constancy check and only catches a gross regression.
    expect(counts[0]).toBeLessThanOrEqual(8);
  });
});

// ── 2. The same input, chosen by a server rather than by the caller ──────────
//
// `error.url` is `response.url`, and after a redirect that is the url the
// SERVER wrote into `Location`. The constructor redacts it once for `message`,
// and `toJSON()` redacts it again — so a structured logger pays the pass count
// a second time per log line, which is the channel this section measures.
//
// The count is read around `toJSON()` alone, deliberately. It is synchronous,
// it performs exactly one `redactUrl`, and no transport parse can reach it.
// A wall-clock budget would say the same thing less precisely, and
// `CONTRIBUTING.md` forbids a time ratio as the whole of a cost finding.

describe("a 302 Location chooses how many passes toJSON() runs", () => {
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
    const { error } = await typedFetch(`${origin}/go${popPath(groups)}`);
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

  test("R16-H2-01: the url is the server's, and the log line's cost grows with it", async () => {
    const few = await parsesPerLogLine(4);
    const many = await parsesPerLogLine(400);

    // The input is REMOTE: the path came back verbatim in `Location`, and the
    // platform's own redirect parse did not shorten it — `@..` is not a
    // double-dot path segment, so no normalisation removes it before the
    // library ever sees it.
    expect(few.url).toBe(`${origin}${popPath(4)}`);
    expect(many.url).toBe(`${origin}${popPath(400)}`);

    expect(many.parses).toBe(few.parses);
  }, 30_000);
});

// ── 3. The termination bound, stated apart from the cost ─────────────────────
//
// THE MEASURE IS `parsed.pathname.length`, and this is the sentence a fixer can
// paste into a comment on `cleaned`:
//
//   The loop ends because each pass that does not return strictly shortens
//   `parsed.pathname.length`. `clean` is the scanned path with zero or more
//   spans removed and everything past `path.length` clipped, so
//   `clean.length <= path.length`; `clean === path` is the ONE case that
//   returns, so a pass that continues has `clean.length < path.length`; and
//   `new URL(origin + clean).pathname` is never longer than `clean`, because
//   `clean` is already a parser's own `pathname` with spans cut out of it —
//   the path percent-encode set is a fixed point of it, and the one rewrite
//   the rebuild can still perform, dot-segment removal, only deletes. `clean`
//   keeps index 0's `/`, which no span can reach, so the empty path the
//   rebuild would answer with `/` never arises.
//
// The three steps bound the pass count by `pathname.length`, and section 1
// shows that bound is REACHED: the defect above is quadratic, never unbounded,
// and cannot hang. Both halves have to be executable, or a fix for one is free
// to break the other.

describe("the loop's measure holds over the shape that reaches its bound", () => {
  const urls = [4, 8, 16, 32, 64].flatMap((groups) => [
    ORIGIN + popPath(groups),
    `file://${popPath(groups)}`,
    popPath(groups),
  ]);

  test("no rebuild ever answers with a pathname longer than the path it was given", () => {
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
          if (previous !== null && length >= previous) {
            grew.push(`${url}: ${previous} then ${length}`);
          }
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

    // Every pass after the first strictly shortens the measure, which is the
    // whole of the termination argument.
    expect(grew.slice(0, 5)).toEqual([]);
    // Liveness, not cost: the shortening property means nothing unless some
    // url ran more than one pass. One rebuild per url would satisfy the
    // assertion above while measuring nothing. The first version of this test
    // asked for more than 200 rebuilds, a number only the defective tree could
    // reach, so closing R16-H2-01 would have turned a green test red.
    expect(rebuilds).toBeGreaterThan(urls.length);
  });

  test("every answer keeps its origin and is a fixed point of the redactor", () => {
    for (const url of urls) {
      const once = redactUrl(url);
      expect(redactUrl(once)).toBe(once);
      if (url.startsWith(ORIGIN)) expect(once.startsWith(ORIGIN)).toBe(true);
    }
  });
});

// ── 4. Frontier item 4 — where the relative branch is, and is not, reachable ─
//
// The branch is REACHABLE from `typedFetch`, and the input that reaches it is
// an ordinary one: a relative request url. On Node there is no document base,
// so `new Request("/v1/thing")` throws, the setup phase refuses, and the
// `NetworkError` it produces carries the caller's own relative string as `url`.
// `toJSON()` then redacts it through the relative branch.
//
// What that does NOT give the branch is a remote input. `response.url` is
// always an absolute serialization — the platform resolves every redirect
// against the request url before it fills the slot — so the branch is
// unreachable from anything a server writes, and the quadratic round 15
// recorded there (N `//host` groups cost N parses) stays a caller's own bill.
// The two tests below pin each half.

describe("the relative branch's reachability, on both sides", () => {
  test("a relative request url reaches the branch, and the branch redacts it", async () => {
    const { error } = await typedFetch("//svc:hunter2@internal.test/v1?token=s3cret");
    if (!error || isHttpError(error)) throw new TypeError("expected a pre-response error");

    // The full href stays on the escape hatch, exactly as it does for a
    // response-borne url.
    expect(error.url).toBe("//svc:hunter2@internal.test/v1?token=s3cret");
    // And the redacted channel is the relative branch's answer: the path alone,
    // with the consumed authority's credential gone.
    expect(error.toJSON().url).toBe("/v1");
    expect(JSON.stringify(error)).not.toContain("hunter2");
    expect(JSON.stringify(error)).not.toContain("s3cret");
  });

  test("a server cannot reach it: every redirect leaves response.url absolute", async () => {
    const server = http.createServer((request, response) => {
      const path = request.url ?? "/";
      if (path === "/one") {
        response.writeHead(302, { location: "//127.0.0.1:0//a//b/two" });
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
      // Either the redirect was followed and `response.url` is absolute, or the
      // platform refused it before any response existed. Neither hands the
      // relative branch a text a server wrote.
      const url = error.url;
      expect(() => new URL(url)).not.toThrow();
      expect(url.startsWith("http://")).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
