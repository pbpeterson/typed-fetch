import { describe, test, expect } from "vitest";
import { typedFetch } from "./src/index";

// Round 11, lane H1 — the reads the setup phase takes off a handed-over
// `Request`, against the shape round 10 left behind.
//
// Round 10 replaced `callerTransport` with `input.platformRequest` on the
// `signal` read, and stated the reason as a claim about VALUES: "there is no
// third case — a value either carries the slot or it does not". So the branch
// applies `Request.prototype`'s accessor whenever `instanceof Request` answers
// true, unguarded, because the accessor is held to always have a slot to
// report. `nativeRequestSignal` writes that down: "Called only for a value
// `isPlatformRequest` accepted, so the accessor always has its slot to report."
//
// `instanceof` is a question about a prototype CHAIN. Carrying the slot is a
// question about how the object was ALLOCATED. Any exotic object over a
// `Request` separates them, and the ordinary one is a `Proxy`: the chain is the
// target's, so `instanceof Request` is true, and the proxy itself never went
// through the constructor, so an accessor applied to it throws. That is the
// third case.
//
// The consequence is not a wrong signal. It is no request at all. The `url`
// read one slot up catches its own throw and states the rule for both — "a
// hostile `url` getter is not a reason to refuse a Request the transport may
// still be able to send" — while this read has no catch, so the setup phase
// ends the call before the transport ever runs.

/** A transport that records what it was handed and answers with a 204. */
function recordingTransport(): {
  readonly fetch: typeof fetch;
  readonly inputs: readonly unknown[];
} {
  const inputs: unknown[] = [];
  const impl = async (input: unknown): Promise<Response> => {
    inputs.push(input);
    return new Response(null, { status: 204 });
  };
  return { fetch: impl as unknown as typeof fetch, inputs };
}

describe("a Request whose prototype chain says the accessor applies", () => {
  test("a forwarding Proxy over a Request still reaches the transport", async () => {
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
    // `Request.prototype`'s own getter throws.
    const target = new Request("http://127.0.0.1:1/round11-h1-proxy");
    const wrapped = new Proxy(target, {
      get: (request, property) => Reflect.get(request, property, request) as unknown,
    });

    // The CONTROL, and it is what makes the failure attributable to the read
    // rather than to the transport: the same transport, the same URL, the same
    // `Request`, unwrapped.
    //
    // Identity, never structure. A deep comparison against a `Request` is
    // itself a read of it, and how this value answers a read is the subject.
    const control = recordingTransport();
    const controlResult = await typedFetch(target, { fetch: control.fetch });
    expect(control.inputs.length).toBe(1);
    expect(control.inputs[0]).toBe(target);
    expect(controlResult.error).toBe(null);

    const transport = recordingTransport();
    const { response, error } = await typedFetch(wrapped as Request, { fetch: transport.fetch });

    // The transport is caller code. It is the party that decides what a request
    // is, `transportTakesRequest` already admitted this input on the wide tag
    // check, and phase 1 already chose to hand it over whole. Then the setup
    // phase threw reading a signal off it, and the request was never attempted.
    expect(transport.inputs.length).toBe(1);
    expect(transport.inputs[0]).toBe(wrapped);
    expect(error).toBe(null);
    expect(response?.status).toBe(204);
  });
});

describe("a signal that cannot be read governs nothing", () => {
  test("a Request whose signal read throws still reaches the transport", async () => {
    // Both arms of the ternary, because the defect is the missing catch rather
    // than the branch above it.
    //
    // Arm 1, the plain read: a tagged non-platform input whose own `signal`
    // getter throws. `round8-h1-request-input.spec.ts` pins the sibling case —
    // the same input class with a throwing `url` getter reaches the transport,
    // and the correlation field stays empty. One property over, the same kind
    // of read refuses the whole call.
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
      const transport = recordingTransport();

      const { response, error } = await typedFetch(input, { fetch: transport.fetch });

      // Identity, never structure: a deep comparison reads `signal`, and these
      // values are the ones whose `signal` throws.
      expect(transport.inputs.length).toBe(1);
      expect(transport.inputs[0]).toBe(input);
      expect(error).toBe(null);
      expect(response?.status).toBe(204);
    }
  });
});
