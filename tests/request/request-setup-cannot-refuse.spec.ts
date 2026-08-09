import { describe, test, expect } from "vitest";
import {
  isAbortError,
  isHttpError,
  isNetworkError,
  isTimeoutError,
  typedFetch,
} from "../../src/index";
import { planFailure, planRequest } from "../../src/request-plan";
import type { RequestPlan, TypedFetchOptions } from "../../src/request-plan";
import { recordingTransport } from "../../fixtures/recording-transport";

// Round 12, lane H1 — the setup phase's read inventory, stated as a PROPERTY
// rather than as a list, and the transport seam's return value.
//
// Round 11 removed the last predicate in front of the `signal` read and wrote
// down the rule the three rounds before it kept re-deriving:
//
//   No read the setup phase performs to DESCRIBE a request can stop the
//   transport from running. Only the reads that PRODUCE what the transport
//   receives — the input serialization, the transport selection, the init —
//   may end a call.
//
// It also recorded that the read inventory behind that rule had been written
// twice and been incomplete both times. A list is incomplete silently; a
// property is not. So this file does not enumerate reads. It generates a
// population of inputs that answer every read hostilely, in every combination,
// and asserts the rule directly: a PLAN was built, for every input a transport
// could have been given.
//
// The property is now asked of `planRequest` itself. It used to be asked of a
// whole request through an injected transport, because the plan had no
// interface: "the transport ran, exactly once, and received X" was the only way
// to observe a decision the setup phase had already made synchronously. The
// transport double was measuring instrument and subject at once.
//
// The oracle is deliberately not a re-implementation of `classifyRequestInput`.
// It asks one question the library does not get to answer — can this value be
// converted to a string at all? — and the rule follows from it:
//
//   * the plan hands over the input ITSELF, or
//   * the plan hands over exactly `String(input)`, or
//   * `String(input)` throws AND the input was not handed over, which is the
//     one state in which no request is possible at all.
//
// Anything else is a describing read that ended a call.

const ABSOLUTE = "http://127.0.0.1:1/round12-h1";

/** A transport that rejects with exactly what a platform abort rejects with. */
function rejectingTransport(reason: unknown): typeof fetch {
  return (async (): Promise<Response> => {
    throw reason;
  }) as unknown as typeof fetch;
}

/**
 * A thenable, defined rather than written as a literal.
 *
 * `unicorn/no-thenable` forbids a literal `then` member, and it is right about
 * ordinary code. A thenable at the TRANSPORT SEAM is this file's subject: the
 * `await` in the transport phase takes any thenable, so an injected
 * implementation is not obliged to answer with a `Promise` at all.
 */
function thenableWith(descriptor: PropertyDescriptor): unknown {
  const value = {};
  // oxlint-disable-next-line no-thenable -- a thenable at the transport seam IS the test
  Object.defineProperty(value, "then", { configurable: true, ...descriptor });
  return value;
}

/** `String(value)`, as a value rather than as an exception. */
function serializationOf(value: unknown): { readonly ok: boolean; readonly text: string } {
  try {
    return { ok: true, text: String(value) };
  } catch {
    return { ok: false, text: "" };
  }
}

/** `planRequest(value, options)`, as a value rather than as an exception. */
function planOf(
  value: unknown,
  options: TypedFetchOptions,
): { readonly plan: RequestPlan | null; readonly refusal: unknown } {
  try {
    return { plan: planRequest(value as never, options), refusal: undefined };
  } catch (refusal) {
    return { plan: null, refusal };
  }
}

type Slot = { readonly label: string; readonly define: (target: object) => void };

/** How the input answers the tag read — `hasRequestTag`'s only input. */
const TAG_SLOTS: readonly Slot[] = [
  { label: "no tag", define: () => {} },
  {
    label: "tag=Request",
    define: (o) =>
      Object.defineProperty(o, Symbol.toStringTag, { value: "Request", configurable: true }),
  },
  {
    label: "tag getter throws",
    define: (o) =>
      Object.defineProperty(o, Symbol.toStringTag, {
        get(): string {
          throw new Error("hostile tag getter");
        },
        configurable: true,
      }),
  },
  {
    label: "tag getter answers Request",
    define: (o) =>
      Object.defineProperty(o, Symbol.toStringTag, { get: () => "Request", configurable: true }),
  },
  {
    label: "tag=42",
    define: (o) => Object.defineProperty(o, Symbol.toStringTag, { value: 42, configurable: true }),
  },
];

