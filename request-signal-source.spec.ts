import { describe, test, expect } from "vitest";
import { typedFetch } from "./src/index";
import { isAbortError, isNetworkError } from "./src/index";

// Round 9, lane H1 — request setup and input classification, against the shape
// round 8 left behind.
//
// Round 8 settled WHICH transport decides that a tagged input is a request, and
// it hardened the one field the setup phase takes from a `Request` it hands
// over whole: `url`, read through `Request.prototype`'s own accessor, because
// `Object.defineProperty(request, "url", { value })` is how a Node adapter
// rewrites a URL and a plain read lets that own property shadow the getter.
//
// The setup phase takes a SECOND field from that same `Request`, one slot
// further down: `requestInput?.signal`. That read is plain.

describe("the signal a handed-over Request contributes", () => {
  test("an own signal property cannot replace the signal that governs the call", async () => {
    // The transport receives the `Request` WHOLE, so the signal that governs
    // the call is the one in the platform's internal slot — the only signal the
    // ambient `fetch` can consult, and the only one `Request.prototype.signal`
    // reports. An own data property is a decoy: it shadows that accessor for
    // every plain read, and the transport never sees it.
    //
    // The decoy is the same shape as the `url` one round 8 closed. Middleware
    // that decorates a `Request` writes it; nothing hostile is required.
    const governing = new AbortController();
    governing.abort();
    const request = new Request("http://127.0.0.1:1/round9-h1-signal", {
      signal: governing.signal,
    });
    const decoy = new AbortController();
    Object.defineProperty(request, "signal", {
      configurable: true,
      value: decoy.signal,
    });

    const { response, error } = await typedFetch(request);

    // Evidence that the AMBIENT transport aborted on the real signal: it
    // rejected with that signal's own reason, and no connection was attempted.
    expect(response).toBe(null);
    expect((error as unknown as { readonly cause?: unknown }).cause).toBe(governing.signal.reason);
    // So the request WAS aborted, and the caller must be told so. The decoy
    // reports `aborted: false`, and `classifyRequestFailure` treats whatever it
    // is handed as the authority.
    expect(isAbortError(error)).toBe(true);
    expect(isNetworkError(error)).toBe(false);
  });

  test("a caller transport's tagged input keeps its own signal as the authority", async () => {
    // The other half of the same decision, pinned so it cannot be collapsed
    // into "always apply the accessor". CALLER CODE running as the transport is
    // admitted on the wider tag check, so its input need not be a platform
    // `Request` at all — this one is not, and the accessor cannot be applied to
    // it. Its own `signal` is the only signal that transport can consult, so it
    // is the authority the classifier must use.
    const governing = new AbortController();
    governing.abort();
    const tagged = {
      [Symbol.toStringTag]: "Request",
      url: "https://round9-h1-caller-transport.invalid/tagged",
      signal: governing.signal,
    } as unknown as Request;
    const transport = (async (): Promise<Response> => {
      throw governing.signal.reason;
    }) as unknown as typeof fetch;

    const { response, error } = await typedFetch(tagged, { fetch: transport });

    expect(response).toBe(null);
    expect(isAbortError(error)).toBe(true);
    expect(isNetworkError(error)).toBe(false);
  });
});
