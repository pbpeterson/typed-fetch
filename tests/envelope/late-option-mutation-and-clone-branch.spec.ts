import { describe, expect, test } from "vitest";
import { typedFetch } from "../../src/index";

describe("public API probes", () => {
  test("does not expose a fetch extension added while signal is read", async () => {
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

    const savedFetch = globalThis.fetch;
    globalThis.fetch = selectedTransport;
    try {
      const result = await typedFetch("https://late-fetch.invalid/resource", options as never);
      expect(result.error).toBeNull();
      if (result.error !== null || result.response === null) {
        throw new Error("expected a successful response");
      }
    } finally {
      globalThis.fetch = savedFetch;
    }

    expect(receivedInit).toBeDefined();
    expect(Object.hasOwn(receivedInit as object, "fetch")).toBe(false);
    expect(Reflect.ownKeys(receivedInit as object)).not.toContain("fetch");
    expect("fetch" in (receivedInit as object)).toBe(false);
    expect({ ...(receivedInit as object) }).not.toHaveProperty("fetch");
  });

  // The two clone-branch refusals this file used to drive \u2014 a branch that is
  // not a Response, and a branch that IS the original \u2014 are owned by
  // `tests/response/response-clone-branch-refusal.spec.ts` and
  // `tests/response/response-foreign-clone-custody.spec.ts`, which assert the
  // library's own refusal message and that the original stays readable.
  // The U+206A/U+206F identity filter is owned by
  // `tests/redaction/redaction-deprecated-format-controls.spec.ts`, which asks
  // all five public channels rather than `statusText` alone.

  test("keeps a native Request usable when global Request is replaced after import", async () => {
    const request = new Request("data:text/plain,request-ok");
    const savedRequest = globalThis.Request;

    class ReplacementRequest {}
    globalThis.Request = ReplacementRequest as unknown as typeof Request;
    try {
      const result = await typedFetch(request);

      expect(result.error).toBeNull();
      if (result.error !== null || result.response === null) {
        throw new Error("expected a successful response");
      }
      expect(await result.response.text()).toBe("request-ok");
    } finally {
      globalThis.Request = savedRequest;
    }
  });
});
