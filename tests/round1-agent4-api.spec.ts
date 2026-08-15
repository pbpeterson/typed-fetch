import { describe, expect, test } from "vitest";
import { NotFoundError } from "../src/errors/not-found-error";
import { UnknownHttpError } from "../src/errors/unknown-http-error";
import { typedFetch } from "../src/index";

describe("round 1 / agent 4 — public API probes", () => {
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

  test("rejects a clone branch that is not a Response", async () => {
    const response = new Response("payload", { status: 404 });
    const fakeBranch = {
      status: 404,
      statusText: "Not Found",
      url: "https://fake.invalid/branch",
      headers: new Headers(),
      body: null,
      bodyUsed: false,
    };
    Object.defineProperty(response, "clone", {
      configurable: true,
      value: () => fakeBranch,
    });

    const error = new NotFoundError(response);
    let copy: NotFoundError | undefined;
    try {
      expect(() => {
        copy = error.clone();
      }).toThrow(TypeError);
    } finally {
      await error.cancel();
      if (copy) await copy.cancel();
    }
  });

  test("rejects a clone branch that is the original Response", async () => {
    const response = new Response("payload", { status: 404 });
    Object.defineProperty(response, "clone", {
      configurable: true,
      value: () => response,
    });

    const error = new NotFoundError(response);
    let copy: NotFoundError | undefined;
    try {
      expect(() => {
        copy = error.clone();
      }).toThrow(TypeError);
    } finally {
      await error.cancel();
      if (copy) await copy.cancel();
    }
  });

  test("filters deprecated invisible formatting controls from HTTP identity", async () => {
    const response = new Response(null, { status: 599 });
    Object.defineProperty(response, "statusText", {
      configurable: true,
      value: "pre\u206Avisible\u206Fpost",
    });

    const error = new UnknownHttpError(response);
    expect(error.statusText).toBe("previsiblepost");
    await error.cancel();
  });

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
