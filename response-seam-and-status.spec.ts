import { describe, expect, test } from "vitest";
import { isHttpError, typedFetch } from "./src/index";
import { NotFoundError } from "./src/errors/not-found-error";
import { redactUrl } from "./src/errors/redact-url";

// ═══════════════════════════════════════════════════════════════════════════
// ROUND 13 — H2. Round 12 rewrote `src/errors/redact-url.ts` (commit
// `6f5bbfe`): a region now opens where the URL Standard opens an authority,
// including AT THE SEAM the parser consumed, and the relative answer is
// resolved until it stops moving. Both run inside the `BaseHttpError`
// constructor, inside the response phase's `try`, so this lane owns them.
//
//  1. THE SEAM'S GUARD FAILS OPEN. `seamUserinfo` asks the parser whether the
//     text between the path's leading solidi and its first delimiter is an
//     authority, and answers `null` when that parse THROWS. A parse throws for
//     a host the caller got wrong — an empty one, an out-of-range port — and
//     then no region opens over the credential at all and the password reaches
//     `message` and the `toJSON()` record verbatim. R13-H2-01.
//  2. THE RESOLUTION LOOP IS TOTAL AND IT TERMINATES, with a bound. "Resolved
//     until it stops moving" is a loop that can fail to stabilise, and nothing
//     pins that it does. Stated as three properties: it answers for every input
//     (totality), it drains EVERY authority a caller nests and then stops
//     (termination, over depths up to 2,000), and its answer names no host when
//     the same parser reads it back (the post-condition the loop exists for).
//  3. THE CLASS IS A PURE FUNCTION OF THE RECORDED STATUS. Rounds swept all 200
//     statuses with an honest response and swept hostile fields at one status.
//     Neither states the product: over 200 statuses crossed with eight hostile
//     presentations of every OTHER field, an accepted response is answered with
//     the class its status alone selects.
// ═══════════════════════════════════════════════════════════════════════════

/** A real 4xx `Response` whose `url` is the one under test. */
function responseWith(url: string, status = 404): Response {
  const response = new Response("{}", { status, statusText: "Not Found" });
  Object.defineProperty(response, "url", { value: url, configurable: true });
  return response;
}

// ── 1. R13-H2-01 — the seam's userinfo survives a host that does not parse ──
//
// `seamUserinfo` is the one span in this module the PARSER alone decides. It
// takes the text between the path's leading solidi and its first `/`, `\`, `?`
// or `#`, asks `new URL("https://" + text + "/")` whether that is an authority,
// and removes everything up to the last `@` when the answer carries a
// credential. It answers `null` when the question THROWS.
//
// The question throws for a host the caller got wrong, and a credential is
// exactly where a caller gets one wrong: `${scheme}${user}:${pass}@${host}/v1`
// with an empty `host`, or a port the template built out of a string. The
// credential is unchanged and the module's own answer about it inverts —
// `file:///alice:hunter2@internal.test/v1` emits `file:///internal.test/v1`,
// and `file:///alice:hunter2@/v1` emits itself.
//
// This is not residual 2 (a secret in a path SEGMENT). The module decides this
// class is userinfo rather than path, and `redact-url.spec.ts` pins that
// decision on both sides of the seam. It is also not the closed item "a `file:`
// URL keeps its path": the protocol-relative pair carries no `file:` at all.
//
// `parsesAsAuthority`, the region's END question, documents the direction the
// module takes everywhere else: a parse that FAILS widens what is removed,
// because "there is no authority for a mark to be the end of". At the seam a
// parse that fails narrows the removal to nothing.

const SECRET = "hunter2";

/**
 * Each row is one credential the caller wrote, spelled with a host the parser
 * READS and a host it REFUSES. Both sides carry the same userinfo.
 */
const SEAM_PAIRS: readonly { label: string; parses: string; refuses: string }[] = [
  {
    label: "an empty host, at the seam a host-less origin spells",
    parses: "file:///alice:hunter2@internal.test/v1",
    refuses: "file:///alice:hunter2@/v1",
  },
  {
    label: "a port out of range, at the same seam",
    parses: "file:///alice:hunter2@internal.test/v1",
    refuses: "file:///alice:hunter2@internal.test:99999/v1",
  },
  {
    label: "an empty host, at the seam a protocol-relative reference spells",
    parses: "//https:/alice:hunter2@internal.test/v1",
    refuses: "//https:/alice:hunter2@/v1",
  },
  {
    label: "a port out of range, at the protocol-relative seam",
    parses: "//https:/alice:hunter2@internal.test/v1",
    refuses: "//https:/alice:hunter2@internal.test:99999/v1",
  },
  {
    label: "a host the template never filled in",
    parses: "//https:/alice:hunter2@internal.test/v1",
    refuses: "//https:/alice:hunter2@",
  },
];

