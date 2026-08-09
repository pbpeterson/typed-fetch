import { describe, expect, test, vi } from "vitest";
import { isAbortError, isNetworkError, isTimeoutError, typedFetch } from "../../src/index";
import type { TypedFetchOptions } from "../../src/index";
import { useTestServer } from "../../fixtures/http-server";
import { foreignResponses } from "../../fixtures/responses";

// ── ONLY THE TRANSPORT PHASE CAN PRODUCE AN ABORT OR A TIMEOUT ───────────
//
// `typedFetch` runs three phases: it reads the caller's options (SETUP), it
// awaits the transport (TRANSPORT), and it inspects what the transport resolved
// (RESPONSE). One `try` covered all three, and `classifyRequestFailure` — which
// trusts the governing signal by design — therefore saw a phase-1 or phase-3
// exception as if the transport had rejected. A getter is caller code, and a
// getter that aborts the signal and then throws an abort-shaped exception made
// `typedFetch` answer with an `AbortedError` for a failure the abort never
// caused, and with a `TimeoutError` when the abort reason was a timeout. A
// consumer's retry policy reads that class.
//
// ADR 0003 rows H-27 and H-28 state the rule, and `fixtures/hostile-fetch.ts`
// drives one shape of each. This file owns the rest, and it is an ENVELOPE file
// on purpose: neither `src/request-plan.ts` nor `src/response-verdict.ts`
// consults a signal at all, so neither can produce an abort even if a later
// change forgot the rule. What can is `src/index.ts`'s abort WINDOW — the two
// snapshots either side of the transport's synchronous prologue — and that
// window has no interface of its own. Its subject is a whole call.
//
// FOUR describes and THREE copies of one `abortingSlot` helper used to state
// this, under four different naming schemes — an audit round, an ADR row, a
// commit SHA, and a review-finding number. The provenance is kept in the
// bodies; the tests are named by subject. What they were:
//
//  - "ROUND 6 — an options read the transport performs cannot claim an abort":
//    six slots, ambient transport.
//  - "H-28 — an options read that aborts the signal and throws": the same rule
//    over the full 13-slot WebIDL table.
//  - "DEFECT 1 — an own `fetch: undefined` reopens ADR 0003 row H-28": the
//    window's scope test asked whether an own `fetch` KEY was present, and
//    `{ fetch: undefined }` runs the AMBIENT transport with the window switched
//    off. It is now the second column of the table below rather than a third
//    copy of it, so every slot is asked under both shapes.
//  - "DEFECT 2 — a patched global transport that aborts and rejects": the same
//    wrong question, other half.
//
// The `TRANSPORT_READ_SLOTS` table is the half of H-28 the conformance corpus
// cannot drive. Every scenario there injects a `fetch`, and an injected
// transport's own body IS the caller's code — which is where the row stops. So
// the ambient transport drives it here, against the real server.

const { url } = useTestServer();

/**
 * Options whose `slot` getter aborts the governing signal and then throws.
 *
 * Aborting WITH the thrown value is the hard shape: the rejection is then
 * identical to the signal's reason, so the VALUE cannot tell the two apart and
 * only the phase window can. That is also why the rejection value could never
 * narrow the window — a getter is free to abort with the very exception it then
 * throws.
 *
 * `extra` carries the second column of the table: `{ fetch: undefined }` leaves
 * the ambient transport in place while carrying the key.
 */
function abortingSlot(
  slot: string,
  controller: AbortController,
  thrown: unknown,
  extra: Record<string, unknown> = {},
): TypedFetchOptions {
  const options: Record<string, unknown> = { signal: controller.signal, ...extra };
  Object.defineProperty(options, slot, {
    enumerable: true,
    configurable: true,
    get(): never {
      controller.abort(thrown);
      throw thrown;
    },
  });
  return options as TypedFetchOptions;
}

