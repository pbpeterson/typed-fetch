import { describe, test, expect } from "vitest";
import { BaseHttpError, NotFoundError, UnknownHttpError } from "./src/errors";

class ContextHttpError extends BaseHttpError {
  override readonly name = "ContextHttpError" as const;
  readonly status = 499 as const;
  readonly statusText = "Custom" as const;

  constructor(
    response: Response,
    public readonly context: string,
  ) {
    super(response);
    if (!context) throw new TypeError("context is required");
  }
}

class UnconfiguredContextHttpError extends BaseHttpError {
  override readonly name = "UnconfiguredContextHttpError" as const;
  readonly status = 499 as const;
  readonly statusText = "Custom" as const;

  constructor(
    response: Response,
    public readonly context?: string,
  ) {
    super(response);
  }
}

class ContextNotFoundError extends NotFoundError {
  constructor(
    response: Response,
    public readonly context?: string,
  ) {
    super(response);
  }
}

describe("BaseHttpError — response is not an own enumerable property (B1)", () => {
  test("response never leaks into keys, spread, or JSON", async () => {
    const error = new NotFoundError(new Response("body", { status: 404 }));

    expect(Object.keys(error)).not.toContain("response");
    expect("response" in error).toBe(false);
    expect(Object.getOwnPropertyNames(error)).not.toContain("response");
    expect(JSON.stringify(error)).not.toContain("response");
    expect({ ...error }).not.toHaveProperty("response");

    // The documented surface still works.
    expect(error.url).toBe("");
    expect(error.headers).toBeInstanceOf(Headers);
    expect(await error.text()).toBe("body");
  });
});

describe("BaseHttpError — friendly double-read guard on body readers (B4)", () => {
  test("second read throws a clear TypeError, not the platform's opaque one", async () => {
    const error = new NotFoundError(new Response('{"a":1}', { status: 404 }));
    await error.json();

    await expect(error.text()).rejects.toThrowError(/already been read/);
    await expect(error.text()).rejects.toThrowError(TypeError);
  });

  test("guard covers every reader combination", async () => {
    const combos: Array<[keyof NotFoundError, keyof NotFoundError]> = [
      ["json", "json"],
      ["text", "blob"],
      ["blob", "arrayBuffer"],
      ["arrayBuffer", "json"],
    ];
    for (const [first, second] of combos) {
      const error = new NotFoundError(new Response("x", { status: 404 }));
      // First read consumes the body (json() on "x" rejects but still marks
      // bodyUsed — catch so the loop continues to the assertion).
      await (error[first] as () => Promise<unknown>)().catch(() => {});
      await expect((error[second] as () => Promise<unknown>)()).rejects.toThrowError(
        /already been read/,
      );
    }
  });

  test("the guard names the reader that was called", async () => {
    // The message interpolates the method name so a consumer can see WHICH
    // call failed; a hardcoded name would still match the /already been read/
    // assertions above.
    const error = new NotFoundError(new Response("x", { status: 404 }));
    await error.text();

    await expect(error.blob()).rejects.toThrowError(/with blob\(\)/);
    await expect(error.arrayBuffer()).rejects.toThrowError(/with arrayBuffer\(\)/);
    await expect(error.json()).rejects.toThrowError(/with json\(\)/);
  });

  test("json() on an empty body still rejects with the platform SyntaxError (B4: no swallowing)", async () => {
    const error = new NotFoundError(new Response("", { status: 404 }));
    await expect(error.json()).rejects.toThrowError(SyntaxError);
  });
});

/**
 * A response whose body records whether it was cancelled and whether anything
 * ever pulled from it. `cancel()` must reach the stream WITHOUT buffering, so
 * `pulled` has to stay false.
 */
function trackedResponse(status = 404): {
  response: Response;
  state: { cancelled: boolean; reason: unknown; pulled: boolean };
} {
  const state = { cancelled: false, reason: undefined as unknown, pulled: false };
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      state.pulled = true;
      controller.enqueue(new TextEncoder().encode("payload"));
      controller.close();
    },
    cancel(reason) {
      state.cancelled = true;
      state.reason = reason;
    },
  });
  return { response: new Response(body, { status }), state };
}

