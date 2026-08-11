import http from "node:http";
import net from "node:net";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { isAbortError, typedFetch } from "../../src/index";
import type { TypedFetchOptions } from "../../src/index";
import { planRequest } from "../../src/request-plan";
import { recordingTransport } from "../../fixtures/recording-transport";

// Round 20, lane H1 — the request path, aimed at what round 19 CHANGED.
//
// Round 18 replaced `snapshotRequestInit`'s branch condition with an own-ness
// test. Round 19 proved that wrong inside one round and replaced it with a
// SPREAD-VISIBILITY test:
//
//     Object.getOwnPropertyDescriptor(options, "signal")?.enumerable !== true
//
// This file attacks the replacement the way round 19 attacked its predecessor.
//
// Section A is the corpus and the first finding: the condition asks ONE of the
// two questions a spread asks, and it asks it BEFORE the spread happens.
// Section B is the same finding over a real socket, in the shape rounds 18 and
// 19 both used, so the three are directly comparable.
// Section C is the second finding: the enumerability round 19 made
// unconditional is written on a branch that has no signal to carry.
// Section D passes. It is the evidence behind the frontier verdict on the pins.

const ABSOLUTE = "https://round20.test/resource";

// ── A control server, so an abort has an observable ────────────────────────

interface ControlServer {
  url(params?: Record<string, string | number>): string;
  finished(): readonly string[];
}

/**
 * An HTTP server that reports whether it FINISHED writing a response.
 *
 * A cancelled response clears its own timer, so a tag reaching
 * {@link ControlServer.finished} means the request ran to completion — which
 * is the observable that separates a governed request from an ungoverned one.
 */
function useControlServer(): ControlServer {
  let base = "";
  let server: http.Server;
  const finished: string[] = [];

  beforeAll(async () => {
    server = http.createServer((request, response) => {
      const parsed = new URL(request.url ?? "/", "http://control.invalid");
      const tag = parsed.searchParams.get("tag") ?? "";
      const delay = Number(parsed.searchParams.get("delay") ?? 0);
      const timer = setTimeout(() => {
        response.setHeader("Content-Type", "text/plain");
        response.writeHead(200);
        response.end("done");
        finished.push(tag);
      }, delay);
      response.on("close", () => clearTimeout(timer));
    });
    await new Promise<void>((resolve) => {
      server.listen(0, () => resolve());
    });
    base = `http://localhost:${(server.address() as net.AddressInfo).port}`;
  });

  afterAll(() => {
    server.close();
  });

  return {
    url(params = {}) {
      const search = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) search.append(key, String(value));
      return `${base}/?${search}`;
    },
    finished: () => finished,
  };
}

const control = useControlServer();

/** The platform's own transport, captured before any test replaces the global. */
const NATIVE_FETCH = globalThis.fetch;

/** Install a transport as the global for one call, and always put it back. */
async function withGlobalTransport<T>(transport: typeof fetch, run: () => Promise<T>): Promise<T> {
  const globals = globalThis as { fetch: typeof fetch };
  globals.fetch = transport;
  try {
    return await run();
  } finally {
    globals.fetch = NATIVE_FETCH;
  }
}

// ── A. The corpus, and the property round 19 wrote in prose ────────────────
//
// THE PROPERTY, stated executably for the first time:
//
//     Whenever the caller's options object answers a `signal` read with an
//     `AbortSignal`, `{ ...plan.init }.signal` is that same signal.
//
// `{ ...init }` is what a forwarding transport writes, and `plan.signal` — the
// authority `classifyRequestFailure` consults — is that same signal, so a
// spread that drops it leaves the request UNGOVERNED while the classifier goes
// on trusting a signal nothing is listening to.
//
// The corpus below is the descriptor space the property is quantified over. It
// is drawn in four families, and the family boundary is the finding.

/** One options object the corpus draws, and the signal it is supposed to carry. */
interface Draw {
  readonly family: string;
  readonly label: string;
  readonly signal: AbortSignal;
  readonly build: () => TypedFetchOptions;
}

