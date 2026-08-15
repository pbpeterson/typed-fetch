import { describe, test, expect } from "vitest";
import { errorBodyOf } from "../../src/errors/error-body";
import { typedFetch, isHttpError } from "../../src/index";

/**
 * ROUND 8, LANE H2 — response handling and error construction.
 *
 * Every case here PASSES on the tree it was written against. None of them is a
 * finding. They are kept because each pins an invariant over a whole SET of
 * inputs that the existing suites pin only one case at a time:
 *
 * - The three-operation sweep this file opened with now runs as the
 *   four-operation sweep in `response-body-concurrency.spec.ts`, which draws
 *   the same operations over the same invariant and reaches the states a
 *   length of three cannot. It is not repeated here.
 * - The suite drives an externally disturbed body through hand-built doubles.
 *   The matrix below drives it through the REAL platform states a consumer
 *   holding the `Response` produces, including a live `pipeThrough` and a
 *   reader that has read PART of the body — the two states that sit either
 *   side of `cancel()`'s documented "has read nothing through it" boundary.
 * - `response-identity.spec.ts` pins the one-identity-per-response record at
 *   the module seam. The last case pins it end to end, through two sequential
 *   `typedFetch` calls that resolve the same `Response` object.
 */

/** Settle a promise, or report that it is still pending after `ms`. */
async function settle(promise: Promise<unknown>, ms = 25): Promise<string> {
  return Promise.race([
    promise.then(
      () => "resolved",
      (cause: unknown) => `rejected:${(cause as Error).message}`,
    ),
    new Promise<string>((resolve) => setTimeout(() => resolve("pending"), ms)),
  ]);
}

describe("round 8 / H2 — a body a consumer disturbed through the Response itself", () => {
  /**
   * Each row is a REAL platform state, produced through the `Response` a
   * consumer holds via an injected `fetch`, and the outcome the interface
   * documents for it.
   *
   * `cancel()` "rejects with a `TypeError` when an EXTERNAL reader holds the
   * stream and has read nothing through it". The `reader, partially read` and
   * `pipeThrough` rows are the other side of that sentence: the stream is
   * locked by someone else AND disturbed, so the body is gone rather than
   * withheld, and the call resolves.
   */
  const rows: readonly {
    label: string;
    disturb: (response: Response) => Promise<void> | void;
    read: "reads" | "refuses";
    cancel: "resolves" | "rejects";
    tee: "tees" | "refuses";
  }[] = [
    {
      label: "untouched",
      disturb: () => {},
      read: "reads",
      cancel: "resolves",
      tee: "tees",
    },
    {
      label: "the consumer already read it with text()",
      disturb: async (response) => void (await response.text()),
      read: "refuses",
      cancel: "resolves",
      tee: "refuses",
    },
    {
      label: "the consumer already cancelled the stream",
      disturb: async (response) => void (await response.body!.cancel()),
      read: "refuses",
      cancel: "resolves",
      tee: "refuses",
    },
    {
      label: "a reader holds the stream and has read nothing",
      disturb: (response) => void response.body!.getReader(),
      read: "refuses",
      cancel: "rejects",
      tee: "refuses",
    },
    {
      label: "a reader holds the stream and has read part of it",
      disturb: async (response) => void (await response.body!.getReader().read()),
      read: "refuses",
      cancel: "resolves",
      tee: "refuses",
    },
    {
      label: "a reader took the stream and released the lock unread",
      disturb: (response) => {
        const reader = response.body!.getReader();
        reader.releaseLock();
      },
      read: "reads",
      cancel: "resolves",
      tee: "tees",
    },
    {
      label: "the consumer piped the stream through a transform",
      disturb: (response) => void response.body!.pipeThrough(new TransformStream()),
      read: "refuses",
      cancel: "resolves",
      tee: "refuses",
    },
  ];

  test.each(rows)("$label: text() $read", async ({ disturb, read }) => {
    const response = new Response("payload", { status: 500 });
    await disturb(response);
    const body = errorBodyOf(response);

    if (read === "reads") {
      await expect(body.text()).resolves.toBe("payload");
      return;
    }
    await expect(body.text()).rejects.toThrowError(TypeError);
    await expect(body.text()).rejects.toThrowError(/Cannot read this error's body with text\(\)/);
  });

  test.each(rows)("$label: cancel() $cancel", async ({ disturb, cancel }) => {
    const response = new Response("payload", { status: 500 });
    await disturb(response);
    const body = errorBodyOf(response);

    if (cancel === "resolves") {
      await expect(body.cancel()).resolves.toBeUndefined();
      return;
    }
    await expect(body.cancel()).rejects.toThrowError(TypeError);
    await expect(body.cancel()).rejects.toThrowError(
      /Cannot cancel this error's body: its stream is locked by a reader/,
    );
  });

  test.each(rows)("$label: tee() $tee", async ({ disturb, tee }) => {
    const response = new Response("payload", { status: 500 });
    await disturb(response);
    const body = errorBodyOf(response);

    if (tee === "tees") {
      const teed = body.tee();
      teed.release();
      await settle(body.cancel());
      return;
    }
    expect(() => body.tee()).toThrowError(TypeError);
    expect(() => body.tee()).toThrowError(/Cannot clone this error/);
  });
});

describe("round 8 / H2 — one Response resolved by two sequential calls", () => {
  /**
   * One response has ONE identity, and the guarantee has to hold across CALLS,
   * not only across the two errors one `clone()` produces. The second error
   * reports the same four fields, and its body — the same single-use stream —
   * refuses the read the first error already took, with this library's
   * sentence rather than the platform's.
   */
  test("both errors report one identity, and the second body refuses the read", async () => {
    const response = new Response("payload", { status: 404, statusText: "Nope" });
    const transport = (async () => response) as unknown as typeof fetch;

    const first = await typedFetch("https://example.invalid/a", { fetch: transport });
    const second = await typedFetch("https://example.invalid/b", { fetch: transport });

    if (!isHttpError(first.error) || !isHttpError(second.error)) {
      throw new Error("both calls must produce an HTTP error");
    }

    expect(first.error).not.toBe(second.error);
    expect(second.error.toJSON()).toEqual(first.error.toJSON());
    expect(second.error.message).toBe(first.error.message);

    await expect(first.error.text()).resolves.toBe("payload");
    await expect(second.error.text()).rejects.toThrowError(
      /Cannot read this error's body with text\(\)/,
    );

    await second.error.cancel();
  });
});
