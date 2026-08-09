import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { isHttpError, typedFetch } from "../../src/index";
import { NotFoundError } from "../../src/errors/not-found-error";
import { redactUrl } from "../../src/errors/redact-url";

// ═══════════════════════════════════════════════════════════════════════════
// ROUND 15 — H2, and the last round of the loop. Two jobs.
//
// FIRST, the newest code in the repository: the loop round 14 put inside
// `cleaned` (commit `185da0e`). It is the correctness guarantee of the whole
// redactor now — every question is asked of the text the module emits — and it
// is the only unbounded construct in the response phase. So it is measured
// here on three axes, and each axis is a fact about a url rather than a reading
// of the code:
//
//  - TERMINATION. The loop's measure is `parsed.pathname.length`. A pass emits
//    `withoutMalformedUserinfo(scanned, path.length, …)`, which is `path` with
//    zero or more spans removed and everything past `path.length` clipped, so
//    the emitted text is never longer than `path` and is equal to it only when
//    nothing was removed — the one case that returns. The rebuild is
//    `new URL(origin + clean)`, and its `pathname` is never longer than `clean`,
//    because `clean` is already a parser's own output: the path percent-encode
//    set is a fixed point of itself, and the one rewrite the rebuild can still
//    perform — dot-segment removal — only deletes. So each pass that does not
//    return strictly shortens a non-negative integer, and the loop runs at most
//    `pathname.length` times. Section 2 pins the observable half of that
//    argument: the answer's path is never longer than the path the platform's
//    own parser produced for the input.
//  - TOTALITY. `cleaned` sits inside `redactUrl`'s FIRST `try`, which exists to
//    catch a url that is not absolute. A throw from the rebuild would therefore
//    not surface as a throw at all: it would fall through to the relative
//    branch and answer an absolute url with a bare path, silently dropping the
//    origin the module promises never to move. Section 2 states that as a
//    property over a generated population — the answer for an absolute
//    hierarchical url always begins with that url's own `protocol//host` — so
//    the rebuild's totality is measured through the one channel a failure would
//    reach, instead of by asserting that nothing throws.
//  - THE BOUND IS REACHED, and that is R15-H2-01. Before this round, `pastFiller`
//    held the pass count down for the SEAM's cursor alone. The ordinary
//    region's cursor, in `malformedUserinfoSpans`, advanced over solidi only —
//    so a path that spells one empty userinfo per dot segment drained one
//    group per pass, and the response phase became quadratic in a url a
//    redirecting server chose. Section 1 is the fix: `pastFiller` now takes a
//    `dropped` set and holds down both cursors.
//
// SECOND, the handover. What this lane leaves proven, and where each property
// is pinned, is in the return, not in this file. Section 3 is the part of it
// that had to be re-measured rather than inherited: the loop runs inside the
// `BaseHttpError` constructor, so identity, `clone()`, and the body lifecycle
// now all sit downstream of a construct that can run thousands of passes, and
// none of the suites that pin them uses a url that runs more than one.
// ═══════════════════════════════════════════════════════════════════════════

const SECRET = "hunter2";

