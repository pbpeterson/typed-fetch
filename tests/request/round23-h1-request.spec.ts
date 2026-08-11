import http from "node:http";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { typedFetch } from "../../src/index";
import type { TypedFetchOptions } from "../../src/index";
import { planRequest } from "../../src/request-plan";
import type { RequestPlan } from "../../src/request-plan";

// Round 23, lane H1 — the request path, aimed at the INPUT SPACE.
//
// ## Why the corpus, and not the assertions
//
// Round 22 proved the suite's blindness in this lane is a CORPUS gap: over 495
// executed pins, the three ways a pin can build a different init and stay green
// all measured ZERO, while 404, 405 and 493 pins never put the refuted
// implementation on a different branch at all. So round 23 measured the input
// space directly.
//
// ## The census
//
// `snapshotRequestInit` was instrumented on HEAD, in a detached worktree, to
// record the caller's options object on every call the whole suite makes.
// 7,882 calls, from 43 spec files. Per axis:
//
//   typeof              object 7,880 · function 2
//   Proxy               217 · ordinary 7,665
//   prototype           Object.prototype 6,719 · other 949 · null 209 · 4 bare
//   extensibility       non-extensible 700 · sealed 636 · frozen 388
//   own key types       symbol-keyed 7 · ownKeys throws 3
//   own `signal`        absent 6,620 · data 837 · accessor 425
//   inherited-only      105, EVERY ONE of them carrying a real signal
//   ownKeys omits an own `signal` while the descriptor reports one: 10, EVERY
//                       ONE of them carrying a real signal
//   `Object.prototype.signal` polluted at call time: 432
//   branch              fast 336 · descriptor 7,546
//
// ## The decision the module actually makes, as a truth table
//
// The entry written at `descriptors.signal` is decided by exactly three facts:
// the BRANCH, what the descriptor BAG owns at `signal` (absent, a data
// descriptor, or an accessor) and its enumerability, and whether a signal has
// to be carried. That is 15 reachable cells — the fast branch is only taken
// when no signal is carried, which removes 5. THIRTEEN are drawn:
//
//   | branch     | bag       | enumerable | signal carried | calls |
//   | descriptor | absent    |          - | no             | 6,218 |
//   | descriptor | data      |        yes | yes            |   555 |
//   | descriptor | accessor  |        yes | yes            |   309 |
//   | fast       | absent    |          - | no             |   294 |
//   | descriptor | data      |         no | yes            |   178 |
//   | descriptor | absent    |          - | yes            |   119 |
//   | descriptor | accessor  |         no | yes            |    86 |
//   | descriptor | data      |        yes | no             |    51 |
//   | fast       | data      |        yes | no             |    39 |
//   | descriptor | accessor  |        yes | no             |    28 |
//   | fast       | accessor  |        yes | no             |     2 |
//   | fast       | data      |         no | no             |     1 |
//   | descriptor | data      |         no | no             |     1 |
//
// TWO cells are never drawn — an own NON-ENUMERABLE `signal` ACCESSOR with no
// signal to carry, on either branch. And two more hang on a single call each:
// the two "data, non-enumerable, no signal" rows, the second of which is drawn
// by exactly one test in one file.
//
// One axis is orthogonal to that table and is drawn on ONE side only. A bag
// that omits `signal` while the caller's object reports one — the `Proxy` the
// module's own comment names when it says "The BAG is what is asked, never the
// caller's object" — appears 10 times, and all 10 carry a real signal. With NO
// signal to carry, which is the only configuration where asking the bag and
// asking the caller's object differ in the ANSWER, it is drawn ZERO times.
//
// ## The fourth wrong implementation
//
// Round 22's pin fails all three refuted `snapshotRequestInit` bodies. It does
// NOT fail a fourth: dropping both conditions from
//
//     enumerable: ownSignal?.enumerable === true || signal !== undefined,
//
// and writing `enumerable: true`. Measured: applied to HEAD in a worktree, that
// edit fails exactly ONE test in the whole suite —
// `round20-h1-request.spec.ts`, "R20-H1-02: the fetch-option branch invents a
// spread member the other branch does not" — and that test is the sole occupant
// of a cell one call in 7,882 reaches. Round 22's two clauses are both silent
// on it: the init reports no signal, so CUSTODY cannot fire, and the caller DID
// write the slot, so `"signal" in options` is true and NO INVENTION cannot fire
// either.
//
// A fifth is silent for the same reason, and it is worse: reading the caller's
// object where HEAD reads the bag —
//
//     Object.hasOwn(options, "signal")
//       ? Object.getOwnPropertyDescriptor(options, "signal")
//       : undefined
//
// — which is the read the module's comment refuses in prose and nothing
// refuses executably. It invents an own enumerable `signal` on the init while
// `Reflect.ownKeys(options)` omits the name and a spread of the caller's own
// object carries none, which is R21-H1-02's harm reached from the other side.
// Measured: applied to HEAD, it fails ZERO pins in `tests/request/**` and
// `tests/envelope/**`. `"signal" in options` answers true throughout, because
// the caller's `has` is not its `ownKeys`.
//
// Section A is the answer to both. NO INVENTION is restated over the caller's
// own-KEY LIST instead of the `in` operator, which is strictly stronger, and a
// fourth clause — PARITY — states the enumerability decision as a property
// rather than as a condition. Section C proves neither clause is decoration by
// running both properties against the two wrong inits and showing round 22's
// pair stays silent where this one does not.
//
// Measured against SIX implementations applied to HEAD, this file failing:
//
//   | pre-round-19, own-ness decides the branch          | 2 |
//   | pre-round-20, descriptor enumerability decides it  | 1 |
//   | pre-round-21, the bag read through Object.prototype| 1 |
//   | the enumerability copy dropped                     | 3 |
//   | THE FOURTH, `enumerable: true`                     | 2 |
//   | THE FIFTH, the caller's object read for the bag    | 1 |
//
// and zero on HEAD. The first three are round 22's, so this pin inherits its
// power rather than replacing it.
//
// ## The liveness axis, measured
//
// What can change between `planRequest` returning and the transport reading the
// init, and what still treats the caller's object as stable? Everything the
// plan carries except `init` is captured by value. `init` is not, and the two
// branches answer differently: with a late own `fetch` on the caller's object,
// the DESCRIPTOR branch reports it through none of the three shape reads and
// the FAST branch reports it through all three, because there the caller's
// object IS the proxy target and `get` is the only trap.
//
// That is NOT filed. Round 21 already pinned the fast path's key set as LIVE on
// purpose ("the key set is live on the fast path and frozen on the other one"),
// and pinned a late `fetch` as not selecting a transport while deliberately
// asserting nothing about the init's shape. Measured consequence: the re-entry
// a spread of such an init produces terminates at depth 1, because the spread
// copy owns `fetch` and therefore takes the stripping branch. The residual is
// that the module docblock's three-shape-reads sentence carries no time
// qualifier. Section D pins the half that IS a guarantee — the descriptor
// branch's immunity — which nothing pinned before.
//
// ## The write one line under round 21's `Object.hasOwn`, decided
//
// `descriptors.signal = { … }` still consults `Object.prototype` for a setter,
// on exactly the calls the round-21 guard was written for. Reachability
// measured: a `signal` SETTER on `Object.prototype` swallows the entry once and
// the init then owns no `signal` at all, for the `Object.create({ signal })`
// shape with an own `fetch` — 119 of 7,882 calls sit in that cell.
//
// It is CLOSED, on a measurement round 22 could not stabilize. Section E drives
// all four pollution flavours against a live server, through a forwarding
// transport, with a real abort — and against the bare platform `fetch` on the
// identical object. The two agree in all four, three runs of three: both
// governed under a writable data property, both refusing under a non-writable
// one and under a getter, and both running UNGOVERNED under a getter with a
// setter. There is no differential to file, and Section E is the sentinel that
// reports the day one appears.
//
// The frontier's premise is corrected while it is closed:
// `Object.defineProperty` is NOT free. Over 200,000 iterations the assignment
// costs 3.2 ms and the definition 183.0 ms — about 0.9 µs per entry-writing
// call, on the 1,328 of 7,882 calls that write one.

