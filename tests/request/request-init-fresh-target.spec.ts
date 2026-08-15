import http from "node:http";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { isAbortError, typedFetch } from "../../src/index";
import type { TypedFetchOptions } from "../../src/index";
import { planRequest } from "../../src/request-plan";

// Round 21, lane H1 — the request path, aimed at what round 20 CHANGED.
//
// Round 20 deleted every predicate over the caller's object. `snapshotRequestInit`
// keeps the caller's object as the proxy target only when
// `!removeFetchOverride && signal === undefined`; every other call builds a
// FRESH target:
//
//     const descriptors = Object.getOwnPropertyDescriptors(options);
//     if (removeFetchOverride) delete descriptors.fetch;
//     if (descriptors.signal || signal !== undefined) { … }
//     Object.create(Object.getPrototypeOf(options), descriptors)
//
// and the module's comment says that target is "a fresh target the caller
// cannot reach" whose entry "no later read can invalidate".
//
// Section A puts the claim under a corpus of fifteen options shapes — the three
// that rounds 18, 19 and 20 each got wrong, plus a caller-chosen prototype the
// fresh target inherits, a `signal` accessor, a sibling that mutates the object
// while the spread runs, a callable options object, and the two well-known
// symbols a spread might have consulted. Section B drives the same fifteen end
// to end through a forwarding transport against a live `node:http` server, and
// asserts what the TRANSPORT received by whether the server finished writing.
// Both hold on every shape. That is the evidence behind the frontier verdict on
// the fresh-target claim.
//
// Section C is the finding, and it is the one read the fresh target does NOT
// remove: `descriptors` is an ordinary object, so `descriptors.signal` walks
// `Object.prototype`.
//
// Section D asks the no-signal branch the questions rounds 18, 19 and 20 only
// asked the signal branch. Section E states the invariant's domain executably.
// Both pass.

const ABSOLUTE = "https://round21.test/resource";

// ── A control server, so "the request was governed" has an observable ──────

interface ControlServer {
  url(tag: string): string;
  finished(): readonly string[];
}

/**
 * An HTTP server that reports whether it FINISHED writing a response.
 *
 * A cancelled response clears its own timer, so a tag reaching
 * {@link ControlServer.finished} means the request ran to completion — the
 * observable that separates a governed request from an ungoverned one.
 */
