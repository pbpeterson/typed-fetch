import { createRequire } from "node:module";
import { beforeAll, describe, expect, test } from "vitest";

type PublicApi = typeof import("@pbpeterson/typed-fetch");

const require = createRequire(import.meta.url);
const requestUrl = "https://round6-agent4.invalid/resource";

let esm: PublicApi;
let cjs: PublicApi;

beforeAll(async () => {
  // These are package self-imports. They exercise the built exports map rather
  // than a source-relative import used by the ordinary unit suites.
  esm = await import("@pbpeterson/typed-fetch");
  cjs = require("@pbpeterson/typed-fetch") as PublicApi;
});

describe("round 6 / agent 4 — independent public API and packaging audit", () => {
  test("the compiled ESM and CJS roots handle a URL input and a 204 response", async () => {
    const cases = [
      ["ESM", esm],
      ["CJS", cjs],
    ] as const;

    for (const [label, api] of cases) {
      const input = new URL(`${requestUrl}?consumer=${label.toLowerCase()}`);
      const response = new Response(null, { status: 204 });
      const result = await api.typedFetch(input, {
        fetch: async () => response,
      });

      expect(result.error, `${label} returned an error`).toBeNull();
      expect(result.response, `${label} did not return a response`).toBe(response);
      expect(result.response?.status).toBe(204);
      expect(result.response?.body).toBeNull();
    }
  });

  test("a live timeout on a Request input remains a TimeoutError through a custom transport", async () => {
    const request = new Request(requestUrl, { signal: AbortSignal.timeout(15) });
    let transportInput: RequestInfo | URL | undefined;

    const result = await Promise.race([
      cjs.typedFetch(request, {
        fetch: async (input, init) => {
          transportInput = input;
          const signal = input instanceof Request ? input.signal : init?.signal;
          return new Promise<Response>((_resolve, reject) => {
            if (signal?.aborted) {
              reject(signal.reason);
              return;
            }
            signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
          });
        },
      }),
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error("round6 timeout probe hung")), 500),
      ),
    ]);

    expect(transportInput).toBe(request);
    expect(cjs.isTimeoutError(result.error)).toBe(true);
    expect(cjs.isAbortError(result.error)).toBe(false);
  });

  test("the public generic remains compile-time-only for a runtime JSON mismatch", async () => {
    const result = await esm.typedFetch<{ id: number }>(requestUrl, {
      fetch: async () =>
        new Response(JSON.stringify("not-an-object"), {
          headers: { "content-type": "application/json" },
        }),
    });

    expect(result.error).toBeNull();
    if (result.response === null) return;

    // The generic is intentionally not a runtime validator. This assertion
    // proves the built package does not silently transform the native value.
    const value: { id: number } = await result.response.json();
    expect(value).toBe("not-an-object");
  });
});