describe("round 13 / H2 — the seam removes a credential whatever the host after it spells", () => {
  test("R13-H2-01: a credential at the seam reaches message and toJSON when the host does not parse", async () => {
    const leaked: string[] = [];
    const removed: string[] = [];

    // THE STANDARD THIS TEST HOLDS THE SEAM TO IS THE SUITE'S OWN. The same
    // credential and the same empty host, spelled as an ABSOLUTE url, is
    // already pinned to emit nothing at all — `redact-url.spec.ts` states it.
    // So this text is not a path segment this module keeps; it is the userinfo
    // it removes, and only the host after it changed.
    expect(redactUrl("http://alice:hunter2@/v1")).toBe("");

    for (const { label, parses, refuses } of SEAM_PAIRS) {
      for (const [side, url] of [
        ["parses", parses],
        ["refuses", refuses],
      ] as const) {
        const { error } = await typedFetch("https://api.test/v1", {
          fetch: async () => responseWith(url),
        });
        if (!error || !isHttpError(error)) throw new TypeError(`no http error for ${url}`);
        await error.cancel();

        const record = error.toJSON();
        // The escape hatch keeps the full href by design. The two redacted
        // forms may not carry the password.
        if (error.message.includes(SECRET)) leaked.push(`${label} (${side}): ${error.message}`);
        if (record.url.includes(SECRET)) leaked.push(`${label} (${side}): ${record.url}`);
        if (!error.message.includes(SECRET) && !record.url.includes(SECRET)) {
          removed.push(`${label} (${side})`);
        }
      }
    }

    expect(leaked).toEqual([]);
    // The population is not degenerate: every row is a pair, and the parsing
    // half proves the module already calls this text userinfo.
    expect(removed).toHaveLength(SEAM_PAIRS.length * 2);
  });

  // The same defect stated as the property that finds its whole class, so a fix
  // that repairs the five rows above and leaves a sixth spelling is caught here.
  // Every url below spells ONE credential in the one slot the URL grammar marks
  // as a value, at the seam, and differs only in the host that follows it.
  test("R13-H2-01: no host spelling lets the seam's userinfo through", () => {
    const HOSTS = [
      "internal.test",
      "internal.test:8443",
      "[::1]",
      "",
      "internal.test:99999",
      "internal.test:8443x",
      "[bad",
      "host name",
      "%00",
      "internal%zz.test",
    ];
    const SEAMS = ["file://", "//https:", "\\\\https:", "file:", "//https:/"];

    const leaked: string[] = [];
    let urls = 0;
    for (const host of HOSTS) {
      for (const seam of SEAMS) {
        for (const suffix of ["/v1", "", "?x=1", "#f"]) {
          const url = `${seam}/alice:hunter2@${host}${suffix}`;
          urls += 1;
          if (redactUrl(url).includes(SECRET)) leaked.push(`${url} -> ${redactUrl(url)}`);
        }
      }
    }

    expect(leaked.slice(0, 8)).toEqual([]);
    expect(urls).toBe(200);
  });
});

// ── 2. The resolution loop: total, terminating, and bounded ─────────────────
//
// The relative branch resolves its answer until re-reading it changes nothing:
//
//     while (isSolidus(path[0]) && isSolidus(path[1])) path = resolvedPath(path);
//
// Round 12's ledger entry states the reason — a path beginning with two solidi
// is protocol-relative to the next reader, so the emitted value would name a
// host the url never named. It does not state that the loop ends. A loop that
// resolves until stable is one that can fail to stabilise, and this one runs
// inside the `BaseHttpError` constructor, inside the response phase's `try`,
// where the input is an injected implementation's `response.url`.
//
// The bound is structural: each pass hands the text to `new URL`, which
// consumes the leading solidi AND a non-empty host before it emits a path, so
// the text is at least three characters shorter every time. Nothing in the pass
// can grow it — the emitted text is a subsequence of a `pathname` the same
// parser already percent-encoded, so re-encoding it is a no-op. The three
// properties below are that argument made executable: the loop answers for
// every input, it drains every authority a caller can nest, and what it emits
// no longer opens one.