const CORPUS_SIGNAL = new AbortController().signal;

type OwnKind = "absent" | "data" | "accessor";

/** Every own-`signal` descriptor shape an ordinary object can carry: 13 of them. */
function ownSlotShapes(): readonly (readonly [string, PropertyDescriptor | null])[] {
  const shapes: (readonly [string, PropertyDescriptor | null])[] = [["own absent", null]];
  for (const kind of ["data", "accessor"] satisfies Exclude<OwnKind, "absent">[]) {
    for (const enumerable of [true, false]) {
      for (const configurable of [true, false]) {
        if (kind === "accessor") {
          shapes.push([
            `own accessor ${enumerable ? "enumerable" : "non-enumerable"} ${configurable ? "configurable" : "non-configurable"}`,
            { get: () => CORPUS_SIGNAL, enumerable, configurable },
          ]);
          continue;
        }
        for (const writable of [true, false]) {
          shapes.push([
            `own data ${enumerable ? "enumerable" : "non-enumerable"} ${writable ? "writable" : "non-writable"} ${configurable ? "configurable" : "non-configurable"}`,
            { value: CORPUS_SIGNAL, enumerable, writable, configurable },
          ]);
        }
      }
    }
  }
  return shapes;
}

/** Five prototypes: none, one with no signal, and three that carry one. */
function prototypeShapes(): readonly (readonly [string, () => object | null])[] {
  return [
    ["proto null", () => null],
    ["proto bare", () => ({})],
    [
      "proto enumerable data signal",
      () =>
        Object.defineProperty({}, "signal", {
          value: CORPUS_SIGNAL,
          writable: true,
          enumerable: true,
          configurable: true,
        }),
    ],
    [
      "proto non-enumerable data signal",
      () => Object.defineProperty({}, "signal", { value: CORPUS_SIGNAL, configurable: true }),
    ],
    [
      "proto enumerable accessor signal",
      () =>
        Object.defineProperty({}, "signal", {
          get: () => CORPUS_SIGNAL,
          enumerable: true,
          configurable: true,
        }),
    ],
  ];
}

/**
 * The ORDINARY family: no proxy, no mutation, nothing exotic.
 *
 * 13 own shapes x 5 prototypes x 3 `fetch` placements x 3 extensibility locks,
 * minus the 39 cells that ask for an INHERITED `fetch` on a null prototype,
 * which is not a shape that exists.
 */
function ordinaryFamily(): readonly Draw[] {
  const draws: Draw[] = [];
  for (const [ownLabel, ownDescriptor] of ownSlotShapes()) {
    for (const [protoLabel, makePrototype] of prototypeShapes()) {
      for (const fetchAt of ["fetch absent", "fetch own", "fetch inherited"] as const) {
        // An inherited `fetch` needs a prototype to sit on, and it is never put
        // on `Object.prototype`: polluting the test realm's own prototype is
        // the one thing this corpus refuses to draw.
        if (fetchAt === "fetch inherited" && protoLabel === "proto null") continue;
        for (const lock of ["unlocked", "sealed", "frozen"] as const) {
          draws.push({
            family: "ordinary",
            label: `${ownLabel} / ${protoLabel} / ${fetchAt} / ${lock}`,
            signal: CORPUS_SIGNAL,
            build() {
              const prototype = makePrototype();
              if (fetchAt === "fetch inherited") {
                (prototype as Record<string, unknown>).fetch = recordingTransport().fetch;
              }
              const own: PropertyDescriptorMap = {
                method: { value: "POST", writable: true, enumerable: true, configurable: true },
              };
              if (ownDescriptor !== null) own.signal = { ...ownDescriptor };
              if (fetchAt === "fetch own") {
                own.fetch = {
                  value: recordingTransport().fetch,
                  writable: true,
                  enumerable: true,
                  configurable: true,
                };
              }
              const options = Object.create(prototype, own) as TypedFetchOptions;
              if (lock === "sealed") Object.seal(options);
              if (lock === "frozen") Object.freeze(options);
              return options;
            },
          });
        }
      }
    }
  }
  return draws;
}

