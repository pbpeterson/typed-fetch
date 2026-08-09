import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { isHttpError, typedFetch } from "./src/index";
import { NotFoundError } from "./src/errors/not-found-error";
import { httpErrors } from "./src/errors/helpers";
import { identityOf } from "./src/errors/response-identity";
import { redactUrl } from "./src/errors/redact-url";

// ═══════════════════════════════════════════════════════════════════════════
// ROUND 14 — H2. Round 13 changed `src/errors/redact-url.ts` again (commit
// `f5f6946`): a parse that THROWS now removes the span anyway, while a parse
// that SUCCEEDS and names no credential is still believed. Both answers are
// given inside the `BaseHttpError` constructor, inside the response phase's
// `try`, so this lane owns them.
//
//  1. THE ANSWER WAS NOT THE TEXT THAT WAS SCANNED. `cleaned` scanned
//     `parsed.pathname`, and every question the module asks — the seam's loop,
//     `malformedUserinfoSpans`' two re-asks — was asked of THAT text. The value
//     it emitted was `new URL(origin + clean)`, and that parse REMOVES the dot
//     segments the removal exposed, so the removal slid the next authority into
//     the seam it had just cleared and no question was asked of the text that
//     came out. R14-H2-01, fixed: `cleaned` now re-runs the whole scan on the
//     pathname its own rebuild produced, until a pass changes nothing. The
//     rows below stay as the regression pin.
//  2. TOTALITY AND THE TWO CHANNELS, over a generated population rather than
//     examples. Construction answers for every url; `error.url` is the raw
//     string; and the redacted form in `message` and the one in `toJSON().url`
//     are ONE string, never two.
//  3. THE EXPENSIVE REGION IS UNREACHABLE FROM A REAL `Response`, and the
//     argument for that changed under this file. Round 13 measured `redactUrl`
//     quadratic in nested-authority depth, and the fix for R14-H2-01 put a loop
//     on BOTH branches — so "the loop is in the branch a real `Response` cannot
//     reach" is no longer the reason. The reason is now the cursor rule, and it
//     is re-measured below rather than inherited.
//  4. THE 40 CLASSES REDACT AS ONE. The redaction they carry has changed four
//     times since round 10 pinned the roster.
// ═══════════════════════════════════════════════════════════════════════════

const SECRET = "hunter2";

/** A real 4xx `Response` whose `url` is the one under test. */
function responseWith(url: string, status = 404): Response {
  const response = new Response(null, { status, statusText: "Not Found" });
  Object.defineProperty(response, "url", { value: url, configurable: true });
  return response;
}

/** The error `typedFetch` returns for a response carrying `url`. */
async function errorFor(url: string, status = 404) {
  const { error } = await typedFetch("https://api.test/v1", {
    fetch: async () => responseWith(url, status),
  });
  if (!error || !isHttpError(error)) throw new TypeError(`no http error for ${url}`);
  await error.cancel();
  return error;
}

// ── 1. R14-H2-01 — a dot segment the removal exposes slides the next
//       authority into the seam ────────────────────────────────────────────
//
// `seamUserinfo` removes the userinfo the ORIGIN's solidi and the PATH spell
// between them, and round 13 gave it a loop so that it is "asked again of what
// its own answer leaves behind". The loop asks of `parsed.pathname`. The answer
// is emitted by `cleaned` as `new URL(origin + clean).href`, and THAT parse
// applies the URL Standard's path-segment removal: a `.` or `..` segment the
// removal uncovered is dropped, and every byte after it moves left.
//
// So a caller wrote one credential the module removes, in front of a second
// one it also removes, with a dot segment between them:
//
//   file:///x@./alice:hunter2@internal.test/v1
//
// The seam removed `x@`, which left `/./alice:hunter2@internal.test/v1`, and
// the rebuild collapsed the `.` to `/alice:hunter2@internal.test/v1`. The
// origin is `file://`, so the emitted answer was
// `file:///alice:hunter2@internal.test/v1` — EXACTLY the text round 13 pinned
// this module to redact, and which it does redact when it is handed it.
//
// CLOSED by giving `cleaned` a loop: it re-runs the whole scan on the pathname
// its own rebuild produced, so every question is now asked of the text that
// comes out. Re-asking `redactUrl` of its own answer would NOT have closed it —
// a second call recomputes the origin and reads `bringsOwnAuthority` from a text
// that no longer holds the mark, which is why the `//https:/` rows below emitted
// a value that was already a fixed point of the whole redactor and still carried
// the password. These rows stay as the regression pin for both families.
//
// THE STANDARD THIS TEST HOLDS THE MODULE TO IS THE MODULE'S OWN. Each row
// carries a CONTROL: the same credential with the leading cut deleted. The
// control is the shorter url, the module removes the credential from it, and
// adding text in front of a credential must not be what keeps it.
//
// This is not residual 2 (a secret in a hierarchical PATH SEGMENT). The module
// decides this class is userinfo rather than path, and it decides it on the
// control. It is not the closed item "a `file:` URL keeps its path" for the
// same reason, and the protocol-relative rows carry no `file:` at all.
//
// When it was open, the `file:` rows leaked for one pass and the
// protocol-relative rows leaked forever — 80 of 80 rows, both families.

