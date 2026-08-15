import { afterEach, describe, expect, test } from "vitest";
import type { TypedFetchOptions } from "../../src/index";
import { isAbortError, isNetworkError, typedFetch } from "../../src/index";
import { planRequest } from "../../src/request-plan";

const ORIGINAL_REQUEST = globalThis.Request;
const ORIGINAL_SIGNAL = Object.getOwnPropertyDescriptor(Object.prototype, "signal");
const ORIGINAL_FETCH = Object.getOwnPropertyDescriptor(Object.prototype, "fetch");
const ORIGINAL_REQUEST_URL = Object.getOwnPropertyDescriptor(ORIGINAL_REQUEST.prototype, "url");
const ORIGINAL_REQUEST_SIGNAL = Object.getOwnPropertyDescriptor(
  ORIGINAL_REQUEST.prototype,
  "signal",
);

function restoreProperty(
  target: object,
  key: PropertyKey,
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor === undefined) Reflect.deleteProperty(target, key);
  else Object.defineProperty(target, key, descriptor);
}

afterEach(() => {
  globalThis.Request = ORIGINAL_REQUEST;
  if (ORIGINAL_SIGNAL === undefined) {
    Reflect.deleteProperty(Object.prototype, "signal");
  } else {
    Object.defineProperty(Object.prototype, "signal", ORIGINAL_SIGNAL);
  }
  if (ORIGINAL_FETCH === undefined) {
    Reflect.deleteProperty(Object.prototype, "fetch");
  } else {
    Object.defineProperty(Object.prototype, "fetch", ORIGINAL_FETCH);
  }
  restoreProperty(ORIGINAL_REQUEST.prototype, "url", ORIGINAL_REQUEST_URL);
  restoreProperty(ORIGINAL_REQUEST.prototype, "signal", ORIGINAL_REQUEST_SIGNAL);
});

function signalOptions(signal: AbortSignal): TypedFetchOptions {
  const options = Object.create({ signal }) as Record<string, unknown>;
  options.fetch = async () => new Response(null, { status: 200 });
  return options as TypedFetchOptions;
}

