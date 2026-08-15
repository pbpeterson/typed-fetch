import { describe, expect, test } from "vitest";
import { NotFoundError } from "../../src/errors/not-found-error";
import { errorBodyOf } from "../../src/errors/error-body";
import { classifyResolvedValue, type ResponseVerdict } from "../../src/response-verdict";

function nativeBodyOf(response: Response): ReadableStream<Uint8Array> | null {
  const getter = Object.getOwnPropertyDescriptor(Response.prototype, "body")?.get;
  return typeof getter === "function"
    ? (Reflect.apply(getter, response, []) as ReadableStream<Uint8Array> | null)
    : null;
}

function httpErrorFor(response: Response) {
  const verdict = classifyResolvedValue(response);
  if (verdict.kind !== "http") throw new Error(`expected an HTTP verdict, got ${verdict.kind}`);
  return verdict.error;
}

describe("clone, validation, and body custody", () => {
  test("cancel releases a native body when bodyUsed is shadowed true", async () => {
    let cancelCalls = 0;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("payload"));
      },
      cancel() {
        cancelCalls += 1;
      },
    });
    const response = new Response(stream, { status: 404 });
    Object.defineProperty(response, "bodyUsed", {
      configurable: true,
      value: true,
    });
    const error = httpErrorFor(response);

    try {
      await error.cancel();
      expect(cancelCalls).toBe(1);
    } finally {
      if (cancelCalls === 0) await stream.cancel().catch(() => {});
    }
  });

  test("read uses the native body when bodyUsed is shadowed true", async () => {
    const response = new Response("payload", { status: 404 });
    Object.defineProperty(response, "bodyUsed", {
      configurable: true,
      value: true,
    });
    const error = httpErrorFor(response);

    try {
      await expect(error.text()).resolves.toBe("payload");
    } finally {
      await nativeBodyOf(response)
        ?.cancel()
        .catch(() => {});
    }
  });

  test("read refuses an externally consumed native body when bodyUsed is shadowed false", async () => {
    const response = new Response("payload", { status: 404 });
    const reader = response.body?.getReader();
    await reader?.read();
    reader?.releaseLock();
    Object.defineProperty(response, "bodyUsed", {
      configurable: true,
      value: false,
    });
    const error = httpErrorFor(response);

    await expect(error.text()).rejects.toThrow(/Cannot read this error's body with text\(\)/);
  });

  test("read uses the native body when a locked own body shadows it", async () => {
    const response = new Response("payload", { status: 404 });
    Object.defineProperty(response, "body", {
      configurable: true,
      value: {
        locked: true,
        cancel: () => Promise.resolve(),
        getReader: () => ({}),
        pipeThrough: () => ({}),
        pipeTo: () => Promise.resolve(),
        tee: () => [],
      },
    });
    const error = httpErrorFor(response);

    try {
      await expect(error.text()).resolves.toBe("payload");
    } finally {
      await nativeBodyOf(response)
        ?.cancel()
        .catch(() => {});
    }
  });

  test("clone uses the native body when a locked own body shadows it", async () => {
    const response = new Response("payload", { status: 404 });
    Object.defineProperty(response, "body", {
      configurable: true,
      value: {
        locked: true,
        cancel: () => Promise.resolve(),
        getReader: () => ({}),
        pipeThrough: () => ({}),
        pipeTo: () => Promise.resolve(),
        tee: () => [],
      },
    });
    const error = httpErrorFor(response);

    try {
      const copy = error.clone();
      await expect(copy.text()).resolves.toBe("payload");
    } finally {
      await error.cancel();
    }
  });

  test("a cloned native branch does not skip cancellation because bodyUsed is shadowed", async () => {
    let branchCancelCalls = 0;
    const original = new Response("original", { status: 404 });
    let branch: Response | undefined;
    Object.defineProperty(original, "clone", {
      configurable: true,
      value: () => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("branch"));
          },
          cancel() {
            branchCancelCalls += 1;
          },
        });
        branch = new Response(stream, { status: 404 });
        Object.defineProperty(branch, "bodyUsed", {
          configurable: true,
          value: true,
        });
        return branch;
      },
    });
    const error = new NotFoundError(original);
    const copy = error.clone();

    try {
      await copy.cancel();
      expect(branchCancelCalls).toBe(1);
    } finally {
      await Promise.all([error.cancel(), nativeBodyOf(branch as Response)?.cancel()]);
    }
  });

  test("cancel uses the native stream lock when an own locked value lies", async () => {
    let cancelCalls = 0;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("payload"));
      },
      cancel() {
        cancelCalls += 1;
      },
    });
    const response = new Response(stream, { status: 404 });
    Object.defineProperty(stream, "locked", {
      configurable: true,
      value: true,
    });
    const error = httpErrorFor(response);

    try {
      await error.cancel();
      expect(cancelCalls).toBe(1);
    } finally {
      await stream.cancel().catch(() => {});
    }
  });

  test("cancel rejects for a native locked stream even when its own locked value lies false", async () => {
    let cancelCalls = 0;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("payload"));
      },
      cancel() {
        cancelCalls += 1;
      },
    });
    const reader = stream.getReader();
    Object.defineProperty(stream, "locked", {
      configurable: true,
      value: false,
    });
    const error = httpErrorFor(new Response(stream, { status: 404 }));

    try {
      await expect(error.cancel()).rejects.toThrow(/stream is locked/);
      expect(cancelCalls).toBe(0);
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  });

  test("reentrant status classification does not release the body used by the outer verdict", async () => {
    let cancelCalls = 0;
    let reads = 0;
    let nested: ResponseVerdict | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("payload"));
      },
      cancel() {
        cancelCalls += 1;
      },
    });
    const response = new Response(stream, { status: 404 });
    Object.defineProperty(response, "status", {
      configurable: true,
      get() {
        reads += 1;
        if (reads === 1) nested = classifyResolvedValue(response);
        return 404;
      },
    });

    const outer = classifyResolvedValue(response);

    try {
      expect(outer.kind).toBe("http");
      expect(nested?.kind).toBe("refused");
      expect(cancelCalls).toBe(0);
    } finally {
      if (outer.kind === "http") await outer.error.cancel();
      await nativeBodyOf(response)
        ?.cancel()
        .catch(() => {});
    }
  });

  test("reentrant foreign body lookup starts cancellation only once", async () => {
    let cancelCalls = 0;
    let bodyReads = 0;
    let body: ReturnType<typeof errorBodyOf> | undefined;
    let reentrant: Promise<void> | undefined;
    const stream = {
      locked: false,
      cancel() {
        cancelCalls += 1;
        return Promise.resolve();
      },
    };
    const response = {
      get body() {
        bodyReads += 1;
        if (bodyReads === 1 && body) reentrant = body.cancel();
        return stream;
      },
      bodyUsed: false,
    } as unknown as Response;
    body = errorBodyOf(response);

    await body.cancel();
    await reentrant;
    expect(cancelCalls).toBe(1);
  });

  test("reentrant foreign bodyUsed lookup starts cancellation only once", async () => {
    let cancelCalls = 0;
    let bodyUsedReads = 0;
    let body: ReturnType<typeof errorBodyOf> | undefined;
    let reentrant: Promise<void> | undefined;
    const stream = {
      locked: false,
      cancel() {
        cancelCalls += 1;
        return Promise.resolve();
      },
    };
    const response = {
      body: stream,
      get bodyUsed() {
        bodyUsedReads += 1;
        if (bodyUsedReads === 1 && body) reentrant = body.cancel();
        return false;
      },
    } as unknown as Response;
    body = errorBodyOf(response);

    await body.cancel();
    await reentrant;
    expect(cancelCalls).toBe(1);
  });

  test("a partial clone branch is refused and the original remains readable", async () => {
    const response = new Response("payload", { status: 404 });
    Object.defineProperty(response, "clone", {
      configurable: true,
      value: () =>
        ({
          [Symbol.toStringTag]: "Response",
          body: null,
          bodyUsed: false,
          headers: new Headers(),
          status: 404,
          clone: () => null,
        }) as unknown as Response,
    });
    const error = new NotFoundError(response);

    expect(() => error.clone()).toThrow(TypeError);
    await expect(error.text()).resolves.toBe("payload");
  });

  test("a refused partial clone with a live body releases that branch", async () => {
    let branchCancelCalls = 0;
    const response = new Response("payload", { status: 404 });
    Object.defineProperty(response, "clone", {
      configurable: true,
      value: () => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("orphan"));
          },
          cancel() {
            branchCancelCalls += 1;
          },
        });
        return {
          [Symbol.toStringTag]: "Response",
          body,
          bodyUsed: false,
          headers: new Headers(),
          status: 404,
        } as unknown as Response;
      },
    });
    const error = new NotFoundError(response);

    expect(() => error.clone()).toThrow(TypeError);
    expect(branchCancelCalls).toBe(1);
    await error.cancel();
  });
});