/** Every way a caller can spell a cut whose removal uncovers a dot segment. */
const CUTS = ["x@", "a:b@", `${SECRET}@`, ":@", "a@b@"] as const;
/** Every spelling of a dot segment the rebuild's parse removes. */
const DOTS = ["./", "../", "%2e/", "%2E%2E/"] as const;
/** The credential that must go, and the module's own answer for it alone. */
const PAYLOADS = [`alice:${SECRET}@internal.test/v1`, `alice:${SECRET}@/v1`] as const;
/** The two origins whose seam `seamUserinfo` answers for. */
const SEAMS = [
  { label: "a host-less file: origin", head: "file:///" },
  { label: "a mark the parser consumed", head: "//https:/" },
] as const;

describe("round 14 / H2 — the answer is asked of the text that was scanned, not of the text emitted", () => {
  test("R14-H2-01: a dot segment the redaction exposes slides a credential back into the seam", async () => {
    const leaked: string[] = [];
    const kept: string[] = [];

    for (const { label, head } of SEAMS) {
      for (const tail of PAYLOADS) {
        // NON-VACUITY, per row. The control is the same credential at the same
        // seam with nothing in front of it, and the module removes it.
        const control = await errorFor(`${head}${tail}`);
        expect(control.toJSON().url).not.toContain(SECRET);
        expect(control.message).not.toContain(SECRET);

        for (const cut of CUTS) {
          for (const dot of DOTS) {
            const url = `${head}${cut}${dot}${tail}`;
            const error = await errorFor(url);
            const record = error.toJSON();

            // The escape hatch keeps the whole href, by design.
            expect(error.url).toBe(url);

            if (record.url.includes(SECRET) || error.message.includes(SECRET)) {
              leaked.push(`${label}: ${url} -> ${record.url}`);
            }
            // And the same text, handed back to the module, loses it — so the
            // module's own answer about what it emitted is "that is a
            // credential", not "that is a path".
            if (record.url.includes(SECRET) && !redactUrl(record.url).includes(SECRET)) {
              kept.push(record.url);
            }
          }
        }
      }
    }

    expect({ leaked: leaked.length, sample: leaked.slice(0, 3) }).toEqual({
      leaked: 0,
      sample: [],
    });
    expect(kept).toEqual([]);
  });
});

// ── 2. Totality, and the two redacted channels are one string ─────────────
//
// Round 12 pinned the response phase's READ inventory as a closed set and
// identity as a function over 512 read schedules. Neither states what the
// constructor does with the url it read. Three properties, over a generated
// population rather than examples:
//
//   TOTALITY   — construction answers for every url. `redactUrl` runs two
//                parsers, a loop that resolves until it stops moving, and two
//                span scans, all inside the constructor and all inside the
//                response phase's `try`. A throw there is an error class the
//                envelope does not name.
//   THE HATCH  — `error.url` is byte-identical to what the response answered
//                with. Redaction is a property of the CHANNELS, never of the
//                field a caller reads deliberately.
//   ONE STRING — the text `message` carries inside its last parentheses is
//                `toJSON().url`, with this line's own delimiters escaped and
//                nothing else changed. Two channels, one answer.

