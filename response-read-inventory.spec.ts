import { describe, expect, test } from "vitest";
import { isHttpError, isNetworkError, typedFetch } from "./src/index";
import { errorBodyOf, type ErrorBody } from "./src/errors/error-body";
import { redactUrl, redactUrlInMessage } from "./src/errors/redact-url";

// ═══════════════════════════════════════════════════════════════════════════
// ROUND 12 — H2. The lane has returned clean four times, and the one thing it
// produced that later caught another lane's regression was a PROPERTY stated
// over a population: `redactUrl(redactUrl(u)) === redactUrl(u)`. So this round
// states properties only. Nothing here is a finding; each block is a rule the
// code satisfies that no suite had written down.
//
//  1. Redaction. Round 11 rewrote the userinfo scan again (commit `26f57f5`):
//     every `@` in a region is asked and the question repeats over what each
//     answer leaves. The fixed point is re-verified on THAT code, and two
//     siblings are stated: redaction is MONOTONE under an appended query or
//     fragment, and the two redaction entry points AGREE on every url that
//     parses.
//  2. The response phase's read INVENTORY. Round 11's H1 finding came from an
//     inventory that was incomplete when it was written. This states the
//     response phase's inventory as a closed set — which members can refuse a
//     mapped status, and which cannot — so a read added later has to move a
//     name across the line and cannot arrive unnoticed.
//  3. Identity as a FUNCTION. "The first successful read fixes a response's
//     identity" is enforced per field. This states it end to end over 512
//     generated read schedules: the values a caller sees come from the first
//     presentation the library ACCEPTED, and never from a refused one.
//  4. The error body releases EXACTLY ONCE. Rounds 9 and 10 enumerated the
//     three- and four-operation sequences and asserted the refusal each one
//     produces. This adds the oracle those sweeps did not have — the count of
//     invocations of the underlying source's own cancel algorithm — and runs
//     it over operation streams of arbitrary length instead of a fixed one.
// ═══════════════════════════════════════════════════════════════════════════

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

// ── 1. Redaction: the fixed point, and two siblings ─────────────────────────

const SCHEMES = ["http://", "https://", "file://", "ws://", "ftp://", "data:", "blob:", "", "://"];
const HOSTS = ["api.test", "api.test:8443", "", "url.invalid", "[::1]"];
const PATHS = [
  "",
  "/",
  "/v1",
  "/go/https://svc:pw@internal.test/v1",
  "/go/https:/svc:pw@internal.test/v1",
  "/go/https:svc:pw@internal.test/v1",
  "/proxy/https://cdn.test/img",
  "/users/@alice",
  "/@scope/pkg",
  "/a:/b",
  "/://svc:hunter2@internal.test/v1",
  "/%3A%2F%2Fsvc%3Apw%40host",
  "/a/https://u:p@../secret",
  "/..",
  "/c:/Users/alice@corp/x",
  "/dG9rZW4vcGFzc3dvcmQ/@host",
  "/go/https://svc:hun",
  "/go/https://BEARER_SECRET@cdn.test/img/@alice",
];
const QUERIES = ["", "?a=1", "?owner=alice@example.com&sig=deadbeef", "?next=https://u:p@h/v", "?"];
const FRAGMENTS = ["", "#top", "#u:p@h", "#"];

/** Every scheme x host x path x query x fragment, with and without userinfo. */
function* structuredUrls(): Generator<string> {
  for (const scheme of SCHEMES) {
    for (const host of HOSTS) {
      for (const path of PATHS) {
        for (const query of QUERIES) {
          for (const fragment of FRAGMENTS) {
            yield `${scheme}${host}${path}${query}${fragment}`;
            yield `${scheme}alice:hunter2@${host}${path}${query}${fragment}`;
          }
        }
      }
    }
  }
}

function isSubsequence(inner: string, outer: string): boolean {
  let at = 0;
  for (const character of outer) {
    if (at < inner.length && inner[at] === character) at += 1;
  }
  return at === inner.length;
}

