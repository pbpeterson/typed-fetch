import { describe, test, expect } from "vitest";
import { errorBodyOf, type ErrorBody, type TeedErrorBody } from "./src/errors/error-body";
import {
  typedFetch,
  isHttpError,
  isKnownHttpError,
  isTimeoutError,
  isAbortError,
} from "./src/index";
import { NotFoundError } from "./src/errors/not-found-error";
import { InternalServerError } from "./src/errors/internal-server-error";
import { UnknownHttpError } from "./src/errors/unknown-http-error";

/**
 * ROUND 9, LANE H2 — response handling and error construction.
 *
 * Every case here PASSES on the tree it was written against. None of them is a
 * finding. Round 8's H2 swept the three-operation sequences over `errorBodyOf`,
 * the status and `statusText` boundaries, and seven externally disturbed body
 * states, and returned clean. This file goes where that sweep stopped, and each
 * block states the invariant it pins over a SET of inputs no existing suite
 * covers as a set:
 *
 * - `error-body.spec.ts` pins individual lifecycle sequences, and round 8 the
 *   512 three-operation ones. Depth FOUR is where a second `tee()` can sit
 *   under a claim, so it is the first length that can strand a source through
 *   two open branches rather than one.
 * - No suite drives two `ErrorBody` handles over ONE `Response`. That state is
 *   ordinary: two `typedFetch` calls resolving the same object, or two errors
 *   built from it, produce exactly it.
 * - `base-http-error.spec.ts` pins the round-6 refusal matrix one row at a
 *   time. The `clone()` chain sweep here pins the resource invariant across
 *   every four-operation mix of read, cancel, and clone over a growing set of
 *   errors that share one teed source.
 * - `conformance.spec.ts` drives ADR 0003 row H-14 through one scenario. The
 *   matrix here drives it through EVERY refusal point in the response phase —
 *   structural, identity, success-surface, and inside the error constructor —
 *   by presenting the same object twice.
 * - Nothing pins the lifecycle over a body stream that FAILED, which is the
 *   state `cancel()` documents as resolving because "an errored stream dropped
 *   its source when it errored".
 */

/** The three refusals this library authors. No platform text may replace one. */
const LIBRARY_REFUSALS = [
  "Cannot read this error's body with",
  "Cannot cancel this error's body",
  "Cannot clone this error",
] as const;

function isLibraryRefusal(message: string): boolean {
  return LIBRARY_REFUSALS.some((prefix) => message.startsWith(prefix));
}

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

/** A `Response` over a stream that records whether its source was released. */
function trackedResponse(status = 500): { response: Response; state: { released: boolean } } {
  const state = { released: false };
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new TextEncoder().encode('{"a":1}'));
      controller.close();
      state.released = true;
    },
    cancel() {
      state.released = true;
    },
  });
  return { response: new Response(body, { status }), state };
}

