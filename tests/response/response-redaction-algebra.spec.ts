import http from "node:http";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { isHttpError, isNetworkError, typedFetch } from "../../src/index";
import { errorBodyOf } from "../../src/errors/error-body";
import { redactUrl, redactUrlInMessage } from "../../src/errors/redact-url";
import { NotFoundError } from "../../src/errors/not-found-error";
import { UnknownHttpError } from "../../src/errors/unknown-http-error";
import { mulberry, responseWith } from "../../fixtures/responses";

// ═══════════════════════════════════════════════════════════════════════════
// ROUND 11 — H2. Rounds 8, 9 and 10 closed the body lifecycle as a state
// machine and the identity tables as a matrix. This round attacks what H2's
// OWN previous rounds assumed rather than proved.
//
// Round 10 rewrote `redactUrl` (commit `fc108bb`): emission is now clipped to
// the origin plus the parser-produced `pathname`. That function runs inside
// the `BaseHttpError` constructor, inside the response phase's `try`, so a
// single throw from it converts a mapped 404 into a `NetworkError`. Round 10's
// own totality sweep measured the OLD redactor. Blocks 1 to 3 measure the new
// one, and block 2 states a property no round has stated: an absolute
// redaction is a FIXED POINT, so the redactor's own output carries nothing it
// would remove on a second pass.
//
// Blocks 4 and 5 attack the other half of the lane through a REAL transport
// and real broken bodies — a truncated response, an abort mid-read, a timeout
// that fires after the response resolved — because "the body stream FAILED"
// is a promise `cancel()` makes in prose and no test made undici keep.
//
// Nothing here is a finding. Each block is a property no existing spec states.
// ═══════════════════════════════════════════════════════════════════════════

// ── The corpora ─────────────────────────────────────────────────────────────

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
  "/../..",
  "/.//a",
  "/c:/Users/alice@corp/x",
  "/dG9rZW4vcGFzc3dvcmQ/@host",
  "/go/https://svc:hun",
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

/**
 * The characters and tokens the redactor's own scan reasons about, so a random
 * string is a plausible url rather than noise: every delimiter the URL parser
 * writes or rewrites, both solidi, the three characters it strips, the percent
 * escapes of the delimiters, and the six special scheme names.
 */
const PARTS = [
  "",
  "/",
  "//",
  "///",
  ":",
  "://",
  ":/",
  "@",
  "?",
  "#",
  "%",
  "%2F",
  "%40",
  "%3A",
  "\\",
  "\t",
  "\n",
  "\r",
  ".",
  "..",
  "-",
  "+",
  "[",
  "]",
  "|",
  "'",
  "(",
  ")",
  "a",
  "b",
  "1",
  "http",
  "https",
  "ws",
  "wss",
  "file",
  "ftp",
  "data",
  "svc",
  "alice",
  "hunter2",
  "token",
  "host",
  "api.test",
  "é",
  "😀",
];

const PREFIXES = [
  "https://api.test",
  "http://h",
  "file://",
  "ftp://x",
  "ws://w",
  "https://api.test/go/https://svc:hunter2@internal.test",
  "https://api.test/go/https:svc:hunter2@internal.test",
  "",
  "/",
  "//",
  "./",
  "../",
];

function randomUrls(count: number, seed: number): string[] {
  const next = mulberry(seed);
  const urls: string[] = [];
  for (let index = 0; index < count; index += 1) {
    let url = PREFIXES[Math.floor(next() * PREFIXES.length)] as string;
    const parts = 1 + Math.floor(next() * 12);
    for (let at = 0; at < parts; at += 1) url += PARTS[Math.floor(next() * PARTS.length)];
    urls.push(url);
  }
  return urls;
}

/** The six schemes whose redaction is an href rather than a bare path. */
const HIERARCHICAL = new Set(["http:", "https:", "ws:", "wss:", "ftp:", "file:"]);

// ── 1. The clipped redactor is total ────────────────────────────────────────
//
// `redactUrl` runs inside the `BaseHttpError` constructor, which runs inside
// the response phase's `try`. A throw there does not escape the envelope — it
// is caught, the body is released, and the caller gets a `NetworkError` for a
// response that reported 404. So totality is what keeps a MAPPED status
// reaching its own class, and it is a property of this module alone.
//
// Round 10 replaced the emission rule wholesale: `cleaned` now scans
// `pathname + search + hash` when the pathname ends inside an authority, and
// clips every removal to `pathname.length`, then REBUILDS with
// `new URL(origin + clean)`. That rebuild is the new throw site, and it takes
// a string this module assembled rather than one a caller handed over.