// ── 1. R15-H2-01 — the ordinary region drains one group per pass ──────────
//
// The seam and the ordinary region are two cursors over the same text, and
// round 14 gave only one of them the dot-segment rule. `pastFiller`
// advances `seamUserinfo`'s cursor over the solidi AND over the dot segments
// the rebuild's parse will drop, and its own comment states the reason: without
// it "a path spelling one credential and one dot segment per group drains one
// group per pass, and `redactUrl` becomes quadratic in a value a redirecting
// server chooses. Measured: 16 KB of them took 465 ms in one error
// construction, against 0.9 ms with this."
//
// The ordinary region's cursor, in `malformedUserinfoSpans`, is the other half
// of that sentence and did not get the rule:
//
//   cut = at + 1;
//   while (isSolidus(text[cut])) cut += 1;
//
// So the same input class, spelled where no seam exists, still drains one group
// per pass. `//@./@./@.…` is the minimal spelling. Its region opens at the two
// solidi, `looksLikeUserinfo` admits the empty userinfo at the region's start
// (rule 1, `end === start`), the span is the single `@`, and the cursor stops on
// the `.` that the `@`'s removal has just turned into a dot segment. The
// rebuild deletes that segment, the next group moves into the same position,
// and the next pass removes exactly one more character.
//
// REACHED FROM A REAL `Response`, which is the line round 14 drew and this
// crosses. `error.url` is `response.url`; after a redirect that is the url the
// SERVER chose, and the constructor redacts it once for `message`. `toJSON()`
// redacts it again, so a structured logger pays a second time per line.
//
// THE CONTROL IS THE SAME URL WITH ONE CHARACTER MORE PER GROUP. `a@./`
// repeated is the same length, holds the same number of `@`, `.` and `/`, and
// the redactor answers it with the byte-identical string — but every `@` in it
// is preceded by an `a` rather than by a `/`, so `looksLikeUserinfo`'s third
// rule admits the LAST `@` in the region and one span takes the whole path.
// The control is measured in the same run, over the same code, at the same
// size, for the same answer: what separates them is only the number of passes.
//
// Measured on this tree, outside the runner: 0.2 ms for the control and 205 ms
// for the subject at 8 KB, 2,732 passes against 3. At 16 KB — still inside
// Node's default 16 KB header limit (`http.maxHeaderSize` is 16384), so still a
// `Location` a server can send — it is 713 ms.
//
// THE FIX IS THE ONE ROUND 14 ALREADY WROTE, moved to the other cursor:
// `cut = pastFiller(text, at + 1)` in place of the solidus walk above.
// Measured on a patched copy: 2,731 passes become 2 and 209 ms becomes 1.1 ms
// at 8 KB, and the worst repeated-unit pass count over 47,916 inputs falls from
// 201 to 3. It is not answer-preserving everywhere — 68 of those 47,916 answers
// change, every one of them by removing MORE path text, which is this module's
// documented safe direction — so `redact-url.spec.ts`'s pinned strings have to
// be re-read rather than assumed.
//
// WHAT SHIPPED IS NARROWER, and the last clause above is the reason it had to
// be. Classified by the round-12 oracle rather than by inspection, the answer
// changes are NOT all over-redaction: a `..` swallowed by the span is a `..`
// the rebuild never performs, so the segment it would have popped SURVIVES.
// Six inputs in 200,000 generated ones lost a credential that way —
// `/svc:PW@http:/@bob//tok@internal.testsvc:PW@..` answers `/` today and
// `/svc:PW@http:/` under the one-line change, with the password in the emitted
// path. So the shared cursor takes a set: every dot spelling at the seam, where
// nothing a pop could shorten lies in front of it, and the SINGLE-dot spellings
// in an ordinary region, where arbitrary path text does. The function is
// `pastFiller` for that reason. The numbers this test measures are unchanged —
// 2,731 passes become 2, 204 ms becomes 0.6 ms at 8 KB — and no pinned string
// in `redact-url.spec.ts` moved. See its R15 section for the three properties
// that now hold the cursor, the pass count, and the loop's termination premise.

/** A path of `bytes` bytes built from `unit`, opening a region at its head. */
function pathOf(unit: string, bytes: number): string {
  return `/x//${unit.repeat(Math.floor(bytes / unit.length))}`;
}

describe("round 15 / H2 — the redaction loop's pass count is a url the server chooses", () => {
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

  /** The wall time of one `typedFetch` call that ends in an HTTP error. */
  async function costOf(path: string): Promise<{ ms: number; url: string; json: string }> {
    const started = performance.now();
    const { error } = await typedFetch(`${origin}/go${path}`);
    const ms = performance.now() - started;
    if (!error || !isHttpError(error)) throw new TypeError(`no http error for ${path}`);
    await error.cancel();
    return { ms, url: error.url, json: error.toJSON().url };
  }

  test("R15-H2-01: an 8 KB redirect target costs one pass per group in the response phase", async () => {
    const subject = pathOf("@./", 8_192);
    const control = pathOf("a@./", 8_192);
    // Same size, same characters, and — pinned below — the same answer. The
    // only difference is where the `@` sits inside its group.
    expect(Math.abs(subject.length - control.length)).toBeLessThan(8);

    // Warm the whole path once, so neither measurement pays for the first
    // parse, the first connection, or the first optimisation tier.
    await costOf(pathOf("@./", 64));
    const measuredControl = await costOf(control);
    const measured = await costOf(subject);

    // NON-VACUITY. The url is the SERVER's, both calls reached the response
    // phase, and the two answers are byte-identical — so the passes bought
    // nothing that the control did not also get.
    expect(measured.url).toBe(`${origin}${subject}`);
    expect(measuredControl.url).toBe(`${origin}${control}`);
    expect(measured.json).toBe(`${origin}/x//`);
    expect(measuredControl.json).toBe(`${origin}/x//`);

    // A budget against a control measured in the same run, over the same
    // function, at the same size, for the same answer — never a budget against
    // the clock. v8's instrumentation cannot separate these two the way the
    // ledger records it separating a subject from a differently-shaped control:
    // there is one shape here and one code path, and what differs is the number
    // of times it runs.
    expect(measured.ms - measuredControl.ms).toBeLessThan(100);
  }, 60_000);
});