function useControlServer(): ControlServer {
  let base = "";
  let server: http.Server;
  const finished: string[] = [];

  beforeAll(async () => {
    server = http.createServer((request, response) => {
      const parsed = new URL(request.url ?? "/", "http://control.invalid");
      const tag = parsed.searchParams.get("tag") ?? "";
      const timer = setTimeout(() => {
        response.writeHead(200, { "Content-Type": "text/plain" });
        response.end("done");
        finished.push(tag);
      }, 400);
      response.on("close", () => clearTimeout(timer));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("no address");
    base = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  return {
    url: (tag) => `${base}/?tag=${encodeURIComponent(tag)}`,
    finished: () => finished,
  };
}

/**
 * Run `body` with one polluted `Object.prototype` key, and remove it again.
 *
 * The window is SYNCHRONOUS on purpose. Leaving a polluted `Object.prototype`
 * across an `await` breaks the test runner rather than the subject, and
 * `planRequest` is synchronous, so nothing needs the wider window.
 */
function underPollution<T>(key: string, value: unknown, body: () => T): T {
  Object.defineProperty(Object.prototype, key, {
    value,
    writable: true,
    enumerable: false,
    configurable: true,
  });
  try {
    return body();
  } finally {
    delete (Object.prototype as Record<string, unknown>)[key];
  }
}

// ── Section A — the fresh-target claim, under a corpus ─────────────────────

interface Shape {
  readonly name: string;
  readonly make: (signal: AbortSignal) => TypedFetchOptions;
}

const CORPUS: readonly Shape[] = [
  { name: "own enumerable signal", make: (s) => ({ signal: s }) },
  {
    name: "own non-enumerable signal, R18-H1-01's shape",
    make: (s) => {
      const options: Record<string, unknown> = {};
      Object.defineProperty(options, "signal", { value: s, writable: true, configurable: true });
      return options as TypedFetchOptions;
    },
  },
  { name: "inherited signal", make: (s) => Object.create({ signal: s }) as TypedFetchOptions },
  {
    name: "a signal accessor, whose getter runs during the plan",
    make: (s) => ({
      get signal() {
        return s;
      },
    }),
  },
  {
    name: "a caller-chosen prototype the fresh target inherits",
    make: (s) => {
      const hostile = Object.create(null) as Record<string, unknown>;
      Object.defineProperty(hostile, "signal", { enumerable: true, get: () => undefined });
      const options = Object.create(hostile) as Record<string, unknown>;
      Object.defineProperty(options, "signal", {
        value: s,
        writable: true,
        enumerable: true,
        configurable: true,
      });
      return options as TypedFetchOptions;
    },
  },
  { name: "frozen options", make: (s) => Object.freeze({ method: "POST", signal: s }) },
  {
    name: "null-prototype options",
    make: (s) => {
      const options = Object.create(null) as Record<string, unknown>;
      options.signal = s;
      return options as TypedFetchOptions;
    },
  },
  {
    name: "a proxy whose ownKeys omits signal, R19-H1-01's shape",
    make: (s) =>
      new Proxy({ signal: s, method: "POST" } as Record<string, unknown>, {
        ownKeys: () => ["method"],
      }) as TypedFetchOptions,
  },
  {
    name: "a proxy with an enumerable descriptor and an empty ownKeys",
    make: (s) =>
      new Proxy({ signal: s } as Record<string, unknown>, {
        ownKeys: () => [],
      }) as TypedFetchOptions,
  },
  {
    name: "a sibling accessor that hides signal while the spread runs",
    make: (s) => {
      const options: Record<string, unknown> = { signal: s };
      Object.defineProperty(options, "method", {
        enumerable: true,
        configurable: true,
        get() {
          Object.defineProperty(options, "signal", {
            value: s,
            enumerable: false,
            writable: true,
            configurable: true,
          });
          return "POST";
        },
      });
      return options as TypedFetchOptions;
    },
  },
  {
    name: "signal beside an own fetch override",
    make: (s) => ({ signal: s, fetch: globalThis.fetch }),
  },
  {
    name: "a callable options object",
    make: (s) => Object.assign(() => undefined, { signal: s }) as unknown as TypedFetchOptions,
  },
  {
    name: "signal beside Symbol.iterator",
    make: (s) => ({ signal: s, [Symbol.iterator]: () => undefined }) as TypedFetchOptions,
  },
  {
    name: "signal beside Symbol.toPrimitive",
    make: (s) => ({ signal: s, [Symbol.toPrimitive]: () => "x" }) as TypedFetchOptions,
  },
  {
    name: "a sibling getter that deletes a key mid-spread",
    make: (s) => {
      const options: Record<string, unknown> = { signal: s, method: "POST" };
      Object.defineProperty(options, "body", {
        enumerable: true,
        configurable: true,
        get() {
          delete options.method;
          return null;
        },
      });
      return options as TypedFetchOptions;
    },
  },
];

const CASES = CORPUS.map((shape) => [shape.name, shape] as const);

describe("the fresh target, under a corpus", () => {
  test.each(CASES)(
    "%s: the init reports the signal, and a spread of the init carries it",
    (_name, shape) => {
      const controller = new AbortController();
      const plan = planRequest(ABSOLUTE, shape.make(controller.signal));

      expect(plan.signal).toBe(controller.signal);
      expect(plan.init.signal).toBe(controller.signal);
      expect({ ...plan.init }.signal).toBe(controller.signal);
    },
  );
});

// ── Section B — the same corpus, end to end over a socket ──────────────────
//
// The plan-level assertion above reads the init. This one never reads it: the
// transport spreads what it was handed, the caller aborts, and the SERVER says
// whether the request it received was governed.

describe("the corpus, through a forwarding transport", () => {
  const server = useControlServer();

  test.each(CASES)("%s: the caller's abort reaches the socket", async (_name, shape) => {
    const native = globalThis.fetch;
    // A forwarding transport that rebuilds its init with a spread — the shape
    // rounds 18, 19 and 20 all used, installed as the global so that every
    // corpus shape reaches it, including the ones no key can be added to.
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
      native(input, { ...init })) as typeof fetch;

    const controller = new AbortController();
    const tag = `corpus-${CORPUS.findIndex((entry) => entry === shape)}`;
    try {
      const pending = typedFetch(server.url(tag), shape.make(controller.signal));
      setTimeout(() => controller.abort(), 60);
      const { response, error } = await pending;

      expect(response).toBeNull();
      expect(isAbortError(error)).toBe(true);
    } finally {
      globalThis.fetch = native;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(server.finished()).not.toContain(tag);
  });
});

// ── Section C — R21-H1-02 ──────────────────────────────────────────────────
//
// `Object.getOwnPropertyDescriptors` returns an ordinary object, so
// `descriptors.signal` is a prototype-chain read of `Object.prototype`, and it
// is what decides whether the branch materializes an entry at all. This module
// already states the rule that forbids that, for the sibling slot one line
// above the read:
//
//   "OWN property only. `fetch` is this library's own extension … reading it
//    off the prototype chain turns a single `Object.prototype.fetch = ...`
//    write anywhere in the process into a redirect of every request"
//
// and `snapshotRequestInit`'s own comment states the invariant the unguarded
// read breaks:
//
//   "Writing it unconditionally invented an own key: `Object.keys(init)` and
//    `Reflect.ownKeys(init)` listed `signal` while `"signal" in init` —
//    answered from the original object by the `has` trap — said `false`, and
//    `{ ...init }` grew a `signal: undefined` member the caller never wrote."
//
// A NULL-PROTOTYPE options object is what separates the two reads, and it is
// the shape a caller who is already defending against prototype pollution
// writes. `Reflect.has(options, "signal")` cannot see `Object.prototype`;
// `descriptors.signal` can.

describe("the descriptor bag is read through Object.prototype", () => {
  function pollutedPlan() {
    const options = Object.create(null) as Record<string, unknown>;
    options.fetch = (() => Promise.resolve(new Response("ok"))) as unknown as typeof fetch;
    return underPollution("signal", { enumerable: true }, () =>
      planRequest(ABSOLUTE, options as TypedFetchOptions),
    );
  }

  test("R21-H1-02: the init grows a signal member the caller never wrote", () => {
    const plan = pollutedPlan();

    expect(Object.keys(plan.init)).not.toContain("signal");
    expect(Reflect.ownKeys(plan.init)).not.toContain("signal");
    expect({ ...plan.init }).not.toHaveProperty("signal");
  });

  test("R21-H1-02: two own-shape reads disagree about one key", () => {
    const plan = pollutedPlan();

    // `in` is answered from the caller's object by the `has` trap, and that
    // object has no prototype. `Object.keys` is answered from the clone, whose
    // key set a polluted `Object.prototype` decided.
    expect(Object.keys(plan.init).includes("signal")).toBe("signal" in plan.init);
  });

  test("R21-H1-02: the same write does not reach the fast path", () => {
    // The control. With no own `fetch` and no signal the caller's object stays
    // the target, no descriptor bag is built, and the key is not invented — so
    // the two branches disagree about one polluted process.
    const options = Object.create(null) as Record<string, unknown>;
    const plan = underPollution("signal", { enumerable: true }, () =>
      planRequest(ABSOLUTE, options as TypedFetchOptions),
    );

    expect(Object.keys(plan.init)).not.toContain("signal");
  });
});

// ── Section D — the branch nobody attacked ─────────────────────────────────
//
// Rounds 18, 19 and 20 all lived on the signal side. The fast path still hands
// the caller's own object to the transport as a proxy TARGET, with only a `get`
// trap, so `ownKeys`, `getOwnPropertyDescriptor`, `has`, `set` and
// `defineProperty` all reach the caller's live object. These are the answer to
// "what can a caller change between the plan and the send", and they pass.

describe("the no-signal branch, asked the signal branch's questions", () => {
  test("a signal written after the plan reaches neither the init nor a spread of it", () => {
    const options: Record<string, unknown> = { method: "POST" };
    const plan = planRequest(ABSOLUTE, options as TypedFetchOptions);

    const controller = new AbortController();
    options.signal = controller.signal;

    expect(plan.signal).toBeUndefined();
    expect(plan.init.signal).toBeUndefined();
    expect({ ...plan.init }.signal).toBeUndefined();
  });

  test("a signal a sibling getter writes while the transport reads the init is not carried", () => {
    const controller = new AbortController();
    const options: Record<string, unknown> = {};
    Object.defineProperty(options, "method", {
      enumerable: true,
      configurable: true,
      get() {
        options.signal = controller.signal;
        return "POST";
      },
    });

    const plan = planRequest(ABSOLUTE, options as TypedFetchOptions);
    // A WebIDL dictionary reads `method` before `signal`, so this is the
    // ordering a real transport produces.
    expect(plan.init.method).toBe("POST");
    expect(plan.init.signal).toBeUndefined();
    expect({ ...plan.init }.signal).toBeUndefined();
    expect(plan.signal).toBeUndefined();
  });

  test("the key set is live on the fast path and frozen on the other one", () => {
    const bare: Record<string, unknown> = {};
    const barePlan = planRequest(ABSOLUTE, bare as TypedFetchOptions);
    bare.method = "PATCH";
    expect(Object.keys(barePlan.init)).toEqual(["method"]);

    const controller = new AbortController();
    const carried: Record<string, unknown> = { signal: controller.signal };
    const carriedPlan = planRequest(ABSOLUTE, carried as TypedFetchOptions);
    carried.method = "PATCH";
    expect(Object.keys(carriedPlan.init)).toEqual(["signal"]);
  });

  test("a fetch key added after the plan is not a transport this call selected", () => {
    const options: Record<string, unknown> = {};
    const plan = planRequest(ABSOLUTE, options as TypedFetchOptions);
    options.fetch = (() => Promise.resolve(new Response("late"))) as unknown as typeof fetch;

    expect(plan.transport).toBe(globalThis.fetch);
    expect(plan.ambientTransport).toBe(true);
  });
});

// ── Section E — the invariant's domain ─────────────────────────────────────
//
// Round 20 established `plan.signal !== undefined` implies
// `{ ...plan.init }.signal === plan.signal`, and that it is false for a
// handed-over `Request`. The domain is the DISJUNCTION stated below, and the
// second arm is what makes the exception harmless: the value that contributed
// the signal is the value the transport receives.

describe("the invariant's domain, stated executably", () => {
  function holds(plan: ReturnType<typeof planRequest>): boolean {
    if (plan.signal === undefined) return true;
    if ({ ...plan.init }.signal === plan.signal) return true;
    const handed = plan.transportInput as { readonly signal?: unknown };
    return typeof handed === "object" && handed !== null && handed.signal === plan.signal;
  }

  test("an init-borne signal takes the first arm", () => {
    const controller = new AbortController();
    const plan = planRequest(ABSOLUTE, { signal: controller.signal });

    expect({ ...plan.init }.signal).toBe(plan.signal);
    expect(holds(plan)).toBe(true);
  });

  test("a handed-over Request takes the second arm under the ambient transport", () => {
    const controller = new AbortController();
    const request = new Request(ABSOLUTE, { signal: controller.signal });
    const plan = planRequest(request, {});

    expect(plan.signal).toBe(request.signal);
    expect({ ...plan.init }.signal).toBeUndefined();
    expect(plan.transportInput).toBe(request);
    expect(holds(plan)).toBe(true);
  });

  test("a handed-over Request takes the second arm under a forwarding transport too", () => {
    const controller = new AbortController();
    const request = new Request(ABSOLUTE, { signal: controller.signal });
    const plan = planRequest(request, {
      fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
        globalThis.fetch(input, { ...init })) as typeof fetch,
    });

    expect(plan.signal).toBe(request.signal);
    expect({ ...plan.init }.signal).toBeUndefined();
    expect(plan.transportInput).toBe(request);
    expect(holds(plan)).toBe(true);
  });

  test("an own signal that shadows the slot cannot take the second arm away", () => {
    const real = new AbortController();
    const decoy = new AbortController();
    const request = new Request(ABSOLUTE, { signal: real.signal });
    const slot = request.signal;
    Object.defineProperty(request, "signal", { value: decoy.signal, configurable: true });

    const plan = planRequest(request, {});

    expect(plan.signal).toBe(slot);
    expect(plan.signal).not.toBe(decoy.signal);
  });

  test("an explicit null in the init detaches the Request's signal on both sides", () => {
    const controller = new AbortController();
    const request = new Request(ABSOLUTE, { signal: controller.signal });
    const plan = planRequest(request, { signal: null });

    expect(plan.signal).toBeUndefined();
    expect({ ...plan.init }.signal).toBeNull();
    expect(holds(plan)).toBe(true);
  });
});
