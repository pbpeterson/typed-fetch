import http from "node:http";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { isAbortError, isHttpError, isNetworkError, isTimeoutError, typedFetch } from "./src/index";

// Round 15, lane H1. The final round.
//
// Rounds 12, 13 and 14 each returned clean, and each closed a property of ONE
// call: the setup phase's read inventory, the transport's return value as a
// set, the options snapshot over a generated population, and the init a real
// server received. What none of them asked is what happens BETWEEN calls, and
// that is the surface this file takes.
//
// Four questions, in the order they matter:
//
//  1. WHAT STATE OUTLIVES A CALL, and can one call observe another's? The
//     module holds exactly two module-scoped bindings — `nativeFetch`, captured
//     at load, and `validatedResponseStructures`, a `WeakSet` keyed by an
//     accepted response. Section 1 pins that the WeakSet is not a validation
//     CACHE: an acceptance never lets a later call skip a check. It also pins
//     the structural reason no race is possible at all — phases 1 and 3 contain
//     no `await`, so two calls cannot interleave inside either of them. That
//     test is what breaks if a later refactor puts an `await` in one.
//  2. TWO CALLS, ONE `AbortController`. Section 2. The signal is caller state
//     shared across calls by design, and the question is whether anything else
//     travels with it.
//  3. ONE `Response` OBJECT, TWO CALLS. Section 3. The response phase records
//     identity per response, so two calls holding one object share a table.
//     Sequential reuse is pinned (TF-21, TF-22, S6); concurrent reuse is not.
//  4. RE-ENTRANCY AND THE POST-RETURN ABORT. Sections 4 and 5. A transport that
//     calls `typedFetch` again with the init it was handed, and a signal that
//     aborts while the caller is reading the body of a response `typedFetch`
//     already handed back.

const FOREIGN_URL = "https://foreign.test/resource";

/** A transport that answers every call with one value. */
function resolving(value: unknown): typeof fetch {
  return (async () => value) as unknown as typeof fetch;
}

interface MutableForeignResponse {
  [key: string]: unknown;
  status: number;
  type: string;
}

/**
 * A structurally complete foreign `Response` whose members are own data
 * properties, so a test can break one after the value has been accepted.
 */
function foreignResponse(overrides: Record<string, unknown> = {}): MutableForeignResponse {
  const value: MutableForeignResponse = {
    [Symbol.toStringTag]: "Response",
    body: null,
    bodyUsed: false,
    headers: new Headers({ "content-type": "application/json" }),
    ok: true,
    redirected: false,
    status: 200,
    statusText: "OK",
    type: "basic",
    url: FOREIGN_URL,
    arrayBuffer: async () => new ArrayBuffer(0),
    blob: async () => new Blob(),
    clone: () => value,
    formData: async () => new FormData(),
    json: async () => ({}),
    text: async () => "",
    ...overrides,
  };
  return value;
}

// ── 1. The state that outlives a call ──────────────────────────────────────