/** How the input answers the `url` read — the correlation field's only source. */
const URL_SLOTS: readonly Slot[] = [
  { label: "no url", define: () => {} },
  {
    label: "url=string",
    define: (o) => Object.defineProperty(o, "url", { value: ABSOLUTE, configurable: true }),
  },
  {
    label: "url=number",
    define: (o) => Object.defineProperty(o, "url", { value: 8443, configurable: true }),
  },
  {
    label: "url getter throws",
    define: (o) =>
      Object.defineProperty(o, "url", {
        get(): string {
          throw new Error("hostile url getter");
        },
        configurable: true,
      }),
  },
  {
    label: "url getter answers an object",
    define: (o) => Object.defineProperty(o, "url", { get: () => ({}), configurable: true }),
  },
];

/** How the input answers the `signal` read — round 11's whole subject. */
const SIGNAL_SLOTS: readonly Slot[] = [
  { label: "no signal", define: () => {} },
  {
    label: "signal=undefined",
    define: (o) => Object.defineProperty(o, "signal", { value: undefined, configurable: true }),
  },
  {
    label: "signal=live",
    define: (o) =>
      Object.defineProperty(o, "signal", {
        value: new AbortController().signal,
        configurable: true,
      }),
  },
  {
    label: "signal=aborted",
    define: (o) => {
      const controller = new AbortController();
      controller.abort();
      Object.defineProperty(o, "signal", { value: controller.signal, configurable: true });
    },
  },
  {
    label: "signal getter throws",
    define: (o) =>
      Object.defineProperty(o, "signal", {
        get(): AbortSignal {
          throw new Error("hostile signal getter");
        },
        configurable: true,
      }),
  },
  {
    label: "signal is not a signal",
    define: (o) =>
      Object.defineProperty(o, "signal", { value: { aborted: true }, configurable: true }),
  },
  {
    label: "signal's aborted throws",
    define: (o) =>
      Object.defineProperty(o, "signal", {
        value: {
          get aborted(): boolean {
            throw new Error("hostile aborted getter");
          },
        },
        configurable: true,
      }),
  },
];

/** How the input answers the SERIALIZATION — the one producing read on it. */
const TO_STRING_SLOTS: readonly Slot[] = [
  { label: "inherited toString", define: () => {} },
  {
    label: "toString answers a url",
    define: (o) =>
      Object.defineProperty(o, "toString", { value: () => ABSOLUTE, configurable: true }),
  },
  {
    label: "toString throws",
    define: (o) =>
      Object.defineProperty(o, "toString", {
        value: () => {
          throw new Error("hostile toString");
        },
        configurable: true,
      }),
  },
];

/**
 * The prototype decides `isPlatformRequest`, which is a prototype-CHAIN
 * question and therefore the read a `Proxy` or an `Object.create` separates
 * from every other fact about the value.
 */
const PROTOTYPES: readonly { readonly label: string; readonly value: object }[] = [
  { label: "ordinary object", value: Object.prototype },
  { label: "Request.prototype", value: Request.prototype },
];

/** Every combination of the reads above, on one value each. */
function generatedPopulation(): { readonly label: string; readonly value: unknown }[] {
  const population: { label: string; value: unknown }[] = [];
  for (const prototype of PROTOTYPES) {
    for (const tag of TAG_SLOTS) {
      for (const url of URL_SLOTS) {
        for (const signal of SIGNAL_SLOTS) {
          for (const toString of TO_STRING_SLOTS) {
            const value = Object.create(prototype.value) as object;
            tag.define(value);
            url.define(value);
            signal.define(value);
            toString.define(value);
            population.push({
              label: `${prototype.label} / ${tag.label} / ${url.label} / ${signal.label} / ${toString.label}`,
              value,
            });
          }
        }
      }
    }
  }
  return population;
}