/** A deterministic PRNG, so a failure names an input a rerun reproduces. */
function mulberry(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The pieces a hostile `response.url` is spelled from, weighted at the loop:
 * every solidus pair, every seam, and the marks that decide where a region
 * opens and where the parser stops reading one.
 */
const PIECES = [
  "//",
  "///",
  "/\\",
  "\\\\",
  "/",
  "\\",
  ":",
  "://",
  "@",
  "a",
  "svc:hunter2@",
  "internal.test",
  ":99999",
  ":8443",
  "https:",
  "https://",
  "file:",
  "ftp:",
  "c:",
  "..",
  ".",
  "%2f",
  "%41",
  "%",
  '"',
  " ",
  "[",
  "]",
  "[::1]",
  "\t",
  "\n",
  "?x=1",
  "#f",
];

function* hostileUrls(count: number, seed: number): Generator<string> {
  const next = mulberry(seed);
  for (let index = 0; index < count; index += 1) {
    const pieces = 1 + Math.floor(next() * 9);
    let url = "";
    for (let at = 0; at < pieces; at += 1) {
      url += PIECES[Math.floor(next() * PIECES.length)] as string;
    }
    yield url;
  }
}

/** A base whose own path is empty, so a relative answer's host is visible. */
const PROBE_BASE = "http://probe.invalid";

/** The six schemes whose PATH the redactor keeps. Every other one is reduced. */
const HIERARCHICAL = new Set(["http:", "https:", "ws:", "wss:", "ftp:", "file:"]);

describe("round 13 / H2 — the relative branch's resolution loop", () => {
  // TOTALITY. The loop sits inside the response phase's `try`, so a throw from
  // it does not escape — it converts a mapped 404 into a `NetworkError`, which
  // is the wrong answer rather than a crash. The property is that it answers.
  test("120,000 hostile urls: the loop answers with a string and never throws", () => {
    const threw: string[] = [];
    let urls = 0;
    for (const url of hostileUrls(120_000, 20_261_313)) {
      urls += 1;
      try {
        if (typeof redactUrl(url) !== "string") threw.push(`${url}: not a string`);
      } catch (cause) {
        threw.push(`${url}: ${String(cause)}`);
      }
    }
    expect(threw.slice(0, 5)).toEqual([]);
    expect(urls).toBe(120_000);
  });

  // TERMINATION, and the bound stated as a measurement a caller can see. Each
  // `//a` is one authority the loop must resolve, so an answer of `/x` at depth
  // k is a loop that ran k times and stopped. Depth 2,000 is a 6 KB url, which
  // is a length any origin can put in `response.url`.
  test("the loop drains every nested authority, to depth 2,000", () => {
    const wrong: string[] = [];
    // EVERY SPELLING to depth 256, and ONE of them to 2,000. `redactUrl` is
    // quadratic in the nesting — each pass re-scans what the previous pass
    // left — so the top of this range costs more than everything below it put
    // together, and running four spellings there buys a fourth copy of one
    // answer. The depth claim needs one spelling; the spelling claim needs no
    // depth.
    const SPELLINGS = [
      ["solidi", "//a"],
      ["backslashes", "\\\\a"],
      ["mixed", "/\\a"],
      ["a credential at every level", "//svc:hunter2@a"],
    ] as const;

    const drains = (depth: number, label: string, authority: string): void => {
      const answer = redactUrl(authority.repeat(depth) + "/x");
      // Every authority is consumed, so what is left is the last path.
      if (answer !== "/x") wrong.push(`depth ${depth} ${label}: ${JSON.stringify(answer)}`);
    };

    for (const depth of [1, 2, 3, 4, 8, 16, 64, 256]) {
      for (const [label, authority] of SPELLINGS) drains(depth, label, authority);
    }
    for (const depth of [1_000, 2_000]) drains(depth, "solidi", "//a");

    expect(wrong).toEqual([]);
  });

  // THE POST-CONDITION the loop exists for, over the population rather than
  // over three examples: what the redactor emits, read back by the parser that
  // produced it, names the same host it named before. A relative answer names
  // NO host — which is the whole content of "resolved until it stops moving" —
  // and an absolute answer names the one the input named. A redaction that
  // moves the host lies about which server failed, and the module states that a
  // redaction that lies is worse than one that leaks.
  test("120,000 hostile urls: the emitted value opens no authority the input did not", () => {
    const moved: string[] = [];
    let relative = 0;
    let absolute = 0;

    for (const url of hostileUrls(120_000, 20_261_313)) {
      const answer = redactUrl(url);
      let emitted: URL | null = null;
      try {
        emitted = new URL(answer);
      } catch {
        emitted = null;
      }

      if (emitted === null) {
        relative += 1;
        // A relative answer resolved against any base keeps that base's host.
        let reread: URL;
        try {
          reread = new URL(answer, PROBE_BASE);
        } catch {
          continue;
        }
        if (reread.host !== "probe.invalid") {
          moved.push(`${JSON.stringify(url)} -> ${JSON.stringify(answer)} names ${reread.host}`);
        }
        if (reread.username !== "" || reread.password !== "") {
          moved.push(`${JSON.stringify(url)} -> ${JSON.stringify(answer)} carries userinfo`);
        }
        continue;
      }

      absolute += 1;
      // An opaque scheme is reduced to the scheme alone, by design.
      if (!HIERARCHICAL.has(emitted.protocol)) continue;
      const source = new URL(url);
      if (source.host !== emitted.host || source.protocol !== emitted.protocol) {
        moved.push(
          `${JSON.stringify(url)} -> ${JSON.stringify(answer)}: ` +
            `${source.protocol}//${source.host} became ${emitted.protocol}//${emitted.host}`,
        );
      }
    }

    expect(moved.slice(0, 5)).toEqual([]);
    // Both branches are exercised, so neither half of the property is vacuous.
    expect(relative).toBeGreaterThan(10_000);
    expect(absolute).toBeGreaterThan(10_000);
  });
});

// ── 3. The class is a pure function of the recorded status ──────────────────
//
// `statusCodeErrorMap.get(status)` is the whole of the selection, and `status`
// is the value `statusOf` recorded on the first successful read. Earlier rounds
// swept all 200 statuses against an honest response, and swept hostile members
// at one status. The product of the two is what a caller actually relies on:
// whatever else the response says, and however hostile it says it, an ACCEPTED
// response is answered with the class its status alone selects.
//
// The baseline is measured, never read from the map: the expectation for a
// status is the class the library itself returns for that status with a benign
// response, so this compares the library against itself rather than against a
// table it also uses.

/** Presentations that change every identity field EXCEPT `status`. */
const HOSTILE_PRESENTATIONS: readonly { label: string; apply: (response: Response) => void }[] = [
  { label: "benign", apply: () => undefined },
  {
    label: "a statusText of 10,000 characters",
    apply: (response) =>
      Object.defineProperty(response, "statusText", { value: "x".repeat(10_000) }),
  },
  {
    label: "a non-string statusText",
    apply: (response) =>
      Object.defineProperty(response, "statusText", { value: { toString: null } }),
  },
  {
    label: "a statusText that spells another status line",
    apply: (response) =>
      Object.defineProperty(response, "statusText", { value: 'HTTP 500 "Internal Server Error"' }),
  },
  {
    label: "a url carrying a credential at the seam",
    apply: (response) =>
      Object.defineProperty(response, "url", { value: "file:///alice:hunter2@/v1" }),
  },
  {
    // DEPTH 200, not the 2,000 the loop block drains. What this row has to
    // carry is that a url the resolution loop must iterate over does not move
    // the class, and one authority is as good as two thousand for that. The
    // DEPTH claim belongs to the loop block, which pays for it 40 times rather
    // than 200: `redactUrl` is quadratic in the nesting (measured: 0.96 ms at
    // depth 200, 63.70 ms at depth 2,000, and the constructor calls it once per
    // error), so 2,000 here cost 12.7 s of the 18 s this sweep took and pushed
    // it past the timeout under `--coverage` while proving nothing twice.
    label: "a url of 200 nested authorities",
    apply: (response) =>
      Object.defineProperty(response, "url", { value: "//a".repeat(200) + "/x" }),
  },
  {
    label: "a non-string url",
    apply: (response) => Object.defineProperty(response, "url", { value: 42 }),
  },
  {
    label: "an ok, redirected and type that all throw",
    apply: (response) => {
      for (const member of ["ok", "redirected", "type"] as const) {
        Object.defineProperty(response, member, {
          get() {
            throw new TypeError(`${member} refuses to answer`);
          },
        });
      }
    },
  },
];

async function classFor(status: number, apply: (response: Response) => void): Promise<string> {
  const response = new Response("{}", { status, statusText: "Wire Phrase" });
  apply(response);
  const { error } = await typedFetch("https://api.test/v1", { fetch: async () => response });
  if (error === null) return "success";
  if (!isHttpError(error)) return error.constructor.name;
  await error.cancel();
  return `${error.constructor.name}/${error.status}`;
}

describe("round 13 / H2 — status alone selects the class, over hostile presentations", () => {
  test("200 statuses crossed with eight presentations of every other field", async () => {
    const wrong: string[] = [];
    let pairs = 0;
    const classes = new Set<string>();

    for (let status = 400; status <= 599; status += 1) {
      const baseline = await classFor(status, () => undefined);
      classes.add(baseline.split("/")[0] as string);
      if (baseline !== `${baseline.split("/")[0] ?? ""}/${status}`) {
        wrong.push(`status ${status}: baseline is ${baseline}`);
      }
      for (const { label, apply } of HOSTILE_PRESENTATIONS) {
        pairs += 1;
        const seen = await classFor(status, apply);
        if (seen !== baseline) wrong.push(`status ${status}, ${label}: ${seen} != ${baseline}`);
      }
    }

    expect(wrong.slice(0, 5)).toEqual([]);
    expect(pairs).toBe(200 * HOSTILE_PRESENTATIONS.length);
    // The 40 dedicated classes and `UnknownHttpError` are all reached, so the
    // sweep is over the roster rather than over one arm of it.
    expect(classes.size).toBe(41);
  }, 120_000);

  // The half the sweep above cannot state, because it holds the response
  // constant: the class a status selects does not depend on the ORDER the
  // statuses arrive in, or on any response that came before. One error is built
  // per status through one shared transport, and every answer is its own.
  test("the class a status selects carries nothing from the response before it", async () => {
    const wrong: string[] = [];
    const forward: string[] = [];
    const backward: string[] = [];

    for (let status = 400; status <= 599; status += 1) {
      forward.push(await classFor(status, () => undefined));
    }
    for (let status = 599; status >= 400; status -= 1) {
      backward.unshift(await classFor(status, () => undefined));
    }
    for (let at = 0; at < forward.length; at += 1) {
      if (forward[at] !== backward[at]) {
        wrong.push(`status ${400 + at}: ${String(forward[at])} != ${String(backward[at])}`);
      }
    }

    expect(wrong).toEqual([]);
    expect(forward).toHaveLength(200);
  }, 120_000);
});

// ── 4. One response, two errors, a macrotask apart ──────────────────────────
//
// The identity tables are keyed by the RESPONSE, and a `clone()` copy inherits
// the error's identity through a loan that is revoked in a `finally`. Both are
// synchronous mechanisms, and every sweep that pins them runs inside one tick.
// The claim they carry — one response has one identity — is a claim about the
// object's lifetime, not about a turn of the event loop.

describe("round 13 / H2 — one response has one identity across a macrotask boundary", () => {
  test("two errors built a macrotask apart from one response report one identity", async () => {
    let reads = 0;
    const response = new Response("{}", { status: 404, statusText: "Not Found" });
    // A url that answers differently on every read, so a second read is visible.
    Object.defineProperty(response, "url", {
      configurable: true,
      get: () => {
        reads += 1;
        return `https://api.test/read/${reads}`;
      },
    });

    const first = new NotFoundError(response);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    const second = new NotFoundError(response);
    await Promise.all([first.cancel(), second.cancel()]);

    expect(second.url).toBe(first.url);
    expect(second.message).toBe(first.message);
    expect(second.toJSON()).toEqual(first.toJSON());
    // The record is the FIRST read's, and the getter ran once for it.
    expect(first.url).toBe("https://api.test/read/1");
  });
});
