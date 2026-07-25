import { describe, test, expect, expectTypeOf } from "vitest";
import { errorBodyOf, type ErrorBody } from "./src/errors/error-body";

/**
 * A response whose body records whether it was cancelled and whether anything
 * ever pulled from it. `cancel()` must reach the stream WITHOUT buffering, so
 * `pulled` has to stay false.
 */
function trackedResponse(): {
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
  return { response: new Response(body), state };
}

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
  const response = new Response(body);
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
  const response = new Response(body);
  Object.defineProperty(response, "bodyUsed", {
    get(this: Response) {
      return this.body?.locked ?? false;
    },
  });
  return { response, state };
}

/**
 * A `Response` whose body stream is ALREADY errored — the shape of a truncated
 * response. When a connection drops mid-body, undici errors the body stream
 * with `TypeError: terminated`, and `stream.cancel()` then rejects with that
 * stored error instead of resolving.
 *
 * `start` errors the stream, NOT `pull`. `start` runs synchronously inside the
 * `ReadableStream` constructor, so the stream is errored before `errorBodyOf`
 * ever sees it. `pull` runs only when the stream is asked for data, which makes
 * the errored state depend on microtask timing.
 *
 * Measured on Node 20.15: the errored stream reports neither `bodyUsed` nor
 * `locked`, so `cancel()` reaches step 5 and calls `stream.cancel()`.
 */
function erroredBodyResponse(): { response: Response; state: { cancelled: boolean } } {
  const state = { cancelled: false };
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(new TypeError("terminated"));
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { response: new Response(body), state };
}

describe("errorBodyOf — the readers are single-use", () => {
  test("second read throws a clear TypeError, not the platform's opaque one", async () => {
    const body = errorBodyOf(new Response('{"a":1}'));
    await body.json();

    await expect(body.text()).rejects.toThrowError(/already been read/);
    await expect(body.text()).rejects.toThrowError(TypeError);
  });

  test("guard covers every reader combination", async () => {
    const combos: Array<[keyof ErrorBody, keyof ErrorBody]> = [
      ["json", "json"],
      ["text", "blob"],
      ["blob", "arrayBuffer"],
      ["arrayBuffer", "json"],
    ];
    for (const [first, second] of combos) {
      const body = errorBodyOf(new Response("x"));
      // First read consumes the body (json() on "x" rejects but still marks
      // bodyUsed — catch so the loop continues to the assertion).
      await (body[first] as () => Promise<unknown>)().catch(() => {});
      await expect((body[second] as () => Promise<unknown>)()).rejects.toThrowError(
        /already been read/,
      );
    }
  });

  test("the guard names the reader that was called", async () => {
    // The message interpolates the method name so a consumer can see WHICH
    // call failed; a hardcoded name would still match the /already been read/
    // assertions above.
    const body = errorBodyOf(new Response("x"));
    await body.text();

    await expect(body.blob()).rejects.toThrowError(/with blob\(\)/);
    await expect(body.arrayBuffer()).rejects.toThrowError(/with arrayBuffer\(\)/);
    await expect(body.json()).rejects.toThrowError(/with json\(\)/);
  });

  test("json() on an empty body still rejects with the platform SyntaxError (no swallowing)", async () => {
    const body = errorBodyOf(new Response(""));
    await expect(body.json()).rejects.toThrowError(SyntaxError);
  });

  test("json<T>() returns Promise<T>", () => {
    const body = errorBodyOf(new Response("{}"));
    // The generic must survive the delegation from BaseHttpError.json<T>().
    expectTypeOf(body.json<{ message: string }>()).toEqualTypeOf<Promise<{ message: string }>>();
  });
});

