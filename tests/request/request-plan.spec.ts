import { describe, expect, test } from "vitest";
import { isAbortError, isNetworkError, isTimeoutError } from "../../src/index";
import { planFailure, planRequest } from "../../src/request-plan";
import { recordingTransport } from "../../fixtures/recording-transport";

// The setup phase's own interface.
//
// The other `request-*` files ask this module about one behavior each, from the
// side the behavior was found on. This file asks it about the interface: the six
// members of the plan, what each one is for, and the one promise the module
// makes about failure.
//
// It exists because the setup phase now HAS an interface. Before, "what does the
// transport receive" and "which signal governs" were answerable only by driving
// a request and reading a transport double's arrays, so a test of the setup
// phase cost fifteen lines minimum and thirty typically. These cost three.

const ABSOLUTE = "https://plan.test/resource";

describe("the plan a call runs on", () => {
  test("an ordinary string input produces every member", () => {
    const transport = recordingTransport();
    const signal = new AbortController().signal;

    const plan = planRequest(ABSOLUTE, { fetch: transport.fetch, method: "POST", signal });

    expect(plan.transportInput).toBe(ABSOLUTE);
    expect(plan.requestUrl).toBe(ABSOLUTE);
    expect(plan.signal).toBe(signal);
    expect(plan.transport).toBe(transport.fetch);
    expect(plan.ambientTransport).toBe(false);
    expect(plan.init.method).toBe("POST");
    expect(plan.init.signal).toBe(signal);
  });

  test("no options at all runs the platform's own transport", () => {
    const plan = planRequest(ABSOLUTE, {});

    expect(plan.transport).toBe(globalThis.fetch);
    expect(plan.ambientTransport).toBe(true);
    expect(plan.signal).toBe(undefined);
  });

  test("an own fetch: undefined keeps the ambient transport while carrying the key", () => {
    // The distinction the module draws everywhere: which transport RUNS, never
    // whether a KEY is present. The key is present here and the platform still
    // runs, so the abort window the transport phase opens still applies.
    const plan = planRequest(ABSOLUTE, { fetch: undefined });

    expect(plan.ambientTransport).toBe(true);
    // The key was own, so the init hides the extension anyway.
    expect("fetch" in plan.init).toBe(false);
  });

  test("a URL object is serialized once, and the transport receives that string", () => {
    const plan = planRequest(new URL(ABSOLUTE), { fetch: recordingTransport().fetch });

    expect(plan.transportInput).toBe(ABSOLUTE);
    expect(plan.requestUrl).toBe(ABSOLUTE);
  });

  test("a platform Request is handed over whole, and files its own url", () => {
    const request = new Request(ABSOLUTE);

    const plan = planRequest(request, {});

    expect(plan.transportInput).toBe(request);
    expect(plan.requestUrl).toBe(ABSOLUTE);
  });

  test("an inherited fetch is neither used nor stripped", () => {
    // ADR 0003 row H-22. The override is an OWN-property read, so a polluted
    // prototype cannot redirect the transport — and the read that STRIPS the
    // extension is guarded by the same predicate, so an inherited `fetch` stays
    // on the object where WebIDL ignores it.
    const transport = recordingTransport();
    const polluted = Object.create({ fetch: transport.fetch }) as { fetch?: typeof fetch };

    const plan = planRequest(ABSOLUTE, polluted);

    expect(plan.transport).toBe(globalThis.fetch);
    expect(plan.ambientTransport).toBe(true);
    // Not stripped: the caller's own object still reports it.
    expect((plan.init as { readonly fetch?: unknown }).fetch).toBe(transport.fetch);
    expect(transport.inputs).toEqual([]);
  });
});

describe("a refused plan", () => {
  test("null options refuse the plan with the url already filed", () => {
    // The ordinary consumer slip. `Object.hasOwn(null, …)` throws, and the
    // correlation between a log line and a request used to go with it.
    let thrown: unknown;
    try {
      planRequest(ABSOLUTE, null as never);
    } catch (refusal) {
      thrown = refusal;
    }

    const error = planFailure(thrown);
    expect(isNetworkError(error)).toBe(true);
    expect(error.url).toBe(ABSOLUTE);
    expect(error.message).toBe("Network error");
  });

  test("a setup failure is never an abort and never a timeout", () => {
    // The rule ADR 0003 rows H-21 and H-28 state. This module never consults a
    // signal, so the rule is structural rather than checked — but a fired
    // timeout beside a throwing options read is the shape that used to break it.
    const signal = AbortSignal.timeout(0);
    let thrown: unknown;
    try {
      planRequest(ABSOLUTE, {
        signal,
        get fetch(): typeof fetch {
          throw new Error("hostile fetch getter");
        },
      });
    } catch (refusal) {
      thrown = refusal;
    }

    const error = planFailure(thrown);
    expect(isNetworkError(error)).toBe(true);
    expect(isAbortError(error)).toBe(false);
    expect(isTimeoutError(error)).toBe(false);
  });

  test("planFailure is total over what it is handed", () => {
    // A value this module did not raise is a defect in this module, and a defect
    // must still leave the caller with an error VALUE rather than an envelope
    // that rejects. It files no url, because a foreign value carries none.
    const cause = new Error("not a plan refusal");

    const error = planFailure(cause);

    expect(isNetworkError(error)).toBe(true);
    expect(error.cause).toBe(cause);
    expect(error.url).toBe("");
    expect(planFailure(undefined).url).toBe("");
  });
});
