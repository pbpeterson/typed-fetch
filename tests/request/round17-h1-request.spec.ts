import { describe, expect, test } from "vitest";
import { distExists, loadRootEsm, warnWhenDistMissing } from "../../fixtures/built-package";
import { useTestServer } from "../../fixtures/http-server";

// Round 17, lane H1 — the request path, measured through the BUILT package
// against a real server, and compared to `fetch` itself.
//
// ── THE INSTRUMENT, and what it can see that rounds 15 and 16 could not ─────
//
// Both earlier rounds returned clean, and both measured the same way: `src/`,
// through a transport double that resolves a value the test wrote. That
// instrument can only report what the library does with an answer the test
// already chose. It cannot see the platform.
//
// This file changes two things at once.
//
//  1. IT READS `dist/`. No spec under `tests/request/**` has ever loaded the
//     built package — the twelve suites that do are all in `tests/surface/**`,
//     `tests/response/**`, and `tests/fixtures/**`. So every sentence this lane
//     has ever pinned was pinned against a module graph no consumer installs.
//     Round 16 wrote two new sentences — the ADR 0003 amendment of 2026-08-09
//     about the phase 3 cross-call release, and the transport-re-entry claim in
//     CONTEXT.md and in the module JSDoc of `src/request-plan.ts` — and neither
//     was pinned against the artifact at all.
//
//  2. IT USES A DIFFERENTIAL ORACLE. The suite asserts what `typedFetch`
//     answers. It never asserts that the answer is the PLATFORM's. Here every
//     outcome class is driven twice over the same real socket — once through a
//     bare `fetch` and once through the built `typedFetch` — and the two
//     reports are compared member by member. A divergence is either a sentence
//     in a document or a defect, and there is no third option.
//
// ── WHAT IS MEASURED ───────────────────────────────────────────────────────
//
//  A. The two sentences round 16 wrote, against `dist/`.
//  B. The differential, over the whole outcome set: success, all 40 mapped
//     status classes — 39 over a socket and the documented 407 exception on its
//     own — an unmapped status on both sides of 400, a bodiless response, a
//     HEAD, a 204, a 304, a redirect chain, a manual redirect, a network
//     failure, an unparseable URL, an unsupported scheme, a refused redirect,
//     an abort, and a timeout.
//  C. The concurrent interleaving at scale, through REAL redirects, where the
//     platform and not a double decides the timing.
//
// Everything here that is not section A's third test passes on HEAD. That test
// is the finding, and its comment says exactly which sentence it reads.

warnWhenDistMissing("round17-h1-request", distExists);

/** The built root entry's public shape. A type-only reference to `src/`. */
type PublicApi = typeof import("../../src/index");

/**
 * The dedicated HTTP error classes, as the built package exports them. Read
 * off the barrel rather than listed here, so the roster differential in
 * section B covers every mapped status this version ships and cannot fall
 * behind one.
 */
type ErrorRoster = Record<
  string,
  (new (response: Response) => Error) & { readonly status: number; readonly statusText: string }
>;

let builtPackage: Promise<PublicApi & ErrorRoster> | undefined;

/** The built package, loaded once for the file. */
function api(): Promise<PublicApi & ErrorRoster> {
  builtPackage ??= loadRootEsm<PublicApi & ErrorRoster>();
  return builtPackage;
}

/**
 * The platform's own `fetch`, captured at module scope.
 *
 * Section A's third test replaces the global for the length of one call, and
 * the differential needs a binding that replacement cannot reach. `dist/` makes
 * the same capture when it loads, which is why every test that replaces the
 * global loads the package FIRST: a package loaded during the window would
 * capture the replacement as its native transport and take a different branch.
 */
const NATIVE_FETCH = globalThis.fetch;

const server = useTestServer();

// ── Reading the `fetch` extension off an init a transport received ─────────

/**
 * The five channels a transport can use to look for the `fetch` option on the
 * init it was handed.
 *
 * The contract in `src/request-plan.ts` enumerates the first three by name; the
 * last two are the ones a FORWARDING transport actually writes, and they are
 * measured beside them so a sentence that holds for the named three and fails
 * for a spread would not pass unnoticed.
 */
interface ExtensionReads {
  readonly propertyGet: string;
  readonly inCheck: boolean;
  readonly ownKeyList: boolean;
  readonly ownDescriptor: boolean;
  readonly spreadCopy: boolean;
}