/**
 * The PROXY family. `Object.getOwnPropertyDescriptor` is a trappable operation
 * and it answers about ONE object; a spread asks TWO questions, `ownKeys` and
 * then the descriptor, and a proxy may legally answer them differently.
 */
function proxyFamily(): readonly Draw[] {
  const withSignal = (): Record<string, unknown> => ({
    method: "POST",
    signal: CORPUS_SIGNAL as unknown,
  });
  const enumerableSignalDescriptor = (): PropertyDescriptor => ({
    value: CORPUS_SIGNAL,
    writable: true,
    enumerable: true,
    configurable: true,
  });
  const draws: Draw[] = [
    {
      family: "proxy",
      label: "ownKeys omits a signal the descriptor reports enumerable",
      signal: CORPUS_SIGNAL,
      build: () =>
        new Proxy(withSignal(), {
          // Legal: the target is extensible and `signal` is configurable, so
          // `ownKeys` is under no obligation to report it.
          ownKeys: () => ["method"],
        }) as unknown as TypedFetchOptions,
    },
    {
      family: "proxy",
      label: "the descriptor trap synthesizes an enumerable signal ownKeys never lists",
      signal: CORPUS_SIGNAL,
      build: () =>
        new Proxy({ method: "POST" } as Record<string, unknown>, {
          get: (target, property) =>
            property === "signal" ? CORPUS_SIGNAL : Reflect.get(target, property),
          getOwnPropertyDescriptor: (target, property) =>
            property === "signal"
              ? enumerableSignalDescriptor()
              : Reflect.getOwnPropertyDescriptor(target, property),
        }) as unknown as TypedFetchOptions,
    },
    {
      family: "proxy",
      label: "the same disagreement beside an own fetch option",
      signal: CORPUS_SIGNAL,
      build: () =>
        new Proxy(
          { method: "POST", fetch: recordingTransport().fetch, signal: CORPUS_SIGNAL },
          {
            ownKeys: () => ["method", "fetch"],
          },
        ) as unknown as TypedFetchOptions,
    },
    {
      family: "proxy",
      label: "a defaults proxy that supplies signal through get alone",
      signal: CORPUS_SIGNAL,
      build: () =>
        new Proxy({ method: "POST" } as Record<string, unknown>, {
          get: (target, property) =>
            property === "signal" ? CORPUS_SIGNAL : Reflect.get(target, property),
        }) as unknown as TypedFetchOptions,
    },
    {
      family: "proxy",
      label: "a descriptor trap that hides the enumerability of a key ownKeys does list",
      signal: CORPUS_SIGNAL,
      build: () =>
        new Proxy(withSignal(), {
          getOwnPropertyDescriptor: (target, property) =>
            property === "signal"
              ? { value: CORPUS_SIGNAL, writable: true, enumerable: false, configurable: true }
              : Reflect.getOwnPropertyDescriptor(target, property),
        }) as unknown as TypedFetchOptions,
    },
    {
      family: "proxy",
      label: "a get trap that overrides the target's own enumerable signal",
      signal: CORPUS_SIGNAL,
      build: () =>
        new Proxy(
          { method: "POST", signal: new AbortController().signal },
          {
            get: (target, property) =>
              property === "signal" ? CORPUS_SIGNAL : Reflect.get(target, property),
          },
        ) as unknown as TypedFetchOptions,
    },
  ];
  return draws;
}

/**
 * The MUTATION family, and none of it uses a proxy. The condition is a check on
 * a fact the caller's object owns and can still change; the spread reads that
 * fact again, later, from the same object.
 */