describe("round 9 / H2 — every FOUR-operation sequence over one error body", () => {
  type Op = "json" | "text" | "blob" | "arrayBuffer" | "cancel" | "tee" | "release" | "adopt";

  const OPS: readonly Op[] = [
    "json",
    "text",
    "blob",
    "arrayBuffer",
    "cancel",
    "tee",
    "release",
    "adopt",
  ];

  /**
   * THE INVARIANT, over all 4096 sequences of four operations.
   *
   * 1. No refusal is ever the platform's.
   * 2. Once every branch a sequence created has an owner or is released, a
   *    final `cancel()` SETTLES.
   * 3. The underlying source is released by the end of every sequence.
   *
   * Length four is what round 8's length-three sweep could not reach: two
   * `tee()` calls plus a claim, so a sequence can leave the source waiting on
   * two branches rather than one.
   */
  test("no four-op sequence strands the source, and no refusal is the platform's", async () => {
    const problems: string[] = [];
    const sequences: Op[][] = [];
    for (const first of OPS) {
      for (const second of OPS) {
        for (const third of OPS) {
          for (const fourth of OPS) sequences.push([first, second, third, fourth]);
        }
      }
    }

    for (const sequence of sequences) {
      const { response, state } = trackedResponse();
      const body: ErrorBody = errorBodyOf(response);
      const open: TeedErrorBody[] = [];
      const log: string[] = [];

      for (const op of sequence) {
        if (op === "tee") {
          try {
            open.push(body.tee());
            log.push("tee:ok");
          } catch (cause) {
            const message = (cause as Error).message;
            if (!isLibraryRefusal(message)) {
              problems.push(`${sequence.join(">")} :: tee refused with "${message}"`);
            }
            log.push("tee:refused");
          }
          continue;
        }
        if (op === "release") {
          open.pop()?.release();
          log.push("release");
          continue;
        }
        if (op === "adopt") {
          const teed = open.pop();
          if (teed) {
            const sibling = errorBodyOf(teed.branch);
            teed.adopt(sibling);
            await settle(sibling.cancel());
          }
          log.push("adopt");
          continue;
        }
        const outcome = await settle(op === "cancel" ? body.cancel() : body[op]());
        if (outcome.startsWith("rejected:")) {
          const message = outcome.slice("rejected:".length);
          // A `json()` over a payload this stream never produced rejects with
          // the platform's SyntaxError: a read that genuinely ran, not a
          // refusal.
          const isReadFailure = op === "json" && !message.startsWith("Cannot ");
          if (!isReadFailure && !isLibraryRefusal(message)) {
            problems.push(`${sequence.join(">")} :: ${op} refused with "${message}"`);
          }
        }
        log.push(`${op}:${outcome}`);
      }

      for (const teed of open) teed.release();
      const final = await settle(body.cancel(), 40);
      if (final === "pending") {
        problems.push(`${sequence.join(">")} :: final cancel never settled :: ${log.join(" | ")}`);
      }
      if (!state.released) {
        problems.push(`${sequence.join(">")} :: source never released :: ${log.join(" | ")}`);
      }
    }

    expect(problems).toEqual([]);
  }, 200_000);
});

describe("round 9 / H2 — two error bodies over ONE Response, interleaved", () => {
  type Op = "text" | "cancel" | "tee";
  const OPS: readonly Op[] = ["text", "cancel", "tee"];
  const SIDES = ["A", "B"] as const;

  function label(plan: readonly (readonly [string, string])[]): string {
    return plan.map(([side, op]) => `${side}.${op}`).join(">");
  }

  /**
   * One `Response` can carry TWO error bodies: two `typedFetch` calls that
   * resolve the same object, or two errors built from it. The two handles keep
   * separate `cancelled`/`readStarted` state over one shared single-use stream,
   * so every interleaving has to reach the same three invariants the single
   * handle does — and the refusal one handle earns must be this library's
   * sentence when the OTHER handle is what spent the body.
   */
  test("no interleaving across two handles strands the source", async () => {
    const problems: string[] = [];
    for (const firstSide of SIDES) {
      for (const firstOp of OPS) {
        for (const secondSide of SIDES) {
          for (const secondOp of OPS) {
            for (const thirdSide of SIDES) {
              for (const thirdOp of OPS) {
                const plan = [
                  [firstSide, firstOp],
                  [secondSide, secondOp],
                  [thirdSide, thirdOp],
                ] as const;
                const { response, state } = trackedResponse();
                const handles = { A: errorBodyOf(response), B: errorBodyOf(response) };
                const open: TeedErrorBody[] = [];
                const log: string[] = [];

                for (const [side, op] of plan) {
                  const body = handles[side];
                  if (op === "tee") {
                    try {
                      open.push(body.tee());
                      log.push(`${side}.tee:ok`);
                    } catch (cause) {
                      const message = (cause as Error).message;
                      if (!isLibraryRefusal(message)) {
                        problems.push(`${label(plan)} :: ${side}.tee "${message}"`);
                      }
                      log.push(`${side}.tee:refused`);
                    }
                    continue;
                  }
                  const outcome = await settle(op === "cancel" ? body.cancel() : body.text());
                  if (outcome.startsWith("rejected:")) {
                    const message = outcome.slice("rejected:".length);
                    if (!isLibraryRefusal(message)) {
                      problems.push(`${label(plan)} :: ${side}.${op} "${message}"`);
                    }
                  }
                  log.push(`${side}.${op}:${outcome}`);
                }

                for (const teed of open) teed.release();
                const finals = await Promise.all([
                  settle(
                    handles.A.cancel().catch(() => {}),
                    40,
                  ),
                  settle(
                    handles.B.cancel().catch(() => {}),
                    40,
                  ),
                ]);
                if (finals.includes("pending")) {
                  problems.push(`${label(plan)} :: final cancel pending :: ${log.join(" | ")}`);
                }
                if (!state.released) {
                  problems.push(`${label(plan)} :: source never released :: ${log.join(" | ")}`);
                }
              }
            }
          }
        }
      }
    }
    expect(problems).toEqual([]);
  }, 200_000);
});