function readExtension(init: RequestInit, option: unknown): ExtensionReads {
  const read = (init as { readonly fetch?: unknown }).fetch;
  return {
    propertyGet: read === undefined ? "undefined" : read === option ? "the fetch option" : "other",
    inCheck: "fetch" in init,
    ownKeyList: Reflect.ownKeys(init).includes("fetch"),
    ownDescriptor: Object.getOwnPropertyDescriptor(init, "fetch") !== undefined,
    spreadCopy: Object.hasOwn({ ...init }, "fetch"),
  };
}

/**
 * What the documented contract says a transport sees.
 *
 * `src/request-plan.ts`, module JSDoc: "The init a transport receives carries
 * no `fetch` extension under any of the three reads: a property get answers
 * `undefined`, an `in` check answers `false`, and the own-key list omits the
 * name." CONTEXT.md carries the same sentence under "Transport re-entry".
 */
const NO_EXTENSION: ExtensionReads = {
  propertyGet: "undefined",
  inCheck: false,
  ownKeyList: false,
  ownDescriptor: false,
  spreadCopy: false,
};

// ── A structurally complete foreign response, for section A's release pin ──

interface ForeignResponse {
  [key: string]: unknown;
}

/**
 * A foreign `Response` whose members are own data properties, so a test can
 * break one between two calls — and whose BODY is a real socket-backed stream
 * the test server produced.
 *
 * Round 16 pinned the same behavior with `new Response("payload")`, an
 * in-memory body. The body here came off the wire, so the release under test is
 * cancelling a live HTTP stream rather than a constructed one.
 */
function foreignResponse(overrides: Record<string, unknown>, wire: Response): ForeignResponse {
  const value: ForeignResponse = {
    [Symbol.toStringTag]: "Response",
    body: wire.body,
    bodyUsed: false,
    headers: new Headers({ "content-type": "text/plain" }),
    ok: true,
    redirected: false,
    status: 200,
    statusText: "OK",
    type: "basic",
    url: "https://round17.test/resource",
    arrayBuffer: async (): Promise<ArrayBuffer> => new ArrayBuffer(0),
    blob: async (): Promise<Blob> => new Blob(),
    clone: (): ForeignResponse => value,
    formData: async (): Promise<FormData> => new FormData(),
    json: async (): Promise<unknown> => ({}),
    text: async (): Promise<string> => await wire.text(),
    ...overrides,
  };
  return value;
}

/** A transport that answers every call with one value. */
function resolving(value: unknown): typeof fetch {
  return (async () => value) as unknown as typeof fetch;
}

/**
 * A target as the PLATFORM spells it back.
 *
 * `fixtures/http-server.ts` builds `http://localhost:PORT?…`, with no path
 * segment, and both `response.url` and `BaseHttpError.url` report the URL the
 * agent parsed, which carries the empty path. The two sides of the differential
 * are always compared to each other rather than to a literal; this exists for
 * the two tests that must name a target the differential itself produced.
 */
function href(target: string): string {
  return new URL(target).href;
}

/**
 * The one mapped status the ambient transport cannot deliver as a response.
 *
 * Per the Fetch Standard a 407 from an origin the agent did not configure as a
 * proxy is a network error, so a bare `fetch` REJECTS rather than resolving.
 * `tests/envelope/typed-fetch.spec.ts` already records this as "the documented
 * 407 exception" and drives the row through an injected transport; the roster
 * differential below therefore skips it and the dedicated test states what the
 * two sides actually do over a socket, which is the half the existing pin does
 * not measure.
 */
const UNREACHABLE_OVER_HTTP = 407;

// ── A. The two sentences round 16 wrote, pinned against dist ───────────────