/** Exotic values no descriptor combination can build. */
function exoticPopulation(): { readonly label: string; readonly value: unknown }[] {
  const revocable = Proxy.revocable({ [Symbol.toStringTag]: "Request", url: ABSOLUTE }, {});
  revocable.revoke();

  class ThrowingSignal extends Request {
    override get signal(): AbortSignal {
      throw new Error("hostile subclass signal getter");
    }
  }
  class ForgedSignal extends Request {
    override get signal(): AbortSignal {
      return { aborted: true, reason: "forged" } as unknown as AbortSignal;
    }
  }

  return [
    { label: "a plain string", value: ABSOLUTE },
    { label: "a URL object", value: new URL(ABSOLUTE) },
    { label: "a platform Request", value: new Request(ABSOLUTE) },
    { label: "a revoked Proxy", value: revocable.proxy },
    { label: "a default Proxy over a Request", value: new Proxy(new Request(ABSOLUTE), {}) },
    {
      label: "a forwarding Proxy over a Request",
      value: new Proxy(new Request(ABSOLUTE), {
        get: (target, property) => Reflect.get(target, property, target) as unknown,
      }),
    },
    {
      label: "a Proxy whose signal read throws on both paths",
      value: new Proxy(new Request(ABSOLUTE), {
        get(target, property) {
          if (property === "signal") throw new Error("the plain read throws too");
          return Reflect.get(target, property, target) as unknown;
        },
      }),
    },
    {
      label: "a Proxy whose prototype walk throws",
      value: new Proxy(
        { [Symbol.toStringTag]: "Request", url: ABSOLUTE },
        {
          getPrototypeOf() {
            throw new Error("hostile prototype walk");
          },
        },
      ),
    },
    { label: "Object.create(Request.prototype)", value: Object.create(Request.prototype) },
    { label: "a Request subclass whose signal getter throws", value: new ThrowingSignal(ABSOLUTE) },
    { label: "a Request subclass whose signal getter forges", value: new ForgedSignal(ABSOLUTE) },
    { label: "null", value: null },
    { label: "a number", value: 42 },
  ];
}

describe("the setup phase never refuses a request that could have been made", () => {
  test("over 1063 hostile inputs, a plan was built whenever a request is possible", () => {
    // The population answers each of the setup phase's reads hostilely, in
    // every combination, so a read this file does not know about is covered by
    // the same assertion as the four it does. That is the difference between a
    // property and the inventory round 11 recorded as twice incomplete.
    //
    // A caller transport, because that is the arm that takes the WIDE tag check
    // and therefore hands over the largest set of inputs. It is never called:
    // the plan is the whole subject.
    const options = { fetch: recordingTransport().fetch };
    const population = [...generatedPopulation(), ...exoticPopulation()];
    // A witness count per outcome, asserted below, so the property cannot pass
    // by generating a population that reaches only one arm of the rule.
    let handedOver = 0;
    let serialized = 0;
    let unserializable = 0;
    const violations: string[] = [];

    for (const { label, value } of population) {
      const { plan, refusal } = planOf(value, options);
      // Every slot above is stateless, so the oracle can ask the value the
      // same question the setup phase asked it, after the fact.
      const text = serializationOf(value);

      if (plan !== null && plan.transportInput === value) {
        // Handed over whole. No serialization was needed, so nothing about
        // this value could have refused the request.
        handedOver += 1;
        continue;
      }
      if (text.ok) {
        // The one string this module produces, and the transport must receive
        // exactly it.
        serialized += 1;
        if (plan === null) {
          violations.push(
            `${label}: String(input) is ${JSON.stringify(text.text)}, yet the plan was refused`,
          );
          continue;
        }
        if (plan.transportInput !== text.text) {
          violations.push(
            `${label}: the plan hands over ${JSON.stringify(plan.transportInput)}, not ${JSON.stringify(text.text)}`,
          );
          continue;
        }
        if (plan.requestUrl !== text.text) {
          violations.push(`${label}: the plan filed a url the transport never receives`);
        }
        continue;
      }
      // The input cannot be converted to a string and no transport takes it as
      // a request: there is nothing to send. This is the ONLY state in which
      // the setup phase may end the call, and the failure is a network failure
      // with no url, because no url was ever produced.
      unserializable += 1;
      if (plan !== null) {
        violations.push(`${label}: String(input) throws, yet a plan was built`);
        continue;
      }
      const error: { readonly name: string; readonly url: string } = planFailure(refusal);
      if (!isNetworkError(error)) {
        violations.push(`${label}: expected a NetworkError, got ${error.name}`);
        continue;
      }
      if (error.url !== "") {
        violations.push(`${label}: the refusal filed a url it never produced`);
      }
    }

    expect(violations).toEqual([]);
    expect(population.length).toBe(1063);
    // The three arms are pinned by COUNT, not merely by presence. An empty
    // violation list proves nothing about a population that reached one arm,
    // and a change that moves an input from one arm to another — a widened tag
    // check, a narrowed handover — is a decision this file should force someone
    // to make on purpose.
    expect({ handedOver, serialized, unserializable }).toEqual({
      handedOver: 744,
      serialized: 178,
      unserializable: 141,
    });
    expect(handedOver + serialized + unserializable).toBe(population.length);
  });

  test("the same population reaches a transport through typedFetch", async () => {
    // The end-to-end half, kept as a sample rather than as the property. The
    // property above is about the PLAN; this is about the plan being what the
    // transport is actually given. Three inputs, one per arm of the rule.
    const handedOver = { [Symbol.toStringTag]: "Request", url: ABSOLUTE } as unknown as Request;
    const serializable = {
      toString(): string {
        return ABSOLUTE;
      },
    };
    const unserializable = {
      toString(): never {
        throw new RangeError("no string for you");
      },
    };

    const first = recordingTransport();
    expect((await typedFetch(handedOver, { fetch: first.fetch })).error).toBe(null);
    expect(first.inputs).toEqual([handedOver]);

    const second = recordingTransport();
    expect(
      (await typedFetch(serializable as unknown as string, { fetch: second.fetch })).error,
    ).toBe(null);
    expect(second.inputs).toEqual([ABSOLUTE]);

    const third = recordingTransport();
    const refused = await typedFetch(unserializable as unknown as string, { fetch: third.fetch });
    expect(third.inputs).toEqual([]);
    expect(isNetworkError(refused.error)).toBe(true);
    expect(refused.error?.url).toBe("");
  });
});

