import { afterEach, describe, expect, test, vi } from "vitest";
import { isAbortError, isNetworkError, typedFetch } from "../../src/index";
import type { TypedFetchOptions } from "../../src/index";
import { planRequest } from "../../src/request-plan";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_REQUEST = globalThis.Request;

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  globalThis.Request = ORIGINAL_REQUEST;
});

describe("request-plan audit after round 1", () => {
  test("a late fetch added by a signal getter returning undefined stays hidden", () => {
    const lateFetch = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));
    const options: Record<string, unknown> = {};

    Object.defineProperty(options, "signal", {
      configurable: true,
      enumerable: true,
      get() {
        options.fetch = lateFetch;
        return undefined;
      },
    });

    const plan = planRequest(
      "https://round2-late-fetch.invalid/resource",
      options as TypedFetchOptions,
    );

    // `fetch` is the library extension. The transport was selected before the
    // signal getter ran, so the late own key must not reach its init through
    // any of the reflection/lookup surfaces.
    expect(Object.hasOwn(plan.init, "fetch")).toBe(false);
    expect(Reflect.ownKeys(plan.init)).not.toContain("fetch");
    expect("fetch" in plan.init).toBe(false);
    expect((plan.init as { fetch?: unknown }).fetch).toBeUndefined();
  });

  test("the same late fetch does not leak through the public custom-transport seam", async () => {
    let receivedInit: RequestInit | undefined;
    const selectedTransport = vi.fn<typeof fetch>(async (_input, init) => {
      receivedInit = init;
      return new Response(null, { status: 200 });
    });
    const options: Record<string, unknown> = {};

    Object.defineProperty(options, "signal", {
      configurable: true,
      enumerable: true,
      get() {
        options.fetch = selectedTransport;
        return undefined;
      },
    });

    globalThis.fetch = selectedTransport;
    const result = await typedFetch(
      "https://round2-late-fetch.invalid/resource",
      options as TypedFetchOptions,
    );

    expect(result.error).toBeNull();
    expect(receivedInit).toBeDefined();
    expect(Object.hasOwn(receivedInit as object, "fetch")).toBe(false);
    expect(Reflect.ownKeys(receivedInit as object)).not.toContain("fetch");
    expect("fetch" in (receivedInit as object)).toBe(false);
  });

  test("a native Request remains whole for a custom transport after global Request replacement", () => {
    const request = new Request("https://round2-request.invalid/resource");
    const replacement = class ReplacementRequest {
      readonly marker = true;
    };
    const transport = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));

    globalThis.Request = replacement as unknown as typeof Request;
    const plan = planRequest(request, { fetch: transport });

    expect(plan.transportInput).toBe(request);
    expect(plan.requestUrl).toBe("https://round2-request.invalid/resource");
    expect(plan.ambientTransport).toBe(false);
  });

  test("an ambient fetch does not treat a caller-installed Request polyfill as native", async () => {
    const requestedUrl = "http://127.0.0.1:1/round2-requested";
    const serializedUrl = "http://127.0.0.1:1/round2-serialized";
    const replacement = class ReplacementRequest {
      constructor(readonly url: string) {}

      toString(): string {
        return serializedUrl;
      }
    };

    globalThis.Request = replacement as unknown as typeof Request;
    const result = await typedFetch(new replacement(requestedUrl) as unknown as Request);

    // Native fetch does not know the caller-installed constructor. It applies
    // its normal RequestInfo conversion, so the one string it sends — and the
    // URL correlated with its failure — is the polyfill's serialization.
    expect(isNetworkError(result.error)).toBe(true);
    expect(result.error?.url).toBe(serializedUrl);
  });

  test("a tagged foreign input uses its own signal when the global Request is a polyfill", () => {
    const governing = new AbortController();
    governing.abort(new Error("round2 governing abort"));
    const decoy = new AbortController().signal;
    const replacement = class ReplacementRequest {
      get signal(): AbortSignal {
        return decoy;
      }
    };
    const transport = vi.fn<typeof fetch>(async () => {
      throw governing.signal.reason;
    });
    const tagged = {
      [Symbol.toStringTag]: "Request",
      url: "https://round2-foreign.invalid/resource",
      signal: governing.signal,
    } as unknown as Request;

    globalThis.Request = replacement as unknown as typeof Request;
    const plan = planRequest(tagged, { fetch: transport });

    // The wide tag path is for caller transports and foreign/duplicated
    // Request implementations. No current-global Request accessor owns this
    // value; its own signal is the only signal the transport can consult.
    expect(plan.signal).toBe(governing.signal);
    expect(plan.signal).not.toBe(decoy);
  });

  test("the foreign signal remains the abort authority end to end", async () => {
    const governing = new AbortController();
    governing.abort(new Error("round2 governing abort"));
    const decoy = new AbortController().signal;
    const replacement = class ReplacementRequest {
      get signal(): AbortSignal {
        return decoy;
      }
    };
    const tagged = {
      [Symbol.toStringTag]: "Request",
      url: "https://round2-foreign.invalid/resource",
      signal: governing.signal,
    } as unknown as Request;
    const transport = vi.fn<typeof fetch>(async () => {
      throw governing.signal.reason;
    });

    globalThis.Request = replacement as unknown as typeof Request;
    const result = await typedFetch(tagged, { fetch: transport });

    expect(isAbortError(result.error)).toBe(true);
  });

  test("a URL input is serialized once before a custom transport receives it", () => {
    const input = new URL("https://round2-url.invalid/resource");
    const plan = planRequest(input, { fetch: vi.fn<typeof fetch>() });

    expect(plan.transportInput).toBe(input.toString());
    expect(plan.requestUrl).toBe(input.toString());
  });
});