describe.skipIf(!distExists)(
  "round 17 / H1 — the transport re-entry sentence, against dist",
  () => {
    test("an own fetch option is hidden from every read, and the re-entry reaches the server", async () => {
      // The half the sentence was written for, measured through the built package
      // and over a real socket rather than a `data:` URL. The positive claim is
      // that the inner call runs on the PLATFORM's transport: the test server
      // answers it, and only a real request can make that happen.
      const { typedFetch } = await api();
      const outerTarget = server.url({ body: "outer" });
      const innerTarget = server.url({ body: "inner" });

      let calls = 0;
      let reads: ExtensionReads | undefined;
      let innerBody = "";
      let innerMethod: string | null = null;
      const option = (async (input: unknown, init: RequestInit) => {
        calls += 1;
        reads = readExtension(init, option);
        const inner = await typedFetch(innerTarget, init as never);
        expect(inner.error).toBe(null);
        innerBody = (await inner.response?.text()) ?? "";
        innerMethod = inner.response?.headers.get("x-echo-method") ?? null;
        return await NATIVE_FETCH(input as string, init);
      }) as unknown as typeof fetch;

      const result = await typedFetch(outerTarget, { fetch: option, method: "GET" });

      expect(reads).toEqual(NO_EXTENSION);
      // The option reached the OUTER call exactly once. The inner call could not
      // reach it at all, so it did not recurse and it did not fail either: a real
      // server answered it.
      expect(calls).toBe(1);
      expect(innerBody).toBe("inner");
      expect(innerMethod).toBe("GET");
      expect(result.error).toBe(null);
      expect(await result.response?.text()).toBe("outer");
    });

    test("an inherited fetch is never used, and the re-entry still cannot reach it", async () => {
      // The CONSEQUENCE half of the same sentence, under a polluted prototype:
      // "a transport that calls `typedFetch` again with that init re-enters on
      // the AMBIENT transport. It never re-enters on itself, and a forwarding
      // transport that spreads its init cannot build an infinite loop out of one
      // option."
      //
      // That half holds, and it holds for the reason ADR 0003 row H-22 states:
      // the override is an OWN-property read, so the inherited value is never the
      // transport, at either depth. This test exists so the failing test below is
      // scoped to the MECHANISM sentence and not read as a claim about which
      // transport runs.
      const { typedFetch } = await api();
      const target = server.url({ body: "served" });
      const objectPrototype = Object.prototype as { fetch?: unknown };

      let pollutedCalls = 0;
      const polluted = (async () => {
        pollutedCalls += 1;
        return new Response("polluted");
      }) as unknown as typeof fetch;

      let depth = 0;
      let innerBody = "";
      const polyfill = (async (input: unknown, init: RequestInit) => {
        depth += 1;
        if (depth === 1) {
          const inner = await typedFetch(target, init as never);
          innerBody = (await inner.response?.text()) ?? "";
        }
        return await NATIVE_FETCH(input as string, init);
      }) as unknown as typeof fetch;

      const globals = globalThis as { fetch: typeof fetch };
      Object.defineProperty(objectPrototype, "fetch", {
        value: polluted,
        writable: true,
        enumerable: false,
        configurable: true,
      });
      globals.fetch = polyfill;
      let outer: Awaited<ReturnType<typeof typedFetch>>;
      try {
        outer = await typedFetch(target);
      } finally {
        globals.fetch = NATIVE_FETCH;
        Reflect.deleteProperty(objectPrototype, "fetch");
      }

      // Two levels of `typedFetch`, two calls into the polyfill, and the polluted
      // value ran zero times. The recursion terminated on its own.
      expect(pollutedCalls).toBe(0);
      expect(depth).toBe(2);
      expect(innerBody).toBe("served");
      expect(outer.error).toBe(null);
      expect(await outer.response?.text()).toBe("served");
    });

    test("the init a transport receives carries no fetch extension under any read", async () => {
      // R17-H1-01.
      //
      // THE SENTENCE. `src/request-plan.ts`, module JSDoc, the bullet
      // immediately after "The `fetch` override is read as an OWN property. A
      // polluted prototype never redirects a transport":
      //
      //   "The init a transport receives carries no `fetch` extension under any
      //    of the three reads: a property get answers `undefined`, an `in` check
      //    answers `false`, and the own-key list omits the name."
      //
      // CONTEXT.md repeats it verbatim under "Transport re-entry". Neither
      // qualifies the claim, and the bullet one line up is about exactly the
      // input this test supplies.
      //
      // WHY THE EXTENSION SURVIVES. `snapshotRequestInit` has two branches, and
      // only one of them hides anything. `Object.hasOwn(options, "fetch")` picks
      // the branch. On the sanitized branch a `get` trap answers `undefined`, a
      // `has` trap answers `false`, and the descriptor was deleted from the
      // target — the test two above measures that branch and it holds. On the
      // other branch the caller's own object IS the proxy target and the only
      // trap is `get`, which delegates. An inherited `fetch` therefore takes no
      // branch that hides it.
      //
      // THE INPUT IS ORDINARY. `typedFetch(url)` with no options object at all,
      // under a polluted `Object.prototype`, is the H-22 shape; a per-call
      // options object built with `Object.create(defaults)` over a shared
      // configuration carrying a `fetch` is the same read without any hostility.
      // The transport here is caller code with no `fetch` option, which
      // `src/request-plan.ts` names twice as a first-class case: "a replaced
      // `globalThis.fetch` carries no key while being caller code."
      const { typedFetch } = await api();
      const target = server.url({ body: "served" });
      const objectPrototype = Object.prototype as { fetch?: unknown };

      const polluted = (async () => new Response("polluted")) as unknown as typeof fetch;
      let reads: ExtensionReads | undefined;
      const polyfill = (async (input: unknown, init: RequestInit) => {
        reads = readExtension(init, polluted);
        return await NATIVE_FETCH(input as string, init);
      }) as unknown as typeof fetch;

      const globals = globalThis as { fetch: typeof fetch };
      Object.defineProperty(objectPrototype, "fetch", {
        value: polluted,
        writable: true,
        enumerable: false,
        configurable: true,
      });
      globals.fetch = polyfill;
      let result: Awaited<ReturnType<typeof typedFetch>>;
      try {
        result = await typedFetch(target);
      } finally {
        globals.fetch = NATIVE_FETCH;
        Reflect.deleteProperty(objectPrototype, "fetch");
      }

      // Non-vacuity: the transport really did run and really did answer.
      expect(result.error).toBe(null);
      expect(await result.response?.text()).toBe("served");

      // ADJUDICATED IN ROUND 17. The finding was real and the REMEDY WAS THE
      // SENTENCE. `tests/request/request-plan.spec.ts:96` already pins the
      // settled behavior — an inherited `fetch` is neither used nor stripped —
      // so demanding `NO_EXTENSION` here would demand a runtime change the
      // audit has decided against. F4 corrected the documents and disputed
      // this assertion rather than guessing; the orchestrator upheld it.
      //
      // What the corrected sentence claims, and what this now pins: the three
      // reads that inspect the init's OWN shape answer absent, and the two
      // that walk the prototype chain answer the caller's value. The
      // consequence the term exists for is unchanged and is pinned by the two
      // sibling tests above: the inherited value runs zero times, so a
      // transport re-enters on the ambient transport and never on itself.
      expect(
        reads,
        "the corrected sentence in src/request-plan.ts and CONTEXT.md: the three own-shape " +
          "reads answer absent, and a plain property get and an `in` check read the " +
          "prototype chain, so an INHERITED `fetch` answers both",
      ).toEqual({
        propertyGet: "the fetch option",
        inCheck: true,
        ownKeyList: false,
        ownDescriptor: false,
        spreadCopy: false,
      } satisfies ExtensionReads);
    });
  },
);

