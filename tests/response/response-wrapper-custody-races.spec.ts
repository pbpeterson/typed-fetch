import { describe, expect, test } from "vitest";
import { errorBodyOf, releaseResponseBody } from "../../src/errors/error-body";
import { NotFoundError } from "../../src/errors/not-found-error";
import { classifyResolvedValue } from "../../src/response-verdict";

type ForeignBody = {
  locked: boolean;
  cancel(): unknown;
  getReader(): Record<string, never>;
  pipeThrough(): ForeignBody;
  pipeTo(): Promise<void>;
  tee(): [];
};

function foreignBody(cancel: () => unknown): ForeignBody {
  const body: ForeignBody = {
    locked: false,
    cancel,
    getReader: () => ({}),
    pipeThrough() {
      return body;
    },
    pipeTo: async () => undefined,
    tee: () => [],
  };
  return body;
}

function foreignResponse(body: ForeignBody, clone?: () => unknown): Response {
  const response: Record<PropertyKey, unknown> = {
    [Symbol.toStringTag]: "Response",
    body,
    bodyUsed: false,
    headers: new Headers(),
    ok: false,
    redirected: false,
    status: 404,
    statusText: "Not Found",
    type: "basic",
    url: "https://response-wrapper-custody-races.invalid/resource",
    arrayBuffer: async () => new ArrayBuffer(0),
    blob: async () => new Blob(),
    clone: () => response,
    formData: async () => new FormData(),
    json: async () => ({ value: "payload" }),
    text: async () => "payload",
  };
  if (clone) response.clone = clone;
  return response as unknown as Response;
}

describe("body custody, clone snapshots, and hostile cleanup", () => {
  test("control: independent foreign clone branches can both be released", async () => {
    let originalCancels = 0;
    let branchCancels = 0;
    const originalBody = foreignBody(() => {
      originalCancels += 1;
      return Promise.resolve();
    });
    const branchBody = foreignBody(() => {
      branchCancels += 1;
      return Promise.resolve();
    });
    const original = foreignResponse(originalBody, () => foreignResponse(branchBody));
    const error = new NotFoundError(original);
    const copy = error.clone();

    await Promise.all([error.cancel(), copy.cancel()]);

    expect(originalCancels).toBe(1);
    expect(branchCancels).toBe(1);
  });

  test("a clone branch that reuses the original stream is refused", async () => {
    let cancelCalls = 0;
    const shared = foreignBody(() => {
      cancelCalls += 1;
      return Promise.resolve();
    });
    const original = foreignResponse(shared, () => foreignResponse(shared));
    const error = new NotFoundError(original);
    let copy: NotFoundError | undefined;
    let thrown: unknown;

    try {
      copy = error.clone();
    } catch (cause) {
      thrown = cause;
    } finally {
      if (copy) await Promise.all([error.cancel(), copy.cancel()]);
    }

    expect(thrown).toBeInstanceOf(TypeError);
    expect(cancelCalls).toBe(1);
  });

  test("the body snapshot taken before clone remains the original branch", async () => {
    let originalCancels = 0;
    let decoyCancels = 0;
    let branchCancels = 0;
    const originalBody = foreignBody(() => {
      originalCancels += 1;
      return Promise.resolve();
    });
    const decoyBody = foreignBody(() => {
      decoyCancels += 1;
      return Promise.resolve();
    });
    const branchBody = foreignBody(() => {
      branchCancels += 1;
      return Promise.resolve();
    });
    let cloneHasRun = false;
    const original = foreignResponse(originalBody, () => {
      cloneHasRun = true;
      return foreignResponse(branchBody);
    });
    Object.defineProperty(original, "body", {
      configurable: true,
      get: () => (cloneHasRun ? decoyBody : originalBody),
    });

    const verdict = classifyResolvedValue(original);
    expect(verdict.kind).toBe("http");
    if (verdict.kind !== "http") return;
    const copy = verdict.error.clone();

    await Promise.all([verdict.error.cancel(), copy.cancel()]);

    expect(originalCancels).toBe(1);
    expect(decoyCancels).toBe(0);
    expect(branchCancels).toBe(1);
  });

  test("two error-body wrappers cannot cancel the same response concurrently", async () => {
    let cancelCalls = 0;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const body = foreignBody(() => {
      cancelCalls += 1;
      return pending;
    });
    const response = { body, bodyUsed: false } as unknown as Response;
    const first = errorBodyOf(response);
    const second = errorBodyOf(response);

    const firstCancel = first.cancel();
    const secondCancel = second.cancel();

    expect(cancelCalls).toBe(1);
    release();
    await Promise.all([firstCancel, secondCancel]);
  });

  test("a read and a cancel through different wrappers cannot race one body", async () => {
    let textCalls = 0;
    let cancelCalls = 0;
    const body = foreignBody(() => {
      cancelCalls += 1;
      return Promise.resolve();
    });
    const response = {
      body,
      bodyUsed: false,
      text: async () => {
        textCalls += 1;
        return "payload";
      },
    } as unknown as Response;
    const reader = errorBodyOf(response);
    const releaser = errorBodyOf(response);

    const text = reader.text();
    const cancellation = releaser.cancel();

    await Promise.all([text, cancellation]);
    expect(textCalls).toBe(1);
    expect(cancelCalls).toBe(0);
  });

  test("releaseResponseBody does not start a second cleanup while the first is pending", async () => {
    let cancelCalls = 0;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const body = foreignBody(() => {
      cancelCalls += 1;
      return pending;
    });
    const response = { body } as unknown as Response;

    releaseResponseBody(response);
    releaseResponseBody(response);

    expect(cancelCalls).toBe(1);
    release();
    await Promise.resolve();
  });

  test("control: a hostile cancel thenable is observed without duplicate cancel", async () => {
    let cancelCalls = 0;
    let bodyHandle: ReturnType<typeof errorBodyOf> | undefined;
    let nestedCancel: Promise<void> | undefined;
    const thenable = {
      // oxlint-disable-next-line no-thenable -- the probe intentionally models a hostile thenable
      then(resolve: () => void) {
        nestedCancel = bodyHandle?.cancel();
        resolve();
      },
    };
    const body = foreignBody(() => {
      cancelCalls += 1;
      return thenable;
    });
    const response = { body, bodyUsed: false } as unknown as Response;
    bodyHandle = errorBodyOf(response);

    await bodyHandle.cancel();
    await nestedCancel;
    expect(cancelCalls).toBe(1);
  });

  test("release cleanup observes a rejected foreign destroy promise", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    let rejectDestroy!: (reason: unknown) => void;
    const pending = new Promise<never>((_resolve, reject) => {
      rejectDestroy = reject;
    });
    const response = {
      body: {
        locked: false,
        destroy: () => pending,
      },
    } as unknown as Response;

    process.on("unhandledRejection", onUnhandled);
    try {
      const verdict = classifyResolvedValue(response);
      expect(verdict.kind).toBe("refused");
      rejectDestroy(new Error("destroy failed"));
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }

    expect(unhandled).toEqual([]);
  });
});