describe("round 11 / H2 — the clipped redactor under the constructor", () => {
  test("redactUrl is total over 120,000 random hostile strings", () => {
    const threw: { url: string; cause: string }[] = [];
    const urls = randomUrls(120_000, 20_260_808);
    for (const url of urls) {
      try {
        redactUrl(url);
      } catch (cause) {
        threw.push({ url: JSON.stringify(url), cause: String(cause) });
      }
    }
    expect(threw).toEqual([]);
    expect(urls.length).toBe(120_000);
  });

  test("redactUrl is total over the structured scheme x host x path x query x fragment corpus", () => {
    const threw: { url: string; cause: string }[] = [];
    let count = 0;
    for (const url of structuredUrls()) {
      count += 1;
      try {
        redactUrl(url);
      } catch (cause) {
        threw.push({ url, cause: String(cause) });
      }
    }
    expect(threw).toEqual([]);
    expect(count).toBe(34_200);
  });

  test("redactUrlInMessage is total over the same inputs", () => {
    const threw: { url: string; cause: string }[] = [];
    for (const url of randomUrls(50_000, 777)) {
      try {
        redactUrlInMessage(`TypeError: failed to fetch ${url}`, url);
      } catch (cause) {
        threw.push({ url: JSON.stringify(url), cause: String(cause) });
      }
    }
    expect(threw).toEqual([]);
  });
});

// ── 2. An absolute redaction is a fixed point ───────────────────────────────
//
// The sharpest statement of "the emitted url carries nothing this module would
// remove", and one no round has made. It needs no reference implementation and
// no notion of what a credential looks like: the module is its own oracle.
//
// `redactUrl(redactUrl(u)) !== redactUrl(u)` means the first pass EMITTED a
// span the second pass then removed — under-redaction by the module's own
// rule, in the one string `message` and the `toJSON()` record both carry.
//
// Restricted to the hierarchical schemes, because only there does `redactUrl`
// answer with an href. The relative branch answers with a bare `pathname`,
// which is a different kind of value: `//b///:` resolves against the internal
// base and emits `///:`, and re-reading that as a url is not the same question.

describe("round 11 / H2 — the redaction of a hierarchical url is a fixed point", () => {
  test("redactUrl(redactUrl(u)) === redactUrl(u) over 150,000 generated urls", () => {
    const moved: { url: string; once: string; twice: string }[] = [];
    let checked = 0;
    for (const url of randomUrls(150_000, 11)) {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        continue;
      }
      if (!HIERARCHICAL.has(parsed.protocol)) continue;
      checked += 1;
      const once = redactUrl(url);
      const twice = redactUrl(once);
      if (once !== twice) moved.push({ url, once, twice });
    }
    expect(moved).toEqual([]);
    // The corpus is skewed toward parseable absolute urls on purpose; the
    // count is asserted so a generator change cannot quietly empty this test.
    expect(checked).toBeGreaterThan(50_000);
  });

  test("and over the structured corpus", () => {
    const moved: { url: string; once: string; twice: string }[] = [];
    for (const url of structuredUrls()) {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        continue;
      }
      if (!HIERARCHICAL.has(parsed.protocol)) continue;
      const once = redactUrl(url);
      const twice = redactUrl(once);
      if (once !== twice) moved.push({ url, once, twice });
    }
    expect(moved).toEqual([]);
  });
});

// ── 3. The constructor emits exactly what the redactor answered ─────────────
//
// Three readers take the url off one HTTP error, and each takes a DIFFERENT
// form of it: `error.url` is the full href, `error.message` carries the
// redaction with its parentheses percent-encoded, and `toJSON().url` carries
// the redaction verbatim. The three are pinned individually elsewhere. What no
// suite pins is that they agree for EVERY url — which is what round 10's
// change to the emission rule could have broken without breaking a single
// existing expectation, because every existing expectation names one url.