describe("round 12 / H2 — the redactor's algebra after the round 11 rewrite", () => {
  // Round 11 stated this property and the redaction fixer's own regression
  // failed it. The rule it pins now sits on DIFFERENT code, because the fix
  // that followed rewrote the scan. Re-verified rather than assumed.
  test("redaction is still a fixed point over the structured corpus", () => {
    const moved: string[] = [];
    let count = 0;
    for (const url of structuredUrls()) {
      count += 1;
      const once = redactUrl(url);
      const twice = redactUrl(once);
      if (twice !== once) moved.push(`${JSON.stringify(url)}: ${once} -> ${twice}`);
    }
    expect(moved.slice(0, 5)).toEqual([]);
    expect(count).toBe(32_400);
  });

  // MONOTONE, the sibling of the fixed point: a LONGER url never reveals more
  // of the shorter one's path. Round 10 clipped emission to the origin plus the
  // parsed pathname, and round 11 made the userinfo scan read `search` and
  // `hash` as well — so a query can legitimately make the redactor remove MORE
  // from the path. Nothing may make it remove less. Stated as a subsequence,
  // which is the same shape round 10's fuzz used against `parsed.pathname`.
  test("appending a query or a fragment can only shrink what redaction emits", () => {
    const grew: string[] = [];
    let pairs = 0;
    for (const base of structuredUrls()) {
      if (base === "" || base.includes("?") || base.includes("#")) continue;
      const plain = redactUrl(base);
      for (const suffix of ["?x=1", "#f", "?next=https://u:p@h/v", "#u:p@h"]) {
        pairs += 1;
        const grown = redactUrl(base + suffix);
        if (!isSubsequence(grown, plain)) {
          grew.push(`${JSON.stringify(base + suffix)}: ${plain} -> ${grown}`);
        }
      }
    }
    expect(grew.slice(0, 6)).toEqual([]);
    expect(pairs).toBe(6476);
  });

  // AGREEMENT, the other sibling. Two entry points redact a url: `redactUrl`
  // builds the HTTP error's message and its `toJSON()` record, and
  // `redactUrlInMessage` builds the message of the three pre-response classes.
  // They must not name two different resources for one url.
  //
  // The scope is exact and it is the interesting half of the property: the two
  // agree for every url the URL parser accepts. They differ only where the
  // parser refuses the url — `redactUrl("http://")` emits nothing, while
  // `redactUrlInMessage` leaves an unparseable string alone because replacing
  // it can only corrupt a diagnostic that holds no slot for a secret.
  test("both redaction entry points agree on every url that parses", () => {
    const disagreed: string[] = [];
    let parseable = 0;
    for (const url of structuredUrls()) {
      if (!URL.canParse(url)) continue;
      parseable += 1;
      const direct = redactUrl(url);
      const inMessage = redactUrlInMessage(url, url);
      if (inMessage !== direct) {
        disagreed.push(`${JSON.stringify(url)}: ${direct} != ${inMessage}`);
      }
    }
    expect(disagreed.slice(0, 10)).toEqual([]);
    expect(parseable).toBe(23_440);
  });
});

// ── 2. The response phase's read inventory ──────────────────────────────────
//
// Round 11's H1 finding is recorded with this lesson: "round 9's three-read
// inventory was incomplete when written". The setup phase now carries the
// invariant that a read which only DESCRIBES a request cannot stop the
// transport. The response phase's counterpart is not that rule — a read that
// throws is how an injected implementation refuses a value, and ADR 0003 rows
// H-07 and H-13 say so — it is the INVENTORY itself: exactly which members a
// resolved value is asked for, and what each one can decide.
//
// Stated as a closed set, on a real `Response` with one own getter that throws.
// A read added to the phase later has to move a name across this line.

const POISON = "this member refuses to answer";

/** A real `Response` with ONE member answered by a getter that throws on demand. */
function poison(response: Response, member: string, armed: () => boolean): void {
  const inherited = Object.getOwnPropertyDescriptor(Response.prototype, member);
  Object.defineProperty(response, member, {
    configurable: true,
    get() {
      if (armed()) throw new TypeError(POISON);
      if (inherited?.get) return Reflect.apply(inherited.get, response, []);
      return inherited?.value as unknown;
    },
  });
}