describe("round 15 / H1 — what one call leaves behind for the next", () => {
  test("the module's cross-call state is one WeakSet, and the list is closed", async () => {
    // The inventory, executable. Every question in this file about one call
    // observing another reduces to what the module keeps between calls, and a
    // prose list of that goes stale silently — round 11 recorded a read
    // inventory that had been incomplete twice. This one fails when a binding is
    // added, which is the only way a list stays true.
    const source = await readFile(new URL("./src/index.ts", import.meta.url), "utf8");
    const declared = [...source.matchAll(/^(?:const|let|var)\s+(?<name>\w+)/gmu)].map(
      (match) => match.groups?.name ?? "",
    );

    expect(declared).toEqual([
      // Five constant tables, read-only for the life of the process.
      "FOREIGN_RESPONSE_FIELDS",
      "FOREIGN_RESPONSE_METHODS",
      "FOREIGN_RESPONSE_BODY_METHODS",
      "FOREIGN_RESPONSE_HEADERS_METHODS",
      "FOREIGN_RESPONSE_TYPES",
      // One intrinsic captured at load, which is a value and never rewritten.
      "nativeFetch",
      // One mutable table — the whole of this module's cross-call state.
      "validatedResponseStructures",
    ]);
  });

  // `validatedResponseStructures` is the only table `src/index.ts` writes, and
  // it is never rolled back: a value it admits stays admitted for as long as the
  // value lives. That is safe only while membership decides NOTHING — the set is
  // read once, as a precondition inside `hasCompatibleSuccessSurface`, and the
  // whole validation runs again on every call. If membership ever became a
  // shortcut, a response accepted once could re-enter through any later call
  // without being checked, which is the shape of every cache-invalidation bug.
  //
  // Three breaks, one per refusal point downstream of the acceptance.
  test.each([
    ["a removed body reader", "json", undefined, "not a Response"],
    ["a body that is no longer a stream", "body", {}, "not a Response"],
    ["a bodyUsed that is no longer a boolean", "bodyUsed", "no", "not a Response"],
    ["a type outside the IDL enum", "type", "bogus", "incompatible public surface"],
  ])(
    "%s breaks a value the previous call already accepted",
    async (_label, member, broken, expected) => {
      const value = foreignResponse();
      const fetch = resolving(value);

      const accepted = await typedFetch(FOREIGN_URL, { fetch });
      expect(accepted.error).toBe(null);
      expect(accepted.response).toBe(value as unknown as typeof accepted.response);

      value[member] = broken;
      const refused = await typedFetch(FOREIGN_URL, { fetch });

      expect(refused.response).toBe(null);
      expect(isNetworkError(refused.error)).toBe(true);
      expect((refused.error as { cause?: Error }).cause?.message).toContain(expected);
    },
  );

  test("a previously accepted response is still refused when its headers stop being usable", async () => {
    // The identity fields are cached per response, so `headers` is read from the
    // table on the second call — and that is exactly why the success-surface
    // check has to re-run over the RECORDED value rather than trust the earlier
    // acceptance. Breaking the recorded container's usability is not reachable,
    // so the reachable statement is the one that matters: a value whose headers
    // were never usable is refused even when everything else is accepted, and
    // acceptance of a SIBLING value does not change that verdict.
    const good = foreignResponse();
    const bad = foreignResponse({ headers: { get: () => null } });

    const first = await typedFetch(FOREIGN_URL, { fetch: resolving(good) });
    expect(first.error).toBe(null);

    const second = await typedFetch(FOREIGN_URL, { fetch: resolving(bad) });
    expect(second.response).toBe(null);
    expect(isNetworkError(second.error)).toBe(true);

    const third = await typedFetch(FOREIGN_URL, { fetch: resolving(good) });
    expect(third.error).toBe(null);
  });

  test("a later call's refusal cannot un-fix the identity an earlier call recorded", async () => {
    // The cross-call half of `stageIdentity`'s rollback. TF-21, TF-22, TF-23 and
    // TF-24 all go refusal FIRST and acceptance second, so they pin that a
    // refused value files nothing. The other order is the dangerous one: a
    // refusal that rolled back a field an EARLIER, ACCEPTED call had fixed would
    // let the same object answer a third call with a different status — the
    // poisoning the tables exist to prevent, reached from the refusal path
    // instead of the acceptance path.
    let statusReads = 0;
    let typeReads = 0;
    const value = foreignResponse();
    Object.defineProperty(value, "status", {
      get(): number {
        statusReads += 1;
        return statusReads > 1 ? 500 : 200;
      },
      configurable: true,
    });
    Object.defineProperty(value, "type", {
      get(): string {
        typeReads += 1;
        return typeReads === 2 ? "bogus" : "basic";
      },
      configurable: true,
    });
    const fetch = resolving(value);

    const first = await typedFetch("https://sticky.test/1", { fetch });
    expect(first.error).toBe(null);

    const refused = await typedFetch("https://sticky.test/2", { fetch });
    expect(isNetworkError(refused.error)).toBe(true);

    // The recorded 200 survived the refusal, so the third call is a success and
    // not the `InternalServerError` the raw getter now reports.
    const third = await typedFetch("https://sticky.test/3", { fetch });
    expect(third.error).toBe(null);
    expect(isHttpError(third.error)).toBe(false);
    // Non-vacuity: the getter really would have answered 500.
    expect(statusReads).toBe(1);
    expect(value.status).toBe(500);
  });

  test("phases 1 and 3 of concurrent calls never interleave", async () => {
    // The structural claim behind every "no cross-call state" answer in this
    // file: `typedFetch`'s setup phase runs synchronously from the call, and its
    // response phase runs synchronously from the transport's resolution. Neither
    // contains an `await`, so no call's reads can appear between two reads of
    // another call.
    //
    // Written as a measurement rather than an argument, because an `await`
    // introduced into either phase by a later change is invisible in review and
    // makes every table in `src/errors/response-identity.ts` racy. The events
    // below are real reads the module performs: the input's `toString` and the
    // options' `signal` getter in phase 1, and `ok`, `redirected` and `type` in
    // phase 3.
    const events: string[] = [];
    const CALLS = 24;

    const call = (id: number): Promise<unknown> => {
      const input = {
        toString(): string {
          events.push(`${id}:setup`);
          return `https://interleave.test/${id}`;
        },
      };
      const value = foreignResponse();
      for (const member of ["ok", "redirected", "type"] as const) {
        const held = value[member];
        Object.defineProperty(value, member, {
          get(): unknown {
            events.push(`${id}:response`);
            return held;
          },
          configurable: true,
        });
      }
      const options = {
        // A different number of awaited turns per call, so a transport that
        // could interleave the response phases would.
        fetch: (async (): Promise<unknown> => {
          for (let turn = 0; turn <= id % 5; turn += 1) await Promise.resolve();
          return value;
        }) as unknown as typeof fetch,
        get signal(): undefined {
          events.push(`${id}:setup`);
          return undefined;
        },
      };
      return typedFetch(input as unknown as string, options);
    };

    const results = await Promise.all(Array.from({ length: CALLS }, (_, id) => call(id)));
    for (const result of results) expect(result).toHaveProperty("error", null);

    // Non-vacuity: every call really did emit both phases.
    expect(events.filter((event) => event.endsWith(":setup"))).toHaveLength(CALLS * 2);
    expect(events.filter((event) => event.endsWith(":response"))).toHaveLength(CALLS * 3);

    // Contiguity, per phase: the runs of one id are never split by another id.
    for (const phase of ["setup", "response"] as const) {
      const ids = events
        .filter((event) => event.endsWith(`:${phase}`))
        .map((event) => event.split(":")[0] ?? "");
      const seen = new Set<string>();
      let previous = "";
      const split: string[] = [];
      for (const id of ids) {
        if (id !== previous && seen.has(id)) split.push(id);
        seen.add(id);
        previous = id;
      }
      expect({ phase, split }).toEqual({ phase, split: [] });
    }
  });
});