describe("round 11 / H2 — message, toJSON and the escape hatch agree on every url", () => {
  test("over the structured corpus", async () => {
    const disagreed: unknown[] = [];
    for (const url of structuredUrls()) {
      const error = new NotFoundError(responseWith(url));
      await error.cancel();
      const redacted = redactUrl(url);
      const escaped = redacted.replaceAll("(", "%28").replaceAll(")", "%29");
      const expected = escaped ? `HTTP 404 "Not Found" (${escaped})` : `HTTP 404 "Not Found"`;
      if (error.message !== expected) disagreed.push({ url, message: error.message, expected });
      if (error.url !== url) disagreed.push({ url, escapeHatch: error.url });
      const record = error.toJSON();
      if (record.url !== redacted) disagreed.push({ url, json: record.url, redacted });
      if (record.message !== error.message) disagreed.push({ url, recordMessage: record.message });
      // The message form owns its own delimiters: a path that spells a
      // parenthesis must not be able to close the pair this line opened.
      if (escaped.includes("(") || escaped.includes(")")) {
        disagreed.push({ url, unescaped: escaped });
      }
    }
    expect(disagreed).toEqual([]);
  });

  test("and through the whole response phase, for a mapped and an unmapped status", async () => {
    const url = "https://api.test/go/https://svc:pw@internal.test/v1?token=abc#u:p@h";
    for (const [status, name] of [
      [404, "NotFoundError"],
      [599, "UnknownHttpError"],
    ] as const) {
      const { error } = await typedFetch("https://api.test/x", {
        fetch: async () => responseWith(url, status),
      });
      expect(isHttpError(error)).toBe(true);
      if (!isHttpError(error)) return;
      expect(error.name).toBe(name);
      expect(error.status).toBe(status);
      expect(error.url).toBe(url);
      expect(error.toJSON().url).toBe(redactUrl(url));
      expect(error.message).toContain(redactUrl(url));
      // The password, the query token and the fragment are all gone from both
      // automatic forms; only the escape hatch still holds them.
      for (const emitted of [error.message, error.toJSON().url]) {
        expect(emitted).not.toContain("pw@");
        expect(emitted).not.toContain("token=abc");
        expect(emitted).not.toContain("#u:p@h");
      }
      await error.cancel();
    }
  });
});

// ── 4. A body that is itself an error, over a real transport ────────────────
//
// `cancel()` documents its own behaviour for a stream that FAILED: "A
// truncated response or a connection reset mid-body errors the stream, which
// dropped its source at that moment: nothing is left to release". Every test
// that reaches that arm today builds the failure from a constructed
// `ReadableStream`. These drive undici itself: the server writes a partial
// body under a declared `content-length` and destroys the socket.
//
// The property under test is the one the ADR names as a contract rather than a
// defense — "a body is never stranded". Each assertion is a race against a
// timeout, so a promise that never settles FAILS rather than hanging the file.

let base = "";
let server: http.Server;

beforeAll(async () => {
  server = http.createServer((request, response) => {
    const target = new URL(request.url ?? "/", `http://${request.headers.host}`);
    switch (target.searchParams.get("mode")) {
      case "truncate": {
        // A declared length the socket never delivers: undici errors the body
        // stream, which is the shape a connection reset produces in production.
        response.writeHead(404, { "content-type": "text/plain", "content-length": "500" });
        response.write("half");
        setTimeout(() => request.socket.destroy(), 10);
        return;
      }
      case "slow": {
        response.writeHead(404, { "content-type": "text/plain" });
        response.write("first");
        setTimeout(() => response.end("second"), 300);
        return;
      }
      default: {
        response.writeHead(404, { "content-type": "text/plain" });
        response.end("nope");
      }
    }
  });
  await new Promise<void>((resolve) => server.listen(0, () => resolve()));
  base = `http://localhost:${(server.address() as { port: number }).port}`;
});

afterAll(() => server.close());