/** Every member of the public `Response` surface this library could ask for. */
const RESPONSE_MEMBERS = [
  "arrayBuffer",
  "blob",
  "body",
  "bodyUsed",
  "clone",
  "formData",
  "headers",
  "json",
  "ok",
  "redirected",
  "status",
  "statusText",
  "text",
  "type",
  "url",
];

async function outcomeOfPoisoned(member: string, status: number): Promise<string> {
  const response = new Response("{}", { status, statusText: "Not Found" });
  poison(response, member, () => true);
  const { error } = await typedFetch("https://api.test/v1", { fetch: async () => response });
  if (error && isHttpError(error)) await error.cancel();
  return error === null ? "success" : error.constructor.name;
}

async function inventoryFor(status: number): Promise<{ refuses: string[]; cannot: string[] }> {
  const refuses: string[] = [];
  const cannot: string[] = [];
  for (const member of RESPONSE_MEMBERS) {
    const outcome = await outcomeOfPoisoned(member, status);
    if (outcome === "NetworkError") refuses.push(member);
    else cannot.push(`${member} -> ${outcome}`);
  }
  return { refuses, cannot };
}

describe("round 12 / H2 — which reads the response phase performs, as a closed set", () => {
  // The three success-only members are the point of this test. `ok`,
  // `redirected` and `type` are read by `hasCompatibleSuccessSurface`, which a
  // mapped status never reaches — so a 404 survives a getter on any of the
  // three that throws. Everything else on the surface is either structural
  // (`isResponse`) or identity, and each one can refuse the value.
  test("a mapped 404 is refused by twelve members and by exactly three not at all", async () => {
    expect(await inventoryFor(404)).toEqual({
      refuses: [
        "arrayBuffer",
        "blob",
        "body",
        "bodyUsed",
        "clone",
        "formData",
        "headers",
        "json",
        "status",
        "statusText",
        "text",
        "url",
      ],
      cannot: ["ok -> NotFoundError", "redirected -> NotFoundError", "type -> NotFoundError"],
    });
  });

  // The dual. A success is the value that ESCAPES this library unmodified, so
  // its whole visible surface has to answer, and the inventory closes over all
  // fifteen. The asymmetry between this list and the one above is the whole
  // reason an HTTP error keeps identity normalization and a success does not.
  test("a 200 is refused by every member of the surface", async () => {
    expect(await inventoryFor(200)).toEqual({ refuses: RESPONSE_MEMBERS, cannot: [] });
  });

  // ADR 0003 row H-14, over the whole inventory instead of over one member.
  // Round 11 pinned two of these by hand. A refusal anywhere in the phase must
  // leave the value with no identity filed against it, so the SAME object
  // presented again — now answering honestly — is answered on its own terms.
  test("no member's refusal files an identity against the value", async () => {
    const stale: string[] = [];
    let refusals = 0;
    for (const member of RESPONSE_MEMBERS) {
      let armed = true;
      const response = new Response("{}", { status: 404, statusText: "Gone Fishing" });
      poison(response, member, () => armed);

      const first = await typedFetch("https://api.test/v1", { fetch: async () => response });
      if (first.error && isHttpError(first.error)) await first.error.cancel();
      if (!first.error || !isNetworkError(first.error)) continue;
      refusals += 1;

      armed = false;
      const second = await typedFetch("https://api.test/v1", { fetch: async () => response });
      if (second.error && isHttpError(second.error)) await second.error.cancel();
      const seen =
        second.error === null || !isHttpError(second.error)
          ? `not an http error: ${String(second.error?.constructor.name)}`
          : `${second.error.constructor.name}/${second.error.status}/${second.error.statusText}`;
      if (seen !== "NotFoundError/404/Not Found") stale.push(`${member} -> ${seen}`);
    }
    expect(stale).toEqual([]);
    expect(refusals).toBe(12);
  });
});