function mutationFamily(): readonly Draw[] {
  return [
    {
      family: "mutation",
      label: "a sibling accessor makes signal non-enumerable while the spread runs",
      signal: CORPUS_SIGNAL,
      build() {
        const options = {} as Record<string, unknown>;
        // `method` is read BEFORE `signal` — insertion order — and a spread
        // takes `ownKeys` once and then re-reads each descriptor as it goes.
        Object.defineProperty(options, "method", {
          enumerable: true,
          configurable: true,
          get() {
            Object.defineProperty(options, "signal", { enumerable: false });
            return "POST";
          },
        });
        Object.defineProperty(options, "signal", {
          value: CORPUS_SIGNAL,
          writable: true,
          enumerable: true,
          configurable: true,
        });
        return options as TypedFetchOptions;
      },
    },
    {
      family: "mutation",
      label: "a sibling accessor deletes signal while the spread runs",
      signal: CORPUS_SIGNAL,
      build() {
        const options = {} as Record<string, unknown>;
        Object.defineProperty(options, "method", {
          enumerable: true,
          configurable: true,
          get() {
            delete options.signal;
            return "POST";
          },
        });
        options.signal = CORPUS_SIGNAL;
        return options as TypedFetchOptions;
      },
    },
    {
      family: "mutation",
      label: "the signal accessor redefines itself non-enumerable when it is read",
      signal: CORPUS_SIGNAL,
      build() {
        const options = { method: "POST" } as Record<string, unknown>;
        Object.defineProperty(options, "signal", {
          enumerable: true,
          configurable: true,
          get() {
            Object.defineProperty(options, "signal", {
              value: CORPUS_SIGNAL,
              writable: true,
              enumerable: false,
              configurable: true,
            });
            return CORPUS_SIGNAL;
          },
        });
        return options as TypedFetchOptions;
      },
    },
    {
      family: "mutation",
      label: "the signal accessor deletes itself when it is read",
      signal: CORPUS_SIGNAL,
      build() {
        const options = { method: "POST" } as Record<string, unknown>;
        Object.defineProperty(options, "signal", {
          enumerable: true,
          configurable: true,
          get() {
            delete options.signal;
            return CORPUS_SIGNAL;
          },
        });
        return options as TypedFetchOptions;
      },
    },
  ];
}

/** An options object allocated by ANOTHER realm, so no realm-bound check recognizes it. */
function foreignOptions(): Record<string, unknown> {
  return vm.runInNewContext("({ method: 'POST' })") as Record<string, unknown>;
}

/** The CROSS-REALM family: an options object allocated by another realm. */
function crossRealmFamily(): readonly Draw[] {
  const foreign = foreignOptions;
  return [
    {
      family: "cross-realm",
      label: "a foreign object with an own enumerable signal",
      signal: CORPUS_SIGNAL,
      build() {
        const options = foreign();
        options.signal = CORPUS_SIGNAL;
        return options as TypedFetchOptions;
      },
    },
    {
      family: "cross-realm",
      label: "a foreign object with an own non-enumerable signal",
      signal: CORPUS_SIGNAL,
      build() {
        const options = foreign();
        Object.defineProperty(options, "signal", { value: CORPUS_SIGNAL, configurable: true });
        return options as TypedFetchOptions;
      },
    },
  ];
}

function corpus(): readonly Draw[] {
  return [...ordinaryFamily(), ...proxyFamily(), ...mutationFamily(), ...crossRealmFamily()];
}

/** What one draw did: `null` when the property holds or does not apply. */
function violation(draw: Draw): string | null {
  let plan;
  try {
    plan = planRequest(ABSOLUTE, draw.build());
  } catch (cause) {
    return `the plan refused: ${String(cause)}`;
  }
  if (plan.signal !== draw.signal) {
    // No signal was contributed at all — the property is not quantified over
    // this draw, and the rows that reach it are the ones with no `signal`
    // anywhere on the object.
    return plan.signal === undefined ? null : "the plan captured a signal nobody wrote";
  }
  let spread: Record<string, unknown>;
  try {
    spread = { ...(plan.init as Record<string, unknown>) };
  } catch (cause) {
    return `the spread threw: ${String(cause)}`;
  }
  if (plan.init.signal !== draw.signal) return "the init does not report the signal";
  if (spread.signal !== draw.signal) {
    return Object.hasOwn(spread, "signal")
      ? "the spread carries a different signal"
      : "the init reports the signal, the spread drops it";
  }
  return null;
}