/** `"resolved"`, `"rejected"`, or `"PENDING"` — a hang is an ANSWER, not a hang. */
async function settle(promise: Promise<unknown>): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.then(
        () => "resolved",
        () => "rejected",
      ),
      new Promise<string>((resolve) => {
        timer = setTimeout(() => resolve("PENDING"), 1000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

describe("round 11 / H2 — a real body that fails mid-stream", () => {
  test("a truncated body rejects its reader and still resolves cancel()", async () => {
    const { error } = await typedFetch(`${base}/?mode=truncate`);
    expect(isHttpError(error)).toBe(true);
    if (!isHttpError(error)) return;
    await expect(error.text()).rejects.toThrow();
    expect(await settle(error.cancel())).toBe("resolved");
  });

  test("a truncated body resolves cancel() with no read at all", async () => {
    const { error } = await typedFetch(`${base}/?mode=truncate`);
    if (!isHttpError(error)) return;
    expect(await settle(error.cancel())).toBe("resolved");
    // A repeated cancel settles WITH the first, not before it.
    expect(await settle(error.cancel())).toBe("resolved");
  });

  test("clone() over a failing stream leaves neither branch stranded", async () => {
    const { error } = await typedFetch(`${base}/?mode=truncate`);
    if (!isHttpError(error)) return;
    const copy = error.clone();
    expect(await settle(Promise.all([error.cancel(), copy.cancel()]))).toBe("resolved");
  });

  test("clone() over a failing stream: read one branch, cancel the other", async () => {
    const { error } = await typedFetch(`${base}/?mode=truncate`);
    if (!isHttpError(error)) return;
    const copy = error.clone();
    await expect(error.text()).rejects.toThrow();
    expect(await settle(copy.cancel())).toBe("resolved");
    expect(await settle(error.cancel())).toBe("resolved");
  });

  test("an abort raised WHILE the body is being read rejects the read, not cancel()", async () => {
    const controller = new AbortController();
    const { error } = await typedFetch(`${base}/?mode=slow`, { signal: controller.signal });
    // The response already resolved, so this is an HTTP error and never an
    // abort: only the transport phase can produce an `AbortedError`.
    expect(isHttpError(error)).toBe(true);
    if (!isHttpError(error)) return;
    const reading = error.text();
    controller.abort();
    await expect(reading).rejects.toThrow();
    expect(await settle(error.cancel())).toBe("resolved");
  });

  test("a timeout that fires after the response resolved leaves the error unchanged", async () => {
    // TWO RACES USED TO DECIDE THIS TEST, and both are gone.
    //
    // The deadline has to fall between the handoff and the read, and it used to
    // be 60 ms against a local server's headers — which the server loses under
    // load, so the envelope came back a `TimeoutError` and the first assertion
    // failed. One second is the same shape with a thousandfold margin over the
    // millisecond a loopback handoff costs.
    //
    // The wait afterwards used to be a fixed 120 ms racing that same deadline.
    // It waits on the deadline's own event now, so the ordering this test is
    // about is observed rather than assumed.
    const signal = AbortSignal.timeout(1_000);
    const { error } = await typedFetch(`${base}/?mode=slow`, { signal });
    expect(isHttpError(error)).toBe(true);
    if (!isHttpError(error)) return;
    expect(error.status).toBe(404);
    await new Promise((resolve) => {
      signal.addEventListener("abort", resolve, { once: true });
    });
    // The timeout fired between the handoff and the read. It errors the body,
    // and it changes nothing about the error's class or identity.
    await expect(error.text()).rejects.toThrow();
    expect(error.status).toBe(404);
    expect(await settle(error.cancel())).toBe("resolved");
  });

  test("clone() after an abort errored the stream still releases both branches", async () => {
    const controller = new AbortController();
    const { error } = await typedFetch(`${base}/?mode=slow`, { signal: controller.signal });
    if (!isHttpError(error)) return;
    controller.abort();
    const copy = error.clone();
    expect(await settle(Promise.all([error.cancel(), copy.cancel()]))).toBe("resolved");
  });
});

// ── 5. A body that is itself an error, built by hand ────────────────────────

function erroringBody(): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("half"));
        controller.error(new Error("mid-read failure"));
      },
    }),
    { status: 404 },
  );
}

