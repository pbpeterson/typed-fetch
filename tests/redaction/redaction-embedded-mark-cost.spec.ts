import http from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, test } from "vitest";
import { redactUrl } from "../../src/errors/redact-url";
import { isHttpError, typedFetch } from "../../src/index";

// ═══════════════════════════════════════════════════════════════════════════
// ROUND 20 — H2. ONE URL, THREE SPELLINGS OF ITS MARK, AND TWO COSTS.
//
// Round 19 closed the ANSWER half of this sentence and left the COST half
// standing. Its own words, in `userinfo-spans.ts`:
//
//   "`https:/host`, `https:host`, and `https:\\host` all name the host
//    `https://host` names."
//   "A rule that answered differently for the same text under three spellings
//    of one mark was closing the case rather than the class."
//
// R19-H2-02 made the three spellings agree about WHAT is emitted. They still
// disagree about WHAT IT COSTS, and the disagreement is the whole of section 1:
// an embedded url whose mark is a special scheme's colon under EXACTLY ONE
// solidus drains one rebuild pass of `cleaned` per unit and runs a quadratic
// number of `parsesAsAuthority` parses, where the same embedded url spelled
// with none or with two costs two passes and a linear number of parses. One
// solidus is the spelling `userinfo-spans.ts` calls the one "every
// slash-collapsing proxy and every `path.join` produces".
//
// THE MECHANISM IS ONE CONSTANT. `AUTHORITY_MARK` is the literal `"://"`, and
// it is what bounds a region. A region OPENS over any solidus count including
// none — `authorityAt` says so — so a path spelled with one solidus per mark
// holds no `://` anywhere, `stop` stays `-1`, every region is unbounded, and
// every region's only candidate is the LAST `@` of the whole text. Each region
// then declines through `userinfoEnd`'s empty-userinfo guard, and the single
// `@` that no `/` follows is removed. One `@` per whole-string rebuild.
//
// AND ROUND 19 MEASURED THIS EXACT COST, of a tree it did not ship.
// `grammarWroteTheMark`'s comment argues that the guard must keep reading the
// NARROW question, and the argument it gives is a count:
//
//   "Widening the guard too moves no answer ... and costs a PASS per unit: the
//    guard declines the region, and rule 1 of `looksLikeUserinfo` then removes
//    the same `@` on the next whole-string rebuild because it has become the
//    text's last one. 1,000 units took 1,001 rebuilds and 499,500 parses
//    against 2 and 0."
//
// That sentence is the mechanism below, word for word, and the shipped NARROW
// guard pays it on a spelling the sentence's own input does not reach: 1,000
// units of `https:/@` take 1,001 rebuilds — the identical number — and 999,000
// parses. The cost was measured for the counterfactual and never asked of the
// form that shipped. It arrived with `fb12941`, round 18's anchor fix: the
// three trees before it answer this shape in two rebuilds.
//
// THE BOUND THIS FALSIFIES IS WRITTEN DOWN. `cleaned`'s own comment says:
// "Termination needs one character per pass; COST needs a constant number of
// passes... What supplies one is every cursor in this module advancing past
// everything the next parse will delete — `pastFiller`". This input holds no
// dot segment at all, so `pastFiller` supplies nothing, and the pass count is
// the input's length over eight.
//
// Sections 2, 3 and 4 are corpora that came out CLEAN, recorded so the next
// round does not redraw them: the `@`-free splitting families round 19's fixer
// left unclosed, the two questions the module now asks about one region, and
// the fourth instrument's growth bound.
//
// NOTHING HERE IS A TIME RATIO. Every claim in section 1 is a count, the
// remote input is named, and the termination bound is proved separately in its
// own test.
// ═══════════════════════════════════════════════════════════════════════════

const ORIGIN = "https://api.test";

/**
 * How much more the subject may cost than its control, measured in the same run.
 *
 * The control is spelled with two solidi, so it is a thousand characters LONGER
 * than the subject and names the same embedded url. A linear reader therefore
 * answers at or below 1, and the regression this bounds was a quadratic. The
 * bound sits far above 1 so a stalled runner cannot reach it, and far below a
 * restored quadratic so nothing can hide under it.
 */