// ── 1b. The same call, alone and in a crowd ────────────────────────────────
//
// The direct form of the question. Every outcome class the request path can
// produce is run ALONE and its envelope recorded; then all of them are run
// interleaved, twice over, and each envelope must be the one its scenario
// produced by itself. A call that could observe another's state shows up as a
// scenario whose answer depends on its company.

interface Scenario {
  readonly label: string;
  readonly run: () => Promise<Envelope>;
}

interface Envelope {
  readonly outcome: "success" | "error";
  readonly name: string;
  readonly status: number | null;
  readonly url: string;
  readonly message: string;
}

async function envelopeOf(
  input: unknown,
  options: Record<string, unknown> | null | undefined,
): Promise<Envelope> {
  const result = await typedFetch(input as string, options as never);
  if (result.error === null) {
    await result.response.arrayBuffer();
    return {
      outcome: "success",
      name: "",
      status: result.response.status,
      url: result.response.url,
      message: "",
    };
  }
  const error = result.error;
  const status = isHttpError(error) ? error.status : null;
  if (isHttpError(error)) await error.cancel();
  return { outcome: "error", name: error.name, status, url: error.url, message: error.message };
}

const HANGING = ((_input: unknown, init: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    const signal = init.signal as AbortSignal | null;
    signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
  })) as unknown as typeof fetch;

