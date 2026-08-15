import http from "node:http";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { isAbortError, typedFetch } from "../../src/index";
import type { TypedFetchOptions } from "../../src/index";
import { planRequest } from "../../src/request-plan";
import type { RequestPlan } from "../../src/request-plan";

// Round 22, lane H1 — the request path, aimed at the DESCRIPTOR BAG.
//
// ## What this round measured before it wrote anything
//
// Rounds 19, 20 and 21 each found a defect in one condition of
// `snapshotRequestInit`, and round 21 then measured what the suite could see of
// them: it re-ran every pin in `tests/request/**` and `tests/envelope/**`
// against the implementation round 20 refuted, and 494 of 497 passed.
//
// Round 22 reproduced that sweep against all THREE refuted implementations —
// the pre-round-19 predicate (`Object.hasOwn(options, "signal")`), the
// pre-round-20 one (the caller's descriptor enumerability), and the
// pre-round-21 one (the bag read through `Object.prototype`) — and then
// instrumented HEAD, so that every call to `snapshotRequestInit` records, per
// pin, the DECISION each refuted implementation would have reached and the
// own-key SHAPE that decision produces. Over the 495 executed pins:
//
//   | refuted implementation | decision differs | init shape differs | pin fails |
//   | pre-round-19           |               91 |                 12 |        13 |
//   | pre-round-20           |               90 |                  9 |        10 |
//   | pre-round-21           |                2 |                  2 |         2 |
//
// "The init shape differs AND the pin passes" is ZERO in all three columns. The
// extra failure in the first two columns is the single pin that catches the
// fast path's LIVENESS, which a plan-time shape read cannot see.
//
// So the blindness is not in what the pins ASSERT. It is in what they DRAW:
// 404, 405 and 493 pins respectively never put the refuted implementation on a
// different branch at all, and the 78 and 80 that did put it on a branch that
// produces an identical init for the options object they wrote. Every pin that
// ever built a different init reported it.
//
// Section A is the answer to that: ONE property, two clauses, over three
// shapes, each shape chosen because it separates one refuted implementation
// from the next — and the third shape alone fails all three of them.
//
// ## The residue this round hunted, measured, and did NOT report
//
// Round 21 guarded the descriptor bag's READ with `Object.hasOwn`. The WRITE
// one line below it — `descriptors.signal = { … }` — is a plain assignment, so
// it still consults `Object.prototype` for a setter before it creates an own
// property, and the bag owns no `signal` on exactly the calls that guard was
// written for: an INHERITED signal, the `Object.create(defaults)` shape
// R18-H1-01 and R19-H1-01 were both written about. Two pollution flavours reach
// it. A `signal` ACCESSOR on `Object.prototype` swallows the entry, so the
// fresh target carries none and a forwarding transport's spread is ungoverned.
// A NON-WRITABLE `signal` there makes the strict-mode assignment throw, so the
// plan refuses a request nothing is wrong with.
//
// Neither is reported, and the reason is measurement rather than an argument.
// The bare `fetch` call this library wraps was driven against a live
// `node:http` server on the same options object in all four flavours of that
// pollution, and it fails at least as badly in every one: it throws
// `TypeError: Cannot assign to read only property 'signal'` for the
// non-writable one and `Cannot set property signal … which has only a getter`
// for a getter, and under a getter-with-setter it runs UNGOVERNED while
// ignoring even an OWN `signal`. It never once carried the caller's signal
// where this library dropped it. ADR 0003 obliges this module to out-guard a
// polluted prototype only where the platform reads nothing at all, which is row
// H-22's `fetch` extension, not the `signal` slot WebIDL reads itself.
//
// That differential is deliberately NOT pinned here: the platform's own answer
// for one flavour moved between runs in the same process, so any assertion over
// it is a flake rather than a guard. A defect that exists only against an
// unstable baseline is not a defect.

const ABSOLUTE = "https://round22.test/resource";

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
 * Run `body` with one `Object.prototype` key declared by `descriptor`, and
 * remove it again.
 *
 * The window is SYNCHRONOUS on purpose, exactly as round 21's helper is.
 * `planRequest` is synchronous, and so is everything `typedFetch` does before
 * its first `await` — the transport call, the ambient transport's own init
 * prologue, and the `{ ...init }` a forwarding transport writes. Nothing needs
 * a wider window, and leaving a polluted `Object.prototype` across an `await`
 * breaks the test runner rather than the subject.
 */
function underPollution<T>(key: string, descriptor: PropertyDescriptor, body: () => T): T {
  Object.defineProperty(Object.prototype, key, { configurable: true, ...descriptor });
  try {
    return body();
  } finally {
    delete (Object.prototype as Record<string, unknown>)[key];
  }
}

// ── Section A — THE PIN ────────────────────────────────────────────────────
//
// One property, stated once, over the three shapes that separate the three
// refuted implementations. Two clauses, and neither covers the other:
//
//   CUSTODY      — a signal the init REPORTS is a signal a spread of the init
//                  CARRIES. `{ ...init }` is what a forwarding transport
//                  writes, and it is the only reader the materialized entry
//                  exists for. Rounds 19 and 20 each broke this clause.
//   NO INVENTION — the init OWNS a `signal` entry only where the caller's own
//                  object answers for one, or a signal governs the call. An
//                  implementation is entitled to reflect over its init, and a
//                  key the caller never wrote is a lie told to that reader.
//                  Round 21 broke this clause.
//
// The two clauses are asserted TOGETHER, on every shape. That is exactly what
// the three rounds could not do: each of them asserted the clause its own
// defect broke, on the shape its own defect lived in, so each new pin was blind
// to the next defect before it was written.