describe("round 20 / H1 — the third condition on the entry a spread carries", () => {
  test("R20-H1-01: a signal the init reports is a signal a spread of the init carries", () => {
    // THE DEFECT. A spread asks TWO questions of the source object, in this
    // order: `[[OwnPropertyKeys]]` once, then `[[GetOwnProperty]]` for each key
    // it got back. `snapshotRequestInit` asks only the second one, and it asks
    // it at PLAN time, about an object the caller still owns:
    //
    //     Object.getOwnPropertyDescriptor(options, "signal")?.enumerable !== true
    //
    // Two independent gaps follow, and each one reaches R19-H1-01's own
    // consequence through the condition that replaced it:
    //
    //   1. The two questions can disagree. A proxy whose `ownKeys` omits
    //      `signal` while its descriptor reports it enumerable is a LEGAL
    //      proxy — the invariant binds only non-configurable keys of a
    //      non-extensible target — and `request-plan.spec.ts` already treats an
    //      options proxy whose traps disagree as an input this facade must
    //      survive ("an options Proxy reporting keys it does not have").
    //   2. The answer is read before it is used. The descriptor is a fact the
    //      caller's own object holds, and the spread re-reads it later; any
    //      accessor on the same object can change it in between, with no proxy
    //      anywhere.
    //
    // Round 19 could not see either one, because its corpus varied ownership,
    // enumerability, kind and branch over PLAIN objects only: sixteen cells,
    // all of them in the family that is governed.
    //
    // The remedy the two gaps share is to stop asking. When there is a signal
    // to carry, the materializing branch already produces a FRESH target whose
    // `signal` entry is enumerable and which the caller cannot reach, so it
    // answers both questions by construction.
    const drawn = corpus();
    const violations: Record<string, string> = {};
    for (const draw of drawn) {
      const verdict = violation(draw);
      if (verdict !== null) violations[`${draw.family}: ${draw.label}`] = verdict;
    }

    // The size of the space, asserted so the number is executable rather than
    // reported. 546 ordinary + 6 proxy + 4 mutation + 2 cross-realm.
    expect(drawn.length).toBe(558);
    expect(drawn.filter((draw) => draw.family === "ordinary").length).toBe(546);

    expect(
      violations,
      '`snapshotRequestInit` asks `Object.getOwnPropertyDescriptor(options, "signal")' +
        "?.enumerable`, which is ONE of the two questions a spread asks and is answered before " +
        "the spread asks them: a proxy may report an enumerable descriptor for a key its " +
        "`ownKeys` omits, and any accessor on an ordinary object may make the key " +
        "non-enumerable while the spread is running. In both cases the init reports the " +
        "caller's signal, the spread a forwarding transport writes carries none, and " +
        "`classifyRequestFailure` goes on treating that signal as the authority",
    ).toEqual({});
  });
});

// ── B. The same finding over a real socket ─────────────────────────────────

