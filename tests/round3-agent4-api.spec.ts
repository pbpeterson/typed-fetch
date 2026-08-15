import { afterEach, describe, expect, test } from "vitest";
import { UnknownHttpError } from "../src/errors";
import { isHttpError, typedFetch } from "../src/index";
import type { TypedFetchOptions } from "../src/index";
import { classifyResolvedValue, type ResponseVerdict } from "../src/response-verdict";

const originalSignalDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, "signal");

afterEach(() => {
  if (originalSignalDescriptor === undefined) {
    Reflect.deleteProperty(Object.prototype, "signal");
  } else {
    Object.defineProperty(Object.prototype, "signal", originalSignalDescriptor);
  }
});

describe("round 3 / agent 4 — public API boundary probes", () => {
  test("an inherited signal survives a forwarding transport's spread under prototype pollution", async () => {
    const signal = new AbortController().signal;
    Object.defineProperty(Object.prototype, "signal", {
      configurable: true,
      enumerable: false,
      get: () => undefined,
      set: () => {},
    });

    const options = Object.create({ signal }) as TypedFetchOptions & Record<string, unknown>;
    let forwarded: RequestInit | undefined;
    const transport = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      forwarded = { ...init };
      return new Response(null, { status: 200 });
    };
    options.fetch = transport;

    const result = await typedFetch("https://round3-agent4-signal.invalid/resource", options);

    expect(result.error).toBeNull();
    expect(forwarded?.signal).toBe(signal);
  });

  test("reentrant cancel starts one release for a foreign response body", async () => {
    let cancelCalls = 0;
    let error: ReturnType<typeof errorFromResult> | undefined;
    let reentrant: Promise<void> | undefined;

    const stream = {
      locked: false,
      cancel() {
        cancelCalls += 1;
        return Promise.resolve();
      },
      getReader: () => ({}),
      pipeThrough: () => stream,
      pipeTo: () => Promise.resolve(),
      tee: () => [],
    };
    const response: Record<PropertyKey, unknown> = {
      [Symbol.toStringTag]: "Response",
      body: stream,
      get bodyUsed() {
        if (error !== undefined && reentrant === undefined) reentrant = error.cancel();
        return false;
      },
      headers: new Headers(),
      ok: false,
      redirected: false,
      status: 599,
      statusText: "Round 3",
      type: "basic",
      url: "https://round3-agent4-body.invalid/resource",
      arrayBuffer: async () => new ArrayBuffer(0),
      blob: async () => new Blob(),
      clone: () => response,
      formData: async () => new FormData(),
      json: async () => null,
      text: async () => "payload",
    };

    const result = await typedFetch("https://round3-agent4-body.invalid/request", {
      fetch: async () => response as unknown as Response,
    });
    expect(isHttpError(result.error)).toBe(true);
    if (!isHttpError(result.error)) return;
    error = result.error;

    await error.cancel();
    expect(reentrant).toBeDefined();
    await reentrant;

    expect(cancelCalls).toBe(1);
  });

  test("a nested response refusal does not release the outer HTTP error body", async () => {
    let entered = false;
    let nested: ResponseVerdict | undefined;
    const response = new Response("round3-agent4-payload", { status: 599 });
    Object.defineProperty(response, "status", {
      configurable: true,
      get() {
        if (!entered) {
          entered = true;
          nested = classifyResolvedValue(response);
        }
        return 599;
      },
    });

    const outer = classifyResolvedValue(response);

    expect(nested?.kind).toBe("refused");
    expect(outer.kind).toBe("http");
    if (outer.kind !== "http") return;

    try {
      await expect(outer.error.text()).resolves.toBe("round3-agent4-payload");
    } finally {
      await outer.error.cancel();
    }
  });

  test.each([0x180e, 0xfff9, 0xfffa, 0xfffb] as const)(
    "filters invisible format control U+%s from an unknown HTTP error",
    (code) => {
      const character = String.fromCodePoint(code);
      const response = new Response(null, { status: 599 });
      Object.defineProperty(response, "statusText", {
        configurable: true,
        value: `pre${character}post`,
      });

      const error = new UnknownHttpError(response);
      const publicValues = [
        error.statusText,
        error.message,
        JSON.stringify(error),
        error.toString(),
      ];

      expect(publicValues.every((value) => !value.includes(character))).toBe(true);
    },
  );

  test.each(["statusText", "url", "headers"] as const)(
    "%s identity getter is not read twice by reentrant construction",
    (field) => {
      const response = new Response(null, { status: 599 });
      let reads = 0;
      let entered = false;

      if (field === "statusText") {
        Object.defineProperty(response, field, {
          configurable: true,
          get() {
            reads += 1;
            if (!entered) {
              entered = true;
              try {
                new UnknownHttpError(response);
              } catch {
                // A correct reentrancy guard may refuse the nested construction.
              }
            }
            return "outer";
          },
        });
      } else if (field === "url") {
        Object.defineProperty(response, field, {
          configurable: true,
          get() {
            reads += 1;
            if (!entered) {
              entered = true;
              try {
                new UnknownHttpError(response);
              } catch {
                // A correct reentrancy guard may refuse the nested construction.
              }
            }
            return "https://round3-agent4.invalid/outer";
          },
        });
      } else {
        const headers = new Headers([["x-round3-agent4", "outer"]]);
        Object.defineProperty(response, field, {
          configurable: true,
          get() {
            reads += 1;
            if (!entered) {
              entered = true;
              try {
                new UnknownHttpError(response);
              } catch {
                // A correct reentrancy guard may refuse the nested construction.
              }
            }
            return headers;
          },
        });
      }

      new UnknownHttpError(response);

      expect(reads).toBe(1);
    },
  );
});

function errorFromResult(result: Awaited<ReturnType<typeof typedFetch>>) {
  if (!isHttpError(result.error)) throw new Error("expected an HTTP error");
  return result.error;
}