describe("request-plan boundary audit", () => {
  test("a polluted Object.prototype signal setter cannot swallow the signal snapshot", () => {
    const controller = new AbortController();
    Object.defineProperty(Object.prototype, "signal", {
      configurable: true,
      enumerable: false,
      get: () => undefined,
      set: () => undefined,
    });

    const plan = planRequest(
      "https://round3-signal-setter.invalid/resource",
      signalOptions(controller.signal),
    );
    const spread = { ...plan.init } as { signal?: AbortSignal };

    expect(plan.signal).toBe(controller.signal);
    expect(plan.init.signal).toBe(controller.signal);
    expect(spread.signal).toBe(controller.signal);
  });

  test("the same swallowed slot does not accidentally reattach a Request signal through a forwarding transport", async () => {
    const requestController = new AbortController();
    const request = new ORIGINAL_REQUEST("data:text/plain,round3-detach", {
      signal: requestController.signal,
    });
    requestController.abort(new Error("round3 request signal"));
    Object.defineProperty(Object.prototype, "signal", {
      configurable: true,
      enumerable: false,
      get: () => undefined,
      set: () => undefined,
    });
    let forwardedInit: RequestInit | undefined;
    const options = Object.create({ signal: null }) as TypedFetchOptions & {
      fetch: typeof fetch;
    };
    options.fetch = async (_input, init) => {
      forwardedInit = { ...init };
      return new Response("round3-detach");
    };

    const result = await typedFetch(request, options);

    expect(result.error).toBeNull();
    expect(await result.response?.text()).toBe("round3-detach");
    expect(forwardedInit?.signal).toBeNull();
  });

  test("a native Request keeps its captured signal when the current Request is a polyfill", () => {
    const controller = new AbortController();
    const request = new ORIGINAL_REQUEST("https://round3-native.invalid/resource", {
      signal: controller.signal,
    });
    const governing = request.signal;
    const decoy = new AbortController().signal;
    class ReplacementRequest {
      get signal(): AbortSignal {
        return decoy;
      }
    }

    expect(request instanceof ORIGINAL_REQUEST).toBe(true);
    globalThis.Request = ReplacementRequest as unknown as typeof Request;
    const plan = planRequest(request, {
      fetch: async () => new Response(null, { status: 200 }),
    });

    expect(plan.transportInput).toBe(request);
    expect(plan.requestUrl).toBe("https://round3-native.invalid/resource");
    expect(plan.signal).toBe(governing);
    expect(plan.signal).not.toBe(decoy);
  });

  test("a native Request's URL identity does not follow a patched prototype getter", () => {
    const requestedUrl = "https://round3-native-url.invalid/resource";
    const request = new ORIGINAL_REQUEST(requestedUrl);
    Object.defineProperty(ORIGINAL_REQUEST.prototype, "url", {
      configurable: true,
      get: () => "https://round3-shadow-url.invalid/resource",
    });

    const plan = planRequest(request, {});

    expect(plan.transportInput).toBe(request);
    expect(plan.requestUrl).toBe(requestedUrl);
  });

  test("a transport failure is filed against the native Request URL, not a patched getter", async () => {
    const requestedUrl = "https://round3-native-url-error.invalid/resource";
    const request = new ORIGINAL_REQUEST(requestedUrl);
    Object.defineProperty(ORIGINAL_REQUEST.prototype, "url", {
      configurable: true,
      get: () => "https://round3-shadow-url-error.invalid/resource",
    });

    const result = await typedFetch(request, {
      fetch: async () => {
        throw new Error("round3 transport failure");
      },
    });

    expect(isNetworkError(result.error)).toBe(true);
    expect(result.error?.url).toBe(requestedUrl);
  });

  test("a native Request's governing signal does not follow a patched prototype getter", () => {
    const requestController = new AbortController();
    const request = new ORIGINAL_REQUEST("https://round3-native-signal.invalid/resource", {
      signal: requestController.signal,
    });
    const governing = request.signal;
    const decoy = new AbortController().signal;
    Object.defineProperty(ORIGINAL_REQUEST.prototype, "signal", {
      configurable: true,
      get: () => decoy,
    });

    const plan = planRequest(request, {});

    expect(plan.signal).toBe(governing);
    expect(plan.signal).not.toBe(decoy);
  });

  test("the native transport's abort remains an AbortedError after the signal getter is patched", async () => {
    const requestController = new AbortController();
    const request = new ORIGINAL_REQUEST("data:text/plain,round3", {
      signal: requestController.signal,
    });
    const decoy = new AbortController().signal;
    Object.defineProperty(ORIGINAL_REQUEST.prototype, "signal", {
      configurable: true,
      get: () => decoy,
    });
    requestController.abort(new Error("round3 native abort"));

    const result = await typedFetch(request);

    expect(isAbortError(result.error)).toBe(true);
    expect(isNetworkError(result.error)).toBe(false);
  });

  test("a polyfill serializer that returns the default object spelling is not mistaken for no serializer", () => {
    const requestedUrl = "https://round3-polyfill.invalid/requested";
    class PolyfillRequest {
      constructor(readonly url: string) {}

      toString(): string {
        return "[object Object]";
      }
    }

    globalThis.Request = PolyfillRequest as unknown as typeof Request;
    const input = new PolyfillRequest(requestedUrl) as unknown as Request;
    const plan = planRequest(input, {});

    expect(plan.transportInput).toBe("[object Object]");
    expect(plan.requestUrl).toBe("[object Object]");
  });

  test("an own fetch override is absent from own reflection surfaces while inherited fetch stays visible", () => {
    const inherited = async () => new Response(null, { status: 200 });
    const own = async () => new Response(null, { status: 200 });
    Object.defineProperty(Object.prototype, "fetch", {
      configurable: true,
      enumerable: true,
      value: inherited,
      writable: true,
    });

    const plan = planRequest("https://round3-reflection.invalid/resource", { fetch: own });
    const forIn: string[] = [];
    for (const key in plan.init) forIn.push(key);

    // `for...in` intentionally walks the preserved prototype. The inherited
    // value is not the selected override and is still hidden by the proxy's
    // ordinary get/has traps.
    expect(forIn).toContain("fetch");
    expect((plan.init as { fetch?: unknown }).fetch).toBeUndefined();
    expect("fetch" in plan.init).toBe(false);
    expect(Object.getOwnPropertyNames(plan.init)).not.toContain("fetch");
    expect(Object.keys(plan.init)).not.toContain("fetch");
    expect(Object.hasOwn({ ...plan.init }, "fetch")).toBe(false);
  });

  test("a seeded matrix keeps a signal in the init's direct and spread views", () => {
    let state = 0x9e3779b9;
    const next = (): number => {
      state = Math.imul(state ^ (state >>> 16), 0x45d9f3b);
      state = Math.imul(state ^ (state >>> 16), 0x45d9f3b);
      return (state ^ (state >>> 16)) >>> 0;
    };

    for (let iteration = 0; iteration < 128; iteration += 1) {
      const controller = new AbortController();
      const signal = controller.signal;
      const enumerable = (next() & 1) === 0;
      const inherited = (next() & 1) === 0;
      const nullPrototype = (next() & 1) === 0;
      const options = (nullPrototype ? Object.create(null) : {}) as Record<string, unknown>;
      const prototype = inherited ? { signal } : Object.getPrototypeOf(options);
      if (inherited) Object.setPrototypeOf(options, prototype);
      Object.defineProperty(options, "signal", {
        configurable: true,
        enumerable,
        value: signal,
        writable: true,
      });
      if (inherited) Reflect.deleteProperty(options, "signal");
      options.fetch = async () => new Response(null, { status: 200 });

      const plan = planRequest(
        `https://round3-fuzz.invalid/${iteration}`,
        options as TypedFetchOptions,
      );
      const spread = { ...plan.init } as { signal?: AbortSignal };

      expect(plan.signal, `seeded case ${iteration}`).toBe(signal);
      expect(plan.init.signal, `seeded case ${iteration}`).toBe(signal);
      expect(spread.signal, `seeded case ${iteration}`).toBe(signal);
    }
  });
});