/** The two option shapes that both run the PLATFORM's own transport. */
const AMBIENT_SHAPES: [string, Record<string, unknown>][] = [
  ["no fetch key at all", {}],
  // Which transport RUNS is a different fact from whether a KEY is present.
  // `TypedFetchOptions` declares `fetch?: typeof fetch | undefined` for exactly
  // this shape, which is what `{ ...defaults, fetch: maybeOverride }` produces.
  ["an own fetch: undefined", { fetch: undefined }],
];

/** The 13 WebIDL slots the TRANSPORT reads, after the init has been handed over. */
const TRANSPORT_READ_SLOTS = [
  "method",
  "headers",
  "body",
  "cache",
  "credentials",
  "redirect",
  "referrer",
  "referrerPolicy",
  "integrity",
  "keepalive",
  "mode",
  "duplex",
  "priority",
];

const ABORTED = (): DOMException => new DOMException("Aborted", "AbortError");
const TIMED_OUT = (): DOMException =>
  new DOMException("The operation was aborted due to timeout", "TimeoutError");

describe("an options read the TRANSPORT performs cannot claim an abort", () => {
  test.each(
    AMBIENT_SHAPES.flatMap(([shape, extra]) =>
      TRANSPORT_READ_SLOTS.map((slot) => [slot, shape, extra] as const),
    ),
  )("a throwing getter on options.%s, under %s, is a network failure", async (slot, _s, extra) => {
    const controller = new AbortController();

    const { response, error } = await typedFetch(
      url(),
      abortingSlot(slot, controller, ABORTED(), extra),
    );

    expect(response).toBe(null);
    expect({ abort: isAbortError(error), network: isNetworkError(error) }).toEqual({
      abort: false,
      network: true,
    });
  });

  test.each(AMBIENT_SHAPES)("and it cannot claim a timeout either, under %s", async (_s, extra) => {
    const controller = new AbortController();

    const { error } = await typedFetch(
      url(),
      abortingSlot("method", controller, TIMED_OUT(), extra),
    );

    expect({ timeout: isTimeoutError(error), network: isNetworkError(error) }).toEqual({
      timeout: false,
      network: true,
    });
  });

  test.each(AMBIENT_SHAPES)(
    "a read INSIDE a header container is covered, under %s",
    async (_s, extra) => {
      const controller = new AbortController();
      const thrown = ABORTED();
      const headers = {
        get "x-probe"(): string {
          controller.abort(thrown);
          throw thrown;
        },
      };

      const { error } = await typedFetch(url(), {
        ...extra,
        signal: controller.signal,
        headers: headers as never,
      } as TypedFetchOptions);

      expect({ abort: isAbortError(error), network: isNetworkError(error) }).toEqual({
        abort: false,
        network: true,
      });
    },
  );

  test("a header value toString that aborts and throws must not claim an abort", async () => {
    const controller = new AbortController();
    const thrown = ABORTED();
    const value = {
      toString(): never {
        controller.abort(thrown);
        throw thrown;
      },
    };

    const { error } = await typedFetch(url(), {
      headers: { "x-probe": value } as never,
      signal: controller.signal,
    });

    expect(isAbortError(error)).toBe(false);
    expect(isNetworkError(error)).toBe(true);
  });

  test("a body toString that aborts and throws must not claim an abort", async () => {
    const controller = new AbortController();
    const thrown = ABORTED();
    const body = {
      toString(): never {
        controller.abort(thrown);
        throw thrown;
      },
    };

    const { error } = await typedFetch(url(), {
      method: "POST",
      body: body as never,
      signal: controller.signal,
    });

    expect(isAbortError(error)).toBe(false);
    expect(isNetworkError(error)).toBe(true);
  });

  test("an options getter that aborts WITHOUT throwing is a network failure too", async () => {
    // DECIDED, and recorded in ADR 0003's amendment of 2026-08-08. A getter
    // that aborts is indistinguishable from one that aborts AND throws: a
    // getter is free to abort with the very exception it then throws, so the
    // rejection is identical to the signal's reason in both shapes. Both are
    // the caller aborting its own request from inside a getter, and no request
    // left the process in either, so H-28 decides the class for both.
    const controller = new AbortController();
    const options: Record<string, unknown> = { signal: controller.signal };
    Object.defineProperty(options, "method", {
      enumerable: true,
      configurable: true,
      get() {
        controller.abort();
        return "GET";
      },
    });

    const { error } = await typedFetch(url({ delay: 200 }), options as TypedFetchOptions);

    expect(isAbortError(error)).toBe(false);
    expect(isNetworkError(error)).toBe(true);
  });
});