describe("round 20 / H1 — the caller aborts and the envelope reports a success", () => {
  test("R20-H1-01: an ungoverned request runs to completion under a forwarding transport", async () => {
    // THE CONSEQUENCE, end to end, in the shape rounds 18 and 19 both used.
    //
    // A forwarding transport spreads the init it was handed — a tracing, retry
    // or mock wrapper — and the caller aborts while the server still holds the
    // response. A governed request closes the socket and the server never
    // finishes. An ungoverned one runs to completion and the envelope reports
    // a SUCCESS, while `plan.signal` still holds the signal the caller aborted.
    async function drive(
      label: string,
      makeOptions: (signal: AbortSignal) => TypedFetchOptions,
    ): Promise<{
      readonly spreadKeepsSignal: boolean;
      readonly outcome: string;
      readonly serverFinished: boolean;
    }> {
      const tag = `round20-${label}`;
      const target = control.url({ tag, delay: 400 });
      const controller = new AbortController();
      const options = makeOptions(controller.signal);

      let spreadKeepsSignal = false;
      const forwarding = (async (input: unknown, init: RequestInit) => {
        const forwarded = { ...init } as RequestInit;
        spreadKeepsSignal = forwarded.signal === controller.signal;
        return await NATIVE_FETCH(input as string, forwarded);
      }) as unknown as typeof fetch;

      setTimeout(() => controller.abort(), 60);
      const { response, error } = await withGlobalTransport(
        forwarding,
        async () => await typedFetch(target, options),
      );
      if (response) await response.text().catch(() => "");

      return {
        spreadKeepsSignal,
        outcome: error === null ? "success" : isAbortError(error) ? "AbortedError" : error.name,
        serverFinished: control.finished().includes(tag),
      };
    }

    const governed = { spreadKeepsSignal: true, outcome: "AbortedError", serverFinished: false };
    const observed = {
      // The control row: an ordinary own enumerable slot, which is governed.
      // Its presence is what stops a failure below being blamed on the harness.
      "an ordinary own enumerable signal": await drive(
        "ordinary",
        (signal) => ({ signal, method: "GET" }) as TypedFetchOptions,
      ),
      "an options proxy whose ownKeys omits the signal": await drive(
        "proxy",
        (signal) =>
          new Proxy(
            { method: "GET", signal },
            {
              ownKeys: () => ["method"],
            },
          ) as unknown as TypedFetchOptions,
      ),
      "a sibling accessor that flips the slot while the spread runs": await drive(
        "mutation",
        (signal) => {
          const options = {} as Record<string, unknown>;
          Object.defineProperty(options, "method", {
            enumerable: true,
            configurable: true,
            get() {
              Object.defineProperty(options, "signal", { enumerable: false });
              return "GET";
            },
          });
          Object.defineProperty(options, "signal", {
            value: signal,
            writable: true,
            enumerable: true,
            configurable: true,
          });
          return options as TypedFetchOptions;
        },
      ),
    };

    expect(
      observed,
      "the init reports the caller's signal and the spread a forwarding transport writes " +
        "carries none, so `controller.abort()` cancels nothing: the server writes the whole " +
        "response and the envelope reports a success for a request the caller aborted",
    ).toEqual({
      "an ordinary own enumerable signal": governed,
      "an options proxy whose ownKeys omits the signal": governed,
      "a sibling accessor that flips the slot while the spread runs": governed,
    });
  }, 30_000);
});

// ── C. The enumerability round 19 made unconditional ───────────────────────