describe.skipIf(!distExists)("round 17 / H1 — the phase 3 cross-call release, against dist", () => {
  test("the HTTP error an earlier call returned can no longer read its socket body", async () => {
    // ADR 0003, amendment of 2026-08-09: "The HTTP-error arm makes
    // `error.text()` reject with `Body is unusable`, while `error.cancel()`
    // still settles." Pinned here against the built package, with a body that
    // came off the wire.
    const { typedFetch, isHttpError, isNetworkError } = await api();
    const wire = await NATIVE_FETCH(server.url({ body: "payload-error" }));
    const value = foreignResponse({ status: 404, statusText: "Not Found", ok: false }, wire);
    const transport = resolving(value);

    const first = await typedFetch("https://round17.test/resource", { fetch: transport });
    if (!isHttpError(first.error)) throw new Error("expected an HTTP error");
    expect(first.error.status).toBe(404);

    value.json = undefined;
    const second = await typedFetch("https://round17.test/resource", { fetch: transport });
    expect(second.response).toBe(null);
    expect(isNetworkError(second.error)).toBe(true);

    await expect(first.error.text()).rejects.toThrow(/Body is unusable/u);
    expect(wire.bodyUsed).toBe(true);
    await expect(first.error.cancel()).resolves.toBeUndefined();
  });

  test("the success an earlier call returned reads zero bytes off its socket body", async () => {
    // The other arm the same amendment names: "The success arm ends the
    // caller's stream." The caller holds the stream BEFORE the second call
    // runs, so nothing about the handle changes underneath it — only what it
    // yields.
    const { typedFetch, isNetworkError } = await api();
    const wire = await NATIVE_FETCH(server.url({ body: "payload-success" }));
    const value = foreignResponse({}, wire);
    const transport = resolving(value);

    const first = await typedFetch("https://round17.test/resource", { fetch: transport });
    expect(first.error).toBe(null);
    const stream = first.response?.body;
    if (!stream) throw new Error("expected a body");

    value.json = undefined;
    const second = await typedFetch("https://round17.test/resource", { fetch: transport });
    expect(isNetworkError(second.error)).toBe(true);

    expect(stream.locked).toBe(false);
    const reader = stream.getReader();
    let bytes = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.length;
    }
    expect(bytes).toBe(0);
    expect(wire.bodyUsed).toBe(true);
  });

  test("a value no earlier call handed out is still released on refusal", async () => {
    // The same amendment's last sentence, and the reason the release is
    // unconditional: a body no caller will ever hold must still be closed.
    const { typedFetch, isNetworkError } = await api();
    const wire = await NATIVE_FETCH(server.url({ body: "payload-fresh" }));
    const value = foreignResponse({ json: undefined }, wire);

    const refused = await typedFetch("https://round17.test/resource", {
      fetch: resolving(value),
    });

    expect(refused.response).toBe(null);
    expect(isNetworkError(refused.error)).toBe(true);
    expect(wire.bodyUsed).toBe(true);
  });
});

