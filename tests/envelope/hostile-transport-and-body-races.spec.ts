import { describe, expect, test } from "vitest";
import {
  isAbortError,
  isHttpError,
  isNetworkError,
  isTimeoutError,
  typedFetch,
} from "../../src/index";

const URL_UNDER_TEST = "https://round4-agent4.invalid/resource";

type ForeignResponse = Record<PropertyKey, unknown>;

function foreignHttpResponse(
  body: ReadableStream<Uint8Array>,
  overrides: Record<PropertyKey, unknown> = {},
): ForeignResponse {
  const response: ForeignResponse = {
    [Symbol.toStringTag]: "Response",
    body,
    bodyUsed: false,
    headers: new Headers([["content-type", "text/plain"]]),
    ok: false,
    redirected: false,
    status: 599,
    statusText: "Round 4",
    type: "basic",
    url: URL_UNDER_TEST,
    arrayBuffer: async () => new ArrayBuffer(0),
    blob: async () => new Blob(),
    clone: () => response,
    formData: async () => new FormData(),
    json: async () => "payload",
    text: async () => "payload",
  };
  Object.defineProperties(response, Object.getOwnPropertyDescriptors(overrides));
  return response;
}

function liveStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("payload"));
    },
  });
}

describe("adversarial public API audit", () => {
  test("a custom transport can return a successful foreign Response unchanged", async () => {
    const response = foreignHttpResponse(liveStream(), {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ source: "foreign" }),
    });

    const result = await typedFetch(URL_UNDER_TEST, {
      fetch: async () => response as unknown as Response,
    });

    expect(result.error).toBeNull();
    expect(result.response).toBe(response);
    expect(await result.response?.json()).toEqual({ source: "foreign" });
  });

  test("a custom transport refusal is a NetworkError value and never a rejection", async () => {
    const cause = new Error("foreign transport refusal");
    const result = await typedFetch(URL_UNDER_TEST, {
      fetch: async () => {
        throw cause;
      },
    });

    expect(result.response).toBeNull();
    expect(isNetworkError(result.error)).toBe(true);
    expect(result.error?.cause).toBe(cause);
  });

  test("an aborted custom transport is not reclassified as a timeout", async () => {
    const controller = new AbortController();
    const resultPromise = typedFetch(URL_UNDER_TEST, {
      signal: controller.signal,
      fetch: async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject((init.signal as AbortSignal).reason),
            { once: true },
          );
        }),
    });

    controller.abort(new Error("manual abort"));
    const result = await resultPromise;

    expect(isAbortError(result.error)).toBe(true);
    expect(isTimeoutError(result.error)).toBe(false);
    expect((result.error as { reason?: unknown }).reason).toBe(controller.signal.reason);
  });

  test("a timeout-shaped foreign signal remains a TimeoutError through a custom transport", async () => {
    const signal = AbortSignal.timeout(5);
    const result = await typedFetch(URL_UNDER_TEST, {
      signal,
      fetch: async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          const transportSignal = init?.signal as AbortSignal | undefined;
          if (transportSignal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
          }
          transportSignal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    });

    expect(isTimeoutError(result.error)).toBe(true);
    expect(isAbortError(result.error)).toBe(false);
  });

  test("a hostile bodyUsed getter that cancels cannot let the outer read start", async () => {
    const body = liveStream();
    let armed = false;
    let entered = false;
    let cancellation: Promise<void> | undefined;
    let textCalls = 0;
    let error: ReturnType<typeof httpErrorFrom> | undefined;

    const response = foreignHttpResponse(body, {
      get bodyUsed() {
        if (armed && !entered) {
          entered = true;
          cancellation = error?.cancel();
        }
        return false;
      },
      text: async () => {
        textCalls += 1;
        return "payload";
      },
    });

    const result = await typedFetch(URL_UNDER_TEST, {
      fetch: async () => response as unknown as Response,
    });
    error = httpErrorFrom(result);
    armed = true;

    const read = error.text();
    await expect(read).rejects.toThrow(/Cannot read this error's body with text/u);
    await cancellation;

    // The cancel claim is published before its body getter runs. A competing
    // read must observe that claim rather than start the foreign reader after
    // cancellation has already taken custody of the body.
    expect(textCalls).toBe(0);
  });

  test("a hostile bodyUsed getter that reads cannot let cancel race a reader", async () => {
    const body = liveStream();
    let armed = false;
    let entered = false;
    let nestedRead: Promise<string> | undefined;
    let textCalls = 0;
    let error: ReturnType<typeof httpErrorFrom> | undefined;

    const response = foreignHttpResponse(body, {
      get bodyUsed() {
        if (armed && !entered) {
          entered = true;
          nestedRead = error?.text();
        }
        return false;
      },
      text: async () => {
        textCalls += 1;
        return "payload";
      },
    });

    const result = await typedFetch(URL_UNDER_TEST, {
      fetch: async () => response as unknown as Response,
    });
    error = httpErrorFrom(result);
    armed = true;

    const cancellation = error.cancel();
    await expect(nestedRead).rejects.toThrow(/Cannot read this error's body with text/u);
    await expect(cancellation).resolves.toBeUndefined();

    // The outer cancel owns the body before reading the foreign getter. It
    // must not be followed by a reader admitted from that getter.
    expect(textCalls).toBe(0);
  });
});

function httpErrorFrom(result: Awaited<ReturnType<typeof typedFetch>>) {
  if (!isHttpError(result.error)) throw new Error("expected an HTTP error");
  return result.error;
}