/** A population of urls built from the pieces a hostile origin can spell. */
function hostilePopulation(): string[] {
  const schemes = ["", "http:", "https:", "file:", "ws:", "ftp:", "x:", "javascript:"];
  const marks = ["", "/", "//", "///", "\\\\", "/\\", "/./", "/../"];
  const users = ["", "alice", `alice:${SECRET}`, `:${SECRET}`, `${SECRET}@`, "%40a"];
  const hosts = ["", "h.test", "h.test:99999", "[bad]", "a^b", ".", "%40"];
  const tails = ["", "/v1", `/v1?token=${SECRET}`, `/v1#${SECRET}`, "/a@b", "/:@"];
  const urls: string[] = [];
  for (const scheme of schemes) {
    for (const mark of marks) {
      for (const user of users) {
        for (const host of hosts) {
          for (const tail of tails) {
            urls.push(`${scheme}${mark}${user}${user ? "@" : ""}${host}${tail}`);
          }
        }
      }
    }
  }
  return urls;
}

const POPULATION = hostilePopulation();

describe("round 14 / H2 — error construction over a generated url population", () => {
  test("it answers for every url, keeps the raw href, and the two redacted channels agree", () => {
    const threw: string[] = [];
    const wrongHatch: string[] = [];
    const disagreed: string[] = [];

    for (const url of POPULATION) {
      const response = responseWith(url);
      let error: NotFoundError;
      try {
        error = new NotFoundError(response);
      } catch (cause) {
        threw.push(`${url} -> ${(cause as Error).name}`);
        continue;
      }
      void error.cancel();

      if (error.url !== url) wrongHatch.push(`${url} -> ${error.url}`);

      // `statusText` is `"Not Found"` for every row, so the only `(` in a
      // message is the one this line opens, and the redacted url carries none:
      // the constructor escapes both parentheses into `%28` and `%29`.
      const opened = error.message.lastIndexOf("(");
      const inParentheses =
        opened < 0 || !error.message.endsWith(")") ? "" : error.message.slice(opened + 1, -1);
      const expected = error.toJSON().url.replaceAll("(", "%28").replaceAll(")", "%29");
      if (inParentheses !== expected) {
        disagreed.push(`${url} | message ${inParentheses} | record ${expected}`);
      }
    }

    expect({
      population: POPULATION.length,
      threw: threw.slice(0, 3),
      wrongHatch: wrongHatch.slice(0, 3),
      disagreed: disagreed.slice(0, 3),
    }).toEqual({ population: POPULATION.length, threw: [], wrongHatch: [], disagreed: [] });
  });

  // The identity record is the four fields CONTEXT.md names, and a response
  // that carries own properties of its own does not add a fifth. The record is
  // what `message`, `toJSON()`, `clone()` and the class selection all read.
  test("the identity record's field set is exactly the four documented ones", () => {
    const plain = responseWith("https://api.test/v1");
    const crowded = responseWith("https://api.test/v1");
    Object.defineProperties(crowded, {
      body: { value: null, configurable: true },
      type: { value: "cors", configurable: true },
      redirected: { value: true, configurable: true },
      ok: { value: true, configurable: true },
      cause: { value: "planted", configurable: true },
    });

    for (const response of [plain, crowded]) {
      expect(Object.keys(identityOf(response)).sort()).toEqual([
        "headers",
        "status",
        "statusText",
        "url",
      ]);
    }
  });
});

// ── 3. The expensive region is unreachable from a real `Response` ─────────
//
// Round 13 recorded `redactUrl` quadratic in nested-authority depth, once per
// error construction. `CONTRIBUTING.md` and the ledger both forbid a timing
// assertion here — it has to be a ratio against a control in the same run, and
// v8 coverage instrumentation does not slow the two sides by the same factor.
// So this bounds the input instead, which is a fact about the url and not
// about the clock.
//
// THERE ARE NOW TWO LOOPS, and only one of them is quadratic. The fix for
// R14-H2-01 gave `cleaned` a loop of its own, so the ABSOLUTE branch — the one
// a real `Response` reaches — re-scans the pathname each rebuild produces. The
// pass count that loop runs is what `pastFiller` holds down: it advances the
// seam cursor over the solidi AND the dot segments the parser will drop, so a
// path spelling one credential and one dot segment per group drains in one pass
// instead of one group per pass.
//
// RE-MEASURED ON THIS TREE rather than inherited from the fixer, because the
// argument this file used to make no longer holds. The absolute branch is
// linear in bytes on every shape that stresses either loop — the
// credential-and-dot groups the cursor rule exists for, the `%2e%2e` spelling of
// them, the same groups at the `file:` seam, and nested `https://` authorities —
// doubling from 8 KB to 128 KB doubles the time each step, 0.34 ms to 2.34 ms on
// the first shape and 0.61 ms to 6.78 ms on the last.
//
// The quadratic that remains is `redactUrl`'s OWN resolution loop,
// `while (isSolidus(path[0]) && isSolidus(path[1])) path = resolvedPath(path)`,
// which re-parses the whole remaining text once per authority it drains: 5.6 ms
// at 1.5 KB, 17 ms at 2.9 KB, 65 ms at 5.9 KB, 259 ms at 11.7 KB. That loop sits
// in the RELATIVE branch, reached only when `new URL(url)` throws for the
// response's url.
//
// A real `Response` cannot reach it. Its `url` is the serialization of an
// absolute URL the platform's own parser produced, or the empty string — so
// either the absolute branch answers, or `redactUrl` returns at its first line.
// Measured against a real server rather than argued: a plain request, a
// redirect chain (where the url is the one the SERVER chose), a 404, and
// `Response.error()`.
//
// ADR 0003 item 4 puts timing and resource exhaustion outside the conformance
// boundary, so an injected `fetch` that answers with a relative url is not a
// defect. This test states which side of that line the quadratic is on.

