import { describe, test, expect } from "vitest";
import { isAbortError, isNetworkError, typedFetch } from "./src/index";

// Round 10, lane H1 — request setup and input classification, against the shape
// round 9 left behind.
//
// Round 9 closed the plain `requestInput.signal` read for the AMBIENT
// transport: the transport receives the `Request` whole and aborts on the
// signal in the platform's internal slot, so the read goes through
// `Request.prototype`'s accessor and an own data property can no longer supply
// a decoy. It kept the plain own read for CALLER CODE running as the transport,
// with this reason: caller code is admitted on the wider TAG check, so its
// input need not be a platform `Request` at all, and the accessor cannot be
// applied to a value that carries no slot.
//
// That reason is exactly true of a value the tag check admitted. It is not true
// of a platform `Request`, which the tag check never had to widen for — and the
// branch below tests the TRANSPORT, not the input.

describe("the signal a platform Request contributes under a caller transport", () => {
  test("an own signal property cannot replace the signal a forwarding transport aborts on", async () => {
    // The governing signal is the one in the platform's internal slot, the same
    // one round 9 established for the ambient transport, because the transport
    // below hands the `Request` straight back to the platform. That is what a
    // dependency-injection seam is for: `{ fetch: (input, init) => ... }` is the
    // shape the README's own `fetch` option invites, and forwarding to the
    // ambient implementation is its most ordinary body — a wrapper that logs, or
    // retries, or counts calls.
    //
    // The decoy is the shape round 9 named: `Request.prototype.signal` is a
    // read-only accessor, so `Object.defineProperty(request, "signal", { value })`
    // shadows it for every plain read. Middleware that decorates a `Request`
    // writes it; nothing hostile is required, and the transport never sees it.
    const governing = new AbortController();
    governing.abort();
    const decoyed = (): Request => {
      const request = new Request("http://127.0.0.1:1/round10-h1-signal", {
        signal: governing.signal,
      });
      Object.defineProperty(request, "signal", {
        configurable: true,
        value: new AbortController().signal,
      });
      return request;
    };

    // The CONTROL, and it is what makes the failure below attributable to the
    // branch rather than to the input: a `Request` built the same way, aborted
    // by the same signal, classified correctly when the ambient transport runs.
    // The only difference between the two calls is which read reports the
    // signal.
    const ambient = await typedFetch(decoyed());
    expect(isAbortError(ambient.error)).toBe(true);

    const forwarding = ((input: RequestInfo | URL, init?: RequestInit) =>
      globalThis.fetch(input, init)) as typeof fetch;

    const { response, error } = await typedFetch(decoyed(), { fetch: forwarding });

    // Evidence that the request was aborted by the GOVERNING signal, not by the
    // decoy: the transport rejected with that signal's own reason, and no
    // connection was attempted to port 1.
    expect(response).toBe(null);
    expect((error as unknown as { readonly cause?: unknown }).cause).toBe(governing.signal.reason);
    // So the caller must be told the request was aborted. The decoy reports
    // `aborted: false`, and `classifyRequestFailure` treats the signal it is
    // handed as the authority, so an abort is filed as a plain network failure
    // and a consumer's retry policy reads that class.
    expect(isAbortError(error)).toBe(true);
    expect(isNetworkError(error)).toBe(false);
  });
});

describe("what the setup phase takes off a Request it hands over", () => {
  test("exactly three reads: the tag, the url, and the signal", async () => {
    // Round 9's fixer closed the decoy class by enumerating this list rather
    // than by patching the one case. The list is the reason the class is closed,
    // so it is pinned here as an executable claim: a fourth read added to the
    // setup phase — `method`, `headers`, `body`, or `redirect` — is a value the
    // transport also reads, and two reads of one input are what ADR 0003 row
    // H-26 forbids.
    //
    // Driven with a caller transport and a tagged non-platform input, because
    // that is the one path on which every read is an ordinary property get a
    // proxy can observe. A platform `Request` reaches the same two fields
    // through `Request.prototype`'s accessors instead.
    const reads: string[] = [];
    const tagged = {
      [Symbol.toStringTag]: "Request",
      url: "http://127.0.0.1:1/round10-h1-reads",
      method: "POST",
      headers: new Headers({ authorization: "Bearer round10" }),
      body: null,
      redirect: "follow",
      signal: undefined,
    };
    const spy = new Proxy(tagged, {
      get(target, property) {
        reads.push(String(property));
        return Reflect.get(target, property, target) as unknown;
      },
    });
    const handedOver: unknown[] = [];
    const transport = (async (input: unknown) => {
      handedOver.push(input);
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;

    const { error } = await typedFetch(spy as unknown as Request, { fetch: transport });
    // Copied before any assertion runs: a structural comparison against the
    // proxy is itself a read of it.
    const observed = [...reads];

    expect(error).toBe(null);
    // The transport receives the input itself, which is why the setup phase does
    // not need the rest of it.
    expect(handedOver.length).toBe(1);
    expect(handedOver[0]).toBe(spy);
    expect(observed).toEqual(["Symbol(Symbol.toStringTag)", "url", "signal"]);
  });
});