// ── 2. The loop's termination measure and its totality ────────────────────
//
// Both are stated as facts about the answer, because the loop has no seam of
// its own: it is reached only through `redactUrl`, and only the string it
// returns is observable.
//
//  - THE MEASURE. `redactUrl`'s answer for an absolute hierarchical url is
//    `origin + clean` re-parsed, and `clean` is `pathname` minus removed spans.
//    So the answer's own pathname can never be LONGER than the pathname the
//    platform's parser produced for the input. That inequality is the loop's
//    variant; if it were ever false the loop would have no bound at all.
//  - TOTALITY. A throw out of `new URL(origin + clean)` would be caught by
//    `redactUrl`'s absolute `try` and answered by the relative branch, which
//    emits `pathname` alone. The origin would vanish from `message` and from
//    `toJSON().url` — the one failure mode this module calls worse than a leak,
//    "a redaction that lies is worse than one that leaks" — without any throw
//    reaching a caller. So totality is asserted as origin preservation.
//
// The population is built from the shapes that make the loop run: a region
// opened at two solidi or at a special scheme's colon, an `@` the removal turns
// into a dot segment, the four dot-segment spellings the URL Standard lists,
// and a credential behind them.

const HEADS = [
  "https://api.test",
  "http://h.test:8443",
  "file://",
  "ftp://f.test",
  "ws://w.test",
] as const;
const OPENERS = ["/", "//", "/x//", "/go/https:/", "/go/https://", "/./", "/%2e//"] as const;
const GROUPS = ["@./", "@../", "@%2e/", "@%2e%2e/", "@/", "a:b@./", ":@./", "x@.%2e/"] as const;
const TAILS = [
  "",
  "/v1",
  `alice:${SECRET}@internal.test/v1`,
  `?token=${SECRET}`,
  `#${SECRET}`,
  `alice:${SECRET}@/v1`,
] as const;

/** Every url the loop has to answer for, absolute and relative. */
function population(): string[] {
  const urls: string[] = [];
  for (const head of HEADS) {
    for (const opener of OPENERS) {
      for (const group of GROUPS) {
        for (const repeat of [1, 3]) {
          for (const tail of TAILS) {
            urls.push(head + opener + group.repeat(repeat) + tail);
            // The same path with no scheme in front of it: the relative
            // branch's own loop, which resolves against `url.invalid`.
            urls.push(opener + group.repeat(repeat) + tail);
          }
        }
      }
    }
  }
  return urls;
}