const ABSOLUTE = "https://round23.test/resource";

// ── The property ───────────────────────────────────────────────────────────
//
// Four clauses. Two are round 22's, restated; two are new. None covers another.
//
//   CUSTODY      — a signal the init REPORTS is a signal a spread of the init
//                  CARRIES. Round 22's clause, unchanged.
//   NO INVENTION — the init owns a `signal` entry only where the caller's own
//                  KEY LIST carries the name, or a signal governs the call.
//                  Round 22 asked this with `"signal" in options`, which a
//                  prototype and a `has` trap both answer; `Reflect.ownKeys` is
//                  the list the bag is built from and the list a spread reads.
//   PARITY       — with no signal to carry, the entry stands in for the
//                  caller's own slot and nothing else, so a spread of the init
//                  carries the name exactly when a spread of the caller's own
//                  object does.
//   STABILITY    — the value the init reports for `signal` is the value it
//                  reported when the plan was built.

/** Every clause of the property this init breaks, named. Empty means it holds. */
function disagreements(init: RequestInit, options: object): readonly string[] {
  const broken: string[] = [];

  const reported: unknown = (init as { signal?: unknown }).signal;
  const owns = Reflect.ownKeys(init).includes("signal");
  const spread = { ...init } as { signal?: unknown };
  const carried = reported !== undefined && reported !== null;

  if (carried && spread.signal !== reported) {
    broken.push("custody: the init reports a signal that a spread of the init does not carry");
  }
  if (owns && reported === undefined && !Reflect.ownKeys(options).includes("signal")) {
    broken.push("invention: the init owns a signal entry the caller's own key list does not");
  }
  if (reported === undefined) {
    const ours = Object.hasOwn(spread, "signal");
    const theirs = Object.hasOwn({ ...(options as Record<string, unknown>) }, "signal");
    if (ours !== theirs) {
      broken.push(
        `parity: a spread of the init ${ours ? "carries" : "drops"} signal where a spread of the caller's object ${theirs ? "carries" : "drops"} it`,
      );
    }
  }
  return broken;
}