const scenarios: readonly Scenario[] = [
  {
    label: "a foreign 200",
    run: () => envelopeOf("https://sweep.test/foreign", { fetch: resolving(foreignResponse()) }),
  },
  {
    label: "a platform 200",
    run: () =>
      envelopeOf("https://sweep.test/ok", {
        fetch: resolving(new Response("body", { status: 200 })),
      }),
  },
  {
    label: "a mapped 404",
    run: () =>
      envelopeOf("https://sweep.test/404", {
        fetch: resolving(new Response("gone", { status: 404, statusText: "Not Found" })),
      }),
  },
  {
    label: "an unmapped 419",
    run: () =>
      envelopeOf("https://sweep.test/419", {
        fetch: resolving(new Response(null, { status: 419 })),
      }),
  },
  {
    label: "a resolved non-Response",
    run: () => envelopeOf("https://sweep.test/junk", { fetch: resolving({ status: 200 }) }),
  },
  {
    label: "a rejected transport",
    run: () =>
      envelopeOf("https://sweep.test/reject", {
        fetch: (() => Promise.reject(new TypeError("fetch failed"))) as unknown as typeof fetch,
      }),
  },
  {
    label: "an aborted signal",
    run: () => {
      const controller = new AbortController();
      const promise = envelopeOf("https://sweep.test/abort", {
        fetch: HANGING,
        signal: controller.signal,
      });
      controller.abort();
      return promise;
    },
  },
  {
    label: "an already-fired timeout",
    run: () =>
      envelopeOf("https://sweep.test/timeout", {
        fetch: HANGING,
        signal: AbortSignal.timeout(0),
      }),
  },
  {
    label: "a setup failure: null options",
    run: () => envelopeOf("https://sweep.test/null-options", null),
  },
  {
    label: "a setup failure: an input that cannot be serialized",
    run: () =>
      envelopeOf(
        {
          toString(): string {
            throw new RangeError("no string for you");
          },
        },
        { fetch: resolving(new Response(null, { status: 204 })) },
      ),
  },
];

describe("round 15 / H1 — an envelope does not depend on the calls beside it", () => {
  test("every outcome class answers the same alone and interleaved", async () => {
    const alone: Envelope[] = [];
    for (const scenario of scenarios) alone.push(await scenario.run());

    // Non-vacuity: the population really does span the outcome classes.
    expect(new Set(alone.map((envelope) => envelope.name)).size).toBeGreaterThan(4);
    expect(alone.filter((envelope) => envelope.outcome === "success")).toHaveLength(2);

    for (let round = 0; round < 2; round += 1) {
      const order = scenarios.map((scenario, index) => ({ scenario, index }));
      // A different, deterministic interleaving each round.
      order.sort((a, b) => ((a.index * 7 + round) % 11) - ((b.index * 7 + round) % 11));
      const together = await Promise.all(order.map(({ scenario }) => scenario.run()));

      for (const [position, { scenario, index }] of order.entries()) {
        expect({ label: scenario.label, ...together[position] }).toEqual({
          label: scenario.label,
          ...alone[index],
        });
      }
    }
  });
});

// ── 2. Two calls, one AbortController ──────────────────────────────────────