// ── B. The differential against a bare fetch, over the whole outcome set ───

/** Every member of a success report, from either side of the differential. */
interface SuccessReport {
  readonly status: number;
  readonly statusText: string;
  readonly ok: boolean;
  readonly redirected: boolean;
  readonly type: string;
  readonly url: string;
  readonly bodyIsNull: boolean;
  readonly text: string;
  readonly headers: readonly (readonly [string, string])[];
}

/**
 * The headers both exchanges must agree on.
 *
 * `date` moves between two requests a millisecond apart, and `connection`,
 * `keep-alive`, and `transfer-encoding` are the agent's framing rather than the
 * exchange's content. What is left is what the test asked the server for, plus
 * the fixture's own echoes — `x-echo-method` and `x-echo-body` — so this
 * comparison also covers the REQUEST each side put on the wire, not only the
 * response each side read back.
 */
function comparableHeaders(headers: Headers): (readonly [string, string])[] {
  return [...headers]
    .filter(([name]) => name.startsWith("x-") || name === "content-type" || name === "location")
    .toSorted(([a], [b]) => (a < b ? -1 : 1));
}

function reportResponse(response: Response, text: string): SuccessReport {
  return {
    status: response.status,
    statusText: response.statusText,
    ok: response.ok,
    redirected: response.redirected,
    type: response.type,
    url: response.url,
    bodyIsNull: response.body === null,
    text,
    headers: comparableHeaders(response.headers),
  };
}

interface OutcomeCase {
  readonly name: string;
  readonly target: () => string;
  readonly init?: () => RequestInit;
}

const SUCCESS_CASES: readonly OutcomeCase[] = [
  { name: "200 with a body", target: () => server.url({ body: "hello" }) },
  { name: "200 with no body", target: () => server.url({}) },
  { name: "204 No Content", target: () => server.url({ status: 204 }) },
  { name: "304 Not Modified", target: () => server.url({ status: 304 }) },
  { name: "299, unmapped and ok", target: () => server.url({ status: 299 }) },
  { name: "399, unmapped and not ok", target: () => server.url({ status: 399 }) },
  {
    name: "HEAD, a bodiless response by method",
    target: () => server.url({ body: "suppressed" }),
    init: () => ({ method: "HEAD" }),
  },
  {
    name: "a two-hop redirect chain to 200",
    target: () => {
      const final = server.url({ body: "arrived", header: "X-Marker:final" });
      const hop = server.url({ status: 302, header: `Location:${final}` });
      return server.url({ status: 302, header: `Location:${hop}` });
    },
  },
  {
    name: "a 302 under redirect: manual",
    target: () => server.url({ status: 302, header: `Location:${server.url({})}` }),
    init: () => ({ redirect: "manual" }),
  },
  {
    name: "a POST whose body and header reach the server",
    target: () => server.url({ echoHeader: "X-Sent" }),
    init: () => ({ method: "POST", body: "sent-body", headers: { "X-Sent": "sent-header" } }),
  },
];