describe("errorBodyOf — cancel() releases without buffering", () => {
  test("releases the body without buffering it", async () => {
    const { response, state } = trackedResponse();
    const body = errorBodyOf(response);

    await body.cancel();

    expect(state.cancelled).toBe(true);
    expect(state.pulled).toBe(false);
  });

  test("forwards the cancellation reason to the stream", async () => {
    const { response, state } = trackedResponse();
    const body = errorBodyOf(response);
    const reason = new Error("error body not needed");

    await body.cancel(reason);

    expect(state.reason).toBe(reason);
  });

  test("resolves without error when the response has no body", async () => {
    // No status, no URL, no error class — just a body that is not there.
    const body = errorBodyOf(new Response(null));

    await expect(body.cancel()).resolves.toBeUndefined();
  });

  test("readers throw the library TypeError after cancel()", async () => {
    const { response } = trackedResponse();
    const body = errorBodyOf(response);
    await body.cancel();

    await expect(body.json()).rejects.toThrowError(TypeError);
    await expect(body.text()).rejects.toThrowError(/cancelled/);
    await expect(body.blob()).rejects.toThrowError(/cancelled/);
    await expect(body.arrayBuffer()).rejects.toThrowError(/cancelled/);
  });

  test("tee() after cancel() throws the library TypeError", async () => {
    const { response } = trackedResponse();
    const body = errorBodyOf(response);
    await body.cancel();

    expect(() => body.tee()).toThrowError(TypeError);
    expect(() => body.tee()).toThrowError(/cancelled/);
  });

  test("rejects with a clear TypeError when a reader locks the stream", async () => {
    const { response, state } = trackedResponse();
    response.body?.getReader();
    const body = errorBodyOf(response);

    await expect(body.cancel()).rejects.toThrowError(/locked/);
    await expect(body.cancel()).rejects.toThrowError(TypeError);
    expect(state.cancelled).toBe(false);
  });

  test("is idempotent after a completed read", async () => {
    const body = errorBodyOf(new Response("body"));
    expect(await body.text()).toBe("body");

    await expect(body.cancel()).resolves.toBeUndefined();
  });

  test("a stream whose own cancel() fails still resolves", async () => {
    // The source failed to tear itself down. The caller asked to DISCARD these
    // bytes, so that failure carries nothing they can act on, and the stream is
    // released by the platform either way.
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        throw new Error("cancel failed");
      },
    });
    const body = errorBodyOf(new Response(stream));

    await expect(body.cancel()).resolves.toBeUndefined();
    await expect(body.cancel()).resolves.toBeUndefined();
  });
});

describe("errorBodyOf — cancel() on a body whose stream already failed", () => {
  test("resolves instead of rejecting with the stream's stored error", async () => {
    const { response, state } = erroredBodyResponse();
    expect(response.bodyUsed).toBe(false);
    expect(response.body?.locked).toBe(false);
    const body = errorBodyOf(response);

    await expect(body.cancel()).resolves.toBeUndefined();

    // The errored stream dropped its source when it errored, so the platform
    // never reaches the underlying cancel algorithm. There was nothing left to
    // release, which is why the rejection carries no information.
    expect(state.cancelled).toBe(false);
  });

  test("a dropped cancel() raises no unhandled rejection", async () => {
    // THE REGRESSION. `cancel` is an async function, so a rejection reaches the
    // caller through a promise the caller may never handle. Under Node's
    // default `--unhandled-rejections=throw` that ends the process with exit 1
    // — a cleanup call must never do that.
    const seen: unknown[] = [];
    const record = (reason: unknown): void => {
      seen.push(reason);
    };
    process.on("unhandledRejection", record);
    try {
      const { response } = erroredBodyResponse();
      const body = errorBodyOf(response);

      // No await and no .catch(): the shape of every fire-and-forget cleanup.
      // TWO calls, because the repeated one takes the `if (cancelling)` path
      // and receives a DERIVED promise that the swallow inside `cancel()` does
      // not cover.
      void body.cancel();
      void body.cancel();

      // Node reports an unhandled rejection at the end of a turn, so let two
      // macrotasks pass before reading the record.
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      process.off("unhandledRejection", record);
    }

    expect(seen).toEqual([]);
  });

  test("a repeated cancel() resolves with the first one", async () => {
    const { response } = erroredBodyResponse();
    const body = errorBodyOf(response);

    const first = body.cancel();
    const second = body.cancel();

    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();
  });

  test("the readers and tee() still refuse the body afterwards", async () => {
    // `cancelled = true` is set BEFORE the await, so the body is claimed from
    // the moment the stream is handed over, whatever the stream then does.
    const { response } = erroredBodyResponse();
    const body = errorBodyOf(response);
    await body.cancel();

    await expect(body.text()).rejects.toThrowError(/cancelled/);
    expect(() => body.tee()).toThrowError(/cancelled/);
  });

  test("an external reader lock still rejects on a failed stream", async () => {
    // The swallow must cover the STREAM's rejection only. Step 3 is a mistake
    // the caller can correct, so it must still reach them.
    const { response } = erroredBodyResponse();
    response.body?.getReader();
    const body = errorBodyOf(response);

    expect(response.bodyUsed).toBe(false);
    await expect(body.cancel()).rejects.toThrowError(/locked/);
    await expect(body.cancel()).rejects.toThrowError(TypeError);
  });
});