// ── The reads typedFetch performs ITSELF, and the reads of the resolved value ─

describe("a SETUP-phase read that aborts the signal and throws", () => {
  // `signal` and `fetch` are the only two slots `planRequest` reads for itself.
  // Every OTHER member of the dictionary is read by the TRANSPORT, which is the
  // block above. That distinction is why one used to hold while the other did
  // not.
  test.each(["signal", "fetch"])("options.%s is a network failure", async (slot) => {
    const controller = new AbortController();
    const options: Record<string, unknown> = {};
    if (slot !== "signal") {
      Object.defineProperty(options, "signal", { enumerable: true, value: controller.signal });
    }
    Object.defineProperty(options, slot, {
      enumerable: true,
      configurable: true,
      get(): never {
        controller.abort();
        throw ABORTED();
      },
    });

    const { error } = await typedFetch(url(), options as TypedFetchOptions);

    expect(isAbortError(error)).toBe(false);
    expect(isNetworkError(error)).toBe(true);
  });

  test("an ownKeys trap that aborts and throws is a network failure", async () => {
    // The descriptor pass runs after the signal slot has been read, so the
    // governing signal is already known when this exception is raised. This is
    // the shape ADR 0003 row H-28 publishes; `fixtures/hostile-fetch.ts` drives
    // it too, and this copy states the signal's own end state.
    const controller = new AbortController();
    const target = {
      fetch: (async () => new Response(null, { status: 200 })) as unknown as typeof fetch,
      signal: controller.signal,
    };
    const options = new Proxy(target, {
      ownKeys(): never {
        controller.abort();
        throw ABORTED();
      },
    });

    const { response, error } = await typedFetch(url(), options);

    expect(response).toBe(null);
    expect(isAbortError(error)).toBe(false);
    expect(isNetworkError(error)).toBe(true);
    expect(controller.signal.aborted).toBe(true);
  });
});

describe("a RESPONSE-phase read that aborts the signal and throws", () => {
  const resolvedUrl = "https://abort-window.test/aborting-getter";
  const foreignResponse = foreignResponses(resolvedUrl);

  test.each(["status", "headers", "bodyUsed", "ok", "type"])(
    "a `%s` getter that aborts the signal and throws is a network failure",
    async (field) => {
      const controller = new AbortController();
      const resolved = foreignResponse({
        [field]: {
          get(): never {
            controller.abort();
            throw ABORTED();
          },
        },
      });

      const { response, error } = await typedFetch(resolvedUrl, {
        fetch: (async () => resolved) as unknown as typeof fetch,
        signal: controller.signal,
      });

      expect(response).toBe(null);
      expect(isNetworkError(error)).toBe(true);
      expect(isAbortError(error)).toBe(false);
      expect(controller.signal.aborted).toBe(true);
    },
  );

  test("a getter that aborts with a TIMEOUT reason is still a network failure", async () => {
    // The timeout arm reads the signal's REASON, so a getter that aborts with a
    // real `DOMException` named "TimeoutError" reached it directly.
    const controller = new AbortController();
    const resolved = foreignResponse({
      status: {
        get(): never {
          const reason = new DOMException("The operation timed out.", "TimeoutError");
          controller.abort(reason);
          throw reason;
        },
      },
    });

    const { response, error } = await typedFetch(resolvedUrl, {
      fetch: (async () => resolved) as unknown as typeof fetch,
      signal: controller.signal,
    });

    expect(response).toBe(null);
    expect(isTimeoutError(error)).toBe(false);
    expect(isNetworkError(error)).toBe(true);
  });

  test("releasing the body cannot reclassify the failure that caused the release", async () => {
    // The release runs INSIDE the response phase, so a stream whose `cancel`
    // algorithm aborts the governing signal is one more piece of caller code
    // running where an abort is not available.
    const controller = new AbortController();
    const cause = new Error("status getter exploded");
    const body = new ReadableStream({
      cancel() {
        controller.abort(cause);
      },
    });
    const hostileResponse = new Response(body, { status: 200 });
    Object.defineProperty(hostileResponse, "status", {
      get() {
        throw cause;
      },
    });

    const { response, error } = await typedFetch("https://abort-window.test/reentrant-release", {
      signal: controller.signal,
      fetch: (async () => hostileResponse) as unknown as typeof fetch,
    });

    expect(controller.signal.aborted).toBe(true);
    expect(response).toBe(null);
    expect(isNetworkError(error)).toBe(true);
    expect(isAbortError(error)).toBe(false);
    expect(error?.cause).toBe(cause);
  });
});