describe("round 9 / H2 — two calls started in the same tick", () => {
  /**
   * Ordering is what round 8 swept. These start two operations with NOTHING
   * awaited between them, so each pair lands inside the synchronous prologue of
   * the other: the claim, the cancel state, and the published in-flight
   * cancellation all have to be visible before the first call returns its
   * promise.
   */
  test("two readers started in the same tick: the second is refused, not the platform's", async () => {
    const { response, state } = trackedResponse();
    const body = errorBodyOf(response);
    const first = body.text();
    const second = body.text();
    const outcomes = await Promise.all([settle(first), settle(second)]);
    expect(outcomes[0]).toBe("resolved");
    expect(outcomes[1]).toMatch(/^rejected:Cannot read this error's body with text/);
    expect(await settle(body.cancel())).toBe("resolved");
    expect(state.released).toBe(true);
  });

  test("cancel then a reader in the same tick: the reader is refused", async () => {
    const { response, state } = trackedResponse();
    const body = errorBodyOf(response);
    const cancelling = body.cancel();
    const reading = body.text();
    const outcomes = await Promise.all([settle(cancelling), settle(reading)]);
    expect(outcomes[0]).toBe("resolved");
    expect(outcomes[1]).toMatch(/^rejected:Cannot read this error's body with text/);
    expect(state.released).toBe(true);
  });

  test("a reader then cancel in the same tick: both settle and the read wins", async () => {
    const { response, state } = trackedResponse();
    const body = errorBodyOf(response);
    const reading = body.text();
    const cancelling = body.cancel();
    const outcomes = await Promise.all([settle(reading), settle(cancelling)]);
    expect(outcomes[0]).toBe("resolved");
    expect(outcomes[1]).toBe("resolved");
    expect(state.released).toBe(true);
  });

  test("cancel then tee in the same tick: tee is refused before the cancel settles", async () => {
    const { response, state } = trackedResponse();
    const body = errorBodyOf(response);
    const cancelling = body.cancel();
    expect(() => body.tee()).toThrowError(/Cannot clone this error/);
    expect(await settle(cancelling)).toBe("resolved");
    expect(state.released).toBe(true);
  });

  test("three cancels in one tick settle together, never before the branch", async () => {
    const { response, state } = trackedResponse();
    const body = errorBodyOf(response);
    const teed = body.tee();
    const calls = [body.cancel(), body.cancel(), body.cancel()];
    expect(await settle(Promise.all(calls), 30)).toBe("pending");
    teed.release();
    expect(await settle(Promise.all(calls), 80)).toBe("resolved");
    expect(state.released).toBe(true);
  });

  test("clone and both cancels in the same tick settle", async () => {
    const { response, state } = trackedResponse();
    const error = new InternalServerError(response);
    const copy = error.clone();
    const both = Promise.all([error.cancel(), copy.cancel()]);
    expect(await settle(both, 80)).toBe("resolved");
    expect(state.released).toBe(true);
  });
});

describe("round 9 / H2 — clone() chains over one teed source", () => {
  type Op = "read" | "cancel" | "clone";
  const OPS: readonly Op[] = ["read", "cancel", "clone"];

  /**
   * Every four-operation mix of read, cancel, and clone, applied round-robin
   * over the growing set of errors that share one source. A `clone()` chain is
   * the only way a consumer reaches three or more branches of one stream, and
   * the source is freed only once every one of them is read or canceled.
   */
  test("no clone chain leaves a cancel pending or a source pinned", async () => {
    const problems: string[] = [];
    for (const first of OPS) {
      for (const second of OPS) {
        for (const third of OPS) {
          for (const fourth of OPS) {
            const sequence = [first, second, third, fourth];
            const { response, state } = trackedResponse();
            const errors: InternalServerError[] = [new InternalServerError(response)];
            const log: string[] = [];
            let at = 0;

            for (const op of sequence) {
              const target = errors[at % errors.length]!;
              at += 1;
              if (op === "clone") {
                try {
                  errors.push(target.clone());
                  log.push("clone:ok");
                } catch (cause) {
                  const message = (cause as Error).message;
                  if (!isLibraryRefusal(message)) {
                    problems.push(`${sequence.join(">")} :: clone "${message}"`);
                  }
                  log.push("clone:refused");
                }
                continue;
              }
              const outcome = await settle(op === "cancel" ? target.cancel() : target.text());
              if (outcome.startsWith("rejected:")) {
                const message = outcome.slice("rejected:".length);
                if (!isLibraryRefusal(message)) {
                  problems.push(`${sequence.join(">")} :: ${op} "${message}"`);
                }
              }
              log.push(`${op}:${outcome}`);
            }

            const finals = await settle(
              Promise.all(errors.map((error) => error.cancel().catch(() => {}))),
              80,
            );
            if (finals === "pending") {
              problems.push(`${sequence.join(">")} :: final cancels pending :: ${log.join(" | ")}`);
            }
            if (!state.released) {
              problems.push(`${sequence.join(">")} :: source never released :: ${log.join(" | ")}`);
            }
          }
        }
      }
    }
    expect(problems).toEqual([]);
  }, 200_000);

  test("two errors from one response, each cloned, report one identity", async () => {
    const { response, state } = trackedResponse();
    const first = new InternalServerError(response);
    const second = new InternalServerError(response);
    const firstCopy = first.clone();
    const secondCopy = second.clone();
    expect(first.toJSON()).toEqual(second.toJSON());
    expect(firstCopy.toJSON()).toEqual(first.toJSON());
    expect(secondCopy.toJSON()).toEqual(second.toJSON());
    const all = Promise.all(
      [first, second, firstCopy, secondCopy].map((error) => error.cancel().catch(() => {})),
    );
    expect(await settle(all, 150)).toBe("resolved");
    expect(state.released).toBe(true);
  });

  test("a null body survives clone(): both sides settle and nothing is stranded", async () => {
    const response = new Response(null, { status: 500 });
    const error = new InternalServerError(response);
    const copy = error.clone();
    expect(copy.toJSON()).toEqual(error.toJSON());
    expect(await settle(Promise.all([error.cancel(), copy.cancel()]), 80)).toBe("resolved");
  });
});

describe("round 9 / H2 — a Response subclass that answers differently on a later read", () => {
  /**
   * A subclass getter is the shape an adapter reaches for, and it is not the
   * same shape as an own property: it survives `Object.getOwnPropertyNames`,
   * and the native slot behind it still answers `isResponse`'s brand probe. The
   * getter is armed only AFTER construction, because undici's own `Response`
   * constructor reads `status` — a getter armed from the start makes the
   * constructor's read the "first" one and the test measures nothing.
   */
  test("a status that shifts after the first read cannot change the class", async () => {
    let armed = false;
    class Shifting extends Response {
      override get status(): number {
        return armed ? 500 : 404;
      }
    }
    const response = new Shifting("payload", { status: 404 });
    const transport = (async () => response) as unknown as typeof fetch;
    const { error } = await typedFetch("https://example.invalid/x", { fetch: transport });
    armed = true;
    if (!isHttpError(error)) throw new Error("expected an HTTP error");
    expect(error.name).toBe("NotFoundError");
    expect(error.status).toBe(404);
    expect(error.message).toContain("HTTP 404");
    expect(error.toJSON().status).toBe(404);
    const copy = error.clone();
    expect(copy.status).toBe(404);
    expect(copy.toJSON()).toEqual(error.toJSON());
    await Promise.all([error.cancel(), copy.cancel()]);
  });

  test("a url that shifts after the first read cannot split message from url", async () => {
    let armed = false;
    class Shifting extends Response {
      override get url(): string {
        return armed ? "https://second.invalid/b" : "https://first.invalid/a";
      }
    }
    const response = new Shifting("payload", { status: 404 });
    const error = new NotFoundError(response);
    armed = true;
    expect(error.url).toBe("https://first.invalid/a");
    expect(error.message).toContain("https://first.invalid/a");
    expect(error.toJSON().url).toBe("https://first.invalid/a");
    const copy = error.clone();
    expect(copy.url).toBe(error.url);
    expect(copy.message).toBe(error.message);
    await Promise.all([error.cancel(), copy.cancel()]);
  });

  test("a statusText that shifts after the first read cannot change the message", async () => {
    let armed = false;
    class Shifting extends Response {
      override get statusText(): string {
        return armed ? "Second" : "First";
      }
    }
    const response = new Shifting("payload", { status: 599 });
    const error = new UnknownHttpError(response);
    armed = true;
    expect(error.statusText).toBe("First");
    expect(error.message).toContain('"First"');
    expect(error.toJSON().statusText).toBe("First");
    const copy = error.clone();
    expect(copy.statusText).toBe("First");
    await Promise.all([error.cancel(), copy.cancel()]);
  });

  test("headers answering with a fresh container each read still give one identity", async () => {
    let reads = 0;
    class Shifting extends Response {
      override get headers(): Headers {
        reads += 1;
        return new Headers({ "x-read": String(reads) });
      }
    }
    const response = new Shifting("payload", { status: 404 });
    const first = new NotFoundError(response);
    const second = new NotFoundError(response);
    // One recorded read, and one COPY per error: the two agree and neither can
    // edit the other's.
    expect(first.headers.get("x-read")).toBe(second.headers.get("x-read"));
    expect(first.headers).not.toBe(second.headers);
    first.headers.set("x-read", "edited");
    expect(second.headers.get("x-read")).not.toBe("edited");
    await Promise.all([first.cancel(), second.cancel()]);
  });

  test("a bodyUsed that always answers true refuses every claim and still cancels", async () => {
    class Used extends Response {
      override get bodyUsed(): boolean {
        return true;
      }
    }
    const body = errorBodyOf(new Used("payload", { status: 500 }));
    await expect(body.text()).rejects.toThrowError(/Cannot read this error's body with text/);
    expect(() => body.tee()).toThrowError(/Cannot clone this error/);
    expect(await settle(body.cancel(), 40)).toBe("resolved");
  });

  test("a body getter answering with a fresh stream each read cannot revive a spent claim", async () => {
    class Fresh extends Response {
      override get body(): NonNullable<Response["body"]> {
        return new ReadableStream({
          pull(controller) {
            controller.close();
          },
        }) as NonNullable<Response["body"]>;
      }
    }
    const body = errorBodyOf(new Fresh("payload", { status: 500 }));
    expect(await settle(body.cancel(), 40)).toBe("resolved");
    await expect(body.text()).rejects.toThrowError(/Cannot read this error's body with text/);
  });
});

describe("round 9 / H2 — abort and timeout composition around the response phase", () => {
  test("an abort raised after the transport resolved does not change the error", async () => {
    const controller = new AbortController();
    const response = new Response("payload", { status: 404 });
    const transport = (async () => response) as unknown as typeof fetch;
    const result = await typedFetch("https://example.invalid/x", {
      fetch: transport,
      signal: controller.signal,
    });
    controller.abort();
    if (!isHttpError(result.error)) throw new Error("expected an HTTP error");
    expect(result.error.status).toBe(404);
    // The body was opened before the abort, and it is still this error's to read.
    await expect(result.error.text()).resolves.toBe("payload");
  });

  test("a signal already aborted before the call, with a transport that resolves", async () => {
    const controller = new AbortController();
    controller.abort();
    const transport = (async () =>
      new Response("payload", { status: 404 })) as unknown as typeof fetch;
    const result = await typedFetch("https://example.invalid/x", {
      fetch: transport,
      signal: controller.signal,
    });
    if (!isHttpError(result.error)) throw new Error("expected an HTTP error");
    expect(result.error.status).toBe(404);
    await result.error.cancel();
  });

  test("a composed signal whose timeout half fires reports a timeout", async () => {
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(5)]);
    const transport = ((_input: unknown, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          reject((init.signal as AbortSignal).reason);
        });
      })) as unknown as typeof fetch;
    const { error } = await typedFetch("https://example.invalid/x", { fetch: transport, signal });
    expect(isTimeoutError(error)).toBe(true);
    expect(isAbortError(error)).toBe(false);
  });

  test("a composed signal whose external half fires first reports an abort", async () => {
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(5_000)]);
    const transport = ((_input: unknown, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          reject((init.signal as AbortSignal).reason);
        });
        setTimeout(() => controller.abort(), 5);
      })) as unknown as typeof fetch;
    const { error } = await typedFetch("https://example.invalid/x", { fetch: transport, signal });
    expect(isAbortError(error)).toBe(true);
    expect(isTimeoutError(error)).toBe(false);
  });

  test("an abort raised while the body is being read leaves cancel() settling", async () => {
    const controller = new AbortController();
    const body = new ReadableStream<Uint8Array>({
      start(streamController) {
        streamController.enqueue(new TextEncoder().encode("half"));
        controller.signal.addEventListener("abort", () => {
          streamController.error(controller.signal.reason);
        });
      },
    });
    const transport = (async () => new Response(body, { status: 500 })) as unknown as typeof fetch;
    const { error } = await typedFetch("https://example.invalid/x", {
      fetch: transport,
      signal: controller.signal,
    });
    if (!isHttpError(error)) throw new Error("expected an HTTP error");
    const reading = error.text();
    controller.abort();
    expect((await settle(reading, 80)).startsWith("rejected:")).toBe(true);
    // The read genuinely started, so the claim is spent and `cancel()` must
    // settle rather than reject or hang.
    expect(await settle(error.cancel(), 80)).toBe("resolved");
  });
});

