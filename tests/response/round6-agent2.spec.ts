import { describe, expect, test } from "vitest";
import { errorBodyOf } from "../../src/errors/error-body";
import { NotFoundError } from "../../src/errors/not-found-error";

/**
 * Round 6 / agent 2 — lifecycle cases not covered by round 5.
 *
 * This lane intentionally does not change production code. A red assertion is
 * a finding only when its oracle is a public lifecycle invariant, not merely a
 * preferred implementation detail.
 *
 * Deliberate duplicates, not re-run here:
 * - shared clone streams, post-clone body snapshots, and two wrappers over one
 *   body: round5-agent2.spec.ts;
 * - rejected `destroy()` cleanup promises: round5-agent2.spec.ts;
 * - nested wrappers and retry/body identity: round5-agent3.spec.ts;
 * - cross-copy adopt/recreate ownership: base-http-error.spec.ts B1–B7.
 * The locked clone-branch case is a documented residual (base-http-error.spec.ts
 * B10b/B13), so it is not reported as a bug here.
 */

type Settled = "resolved" | "rejected" | "pending";

function settlesWithin(promise: Promise<unknown>, ms = 80): Promise<Settled> {
  return Promise.race([
    promise.then(
      () => "resolved" as const,
      () => "rejected" as const,
    ),
    new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), ms)),
  ]);
}

function bodyResponse(body: {
  locked: boolean;
  cancel?: (reason?: unknown) => unknown;
  destroy?: () => unknown;
}): Response {
  return { body, bodyUsed: false } as unknown as Response;
}

describe("round 6 / agent 2 — clone and branch lifecycle", () => {
  test("control: a synchronous response.clone() error leaves an untouched source readable", async () => {
    const response = new Response("payload", { status: 404 });
    const cause = new Error("clone failed synchronously");
    Object.defineProperty(response, "clone", {
      configurable: true,
      value() {
        throw cause;
      },
    });

    const error = new NotFoundError(response);

    expect(() => error.clone()).toThrow(cause);
    await expect(error.text()).resolves.toBe("payload");
  });

  test("control: after clone, reading one branch and cancelling the other both settle", async () => {
    const error = new NotFoundError(new Response("payload", { status: 404 }));
    const copy = error.clone();

    const [text] = await Promise.all([error.text(), copy.cancel()]);

    expect(text).toBe("payload");
  });

  test("control: a null-body clone has two independently releasable branches", async () => {
    const error = new NotFoundError(new Response(null, { status: 404 }));
    const copy = error.clone();

    await expect(Promise.all([error.cancel(), copy.cancel()])).resolves.toEqual([
      undefined,
      undefined,
    ]);
  });

  test("control: an abort-like stream error after clone does not strand either branch", async () => {
    const abort = new AbortController();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        abort.signal.addEventListener("abort", () => controller.error(abort.signal.reason), {
          once: true,
        });
      },
    });
    const error = new NotFoundError(new Response(stream, { status: 404 }));
    const copy = error.clone();

    abort.abort(new Error("request aborted"));

    const result = await settlesWithin(Promise.all([error.cancel(), copy.cancel()]));
    expect(result).toBe("resolved");
  });

  test("control: a custom clone with a null branch body can be adopted and released", async () => {
    const response = new Response("source", { status: 404 });
    const branch = new Response(null, { status: 404 });
    Object.defineProperty(response, "clone", {
      configurable: true,
      value: () => branch,
    });

    const error = new NotFoundError(response);
    const copy = error.clone();

    await expect(Promise.all([error.cancel(), copy.cancel()])).resolves.toEqual([
      undefined,
      undefined,
    ]);
  });
});

describe("round 6 / agent 2 — foreign body cleanup fallbacks", () => {
  test("finding: errorBodyOf.cancel() destroys a foreign body with no cancel method", async () => {
    let destroyCalls = 0;
    const response = bodyResponse({
      locked: false,
      destroy() {
        destroyCalls += 1;
      },
    });

    await expect(errorBodyOf(response).cancel()).resolves.toBeUndefined();
    expect(destroyCalls).toBe(1);
  });

  test("finding: errorBodyOf.cancel() falls back to destroy when cancel access throws", async () => {
    let destroyCalls = 0;
    const cancelCause = new Error("cancel getter refused");
    const body = {
      locked: false,
      get cancel(): never {
        throw cancelCause;
      },
      destroy() {
        destroyCalls += 1;
      },
    };

    await expect(errorBodyOf(bodyResponse(body)).cancel()).resolves.toBeUndefined();
    expect(destroyCalls).toBe(1);
  });

  test("control: a rejecting cancel thenable is observed without an unhandled rejection", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    const streamFailure = new Error("stream already errored");
    const body = {
      locked: false,
      cancel() {
        const thenable = Object.create(null) as Record<PropertyKey, unknown>;
        Object.defineProperty(thenable, ["t", "hen"].join(""), {
          value(_resolve: () => void, reject: (reason: unknown) => void) {
            queueMicrotask(() => reject(streamFailure));
          },
        });
        return thenable;
      },
    };

    process.on("unhandledRejection", onUnhandled);
    try {
      await expect(errorBodyOf(bodyResponse(body)).cancel()).resolves.toBeUndefined();
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }

    expect(unhandled).toEqual([]);
  });
});
