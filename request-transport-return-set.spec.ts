import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";
import { useTestServer } from "./fixtures/http-server";
import { recordingTransport } from "./fixtures/recording-transport";
import { planRequest } from "./src/request-plan";
import {
  isAbortError,
  isHttpError,
  isKnownHttpError,
  isNetworkError,
  isTimeoutError,
  typedFetch,
} from "./src/index";
import type { TypedFetchOptions } from "./src/index";

// Round 13, lane H1.
//
// Round 12 audited the setup phase's read INVENTORY and returned clean. This
// file starts where that stopped, at the four surfaces its clean return did not
// reach.
//
//  1. THE TRANSPORT'S RETURN VALUE, named the least-hunted surface for three
//     rounds and never landed on. Section 2 closes it: thirteen shapes, and
//     then a generated sweep over shape × governing-signal state that asserts
//     the five properties the envelope owes, rather than thirteen answers. The
//     result is a CLOSED SET, and that is this round's H1 result.
//  2. THE OPTIONS SNAPSHOT AS THE TRANSPORT READS IT. `snapshotRequestInit`
//     has two branches, and the one that strips an own `fetch` re-declares the
//     `signal` descriptor writable and configurable with a comment naming the
//     ES proxy `get` invariant that makes the re-declaration necessary. The
//     OTHER branch proxies the caller's object itself and does no descriptor
//     work at all. Section 1 asked whether the invariant is unguarded there and
//     the answer is NO: the trap echoes `initSignal` — the caller's own first
//     read — never the RESOLVED signal, so the value it reports is by
//     construction the one the target holds. Pinned in both branches over a
//     frozen object, because the two branches reach that guarantee by
//     different means and only one of them says so.
//  3. THE FAILURE AND TIMEOUT PATHS as an inventory. Section 3. Unlike the
//     response phase, these run INSIDE a catch, so a throw there escapes
//     `typedFetch` itself rather than becoming an error value.
//  4. THE SEAMS BETWEEN PHASES, which no lane owns. Section 4.
//
// Section 5 extends round 10's two-copy work from the guards to the request
// path: errors a SECOND package copy's `typedFetch` produced, asked of this
// copy's guards and of both dist copies'.

const server = useTestServer();

/** A transport that hands back exactly `value`, with no promise around it. */
function returningTransport(value: unknown): typeof fetch {
  return (() => value) as unknown as typeof fetch;
}

/** A transport that rejects with exactly `reason`. */
function rejectingTransport(reason: unknown): typeof fetch {
  return (async (): Promise<Response> => {
    throw reason;
  }) as unknown as typeof fetch;
}

/**
 * A thenable, built with `defineProperty` rather than as an object literal.
 *
 * The lint rule that forbids a literal `then` member is right about ordinary
 * code and beside the point here: a thenable is one of the shapes a transport
 * can hand back, so the set is not closed without it.
 */
function thenable(then: (resolve: (value: Response) => void) => void): object {
  // oxlint-disable-next-line no-thenable -- a thenable at the transport seam IS the test
  return Object.defineProperty({}, "then", { value: then, enumerable: true });
}