// ── Where the window STOPS ───────────────────────────────────────────────
//
// The window only reports a signal that MOVES while the AMBIENT transport is
// reading the caller's init. Everything below is a real abort and keeps its
// class; each case is one boundary of the fix, stated as a test.

describe("an abort the window must not take away", () => {
  test("an abort raised BEFORE the call is still an abort", async () => {
    const controller = new AbortController();
    controller.abort();

    const { error } = await typedFetch(url(), { signal: controller.signal });

    expect(isAbortError(error)).toBe(true);
  });

  test("an abort raised while the request is IN FLIGHT is still an abort", async () => {
    const controller = new AbortController();
    const pending = typedFetch(url({ delay: 200 }), { signal: controller.signal });
    setTimeout(() => controller.abort(), 20);

    const { error } = await pending;

    expect(isAbortError(error)).toBe(true);
  });

  test("an INJECTED transport that aborts and rejects is still an abort", async () => {
    // The transport IS the request when the caller supplies one, so the window
    // does not apply to it. ADR 0003 already scopes that as the caller's code.
    const controller = new AbortController();

    const { error } = await typedFetch(url(), {
      signal: controller.signal,
      fetch: (async () => {
        controller.abort();
        throw ABORTED();
      }) as unknown as typeof fetch,
    });

    expect(isAbortError(error)).toBe(true);
  });

  test("a PATCHED GLOBAL transport that aborts and rejects is still an abort", async () => {
    // The window's scope test used to ask whether options carried an own
    // `fetch` key, and a replaced `globalThis.fetch` carries none while being
    // caller code. `vi.stubGlobal("fetch", …)` and every fetch-interceptor
    // library reach this shape; it was an `AbortedError` at 8054567 and a
    // `NetworkError` at 44356e9.
    const real = globalThis.fetch;
    const controller = new AbortController();
    try {
      globalThis.fetch = (async () => {
        controller.abort();
        throw ABORTED();
      }) as unknown as typeof fetch;

      const { error } = await typedFetch(url(), { signal: controller.signal });

      expect({ abort: isAbortError(error), network: isNetworkError(error) }).toEqual({
        abort: true,
        network: false,
      });
    } finally {
      globalThis.fetch = real;
    }
  });

  test("a runtime with no fetch global at module load treats every transport as the caller's", async () => {
    // `nativeFetch` is captured at module load, so a runtime that ships no
    // `fetch` leaves it undefined. The window then never applies, which is the
    // safe direction: an abort raised by caller code keeps its class, and no
    // request can be made without a transport anyway.
    const saved = globalThis.fetch;
    // @ts-expect-error - an exotic runtime that ships no fetch
    delete globalThis.fetch;

    let reloaded: typeof import("../../src/index");
    try {
      vi.resetModules();
      reloaded = await import("../../src/index");
    } finally {
      globalThis.fetch = saved;
    }

    const controller = new AbortController();
    const { response, error } = await reloaded.typedFetch("https://abort-window.test/no-global", {
      signal: controller.signal,
      fetch: (async () => {
        controller.abort();
        throw ABORTED();
      }) as unknown as typeof fetch,
    });

    expect(response).toBe(null);
    expect(reloaded.isAbortError(error)).toBe(true);

    vi.resetModules();
  });
});