describe("round 15 / H1 — one signal governing two calls", () => {
  test("both calls end as their own AbortedError with their own url", async () => {
    const controller = new AbortController();
    const transport = ((_input: unknown, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init.signal as AbortSignal;
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      })) as unknown as typeof fetch;

    const first = typedFetch("https://shared.test/first", {
      fetch: transport,
      signal: controller.signal,
    });
    const second = typedFetch("https://shared.test/second", {
      fetch: transport,
      signal: controller.signal,
    });
    await Promise.resolve();
    controller.abort();

    const [a, b] = await Promise.all([first, second]);
    expect(isAbortError(a.error)).toBe(true);
    expect(isAbortError(b.error)).toBe(true);
    expect(a.error).not.toBe(b.error);
    expect(a.error?.url).toBe("https://shared.test/first");
    expect(b.error?.url).toBe("https://shared.test/second");
    expect((a.error as { reason?: unknown }).reason).toBe(controller.signal.reason);
    expect((b.error as { reason?: unknown }).reason).toBe(controller.signal.reason);
  });

  test("a call that already resolved is untouched by a later abort of the shared signal", async () => {
    const controller = new AbortController();
    let pendingReject: ((reason: unknown) => void) | null = null;
    const transport = ((input: unknown) =>
      String(input).endsWith("/fast")
        ? Promise.resolve(new Response("done", { status: 200 }))
        : new Promise<Response>((_resolve, reject) => {
            pendingReject = reject;
          })) as unknown as typeof fetch;

    const slow = typedFetch("https://shared.test/slow", {
      fetch: transport,
      signal: controller.signal,
    });
    const fast = await typedFetch("https://shared.test/fast", {
      fetch: transport,
      signal: controller.signal,
    });

    expect(fast.error).toBe(null);
    controller.abort();
    (pendingReject as unknown as (reason: unknown) => void)(controller.signal.reason);

    const slowResult = await slow;
    expect(isAbortError(slowResult.error)).toBe(true);
    // The resolved call keeps its response and its body, which the abort of a
    // signal it no longer needs cannot take back.
    expect(await fast.response?.text()).toBe("done");
  });

  test("one aborted signal over the ambient transport ends both real requests", async () => {
    const controller = new AbortController();
    const first = typedFetch(`${base}/hang?a`, { signal: controller.signal });
    const second = typedFetch(`${base}/hang?b`, { signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();

    const [a, b] = await Promise.all([first, second]);
    expect(isAbortError(a.error)).toBe(true);
    expect(isAbortError(b.error)).toBe(true);
    expect(a.error?.url).toBe(`${base}/hang?a`);
    expect(b.error?.url).toBe(`${base}/hang?b`);
  });
});

// ── 2b. A deadline and a caller abort on one composed signal ───────────────
//
// The library performs no timeout arithmetic of its own — ADR 0003's
// out-of-scope item 4 says so, and `AbortSignal.timeout()` is the caller's
// tool — so the only question a deadline raises is which class the classifier
// answers with when both authorities exist. `typed-fetch.spec.ts` AXIS 7 pins
// each order with the loser set far away. These two pin the RACE: the loser
// fires while the envelope is already decided, and must not reclassify it.

describe("round 15 / H1 — a deadline that fires after the envelope is decided", () => {
  test("a caller abort that won stays an AbortedError after the deadline passes", async () => {
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20)]);

    const pending = typedFetch("https://race.test/abort-first", {
      fetch: HANGING,
      signal,
    });
    controller.abort();
    const result = await pending;

    expect(isAbortError(result.error)).toBe(true);
    expect(isTimeoutError(result.error)).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(isAbortError(result.error)).toBe(true);
    expect((result.error as { reason?: unknown }).reason).toBe(controller.signal.reason);
  });

  test("a deadline that won stays a TimeoutError after the caller aborts", async () => {
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(5)]);

    const result = await typedFetch("https://race.test/timeout-first", {
      fetch: HANGING,
      signal,
    });

    expect(isTimeoutError(result.error)).toBe(true);
    expect(isAbortError(result.error)).toBe(false);
    controller.abort();
    expect(isTimeoutError(result.error)).toBe(true);
    expect(result.error?.url).toBe("https://race.test/timeout-first");
  });
});