describe.skipIf(!distExists)(
  "round 17 / H1 — the success differential against a bare fetch",
  () => {
    test.each(SUCCESS_CASES)("$name reports exactly what a bare fetch reports", async (outcome) => {
      const { typedFetch } = await api();
      const target = outcome.target();
      const init = outcome.init?.() ?? {};

      const bare = await NATIVE_FETCH(target, init);
      const bareReport = reportResponse(bare, await bare.text());

      const { response, error } = await typedFetch(target, outcome.init?.() ?? {});
      expect(error).toBe(null);
      if (!response) throw new Error("expected a response");
      const typedReport = reportResponse(response as unknown as Response, await response.text());

      expect(typedReport).toEqual(bareReport);
    });
  },
);

describe.skipIf(!distExists)(
  "round 17 / H1 — the HTTP-error differential against a bare fetch",
  () => {
    test("every mapped status reports its dedicated class over the platform's own report", async () => {
      // The mapped roster, read off the built barrel rather than listed here so
      // it cannot fall behind a status this version ships, and driven through
      // the real server twice per row. 39 of the 40 rows go over a socket; the
      // 407 exception has its own test below. The comparison is the whole of
      // what a caller can read off the error against the whole of what the
      // platform put in the response.
      //
      // `statusText` is the one member deliberately outside the equality, and
      // the test below pins why: the class carries the library's canonical
      // label, and the ORIGIN's reason phrase is quoted into `message`. Both
      // halves are asserted here per status, so the exclusion buys nothing.
      const built = await api();
      const roster = Object.entries(built)
        .filter(
          (entry): entry is [string, ErrorRoster[string]] =>
            typeof entry[1] === "function" &&
            typeof (entry[1] as { status?: unknown }).status === "number",
        )
        .toSorted((a, b) => a[1].status - b[1].status);
      expect(roster.length).toBeGreaterThanOrEqual(40);

      const divergences: string[] = [];
      let canonicalDiffersFromWire = 0;

      for (const [className, ErrorClass] of roster) {
        if (ErrorClass.status === UNREACHABLE_OVER_HTTP) continue;
        const target = server.url({ status: ErrorClass.status, body: `body-${ErrorClass.status}` });

        const bare = await NATIVE_FETCH(target);
        const bareReport = {
          status: bare.status,
          url: bare.url,
          headers: comparableHeaders(bare.headers),
          text: await bare.text(),
        };
        const wirePhrase = bare.statusText;

        const { response, error } = await built.typedFetch(target);
        if (response !== null || error === null) {
          divergences.push(`${ErrorClass.status}: typedFetch returned a success envelope`);
          continue;
        }
        if (!built.isKnownHttpError(error)) {
          divergences.push(`${ErrorClass.status}: not a known HTTP error, got ${error.name}`);
          continue;
        }
        const typedReport = {
          status: error.status,
          url: error.url,
          headers: comparableHeaders(error.headers),
          text: await error.text(),
        };

        if (JSON.stringify(typedReport) !== JSON.stringify(bareReport)) {
          divergences.push(
            `${ErrorClass.status}: ${JSON.stringify(typedReport)} vs ${JSON.stringify(bareReport)}`,
          );
        }
        if (!(error instanceof ErrorClass) || error.name !== className) {
          divergences.push(`${ErrorClass.status}: class is ${error.name}, expected ${className}`);
        }
        if (error.statusText !== ErrorClass.statusText) {
          divergences.push(
            `${ErrorClass.status}: statusText is ${error.statusText}, expected the canonical ` +
              ErrorClass.statusText,
          );
        }
        if (!error.message.includes(JSON.stringify(wirePhrase))) {
          divergences.push(
            `${ErrorClass.status}: message ${error.message} omits the wire phrase ${wirePhrase}`,
          );
        }
        if (wirePhrase !== ErrorClass.statusText) canonicalDiffersFromWire += 1;
      }

      expect(divergences).toEqual([]);
      // Non-vacuity for the `statusText` exclusion: the canonical label and the
      // origin's phrase really are two different strings for part of the
      // roster, so the two assertions above are not one assertion twice.
      expect(canonicalDiffersFromWire).toBeGreaterThan(0);
    }, 30_000);

    test("407 is the one mapped status the ambient transport never delivers", async () => {
      // The exception `tests/envelope/typed-fetch.spec.ts` already records —
      // "Node's fetch rejects a 407 at the network level" — measured from the
      // other side. That file drives the row through an injected transport
      // instead, so nothing had run the live 407 and read what a caller gets.
      //
      // This is not a defect. The class is selected from a RESPONSE, there is no
      // response, and `typedFetch` reports the transport's failure faithfully.
      // The differential names it so the 39-row loop above cannot be read as
      // covering 40.
      const { typedFetch, isNetworkError, ProxyAuthenticationRequiredError } = await api();
      if (!ProxyAuthenticationRequiredError) throw new Error("expected the class on the barrel");
      expect(ProxyAuthenticationRequiredError.status).toBe(UNREACHABLE_OVER_HTTP);
      const target = server.url({ status: UNREACHABLE_OVER_HTTP, body: "proxy" });

      let rejection = "resolved";
      try {
        await NATIVE_FETCH(target);
      } catch (cause) {
        rejection = (cause as { readonly name?: string }).name ?? typeof cause;
      }
      expect(rejection).toBe("TypeError");

      const { response, error } = await typedFetch(target);
      expect(response).toBe(null);
      expect(isNetworkError(error)).toBe(true);
      expect(error?.url).toBe(target);
    });

    test("an unmapped status becomes UnknownHttpError over the same platform report", async () => {
      const { typedFetch, isHttpError, isKnownHttpError, UnknownHttpError } = await api();
      const target = server.url({ status: 599, body: "unmapped" });

      const bare = await NATIVE_FETCH(target);
      const bareText = await bare.text();

      const { response, error } = await typedFetch(target);
      expect(response).toBe(null);
      if (!isHttpError(error)) throw new Error("expected an HTTP error");

      expect(error).toBeInstanceOf(UnknownHttpError);
      expect(isKnownHttpError(error)).toBe(false);
      expect(error.status).toBe(bare.status);
      expect(error.url).toBe(bare.url);
      expect(await error.text()).toBe(bareText);
      // The one status class with no canonical label of its own: here, and only
      // here, `statusText` IS the origin's phrase.
      expect(error.statusText).toBe(bare.statusText);
    });

    test("a redirect chain files the error against the FINAL url, as the platform does", async () => {
      const { typedFetch, isHttpError } = await api();
      const final = server.url({ status: 404, body: "gone", header: "X-Marker:final" });
      const hop = server.url({ status: 302, header: `Location:${final}` });
      const target = server.url({ status: 302, header: `Location:${hop}` });

      const bare = await NATIVE_FETCH(target);
      expect(bare.redirected).toBe(true);
      expect(bare.url).toBe(href(final));

      const { error } = await typedFetch(target);
      if (!isHttpError(error)) throw new Error("expected an HTTP error");

      expect(error.url).toBe(href(final));
      expect(error.headers.get("x-marker")).toBe("final");
      expect(await error.text()).toBe("gone");
      // The redacted form the message and the record carry drops the query the
      // final hop was named with, and the escape hatch keeps it. Both name the
      // same server, which is what the correlation is for.
      expect(error.toJSON().url).toBe(new URL(final).origin + "/");
    });
  },
);

