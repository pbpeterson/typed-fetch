import { describe, expect, test } from "vitest";
import { errorBodyOf, releaseResponseBody } from "../../src/errors/error-body";

describe("round 4 / agent 2 — error-body, streams, and clone probes", () => {
  test("control: a native response with an untouched body releases once", async () => {
    let cancelCalls = 0;
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        cancelCalls += 1;
      },
    });
    const response = new Response(stream);

    await errorBodyOf(response).cancel();

    expect(cancelCalls).toBe(1);
  });

  test("native bodyUsed shadow getter cannot block release of the native body", async () => {
    let cancelCalls = 0;
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        cancelCalls += 1;
      },
    });
    const response = new Response(stream);
    Object.defineProperty(response, "bodyUsed", {
      configurable: true,
      get() {
        throw new Error("shadow bodyUsed getter exploded");
      },
    });

    // A native Response still owns the internal body slot. The same module
    // already bypasses an own `body` value; an untrusted own bodyUsed getter
    // must not turn a live native body into an unreleasable one.
    await expect(errorBodyOf(response).cancel()).resolves.toBeUndefined();
    expect(cancelCalls).toBe(1);
  });

  test("a native bodyUsed getter that lies false cannot reopen a consumed body", async () => {
    const response = new Response("payload");
    const reader = response.body?.getReader();
    await reader?.read();
    reader?.releaseLock();
    Object.defineProperty(response, "bodyUsed", {
      configurable: true,
      get: () => false,
    });

    expect(response.bodyUsed).toBe(false);
    expect(response.body?.locked).toBe(false);
    const nativeBodyUsed = Object.getOwnPropertyDescriptor(Response.prototype, "bodyUsed")?.get;
    if (!nativeBodyUsed) throw new Error("expected the native bodyUsed getter");
    expect(Reflect.apply(nativeBodyUsed, response, [])).toBe(true);

    // The native internal body is already consumed. A public accessor shadow
    // must not make the library hand the body back to its reader and expose
    // the platform's opaque "Body is unusable" error.
    await expect(errorBodyOf(response).text()).rejects.toThrow(
      /Cannot read this error's body with text\(\)/,
    );
  });

  test("control: a foreign body without re-entry is cancelled exactly once", () => {
    let cancelCalls = 0;
    const response = {
      body: {
        locked: false,
        cancel() {
          cancelCalls += 1;
        },
      },
    } as unknown as Response;

    releaseResponseBody(response);

    expect(cancelCalls).toBe(1);
  });

  test("re-entrant release cleanup invokes a foreign cancel exactly once", () => {
    let cancelCalls = 0;
    let reentered = false;
    let response!: Response;
    const body = {
      locked: false,
      cancel() {
        cancelCalls += 1;
        if (!reentered) {
          reentered = true;
          releaseResponseBody(response);
        }
      },
    };
    response = { body } as unknown as Response;

    releaseResponseBody(response);

    // Cleanup owns one release attempt. A hostile cancel callback can call
    // back synchronously before the first attempt returns, but it must not
    // make the same body receive a second cancellation.
    expect(cancelCalls).toBe(1);
  });

  test("a rejecting Promise is handled through intrinsic then, not catch", async () => {
    let rejectionHandlers = 0;
    let rejectPending!: (reason: unknown) => void;
    const pending = new Promise<never>((_resolve, reject) => {
      rejectPending = reject;
    });
    const originalCatch = pending.catch.bind(pending);
    Object.defineProperty(pending, "catch", {
      configurable: true,
      value(handler: (reason: unknown) => unknown) {
        rejectionHandlers += 1;
        return originalCatch(handler);
      },
    });

    const response = {
      body: {
        locked: false,
        cancel: () => pending,
      },
    } as unknown as Response;

    // The replaceable `.catch` is deliberately observable, but cleanup must
    // bypass it and use the captured native `then` instead.
    releaseResponseBody(response);

    expect(rejectionHandlers).toBe(0);
    rejectPending(new Error("stream rejected"));
    await Promise.resolve();
  });

  test("release cleanup attaches a rejection handler without trusting catch", async () => {
    let rejectionHandlers = 0;
    let rejectPending!: (reason: unknown) => void;
    const pending = new Promise<never>((_resolve, reject) => {
      rejectPending = reject;
    });
    const originalThen = pending.then.bind(pending);
    Object.defineProperty(pending, "catch", {
      configurable: true,
      value: undefined,
    });
    // oxlint-disable-next-line no-thenable -- a replaceable then member is the probe
    Object.defineProperty(pending, "then", {
      configurable: true,
      value(
        onFulfilled: ((value: unknown) => unknown) | undefined,
        onRejected: ((reason: unknown) => unknown) | undefined,
      ) {
        if (typeof onRejected === "function") rejectionHandlers += 1;
        return originalThen(onFulfilled, onRejected);
      },
    });

    const response = {
      body: {
        locked: false,
        cancel: () => pending,
      },
    } as unknown as Response;

    releaseResponseBody(response);

    // `catch` is a replaceable property. A rejecting Promise still exposes
    // the rejection path through `then`; cleanup must attach a handler there
    // or this fire-and-forget release creates an unhandled rejection.
    expect(rejectionHandlers).toBe(0);

    // Keep this probe self-contained: install a final intrinsic handler and
    // then reject the deferred promise.
    void Promise.prototype.then.call(pending, undefined, () => {});
    rejectPending(new Error("stream rejected"));
    await Promise.resolve();
  });

  test("public cancel does not trust a shadowed Promise.catch", async () => {
    let rejectPending!: (reason: unknown) => void;
    const pending = new Promise<never>((_resolve, reject) => {
      rejectPending = reject;
    });
    Object.defineProperty(pending, "catch", {
      configurable: true,
      value: undefined,
    });

    const response = {
      bodyUsed: false,
      body: {
        locked: false,
        cancel: () => pending,
      },
    } as unknown as Response;

    const cancellation = errorBodyOf(response).cancel();

    void Promise.prototype.then.call(pending, undefined, () => {});
    rejectPending(new Error("stream rejected"));
    await expect(cancellation).resolves.toBeUndefined();
    await Promise.resolve();
  });
});