/**
 * Round 22's pair, verbatim, so section C can show what it does and does not
 * see. It is NOT the property under test; `disagreements` is.
 */
function roundTwentyTwoClauses(init: RequestInit, options: object): readonly string[] {
  const broken: string[] = [];
  const reported: unknown = (init as { signal?: unknown }).signal;
  const owns = Reflect.ownKeys(init).includes("signal");
  const spread = { ...init } as { signal?: unknown };

  if (reported !== undefined && reported !== null && spread.signal !== reported) {
    broken.push("custody");
  }
  if (owns && !("signal" in options) && reported === undefined) {
    broken.push("invention");
  }
  return broken;
}

/**
 * Run `body` with one `Object.prototype` key declared by `descriptor`, and
 * remove it again. The window is SYNCHRONOUS, exactly as rounds 21 and 22 make
 * it: `planRequest` is synchronous, and so is everything `typedFetch` does
 * before its first `await`.
 */
function underPollution<T>(key: string, descriptor: PropertyDescriptor, body: () => T): T {
  Object.defineProperty(Object.prototype, key, { configurable: true, ...descriptor });
  try {
    return body();
  } finally {
    delete (Object.prototype as Record<string, unknown>)[key];
  }
}

const anyFetch = (() => Promise.resolve(new Response("ok"))) as unknown as typeof fetch;