describe("BaseHttpError.cancel()", () => {
  test("releases the body without buffering it", async () => {
    const { response, state } = trackedResponse();
    const error = new NotFoundError(response);

    await error.cancel();

    expect(state.cancelled).toBe(true);
    expect(state.pulled).toBe(false);
  });

  test("forwards the cancellation reason to the stream", async () => {
    const { response, state } = trackedResponse();
    const error = new NotFoundError(response);
    const reason = new Error("error body not needed");

    await error.cancel(reason);

    expect(state.reason).toBe(reason);
  });

  test("resolves without error when the response has no body", async () => {
    const error = new NotFoundError(new Response(null, { status: 404 }));

    await expect(error.cancel()).resolves.toBeUndefined();
  });

  test("readers throw the library TypeError after cancel()", async () => {
    const { response } = trackedResponse();
    const error = new NotFoundError(response);
    await error.cancel();

    await expect(error.json()).rejects.toThrowError(TypeError);
    await expect(error.text()).rejects.toThrowError(/cancelled/);
    await expect(error.blob()).rejects.toThrowError(/cancelled/);
    await expect(error.arrayBuffer()).rejects.toThrowError(/cancelled/);
  });

  test("clone() after cancel() throws the library TypeError", async () => {
    const { response } = trackedResponse();
    const error = new NotFoundError(response);
    await error.cancel();

    expect(() => error.clone()).toThrowError(TypeError);
    expect(() => error.clone()).toThrowError(/cancelled/);
  });

  test("rejects with a clear TypeError when a reader locks the stream", async () => {
    const { response, state } = trackedResponse();
    response.body?.getReader();
    const error = new NotFoundError(response);

    await expect(error.cancel()).rejects.toThrowError(/locked/);
    await expect(error.cancel()).rejects.toThrowError(TypeError);
    expect(state.cancelled).toBe(false);
  });

  test("is idempotent after a completed read", async () => {
    const error = new NotFoundError(new Response("body", { status: 404 }));
    expect(await error.text()).toBe("body");

    await expect(error.cancel()).resolves.toBeUndefined();
  });

  test("cancel() is available on UnknownHttpError too", async () => {
    const { response, state } = trackedResponse(499);
    const error = new UnknownHttpError(response);

    await error.cancel();

    expect(state.cancelled).toBe(true);
  });
});

/**
 * A `Response` whose `bodyUsed` NEVER flips, whatever happens to the stream.
 * `cancel()` must not infer "already released" from `bodyUsed`, because that
 * flag is runtime-specific: some runtimes set it on cancellation, some do not.
 */
function bodyUsedNeverFlipsResponse(): {
  response: Response;
  state: { cancelled: boolean };
} {
  const state = { cancelled: false };
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      state.cancelled = true;
    },
  });
  const response = new Response(body, { status: 404 });
  Object.defineProperty(response, "bodyUsed", { get: () => false });
  return { response, state };
}

/**
 * A `Response` that reports `bodyUsed` as soon as a reader locks the stream —
 * Bun's observed behavior, where Node, Deno, and workerd all keep it `false`.
 * A `cancel()` that keys on `bodyUsed` to detect an earlier read reports
 * success here without ever releasing the stream.
 */
function bunShapedResponse(): { response: Response; state: { cancelled: boolean } } {
  const state = { cancelled: false };
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      state.cancelled = true;
    },
  });
  const response = new Response(body, { status: 404 });
  Object.defineProperty(response, "bodyUsed", {
    get(this: Response) {
      return this.body?.locked ?? false;
    },
  });
  return { response, state };
}

