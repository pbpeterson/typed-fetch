import { describe, expect, test } from "vitest";
import { isHttpError, typedFetch } from "../../src/index";
import { NotFoundError } from "../../src/errors/not-found-error";

type ForeignResponse = Response & { readonly body: ReadableStream<Uint8Array> | null };

function headersWithoutGetSetCookie(): Headers {
  const headers = new Headers([["x-round2-agent4", "1"]]);
  Object.defineProperty(headers, "getSetCookie", {
    configurable: true,
    value: undefined,
  });
  return headers;
}

function foreignHttpResponse(
  cancelled: string[],
  label: string,
  headers: Headers = new Headers([["x-round2-agent4", "1"]]),
): ForeignResponse {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("payload"));
    },
    cancel() {
      cancelled.push(label);
    },
  });

  const response: Record<PropertyKey, unknown> = {
    [Symbol.toStringTag]: "Response",
    body,
    bodyUsed: false,
    headers,
    ok: false,
    redirected: false,
    status: 404,
    statusText: "Not Found",
    type: "basic",
    url: "https://round2-agent4.test/resource",
    arrayBuffer: async () => new ArrayBuffer(0),
    blob: async () => new Blob(),
    formData: async () => new FormData(),
    json: async () => ({ value: "payload" }),
    text: async () => "payload",
  };

  response.clone = () => foreignHttpResponse(cancelled, `${label}-branch`, headers);
  return response as unknown as ForeignResponse;
}

describe("public API and body-custody probes", () => {
  test("clone accepts an HTTP error whose HeadersInit lacks getSetCookie", async () => {
    const cancelled: string[] = [];
    const { error } = await typedFetch("https://round2-agent4.test/resource", {
      fetch: async () =>
        foreignHttpResponse(cancelled, "headers-init", headersWithoutGetSetCookie()),
    });

    expect(isHttpError(error)).toBe(true);
    if (!isHttpError(error)) return;

    let copy: typeof error | undefined;
    try {
      copy = error.clone();
    } finally {
      if (!copy) await error.cancel();
    }

    await Promise.all([error.cancel(), copy.cancel()]);
    expect(cancelled.toSorted()).toEqual(["headers-init", "headers-init-branch"]);
  });

  test("a clone() returning the original leaves the original error body readable", async () => {
    const response = new Response("payload", { status: 404 });
    Object.defineProperty(response, "clone", {
      configurable: true,
      value: () => response,
    });
    const error = new NotFoundError(response);

    expect(() => error.clone()).toThrow(TypeError);
    await expect(error.text()).resolves.toBe("payload");
  });

  test("cancel releases a native body even when its visible body is shadowed to null", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const response = new Response(stream, { status: 404 });
    Object.defineProperty(response, "body", {
      configurable: true,
      value: null,
    });

    const error = new NotFoundError(response);
    await error.cancel();

    expect(cancelled).toBe(true);
  });
});