// ── Section A — the corpus, and the property over it ───────────────────────
//
// Seven shapes. The first five are cells the suite draws once or never; the
// last two keep the CUSTODY clause non-vacuous, because a clause about a
// carried signal decides nothing on a corpus that carries none — and they are
// round 22's first two separators, so this pin is at least as strong as the one
// it extends.

interface Shape {
  readonly name: string;
  /** Built inside the pollution window, when the shape needs one. */
  readonly make: (signal: AbortSignal) => TypedFetchOptions;
  /** The `Object.prototype` key this shape needs, if any. */
  readonly pollute?: readonly [string, PropertyDescriptor];
  /** What the census counted for this cell, so a reader can check the claim. */
  readonly drawnBySuite: number;
}

const CORPUS: readonly Shape[] = [
  {
    // NEVER DRAWN. An own non-enumerable `signal` ACCESSOR, no signal to carry.
    // Non-configurable too, so the entry the module writes has to REPLACE a
    // slot the caller declared permanent.
    name: "a non-configurable non-enumerable signal accessor, no signal to carry",
    drawnBySuite: 0,
    make: () => {
      const options: Record<string, unknown> = { fetch: anyFetch };
      Object.defineProperty(options, "signal", {
        get: () => undefined,
        enumerable: false,
        configurable: false,
      });
      return options as TypedFetchOptions;
    },
  },
  {
    // ONE CALL IN 7,882, and one test in one file. This is the cell the fourth
    // wrong implementation lives in.
    name: "an own non-enumerable signal reading undefined, no signal to carry",
    drawnBySuite: 1,
    make: () => {
      const options: Record<string, unknown> = { fetch: anyFetch };
      Object.defineProperty(options, "signal", {
        value: undefined,
        writable: true,
        configurable: true,
      });
      return options as TypedFetchOptions;
    },
  },
  {
    // NEVER DRAWN with no signal to carry: the bag omits the name while the
    // caller's object answers `has` and `getOwnPropertyDescriptor` for it. This
    // is the shape the fifth wrong implementation lives in.
    name: "a proxy whose ownKeys omits an own signal, no signal to carry",
    drawnBySuite: 0,
    make: () =>
      new Proxy({ signal: undefined, fetch: anyFetch } as Record<string, unknown>, {
        ownKeys: () => ["fetch"],
      }) as TypedFetchOptions,
  },
  {
    // Round 22's third separator, kept as the regression oracle for the read
    // round 21 guarded.
    name: "a null-prototype options object under a polluted Object.prototype.signal",
    drawnBySuite: 4,
    pollute: ["signal", { value: { enumerable: true }, writable: true, enumerable: false }],
    make: () => {
      const options = Object.create(null) as Record<string, unknown>;
      options.fetch = anyFetch;
      return options as TypedFetchOptions;
    },
  },
  {
    // An INHERITED slot reading undefined. The bag owns nothing, the caller's
    // key list carries nothing, and `"signal" in options` answers TRUE — the
    // separation between round 22's clause and this one.
    name: "an inherited signal reading undefined, no signal to carry",
    drawnBySuite: 0,
    make: () => {
      const options = Object.create({ signal: undefined }) as Record<string, unknown>;
      options.fetch = anyFetch;
      return options as TypedFetchOptions;
    },
  },
  {
    // CUSTODY's first witness, and the shape that separates the pre-round-19
    // implementation: a signal the caller declared invisible to a spread.
    name: "an own non-enumerable signal carrying a real one",
    drawnBySuite: 178,
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
    // CUSTODY's second witness, and the shape that separates the pre-round-20
    // implementation: a `Proxy` may legally report an enumerable descriptor for
    // a key its `ownKeys` omits, so a predicate over the descriptor sends an
    // object no spread can carry a signal out of down the fast path.
    name: "a proxy whose ownKeys omits an enumerable signal carrying a real one",
    drawnBySuite: 10,
    make: (signal) =>
      new Proxy({ signal, method: "POST" } as Record<string, unknown>, {
        ownKeys: () => ["method"],
      }) as TypedFetchOptions,
  },
];