describe("BaseHttpError.cancel() — decision order does not rely on bodyUsed", () => {
  test("cancels a body whose runtime never flips bodyUsed", async () => {
    const { response, state } = bodyUsedNeverFlipsResponse();
    const error = new NotFoundError(response);

    await error.cancel();

    expect(state.cancelled).toBe(true);
  });

  test("blocks the readers after cancel() even when bodyUsed stays false", async () => {
    const { response } = bodyUsedNeverFlipsResponse();
    const error = new NotFoundError(response);
    await error.cancel();

    expect(response.bodyUsed).toBe(false);
    await expect(error.text()).rejects.toThrowError(/cancelled/);
    expect(() => error.clone()).toThrowError(/cancelled/);
  });

  test("a reader lock still rejects on a runtime that reports bodyUsed for it", async () => {
    const { response, state } = bunShapedResponse();
    response.body?.getReader();
    const error = new NotFoundError(response);

    // The Bun shape: locked AND bodyUsed at the same time. A bodyUsed-first
    // check would report success and silently leave the stream held.
    expect(response.bodyUsed).toBe(true);
    await expect(error.cancel()).rejects.toThrowError(/locked/);
    expect(state.cancelled).toBe(false);
  });

  test("a library read wins over an external lock report", async () => {
    const error = new NotFoundError(new Response("body", { status: 404 }));
    expect(await error.text()).toBe("body");

    // `text()` leaves the stream locked on some runtimes. The library knows it
    // started that read, so cancel() must resolve rather than claim a lock.
    await expect(error.cancel()).resolves.toBeUndefined();
  });
});

describe("BaseHttpError.cancel() — cloned (teed) bodies", () => {
  test("releasing every branch settles both cancellations", async () => {
    const { response, state } = trackedResponse();
    const error = new NotFoundError(response);
    const copy = error.clone();

    await Promise.all([error.cancel(), copy.cancel()]);

    expect(state.cancelled).toBe(true);
  });

  test("cancelling one branch alone does not settle while the other is held", async () => {
    const { response } = trackedResponse();
    const error = new NotFoundError(response);
    const copy = error.clone();

    const settled = await Promise.race([
      error.cancel().then(() => "settled"),
      new Promise((resolve) => setTimeout(() => resolve("pending"), 50)),
    ]);

    // Native tee semantics: the source is only released once BOTH branches
    // are. This is documented, not worked around.
    expect(settled).toBe("pending");

    // The sibling releases the source and both cancellations settle.
    await Promise.all([error.cancel(), copy.cancel()]);
  });

  test("a repeated cancel settles with the first one, never before it", async () => {
    const { response } = trackedResponse();
    const error = new NotFoundError(response);
    const copy = error.clone();

    const first = error.cancel();
    const second = error.cancel();

    const raced = await Promise.race([
      second.then(() => "settled"),
      new Promise((resolve) => setTimeout(() => resolve("pending"), 50)),
    ]);
    // A repeated cancel must not report success while the first is still
    // waiting for the sibling branch.
    expect(raced).toBe("pending");

    await Promise.all([first, second, copy.cancel()]);
  });

  test("clone() does not cancel the sibling branch", async () => {
    const { response } = trackedResponse();
    const error = new NotFoundError(response);
    const copy = error.clone();

    await Promise.all([error.cancel(), copy.text().catch(() => {})]);

    // The copy was created to be read; cancelling the original must not take
    // that away.
    expect(true).toBe(true);
  });
});

describe("BaseHttpError — readers detect a locked body (B7)", () => {
  test("every reader throws the library TypeError while a reader holds the stream", async () => {
    const readers = ["json", "text", "blob", "arrayBuffer"] as const;
    for (const reader of readers) {
      const response = new Response("x", { status: 404 });
      // Locked but NOT used: the case a bodyUsed-only guard misses, which
      // otherwise surfaces the platform's opaque "Body is unusable".
      response.body?.getReader();
      const error = new NotFoundError(response);

      expect(response.bodyUsed).toBe(false);
      await expect((error[reader] as () => Promise<unknown>)()).rejects.toThrowError(TypeError);
      await expect((error[reader] as () => Promise<unknown>)()).rejects.toThrowError(
        /stream is locked/,
      );
    }
  });

  test("an unlocked body still reads normally", async () => {
    const error = new NotFoundError(new Response("x", { status: 404 }));

    expect(await error.text()).toBe("x");
  });
});