// ── 3. Identity is a function of the first ACCEPTED presentation ────────────
//
// `response-identity` records each field's first successful read, and the
// response phase STAGES those records so a refused presentation leaves none.
// Together those two make one claim a caller can rely on: every error the
// library builds from one `Response` object reports values that were read
// during the first presentation the library accepted — never during one it
// refused, and never from a later getter answer.
//
// Stated over 512 generated read schedules rather than over examples. Each
// field answers with a DISTINCT value per read, so the value a caller sees
// names the exact read that produced it, and a record that leaked out of a
// refused presentation is visible by its number.

const SCHEDULE_STATUSES = [400, 401, 403, 404, 409, 410, 413, 415, 429];

type ScalarField = "status" | "statusText" | "url";

interface ReadLog {
  field: ScalarField;
  presentation: number;
  value: string | number;
}

/** A real 4xx `Response` whose three scalar identity fields answer from a script. */
function scriptedResponse(
  throwsOn: Record<ScalarField, readonly boolean[]>,
  presentation: () => number,
  log: ReadLog[],
): Response {
  const response = new Response("{}", { status: 404, statusText: "Not Found" });
  const reads: Record<ScalarField, number> = { status: 0, statusText: 0, url: 0 };
  const answer = (field: ScalarField): string | number => {
    const at = reads[field];
    reads[field] += 1;
    if (throwsOn[field][at] === true) throw new TypeError(`${field} refuses read ${at}`);
    const value =
      field === "status"
        ? (SCHEDULE_STATUSES[at % SCHEDULE_STATUSES.length] as number)
        : field === "statusText"
          ? `phrase ${at}`
          : `https://api.test/read/${at}`;
    log.push({ field, presentation: presentation(), value });
    return value;
  };
  for (const field of ["status", "statusText", "url"] as const) {
    Object.defineProperty(response, field, { configurable: true, get: () => answer(field) });
  }
  return response;
}

/** The eight throw patterns over three presentations. */
const PATTERNS: readonly (readonly boolean[])[] = [0, 1, 2, 3, 4, 5, 6, 7].map((mask) => [
  (mask & 1) !== 0,
  (mask & 2) !== 0,
  (mask & 4) !== 0,
  false,
  false,
  false,
]);

describe("round 12 / H2 — one response has one identity, over generated schedules", () => {
  test("512 read schedules: the identity comes from the first accepted presentation", async () => {
    const wrong: string[] = [];
    let schedules = 0;
    let withAnAcceptance = 0;

    for (const status of PATTERNS) {
      for (const statusText of PATTERNS) {
        for (const url of PATTERNS) {
          schedules += 1;
          const log: ReadLog[] = [];
          let presentation = 0;
          const response = scriptedResponse({ status, statusText, url }, () => presentation, log);

          const accepted: {
            at: number;
            status: number;
            statusText: string;
            url: string;
            phrase: string;
          }[] = [];
          for (presentation = 0; presentation < 3; presentation += 1) {
            const { error } = await typedFetch("https://api.test/v1", {
              fetch: async () => response,
            });
            if (error && isHttpError(error)) {
              await error.cancel();
              accepted.push({
                at: presentation,
                status: error.status,
                // The roster's canonical label, which a dedicated class owns.
                statusText: error.statusText,
                url: error.url,
                // The WIRE phrase, which reaches the caller only here: the
                // message quotes it, and the record `toJSON()` emits is the
                // canonical label instead.
                phrase: /"([^"]*)"/.exec(error.message)?.[1] ?? "",
              });
            }
          }
          if (accepted.length === 0) continue;
          withAnAcceptance += 1;

          const first = accepted[0] as (typeof accepted)[number];
          // Every accepted presentation reports ONE identity.
          for (const later of accepted.slice(1)) {
            if (
              later.status !== first.status ||
              later.statusText !== first.statusText ||
              later.url !== first.url ||
              later.phrase !== first.phrase
            ) {
              wrong.push(`presentations disagree: ${JSON.stringify({ first, later })}`);
            }
          }
          // And that identity was read DURING the first accepted presentation,
          // never during a refused one that ran before it. Every answer is
          // distinct, so the value names the read that produced it.
          const source = (field: ScalarField, value: string | number): number | undefined =>
            log.find((entry) => entry.field === field && entry.value === value)?.presentation;
          const fromStatus = source("status", first.status);
          const fromUrl = source("url", first.url);
          const fromPhrase = source("statusText", first.phrase);
          if (fromStatus !== first.at || fromUrl !== first.at || fromPhrase !== first.at) {
            wrong.push(
              `identity leaked across a refusal: accepted at ${first.at}, read at ` +
                `${String(fromStatus)}/${String(fromPhrase)}/${String(fromUrl)}`,
            );
          }
        }
      }
    }

    expect(wrong.slice(0, 5)).toEqual([]);
    expect(schedules).toBe(512);
    expect(withAnAcceptance).toBe(169);
  }, 60_000);
});

