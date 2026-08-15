import { describe, expect, test } from "vitest";
import { NotFoundError } from "../../src/errors/not-found-error";

describe("agent 2 / round 1 focused probes", () => {
  test("clone() refuses an object-like branch that is not a Response", async () => {
    const response = new Response("payload", { status: 404 });
    const fakeBranch = {
      status: 404,
      statusText: "Not Found",
      url: "https://fake.invalid/branch",
      headers: new Headers(),
      body: null,
      bodyUsed: false,
    };
    Object.defineProperty(response, "clone", {
      configurable: true,
      value: () => fakeBranch,
    });

    const error = new NotFoundError(response);

    expect(() => error.clone()).toThrow(/instead of a Response/);
    await error.cancel();
  });
});
