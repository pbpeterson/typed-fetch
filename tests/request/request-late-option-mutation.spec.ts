import { describe, expect, test } from "vitest";
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

  // The public half of the same mismatch — the call still succeeds and still
  // reads its body — is owned by
  // `tests/envelope/late-option-mutation-and-clone-branch.spec.ts`, whose title
  // states the outcome the body asserts.

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

  // The transport seam sees the same late key, and
  // `tests/envelope/late-option-mutation-and-clone-branch.spec.ts` asks it the
  // stricter question there: own key, `ownKeys`, `in`, and the spread.
});