// ── 4. The error body releases the source EXACTLY once ──────────────────────
//
// Rounds 9 and 10 enumerated the three- and four-operation `errorBodyOf`
// sequences and pinned the refusal each one produces. Neither could see the
// thing the module exists for: whether the underlying source was released, and
// how many times. A `ReadableStream` built here answers that directly — its
// own cancel algorithm counts its invocations — so the contract becomes a
// measurement instead of an inference.
//
// Arbitrary length, not a fixed one. A five-letter stream over this alphabet
// reaches compositions no four-letter enumeration contains.

const OPS = [
  "json",
  "text",
  "arrayBuffer",
  "cancel",
  "teeRelease",
  "teeOwn",
  "externalRead",
  "externalLock",
] as const;
type Op = (typeof OPS)[number];

/**
 * A `Response` whose source counts the invocations of its own cancel algorithm.
 *
 * `arriving: false` closes the stream in `start`, so the four readers can
 * complete. A CLOSED stream needs no release, and the platform says so:
 * `ReadableStreamCancel` on a closed stream resolves without ever running the
 * underlying source's cancel algorithm. Verified with no library code in the
 * picture — one `response.clone()`, then the two branches cancelled a macrotask
 * apart — so a count of zero there is the platform's answer about a body that
 * already ended, not a release this library missed.
 *
 * `arriving: true` never closes, which is the state the module exists for: a
 * body still on the wire, whose stream pins the connection until something
 * releases it. There a release either happens or does not, and the count says
 * which.
 */
function countingBody(arriving: boolean): { response: Response; released: () => number } {
  let released = 0;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"a":1}'));
      if (!arriving) controller.close();
    },
    cancel() {
      released += 1;
    },
  });
  return {
    response: new Response(stream, { status: 404, statusText: "Not Found" }),
    released: () => released,
  };
}

const PENDING = Symbol("still pending");

/**
 * Let the platform finish. A chain of `tee()`s releases its source through
 * nested cancel algorithms, and the outermost promise settles a few macrotask
 * turns before the innermost source is told. The count is read after this.
 */
async function flush(): Promise<void> {
  for (let turn = 0; turn < 3; turn += 1) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  }
}

function settledWithin<T>(promise: Promise<T>): Promise<T | typeof PENDING | Error> {
  return Promise.race([
    promise.catch((cause: unknown) => cause as Error),
    new Promise<typeof PENDING>((resolve) => {
      setTimeout(() => resolve(PENDING), 25);
    }),
  ]);
}

interface StreamResult {
  released: number;
  claims: number;
  escaped: string[];
  finalPending: boolean;
}