describe("round 9 / H2 — the lifecycle over a body stream that FAILED", () => {
  function erroredResponse(): Response {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("truncated"));
      },
    });
    return new Response(stream, { status: 500 });
  }

  test("cancel() resolves for a stream that errored before any claim", async () => {
    const body = errorBodyOf(erroredResponse());
    expect(await settle(body.cancel(), 60)).toBe("resolved");
  });

  test("a reader over an errored stream rejects with the stream failure, not a refusal", async () => {
    const body = errorBodyOf(erroredResponse());
    expect(await settle(body.text(), 60)).toBe("rejected:truncated");
    expect(await settle(body.cancel(), 60)).toBe("resolved");
  });

  test("tee() over an errored stream still lets both branches be released", async () => {
    const body = errorBodyOf(erroredResponse());
    const teed = body.tee();
    teed.release();
    expect(await settle(body.cancel(), 60)).toBe("resolved");
  });

  test("a source whose cancel algorithm throws still settles the library's cancel()", async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode("payload"));
        controller.close();
      },
      cancel() {
        throw new Error("the source refuses to release");
      },
    });
    const body = errorBodyOf(new Response(stream, { status: 500 }));
    expect(await settle(body.cancel(), 60)).toBe("resolved");
  });

  test("a tee() re-entered from the source's cancel algorithm is refused", async () => {
    let armed: ErrorBody | undefined;
    let reentered = "";
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        try {
          armed?.tee();
          reentered = "returned";
        } catch (cause) {
          reentered = `threw:${(cause as Error).message}`;
        }
      },
    });
    const body = errorBodyOf(new Response(stream, { status: 500 }));
    armed = body;
    expect(await settle(body.cancel(), 60)).toBe("resolved");
    expect(reentered).toMatch(/^threw:Cannot clone this error/);
  });

  test("a reader re-entered from the source's cancel algorithm is refused", async () => {
    let armed: ErrorBody | undefined;
    let outcome = "";
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        void armed?.text().then(
          () => {
            outcome = "resolved";
          },
          (cause: Error) => {
            outcome = cause.message;
          },
        );
      },
    });
    const body = errorBodyOf(new Response(stream, { status: 500 }));
    armed = body;
    expect(await settle(body.cancel(), 60)).toBe("resolved");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(outcome).toMatch(/^Cannot read this error's body with text/);
  });
});

