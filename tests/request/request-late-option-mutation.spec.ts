import { describe, expect, test } from "vitest";
import { typedFetch } from "../../src/index";
import { planRequest } from "../../src/request-plan";

describe("request/signal probes", () => {
  test("a native Request remains a Request for the captured native fetch after global Request is replaced", () => {
    const request = new Request("http://request-mismatch.invalid/resource");
    const savedRequest = globalThis.Request;

    class ReplacementRequest {
      readonly replacement = true;
    }
    globalThis.Request = ReplacementRequest as unknown as typeof Request;
    try {
      const plan = planRequest(request, {});

      // The ambient fetch captured by the module still recognizes the native
      // Request's internal slots. The setup plan must therefore hand it over
      // unchanged, even though the mutable global constructor no longer does.
      expect(plan.transportInput).toBe(request);
    } finally {
      globalThis.Request = savedRequest;
    }
  });

  test("the same Request mismatch changes the public result from success to NetworkError", async () => {
    const request = new Request("data:text/plain,request-ok");
    const savedRequest = globalThis.Request;
    const nativeFetch = globalThis.fetch;

    class ReplacementRequest {
      readonly replacement = true;
    }
    globalThis.Request = ReplacementRequest as unknown as typeof Request;
    try {
      const control = await nativeFetch(request);
      expect(await control.text()).toBe("request-ok");

      const result = await typedFetch(request);

      expect(result.error).toBe(null);
      if (result.error !== null) throw result.error;
      expect(await result.response.text()).toBe("request-ok");
    } finally {
      globalThis.Request = savedRequest;
    }
  });

  test("a fetch key added by the signal getter is not exposed to the transport selected before that getter", () => {
    const savedFetch = globalThis.fetch;
    const selectedTransport = (async () => new Response(null, { status: 200 })) as typeof fetch;
    const controller = new AbortController();
    const options: Record<string, unknown> = {};

    Object.defineProperty(options, "signal", {
      enumerable: true,
      configurable: true,
      get() {
        options.fetch = selectedTransport;
        return controller.signal;
      },
    });

    globalThis.fetch = selectedTransport;
    try {
      const plan = planRequest("https://late-fetch.invalid/resource", options as never);

      // Transport selection happened before the signal getter ran. The late
      // mutation must not become a re-entry extension on the init handed to
      // that already-selected transport.
      expect(Object.hasOwn(plan.init, "fetch")).toBe(false);
      expect(Reflect.ownKeys(plan.init)).not.toContain("fetch");
    } finally {
      globalThis.fetch = savedFetch;
    }
  });

  test("the late fetch key is observable at the public transport seam", async () => {
    const savedFetch = globalThis.fetch;
    let receivedInit: RequestInit | undefined;
    const selectedTransport = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      receivedInit = init;
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    const controller = new AbortController();
    const options: Record<string, unknown> = {};

    Object.defineProperty(options, "signal", {
      enumerable: true,
      configurable: true,
      get() {
        options.fetch = selectedTransport;
        return controller.signal;
      },
    });

    globalThis.fetch = selectedTransport;
    try {
      const result = await typedFetch("https://late-fetch.invalid/resource", options as never);

      expect(result.error).toBe(null);
      expect(receivedInit).toBeDefined();
      expect(Object.hasOwn(receivedInit as object, "fetch")).toBe(false);
    } finally {
      globalThis.fetch = savedFetch;
    }
  });
});