describe("the reads that produce what the transport receives", () => {
  // The other half of the rule. These reads MAY end a call, and each one ends
  // it the same way: a refusal, never an escaping exception; a `NetworkError`,
  // never an abort or a timeout; the platform's own exception on `cause`; and
  // the url already filed, because the plan resolves the input BEFORE it reads
  // options.
  const hostileOptions: readonly {
    readonly label: string;
    readonly make: (transport: typeof fetch) => unknown;
    readonly cause: string;
  }[] = [
    {
      label: "the fetch override's getter throws",
      make: () => ({
        get fetch(): typeof fetch {
          throw new Error("hostile fetch getter");
        },
      }),
      cause: "hostile fetch getter",
    },
    {
      label: "the signal slot's getter throws",
      make: (transport) => ({
        fetch: transport,
        get signal(): AbortSignal {
          throw new Error("hostile signal getter");
        },
      }),
      cause: "hostile signal getter",
    },
    {
      label: "a Proxy whose getOwnPropertyDescriptor trap throws",
      make: (transport) =>
        new Proxy(
          { fetch: transport },
          {
            getOwnPropertyDescriptor() {
              throw new Error("hostile descriptor trap");
            },
          },
        ),
      cause: "hostile descriptor trap",
    },
    {
      label: "a Proxy whose ownKeys trap throws",
      make: (transport) =>
        new Proxy(
          { fetch: transport },
          {
            ownKeys() {
              throw new Error("hostile ownKeys trap");
            },
          },
        ),
      cause: "hostile ownKeys trap",
    },
    {
      label: "a Proxy whose getPrototypeOf trap throws",
      make: (transport) =>
        new Proxy(
          { fetch: transport },
          {
            getPrototypeOf() {
              throw new Error("hostile prototype trap");
            },
          },
        ),
      cause: "hostile prototype trap",
    },
  ];

  test.each(hostileOptions)("$label refuses the plan as a network failure", ({ make, cause }) => {
    const transport = recordingTransport();
    const { plan, refusal } = planOf(ABSOLUTE, make(transport.fetch) as TypedFetchOptions);

    expect(plan).toBe(null);
    const error = planFailure(refusal);
    expect(isNetworkError(error)).toBe(true);
    expect(isAbortError(error)).toBe(false);
    expect(isTimeoutError(error)).toBe(false);
    // The INPUT is resolved first and from the input alone, so a failure while
    // the options are read is still correlated with the request it belongs to.
    expect(error.url).toBe(ABSOLUTE);
    expect((error.cause as Error).message).toBe(cause);
  });

  test("a refused plan ends a typedFetch call as a network failure", async () => {
    // One representative, through the public interface, because the plan's
    // refusal and the caller's envelope are two different promises. The five
    // shapes above are the plan's subject; this is the envelope's.
    const transport = recordingTransport();
    const first = hostileOptions[0]!;

    const { response, error } = await typedFetch(ABSOLUTE, first.make(transport.fetch) as never);

    expect(transport.inputs).toEqual([]);
    expect(response).toBe(null);
    expect(isNetworkError(error)).toBe(true);
    expect(isAbortError(error)).toBe(false);
    expect(isTimeoutError(error)).toBe(false);
    expect((error as unknown as { readonly url: string }).url).toBe(ABSOLUTE);
    expect((error as unknown as { readonly cause: Error }).cause.message).toBe(first.cause);
  });

  test("an options signal slot that answers twice puts the first answer in the init", () => {
    // The signal is captured ONCE. The init the transport receives must carry
    // that same capture, or the classifier and the request would be governed by
    // two different signals.
    const second = new AbortController().signal;
    let reads = 0;
    const options = {
      fetch: recordingTransport().fetch,
      get signal(): AbortSignal | undefined {
        reads += 1;
        return reads === 1 ? undefined : second;
      },
    };

    const plan = planRequest(ABSOLUTE, options);

    expect(reads).toBe(1);
    expect((plan.init as { readonly signal?: unknown }).signal).toBe(undefined);
    expect((plan.init as { readonly signal?: unknown }).signal).not.toBe(second);
    // Reading the init again does not re-run the caller's getter.
    expect(reads).toBe(1);
  });
});