describe("round 20 / H1 — the entry written on a branch with no signal to carry", () => {
  test("R20-H1-02: the fetch-option branch invents a spread member the other branch does not", () => {
    // Round 19 replaced
    //
    //     enumerable: descriptors.signal?.enumerable ?? true
    //
    // with an unconditional `enumerable: true`, and the reason it gives is
    // sound for the case it names: an entry this branch materializes so a
    // spread can see it must be enumerable.
    //
    // The descriptor is written under a WIDER condition than that reason
    // covers — `if (descriptors.signal || signal !== undefined)` — so it is
    // also written when there is NO signal to carry and the caller merely owns
    // the slot. `snapshotRequestInit`'s own comment states the rule this
    // breaks, and `request-plan.spec.ts` > "no signal slot is invented for a
    // caller that had none" names the defect class:
    //
    //     "`{ ...init }` grew a `signal: undefined` member the caller never
    //      wrote. An implementation is entitled to reflect over its init, and
    //      the suite already treats that as legitimate."
    //
    // Neither draws the slot that reaches it: an own NON-ENUMERABLE `signal`
    // reading `undefined`. The caller's own spread carries no `signal` member;
    // the init's spread now does — but only when an own `fetch` option selects
    // this branch, so the two branches disagree about one options object.
    function inspect(withFetch: boolean): Record<string, unknown> {
      const options = Object.defineProperty(
        withFetch
          ? { method: "POST", fetch: recordingTransport().fetch }
          : ({ method: "POST" } as Record<string, unknown>),
        "signal",
        { value: undefined, writable: true, configurable: true },
      ) as TypedFetchOptions;

      const { init } = planRequest(ABSOLUTE, options);
      return {
        "the caller's own spread carries a signal member": Object.hasOwn(
          { ...(options as Record<string, unknown>) },
          "signal",
        ),
        "the init's spread carries a signal member": Object.hasOwn(
          { ...(init as Record<string, unknown>) },
          "signal",
        ),
        "Object.keys(init) lists signal": Object.keys(init).includes("signal"),
      };
    }

    const faithful = {
      "the caller's own spread carries a signal member": false,
      "the init's spread carries a signal member": false,
      "Object.keys(init) lists signal": false,
    };

    expect(
      { "no fetch option": inspect(false), "an own fetch option": inspect(true) },
      "an own non-enumerable `signal` slot holding `undefined` is re-declared ENUMERABLE by " +
        "the branch an own `fetch` option selects, so `{ ...init }` grows a `signal: undefined` " +
        "member the caller's own spread does not carry and `Object.keys(init)` lists a slot " +
        "the caller hid — the divergence `snapshotRequestInit`'s own comment forbids, and the " +
        "other branch, given the same options object, does not produce it",
    ).toEqual({ "no fetch option": faithful, "an own fetch option": faithful });
  });
});

// ── D. What the pins can still fail for ────────────────────────────────────

/**
 * `snapshotRequestInit` as it stood before round 19, reconstructed verbatim
 * from `ac5cfc8^:src/request-plan.ts`.
 *
 * This is the implementation R19-H1-01 proved defective. It is here so a pin
 * can be fed a KNOWN-BAD subject and its own verdict measured, which is the
 * only way to establish that a passing gate is a gate that can fail.
 */
function preRound19SnapshotRequestInit(
  options: TypedFetchOptions,
  signal: AbortSignal | null | undefined,
  removeFetchOverride: boolean,
): RequestInit {
  const inheritedSignal = signal !== undefined && !Object.hasOwn(options, "signal");

  if (!removeFetchOverride && !inheritedSignal) {
    return new Proxy(options, {
      get(target, property) {
        if (property === "signal") return signal;
        return Reflect.get(target, property, target);
      },
    }) as RequestInit;
  }

  const descriptors = Object.getOwnPropertyDescriptors(options);
  if (removeFetchOverride) delete descriptors.fetch;
  if (descriptors.signal || signal !== undefined) {
    descriptors.signal = {
      value: signal,
      writable: true,
      enumerable: descriptors.signal?.enumerable ?? true,
      configurable: true,
    };
  }
  const sanitizedTarget = Object.create(Object.getPrototypeOf(options), descriptors) as RequestInit;

  return new Proxy(sanitizedTarget, {
    get(_target, property) {
      if (property === "signal") return signal;
      if (removeFetchOverride && property === "fetch") return undefined;
      return Reflect.get(options, property, options);
    },
    has(_target, property) {
      return removeFetchOverride && property === "fetch" ? false : Reflect.has(options, property);
    },
  }) as RequestInit;
}

/** The pre-round-19 init for one options object, built the way `planRequest` builds it. */
function preRound19Init(options: TypedFetchOptions): RequestInit {
  return preRound19SnapshotRequestInit(
    options,
    options.signal,
    Object.hasOwn(options as object, "fetch"),
  );
}

/** The pin's two assertions, as predicates, against one init. */
function pinViolations(init: RequestInit, signal: AbortSignal): readonly string[] {
  const found: string[] = [];
  if ({ ...(init as Record<string, unknown>) }.signal !== signal) {
    found.push("the spread drops the signal");
  }
  if (init.signal !== signal) found.push("the init does not report the signal");
  return found;
}