// ── 1. The options snapshot, as the transport reads it ─────────────────────
//
// The `init` the transport receives is a Proxy, and a Proxy is not free: ES
// requires a `get` trap to report the exact value a non-configurable,
// non-writable own data property of the TARGET holds. `snapshotRequestInit`
// documents that invariant in the branch that strips an own `fetch`, where it
// re-declares the `signal` descriptor writable and configurable to satisfy it.
// The other branch — no own `fetch`, so the caller's object is the target
// itself — has no such re-declaration.
//
// It does not need one, and the reason is worth pinning because it is not the
// reason the comment gives. The trap answers `signal` with `initSignal`, the
// value the caller's own slot produced on its FIRST read, not with the RESOLVED
// signal the classifier uses. For a data property those are the same value by
// construction, so the invariant holds without a descriptor; for an accessor
// there is no invariant to hold. The two values diverge only where the caller
// wrote no `signal` slot at all and a handed-over `Request` supplied one — and
// then the target has no own `signal` for an invariant to bind.
//
// The tests below drive both branches over a FROZEN options object, in each
// shape where the caller's slot and the resolved signal differ.
describe("round 13 / H1 — the options snapshot the transport reads", () => {
  test("a frozen options object performs the request the ambient fetch performs", async () => {
    // `signal: null` DETACHES a handed-over Request's signal, and the setup
    // phase resolves it to `undefined` — so the resolved signal and the
    // caller's frozen own value differ.
    const detached = await typedFetch(
      server.url({ status: 200 }),
      Object.freeze({ signal: null }) as TypedFetchOptions,
    );
    await detached.response?.body?.cancel();

    // The opposite direction: the caller's frozen own value is `undefined` and
    // the resolved signal is the Request's.
    const inheritedRequest = new Request(server.url({ status: 200 }), {
      signal: new AbortController().signal,
    });
    const inherited = await typedFetch(
      inheritedRequest,
      Object.freeze({ signal: undefined }) as TypedFetchOptions,
    );
    await inherited.response?.body?.cancel();

    // And the shape with no `signal` slot at all, where the Request supplies it.
    const bareRequest = new Request(server.url({ status: 200 }), {
      signal: new AbortController().signal,
    });
    const bare = await typedFetch(bareRequest, Object.freeze({}) as TypedFetchOptions);
    await bare.response?.body?.cancel();

    expect([detached.error, inherited.error, bare.error]).toEqual([null, null, null]);
    expect([detached.response?.status, inherited.response?.status, bare.response?.status]).toEqual([
      200, 200, 200,
    ]);
  });

  test("the transport reads the caller's own signal value, never the resolved one", () => {
    const transport = recordingTransport();
    const controller = new AbortController();

    // Branch 2 (an own `fetch` is stripped). The caller wrote `null`; the
    // library resolved `undefined`; the transport must still read `null`,
    // because that is what a bare `fetch` reads and it is what detaches a
    // Request's own signal.
    const detached = planRequest(
      new Request("https://snapshot.test/x", { signal: controller.signal }),
      Object.freeze({ signal: null, fetch: transport.fetch }) as TypedFetchOptions,
    );
    // Branch 2 again, with no `signal` slot: the init must stay empty of one,
    // so the handed-over Request's own signal governs at the transport.
    const bare = planRequest(
      new Request("https://snapshot.test/y", { signal: controller.signal }),
      {
        fetch: transport.fetch,
      } as TypedFetchOptions,
    );

    const detachedInit = detached.init;
    const bareInit = bare.init;

    expect(detachedInit.signal).toBeNull();
    // The RESOLVED signal is the other value, and it is not what the init
    // carries: `signal: null` detaches, so the plan governs the call with
    // nothing while the transport still reads the caller's own `null`.
    expect(detached.signal).toBe(undefined);
    expect("signal" in bareInit).toBe(false);
    expect(Reflect.ownKeys(bareInit)).not.toContain("signal");
  });

  // A sealed object keeps its properties writable, and an unfrozen one is the
  // ordinary case. Both recorded so a later reading of section 1 cannot be
  // mistaken for "frozen options are the only shape that works".
  test("sealed and unfrozen options objects behave identically", async () => {
    const sealed = await typedFetch(
      server.url({ status: 200 }),
      Object.seal({ signal: null }) as TypedFetchOptions,
    );
    await sealed.response?.body?.cancel();
    const plain = await typedFetch(server.url({ status: 200 }), { signal: null });
    await plain.response?.body?.cancel();

    expect([sealed.error, plain.error]).toEqual([null, null]);
  });
});

// ── 2. The transport's return value, as a CLOSED SET ───────────────────────
//
// Three rounds named this the least-hunted surface. It is closed here rather
// than sampled.
//
// The rule the set expresses: whatever a transport hands back is UNTRUSTED
// INPUT, and phase 3 sits inside the envelope. Nothing a transport returns,
// resolves, throws, or rejects with may leave `typedFetch` as an exception, and
// only a value satisfying the whole `Response` contract may leave it as a
// success.
//
// The set is stated twice on purpose. The table below states the ANSWER for
// each shape; the sweep after it states the PROPERTIES, over shape × signal
// state, so a shape added later without a row is still governed.