describe("round 15 / H2 — the loop terminates on a measure, and never fails its rebuild", () => {
  const urls = population();

  test("the answer's path is never longer than the path the parser produced", () => {
    const grew: string[] = [];

    for (const url of urls) {
      const answer = redactUrl(url);
      if (answer === "") continue;
      let inputPath: string;
      let answerPath: string;
      try {
        inputPath = new URL(url).pathname;
        answerPath = new URL(answer).pathname;
      } catch {
        // The relative branch. Both sides are paths already, and the answer
        // is measured against what the same base resolves the input to.
        inputPath = new URL(url, "http://url.invalid").pathname;
        answerPath = answer;
      }
      if (answerPath.length > inputPath.length) {
        grew.push(`${url} -> ${answer} (${inputPath.length} -> ${answerPath.length})`);
      }
    }

    expect(grew.slice(0, 5)).toEqual([]);
    expect(urls.length).toBeGreaterThan(3_000);
  });

  test("an absolute hierarchical url keeps its own origin, so the rebuild never threw", () => {
    const moved: string[] = [];
    let absolute = 0;

    for (const url of urls) {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        continue;
      }
      absolute += 1;
      const answer = redactUrl(url);
      // `origin` is `"null"` for `file:`, so the two fields are read directly.
      const own = `${parsed.protocol}//${parsed.host}`;
      if (!answer.startsWith(own)) moved.push(`${url} -> ${answer} (wanted ${own})`);
    }

    expect(moved.slice(0, 5)).toEqual([]);
    expect(absolute).toBeGreaterThan(2_000);
  });

  test("every answer is a fixed point of the redactor, on both branches", () => {
    const moving: string[] = [];

    for (const url of urls) {
      const once = redactUrl(url);
      const twice = redactUrl(once);
      if (twice !== once) moving.push(`${url} -> ${once} -> ${twice}`);
    }

    expect(moving.slice(0, 5)).toEqual([]);
  });
});

// ── 3. What the loop changed underneath this lane's properties ────────────
//
// The loop runs inside the `BaseHttpError` constructor, between the identity
// read and `bodies.set`. Every property this lane has pinned since round 10 —
// identity as a function of the response, the identity a `clone()` copy
// inherits, the body lifecycle, the release count — was pinned with a url the
// loop answers in ONE pass. These re-state four of them over a url that runs
// dozens, which is the only thing the loop can have changed about them: it can
// throw, and it can be slow, and neither must reach the identity or the stream.

/** A 404 whose body reports how many times its source was released. */
function countingResponse(url: string): { response: Response; released: () => number } {
  let released = 0;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("payload"));
      controller.close();
    },
    cancel() {
      released += 1;
    },
  });
  const response = new Response(body, { status: 404, statusText: "Not Found" });
  Object.defineProperty(response, "url", { value: url, configurable: true });
  return { response, released: () => released };
}

describe("round 15 / H2 — a url that runs the loop many times changes nothing below it", () => {
  // Twenty groups: twenty-one passes, and the same shape as R15-H2-01 at a
  // size that costs nothing.
  const many = `https://api.test${pathOf("@./", 60)}alice:${SECRET}@internal.test/v1`;

  test("the identity is the raw href, and both redacted channels carry one string", async () => {
    const { response, released } = countingResponse(many);
    const { error } = await typedFetch("https://api.test/v1", { fetch: async () => response });
    if (!error || !isHttpError(error)) throw new TypeError("no http error");

    // The loop redacts; it never edits what the identity recorded.
    expect(error.url).toBe(many);
    expect(error.status).toBe(404);
    expect(error.statusText).toBe("Not Found");
    // One string, in both channels, and it is a fixed point.
    const redacted = error.toJSON().url;
    expect(redacted).toBe(redactUrl(many));
    expect(redactUrl(redacted)).toBe(redacted);
    expect(error.message).toContain(redacted);
    expect(error.message).not.toContain(SECRET);
    expect(redacted).not.toContain(SECRET);

    await error.cancel();
    expect(released()).toBe(1);
  });

  test("the copy clone() builds inherits the identity rather than re-reading the branch", async () => {
    const { response, released } = countingResponse(many);
    const error = new NotFoundError(response);
    const copy = error.clone();

    expect(copy.url).toBe(error.url);
    expect(copy.message).toBe(error.message);
    expect(copy.toJSON()).toEqual(error.toJSON());

    // The tee's source is released once EVERY branch is released, and exactly
    // once — the property round 12 pinned, re-measured behind the loop.
    await Promise.all([error.cancel(), copy.cancel()]);
    expect(released()).toBe(1);
  });

  test("the body lifecycle is unmoved: one claim, then the library's refusal", async () => {
    const { response, released } = countingResponse(many);
    const error = new NotFoundError(response);

    await expect(error.text()).resolves.toBe("payload");
    await expect(error.json()).rejects.toThrow(/body/i);
    // A claimed body is not released by a later cancel, and cancel still
    // settles.
    await expect(error.cancel()).resolves.toBeUndefined();
    expect(released()).toBe(0);
  });
});
