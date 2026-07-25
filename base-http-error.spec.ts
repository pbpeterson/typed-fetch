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
    const error = new NotFoundError(new Response("payload", { status: 404 }));

    expect(() =>
      error.clone(() => {
        throw new Error("recreate exploded");
      }),
    ).toThrowError(/recreate callback failed/);

    await expect(error.cancel()).resolves.toBeUndefined();
  });

  test("cancel() still settles after a response-only clone failure", async () => {
    // ContextHttpError's constructor rejects an empty context, so the
    // no-callback clone path throws — the case base-http-error.spec already
    // covers, now followed by the cleanup that used to hang.
    const error = new ContextHttpError(new Response("payload", { status: 499 }), "tenant-42");

    expect(() => error.clone()).toThrowError("context is required");

    await expect(error.cancel()).resolves.toBeUndefined();
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