/** Every shape `await fetchImpl(input, init)` can produce, and its verdict. */
const RETURN_SHAPES: readonly {
  readonly name: string;
  readonly transport: () => typeof fetch;
  readonly verdict: "success" | "network";
  /** True when the transport phase REJECTS rather than resolving a value. */
  readonly rejects: boolean;
}[] = [
  // Not a Response at all: a primitive, a null, an absent value, a callable.
  {
    name: "resolves a number",
    transport: () => returningTransport(42),
    verdict: "network",
    rejects: false,
  },
  {
    name: "resolves a string",
    transport: () => returningTransport("ok"),
    verdict: "network",
    rejects: false,
  },
  {
    name: "resolves null",
    transport: () => returningTransport(null),
    verdict: "network",
    rejects: false,
  },
  {
    name: "resolves undefined",
    transport: () => returningTransport(undefined),
    verdict: "network",
    rejects: false,
  },
  {
    name: "resolves a function",
    transport: () => returningTransport(() => undefined),
    verdict: "network",
    rejects: false,
  },
  // A Request is the near-miss `FOREIGN_RESPONSE_FIELDS` is written against: it
  // carries `body`, `bodyUsed`, `headers`, and `url`, and lacks `status`,
  // `statusText`, `ok`, `redirected`, and `type`.
  {
    name: "resolves a Request",
    transport: () => returningTransport(new Request("https://a.test/x")),
    verdict: "network",
    rejects: false,
  },
  // A REVOKED Proxy. Every read of it throws, including the
  // `Object.prototype.toString` fallback in `isResponse` that sits outside that
  // function's own `try`. The phase catch is what holds.
  {
    name: "resolves a revoked Proxy",
    transport: (): typeof fetch => {
      const { proxy, revoke } = Proxy.revocable({}, {});
      revoke();
      return returningTransport(proxy);
    },
    verdict: "network",
    rejects: false,
  },
  // A Response returned WITHOUT a promise around it. `await` accepts it, so a
  // transport that is not async still resolves.
  {
    name: "returns a bare Response",
    transport: () => returningTransport(new Response(null, { status: 204 })),
    verdict: "success",
    rejects: false,
  },
  // A thenable. `await` calls its `then`.
  {
    name: "returns a thenable",
    transport: () =>
      returningTransport(
        thenable((resolve) => {
          resolve(new Response(null, { status: 204 }));
        }),
      ),
    verdict: "success",
    rejects: false,
  },
  // A thenable whose `then` throws. `await` turns that into a rejection, so it
  // is the transport phase's failure and not an escape.
  {
    name: "returns a thenable whose then throws",
    transport: () =>
      returningTransport(
        thenable(() => {
          throw new TypeError("hostile then");
        }),
      ),
    verdict: "network",
    rejects: true,
  },
  // A SYNCHRONOUS throw — ADR 0003 row H-16. The call sits inside the transport
  // phase's `try`, so it is caught there and never reaches the caller as one.
  {
    name: "throws synchronously",
    transport: () =>
      (() => {
        throw new TypeError("synchronous transport throw");
      }) as unknown as typeof fetch,
    verdict: "network",
    rejects: true,
  },
  // A rejection that is not an error — row H-15. `classifyRequestFailure` is
  // total over the rejection and reads no property of it before deciding.
  {
    name: "rejects with a string",
    transport: () => rejectingTransport("not an error"),
    verdict: "network",
    rejects: true,
  },
  {
    name: "rejects with undefined",
    transport: () => rejectingTransport(undefined),
    verdict: "network",
    rejects: true,
  },
];