const CONTROL_COST_BOUND = 20;

/**
 * One `redactUrl`, with six numbers read off the platform.
 *
 * THE FIRST FOUR ARE THE INSTRUMENTS THE AUDIT ALREADY HAS — round 16's
 * rebuild count and probe count, and round 19's forward and backward character
 * walks — kept unchanged so a reader can see which of them a shape moves.
 *
 * THE LAST TWO ARE THE FOURTH INSTRUMENT, and they measure a quantity none of
 * the four reads. `copied` is every character `String.prototype.slice` and
 * `String.prototype.toLowerCase` write into a new string; `parsedChars` is
 * every character handed to a `URL` constructor. A probe COUNT is flat while
 * each probe parses a longer text, and a `slice` copies its whole result
 * without stepping through anything an `indexOf` counter can see — so both are
 * work the earlier four spend without reporting.
 */
function measure(url: string, origin = ORIGIN) {
  const nativeUrl = globalThis.URL;
  const nativeSlice = String.prototype.slice;
  const nativeLower = String.prototype.toLowerCase;
  const nativeIndexOf = String.prototype.indexOf;
  const nativeLastIndexOf = String.prototype.lastIndexOf;
  let rebuilds = 0;
  let probes = 0;
  let forward = 0;
  let backward = 0;
  let copied = 0;
  let parsedChars = 0;
  class Watched extends nativeUrl {
    constructor(argument: string | URL, base?: string | URL) {
      super(argument, base);
      parsedChars += String(argument).length;
      if (base !== undefined) return;
      if (String(argument).startsWith(origin)) rebuilds += 1;
      else probes += 1;
    }
  }
  String.prototype.slice = function (this: string, start?: number, end?: number) {
    const answer = nativeSlice.call(this, start, end);
    copied += answer.length;
    return answer;
  } as typeof String.prototype.slice;
  String.prototype.toLowerCase = function (this: string) {
    const answer = nativeLower.call(this);
    copied += answer.length;
    return answer;
  } as typeof String.prototype.toLowerCase;
  String.prototype.indexOf = function (this: string, search: string, position?: number) {
    const found = nativeIndexOf.call(this, search, position);
    const from = position === undefined ? 0 : Math.max(0, position);
    forward += (found < 0 ? this.length : found) - from;
    return found;
  } as typeof String.prototype.indexOf;
  String.prototype.lastIndexOf = function (this: string, search: string, position?: number) {
    const found = nativeLastIndexOf.call(this, search, position);
    const from = position === undefined ? this.length : Math.min(this.length, position);
    backward += Math.max(0, from - (found < 0 ? 0 : found));
    return found;
  } as typeof String.prototype.lastIndexOf;
  globalThis.URL = Watched as unknown as typeof URL;
  let answer: string;
  try {
    answer = redactUrl(url);
  } finally {
    globalThis.URL = nativeUrl;
    String.prototype.slice = nativeSlice;
    String.prototype.toLowerCase = nativeLower;
    String.prototype.indexOf = nativeIndexOf;
    String.prototype.lastIndexOf = nativeLastIndexOf;
  }
  return { answer, length: url.length, rebuilds, probes, forward, backward, copied, parsedChars };
}

/** `units` copies of one embedded url, spelled with `mark` and an empty userinfo. */
function forwardPath(mark: string, units: number): string {
  return `/x/${`${mark}@`.repeat(units)}v1`;
}

// ── 1. R20-H2-01 — the pass count reads the solidus count the grammar drops ──

