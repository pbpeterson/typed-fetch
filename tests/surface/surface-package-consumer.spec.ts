import { createRequire } from "node:module";
import { beforeAll, describe, expect, test } from "vitest";

type PublicApi = typeof import("@pbpeterson/typed-fetch");
type ErrorsApi = typeof import("@pbpeterson/typed-fetch/errors");

const require = createRequire(import.meta.url);
const requestUrl = "https://round5-agent4.invalid/resource";

let esm: PublicApi;
let cjs: PublicApi;
let esmErrors: ErrorsApi;
let cjsErrors: ErrorsApi;

beforeAll(async () => {
  // These are deliberately bare package imports: the test exercises the
  // package's own exports map, not a source-relative shortcut.
  esm = await import("@pbpeterson/typed-fetch");
  esmErrors = await import("@pbpeterson/typed-fetch/errors");
  cjs = require("@pbpeterson/typed-fetch") as PublicApi;
  cjsErrors = require("@pbpeterson/typed-fetch/errors") as ErrorsApi;
});

function rejectWhenAborted(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    // A fetch-compatible custom transport must honor the signal from either
    // Request input or RequestInit; the native fetch API permits both forms.
    const signal = input instanceof Request ? input.signal : init?.signal;
    if (signal == null) {
      reject(new Error("the transport did not receive a signal"));
      return;
    }
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

describe("public package consumer audit", () => {
  test("the root and ./errors exports agree across ESM and CJS", () => {
    expect(Object.keys(cjs).toSorted()).toEqual(Object.keys(esm).toSorted());
    expect(Object.keys(cjsErrors).toSorted()).toEqual(Object.keys(esmErrors).toSorted());
    expect(typeof esm.typedFetch).toBe("function");
    expect(typeof esm.isHttpError).toBe("function");
    expect(typeof esmErrors.NotFoundError).toBe("function");
  });

  test.each(["ESM", "CJS"] as const)(
    "$0 consumer can use a custom transport for success",
    async (_label) => {
      const api = _label === "ESM" ? esm : cjs;
      let transportCalls = 0;
      const result = await api.typedFetch<{ source: string }>(requestUrl, {
        fetch: async () => {
          transportCalls += 1;
          return new Response(JSON.stringify({ source: "custom-transport" }), {
            headers: { "content-type": "application/json" },
          });
        },
      });

      expect(result.error).toBeNull();
      expect(result.response).not.toBeNull();
      expect(transportCalls).toBe(1);
      await expect(result.response?.json()).resolves.toEqual({ source: "custom-transport" });
    },
  );

  test("an HTTP error body can be cloned and consumed through the public ESM API", async () => {
    const result = await esm.typedFetch(requestUrl, {
      fetch: async () =>
        new Response(JSON.stringify({ message: "missing" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        }),
    });

    expect(result.response).toBeNull();
    expect(esm.isHttpError(result.error)).toBe(true);
    if (!esm.isHttpError(result.error)) return;

    const copy = result.error.clone();
    await expect(result.error.json()).resolves.toEqual({ message: "missing" });
    await expect(copy.json()).resolves.toEqual({ message: "missing" });
    expect(cjs.isHttpError(result.error)).toBe(true);
  });

  test("a custom transport refusal is a NetworkError value, not a rejection", async () => {
    const cause = new Error("round5 transport refusal");
    const result = await cjs.typedFetch(requestUrl, {
      fetch: async () => {
        throw cause;
      },
    });

    expect(result.response).toBeNull();
    expect(result.error).not.toBeNull();
    expect(cjs.isHttpError(result.error)).toBe(false);
    expect(cjs.isNetworkError(result.error)).toBe(true);
    expect(result.error?.cause).toBe(cause);
  });

  test("manual abort and timeout remain distinct through a custom transport", async () => {
    const controller = new AbortController();
    const manualPromise = esm.typedFetch(requestUrl, {
      signal: controller.signal,
      fetch: rejectWhenAborted,
    });
    const reason = new Error("round5 manual abort");
    controller.abort(reason);

    const manual = await manualPromise;
    expect(esm.isAbortError(manual.error)).toBe(true);
    expect(esm.isTimeoutError(manual.error)).toBe(false);
    if (!esm.isAbortError(manual.error)) return;
    expect(manual.error?.reason).toBe(reason);

    const timed = await cjs.typedFetch(requestUrl, {
      signal: AbortSignal.timeout(5),
      fetch: rejectWhenAborted,
    });
    expect(cjs.isTimeoutError(timed.error)).toBe(true);
    expect(cjs.isAbortError(timed.error)).toBe(false);
  });

  test("a pre-aborted Request first argument remains an AbortedError", async () => {
    const controller = new AbortController();
    const reason = new Error("round5 request abort");
    controller.abort(reason);
    const request = new Request(requestUrl, { signal: controller.signal });

    const result = await esm.typedFetch(request, {
      fetch: rejectWhenAborted,
    });

    expect(result.response).toBeNull();
    expect(esm.isAbortError(result.error)).toBe(true);
    expect(esm.isTimeoutError(result.error)).toBe(false);
    if (!esm.isAbortError(result.error)) return;
    expect(result.error?.reason).toBe(reason);
  });
});