describe("round 13 / H1 — the transport's return value is a closed set", () => {
  test.each(RETURN_SHAPES)("a transport that $name -> $verdict", async ({ transport, verdict }) => {
    const result = await typedFetch("https://closed-set.test/x", { fetch: transport() });

    if (verdict === "success") {
      expect(result.error).toBeNull();
      expect(result.response?.status).toBe(204);
      return;
    }
    expect(result.response).toBeNull();
    expect(isNetworkError(result.error)).toBe(true);
    expect(isAbortError(result.error)).toBe(false);
    expect(isTimeoutError(result.error)).toBe(false);
    expect(isHttpError(result.error)).toBe(false);
  });

  // The sweep. Every shape above, against every state the governing signal can
  // be in, checked against five properties rather than against a table of
  // answers — so a shape or a signal state added later is governed without a
  // new expectation being written for it.
  //
  //   P1  the call RESOLVES; nothing escapes as an exception.
  //   P2  exactly one arm of the envelope is populated.
  //   P3  an abort or a timeout class implies the transport REJECTED. Only the
  //       transport phase may produce one, and only a rejection is a failure it
  //       can have caused.
  //   P4  an abort or a timeout class implies the signal was aborted. The
  //       signal is the authority, never the rejection's name.
  //   P5  a resolved value's verdict does not depend on the signal at all. A
  //       response that ARRIVED is a response, whatever the signal now says.
  test("shape x signal state: five properties, no shape excepted", async () => {
    const abortedController = new AbortController();
    abortedController.abort();
    const abortedWithName = new AbortController();
    abortedWithName.abort(new DOMException("gone", "AbortError"));
    const firedTimeout = AbortSignal.timeout(1);
    await new Promise((resolve) => setTimeout(resolve, 10));

    const SIGNAL_STATES: readonly { readonly name: string; readonly signal?: AbortSignal }[] = [
      { name: "none", signal: undefined },
      { name: "live", signal: new AbortController().signal },
      { name: "aborted", signal: abortedController.signal },
      { name: "aborted-with-AbortError", signal: abortedWithName.signal },
      { name: "fired-timeout", signal: firedTimeout },
      // A signal that is not a real one and answers hostilely.
      {
        name: "hostile",
        signal: new Proxy({} as AbortSignal, {
          get(): never {
            throw new Error("hostile signal read");
          },
        }),
      },
    ];

    // The shapes above never reject with a value the signal can vouch for, so
    // P3 and P4 would be vacuous over them alone. These two are derived FROM the
    // state under test: the first is what a spec-exact runtime rejects with, the
    // second is what a polyfill builds instead. Together they are the only way
    // an abort or a timeout class is reachable at all, which is itself the
    // statement P3 and P4 make.
    const abortingShapes = (
      state: (typeof SIGNAL_STATES)[number],
    ): (typeof RETURN_SHAPES)[number][] => {
      let reason: unknown;
      try {
        reason = state.signal?.reason;
      } catch {
        reason = undefined;
      }
      return [
        {
          name: "rejects with the signal's own reason",
          transport: () => rejectingTransport(reason),
          verdict: "network",
          rejects: true,
        },
        {
          name: "rejects with a fresh AbortError",
          transport: () => rejectingTransport(new DOMException("aborted", "AbortError")),
          verdict: "network",
          rejects: true,
        },
      ];
    };

    const violations: string[] = [];
    const resolvedVerdicts = new Map<string, string>();
    let combinations = 0;
    let timingClasses = 0;

    for (const state of SIGNAL_STATES) {
      for (const shape of [...RETURN_SHAPES, ...abortingShapes(state)]) {
        combinations += 1;
        const where = `${shape.name} / ${state.name}`;
        let result: Awaited<ReturnType<typeof typedFetch>>;
        try {
          result = await typedFetch("https://sweep.test/x", {
            fetch: shape.transport(),
            signal: state.signal,
          });
        } catch (cause) {
          // P1
          violations.push(`${where}: escaped as ${String(cause)}`);
          continue;
        }

        // P2
        if ((result.response === null) === (result.error === null)) {
          violations.push(`${where}: both arms are ${String(result.error)}`);
          continue;
        }

        const timing = isAbortError(result.error) || isTimeoutError(result.error);
        if (timing) timingClasses += 1;
        // P3
        if (timing && !shape.rejects) {
          violations.push(`${where}: ${result.error?.name} for a RESOLVED value`);
        }
        // P4. The signal read is itself guarded: one of the states throws on
        // every read, and a hostile signal must not decide this test's verdict.
        let signalAborted: boolean | "unreadable";
        try {
          signalAborted = state.signal?.aborted === true;
        } catch {
          signalAborted = "unreadable";
        }
        if (timing && signalAborted !== true) {
          violations.push(`${where}: ${result.error?.name} with signal aborted=${signalAborted}`);
        }
        // P5
        if (!shape.rejects) {
          const verdict = result.error === null ? "success" : (result.error.name ?? "error");
          const seen = resolvedVerdicts.get(shape.name);
          if (seen !== undefined && seen !== verdict) {
            violations.push(`${where}: ${verdict}, but ${seen} under another signal state`);
          }
          resolvedVerdicts.set(shape.name, verdict);
        }

        await result.response?.body?.cancel();
      }
    }

    expect(violations).toEqual([]);
    // The sweep is not vacuous: every combination ran, and P3 and P4 had
    // something to govern.
    expect(combinations).toBe(SIGNAL_STATES.length * (RETURN_SHAPES.length + 2));
    expect(timingClasses).toBeGreaterThan(0);
  });

  // A foreign, standards-compatible Response assembled from parts no realm-bound
  // check recognizes: the structural arm of `isResponse` accepts it, and the
  // value the caller receives is THE SAME OBJECT, unmodified. (A genuine
  // cross-realm `Response` is not constructible here — a `node:vm` context has
  // no `Response` global at all — so the structural arm is reached this way,
  // which is the arm a cross-realm value would take.)
  test("a structurally complete foreign Response is accepted and handed back unchanged", async () => {
    const real = new Response("payload", { status: 200, headers: { "x-probe": "kept" } });
    const foreign = {} as Record<PropertyKey, unknown>;
    Object.defineProperty(foreign, Symbol.toStringTag, { value: "Response" });
    for (const field of [
      "body",
      "bodyUsed",
      "headers",
      "ok",
      "redirected",
      "status",
      "statusText",
      "type",
      "url",
    ]) {
      Object.defineProperty(foreign, field, {
        get: () => (real as unknown as Record<string, unknown>)[field],
        enumerable: true,
        configurable: true,
      });
    }
    for (const method of ["arrayBuffer", "blob", "clone", "formData", "json", "text"]) {
      foreign[method] = (): unknown =>
        (real as unknown as Record<string, () => unknown>)[method]?.call(real);
    }

    const result = await typedFetch("https://foreign.test/x", {
      fetch: returningTransport(foreign),
    });

    expect(result.error).toBeNull();
    // The same object, not a wrapper: the library validates and hands through.
    expect(result.response as unknown).toBe(foreign);
    await (result.response?.body as ReadableStream | null)?.cancel();
  });

  // Every member a lazy getter, counted. The identity fields the response phase
  // consults go through the first-read cache, so the structural verdict and the
  // classification share ONE getter answer per field.
  //
  // It does NOT contradict round 12's "a Proxy over a real Response is refused":
  // that proxy has no `get` trap, so the platform's own accessors are applied
  // with the PROXY as the receiver and throw on the missing internal slot. This
  // one forwards the receiver to the target, so the accessors answer and the
  // value is accepted. The two together say what the refusal is about — the
  // slots, not the exotic object — so the pair is pinned rather than the case.
  test("a bare Proxy over a Response is refused while a forwarding one is accepted", async () => {
    const bare = await typedFetch("https://lazy.test/x", {
      fetch: returningTransport(new Proxy(new Response("payload", { status: 200 }), {})),
    });

    expect(bare.response).toBeNull();
    expect(isNetworkError(bare.error)).toBe(true);
  });

  test("a Response whose members are all lazy getters is read once per identity field", async () => {
    const real = new Response(null, { status: 200 });
    const reads: Record<string, number> = {};
    const lazy = new Proxy(real, {
      get(target, property) {
        if (typeof property === "string") reads[property] = (reads[property] ?? 0) + 1;
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    const result = await typedFetch("https://lazy.test/x", { fetch: returningTransport(lazy) });

    expect(result.error).toBeNull();
    expect(result.response as unknown).toBe(lazy);
    expect(reads.status).toBe(1);
    expect(reads.headers).toBe(1);
  });

  // A transport that resolves AFTER the governing timeout signal fired. Under an
  // injected implementation the transport IS the request, so a value it hands
  // back is a response and never a timeout. P5 above states this as a property;
  // this states it as the concrete case, with its rejecting twin below, so
  // neither can be read as "the signal is ignored".
  test("a transport that resolves after its timeout signal fired still succeeds", async () => {
    const signal = AbortSignal.timeout(1);
    const late = (async (): Promise<Response> => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;

    const result = await typedFetch("https://late.test/x", { fetch: late, signal });

    expect(signal.aborted).toBe(true);
    expect(result.error).toBeNull();
    expect(result.response?.status).toBe(204);
  });

  test("the same late transport rejecting with its own reason is a TimeoutError", async () => {
    const signal = AbortSignal.timeout(1);
    const late = (async (): Promise<Response> => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      throw signal.reason;
    }) as unknown as typeof fetch;

    const result = await typedFetch("https://late.test/x", { fetch: late, signal });

    expect(isTimeoutError(result.error)).toBe(true);
  });
});

// ── 3. The failure and timeout paths, as an inventory ──────────────────────
//
// Round 12's H2 pinned the RESPONSE phase's read inventory as a closed set. The
// failure side never had the same treatment, and it differs in one way that
// matters: `classifyRequestFailure` and the three error constructors run INSIDE
// a catch, so a throw there leaves `typedFetch` as a rejection rather than
// becoming an error value.
//
// The inventory is closed by construction rather than by enumeration. Along
// this path the constructors are handed exactly four things, and only two of
// them come from a caller:
//
//   * `message` — a library constant, always.
//   * `url` — the string phase 1 resolved. CALLER-CONTROLLED, through the
//     input's own `toString`.
//   * `cause` — the rejection. CALLER-CONTROLLED, and stored by
//     `defineProperty` without ever being read.
//   * `reason` — the signal's snapshotted reason, stored the same way.
//
// The options object the constructors read is an own-property literal built at
// the call site, so `ownSlot` never reaches a caller's prototype or getter.
// That leaves two values to drive hostilely, and both are driven below.
describe("round 13 / H1 — the failure path is total over the values a caller controls", () => {
  test("a rejection value that throws on every read still resolves as a NetworkError", async () => {
    const hostileRejection = new Proxy(
      {},
      {
        get(): never {
          throw new Error("hostile rejection read");
        },
        has(): never {
          throw new Error("hostile rejection has");
        },
        getPrototypeOf(): never {
          throw new Error("hostile rejection prototype");
        },
      },
    );

    const result = await typedFetch("https://hostile.test/x", {
      fetch: rejectingTransport(hostileRejection),
    });

    expect(isNetworkError(result.error)).toBe(true);
    expect(result.error?.message).toBe("Network error");
    // Stored, never read.
    expect((result.error as { cause?: unknown }).cause).toBe(hostileRejection);
  });

  test("an abort reason that throws on every read still resolves as an AbortedError", async () => {
    const controller = new AbortController();
    const hostileReason = new Proxy(
      {},
      {
        get(): never {
          throw new Error("hostile reason read");
        },
      },
    );
    controller.abort(hostileReason);

    const result = await typedFetch("https://hostile.test/x", {
      fetch: rejectingTransport(hostileReason),
      signal: controller.signal,
    });

    expect(isAbortError(result.error)).toBe(true);
    expect(result.error?.message).toBe("Request aborted");
    expect((result.error as { reason?: unknown }).reason).toBe(hostileReason);
  });

  // The url the constructors are handed is `String(input)` — the caller's own
  // `toString`. A pathological one must not make a constructor throw, and the
  // message must stay the library constant whatever the string contains.
  test("a pathological serialized url does not break error construction", async () => {
    const shapes: readonly [string, string][] = [
      ["long-authority", `http://u:p@host.test/${"a".repeat(50_000)}?q=1#f`],
      ["no-scheme", "//host.test/x"],
      ["opaque", "data:text/plain,hello"],
      ["not-a-url", "%%%%"],
      ["empty", ""],
    ];
    const outcomes: string[] = [];

    for (const [name, text] of shapes) {
      const input = {
        toString(): string {
          return text;
        },
      };
      const result = await typedFetch(input as unknown as string, {
        fetch: rejectingTransport(new TypeError("refused")),
      });
      outcomes.push(
        `${name}: ${isNetworkError(result.error) ? "NetworkError" : String(result.error?.name)} ` +
          `message=${JSON.stringify(result.error?.message)}`,
      );
    }

    expect(outcomes).toEqual([
      'long-authority: NetworkError message="Network error"',
      'no-scheme: NetworkError message="Network error"',
      'opaque: NetworkError message="Network error"',
      'not-a-url: NetworkError message="Network error"',
      'empty: NetworkError message="Network error"',
    ]);
  });

  // Every class the request path can produce, each reached through the public
  // interface, each a VALUE. This is the failure inventory's completeness
  // statement: four classes, and nothing else is reachable from here.
  test("every failure class the request path can produce is a value, never a throw", async () => {
    const controller = new AbortController();
    controller.abort();
    const timeout = AbortSignal.timeout(1);
    await new Promise((resolve) => setTimeout(resolve, 10));

    const network = await typedFetch("https://f.test/x", {
      fetch: rejectingTransport(new TypeError("failed")),
    });
    const aborted = await typedFetch("https://f.test/x", {
      fetch: rejectingTransport(controller.signal.reason),
      signal: controller.signal,
    });
    const timedOut = await typedFetch("https://f.test/x", {
      fetch: rejectingTransport(timeout.reason),
      signal: timeout,
    });
    const http = await typedFetch("https://f.test/x", {
      fetch: returningTransport(new Response("x", { status: 404 })),
    });

    expect([
      isNetworkError(network.error),
      isAbortError(aborted.error),
      isTimeoutError(timedOut.error),
      isKnownHttpError(http.error),
    ]).toEqual([true, true, true, true]);
    // Every one of them names the request, so concurrent failures stay apart.
    expect([network.error?.url, aborted.error?.url, timedOut.error?.url]).toEqual([
      "https://f.test/x",
      "https://f.test/x",
      "https://f.test/x",
    ]);
    if (isHttpError(http.error)) await http.error.cancel();
  });
});

// ── 4. The seams between the three phases ──────────────────────────────────
//
// No lane owned the seams. Each test below moves the abort state across one
// seam and states which phase owns the verdict.
describe("round 13 / H1 — the seams between the three phases", () => {
  test("an abort that fires after the transport resolved does not undo the success", async () => {
    const controller = new AbortController();
    const transport = (async (): Promise<Response> => {
      const response = new Response(null, { status: 200 });
      // The response arrived. The abort lands between phase 2 and phase 3.
      controller.abort();
      return response;
    }) as unknown as typeof fetch;

    const result = await typedFetch("https://seam.test/x", {
      fetch: transport,
      signal: controller.signal,
    });

    expect(controller.signal.aborted).toBe(true);
    expect(result.error).toBeNull();
    expect(result.response?.status).toBe(200);
    await result.response?.body?.cancel();
  });

  test("a response-phase failure under an aborted signal is a NetworkError", async () => {
    const controller = new AbortController();
    const transport = (async (): Promise<unknown> => {
      controller.abort();
      return { notAResponse: true };
    }) as unknown as typeof fetch;

    const result = await typedFetch("https://seam.test/x", {
      fetch: transport,
      signal: controller.signal,
    });

    // Only the transport phase may answer with an abort.
    expect(isNetworkError(result.error)).toBe(true);
    expect(isAbortError(result.error)).toBe(false);
  });

  test("a response-phase failure while a timeout deadline passes is a NetworkError", async () => {
    const signal = AbortSignal.timeout(1);
    // The deadline passes while the response phase is still deciding.
    const transport = (async (): Promise<unknown> => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { notAResponse: true };
    }) as unknown as typeof fetch;

    const result = await typedFetch("https://seam.test/x", { fetch: transport, signal });

    expect(signal.aborted).toBe(true);
    expect(isNetworkError(result.error)).toBe(true);
    expect(isTimeoutError(result.error)).toBe(false);
  });

  // The window in which the OPTIONS can be mutated between the setup read and
  // the transport call is exactly one hook wide: phase 1 is synchronous, and the
  // only caller code it runs after the input is resolved is the `signal` slot's
  // own getter. What that getter changes afterwards is what the transport reads,
  // because the init delegates LIVE to the caller's object.
  //
  // RECORDED DIVERGENCE, not claimed as a defect. A bare `fetch` converts its
  // init as a WebIDL dictionary, in lexicographic member order, so `method` is
  // read BEFORE `signal` and a `signal` getter that rewrites `method` changes
  // nothing. `typedFetch` reads `signal` first, in phase 1, so the same getter
  // does change it. Both require the caller to write a self-mutating options
  // object; no ADR 0003 row covers it, and no caller observes a wrong request
  // it did not describe itself. Pinned so a later round meets it as a decision.
  test("a signal getter that mutates its own options is seen by the transport", async () => {
    const transport = recordingTransport();
    const options = { method: "GET" } as Record<string, unknown>;
    Object.defineProperty(options, "signal", {
      get(): undefined {
        options.method = "PUT";
        return undefined;
      },
      enumerable: true,
      configurable: true,
    });
    options.fetch = transport.fetch;

    await typedFetch("https://mutate.test/x", options as TypedFetchOptions);

    expect(transport.inputs).toHaveLength(1);
    expect((transport.inits[0] as RequestInit).method).toBe("PUT");
  });

  // The signal is captured ONCE. A slot that answers a different signal on each
  // read cannot make the classifier consult one the transport never governed.
  test("a signal slot read twice cannot split the transport from the classifier", async () => {
    const governing = new AbortController();
    governing.abort();
    const decoy = new AbortController();
    let reads = 0;
    const options = {
      get signal(): AbortSignal {
        reads += 1;
        return reads === 1 ? governing.signal : decoy.signal;
      },
      fetch: rejectingTransport(governing.signal.reason),
    };

    const result = await typedFetch("https://once.test/x", options as TypedFetchOptions);

    expect(reads).toBe(1);
    expect(isAbortError(result.error)).toBe(true);
  });

  // Re-entrancy across the seam: a transport that performs its own `typedFetch`
  // before answering. The module-scoped tables are keyed per response, so the
  // inner call cannot file anything against the outer one's value.
  test("a transport that re-enters typedFetch keeps the two calls' identities apart", async () => {
    const inner = new Response("inner", { status: 404 });
    const outer = new Response("outer", { status: 200 });
    const reentrant = (async (): Promise<Response> => {
      const nested = await typedFetch("https://inner.test/x", {
        fetch: returningTransport(inner),
      });
      expect(isKnownHttpError(nested.error)).toBe(true);
      if (isHttpError(nested.error)) {
        expect(nested.error.status).toBe(404);
        await nested.error.cancel();
      }
      return outer;
    }) as unknown as typeof fetch;

    const result = await typedFetch("https://outer.test/x", { fetch: reentrant });

    expect(result.error).toBeNull();
    expect(result.response?.status).toBe(200);
    await result.response?.body?.cancel();
  });
});

// ── 5. Two package copies, on the REQUEST path ─────────────────────────────
//
// Round 10's H2 proved the guards agree across copies for errors built by
// CONSTRUCTOR. This asks the same question of `typedFetch`: an error a second
// copy's REQUEST PATH produced, asked of this copy's guards and of both dist
// copies'. Four families x two producers x five guards x three askers.
const distExists = existsSync(new URL("./dist/index.mjs", import.meta.url));
const requireDist = createRequire(import.meta.url);

interface RequestCopy {
  readonly typedFetch: (
    url: unknown,
    options?: unknown,
  ) => Promise<{ readonly response: unknown; readonly error: unknown }>;
  readonly isHttpError: (value: unknown) => boolean;
  readonly isKnownHttpError: (value: unknown) => boolean;
  readonly isNetworkError: (value: unknown) => boolean;
  readonly isAbortError: (value: unknown) => boolean;
  readonly isTimeoutError: (value: unknown) => boolean;
}

const GUARDS = [
  "isNetworkError",
  "isAbortError",
  "isTimeoutError",
  "isHttpError",
  "isKnownHttpError",
] as const;

type GuardName = (typeof GUARDS)[number];

const EXPECTED: Record<string, Record<GuardName, boolean>> = {
  NetworkError: {
    isNetworkError: true,
    isAbortError: false,
    isTimeoutError: false,
    isHttpError: false,
    isKnownHttpError: false,
  },
  AbortedError: {
    isNetworkError: false,
    isAbortError: true,
    isTimeoutError: false,
    isHttpError: false,
    isKnownHttpError: false,
  },
  TimeoutError: {
    isNetworkError: false,
    isAbortError: false,
    isTimeoutError: true,
    isHttpError: false,
    isKnownHttpError: false,
  },
  NotFoundError: {
    isNetworkError: false,
    isAbortError: false,
    isTimeoutError: false,
    isHttpError: true,
    isKnownHttpError: true,
  },
};

describe.skipIf(!distExists)("round 13 / H1 — the request path across two package copies", () => {
  test("errors each copy's typedFetch produced are recognized by every copy's guards", async () => {
    const esm = (await import(
      /* @vite-ignore */ new URL("./dist/index.mjs", import.meta.url).href
    )) as unknown as RequestCopy;
    const cjs = requireDist("./dist/index.js") as RequestCopy;
    const local: RequestCopy = {
      typedFetch: typedFetch as unknown as RequestCopy["typedFetch"],
      isHttpError,
      isKnownHttpError,
      isNetworkError,
      isAbortError,
      isTimeoutError,
    };
    const producers: [string, RequestCopy][] = [
      ["esm", esm],
      ["cjs", cjs],
    ];
    const askers: [string, RequestCopy][] = [...producers, ["src", local]];

    const disagreements: string[] = [];
    const toCancel: { cancel: () => Promise<void> }[] = [];

    for (const [producerName, producer] of producers) {
      const controller = new AbortController();
      controller.abort();
      const timeout = AbortSignal.timeout(1);
      await new Promise((resolve) => setTimeout(resolve, 10));

      const produced: [string, unknown][] = [
        [
          "NetworkError",
          (
            await producer.typedFetch("https://copies.test/x", {
              fetch: rejectingTransport(new TypeError("failed")),
            })
          ).error,
        ],
        [
          "AbortedError",
          (
            await producer.typedFetch("https://copies.test/x", {
              fetch: rejectingTransport(controller.signal.reason),
              signal: controller.signal,
            })
          ).error,
        ],
        [
          "TimeoutError",
          (
            await producer.typedFetch("https://copies.test/x", {
              fetch: rejectingTransport(timeout.reason),
              signal: timeout,
            })
          ).error,
        ],
        [
          "NotFoundError",
          (
            await producer.typedFetch("https://copies.test/x", {
              fetch: returningTransport(new Response("x", { status: 404 })),
            })
          ).error,
        ],
      ];

      for (const [family, error] of produced) {
        if (family === "NotFoundError") {
          toCancel.push(error as { cancel: () => Promise<void> });
        }
        for (const guard of GUARDS) {
          for (const [askerName, asker] of askers) {
            const answered = asker[guard](error);
            const want = EXPECTED[family]?.[guard];
            if (answered !== want) {
              disagreements.push(
                `${family} from ${producerName}, asked by ${askerName}.${guard}: ` +
                  `${answered} instead of ${want}`,
              );
            }
          }
        }
      }
    }

    await Promise.all(toCancel.map((error) => error.cancel()));
    expect(disagreements).toEqual([]);
  });
});