// ── 3. One Response object, two calls ──────────────────────────────────────

describe("round 15 / H1 — one Response resolved to two concurrent calls", () => {
  test("two successes hand back the one object, with one identity", async () => {
    const value = foreignResponse();
    const fetch = resolving(value);

    const [a, b] = await Promise.all([
      typedFetch("https://twice.test/a", { fetch }),
      typedFetch("https://twice.test/b", { fetch }),
    ]);

    expect(a.error).toBe(null);
    expect(b.error).toBe(null);
    expect(a.response).toBe(b.response);
    expect(a.response?.status).toBe(200);
    expect(b.response?.url).toBe(FOREIGN_URL);
  });

  test("two HTTP errors report one identity and settle their shared body", async () => {
    const response = new Response("payload", { status: 404, statusText: "Not Found" });
    const fetch = resolving(response);

    const [a, b] = await Promise.all([
      typedFetch("https://twice.test/a", { fetch }),
      typedFetch("https://twice.test/b", { fetch }),
    ]);

    if (!isHttpError(a.error) || !isHttpError(b.error)) throw new Error("expected HTTP errors");
    expect(a.error).not.toBe(b.error);
    expect(a.error.name).toBe(b.error.name);
    expect([a.error.status, a.error.statusText]).toEqual([404, "Not Found"]);
    expect([b.error.status, b.error.statusText]).toEqual([404, "Not Found"]);

    // One body, two owners. The interface says a body is claimed once; what a
    // caller must be able to rely on is that BOTH handles settle rather than
    // stranding the stream.
    expect(await a.error.text()).toBe("payload");
    await expect(b.error.text()).rejects.toThrow(/single-use/u);
    // `cancel()`'s step 4: the body is consumed, so there is nothing to
    // release and the second owner's handle settles rather than rejecting or
    // hanging. A second owner therefore always has a way to discharge its
    // obligation, whichever order the two callers use.
    await expect(b.error.cancel()).resolves.toBeUndefined();
  });

  test("a refusal in the second call releases the body the first call handed back", async () => {
    // The one cross-call coupling this module has, stated rather than left to
    // be discovered. Phase 3's catch releases the response's body, and the
    // response it releases can be one an EARLIER call already handed to a
    // caller as a success. Reaching it needs a value that answers `type`
    // differently on a second presentation, which ADR 0003 puts permanently out
    // of scope as item 3 ("anything after the handoff"), so this is not a
    // defect — but nothing in the ledger names the mechanism, and a future
    // change that made a refusal path reachable from an honest `Response` would
    // inherit it.
    let presentations = 0;
    const value = foreignResponse({ body: new Response("payload").body });
    Object.defineProperty(value, "type", {
      get(): string {
        presentations += 1;
        // `hasCompatibleSuccessSurface` reads `type` exactly once per call, so
        // the second call is the one that refuses.
        return presentations > 1 ? "bogus" : "basic";
      },
      configurable: true,
    });
    const fetch = resolving(value);

    const accepted = await typedFetch("https://handoff.test/a", { fetch });
    expect(accepted.error).toBe(null);

    const refused = await typedFetch("https://handoff.test/b", { fetch });
    expect(refused.response).toBe(null);
    expect(isNetworkError(refused.error)).toBe(true);

    // The first caller's body is gone: the second call's refusal cancelled the
    // stream, so the reader that caller holds sees a finished stream with none
    // of the bytes the server sent. Silent, not an error.
    const stream = accepted.response?.body as ReadableStream<Uint8Array>;
    expect(stream.locked).toBe(false);
    await expect(stream.getReader().read()).resolves.toEqual({ done: true, value: undefined });
  });
});

// ── 4. A transport that calls typedFetch again ─────────────────────────────