interface FailureCase {
  readonly name: string;
  readonly target: () => string;
  readonly init?: () => RequestInit;
  /** What the platform rejects with, by constructor name. */
  readonly rejection: string;
  /** The class `typedFetch` answers with instead. */
  readonly answered: "NetworkError" | "AbortedError" | "TimeoutError";
}

const FAILURE_CASES: readonly FailureCase[] = [
  {
    name: "a refused connection",
    target: () => "http://localhost:1/round17-refused",
    rejection: "TypeError",
    answered: "NetworkError",
  },
  {
    name: "an unparseable url",
    target: () => "http:// round17 not a url",
    rejection: "TypeError",
    answered: "NetworkError",
  },
  {
    name: "an unsupported scheme",
    target: () => "ftp://round17.invalid/resource",
    rejection: "TypeError",
    answered: "NetworkError",
  },
  {
    name: "a redirect refused by redirect: error",
    target: () => server.url({ status: 302, header: `Location:${server.url({})}` }),
    init: () => ({ redirect: "error" }),
    rejection: "TypeError",
    answered: "NetworkError",
  },
  {
    name: "a signal already aborted before the call",
    target: () => server.url({}),
    init: () => ({ signal: AbortSignal.abort() }),
    rejection: "AbortError",
    answered: "AbortedError",
  },
  {
    name: "a signal aborted with a reason that is not an AbortError",
    target: () => server.url({ delay: 300 }),
    init: () => {
      const controller = new AbortController();
      controller.abort(new Error("round17 reason"));
      return { signal: controller.signal };
    },
    rejection: "Error",
    answered: "AbortedError",
  },
  {
    name: "an abort raised while the request is in flight",
    target: () => server.url({ delay: 300 }),
    init: () => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 30);
      return { signal: controller.signal };
    },
    rejection: "AbortError",
    answered: "AbortedError",
  },
  {
    name: "a timeout raised while the request is in flight",
    target: () => server.url({ delay: 300 }),
    init: () => ({ signal: AbortSignal.timeout(30) }),
    rejection: "TimeoutError",
    answered: "TimeoutError",
  },
];