describe("errorBodyOf — cancel() decision order does not rely on bodyUsed", () => {
  test("cancels a body whose runtime never flips bodyUsed", async () => {
    const { response, state } = bodyUsedNeverFlipsResponse();
    const body = errorBodyOf(response);

    await body.cancel();

    expect(state.cancelled).toBe(true);
  });

  test("blocks the readers after cancel() even when bodyUsed stays false", async () => {
    const { response } = bodyUsedNeverFlipsResponse();
    const body = errorBodyOf(response);
    await body.cancel();

    expect(response.bodyUsed).toBe(false);
    await expect(body.text()).rejects.toThrowError(/cancelled/);
    expect(() => body.tee()).toThrowError(/cancelled/);
  });

  test("an unread reader lock rejects while the runtime keeps bodyUsed false", async () => {
    // Node, Deno, and workerd: a bare getReader() locks the stream and leaves
    // bodyUsed false. That pair is what identifies a body someone else holds
    // but has NOT consumed, and cancel() must refuse it.
    const response = new Response("payload");
    response.body?.getReader();
    const body = errorBodyOf(response);

    expect(response.bodyUsed).toBe(false);
    expect(response.body?.locked).toBe(true);
    await expect(body.cancel()).rejects.toThrowError(/locked/);
  });

  // DOCUMENTED DIVERGENCE, characterised rather than guaranteed. Bun reports
  // bodyUsed for a mere getReader(), which makes an unread lock
  // indistinguishable from a body the consumer already read — measured
  // identical on Node 20/24, Bun 1.3, and Deno for a completed external
  // text(). Rejecting on that shape would reject the far more common consumed
  // case on EVERY runtime, so the library believes the runtime and resolves.
  test("a reader lock resolves on a runtime that reports bodyUsed for it", async () => {
    const { response, state } = bunShapedResponse();
    response.body?.getReader();
    const body = errorBodyOf(response);

    expect(response.bodyUsed).toBe(true);
    await expect(body.cancel()).resolves.toBeUndefined();
    // Nothing was released: the external reader still owns the stream, and
    // releasing it is that owner's job.
    expect(state.cancelled).toBe(false);
  });

  test("a library read wins over an external lock report", async () => {
    const body = errorBodyOf(new Response("body"));
    expect(await body.text()).toBe("body");

    // `text()` leaves the stream locked on some runtimes. The library knows it
    // started that read, so cancel() must resolve rather than claim a lock.
    await expect(body.cancel()).resolves.toBeUndefined();
  });
});

describe("errorBodyOf — cancel() and a body consumed outside the library", () => {
  test("resolves when an external reader already consumed the body", async () => {
    const response = new Response("payload");
    const body = errorBodyOf(response);

    // A consumer holding the Response — the ordinary case with an injected
    // fetch — reads it themselves. On every runtime that leaves the stream
    // BOTH bodyUsed and locked, so a lock-first check would reject here.
    expect(await response.text()).toBe("payload");
    expect(response.bodyUsed).toBe(true);

    await expect(body.cancel()).resolves.toBeUndefined();
  });

  test("resolves when a released reader already drained the body", async () => {
    const response = new Response("payload");
    const body = errorBodyOf(response);
    const reader = response.body!.getReader();
    await reader.read();
    reader.releaseLock();

    await expect(body.cancel()).resolves.toBeUndefined();
  });
});