describe("the signal a handed-over Request contributes", () => {
  test("the prototype accessor answers before an own decoy does", () => {
    // `Request.prototype.signal` reports the slot the platform aborts on, and
    // an own data property shadows it for every plain read. The accessor is
    // tried first for exactly this reason.
    const request = new Request(ABSOLUTE, { signal: new AbortController().signal });
    const governing = request.signal;
    Object.defineProperty(request, "signal", {
      configurable: true,
      value: new AbortController().signal,
    });

    expect(planRequest(request, {}).signal).toBe(governing);
  });

  test("a subclass whose signal getter throws does not degrade the classification", async () => {
    // The accessor is applied to the INSTANCE, so a subclass override on the
    // prototype chain never runs: the slot answers, the abort is classified as
    // an abort, and the throwing override reaches nothing.
    const governing = new AbortController();
    governing.abort();
    class ThrowingSignal extends Request {
      override get signal(): AbortSignal {
        throw new Error("hostile subclass signal getter");
      }
    }
    const request = new ThrowingSignal(ABSOLUTE, { signal: governing.signal });

    const { error } = await typedFetch(request, {
      fetch: rejectingTransport(governing.signal.reason),
    });

    expect(isAbortError(error)).toBe(true);
  });

  test("a subclass whose signal getter forges an abort cannot claim one", async () => {
    // The mirror case, and it is why the ORDER matters rather than merely the
    // totality: the slot is not aborted, so an ordinary network failure stays
    // a network failure however the override answers.
    class ForgedSignal extends Request {
      override get signal(): AbortSignal {
        return { aborted: true, reason: "forged" } as unknown as AbortSignal;
      }
    }
    const request = new ForgedSignal(ABSOLUTE);

    const { error } = await typedFetch(request, {
      fetch: rejectingTransport(new TypeError("fetch failed")),
    });

    expect(isNetworkError(error)).toBe(true);
    expect(isAbortError(error)).toBe(false);
  });

  test("a signal whose aborted getter throws reports a network failure, never a rejection", async () => {
    // The snapshot is read OUTSIDE the transport phase's `try`, on the line
    // before it. It must be total, or a signal a handed-over input contributed
    // would make the envelope itself reject.
    const tagged = {
      [Symbol.toStringTag]: "Request",
      url: ABSOLUTE,
      signal: {
        get aborted(): boolean {
          throw new Error("hostile aborted getter");
        },
      },
    } as unknown as Request;

    const transport = rejectingTransport(new TypeError("fetch failed"));
    // The plan captures it without reading it: a describing read never refuses.
    // Identity, never structure — a deep comparison would read `aborted`.
    const captured: unknown = planRequest(tagged, { fetch: transport }).signal;
    expect(captured === (tagged as unknown as { readonly signal: unknown }).signal).toBe(true);

    const { error } = await typedFetch(tagged, { fetch: transport });

    expect(isNetworkError(error)).toBe(true);
    expect(isAbortError(error)).toBe(false);
    expect(isTimeoutError(error)).toBe(false);
  });

  test("a forged timeout reason on a tagged input is believed, as a forged platform shape is", async () => {
    // Documented honesty, pinned so the fallback chain's acceptance of a
    // non-platform signal is a decision rather than an accident: a tagged
    // non-platform input reaches the plain read, and whatever it answers with
    // is the only signal the caller's own transport could have consulted.
    const reason = new DOMException("timed out", "TimeoutError");
    const tagged = {
      [Symbol.toStringTag]: "Request",
      url: ABSOLUTE,
      signal: { aborted: true, reason },
    } as unknown as Request;

    const { error } = await typedFetch(tagged, { fetch: rejectingTransport(reason) });

    expect(isTimeoutError(error)).toBe(true);
  });
});