const CORPUS_CASES = CORPUS.map((shape) => [shape.name, shape] as const);

/** One shape by name, so sections B and C cannot drift when the list changes. */
function shapeNamed(name: string): Shape {
  const found = CORPUS.find((entry) => entry.name.startsWith(name));
  if (found === undefined) throw new Error(`round 23 has no corpus shape named ${name}`);
  return found;
}

/** The options object a shape builds, with nothing read off it yet. */
function optionsOf(name: string): object {
  return shapeNamed(name).make(new AbortController().signal) as unknown as object;
}

function planFor(shape: Shape, signal: AbortSignal): { plan: RequestPlan; options: object } {
  const run = (): { plan: RequestPlan; options: object } => {
    const options = shape.make(signal);
    return { plan: planRequest(ABSOLUTE, options), options };
  };
  return shape.pollute ? underPollution(shape.pollute[0], shape.pollute[1], run) : run();
}

describe("round 23 / H1 — one property, over the cells the corpus never drew", () => {
  test.each(CORPUS_CASES)("%s: no read of the init contradicts another", (_name, shape) => {
    const controller = new AbortController();
    const { plan, options } = planFor(shape, controller.signal);
    expect(disagreements(plan.init, options)).toEqual([]);
  });
});

// ── Section B — the corpus is the corpus it claims to be ───────────────────
//
// A shape that quietly stopped being exotic would make section A pass for the
// wrong reason. Each claim below is the fact that puts the shape in its cell.

describe("round 23 / H1 — the shapes are the cells", () => {
  test("the accessor shape is a non-configurable non-enumerable accessor", () => {
    const options = optionsOf("a non-configurable non-enumerable signal accessor");
    const descriptor = Object.getOwnPropertyDescriptor(options, "signal");
    expect(descriptor?.get).toBeTypeOf("function");
    expect(descriptor?.enumerable).toBe(false);
    expect(descriptor?.configurable).toBe(false);
    expect((options as { signal?: unknown }).signal).toBeUndefined();
  });

  test("the one-call shape is an own non-enumerable data slot reading undefined", () => {
    const options = optionsOf("an own non-enumerable signal reading undefined");
    const descriptor = Object.getOwnPropertyDescriptor(options, "signal");
    expect(descriptor).toEqual({
      value: undefined,
      writable: true,
      enumerable: false,
      configurable: true,
    });
  });

  test("the proxy shape omits signal from ownKeys while answering for it twice", () => {
    const options = optionsOf("a proxy whose ownKeys omits an own signal");
    expect(Reflect.ownKeys(options)).toEqual(["fetch"]);
    expect("signal" in options).toBe(true);
    expect(Object.getOwnPropertyDescriptor(options, "signal")).toBeDefined();
    expect(Object.hasOwn({ ...(options as Record<string, unknown>) }, "signal")).toBe(false);
  });

  test("the inherited shape owns no signal and still answers the in operator", () => {
    const options = optionsOf("an inherited signal reading undefined");
    expect(Reflect.ownKeys(options)).toEqual(["fetch"]);
    expect("signal" in options).toBe(true);
    expect(Object.hasOwn(options, "signal")).toBe(false);
  });
});

// ── Section C — the property is not decoration ─────────────────────────────
//
// Round 22 delivered a pin that fails all three refuted implementations. These
// two inits are what the fourth and the fifth wrong implementation PRODUCE, on
// the shapes above. Round 22's pair is silent on both; this one is not. Neither
// init is copied from the module — each is the observable an edit would leave,
// so nothing here drifts when the module is refactored.