describe("errorBodyOf — tee() and its branches", () => {
  test("releasing every branch settles both cancellations", async () => {
    const { response, state } = trackedResponse();
    const source = errorBodyOf(response);
    const teed = source.tee();
    const branch = errorBodyOf(teed.branch);
    teed.adopt(branch);

    await Promise.all([source.cancel(), branch.cancel()]);

    expect(state.cancelled).toBe(true);
  });

  test("cancelling one branch alone does not settle while the other is held", async () => {
    const { response } = trackedResponse();
    const source = errorBodyOf(response);
    const teed = source.tee();
    const branch = errorBodyOf(teed.branch);
    teed.adopt(branch);

    const settled = await Promise.race([
      source.cancel().then(() => "settled"),
      new Promise((resolve) => setTimeout(() => resolve("pending"), 50)),
    ]);

    // Native tee semantics: the source is only released once BOTH branches
    // are. This is documented, not worked around.
    expect(settled).toBe("pending");

    // The sibling releases the source and both cancellations settle.
    await Promise.all([source.cancel(), branch.cancel()]);
  });

  test("a repeated cancel settles with the first one, never before it", async () => {
    const { response } = trackedResponse();
    const source = errorBodyOf(response);
    const teed = source.tee();
    const branch = errorBodyOf(teed.branch);
    teed.adopt(branch);

    const first = source.cancel();
    const second = source.cancel();

    const raced = await Promise.race([
      second.then(() => "settled"),
      new Promise((resolve) => setTimeout(() => resolve("pending"), 50)),
    ]);
    // A repeated cancel must not report success while the first is still
    // waiting for the sibling branch.
    expect(raced).toBe("pending");

    await Promise.all([first, second, branch.cancel()]);
  });

  test("cancelling one branch leaves the sibling readable", async () => {
    const { response } = trackedResponse();
    const source = errorBodyOf(response);
    const teed = source.tee();
    const branch = errorBodyOf(teed.branch);
    teed.adopt(branch);

    // The branch exists in order to be read. Cancelling the source releases
    // only its own branch — asserting the payload is what proves that; a
    // swallowed `.catch()` here would pass even if the read failed.
    const [, text] = await Promise.all([source.cancel(), branch.text()]);

    expect(text).toBe("payload");
  });

  test("adopt() marks both branches as teed", () => {
    const source = errorBodyOf(new Response("payload"));
    const teed = source.tee();
    const branch = errorBodyOf(teed.branch);

    expect(source.teed).toBe(false);
    expect(branch.teed).toBe(false);

    teed.adopt(branch);

    expect(source.teed).toBe(true);
    expect(branch.teed).toBe(true);
  });

  test("adopt(undefined) still marks the source and does not throw", () => {
    // The owner was built by a DIFFERENT copy of this library, so its body is
    // not in this copy's table. Marking what we can see is the honest outcome.
    const source = errorBodyOf(new Response("payload"));
    const teed = source.tee();

    expect(() => teed.adopt(undefined)).not.toThrow();

    expect(source.teed).toBe(true);

    teed.release();
  });

  test("release() frees a branch nobody took, so cancel() settles", async () => {
    const { response, state } = trackedResponse();
    const source = errorBodyOf(response);
    const teed = source.tee();

    // The owner never came into existence — the failed-clone case, now
    // reachable as the mechanism instead of a symptom of it.
    teed.release();

    await expect(source.cancel()).resolves.toBeUndefined();
    expect(state.cancelled).toBe(true);
  });

  test("a branch nobody took and nobody released strands the source", async () => {
    // The negative control for release(): this is exactly the hang it exists
    // to prevent.
    const { response } = trackedResponse();
    const source = errorBodyOf(response);
    const teed = source.tee();

    const settled = await Promise.race([
      source.cancel().then(() => "settled"),
      new Promise((resolve) => setTimeout(() => resolve("pending"), 50)),
    ]);

    expect(settled).toBe("pending");

    // Release it so the pending cancellation above cannot outlive the test.
    teed.release();
  });

  test("a read still works after a released branch", async () => {
    const source = errorBodyOf(new Response("payload"));
    const teed = source.tee();
    teed.release();

    expect(await source.text()).toBe("payload");
  });
});