/** Every clause of the property this plan breaks, named. Empty means it holds. */
function disagreements(plan: RequestPlan, options: object): readonly string[] {
  const broken: string[] = [];

  const reported: unknown = (plan.init as { signal?: unknown }).signal;
  const owns = Reflect.ownKeys(plan.init).includes("signal");
  const spread = { ...plan.init } as { signal?: unknown };

  if (reported !== undefined && reported !== null && spread.signal !== reported) {
    broken.push("custody: the init reports a signal that a spread of the init does not carry");
  }
  if (owns && !("signal" in options) && reported === undefined) {
    broken.push("invention: the init owns a signal entry the caller never wrote");
  }
  return broken;
}

interface Shape {
  readonly name: string;
  /** Built inside the pollution window, when the shape needs one. */
  readonly make: (signal: AbortSignal) => TypedFetchOptions;
  /** The `Object.prototype` key this shape needs, if any. */
  readonly pollute?: readonly [string, PropertyDescriptor];
  /** Whether the shape hands the call a signal at all. */
  readonly carriesSignal: boolean;
}

const SEPARATORS: readonly Shape[] = [
  {
    // PRE-ROUND-19 asked `Object.hasOwn(options, "signal")` and kept the
    // caller's object as the proxy target whenever the slot was owned, so a
    // spread of that target carried nothing at all.
    name: "an own non-enumerable signal",
    carriesSignal: true,
    make: (signal) => {
      const options: Record<string, unknown> = {};
      Object.defineProperty(options, "signal", {
        value: signal,
        writable: true,
        configurable: true,
      });
      return options as TypedFetchOptions;
    },
  },
  {
    // PRE-ROUND-20 asked the caller's descriptor for its enumerability. A Proxy
    // may legally report an enumerable descriptor for a key its `ownKeys`
    // omits, so the fast path was taken for an object no spread can carry a
    // signal out of.
    name: "a proxy whose ownKeys omits an enumerable signal",
    carriesSignal: true,
    make: (signal) =>
      new Proxy({ signal, method: "POST" } as Record<string, unknown>, {
        ownKeys: () => ["method"],
      }) as TypedFetchOptions,
  },
  {
    // PRE-ROUND-21 read the bag through `Object.prototype`. A null-prototype
    // options object — what a caller already defending against pollution
    // writes — separates that read from every read of the caller's own object.
    // THIS SHAPE ALONE FAILS ALL THREE refuted implementations: each of them
    // writes an entry here, and each writes it for a key `"signal" in init`
    // answers `false` for.
    name: "a null-prototype options object under a polluted Object.prototype.signal",
    carriesSignal: false,
    pollute: ["signal", { value: { enumerable: true }, writable: true, enumerable: false }],
    make: () => {
      const options = Object.create(null) as Record<string, unknown>;
      options.fetch = (() => Promise.resolve(new Response("ok"))) as unknown as typeof fetch;
      return options as TypedFetchOptions;
    },
  },
];

const SEPARATOR_CASES = SEPARATORS.map((shape) => [shape.name, shape] as const);

describe("one property, over the shapes that separate three rounds", () => {
  test.each(SEPARATOR_CASES)("%s: no read of the init contradicts another", (_name, shape) => {
    const controller = new AbortController();
    const run = (): readonly string[] => {
      const options = shape.make(controller.signal);
      return disagreements(planRequest(ABSOLUTE, options), options);
    };

    const broken = shape.pollute ? underPollution(shape.pollute[0], shape.pollute[1], run) : run();

    expect(broken).toEqual([]);
  });
});

// ── Section A, end to end ──────────────────────────────────────────────────
//
// The property above reads the init. These never read it: the transport spreads
// what it was handed, and the SERVER says whether the request it received was
// governed.

describe("the same property, through a forwarding transport", () => {
  const server = useControlServer();

  const CARRIERS = SEPARATOR_CASES.filter(([, shape]) => shape.carriesSignal);

  test.each(CARRIERS)(
    "%s: the caller's abort reaches the socket",
    async (_name, shape) => {
      const native = globalThis.fetch;
      // Installed as the GLOBAL, so a shape that owns no `fetch` key still
      // reaches a transport that rebuilds its init with a spread.
      globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
        native(input, { ...init })) as typeof fetch;

      const controller = new AbortController();
      const tag = `sep-${SEPARATORS.findIndex((entry) => entry === shape)}`;
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
    },
    10_000,
  );

  test("the transport's own spread carries no member the caller never wrote", () => {
    // The third shape's harm is what the TRANSPORT sees, so the transport is
    // what reports it. The whole window is synchronous: the plan, the transport
    // call, and the spread inside it.
    const seen: string[][] = [];
    // Built OUTSIDE the window, so nothing the transport returns is itself
    // constructed under a polluted prototype.
    const delivered = new Response("ok");
    const options = underPollution(
      "signal",
      { value: { enumerable: true }, writable: true, enumerable: false },
      () => {
        const built = Object.create(null) as Record<string, unknown>;
        built.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
          seen.push(Object.keys({ ...init }));
          return Promise.resolve(delivered);
        }) as unknown as typeof fetch;
        void typedFetch(ABSOLUTE, built as TypedFetchOptions);
        return built;
      },
    );

    expect("signal" in options).toBe(false);
    expect(seen).toEqual([[]]);
  });
});