describe("round 23 / H1 — the two wrong inits, and which pin sees them", () => {
  test("the fourth: an entry declared enumerable where the caller's slot is not", () => {
    const options = optionsOf("an own non-enumerable signal reading undefined");
    // `enumerable: true` unconditionally. The caller's own slot is invisible to
    // a spread; this entry is not.
    const wrongInit = { signal: undefined } as RequestInit;

    expect(roundTwentyTwoClauses(wrongInit, options)).toEqual([]);
    expect(disagreements(wrongInit, options)).toEqual([
      "parity: a spread of the init carries signal where a spread of the caller's object drops it",
    ]);
  });

  test("the fifth: an entry taken from the caller's object instead of the bag", () => {
    const options = optionsOf("a proxy whose ownKeys omits an own signal");
    // The caller's key list omits `signal`; an implementation that asks the
    // caller's object rather than the bag materializes one anyway.
    const wrongInit = { signal: undefined } as RequestInit;

    expect(roundTwentyTwoClauses(wrongInit, options)).toEqual([]);
    expect(disagreements(wrongInit, options)).toEqual([
      "invention: the init owns a signal entry the caller's own key list does not",
      "parity: a spread of the init carries signal where a spread of the caller's object drops it",
    ]);
  });

  test("and the custody clause still fails an init a spread cannot carry", () => {
    const controller = new AbortController();
    const options = shapeNamed("an own non-enumerable signal carrying a real one").make(
      controller.signal,
    ) as unknown as object;
    const wrongInit = Object.create(Object.prototype, {
      signal: { value: controller.signal, enumerable: false, configurable: true },
    }) as RequestInit;

    expect(disagreements(wrongInit, options)).toEqual([
      "custody: the init reports a signal that a spread of the init does not carry",
    ]);
  });
});

// ── Section D — liveness ───────────────────────────────────────────────────
//
// Everything the plan carries except `init` is a captured value. This states
// the half of `init` that is a guarantee: on the descriptor branch the three
// shape reads are answered by an object the caller cannot reach, so no later
// write to the caller's object moves them. Round 21 pinned the KEY SET on that
// branch; the descriptor read and the spread were never pinned, and the branch
// that exists to hide `fetch` was never asked what it answers about `fetch`
// after the plan is built.

/** The three reads the module docblock quantifies over, for one name. */
function shapeReads(init: RequestInit, key: string) {
  return {
    descriptor: Object.getOwnPropertyDescriptor(init, key) !== undefined,
    ownKeys: Reflect.ownKeys(init).includes(key),
    spread: Object.hasOwn({ ...init }, key),
  };
}

describe("round 23 / H1 — what the plan still promises after the caller writes", () => {
  test("the descriptor branch's shape reads are immune to a late own fetch", () => {
    const options: Record<string, unknown> = { method: "POST", fetch: anyFetch };
    const plan = planRequest(ABSOLUTE, options as TypedFetchOptions);
    const before = shapeReads(plan.init, "fetch");

    options.fetch = (() => Promise.resolve(new Response("late"))) as unknown as typeof fetch;
    options.body = "written after the plan";

    expect(before).toEqual({ descriptor: false, ownKeys: false, spread: false });
    expect(shapeReads(plan.init, "fetch")).toEqual(before);
    expect(shapeReads(plan.init, "body")).toEqual({
      descriptor: false,
      ownKeys: false,
      spread: false,
    });
  });

  test("a late own fetch never becomes the transport, on either branch", () => {
    const controller = new AbortController();
    const bare: Record<string, unknown> = {};
    const carried: Record<string, unknown> = { signal: controller.signal };
    const barePlan = planRequest(ABSOLUTE, bare as TypedFetchOptions);
    const carriedPlan = planRequest(ABSOLUTE, carried as TypedFetchOptions);

    const late = (() => Promise.resolve(new Response("late"))) as unknown as typeof fetch;
    bare.fetch = late;
    carried.fetch = late;

    for (const plan of [barePlan, carriedPlan]) {
      expect(plan.transport).toBe(globalThis.fetch);
      expect(plan.ambientTransport).toBe(true);
      expect(plan.transport).not.toBe(late);
    }
  });

  test("the signal the init reports is the one it reported at plan time", () => {
    const controller = new AbortController();
    const other = new AbortController();
    const options: Record<string, unknown> = { signal: controller.signal, fetch: anyFetch };
    const plan = planRequest(ABSOLUTE, options as TypedFetchOptions);

    options.signal = other.signal;

    expect(plan.init.signal).toBe(controller.signal);
    expect({ ...plan.init }.signal).toBe(controller.signal);
    expect(plan.signal).toBe(controller.signal);
  });
});