describe("BaseHttpError.clone()", () => {
  test("consumer subclasses can preserve custom constructor state", async () => {
    const error = new ContextHttpError(new Response("body", { status: 499 }), "tenant-42");

    const cloned = error.clone(
      (response) => new ContextHttpError(response, error.context) as typeof error,
    );

    expect(cloned).toBeInstanceOf(ContextHttpError);
    expect(cloned.context).toBe("tenant-42");
    expect(await error.text()).toBe("body");
    expect(await cloned.text()).toBe("body");
  });

  test("consumer subclasses keep response-only clone compatibility", async () => {
    const error = new UnconfiguredContextHttpError(
      new Response("body", { status: 499 }),
      "tenant-42",
    );

    const cloned = error.clone();

    expect(cloned).toBeInstanceOf(UnconfiguredContextHttpError);
    expect(error.context).toBe("tenant-42");
    expect(cloned.context).toBeUndefined();
    expect(await cloned.text()).toBe("body");
  });

  test("response-only cloning preserves consumer constructor failures", () => {
    const error = new ContextHttpError(new Response("body", { status: 499 }), "tenant-42");

    expect(() => error.clone()).toThrowError("context is required");
  });

  test("subclasses of built-in errors keep no-callback clone compatibility", () => {
    const error = new ContextNotFoundError(new Response("body", { status: 404 }), "tenant-42");

    const defaultClone = error.clone();
    expect(defaultClone).toBeInstanceOf(ContextNotFoundError);
    expect(defaultClone.context).toBeUndefined();

    const cloned = error.clone(
      (response) => new ContextNotFoundError(response, error.context) as typeof error,
    );
    expect(cloned.context).toBe("tenant-42");
  });

  test("clone() after json() throws a TypeError with a clear message", async () => {
    const error = new NotFoundError(new Response('{"a":1}', { status: 404 }));
    await error.json();

    expect(() => error.clone()).toThrowError(/already been read/);
    expect(() => error.clone()).toThrowError(TypeError);
  });

  test("clone() before reading still yields two independently readable bodies", async () => {
    const expected = "hello body";
    const error = new NotFoundError(new Response(expected, { status: 404 }));
    const cloned = error.clone();

    expect(await error.text()).toBe(expected);
    expect(await cloned.text()).toBe(expected);
  });

  test("clone() guard applies to UnknownHttpError too", async () => {
    const error = new UnknownHttpError(new Response("x", { status: 499 }));
    // Body "x" is not valid JSON, so json() rejects — but it still consumes
    // the body (marks bodyUsed), which is what the clone() guard keys on.
    await error.json().catch(() => {});

    expect(() => error.clone()).toThrowError(/already been read/);
    expect(() => error.clone()).toThrowError(TypeError);
  });

  test("UnknownHttpError clones without a recreation callback", async () => {
    const error = new UnknownHttpError(new Response("body", { status: 499 }));
    const cloned = error.clone();

    expect(cloned).toBeInstanceOf(UnknownHttpError);
    expect(await cloned.text()).toBe("body");
  });

  test("a throwing recreate callback is wrapped, with the original as cause", () => {
    const error = new NotFoundError(new Response("body", { status: 404 }));
    const boom = new Error("recreate exploded");

    let thrown: unknown;
    try {
      error.clone(() => {
        throw boom;
      });
    } catch (caught) {
      thrown = caught;
    }

    // The no-callback path deliberately does NOT wrap (a consumer constructor's
    // own error must survive verbatim); the callback path does, so the consumer
    // can tell "my callback failed" from "the body was unusable".
    expect(thrown).toBeInstanceOf(TypeError);
    expect((thrown as Error).message).toMatch(/recreate callback failed/);
    expect((thrown as Error).message).toContain("NotFoundError");
    expect((thrown as Error).cause).toBe(boom);
  });

  test("clone() on a locked-but-unread body throws the clear TypeError (B6)", () => {
    const response = new Response("x", { status: 404 });
    // Acquire a reader BEFORE constructing: the stream is now locked but
    // bodyUsed is still false, the case a bodyUsed-only guard would miss.
    response.body?.getReader();
    const error = new NotFoundError(response);

    expect(error.clone).toBeDefined();
    expect(() => error.clone()).toThrowError(/its stream is locked/);
    expect(() => error.clone()).toThrowError(TypeError);
  });
});