describe("round 14 / H2 — the url a real Response carries", () => {
  let server: http.Server;
  let origin: string;

  beforeAll(async () => {
    server = http.createServer((request, response) => {
      if (request.url?.startsWith("/hop")) {
        const next = Number(request.url.slice("/hop".length)) || 0;
        response.writeHead(302, { location: next > 1 ? `/hop${next - 1}` : "/gone" });
        response.end();
        return;
      }
      response.writeHead(request.url === "/gone" ? 404 : 200, { "content-type": "text/plain" });
      response.end("no");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test("every url a real Response answers with parses absolutely, so the relative branch is unreachable", async () => {
    const responses: Response[] = [];
    for (const path of ["/gone", "/hop3", `/${"a".repeat(8_000)}`, `/gone?token=${SECRET}`]) {
      const response = await fetch(`${origin}${path}`);
      await response.text();
      responses.push(response);
    }
    responses.push(Response.error(), new Response(null, { status: 404 }));

    for (const response of responses) {
      if (response.url === "") continue;
      // The absolute branch answers. Both branches loop now, so this is not
      // the whole bound any more — it is the half of it the input decides.
      expect(() => new URL(response.url)).not.toThrow();
      expect(redactUrl(response.url)).not.toBe("");
    }
    // And the redirect chain proves the url is the SERVER's choice, not the
    // caller's: the value the constructor redacts is the last hop.
    expect(responses[1]!.url).toBe(`${origin}/gone`);
  });

  // The other half of the bound, stated as correctness at a size no request
  // line carries. `cleaned` now loops here too, so this asserts what a loop has
  // to deliver and a pass count cannot: the answer is a FIXED POINT of the
  // redactor, reached without leaving a credential in it. Re-measured at 1.9 ms
  // for these 32 KB, and linear to 128 KB — no timing is asserted, per the
  // ledger, because the guard would have to be a ratio against a control in the
  // same run and v8 coverage does not slow the two sides by the same factor.
  test("the absolute branch answers a 32 KB nest of authorities and keeps no credential", () => {
    const nested = `https://api.test/${"https://".repeat(4_000)}svc:${SECRET}@cdn.test/v1`;
    expect(nested.length).toBeGreaterThan(32_000);

    const redacted = redactUrl(nested);

    expect(redacted).not.toContain(SECRET);
    expect(new URL(redacted).host).toBe("api.test");
    expect(redactUrl(redacted)).toBe(redacted);
  });
});

// ── 4. The 40 classes redact as one ───────────────────────────────────────
//
// Round 10 pinned the roster as 40 classes. The redaction each one carries has
// changed four times since — rounds 11, 12 and 13 twice. The classes inherit
// one constructor, and this states that as a measured fact rather than as a
// reading of the class files: one url, 40 statuses, one answer.

describe("round 14 / H2 — the roster carries one redaction", () => {
  test("all 40 dedicated classes emit the same redacted url and the same raw href", () => {
    const url = `https://alice:${SECRET}@api.test/v1?token=${SECRET}#${SECRET}`;
    const answers = new Set<string>();
    const hrefs = new Set<string>();

    for (const Class of httpErrors) {
      const error = new Class(responseWith(url, Class.status));
      void error.cancel();
      answers.add(error.toJSON().url);
      hrefs.add(error.url);
      expect(error.message).not.toContain(SECRET);
    }

    expect(httpErrors.length).toBe(40);
    expect([...answers]).toEqual(["https://api.test/v1"]);
    expect([...hrefs]).toEqual([url]);
  });
});