describe("round 9 / H2 — ADR 0003 row H-14 at EVERY refusal point", () => {
  type Mode = "refuse" | "honest";

  interface Double {
    value: object;
    setMode: (mode: Mode) => void;
  }

  /**
   * A response-shaped double whose one broken slot heals between the two
   * presentations. Every other slot is honest in both, so the second call
   * differs from the first only in the slot the first call refused on.
   */
  function makeDouble(
    breaks: (mode: () => Mode, base: Record<PropertyKey, unknown>) => void,
  ): Double {
    let mode: Mode = "refuse";
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode("payload"));
        controller.close();
      },
    });
    const base: Record<PropertyKey, unknown> = {
      [Symbol.toStringTag]: "Response",
      body: stream,
      bodyUsed: false,
      headers: new Headers({ "x-honest": "yes" }),
      ok: false,
      redirected: false,
      status: 404,
      statusText: "Nope",
      type: "basic",
      url: "https://honest.invalid/x",
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      blob: () => Promise.resolve(new Blob([])),
      clone: () => base,
      formData: () => Promise.resolve(new FormData()),
      json: () => Promise.resolve({}),
      text: () => Promise.resolve("payload"),
    };
    breaks(() => mode, base);
    return {
      value: base,
      setMode: (next) => {
        mode = next;
      },
    };
  }

  function shifting(mode: () => Mode, broken: () => unknown, honest: unknown): PropertyDescriptor {
    return {
      get() {
        return mode() === "refuse" ? broken() : honest;
      },
      configurable: true,
      enumerable: true,
    };
  }

  function throwing(what: string): () => never {
    return () => {
      throw new TypeError(`hostile ${what} getter`);
    };
  }

  const rows: readonly { label: string; make: () => Double }[] = [
    {
      label: "a missing body reader",
      make: () =>
        makeDouble((mode, base) => {
          const real = base.json;
          Object.defineProperty(
            base,
            "json",
            shifting(mode, () => undefined, real),
          );
        }),
    },
    {
      label: "a body that is not a stream",
      make: () =>
        makeDouble((mode, base) => {
          const real = base.body;
          Object.defineProperty(
            base,
            "body",
            shifting(mode, () => ({ locked: 1 }), real),
          );
        }),
    },
    {
      label: "a bodyUsed that is not a boolean",
      make: () =>
        makeDouble((mode, base) => {
          Object.defineProperty(
            base,
            "bodyUsed",
            shifting(mode, () => "no", false),
          );
        }),
    },
    {
      label: "a headers getter that throws",
      make: () =>
        makeDouble((mode, base) => {
          const real = base.headers;
          Object.defineProperty(base, "headers", shifting(mode, throwing("headers"), real));
        }),
    },
    {
      label: "a status getter that throws",
      make: () =>
        makeDouble((mode, base) => {
          Object.defineProperty(base, "status", shifting(mode, throwing("status"), 404));
        }),
    },
    {
      label: "a headers container without getSetCookie, on the success branch",
      make: () =>
        makeDouble((mode, base) => {
          const partial: Record<PropertyKey, unknown> = {};
          for (const name of [
            "append",
            "delete",
            "entries",
            "forEach",
            "get",
            "has",
            "keys",
            "set",
            "values",
          ]) {
            partial[name] = () => undefined;
          }
          partial[Symbol.iterator] = () => [][Symbol.iterator]();
          Object.defineProperty(
            base,
            "headers",
            shifting(mode, () => partial, new Headers({ "x-honest": "yes" })),
          );
          Object.defineProperty(
            base,
            "status",
            shifting(mode, () => 200, 404),
          );
        }),
    },
    {
      label: "a statusText that is not a string, on the success branch",
      make: () =>
        makeDouble((mode, base) => {
          Object.defineProperty(
            base,
            "statusText",
            shifting(mode, () => 7, "Nope"),
          );
          Object.defineProperty(
            base,
            "status",
            shifting(mode, () => 200, 404),
          );
        }),
    },
    {
      label: "a url that is not a string, on the success branch",
      make: () =>
        makeDouble((mode, base) => {
          Object.defineProperty(
            base,
            "url",
            shifting(mode, () => 7, "https://honest.invalid/x"),
          );
          Object.defineProperty(
            base,
            "status",
            shifting(mode, () => 200, 404),
          );
        }),
    },
    {
      label: "a numeric-string status, on the success branch",
      make: () =>
        makeDouble((mode, base) => {
          Object.defineProperty(
            base,
            "status",
            shifting(mode, () => "200", 404),
          );
        }),
    },
    {
      label: "an ok that is not a boolean, on the success branch",
      make: () =>
        makeDouble((mode, base) => {
          Object.defineProperty(
            base,
            "ok",
            shifting(mode, () => "yes", false),
          );
          Object.defineProperty(
            base,
            "status",
            shifting(mode, () => 200, 404),
          );
        }),
    },
    {
      label: "a redirected that is not a boolean, on the success branch",
      make: () =>
        makeDouble((mode, base) => {
          Object.defineProperty(
            base,
            "redirected",
            shifting(mode, () => "no", false),
          );
          Object.defineProperty(
            base,
            "status",
            shifting(mode, () => 200, 404),
          );
        }),
    },
    {
      label: "an unknown response type, on the success branch",
      make: () =>
        makeDouble((mode, base) => {
          Object.defineProperty(
            base,
            "type",
            shifting(mode, () => "bogus", "basic"),
          );
          Object.defineProperty(
            base,
            "status",
            shifting(mode, () => 200, 404),
          );
        }),
    },
    {
      label: "headers the Headers constructor refuses, inside the error constructor",
      make: () =>
        makeDouble((mode, base) => {
          const broken = [["a"]] as unknown as Headers;
          Object.defineProperty(
            base,
            "headers",
            shifting(mode, () => broken, new Headers({ "x-honest": "yes" })),
          );
        }),
    },
    {
      label: "a statusText getter that throws, inside the error constructor",
      make: () =>
        makeDouble((mode, base) => {
          Object.defineProperty(base, "statusText", shifting(mode, throwing("statusText"), "Nope"));
        }),
    },
    {
      label: "a url getter that throws, inside the error constructor",
      make: () =>
        makeDouble((mode, base) => {
          Object.defineProperty(
            base,
            "url",
            shifting(mode, throwing("url"), "https://honest.invalid/x"),
          );
        }),
    },
  ];

  /**
   * "A value refused once has no identity filed against it." The refusal points
   * differ in WHERE they sit — the structural verdict, the staged identity
   * reads, the success-surface check, and the error constructor itself — and
   * each one files a different subset of the identity tables before it refuses.
   * The second presentation is the whole assertion: every field it reports must
   * come from the honest read, not from the refused call.
   */
  test.each(rows)("$label: nothing survives the refused presentation", async ({ make }) => {
    const double = make();
    const transport = (async () => double.value) as unknown as typeof fetch;

    const refused = await typedFetch("https://example.invalid/x", { fetch: transport });
    expect(refused.response).toBeNull();
    expect(isHttpError(refused.error)).toBe(false);
    expect(refused.error?.name).toBe("NetworkError");

    double.setMode("honest");
    const second = await typedFetch("https://example.invalid/x", { fetch: transport });
    if (!isHttpError(second.error)) {
      throw new Error(`the honest presentation produced ${second.error?.name ?? "a success"}`);
    }
    expect(second.error.name).toBe("NotFoundError");
    expect(second.error.status).toBe(404);
    expect(second.error.url).toBe("https://honest.invalid/x");
    expect(second.error.toJSON().headers).toEqual(["x-honest"]);
    expect(second.error.message).toContain("https://honest.invalid/x");
    await second.error.cancel();
  });
});

describe("round 9 / H2 — an unmapped status through clone()", () => {
  test("an UnknownHttpError copy agrees with its original and both guards hold", async () => {
    const response = new Response("payload", { status: 599, statusText: "Weird" });
    const transport = (async () => response) as unknown as typeof fetch;
    const { error } = await typedFetch("https://example.invalid/x", { fetch: transport });
    if (!isHttpError(error)) throw new Error("expected an HTTP error");
    expect(isKnownHttpError(error)).toBe(false);
    const copy = error.clone();
    expect(isHttpError(copy)).toBe(true);
    expect(isKnownHttpError(copy)).toBe(false);
    expect(copy.toJSON()).toEqual(error.toJSON());
    await Promise.all([error.cancel(), copy.cancel()]);
  });
});