describe("one embedded mark, three spellings, two costs", () => {
  test("R20-H2-01: the platform says the three spellings are ONE embedded url", () => {
    // NON-VACUITY, read off the platform rather than asserted from the
    // standard. The bodies below differ only in how many solidi sit between
    // the scheme's colon and the authority, and the URL parser answers one
    // href for all three.
    const hrefs = new Set(
      ["https:", "https:/", "https://", "https:\\", "https:\\\\"].map(
        (mark) => new URL(`${mark}@cdn.test/v1`).href,
      ),
    );
    expect([...hrefs]).toEqual(["https://cdn.test/v1"]);
  });

  test("R20-H2-01: the rebuild pass count tracks the unit count under one solidus", () => {
    // The CORRECT behaviour, and it is the module's own: `cleaned` runs a
    // constant number of passes, and the constant does not depend on how many
    // times the caller's url spells one shape. The two control spellings show
    // what constant looks like.
    const rows = [100, 200, 400];
    const passes = (mark: string) =>
      rows.map((units) => measure(ORIGIN + forwardPath(mark, units)).rebuilds);

    // NON-VACUITY. The same embedded url with none and with two solidi costs
    // one constant, at every size.
    expect(new Set(passes("https:")).size).toBe(1);
    expect(new Set(passes("https://")).size).toBe(1);

    // ONE SOLIDUS. Same url, same characters but for the solidus count the
    // grammar discards, and the pass count is the unit count.
    expect({ mark: "https:/", passes: new Set(passes("https:/")).size }).toEqual({
      mark: "https:/",
      passes: 1,
    });
  });

  test("R20-H2-01: every special scheme reaches it, and only under one solidus", () => {
    // The defect is a property of the MARK, not of one scheme name. Five
    // schemes are special; `file:` is the one the module deliberately excludes
    // from `SPECIAL_SCHEMES`, and it must stay excluded.
    const growing: string[] = [];
    for (const mark of ["https:/", "http:/", "ws:/", "wss:/", "ftp:/", "HtTpS:/", "https:\\"]) {
      const small = measure(ORIGIN + forwardPath(mark, 100)).rebuilds;
      const large = measure(ORIGIN + forwardPath(mark, 400)).rebuilds;
      if (large > small) growing.push(`${mark}: ${small} -> ${large}`);
    }
    expect(growing).toEqual([]);
  });

  test("R20-H2-01: the guard round 19 priced for widening already pays that price", () => {
    // Round 19's own counterfactual input, on the shipped tree. It costs the
    // two rebuilds the comment credits the narrow guard with, so the sentence
    // is true of the input it names.
    expect(measure(`${ORIGIN}/x/${"@a//".repeat(1_000)}@b`).rebuilds).toBeLessThanOrEqual(3);

    // The SAME guard declining the SAME way, on a spelling that input cannot
    // reach: a region whose mark is a special scheme's colon under one
    // solidus. 1,000 units, and the count is the one the comment quotes for
    // the tree it rejected.
    expect(measure(`${ORIGIN}/x/${"https:/@".repeat(1_000)}v1`).rebuilds).toBeLessThanOrEqual(3);
  });

  test("R20-H2-01: the parse work is quadratic in a url the server chose", () => {
    // A linear reader of a text hands a parser a bounded multiple of it.
    // Eight is generous and scale-free: the two control spellings stay under
    // three at every size below.
    const overLinear: string[] = [];
    for (const mark of ["https:", "https://", "https:/"]) {
      for (const units of [100, 200, 400]) {
        const row = measure(ORIGIN + forwardPath(mark, units));
        if (row.parsedChars > 8 * row.length) {
          overLinear.push(`${mark} x${units}: ${row.length} chars, ${row.parsedChars} parsed`);
        }
      }
    }
    expect(overLinear).toEqual([]);
  });

  test("R20-H2-01: a 302 Location picks the cost, and toJSON() pays it again", async () => {
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

    /** One `typedFetch` that ends in an HTTP error, timed twice. */
    async function costOf(path: string) {
      const started = performance.now();
      const { error } = await typedFetch(`${origin}/go${path}`);
      const construction = performance.now() - started;
      if (!error || !isHttpError(error)) throw new TypeError(`no http error for ${path}`);
      const before = performance.now();
      const record = error.toJSON();
      const serialization = performance.now() - before;
      await error.cancel();
      return { construction, serialization, url: error.url, record: String(record.url) };
    }

    try {
      // The control is spelled with TWO solidi, so it is one thousand
      // characters LONGER than the subject and names the same embedded url.
      const subject = forwardPath("https:/", 1_000);
      const control = forwardPath("https://", 1_000);
      expect(control.length).toBeGreaterThan(subject.length);

      await costOf(forwardPath("https:/", 8)); // warm the socket and the tiers
      // The FASTEST of three calls each. Contention, GC, and a busy scheduler
      // only ever ADD time, so a minimum carries none of them into the verdict
      // while a single sample carries all of them.
      let measuredControl = await costOf(control);
      let measured = await costOf(subject);
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const nextControl = await costOf(control);
        const nextSubject = await costOf(subject);
        if (nextControl.construction < measuredControl.construction) measuredControl = nextControl;
        if (nextSubject.construction < measured.construction) measured = nextSubject;
      }

      // NON-VACUITY. The url is the SERVER's, it arrived unchanged — `https:/@`
      // spells no dot segment, so the platform's own redirect resolution
      // normalises nothing away — and both calls reached the response phase.
      expect(measured.url).toBe(`${origin}${subject}`);
      expect(measuredControl.url).toBe(`${origin}${control}`);
      expect(measured.record.length).toBeGreaterThan(0);

      // A budget against a control measured in the same run, over the same
      // function, at the same shape and a LARGER size — never a budget against
      // the clock. Both halves are asserted, because `toJSON()` re-runs
      // `redactUrl` and a logger calls it once per line.
      //
      // Round 24 made both halves RATIOS. `a - b < 100` is a number of
      // milliseconds however it is spelled, and `release.yml` runs this suite
      // under coverage on a shared runner, where 100 ms of scheduler noise is
      // an ordinary event and not a defect. The control is the LARGER input, so
      // a linear reader answers at or below 1.
      expect({
        construction: measured.construction / measuredControl.construction < CONTROL_COST_BOUND,
        serialization: measured.serialization / measuredControl.serialization < CONTROL_COST_BOUND,
      }).toEqual({ construction: true, serialization: true });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 120_000);

  test("the termination bound is separate, and it is untouched", () => {
    // A cost finding proves termination on its own, or a reader cannot tell a
    // quadratic from a hang. `cleaned` states the measure — `parsed.pathname`
    // strictly shorter on every pass that does not return — and this input
    // obeys it, one character at a time. That is exactly why the loop ENDS and
    // exactly why it is expensive, so the two claims are kept apart.
    const native = globalThis.URL;
    const grew: string[] = [];
    let rebuilds = 0;
    for (const units of [50, 100, 200]) {
      const url = ORIGIN + forwardPath("https:/", units);
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

// ── 2. The `@`-free splitting families round 19's fixer left unrecorded ──────
//
// Round 19's state file carries this as unclosed: "F2 measured 480 of the
// splitting families carrying no `@` at all, where the outer parse alone
// produces the divergence." Measured here, and it costs nothing, for a reason
// that is structural rather than a count: every span this module can answer
// with ends at an `@` — `userinfoEnd` reads `lastAt`, `seamUserinfoEnd` reads
// `lastIndexOf("@")` — so a text holding none yields no span, `clean === path`
// on the first pass, and `redactUrl` is EXACTLY the platform's own parse with
// the value slots cleared. The seven spellings then split precisely where
// `new URL` splits them, and on nothing else.

describe("the splitting families that carry no `@` at all", () => {
  const schemes = ["https", "http", "ws", "wss", "ftp", "HTTPS"];
  const spellings = ["", "/", "//", "///", "////", "\\\\", "/\\"];
  const fillers = ["..", "%2e%2e", ".%2e", "../.."];
  const runs = ["/", "//", "///"];
  const authorities = ["cdn.test:8443", "cdn.test", "h.test:1", "a:1234"];
  const tails = ["/users/alice", "/alice", "/img/bob", "/u/v/carol"];

  /** Every `@`-free member of round 19's own family grid, wrapped in a forward. */
  function members(): string[] {
    const urls: string[] = [];
    for (const scheme of schemes)
      for (const spelling of spellings)
        for (const filler of fillers)
          for (const run of runs)
            for (const authority of authorities)
              for (const tail of tails)
                urls.push(`${ORIGIN}/go/${scheme}:${spelling}${filler}${run}${authority}${tail}`);
    return urls;
  }

  test("the redactor is the identity on them, so no span-level rule reaches them", () => {
    const moved: string[] = [];
    let checked = 0;
    for (const url of members()) {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        continue;
      }
      checked += 1;
      parsed.username = "";
      parsed.password = "";
      parsed.search = "";
      parsed.hash = "";
      const answer = redactUrl(url);
      if (answer !== parsed.href) moved.push(`${url} -> ${answer} (parse says ${parsed.href})`);
      // No `@` reaches the emitted record either, so nothing can be a
      // credential the scan gave up on.
      if (answer.includes("@")) moved.push(`${url} -> ${answer} (an @ appeared)`);
    }
    expect(moved.slice(0, 5)).toEqual([]);
    expect(checked).toBe(8_064);
  });

  test("no member loses the authority its own parse names, and none invents one", () => {
    const wrong: string[] = [];
    let split = 0;
    for (const scheme of schemes)
      for (const filler of fillers)
        for (const run of runs)
          for (const authority of authorities)
            for (const tail of tails) {
              const body = `${filler}${run}${authority}${tail}`;
              const answers = spellings.map((spelling) =>
                redactUrl(`${ORIGIN}/go/${scheme}:${spelling}${body}`),
              );
              if (new Set(answers).size > 1) split += 1;
              for (const [at, answer] of answers.entries()) {
                const url = `${ORIGIN}/go/${scheme}:${spellings[at]!}${body}`;
                // The record always names this url's own host and no other.
                if (!answer.startsWith(`${ORIGIN}/`)) wrong.push(`${url} -> ${answer}`);
                const label = authority.split(":")[0]!;
                if (!answer.includes(label)) wrong.push(`${url} lost ${label}: ${answer}`);
              }
            }
    expect(wrong.slice(0, 5)).toEqual([]);
    // The families DO split — 1,152 of them — and every split above is the
    // platform's own dot-segment removal, reproduced in the previous test as
    // an exact identity with `new URL`.
    expect(split).toBe(1_152);
  });
});

// ── 3. R20-H2-02 — the colon of an EMPTY password refuses the suppression ───
//
// Round 17 taught the module that a colon can belong to `host:port`, and round
// 18 taught it which colons refuse that reading: condition 2 of
// `readsAsHostAndPort` refuses "only a colon that DELIMITS something: one with
// text in front of it, in front of the authority's last `@`". Round 18's own
// sentence for why it had to be narrowed is the sentence this section is
// about:
//
//   "`new URL("https://:@cdn.test/users/@alice").href` IS
//    `https://cdn.test/users/@alice`, so those two are ONE url and this module
//    has to answer them alike. It did not."
//
// A userinfo has TWO empty spellings, and round 18 asked only one of them. The
// other is an empty PASSWORD: `u:@` and `u@` are one userinfo, the URL parser
// erases the colon exactly as it erases the whole of `:@`, and
// `new URL("https://u:@cdn.test:8443/x").href` is `https://u@cdn.test:8443/x`
// on every runtime. Condition 2 reads that colon as a delimiter — it has text
// in front of it and it precedes the authority's last `@` — so it refuses the
// suppression, the colon rule fires, and the span runs to the handle at a
// segment head.
//
// `https://api.test/go/https://u:@cdn.test:8443/users/@alice` emits
// `https://api.test/go/https://alice`. `cdn.test:8443` — the authority the url
// named — is gone, and `alice`, a user's handle, is what the forward now
// names. That is R17-H3-01 verbatim, restored by a character the platform
// throws away, which is R18-H3-01's sentence word for word.
//
// AND THE SPELLING IS ORDINARY. `https://APIKEY:@host/` is how a client writes
// an API key into basic auth with no password, and a forward that carries one
// in its path is the shape this whole module exists for.

const EMPTY_PASSWORD_OPENERS = ["u:@", "svc:@", "APIKEY:@"] as const;

describe("an empty password is a userinfo the parser erases", () => {
  test("R20-H2-02: the platform says `u:@` and `u@` are ONE url", () => {
    // NON-VACUITY, read off the platform. The colon of an empty password
    // carries no information at all: the two spellings serialize alike.
    const pairs = EMPTY_PASSWORD_OPENERS.map((opener) => [
      new URL(`https://${opener}cdn.test:8443/users/@alice`).href,
      new URL(`https://${opener.replace(":@", "@")}cdn.test:8443/users/@alice`).href,
    ]);
    expect(pairs.filter(([left, right]) => left !== right)).toEqual([]);
  });

  test("R20-H2-02: and the record names the handle under one of the two", () => {
    // The CONTROL is the same url with the erased colon written out, and it is
    // round 17's own promise: the embedded authority survives and the handle
    // stays a path segment.
    expect(redactUrl(`${ORIGIN}/go/https://u@cdn.test:8443/users/@alice`)).toBe(
      `${ORIGIN}/go/https://cdn.test:8443/users/@alice`,
    );

    // THE SUBJECT. One character the URL parser deletes before it answers, and
    // `cdn.test:8443` is gone while `alice` is the last thing the record names.
    const answer = redactUrl(`${ORIGIN}/go/https://u:@cdn.test:8443/users/@alice`);
    expect({
      keeps: answer.includes("cdn.test:8443"),
      endsAtTheHandle: answer.endsWith("/alice"),
    }).toEqual({ keeps: true, endsAtTheHandle: false });
  });

  test("R20-H2-02: every mark spelling and every authority reaches it", () => {
    // The defect is a property of the OPENER, so it fires under every spelling
    // of the mark the module opens a region on, and under a bare pair of
    // solidi as well as behind a scheme.
    const lost: string[] = [];
    let checked = 0;
    for (const mark of ["https://", "https:/", "https:", "//", "///", "ws://", "\\\\"])
      for (const opener of EMPTY_PASSWORD_OPENERS)
        for (const authority of ["cdn.test:8443", "cdn.test", "h.test:1"])
          for (const tail of ["/users/@alice", "/@alice", "/img/@bob", "/u/v/@carol"]) {
            const url = `${ORIGIN}/go/${mark}${opener}${authority}${tail}`;
            const answer = redactUrl(url);
            checked += 1;
            const label = authority.split(":")[0]!;
            // The authority the url named survives, and the handle at the end
            // of the path never becomes the last thing the record names.
            if (!answer.includes(label)) lost.push(`${url} -> ${answer}`);
          }
    expect(lost.length).toBe(0);
    expect(checked).toBe(252);
  });

  test("R20-H2-02: the documented residuals still hold, so this is not that rule", () => {
    // A colon that DOES delimit a password must go on refusing the reading,
    // and residual 1's own two shapes must keep their recorded answers. This
    // test passes on the current tree and has to go on passing: the finding
    // above is the EMPTY password, and nothing else.
    expect(redactUrl(`${ORIGIN}/go/https://svc:PW@i.test/users/@bob`)).toBe(
      `${ORIGIN}/go/https://bob`,
    );
    expect(redactUrl(`${ORIGIN}/go/https://:@cdn.test/users/@alice`)).toBe(
      `${ORIGIN}/go/https://:@cdn.test/users/@alice`,
    );
    expect(redactUrl(`${ORIGIN}/go/://a:1234/x/@bob`)).toBe(`${ORIGIN}/go/://bob`);
  });

  test("R20-H2-02: a 302 Location makes the record name a host nobody contacted", async () => {
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
      const target = "/x/https://APIKEY:@cdn.test:8443/users/@alice";
      const { error } = await typedFetch(`${origin}/go${target}`);
      if (!error || !isHttpError(error)) throw new TypeError("expected an http error");
      try {
        // NON-VACUITY: the url is the SERVER's, and it arrived unchanged.
        expect(error.url).toBe(`${origin}${target}`);

        // Every channel that carries the url agrees, and all of them name a
        // host the request never contacted while dropping the one it named.
        const record = error.toJSON();
        const channels = [error.message, String(record.url), String(record.message)];
        expect(
          channels.map((text) => ({
            keeps: text.includes("cdn.test:8443"),
            namesTheHandle: /\/\/alice\b/.test(text) || text.endsWith("/alice"),
          })),
        ).toEqual([
          { keeps: true, namesTheHandle: false },
          { keeps: true, namesTheHandle: false },
          { keeps: true, namesTheHandle: false },
        ]);
      } finally {
        await error.cancel();
      }
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 60_000);
});

// ── 4. The fourth instrument, and its growth bound ──────────────────────────
//
// `copied` and `parsedChars` are quantities the four earlier instruments do not
// read. Over the adversarial corpus below — every shape any round of this audit
// built, plus the families a randomised search over the URL grammar's own token
// alphabet turned up — both stay under a fixed multiple of the input's length.
// The one family that does not is section 1's, and it is excluded here by name
// rather than by a threshold, so this test states a bound instead of pinning a
// defect.

describe("the fourth instrument states a linear bound", () => {
  const shapes: Record<string, (units: number) => string> = {
    "round 15: an empty userinfo and a dot": (n) => `${ORIGIN}/x//${"@./".repeat(n)}v1`,
    "round 16: a double-dot group": (n) => `${ORIGIN}/x${"/".repeat(2 * n)}${"@../".repeat(n)}v1`,
    "round 17: the same behind a colon": (n) =>
      `${ORIGIN}/x/https:${"/".repeat(2 * n)}${"@../".repeat(n)}v1`,
    "round 18: an unbounded region per unit": (n) => `${ORIGIN}/x${"/ws:a:1".repeat(n)}/@b`,
    "round 19: a bare pair of solidi": (n) => `${ORIGIN}/x${"//a".repeat(n)}/@b`,
    "two solidi and an empty userinfo": (n) => `${ORIGIN}/x${"//@".repeat(n)}/@b`,
    "a handle at every segment head": (n) => `${ORIGIN}/x${"/@a/".repeat(n)}/@b`,
    "a credential per unit": (n) => `${ORIGIN}/x${"/go/https://svc:pw@h.test".repeat(n)}/v1`,
    "an authority with a port per unit": (n) => `${ORIGIN}/x${"//@h.test:1".repeat(n)}/@b`,
    "an erased userinfo per unit": (n) => `${ORIGIN}/x${"//:@h.test:1".repeat(n)}/@b`,
    "a bounded region per unit": (n) => `${ORIGIN}/x${"/ws://:@h.test:1".repeat(n)}/@b`,
    "the seam, at an empty host": (n) => `file://${"/".repeat(2 * n)}${"@../".repeat(n)}v1`,
    "the backslash spelling": (n) => `${ORIGIN}/x${"//a\\b".repeat(n)}/@b`,
    "two solidi under a scheme": (n) => `${ORIGIN}/x/${"https://@".repeat(n)}v1`,
    "no solidus under a scheme": (n) => `${ORIGIN}/x/${"https:@".repeat(n)}v1`,
    "an encoded pop per unit": (n) => `${ORIGIN}/x${"/".repeat(2 * n)}${"@%2e%2e/".repeat(n)}v1`,
  };

  test("copied and parsed characters stay linear in the input on every shape", () => {
    const overLinear: string[] = [];
    for (const [name, make] of Object.entries(shapes)) {
      for (const units of [200, 400]) {
        const row = measure(make(units));
        const budget = 24 * row.length;
        if (row.copied > budget || row.parsedChars > budget) {
          overLinear.push(
            `${name} x${units}: ${row.length} chars, ${row.copied} copied, ${row.parsedChars} parsed`,
          );
        }
      }
    }
    expect(overLinear).toEqual([]);
  });

  test("and the instrument is not vacuous: it reads work the other four miss", () => {
    // A shape on which every earlier instrument is flat and this one is not
    // would be a new defect; there is none in the corpus above, and that is the
    // recorded result. What the instrument DOES read is the size of the work,
    // not only its count: one url below runs a bounded number of probes and
    // hands the parser far more text than another that runs the same number.
    const dense = measure(`${ORIGIN}/x${"/go/https://svc:pw@h.test".repeat(400)}/v1`);
    const sparse = measure(`${ORIGIN}/x${"//a".repeat(400)}/@b`);
    expect(dense.copied).toBeGreaterThan(0);
    expect(sparse.copied).toBeGreaterThan(0);
    expect(dense.parsedChars + dense.copied).toBeGreaterThan(sparse.parsedChars + sparse.copied);
  });
});
