import { describe, test, expect } from "vitest";
import { NotFoundError, UnknownHttpError } from "./src/errors";

describe("BaseHttpError.clone()", () => {
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
});