// ── Section E — the write site, against the platform ───────────────────────
//
// `descriptors.signal = { … }` is an assignment, so it consults
// `Object.prototype` for a setter before it creates an own property, on exactly
// the calls the round-21 guard one line above was written for. This is the
// sentinel for that: the outcome under each pollution flavour, compared with
// the bare `fetch` this library wraps, on the identical object shape.
//
// GOVERNANCE is what is compared, never an error class name: whether the server
// finished writing its response after the caller aborted. A name differs across
// runtimes for reasons that are nobody's defect; a request that ran to
// completion after an abort is the defect this whole module exists to prevent.
//
// All four agree today. The day one stops agreeing, the library is doing worse
// than the platform under the same pollution, and that IS the finding.

interface Outcome {
  readonly governed: boolean;
  readonly refused: boolean;
}

describe("round 23 / H1 — the descriptor write, against the bare platform", () => {
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

  const FLAVOURS: ReadonlyArray<readonly [string, PropertyDescriptor]> = [
    ["a writable data property", { value: undefined, writable: true, enumerable: false }],
    ["a non-writable data property", { value: undefined, writable: false, enumerable: false }],
    ["a getter alone", { get: () => undefined, enumerable: false }],
    ["a getter with a setter", { get: () => undefined, set: () => {}, enumerable: false }],
  ];

  test.each(FLAVOURS)(
    "Object.prototype.signal as %s: the library and the platform agree",
    async (name, descriptor) => {
      const native = globalThis.fetch;

      /** The `Object.create({ signal })` shape, plus whatever transport applies. */
      const options = (signal: AbortSignal, withOverride: boolean): Record<string, unknown> => {
        const built = Object.create({ signal }) as Record<string, unknown>;
        if (withOverride) {
          built.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
            native(input, { ...init })) as unknown as typeof fetch;
        }
        return built;
      };

      const libraryTag = `lib-${name}`;
      const libraryController = new AbortController();
      const library: Outcome = await (async () => {
        let pending: Promise<{ error: unknown }>;
        try {
          pending = underPollution("signal", descriptor, () =>
            typedFetch(
              `${base}/?tag=${encodeURIComponent(libraryTag)}`,
              options(libraryController.signal, true) as TypedFetchOptions,
            ),
          ) as Promise<{ error: unknown }>;
        } catch {
          return { governed: true, refused: true };
        }
        setTimeout(() => libraryController.abort(), 60);
        const settled = await pending;
        return { governed: settled.error !== null, refused: false };
      })();

      const platformTag = `bare-${name}`;
      const platformController = new AbortController();
      const platform: Outcome = await (async () => {
        let pending: Promise<Response>;
        try {
          pending = underPollution("signal", descriptor, () =>
            native(
              `${base}/?tag=${encodeURIComponent(platformTag)}`,
              options(platformController.signal, false) as RequestInit,
            ),
          );
        } catch {
          return { governed: true, refused: true };
        }
        setTimeout(() => platformController.abort(), 60);
        try {
          await pending;
          return { governed: false, refused: false };
        } catch {
          return { governed: true, refused: false };
        }
      })();

      // Long enough for a request nobody stopped to finish and report itself.
      await new Promise((resolve) => setTimeout(resolve, 600));

      // Non-vacuity: the server IS the witness, and it answers for both sides.
      expect(finished.includes(libraryTag)).toBe(!library.governed);
      expect(finished.includes(platformTag)).toBe(!platform.governed);
      expect(library.governed).toBe(platform.governed);
    },
    20_000,
  );
});
