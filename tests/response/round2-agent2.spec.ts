import { describe, expect, test } from "vitest";
import { classifyResolvedValue } from "../../src/response-verdict";
import { NotFoundError } from "../../src/errors/not-found-error";

type ForeignResponse = Response & { readonly body: ReadableStream<Uint8Array> | null };

function headersWithoutGetSetCookie(): Headers {
  const headers = new Headers([["x-round2", "1"]]);
  Object.defineProperty(headers, "getSetCookie", {
    configurable: true,
    value: undefined,
  });
  return headers;
}

function foreignHttpResponse(
  cancelled: string[],
  label: string,
  headers: Headers = new Headers([["x-round2", "1"]]),
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
    url: "https://round2.test/resource",
    arrayBuffer: async () => new ArrayBuffer(0),
    blob: async () => new Blob(),
    formData: async () => new FormData(),
    json: async () => ({ value: "payload" }),
    text: async () => "payload",
  };

  response.clone = () => foreignHttpResponse(cancelled, `${label}-branch`, headers);
  return response as unknown as ForeignResponse;
}

function httpErrorFor(response: Response) {
  const verdict = classifyResolvedValue(response);
  if (verdict.kind !== "http") throw new Error(`expected HTTP verdict, got ${verdict.kind}`);
  return verdict.error;
}

describe("round 2 / agent 2 — response, clone, and custody probes", () => {
  test("a complete foreign HTTP error still clones and releases both live bodies", async () => {
    const cancelled: string[] = [];
    const error = httpErrorFor(foreignHttpResponse(cancelled, "complete"));
    const copy = error.clone();
    const copyOfCopy = copy.clone();

    await Promise.all([error.cancel(), copy.cancel(), copyOfCopy.cancel()]);

    expect(cancelled.toSorted()).toEqual(["complete", "complete-branch", "complete-branch-branch"]);
  });

  test("clone preserves the HTTP-error HeadersInit compatibility path", async () => {
    const cancelled: string[] = [];
    const error = httpErrorFor(
      foreignHttpResponse(cancelled, "headers-init", headersWithoutGetSetCookie()),
    );

    let copy: typeof error | undefined;
    try {
      copy = error.clone();
    } finally {
      if (!copy) await error.cancel();
    }

    await Promise.all([error.cancel(), copy.cancel()]);
    expect(cancelled.toSorted()).toEqual(["headers-init", "headers-init-branch"]);
  });

  test("status identity caching keeps one successful getter read under re-entry", () => {
    let reads = 0;
    let nested: ReturnType<typeof classifyResolvedValue> | undefined;
    const response: Record<PropertyKey, unknown> = {
      [Symbol.toStringTag]: "Response",
      body: null,
      bodyUsed: false,
      headers: new Headers(),
      ok: true,
      redirected: false,
      statusText: "OK",
      type: "basic",
      url: "https://round2.test/reentrant",
      arrayBuffer: async () => new ArrayBuffer(0),
      blob: async () => new Blob(),
      clone: () => response,
      formData: async () => new FormData(),
      json: async () => ({}),
      text: async () => "",
    };
    Object.defineProperty(response, "status", {
      configurable: true,
      get() {
        reads += 1;
        if (reads === 1) nested = classifyResolvedValue(response);
        return reads === 1 ? 200 : 404;
      },
    });

    const outer = classifyResolvedValue(response);

    expect(outer.kind).toBeDefined();
    expect(nested?.kind).toBeDefined();
    expect(reads).toBe(1);
  });

  test("a clone() returning the original keeps the original body usable after refusal", async () => {
    const response = new Response("payload", { status: 404 });
    Object.defineProperty(response, "clone", {
      configurable: true,
      value: () => response,
    });
    const error = httpErrorFor(response);
    expect(error).toBeInstanceOf(NotFoundError);

    expect(() => error.clone()).toThrow(TypeError);
    await expect(error.text()).resolves.toBe("payload");
  });

  test("an accepted native HTTP error with a shadowed null body still releases its native stream", async () => {
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

    const error = httpErrorFor(response);
    expect(error).toBeInstanceOf(NotFoundError);
    await error.cancel();

    try {
      expect(cancelled).toBe(true);
    } finally {
      await stream.cancel();
    }
  });
});