describe("round 11 / H2 — errorBodyOf against a stream that refuses", () => {
  test("a reader rejects and cancel() then resolves", async () => {
    const body = errorBodyOf(erroringBody());
    await expect(body.text()).rejects.toThrow("mid-read failure");
    expect(await settle(body.cancel())).toBe("resolved");
  });

  test("cancel() first resolves, and the reader afterwards gets the LIBRARY's refusal", async () => {
    const body = errorBodyOf(erroringBody());
    expect(await settle(body.cancel())).toBe("resolved");
    await expect(body.text()).rejects.toThrow(/single-use/);
  });

  test("tee() over an errored stream releases both branches", async () => {
    const body = errorBodyOf(erroringBody());
    const teed = body.tee();
    const branch = errorBodyOf(teed.branch);
    expect(teed.adopt(branch)).toBe(true);
    expect(await settle(Promise.all([body.cancel(), branch.cancel()]))).toBe("resolved");
  });

  test("a reader that yields a chunk the platform refuses rejects, and cancel() resolves", async () => {
    const stream = new ReadableStream<unknown>({
      start(controller) {
        controller.enqueue("not a Uint8Array");
        controller.close();
      },
    }) as ReadableStream<Uint8Array>;
    const body = errorBodyOf(new Response(stream, { status: 404 }));
    await expect(body.text()).rejects.toThrow();
    expect(await settle(body.cancel())).toBe("resolved");
  });
});

// ── 6. A refusal INSIDE the constructor files nothing ───────────────────────
//
// ADR 0003 row H-14 is pinned for the refusal points that RETURN false. The
// constructor is a refusal point that THROWS, and round 9 pinned it for one
// field — a `headers` value the `Headers` constructor rejects. These pin the
// other two identity getters, which fail one and two reads EARLIER, so a
// rollback that dropped only the last-written table would keep a record here.

describe("round 11 / H2 — an identity getter that throws mid-construction", () => {
  test("a url getter that throws leaves no record behind", async () => {
    let hostile = true;
    const response = new Response("{}", { status: 404 });
    Object.defineProperty(response, "url", {
      configurable: true,
      get() {
        if (hostile) throw new TypeError("url refused");
        return "https://api.test/honest";
      },
    });

    const refused = await typedFetch("https://api.test/x", { fetch: async () => response });
    expect(isNetworkError(refused.error)).toBe(true);

    hostile = false;
    const { error } = await typedFetch("https://api.test/x", { fetch: async () => response });
    expect(isHttpError(error)).toBe(true);
    if (!isHttpError(error)) return;
    // The whole identity is re-read: nothing survived the refused call, so the
    // status is not answered from the record the refusal would have left.
    expect(error.status).toBe(404);
    expect(error.url).toBe("https://api.test/honest");
    expect(error.message).toContain("https://api.test/honest");
    await error.cancel();
  });

  test("a statusText getter that throws leaves no record behind", async () => {
    let hostile = true;
    const response = new Response("{}", { status: 599 });
    Object.defineProperty(response, "statusText", {
      configurable: true,
      get() {
        if (hostile) throw new TypeError("statusText refused");
        return "Later Phrase";
      },
    });

    const refused = await typedFetch("https://api.test/x", { fetch: async () => response });
    expect(isNetworkError(refused.error)).toBe(true);

    hostile = false;
    const { error } = await typedFetch("https://api.test/x", { fetch: async () => response });
    expect(error).toBeInstanceOf(UnknownHttpError);
    if (!(error instanceof UnknownHttpError)) return;
    expect(error.statusText).toBe("Later Phrase");
    expect(error.toJSON().statusText).toBe("Later Phrase");
    expect(error.message).toContain('"Later Phrase"');
    await error.cancel();
  });

  test("a recreate callback that throws revokes the loan, so the branch keeps its own identity", async () => {
    const response = responseWith("https://api.test/original");
    const error = new NotFoundError(response);
    let branch: Response | undefined;

    expect(() =>
      error.clone((given) => {
        branch = given;
        throw new Error("callback failed");
      }),
    ).toThrow(/recreate callback failed/);

    expect(await settle(error.cancel())).toBe("resolved");
    expect(branch).toBeInstanceOf(Response);
    if (!branch) return;
    // The loan lasted exactly as long as the construction it existed for. An
    // error built from the branch AFTERWARDS reads the branch, and a real
    // `Response.clone()` carries no url of its own.
    const later = new NotFoundError(branch);
    expect(later.url).toBe("");
    expect(later.message).toBe('HTTP 404 "Not Found"');
    expect(await settle(later.cancel())).toBe("resolved");
  });
});