describe.skipIf(!distExists)(
  "round 17 / H1 — the failure differential against a bare fetch",
  () => {
    test.each(FAILURE_CASES)(
      "$name: the platform rejects and typedFetch answers with a value",
      async (outcome) => {
        const { typedFetch, isNetworkError, isAbortError, isTimeoutError } = await api();
        const target = outcome.target();

        let rejection = "resolved";
        try {
          await NATIVE_FETCH(target, outcome.init?.() ?? {});
        } catch (cause) {
          rejection = (cause as { readonly name?: string }).name ?? typeof cause;
        }

        const { response, error } = await typedFetch(target, outcome.init?.() ?? {});

        // The envelope's whole promise: the platform rejected and this returned.
        expect(rejection).toBe(outcome.rejection);
        expect(response).toBe(null);
        if (error === null) throw new Error("expected an error");

        const answered = isTimeoutError(error)
          ? "TimeoutError"
          : isAbortError(error)
            ? "AbortedError"
            : isNetworkError(error)
              ? "NetworkError"
              : error.name;
        expect(answered).toBe(outcome.answered);
        // The pre-response error names the url the caller asked for. The platform
        // reports no url at all on a rejection, so this is the one member of the
        // failure report the differential cannot compare — it can only pin it.
        expect(error.url).toBe(target);
      },
      20_000,
    );
  },
);

// ── C. The concurrent interleaving, at scale, through real redirects ───────

describe.skipIf(!distExists)("round 17 / H1 — concurrency the platform schedules", () => {
  test("24 concurrent calls through two-hop redirects each report their own identity", async () => {
    // Round 16 proved phases 1 and 3 contain no `await` over 24 concurrent
    // calls against a double, and that two SEQUENTIAL calls resolving one
    // object yield one identity. Neither measurement lets the platform decide
    // the interleaving. Here each call crosses three real exchanges with two
    // redirects between them, so the resolution order is the event loop's and
    // not the test's, and the outcome classes are mixed: a success, a mapped
    // client error, and a mapped server error, round-robin.
    const { typedFetch, isKnownHttpError } = await api();
    const jobs = Array.from({ length: 24 }, (_index, i) => {
      const status = i % 3 === 0 ? 200 : i % 3 === 1 ? 404 : 503;
      const final = server.url({ status, body: `payload-${i}`, header: `X-Marker:m${i}` });
      const hop = server.url({ status: 302, header: `Location:${final}` });
      return { i, status, final, entry: server.url({ status: 302, header: `Location:${hop}` }) };
    });

    const observed = await Promise.all(
      jobs.map(async (job) => {
        const { response, error } = await typedFetch(job.entry);
        if (response) {
          return {
            i: job.i,
            status: response.status,
            url: response.url,
            marker: response.headers.get("x-marker"),
            text: await response.text(),
            redirected: response.redirected,
          };
        }
        if (!isKnownHttpError(error)) throw new Error(`unexpected error ${error.name}`);
        return {
          i: job.i,
          status: error.status,
          url: error.url,
          marker: error.headers.get("x-marker"),
          text: await error.text(),
          redirected: true,
        };
      }),
    );

    const expected = jobs.map((job) => ({
      i: job.i,
      status: job.status,
      url: href(job.final),
      marker: `m${job.i}`,
      text: `payload-${job.i}`,
      redirected: true,
    }));
    expect(observed).toEqual(expected);
    // Every call reached a distinct final target, so a single shared identity
    // would have shown up as a repeated url rather than as a passing set.
    expect(new Set(observed.map((entry) => entry.url)).size).toBe(24);
  }, 30_000);
});