describe("round 15 / H1 — re-entrancy through the init the transport was handed", () => {
  test("the init carries no fetch extension, so re-entering does not recurse", async () => {
    let outerCalls = 0;
    const transport = (async (_input: unknown, init: RequestInit) => {
      outerCalls += 1;
      const inner = await typedFetch(`${base}/echo`, init as never);
      expect(inner.error).toBe(null);
      await inner.response?.text();
      return new Response("outer", { status: 200 });
    }) as unknown as typeof fetch;

    const result = await typedFetch(`${base}/echo`, { fetch: transport, method: "POST" });

    expect(outerCalls).toBe(1);
    expect(result.error).toBe(null);
    expect(await result.response?.text()).toBe("outer");
  });

  test("the governing signal travels with the init into the re-entrant call", async () => {
    const controller = new AbortController();
    let inner: Awaited<ReturnType<typeof typedFetch>> | null = null;
    const transport = (async (_input: unknown, init: RequestInit) => {
      controller.abort();
      inner = await typedFetch(`${base}/hang-inner`, init as never);
      return new Response("outer", { status: 200 });
    }) as unknown as typeof fetch;

    const result = await typedFetch(`${base}/echo`, {
      fetch: transport,
      signal: controller.signal,
    });

    // The outer call succeeds: its transport is caller code, and it resolved a
    // Response. The INNER call is the subject — the init it was handed carried
    // the governing signal, so an aborted controller stopped it before it
    // reached the server.
    expect(result.error).toBe(null);
    const innerResult = inner as unknown as Awaited<ReturnType<typeof typedFetch>>;
    expect(isAbortError(innerResult.error)).toBe(true);
    expect(receivedPaths).not.toContain("/hang-inner");
  });
});

// ── 5. An abort that arrives after the envelope ────────────────────────────

describe("round 15 / H1 — a signal that aborts while the caller reads the body", () => {
  test("a success stays a success and only the body read rejects", async () => {
    const controller = new AbortController();
    const result = await typedFetch(`${base}/drip`, { signal: controller.signal });

    expect(result.error).toBe(null);
    expect(result.response?.status).toBe(200);

    const reading = result.response?.text();
    controller.abort();
    await expect(reading).rejects.toThrow();

    // The envelope was decided before the abort and stays decided.
    expect(result.error).toBe(null);
    expect(result.response?.status).toBe(200);
  });

  test("a fired timeout does not turn a delivered response into a TimeoutError", async () => {
    const result = await typedFetch(`${base}/drip`, { signal: AbortSignal.timeout(60) });

    expect(result.error).toBe(null);
    expect(isTimeoutError(result.error)).toBe(false);

    await expect(result.response?.text()).rejects.toThrow();
    expect(result.error).toBe(null);
  });

  test("an HTTP error's body read rejects on abort and the error keeps its identity", async () => {
    const controller = new AbortController();
    const result = await typedFetch(`${base}/drip500`, { signal: controller.signal });

    if (!isHttpError(result.error)) throw new Error("expected an HTTP error");
    expect(result.error.status).toBe(500);

    const reading = result.error.text();
    controller.abort();
    await expect(reading).rejects.toThrow();

    // The identity the error was built with does not move, and the body handle
    // settles rather than hanging: the read HAD started, so `cancel()` takes its
    // `readStarted` early return. The bytes are gone whatever the rejection
    // said, which is the documented reason a rejected read is not rolled back.
    expect(result.error.status).toBe(500);
    await expect(result.error.cancel()).resolves.toBeUndefined();
  });
});

// ── The server the sections above use ──────────────────────────────────────

const receivedPaths: string[] = [];
let server: http.Server;
let base: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const path = req.url ?? "";
    receivedPaths.push(path);
    req.resume();
    if (path.startsWith("/hang")) return;
    if (path.startsWith("/drip")) {
      res.writeHead(path.startsWith("/drip500") ? 500 : 200, { "content-type": "text/plain" });
      res.write("first-chunk");
      return;
    }
    req.on("end", () => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, () => resolve()));
  base = `http://localhost:${(server.address() as { port: number }).port}`;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});
