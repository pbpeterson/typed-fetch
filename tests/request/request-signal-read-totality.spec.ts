import { describe, test, expect } from "vitest";
import { recordingTransport } from "../../fixtures/recording-transport";
import { planRequest } from "../../src/request-plan";

// Round 11, lane H1 — the reads the setup phase takes off a handed-over
// `Request`, against the shape round 10 left behind.
//
// Round 10 replaced `callerTransport` with `input.platformRequest` on the
// `signal` read, and stated the reason as a claim about VALUES: "there is no
// third case — a value either carries the slot or it does not". So the branch
// applied `Request.prototype`'s accessor whenever `instanceof Request` answered
// true, unguarded, because the accessor was held to always have a slot to
// report.
//
// `instanceof` is a question about a prototype CHAIN. Carrying the slot is a
// question about how the object was ALLOCATED. Any exotic object over a
// `Request` separates them, and the ordinary one is a `Proxy`: the chain is the
// target's, so `instanceof Request` is true, and the proxy itself never went
// through the constructor, so an accessor applied to it throws. That is the
// third case.
//
// The consequence was not a wrong signal. It was no request at all. The `url`
// read one slot up catches its own throw and states the rule for both — "a
// hostile `url` getter is not a reason to refuse a Request the transport may
// still be able to send" — while this read had no catch, so the setup phase
// ended the call before the transport ever ran.
//
// The rule is now readable at the plan's own interface: a plan that was BUILT
// is a request the transport will be given. Nothing has to be inferred from an
// envelope.

/** The options that make the plan take the wide tag check. */
const CALLER_TRANSPORT = { fetch: recordingTransport().fetch };

describe("a Request whose prototype chain says the accessor applies", () => {
  test("a forwarding Proxy over a Request is still planned as a request", () => {
    // The wrapper is the ordinary instrumentation shape, not a hostile one.
    // `Reflect.get(target, property, target)` is the trap body that lets a
    // proxy observe reads of a `Request` without breaking any of them, and this
    // repository's own suite already hands `typedFetch` a `Request` behind that
    // exact trap. Every PLAIN read through it answers correctly — `url` and
    // `signal` included — because the receiver it forwards is the real
    // `Request`.
    //
    // What no proxy can survive is an accessor applied to the proxy ITSELF. The
    // receiver is then the exotic object, which has no internal slot, so
    // `Request.prototype`'s own getter throws. The fallback to the plain read is
    // what keeps the request alive.
    const target = new Request("http://127.0.0.1:1/round11-h1-proxy", {
      signal: new AbortController().signal,
    });
    // The platform allocates its own dependent signal for the request, so the
    // value in the slot is this one, never the controller's.
    const governing = target.signal;
    const wrapped = new Proxy(target, {
      get: (request, property) => Reflect.get(request, property, request) as unknown,
    });

    // The CONTROL, and it is what makes any failure attributable to the read
    // rather than to the input: the same `Request`, unwrapped.
    const control = planRequest(target, CALLER_TRANSPORT);
    expect(control.transportInput).toBe(target);
    expect(control.signal).toBe(governing);

    const plan = planRequest(wrapped as Request, CALLER_TRANSPORT);

    // The transport is caller code. It is the party that decides what a request
    // is, `transportTakesRequest` admits this input on the wide tag check, and
    // the plan hands it over whole.
    expect(plan.transportInput).toBe(wrapped);
    // The accessor threw and the plain read answered, so the signal the proxy
    // forwards is the one that governs.
    expect(plan.signal).toBe(governing);
  });
});

describe("a signal that cannot be read governs nothing", () => {
  test("a Request whose signal read throws is still planned as a request", () => {
    // Both arms of the read, because the defect was the missing catch rather
    // than the branch above it.
    //
    // Arm 1, the plain read: a tagged non-platform input whose own `signal`
    // getter throws. `request-transport-selection.spec.ts` pins the sibling case
    // — the same input class with a throwing `url` getter is still handed over,
    // and the correlation field stays empty. One property over, the same kind of
    // read used to refuse the whole call.
    //
    // Arm 2, the accessor: `Object.create(Request.prototype)` is `instanceof
    // Request` and carries the prototype's tag, so both `transportTakesRequest`
    // arms hand it over — and it has no slot, so neither the accessor nor a
    // plain read can answer. A deserializer and a hand-built double both
    // produce it.
    //
    // A signal that cannot be read governs nothing, which is exactly the state
    // a call is already in when the input carries no signal at all. It is not a
    // reason to refuse a request the transport may still be able to send.
    const throwingOwnGetter = {
      [Symbol.toStringTag]: "Request",
      url: "http://127.0.0.1:1/round11-h1-signal-getter",
      get signal(): AbortSignal {
        throw new Error("hostile signal getter");
      },
    };
    const slotless = Object.create(Request.prototype) as Request;

    for (const input of [throwingOwnGetter as unknown as Request, slotless]) {
      const plan = planRequest(input, CALLER_TRANSPORT);

      expect(plan.transportInput).toBe(input);
      expect(plan.signal).toBe(undefined);
    }
  });
});