describe("what the transport resolves", () => {
  test("a thenable that is not a promise still resolves through the envelope", async () => {
    // `await` takes any thenable, so the transport seam's return value is not
    // constrained to a `Promise`. The resolved value is what phase 3 inspects.
    const transport = (() =>
      thenableWith({
        value: (resolve: (value: Response) => void) => resolve(new Response(null, { status: 200 })),
      })) as unknown as typeof fetch;

    const { response, error } = await typedFetch(ABSOLUTE, { fetch: transport });

    expect(error).toBe(null);
    expect(response?.status).toBe(200);
  });

  test("a thenable whose then throws is a network failure, not a rejection", async () => {
    const transport = (() =>
      thenableWith({
        value: () => {
          throw new Error("hostile then");
        },
      })) as unknown as typeof fetch;

    const { response, error } = await typedFetch(ABSOLUTE, { fetch: transport });

    expect(response).toBe(null);
    expect(isNetworkError(error)).toBe(true);
    expect((error as unknown as { readonly cause: Error }).cause.message).toBe("hostile then");
  });

  test("a returned object whose then getter throws is a network failure", async () => {
    // The `then` READ happens before the call, inside the promise resolution
    // machinery, so it is a third way the transport's return value can fail.
    const transport = (() =>
      thenableWith({
        get(): unknown {
          throw new Error("hostile then getter");
        },
      })) as unknown as typeof fetch;

    const { response, error } = await typedFetch(ABSOLUTE, { fetch: transport });

    expect(response).toBe(null);
    expect(isNetworkError(error)).toBe(true);
    expect((error as unknown as { readonly cause: Error }).cause.message).toBe(
      "hostile then getter",
    );
  });

  test("a Proxy over a real Response is refused rather than escaping as a success", async () => {
    // A proxy carries the target's prototype chain and its tag, so every
    // structural check about the SHAPE passes. What it cannot carry is the
    // internal slots: the platform's own accessors are applied with the proxy
    // as the receiver and throw. The value must not escape as a typed success,
    // because the members `TypedResponse` promises would throw for the caller.
    const transport = (() =>
      Promise.resolve(
        new Proxy(new Response("payload", { status: 200 }), {}),
      )) as unknown as typeof fetch;

    const { response, error } = await typedFetch(ABSOLUTE, { fetch: transport });

    expect(response).toBe(null);
    expect(isNetworkError(error)).toBe(true);
    expect(isHttpError(error)).toBe(false);
  });

  test("a resolution that arrives after the governing timeout fired is still that resolution", async () => {
    // The transport IS the request when caller code runs as the transport, so a
    // transport that ignores the signal and answers anyway has answered. Phase
    // 3 does not consult the signal, and this pins that it must not start: a
    // response the caller's own implementation produced is not an abort.
    const signal = AbortSignal.timeout(1);
    const transport = (async (): Promise<Response> => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;

    const { response, error } = await typedFetch(ABSOLUTE, { fetch: transport, signal });

    expect(signal.aborted).toBe(true);
    expect(error).toBe(null);
    expect(response?.status).toBe(200);
  });

  test("a rejection that is not an error, while the governing signal is aborted, stays a network failure", async () => {
    const controller = new AbortController();
    controller.abort();
    const transport = (() => Promise.reject("a plain string rejection")) as unknown as typeof fetch;

    const { response, error } = await typedFetch(ABSOLUTE, {
      fetch: transport,
      signal: controller.signal,
    });

    expect(response).toBe(null);
    expect(isNetworkError(error)).toBe(true);
    expect(isAbortError(error)).toBe(false);
    expect((error as unknown as { readonly cause: unknown }).cause).toBe(
      "a plain string rejection",
    );
  });
});