async function runOperationStream(ops: readonly Op[], arriving = false): Promise<StreamResult> {
  const { response, released } = countingBody(arriving);
  const body = errorBodyOf(response);
  const branches: ErrorBody[] = [];
  const readers: ReadableStreamDefaultReader<Uint8Array>[] = [];
  const escaped: string[] = [];
  let claims = 0;

  for (const op of ops) {
    try {
      if (op === "cancel") {
        const settled = await settledWithin(body.cancel());
        // A teed branch nobody released keeps the source pinned, and `cancel()`
        // is documented to stay pending for exactly that reason. Every other
        // state must settle.
        if (settled === PENDING && branches.length === 0) escaped.push(`${op} stayed pending`);
      } else if (op === "teeRelease") {
        body.tee().release();
      } else if (op === "teeOwn") {
        const teed = body.tee();
        const sibling = errorBodyOf(teed.branch);
        teed.adopt(sibling);
        branches.push(sibling);
      } else if (op === "externalRead") {
        await response.text();
      } else if (op === "externalLock") {
        const stream = response.body;
        if (stream) readers.push(stream.getReader());
      } else {
        await body[op]();
        claims += 1;
      }
    } catch (cause) {
      // The interface says a reader REJECTS and `tee()` THROWS, both with a
      // TypeError. `json()` over a body another operation already drained can
      // also reach the platform's SyntaxError. Anything else escaped.
      if (!(cause instanceof TypeError) && !(cause instanceof SyntaxError)) {
        escaped.push(`${op}: ${String(cause)}`);
      }
    }
  }

  // Release everything that exists, together, which is what the tee contract
  // asks of a caller. It must settle.
  const final = await settledWithin(
    Promise.all([body.cancel(), ...branches.map((branch) => branch.cancel())]).then(
      () => undefined,
    ),
  );
  for (const reader of readers) reader.releaseLock();
  await flush();

  return { released: released(), claims, escaped, finalPending: final === PENDING };
}

describe("round 12 / H2 — the error body releases its source exactly once", () => {
  test("800 operation streams of length 5 to 10", async () => {
    const next = mulberry(20_261_212);
    const bad: string[] = [];
    const totals = { streams: 0, released: 0, claims: 0 };

    for (let index = 0; index < 800; index += 1) {
      const length = 5 + Math.floor(next() * 6);
      const ops: Op[] = [];
      for (let at = 0; at < length; at += 1) ops.push(OPS[Math.floor(next() * OPS.length)] as Op);

      const seen = await runOperationStream(ops);
      const name = ops.join(",");
      // The source is released AT MOST once, whatever the stream did. A second
      // release cancels a stream this library no longer owns.
      if (seen.released > 1) bad.push(`${name}: released ${seen.released} times`);
      // The body is claimed at most once. That is `claimable()`'s whole job.
      if (seen.claims > 1) bad.push(`${name}: claimed ${seen.claims} times`);
      if (seen.escaped.length > 0) bad.push(`${name}: ${seen.escaped.join(" | ")}`);
      if (seen.finalPending) bad.push(`${name}: the final release never settled`);

      totals.streams += 1;
      totals.released += seen.released;
      totals.claims += seen.claims;
    }

    expect(bad.slice(0, 8)).toEqual([]);
    expect(totals.streams).toBe(800);
    // The population is not degenerate: it releases sources, it claims bodies,
    // and it contains streams that never read at all.
    expect(totals.released).toBeGreaterThan(80);
    expect(totals.claims).toBeGreaterThan(250);
  }, 180_000);

  // The exactly-once half of the property, over the population that can carry
  // it: every five-operation stream built from the three operations that read
  // no byte, over a body that is still ARRIVING. Whatever order the branches
  // are released in, and however many times `clone()` teed the stream, the
  // source's own cancel algorithm runs exactly once — never twice, and never
  // not at all while a promise reports a release.
  test("243 five-operation streams over a body still arriving: released exactly once", async () => {
    const bad: string[] = [];
    const alphabet: readonly Op[] = ["cancel", "teeRelease", "teeOwn"];
    let streams = 0;
    for (const a of alphabet) {
      for (const b of alphabet) {
        for (const c of alphabet) {
          for (const d of alphabet) {
            for (const e of alphabet) {
              streams += 1;
              const ops = [a, b, c, d, e];
              const seen = await runOperationStream(ops, true);
              const name = ops.join(",");
              if (seen.released !== 1) bad.push(`${name}: released ${seen.released} times`);
              if (seen.claims !== 0) bad.push(`${name}: claimed ${seen.claims} times`);
              if (seen.escaped.length > 0) bad.push(`${name}: ${seen.escaped.join(" | ")}`);
              if (seen.finalPending) bad.push(`${name}: the final release never settled`);
            }
          }
        }
      }
    }
    expect(bad.slice(0, 8)).toEqual([]);
    expect(streams).toBe(243);
  }, 180_000);
});