describe("errorBodyOf — the readers refuse a locked stream", () => {
  test("every reader throws the library TypeError while a reader holds the stream", async () => {
    const readers = ["json", "text", "blob", "arrayBuffer"] as const;
    for (const reader of readers) {
      const response = new Response("x");
      // Locked but NOT used: the case a bodyUsed-only guard misses, which
      // otherwise surfaces the platform's opaque "Body is unusable".
      response.body?.getReader();
      const body = errorBodyOf(response);

      expect(response.bodyUsed).toBe(false);

      // Exactly ONE call. Calling twice would let the FIRST take the platform
      // error — the very thing this guard replaces — and set readStarted, so
      // the second would trip that disjunct instead of `body.locked` while
      // still matching /stream is locked/. The lock branch would go untested.
      let thrown: unknown;
      try {
        await body[reader]();
      } catch (caught) {
        thrown = caught;
      }

      expect(thrown).toBeInstanceOf(TypeError);
      expect((thrown as Error).message).toMatch(/stream is locked/);
      expect((thrown as Error).message).toContain(`with ${reader}()`);
      // The platform's opaque message must never reach the consumer here.
      expect((thrown as Error).message).not.toMatch(/Body is unusable/);
    }
  });

  test("an unlocked body still reads normally", async () => {
    const body = errorBodyOf(new Response("x"));

    expect(await body.text()).toBe("x");
  });
});

describe("errorBodyOf — tee() refuses an unavailable body", () => {
  test("tee() after json() throws a TypeError with a clear message", async () => {
    const body = errorBodyOf(new Response('{"a":1}'));
    await body.json();

    expect(() => body.tee()).toThrowError(/already been read/);
    expect(() => body.tee()).toThrowError(TypeError);
  });

  test("tee() on a locked-but-unread body throws the clear TypeError", () => {
    const response = new Response("x");
    // Acquire a reader BEFORE handing the response over: the stream is now
    // locked but bodyUsed is still false, the case a bodyUsed-only guard
    // would miss.
    response.body?.getReader();
    const body = errorBodyOf(response);

    expect(() => body.tee()).toThrowError(/its stream is locked/);
    expect(() => body.tee()).toThrowError(TypeError);
  });
});

/**
 * ONE predicate, TWO callers. The reader guard and the tee guard differ only
 * in the message they throw; they were written twice, once, and drifted. This
 * table drives all four disjuncts through both callers so they cannot drift
 * again.
 */
const disjuncts: Array<{ name: string; make: () => Promise<ErrorBody> }> = [
  {
    name: "cancelled by us",
    make: async () => {
      // bodyUsed never flips and cancelling a stream does not lock it, so
      // `cancelled` is the ONLY disjunct that is true here.
      const { response } = bodyUsedNeverFlipsResponse();
      const body = errorBodyOf(response);
      await body.cancel();
      expect(response.bodyUsed).toBe(false);
      expect(response.body?.locked).toBe(false);
      return body;
    },
  },
  {
    name: "read by us (readStarted)",
    make: async () => {
      // A null body never reports `bodyUsed` and has no stream to lock, so
      // `readStarted` is the ONLY disjunct that is true here.
      const response = new Response(null);
      const body = errorBodyOf(response);
      await body.text();
      expect(response.bodyUsed).toBe(false);
      expect(response.body).toBe(null);
      return body;
    },
  },
  {
    name: "consumed elsewhere (bodyUsed)",
    make: async () => {
      const response = new Response("x");
      Object.defineProperty(response, "bodyUsed", { get: () => true });
      expect(response.body?.locked).toBe(false);
      return errorBodyOf(response);
    },
  },
  {
    name: "locked by an external reader (body.locked)",
    make: async () => {
      const response = new Response("x");
      response.body?.getReader();
      expect(response.bodyUsed).toBe(false);
      return errorBodyOf(response);
    },
  },
];

describe("errorBodyOf — one predicate, two messages", () => {
  for (const { name, make } of disjuncts) {
    test(`a body ${name} is refused by the readers`, async () => {
      const body = await make();

      await expect(body.json()).rejects.toThrowError(
        /Cannot read this error's body with json\(\): its response body has already been read, cancelled, or its stream is locked/,
      );
    });

    test(`a body ${name} is refused by tee()`, async () => {
      const body = await make();

      expect(() => body.tee()).toThrowError(
        /Cannot clone this error: its response body has already been read, cancelled, or its stream is locked/,
      );
    });
  }
});
