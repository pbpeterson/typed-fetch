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

  test("json() on an empty body still rejects with the platform SyntaxError (B4: no swallowing)", async () => {
    const error = new NotFoundError(new Response("", { status: 404 }));
    await expect(error.json()).rejects.toThrowError(SyntaxError);
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

  test("subclasses cannot silently lose optional constructor state", () => {
    const error = new UnconfiguredContextHttpError(
      new Response("body", { status: 499 }),
      "tenant-42",
    );

    expect(() => error.clone()).toThrowError(/pass a recreate callback/);
    expect(error.context).toBe("tenant-42");
  });

  test("subclasses of built-in errors also require explicit recreation", () => {
    const error = new ContextNotFoundError(new Response("body", { status: 404 }), "tenant-42");

    expect(() => error.clone()).toThrowError(/pass a recreate callback/);

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

  test("clone() on a locked-but-unread body throws the clear TypeError (B6)", () => {
    const response = new Response("x", { status: 404 });
    // Acquire a reader BEFORE constructing: the stream is now locked but
    // bodyUsed is still false, the case a bodyUsed-only guard would miss.
    response.body?.getReader();
    const error = new NotFoundError(response);

    expect(error.clone).toBeDefined();
    expect(() => error.clone()).toThrowError(/already been read or its stream is locked/);
    expect(() => error.clone()).toThrowError(TypeError);
  });
});
