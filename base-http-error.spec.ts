import { readdirSync, readFileSync } from "node:fs";
import { describe, test, expect, vi } from "vitest";
import { BaseHttpError, NotFoundError, UnknownHttpError } from "./src/errors";
import { ownsResponseSymbol } from "./src/errors/brand";
import { typedFetch } from "./src/index";

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

/** Ignores the response it is given and builds from its own. */
class DetachedHttpError extends BaseHttpError {
  override readonly name = "DetachedHttpError" as const;
  readonly status = 499 as const;
  readonly statusText = "Custom" as const;

  constructor(_response: Response) {
    super(new Response("detached", { status: 499 }));
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

describe("BaseHttpError.toJSON() — the record JSON.stringify produces", () => {
  test("carries the identity a plain Error omits", async () => {
    const error = new NotFoundError(
      new Response("payload", {
        status: 404,
        statusText: "Not Found",
        headers: { "content-type": "text/plain" },
      }),
    );

    // `message` and `stack` are non-enumerable on Error, so without toJSON the
    // record read as a complete one that had lost the message line.
    expect(JSON.parse(JSON.stringify(error))).toEqual({
      name: "NotFoundError",
      message: "HTTP 404 Not Found",
      status: 404,
      statusText: "Not Found",
      url: "",
      headers: ["content-type"],
    });

    await error.cancel();
  });

  test("the record names the headers and keeps none of their values", () => {
    const error = new NotFoundError(
      new Response(null, {
        status: 404,
        headers: [
          ["set-cookie", "session=SECRET"],
          ["set-cookie", "csrf=ALSO_SECRET"],
          ["x-internal-token", "sk_live_SECRET"],
          ["content-type", "application/json"],
        ],
      }),
    );

    const { headers } = error.toJSON();

    // One name per header the server sent, so a repeated `set-cookie` still
    // shows how many times it arrived.
    expect(headers).toEqual(["content-type", "set-cookie", "set-cookie", "x-internal-token"]);

    // The regression this pins: a logger calls toJSON on whatever it is handed,
    // so a value in the record reaches the log without anyone judging it. A
    // deny list would not have caught `x-internal-token`.
    const record = JSON.stringify(error);
    expect(record).not.toContain("SECRET");
    expect(record).not.toContain("sk_live");

    // The values are still on the error for a caller who asks for them.
    expect(error.headers.getSetCookie()).toEqual(["session=SECRET", "csrf=ALSO_SECRET"]);
  });

  test("neither the stack nor the body reaches the record", async () => {
    const error = new NotFoundError(new Response("secret payload", { status: 404 }));

    // The record has exactly these members, and no others.
    expect(Object.keys(error.toJSON()).toSorted()).toEqual([
      "headers",
      "message",
      "name",
      "status",
      "statusText",
      "url",
    ]);

    const json = JSON.stringify(error);

    expect(json).not.toContain("secret payload");
    expect(json).not.toContain("stack");
    // Excluded from the record, still on the error for a caller who wants it.
    expect(error.stack).toBeDefined();

    await error.cancel();
  });

  test("UnknownHttpError reports the status the server sent", () => {
    const error = new UnknownHttpError(new Response(null, { status: 599, statusText: "Weird" }));

    expect(error.toJSON()).toEqual({
      name: "UnknownHttpError",
      message: "HTTP 599 Weird",
      status: 599,
      statusText: "Weird",
      url: "",
      headers: [],
    });
  });

  test("a consumer subclass inherits it and reports its own name", async () => {
    const error = new ContextHttpError(new Response("body", { status: 499 }), "tenant-42");

    expect(error.toJSON().name).toBe("ContextHttpError");
    expect(error.toJSON().status).toBe(499);

    await error.cancel();
  });
});

describe("BaseHttpError — headers are a copy of the response's, not an alias", () => {
  test("editing error.headers cannot write back into the response", () => {
    const response = new Response(null, {
      status: 404,
      headers: { "content-type": "text/plain" },
    });
    const error = new NotFoundError(response);

    expect(error.headers).toBeInstanceOf(Headers);
    expect(error.headers).not.toBe(response.headers);

    error.headers.set("x-injected", "1");
    error.headers.delete("content-type");

    // Reachable through an injected `fetch` that kept the Response.
    expect(response.headers.get("x-injected")).toBeNull();
    expect(response.headers.get("content-type")).toBe("text/plain");
  });

  test("the copy carries every header, including a repeated set-cookie", () => {
    const response = new Response(null, {
      status: 404,
      headers: [
        ["set-cookie", "a=1"],
        ["set-cookie", "b=2"],
        ["retry-after", "60"],
      ],
    });

    const error = new NotFoundError(response);

    expect(error.headers.getSetCookie()).toEqual(["a=1", "b=2"]);
    expect(error.headers.get("retry-after")).toBe("60");
  });
});

describe("BaseHttpError — an instance the constructor never initialized", () => {
  // The accepted cost of carrying no `#private` member: the classes are purely
  // structural, so an object with the right shape is ASSIGNABLE to
  // BaseHttpError. The runtime consequence lands here — it has no entry in the
  // body table, and every body method rejects it by name.
  test("the readers reject rather than throwing synchronously", async () => {
    const impostor = Object.create(NotFoundError.prototype) as NotFoundError;

    // Rejects, never throws out of the call: the documented shape is
    // `await expect(error.text()).rejects.toThrow(...)`.
    await expect(impostor.text()).rejects.toThrowError(TypeError);
    await expect(impostor.text()).rejects.toThrowError(/A subclass must call super\(response\)/);
    await expect(impostor.json()).rejects.toThrowError(/carries no response/);
    await expect(impostor.blob()).rejects.toThrowError(/carries no response/);
    await expect(impostor.arrayBuffer()).rejects.toThrowError(/carries no response/);
    await expect(impostor.cancel()).rejects.toThrowError(/carries no response/);
  });

  test("clone() throws synchronously, the deliberate exception", () => {
    const impostor = Object.create(NotFoundError.prototype) as NotFoundError;

    expect(() => impostor.clone()).toThrowError(TypeError);
    expect(() => impostor.clone()).toThrowError(/A subclass must call super\(response\)/);
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
  test("cancel() is available on UnknownHttpError too", async () => {
    const { response, state } = trackedResponse(499);
    const error = new UnknownHttpError(response);

    await error.cancel();

    expect(state.cancelled).toBe(true);
  });
});

describe("BaseHttpError.cancel() — a failed clone must not strand the body", () => {
  // clone() tees the body BEFORE it can know the copy will exist. If the
  // recreate callback or the subclass constructor throws, that branch has no
  // owner — and the platform releases the source only once EVERY branch is
  // released, so cancel() on the survivor would wait forever.
  test("cancel() still settles after a throwing recreate callback", async () => {
    // B18a, strengthened: `trackedResponse` records what the underlying source
    // actually did. A settled `cancel()` alone proves the promise resolved; the
    // `cancelled` flag proves the source was genuinely FREED, which is the thing
    // a stranded branch prevents. The no-callback paths cannot be swept by the
    // branch-level sweep below, because the branch never reaches the test — so
    // they are covered through the source instead.
    const { response, state } = trackedResponse();
    const error = new NotFoundError(response);

    expect(() =>
      error.clone(() => {
        throw new Error("recreate exploded");
      }),
    ).toThrowError(/recreate callback failed/);

    await expect(error.cancel()).resolves.toBeUndefined();
    expect(state.cancelled).toBe(true);
  });

  test("cancel() still settles after a response-only clone failure", async () => {
    // ContextHttpError's constructor rejects an empty context, so the
    // no-callback clone path throws — the case base-http-error.spec already
    // covers, now followed by the cleanup that used to hang. B18b, strengthened
    // the same way as B18a above.
    const { response, state } = trackedResponse(499);
    const error = new ContextHttpError(response, "tenant-42");

    expect(() => error.clone()).toThrowError("context is required");

    await expect(error.cancel()).resolves.toBeUndefined();
    expect(state.cancelled).toBe(true);
  });

  test("a read still works after a failed clone", async () => {
    const error = new NotFoundError(new Response("payload", { status: 404 }));

    expect(() =>
      error.clone(() => {
        throw new Error("recreate exploded");
      }),
    ).toThrowError(TypeError);

    expect(await error.text()).toBe("payload");
  });

  test("cancel() still settles after a hostile constructor getter throws mid-clone", async () => {
    const error = new NotFoundError(new Response("payload", { status: 404 }));

    // `this.constructor` is a property read like any other. An own accessor on
    // the instance — or a Proxy `get` trap, which instrumentation wrappers
    // install routinely — intercepts it exactly like a hostile `name` getter.
    // clone()'s no-callback path read it OUTSIDE the try that releases the
    // teed branch, so the branch was stranded and cancel() never settled.
    Object.defineProperty(error, "constructor", {
      get() {
        throw new Error("constructor getter failed");
      },
    });

    expect(() => error.clone()).toThrowError(/constructor getter failed/);

    await expect(error.cancel()).resolves.toBeUndefined();
  });

  test("a recreate callback that returns the same error is rejected", async () => {
    const error = new NotFoundError(new Response("payload", { status: 404 }));

    // Returning `this` yields one instance owning two teed branches, so
    // releasing it can never release both.
    expect(() => error.clone(() => error)).toThrowError(/returned the same error/);

    await expect(error.cancel()).resolves.toBeUndefined();
  });

  test("a recreate callback that ignores the response it receives is rejected", async () => {
    const error = new NotFoundError(new Response("payload", { status: 404 }));
    const foreign = new NotFoundError(new Response("elsewhere", { status: 404 }));

    // The callback returns a DIFFERENT error, built from a different response.
    // The teed branch then has no owner at all: the platform never frees the
    // source, and cancel() on this error never settles.
    expect(() => error.clone(() => foreign)).toThrowError(
      /Build a new instance from the response it receives/,
    );
    expect(() => error.clone(() => foreign)).toThrowError(TypeError);

    await expect(error.cancel()).resolves.toBeUndefined();
    await foreign.cancel();
  });

  test("a subclass constructor that discards the branch is rejected too", async () => {
    // The no-callback path hands the branch to `this.constructor`. A subclass
    // that calls super() with its own response orphans it exactly the same way,
    // so the guard cannot live in the callback branch alone.
    const error = new DetachedHttpError(new Response("payload", { status: 499 }));

    expect(() => error.clone()).toThrowError(/Build a new instance from the response it receives/);

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

/**
 * Race a promise against a timer.
 *
 * A regression must FAIL the suite, not hang it: a bare `await error.cancel()`
 * on a stranded branch waits for vitest's global timeout and reports nothing at
 * all about why. Follows the `Promise.race` shape `error-body.spec.ts` already
 * uses for the same question.
 *
 * The budget is generous on purpose, and it costs nothing where it matters.
 * Every caller asserts `"settled"`, so the timer is a fallback and the assertion
 * still fails in milliseconds on a real regression: a stranded branch never
 * settles at all, so no budget rescues it. A tight budget only adds a way for a
 * genuinely-settling `cancel()` to lose the race on a starved CI runner and
 * report a defect that is not there.
 */
async function settlesWithin(promise: Promise<unknown>, ms = 500): Promise<string> {
  return Promise.race([
    promise.then(() => "settled"),
    new Promise<string>((resolve) => setTimeout(() => resolve("pending"), ms)),
  ]);
}

/**
 * Run a `clone()` that must fail, capturing the branch the callback was handed.
 *
 * The branch is the only whitebox observable that separates a released branch
 * from an orphaned one, and it never escapes `clone()` on its own.
 */
function failingClone(
  error: NotFoundError,
  recreate: (response: Response) => NotFoundError,
): { thrown: unknown; branch: Response | undefined } {
  let branch: Response | undefined;
  let thrown: unknown;
  try {
    error.clone((response) => {
      branch = response;
      return recreate(response);
    });
  } catch (caught) {
    thrown = caught;
  }
  return { thrown, branch };
}

/**
 * The mechanical invariant of every failing clone path, in two assertions.
 *
 * `release()` calls `branch.body.cancel()`, and `bodyUsed` flips inside that
 * call, SYNCHRONOUSLY (measured on Node 20.15.0) — while an ORPHANED branch
 * reports `false`. That single observable is the signature of the defect. The
 * second assertion is the observable a consumer experiences, and the two are
 * independent: the first alone would pass if `release()` were called on the
 * wrong branch, the second alone would pass if the platform changed its tee
 * semantics.
 *
 * Every caller must build its error from a response that HAS a body: a
 * `new Response(null, …)` branch has `body === null`, so `bodyUsed` stays
 * `false` forever and the first assertion would be silently meaningless.
 */
async function expectBranchReleased(
  error: NotFoundError,
  branch: Response | undefined,
): Promise<void> {
  expect(branch?.bodyUsed).toBe(true);
  expect(await settlesWithin(error.cancel())).toBe("settled");
}

/**
 * A copy from ANOTHER package copy AT THIS VERSION: it carries the ownership
 * query under the cross-version key and answers it honestly.
 *
 * Neither fixture derives from this copy's `BaseHttpError`, which is exactly
 * what `instanceof` reports for an instance from a genuinely different package
 * copy. That is the whole reason the body table cannot see one.
 */
const newCopyError = (response: Response) =>
  ({
    name: "NotFoundError",
    status: 404,
    statusText: "Not Found",
    url: response.url,
    headers: response.headers,
    [ownsResponseSymbol](candidate: Response) {
      return candidate === response;
    },
    async cancel() {
      await response.body?.cancel();
    },
  }) as unknown as NotFoundError;

/**
 * A copy from a package copy OLDER than this one: no member under the key, so
 * it cannot answer the question at all. This is the reproduced defect's shape.
 */
const oldCopyError = (response: Response) =>
  ({
    name: "NotFoundError",
    status: 404,
    statusText: "Not Found",
    url: response.url,
    headers: response.headers,
    async cancel() {
      await response.body?.cancel();
    },
  }) as unknown as NotFoundError;

describe("BaseHttpError.clone() — an owner this copy cannot see", () => {
  test("a Proxy-wrapped copy is refused, and the branch is released", async () => {
    const error = new NotFoundError(new Response("payload", { status: 404 }));

    // Wrapping the recreated error in a Proxy is the standard APM
    // instrumentation pattern. The WeakMap cannot key it, so `bodies.get`
    // returned `undefined` — indistinguishable from the legitimate
    // other-package-copy case the `undefined` was accepted for.
    expect(() =>
      error.clone((response) => new Proxy(new NotFoundError(response), {})),
    ).toThrowError(/claims this copy of the library but carries no body/);

    // The regression this pins: the clone used to SUCCEED, and then this
    // cancel never settled — one pinned connection and one unreleased stream
    // per cloned error, with no recovery path, because `this` inside the
    // copy's `cancel` is the Proxy.
    await expect(error.cancel()).resolves.toBeUndefined();
  });

  test("an Object.create delegate is refused the same way", async () => {
    const error = new NotFoundError(new Response("payload", { status: 404 }));

    expect(() =>
      error.clone((response) => Object.create(new NotFoundError(response))),
    ).toThrowError(TypeError);

    await expect(error.cancel()).resolves.toBeUndefined();
  });

  test("B1: an instance from a DIFFERENT package copy is accepted when it confirms the branch", async () => {
    // The case the `undefined` was accepted for, and which must keep working: a
    // recreate callback may legitimately return an instance whose class — and
    // whose body table — came from another loaded copy of this library. What
    // changed is that the copy now has to SAY it took the branch, because the
    // body table is per package copy and cannot check it.
    const error = new NotFoundError(new Response("payload", { status: 404 }));

    const copy = error.clone(newCopyError);
    expect(copy).toBeDefined();

    expect(await settlesWithin(Promise.all([error.cancel(), copy.cancel()]))).toBe("settled");
  });

  test("B2: the accepted cross-copy clone really tees the body", async () => {
    // Acceptance alone proves nothing about the stream. Reading BOTH sides is
    // what proves the tee is real rather than merely permitted.
    const error = new NotFoundError(new Response("payload", { status: 404 }));
    let branch: Response | undefined;

    const copy = error.clone((response) => {
      branch = response;
      return newCopyError(response);
    });

    expect(copy).toBeDefined();
    expect(await error.text()).toBe("payload");
    expect(await branch?.text()).toBe("payload");
  });

  test("B3: a cross-copy instance built from a DIFFERENT response is refused", async () => {
    const error = new NotFoundError(new Response("payload", { status: 404 }));
    const elsewhere = new Response("elsewhere", { status: 404 });

    const { thrown, branch } = failingClone(error, () => newCopyError(elsewhere));

    expect(thrown).toBeInstanceOf(TypeError);
    expect((thrown as Error).message).toMatch(/built from a different response/);
    await expectBranchReleased(error, branch);
    await elsewhere.body?.cancel();
  });

  test("B4: THE REPRODUCED CASE — an older package copy cannot confirm the branch", async () => {
    // Reproduced against the built artifacts: the clone was ACCEPTED, the
    // branch reported `bodyUsed === false`, and `original.cancel()` stayed
    // pending forever. One pinned connection and one unreleased stream per
    // cloned error, with no recovery path.
    const error = new NotFoundError(new Response("payload", { status: 404 }));
    const elsewhere = new Response("elsewhere", { status: 404 });

    const { thrown, branch } = failingClone(error, () => oldCopyError(elsewhere));

    expect(thrown).toBeInstanceOf(TypeError);
    expect((thrown as Error).message).toMatch(/cannot confirm that it took the cloned body branch/);
    // The message must name the actionable cause. Telling this consumer their
    // callback "was built from a different response" would send them hunting a
    // bug in correct code.
    expect((thrown as Error).message).toMatch(/older than this one/);
    await expectBranchReleased(error, branch);
    await elsewhere.body?.cancel();
  });

  test("B5: a member that is not callable cannot confirm either", async () => {
    const error = new NotFoundError(new Response("payload", { status: 404 }));

    const { thrown, branch } = failingClone(
      error,
      (response) => ({ [ownsResponseSymbol]: 1, url: response.url }) as unknown as NotFoundError,
    );

    expect((thrown as Error).message).toMatch(/cannot confirm that it took the cloned body branch/);
    await expectBranchReleased(error, branch);
  });

  test("B6: a member that throws has answered, and the answer is not yes", async () => {
    const error = new NotFoundError(new Response("payload", { status: 404 }));

    const { thrown, branch } = failingClone(
      error,
      () =>
        ({
          [ownsResponseSymbol]() {
            throw new Error("member exploded");
          },
        }) as unknown as NotFoundError,
    );

    expect((thrown as Error).message).toMatch(/built from a different response/);
    await expectBranchReleased(error, branch);
  });

  test("B7: a symbol-keyed getter that throws answers no", async () => {
    const error = new NotFoundError(new Response("payload", { status: 404 }));

    const { thrown, branch } = failingClone(
      error,
      () =>
        Object.defineProperty({}, ownsResponseSymbol, {
          get() {
            throw new Error("symbol read exploded");
          },
        }) as unknown as NotFoundError,
    );

    expect((thrown as Error).message).toMatch(/built from a different response/);
    await expectBranchReleased(error, branch);
  });

  test("B8: a Proxy around a FOREIGN-copy object is refused by the ownership query", async () => {
    // The Proxy guard above only fires for a value that claims THIS copy. A
    // Proxy wrapping a foreign-copy object does not, so it falls through to the
    // ownership query — which is where a throwing `get` trap has to be handled
    // rather than allowed to escape past the release.
    const error = new NotFoundError(new Response("payload", { status: 404 }));
    const elsewhere = new Response("elsewhere", { status: 404 });

    const { thrown, branch } = failingClone(
      error,
      () =>
        new Proxy(oldCopyError(elsewhere) as object, {
          get() {
            throw new Error("trap");
          },
        }) as NotFoundError,
    );

    expect((thrown as Error).message).toMatch(/built from a different response/);
    await expectBranchReleased(error, branch);
    await elsewhere.body?.cancel();
  });

  test("B9: a truthy non-boolean answer is not a yes", async () => {
    const error = new NotFoundError(new Response("payload", { status: 404 }));

    const { thrown, branch } = failingClone(
      error,
      () => ({ [ownsResponseSymbol]: () => 1 }) as unknown as NotFoundError,
    );

    expect((thrown as Error).message).toMatch(/built from a different response/);
    await expectBranchReleased(error, branch);
  });

  test("B10: THE DOCUMENTED RESIDUAL — a copy that lies is believed", async () => {
    // The query is a protocol across a seam, not a proof. Nothing on this side
    // can check a foreign copy's claim; the alternative is to hand a foreign
    // object the `Response` and let it prove custody, which is exactly what
    // `recreate` already did. Pinned in executable form so the limit is a known
    // one rather than a surprise.
    const error = new NotFoundError(new Response("payload", { status: 404 }));
    const elsewhere = new Response("elsewhere", { status: 404 });
    let branch: Response | undefined;

    const copy = error.clone((response) => {
      branch = response;
      // It holds `elsewhere`, and it claims the branch anyway.
      return {
        url: elsewhere.url,
        [ownsResponseSymbol]: () => true,
      } as unknown as NotFoundError;
    });

    expect(copy).toBeDefined();

    // Release the branch by hand, so the pending `cancel()` this residual
    // creates cannot outlive the test. NOT awaited on its own: a branch's
    // `cancel()` stays pending until its sibling is released too, which is the
    // native tee semantics this library keeps.
    void branch?.body?.cancel().catch(() => {});
    expect(await settlesWithin(error.cancel())).toBe("settled");
    void elsewhere.body?.cancel().catch(() => {});
  });

  const nonErrorResults: Array<{ label: string; value: unknown; pattern: RegExp }> = [
    { label: "null", value: null, pattern: /returned null instead of an error/ },
    { label: "undefined", value: undefined, pattern: /returned undefined instead of an error/ },
    { label: "a string", value: "x", pattern: /returned string instead of an error/ },
    { label: "a number", value: 42, pattern: /returned number instead of an error/ },
    // An object and a function CAN carry a member, so they reach the ownership
    // query and get its message instead.
    { label: "a bare object", value: {}, pattern: /cannot confirm that it took the cloned body/ },
    {
      label: "a bare function",
      value: () => {},
      pattern: /cannot confirm that it took the cloned body/,
    },
  ];

  test.each(nonErrorResults)(
    "B11–B16: a recreate callback that returns $label is refused",
    async ({ value, pattern }) => {
      // The second latent defect: `clone(() => null)` used to RETURN `null` and
      // strand the branch. The declared `(response) => this` return type says
      // this cannot happen; a JavaScript consumer, a mocked callback in a test
      // double, and one `as any` all say it can.
      const error = new NotFoundError(new Response("payload", { status: 404 }));

      const { thrown, branch } = failingClone(error, () => value as NotFoundError);

      expect(thrown).toBeInstanceOf(TypeError);
      expect((thrown as Error).message).toMatch(pattern);
      await expectBranchReleased(error, branch);
    },
  );

  test("B17: EVERY refused shape releases the branch and leaves cancel() able to settle", async () => {
    // The invariant, asserted in one place over the whole decision table. A new
    // guard added without a release would pass its own case and fail here.
    const shapes: Array<{ label: string; make: (response: Response) => unknown }> = [
      { label: "null", make: () => null },
      { label: "undefined", make: () => undefined },
      { label: "a string", make: () => "x" },
      { label: "a number", make: () => 42 },
      { label: "a bare object", make: () => ({}) },
      { label: "a bare function", make: () => () => {} },
      { label: "the same error", make: () => undefined },
      {
        label: "a Proxy that claims this copy",
        make: (response) => new Proxy(new NotFoundError(response), {}),
      },
      {
        label: "an Object.create delegate",
        make: (response) => Object.create(new NotFoundError(response)) as object,
      },
      { label: "a different-response instance", make: () => new NotFoundError(new Response("e")) },
      { label: "an older-copy instance", make: () => oldCopyError(new Response("e")) },
      {
        label: "a cross-copy instance holding another response",
        make: () => newCopyError(new Response("e")),
      },
      {
        label: "a member that throws",
        make: () => ({
          [ownsResponseSymbol]() {
            throw new Error("member exploded");
          },
        }),
      },
    ];

    for (const { label, make } of shapes) {
      const error = new NotFoundError(new Response("payload", { status: 404 }));
      // The same-error row cannot be produced by `make`, which never sees the
      // error; it is produced here so the row still exercises its own guard.
      const recreate =
        label === "the same error"
          ? () => error
          : (response: Response) => make(response) as NotFoundError;

      const { thrown, branch } = failingClone(error, recreate);

      expect(thrown, `${label} was accepted`).toBeInstanceOf(TypeError);
      expect(branch?.bodyUsed, `${label} left the branch unreleased`).toBe(true);
      expect(await settlesWithin(error.cancel()), `${label} left cancel() pending`).toBe("settled");
    }
  });

  test("B19a: clone() after json() tees nothing at all", async () => {
    const response = new Response('{"a":1}', { status: 404 });
    const error = new NotFoundError(response);
    await error.json();
    const cloneSpy = vi.spyOn(response, "clone");

    expect(() => error.clone()).toThrowError(/already been read/);

    // Nothing was teed, so there is no branch to leak. The guard refuses
    // BEFORE the tee, which is the only order that can be correct.
    expect(cloneSpy).not.toHaveBeenCalled();
  });

  test("B19b: clone() after cancel() tees nothing at all", async () => {
    const response = new Response("payload", { status: 404 });
    const error = new NotFoundError(response);
    await error.cancel();
    const cloneSpy = vi.spyOn(response, "clone");

    expect(() => error.clone()).toThrowError(TypeError);

    expect(cloneSpy).not.toHaveBeenCalled();
  });

  test("B19c: clone() on a locked-but-unread body tees nothing at all", () => {
    const response = new Response("payload", { status: 404 });
    response.body?.getReader();
    const error = new NotFoundError(response);
    const cloneSpy = vi.spyOn(response, "clone");

    expect(() => error.clone()).toThrowError(/its stream is locked/);

    expect(cloneSpy).not.toHaveBeenCalled();
  });
});

describe("BaseHttpError.cancel() — the shipped JSDoc matches the behavior", () => {
  test("the resolve list names the errored-stream case", () => {
    // `cancel()` was changed so an errored body stream RESOLVES rather than
    // crashing the process. The README and the internal ErrorBody doc were
    // updated; this block — the one a consumer reads on hover, because it is
    // emitted into dist/index.d.ts — was missed.
    const source = readFileSync("src/errors/base-http-error.ts", "utf8");
    const cancelDoc = source.slice(
      source.indexOf("Release the error response body without reading it"),
      source.indexOf("async cancel("),
    );

    expect(cancelDoc).toMatch(/stream FAILED|body stream failed/i);
    expect(cancelDoc).toMatch(/truncated|reset/i);
  });
});

// ── Identity is read once per response ───────────────────────────────
//
// These cases construct errors DIRECTLY, with no `typedFetch` and no test
// server, because the constructor is where five of the reads lived. The
// counters are the assertion: a test that only compared values would pass
// against code that reads three times and happens to agree.

/** A subclass of the catch-all class, with state a response-only clone loses. */
class ContextUnknownError extends UnknownHttpError {
  constructor(
    response: Response,
    public readonly context: string,
  ) {
    super(response);
  }
}

type IdentityField = "status" | "statusText" | "url" | "headers";

/**
 * A `Response` whose named identity accessors answer with the next value of a
 * list, hold the last value once the list runs out, and count their reads.
 *
 * Only the fields named in `overrides` get an accessor, so a test that cares
 * about one field leaves the other three answering exactly as the platform
 * does.
 */
function cyclingResponse(
  overrides: Partial<Record<IdentityField, readonly unknown[]>>,
  init?: ResponseInit,
  body: BodyInit | null = null,
): { response: Response; reads: Record<IdentityField, number> } {
  const response = new Response(body, init);
  const reads: Record<IdentityField, number> = { status: 0, statusText: 0, url: 0, headers: 0 };

  for (const field of Object.keys(overrides) as IdentityField[]) {
    const values = overrides[field];
    if (!values) continue;
    Object.defineProperty(response, field, {
      configurable: true,
      get() {
        const value = values[Math.min(reads[field], values.length - 1)];
        reads[field] += 1;
        return value;
      },
    });
  }

  return { response, reads };
}

describe("BaseHttpError — identity is read once per response", () => {
  test("BH-01: the public constructor signature is unchanged for a consumer subclass", async () => {
    // A consumer subclass calling `super(response)` with a REAL `Response`, and
    // taking its own extra argument, must keep working exactly as it did. This
    // is the guard against a second constructor parameter leaking in.
    const error = new ContextHttpError(new Response("body", { status: 499 }), "acme");

    expect(error.status).toBe(499);
    expect(error.statusText).toBe("Custom");
    expect(error.message).toBe("HTTP 499");
    expect(error.context).toBe("acme");
    expect(await error.text()).toBe("body");
  });

  test("BH-02: a consumer subclass reads the status once, not twice", async () => {
    const { response, reads } = cyclingResponse({ status: [499, 200] }, { status: 499 }, "body");
    const error = new ContextHttpError(response, "acme");

    // The message line used to read `status` a second time in its no-phrase
    // branch, so a shifting getter could report a status the class never saw.
    expect(error.message).toBe("HTTP 499");
    expect(reads.status).toBe(1);

    await error.cancel();
  });

  test("BH-03: UnknownHttpError reports the first read through every member", () => {
    const { response, reads } = cyclingResponse(
      { status: [420, 200, 201], statusText: ["Weird", "OK"] },
      { status: 404 },
    );

    const error = new UnknownHttpError(response);

    expect(error.status).toBe(420);
    expect(error.statusText).toBe("Weird");
    expect(error.message.startsWith("HTTP 420 Weird")).toBe(true);
    expect(error.toJSON()).toEqual({
      name: "UnknownHttpError",
      message: "HTTP 420 Weird",
      status: 420,
      statusText: "Weird",
      url: "",
      headers: [],
    });
    expect(reads.status).toBe(1);
    expect(reads.statusText).toBe(1);
  });

  test("BH-04: a dedicated class built from a mismatched response still reports two numbers", () => {
    // RESIDUAL, pinned deliberately so nobody "fixes" it later. The consumer
    // chose the class, so `status` is the class literal; the message reports
    // what the wire said. Through `typedFetch` the two can no longer differ,
    // because the same single read chose the class and wrote the message.
    const error = new NotFoundError(
      new Response(null, { status: 500, statusText: "Internal Server Error" }),
    );

    expect(error.status).toBe(404);
    expect(error.message).toBe("HTTP 500 Internal Server Error");
  });

  test("BH-05: two errors from ONE response report one identity and two header copies", () => {
    const { response } = cyclingResponse(
      {
        status: [420, 500],
        statusText: ["Weird", "OK"],
        url: ["https://a.test/x", "https://b.test/y"],
      },
      { status: 404 },
    );

    const a = new UnknownHttpError(response);
    const b = new UnknownHttpError(response);

    // A `Response` has ONE identity, so the second error cannot report a later
    // reading of the same getters.
    expect(b.status).toBe(a.status);
    expect(b.statusText).toBe(a.statusText);
    expect(b.url).toBe(a.url);

    // …and the shared record must NOT hold a shared `Headers`, or editing one
    // error's headers would edit the other's.
    expect(a.headers).not.toBe(b.headers);
    a.headers.set("x-a", "1");
    expect(b.headers.get("x-a")).toBeNull();
  });

  test("BH-06: a copy inherits the identity instead of re-reading the branch", async () => {
    // The branch comes from a real `Response.clone()`, so it reports the
    // response's INTERNAL SLOTS (404 here) rather than the own-property getter
    // that produced the original error's identity (420). Without the handoff
    // the copy would report 404 and a different message.
    const { response, reads } = cyclingResponse(
      { status: [420, 500, 501] },
      { status: 404 },
      "payload",
    );
    const error = new UnknownHttpError(response);
    expect(error.status).toBe(420);

    const copy = error.clone();

    expect(copy.status).toBe(420);
    expect(copy.statusText).toBe(error.statusText);
    expect(copy.message).toBe(error.message);
    expect(copy.url).toBe(error.url);
    expect(reads.status).toBe(1);

    await Promise.all([error.cancel(), copy.cancel()]);
  });

  test("BH-07: a recreate callback's copy inherits the identity too", async () => {
    const { response } = cyclingResponse({ status: [420, 500] }, { status: 404 }, "payload");
    const error = new UnknownHttpError(response);

    const copy = error.clone(
      (branch) => new ContextUnknownError(branch, "acme") as typeof error,
    ) as ContextUnknownError;

    expect(copy.status).toBe(420);
    expect(copy.context).toBe("acme");

    await Promise.all([error.cancel(), copy.cancel()]);
  });

  test("BH-08: for an ordinary Response the handoff changes nothing", async () => {
    const error = new NotFoundError(
      new Response("payload", { status: 404, statusText: "Not Found" }),
    );

    const copy = error.clone();

    expect(copy.status).toBe(error.status);
    expect(copy.statusText).toBe(error.statusText);
    expect(copy.message).toBe(error.message);
    expect(copy.url).toBe(error.url);

    await Promise.all([error.cancel(), copy.cancel()]);
  });

  test("BH-09: the handoff does not weaken the orphan check", async () => {
    // `DetachedHttpError` ignores the response it receives and builds from its
    // own, so the branch has no owner. Seeding the branch's identity must not
    // make that look like consent.
    const error = new NotFoundError(new Response("payload", { status: 404 }));

    expect(() =>
      error.clone((branch) => new DetachedHttpError(branch) as unknown as typeof error),
    ).toThrowError(/Build a new instance from the response it receives/);

    await expect(error.cancel()).resolves.toBeUndefined();
  });

  test("BH-10: a copy constructor that throws on a seeded branch still releases it", async () => {
    const { response } = cyclingResponse({ status: [499, 200] }, { status: 499 }, "payload");
    const error = new ContextHttpError(response, "tenant-42");

    // The no-callback path hands the branch to a constructor that refuses an
    // empty context. The seed is written BEFORE that call, so it must not have
    // taken over responsibility for releasing the branch.
    expect(() => error.clone()).toThrowError("context is required");

    await expect(error.cancel()).resolves.toBeUndefined();
  });

  test("BH-11: an uninitialized instance is refused before any identity is read", () => {
    // `clone()` reads the body table FIRST. An identity read placed before it
    // would touch a response this instance never had.
    const impostor = Object.create(NotFoundError.prototype) as NotFoundError;

    expect(() => impostor.clone()).toThrowError(TypeError);
    expect(() => impostor.clone()).toThrowError(/A subclass must call super\(response\)/);
  });

  test("BH-12: the toJSON record and the instance describe one response", () => {
    const { response, reads } = cyclingResponse(
      { status: [420, 500], url: ["https://a.test/x?tok=SECRET", "https://b.test/y"] },
      { status: 404 },
    );
    const error = new UnknownHttpError(response);

    const record = error.toJSON();

    expect(record.status).toBe(error.status);
    expect(record.statusText).toBe(error.statusText);
    // The record carries the redacted form of the SAME single read the escape
    // hatch carries in full.
    expect(record.url).toBe("https://a.test/x");
    expect(error.url).toBe("https://a.test/x?tok=SECRET");
    expect(reads.status).toBe(1);
    expect(reads.url).toBe(1);
  });

  test("BH-13: the headers accessor is read exactly once", () => {
    const response = new Response(null, { status: 404, headers: { "x-a": "1" } });
    const real = response.headers;
    let reads = 0;
    Object.defineProperty(response, "headers", {
      configurable: true,
      get() {
        reads += 1;
        return real;
      },
    });

    const error = new NotFoundError(response);

    expect(error.headers.get("x-a")).toBe("1");
    expect(reads).toBe(1);
  });

  test("BH-14: a non-string statusText is the empty string, and the phrase is dropped", () => {
    const { response } = cyclingResponse({ statusText: [42] }, { status: 599 });

    const error = new UnknownHttpError(response);

    expect(error.statusText).toBe("");
    expect(typeof error.statusText).toBe("string");
    expect(error.message).toBe("HTTP 599");
  });

  test("BH-15: a URL object in the url slot is lost, and the no-url branch is taken", () => {
    // The stated cost of the rule: a test double must answer `url` with a
    // string, as the platform does.
    const { response } = cyclingResponse({ url: [new URL("https://a.test/")] }, { status: 404 });

    const error = new NotFoundError(response);

    expect(error.url).toBe("");
    expect(typeof error.url).toBe("string");
    expect(error.message).toBe("HTTP 404");
  });

  test("BH-16: the change adds NO own property, so no channel widens", () => {
    // A `WeakMap` side table creates no own property. Written out by hand
    // rather than snapshotted, because the point is the exact set: a new own
    // property would reach `Object.keys`, the spread, `for...in`,
    // `util.inspect` with showHidden, and Node's fatal-exception printer, and
    // `disclosure-channels.spec.ts` would have to gain a case for it first.
    const expected = ["headers", "message", "name", "stack", "status", "statusText", "url"];

    const notFound = new NotFoundError(new Response(null, { status: 404 }));
    const unknown = new UnknownHttpError(new Response(null, { status: 599 }));

    expect(Object.getOwnPropertyNames(notFound).toSorted()).toEqual(expected);
    expect(Object.getOwnPropertyNames(unknown).toSorted()).toEqual(expected);
  });
});

/**
 * A response double that answers `clone()` with a `Response` IT DID NOT CREATE.
 *
 * The platform never does this: `Response.clone()` builds a fresh object nobody
 * else holds. A custom Fetch implementation — the seam this library documents,
 * tests, and invites a consumer to use — is under no such constraint, and
 * `clone()` has to hand the returned object an identity before it can build the
 * copy from it. That is why the handoff is a LOAN. Every case below asserts the
 * same thing from a different angle: the branch is left exactly as it was found.
 */
function doubleCloningInto(branch: Response): Response {
  return {
    status: 404,
    statusText: "Not Found",
    url: "https://double.test/x",
    headers: new Headers(),
    body: null,
    bodyUsed: false,
    clone: () => branch,
  } as unknown as Response;
}

describe("BaseHttpError.clone() — an inherited identity is lent, never recorded", () => {
  test("BH-17: a later request that resolves the branch reports the branch's own status", async () => {
    // The reproduction, end to end. `victim` is a real 200 that a later,
    // entirely unrelated request resolves. A permanent record would bind it to
    // this error's 404 for as long as it lives, and that later request would
    // resolve with NotFoundError instead of a success — one lie about one
    // response corrupting a different, future request for the life of the
    // process.
    const victim = new Response(null, { status: 200, statusText: "OK" });
    const error = new NotFoundError(doubleCloningInto(victim));

    const copy = error.clone();

    // The loan still did its job: the copy inherits rather than re-reading.
    // That holds because `victim` carries no identity this library has already
    // read. A branch that DOES is a different case: `lendIdentity` refuses a
    // loan over a record, the copy reports the record, and the two errors
    // disagree. That refusal is the trade, because a loan that shadowed a
    // record would be the poisoning this whole group is about.
    expect(copy.message).toBe(error.message);

    const { response, error: later } = await typedFetch("https://victim.test/x", {
      fetch: async () => victim,
    });

    expect(later).toBeNull();
    expect(response?.status).toBe(200);

    await Promise.all([error.cancel(), copy.cancel()]);
  });

  test("BH-18: an error built from the branch afterwards reads the branch", async () => {
    // The same guard on the other table. `typedFetch` above exercises
    // `statusOf`; this exercises `identityOf`, which is the one the loan is
    // written into and the revoke takes back.
    const victim = new Response(null, { status: 200, statusText: "OK" });
    const error = new NotFoundError(doubleCloningInto(victim));

    const copy = error.clone();
    expect(copy.message).toBe(error.message);

    const later = new UnknownHttpError(victim);

    expect(later.status).toBe(200);
    expect(later.message).toBe("HTTP 200 OK");

    await Promise.all([error.cancel(), copy.cancel(), later.cancel()]);
  });

  test("BH-19: a REFUSED clone revokes the loan too", async () => {
    // The revoke lives in a `finally`, because every way out of the
    // construction is a way the loan must end. `DetachedHttpError` ignores the
    // branch and builds from its own response, so `clone()` releases the branch
    // and throws — and the branch must still be left as it was found.
    const victim = new Response(null, { status: 200, statusText: "OK" });
    const error = new NotFoundError(doubleCloningInto(victim));

    expect(() =>
      error.clone((branch) => new DetachedHttpError(branch) as unknown as NotFoundError),
    ).toThrowError(TypeError);

    const later = new UnknownHttpError(victim);

    expect(later.status).toBe(200);
    expect(later.message).toBe("HTTP 200 OK");

    await Promise.all([error.cancel(), later.cancel()]);
  });

  test("BH-20: a recreate callback that THROWS revokes the loan too", async () => {
    // The path that only the `finally` covers. BH-19 is refused AFTER the
    // callback returns, so the construction block completes and a revoke
    // written below the block would still run. Here the callback throws INSIDE
    // the block, which is the one exit a misplaced revoke misses — and the loan
    // would then outlive `clone()` for the life of the process, so every later
    // error built from the branch would report the double's 404 instead of the
    // branch's own 200.
    const victim = new Response(null, { status: 200, statusText: "OK" });
    const error = new NotFoundError(doubleCloningInto(victim));

    expect(() =>
      error.clone(() => {
        throw new Error("recreate refused to build");
      }),
    ).toThrowError(TypeError);

    const later = new UnknownHttpError(victim);

    expect(later.status).toBe(200);
    expect(later.message).toBe("HTTP 200 OK");

    await Promise.all([error.cancel(), later.cancel()]);
  });
});

// ---------------------------------------------------------------------------
// Test IDs are load-bearing. `src/errors/base-http-error.ts:472` cites one by
// ID ("BH-20 pins the path that only the `finally` covers"), so an ID that
// names two tests makes that reference ambiguous — and the reader has no way
// to tell which one the comment meant.
//
// `RI-18` and `RI-19` each named two different tests before this guard existed.
// ---------------------------------------------------------------------------
describe("test IDs", () => {
  test("no ID names two tests, in any spec file", () => {
    const specDir = new URL("./", import.meta.url);
    const specFiles = readdirSync(specDir)
      .filter((name) => name.endsWith(".spec.ts"))
      .toSorted();

    // The suite's own guard against a vacuous guard: a glob that matches
    // nothing would report perfect uniqueness.
    expect(specFiles.length).toBeGreaterThan(5);

    /** @see the `PREFIX-NN:` convention used by the sequenced describes. */
    const declaration = /\btest(?:\.each|\.skipIf)?\s*\(\s*[`"']([A-Z]{2}-\d+):/g;
    /** @type {Map<string, string[]>} */
    const owners = new Map();

    for (const file of specFiles) {
      const source = readFileSync(new URL(file, specDir), "utf8");
      for (const [, id] of source.matchAll(declaration)) {
        owners.set(id, [...(owners.get(id) ?? []), file]);
      }
    }

    // Same guard, one level down: a regex that stopped matching would also
    // report perfect uniqueness.
    expect(owners.size).toBeGreaterThan(50);

    const duplicated = [...owners]
      .filter(([, files]) => files.length > 1)
      .map(([id, files]) => `${id} (${files.join(", ")})`);

    expect(duplicated).toEqual([]);
  });
});