describe("round 20 / H1 — what the signal-spread pins can still fail for", () => {
  test("both pins that name the spread pass against the implementation round 19 refuted", () => {
    // FRONTIER ITEM 5, measured. This PASSES; it is evidence, not a finding.
    //
    // Round 19 repaired two pins that could never go green. The same question,
    // asked of every pin in `tests/request/**` and `tests/envelope/**` against
    // the PRE-ROUND-19 `snapshotRequestInit`: 14 files, 443 tests, zero
    // failures. Only `tests/request/round19-h1-request.spec.ts` fails, so
    // R19-H1-01's fix is guarded by the round-19 audit file and by nothing
    // else.
    //
    // Two of those pins carry the subject in their own titles, and this reads
    // them out of the committed source rather than copying them, which is the
    // rule R19-H1-02 established. Both draw an INHERITED signal — the
    // direction round 18 already fixed — so neither can fail for R19-H1-01,
    // whose whole subject is an OWN non-enumerable slot.
    //
    // It is not filed as a finding, and the reason is the difference from
    // R19-H1-02: the guard that exists here is unconditional. R18-H1-01's only
    // guard sat behind `describe.skipIf(!distExists)`, so the round-18 defect
    // passed the whole suite on a checkout with no `dist/`. This one does not.
    const pinSource = readFileSync(
      fileURLToPath(new URL("./request-plan.spec.ts", import.meta.url)),
      "utf8",
    );
    const titles = [
      "an inherited signal is materialized as an own key, so a spread keeps it",
      "an inherited signal survives the spread on the `fetch`-option branch too",
    ];
    const bodies = titles.map((title) => {
      const start = pinSource.indexOf(`test("${title}"`);
      expect(start, `the pin "${title}" must still exist`).not.toBe(-1);
      return pinSource
        .slice(start, pinSource.indexOf("\n  });", start))
        .replaceAll(/^\s*\/\/.*$/gm, "");
    });

    // READ, not copied: neither fixture writes a descriptor at all, so neither
    // can draw the own non-enumerable slot R19-H1-01 is about.
    expect(
      bodies.map((body) => /defineProperty|enumerable|Object\.create\(\s*\w+\s*,/.test(body)),
    ).toEqual([false, false]);
    // And both do draw the inherited slot, which is the direction round 18 fixed.
    expect(bodies.map((body) => body.includes("Object.create({ signal:"))).toEqual([true, true]);

    const controller = new AbortController();
    const inherited = (withFetch: boolean): TypedFetchOptions => {
      const options = Object.create({ signal: controller.signal }) as Record<string, unknown>;
      if (withFetch) options.fetch = recordingTransport().fetch;
      return options as TypedFetchOptions;
    };

    // The pins' own fixtures, through the implementation round 19 refuted: no
    // violation on either branch, so neither pin can fail for R19-H1-01.
    expect(pinViolations(preRound19Init(inherited(false)), controller.signal)).toEqual([]);
    expect(pinViolations(preRound19Init(inherited(true)), controller.signal)).toEqual([]);

    // Non-vacuity: the SAME reconstruction, given the slot round 19's finding
    // is about, reports the defect at once on both branches. So the
    // reconstruction is faithful and the instrument works; it is the fixtures
    // that are blind.
    const ownNonEnumerable = (withFetch: boolean): TypedFetchOptions => {
      const base = withFetch
        ? { fetch: recordingTransport().fetch }
        : ({} as Record<string, unknown>);
      return Object.defineProperty(base, "signal", {
        value: controller.signal,
        writable: true,
        configurable: true,
      }) as TypedFetchOptions;
    };
    expect(pinViolations(preRound19Init(ownNonEnumerable(false)), controller.signal)).toEqual([
      "the spread drops the signal",
    ]);
    expect(pinViolations(preRound19Init(ownNonEnumerable(true)), controller.signal)).toEqual([
      "the spread drops the signal",
    ]);
  });
});
