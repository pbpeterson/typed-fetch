import { readFileSync } from "node:fs";
import { describe, test, expect } from "vitest";
import { inspect } from "node:util";
import {
  isAbortError,
  isHttpError,
  isKnownHttpError,
  isNetworkError,
  isTimeoutError,
  typedFetch,
} from "./src/index";
import {
  AbortedError,
  BaseHttpError,
  NetworkError,
  NotFoundError,
  TimeoutError,
  UnknownHttpError,
} from "./src/errors";
import { useTestServer } from "./fixtures/http-server";

const server = useTestServer();

/** An HTTP error built from a `Response` the test controls, through the envelope. */
async function httpErrorFrom(response: () => Response): Promise<BaseHttpError> {
  const { error } = await typedFetch(server.url(), { fetch: async () => response() });
  if (!isHttpError(error)) throw new Error(`expected an HTTP error, got ${String(error)}`);
  return error;
}

/** Fails loudly instead of hanging when a documented release promise is broken. */
async function settlesWithin(promise: Promise<unknown>, ms: number, label: string): Promise<void> {
  await Promise.race([
    promise,
    new Promise((_resolve, reject) =>
      setTimeout(() => reject(new Error(`${label} never settled`)), ms),
    ),
  ]);
}

/**
 * THE DOCUMENTED CLAIMS, EXECUTED.
 *
 * `check-docs` compiles every fenced TypeScript block, and `CONTRIBUTING.md`
 * states in full what that leaves open: "compilation is necessary, not
 * sufficient". A block can typecheck while the sentence above it describes
 * behaviour the code stopped having. Three of those had accumulated by round 4
 * — a `statusText` provenance rule with an unnamed exception, a security note
 * pointing at a mechanism version 2.0.1 removed, and a printed record from
 * before the reason phrase was quoted.
 *
 * Nothing here reads a document by LINE NUMBER. The proofs that found these
 * did, and an edit two paragraphs earlier silently moved them onto a different
 * sentence, where `indexOf` answered -1 and the assertion passed against an
 * empty string. Every case below matches on content.
 *
 * This file owns one contract: a claim a document makes is a claim the library
 * keeps. A test whose subject is the behaviour itself belongs with that
 * behaviour's own spec instead.
 */

const README = readFileSync(new URL("./README.md", import.meta.url), "utf8");
const BASE_HTTP_ERROR_SOURCE = readFileSync(
  new URL("./src/errors/base-http-error.ts", import.meta.url),
  "utf8",
);

/** The `Response` a document's own example describes. */
function documentedResponse(): Response {
  const response = new Response("{}", {
    status: 404,
    statusText: "Not Found",
    headers: { "content-type": "application/json" },
  });
  Object.defineProperty(response, "url", { value: "https://example.test/users/1" });
  return response;
}

describe("statusText provenance", () => {
  test("a dedicated class reports the library's canonical label, never the wire phrase", async () => {
    const response = new Response(null, { status: 404 });
    Object.defineProperty(response, "statusText", {
      value: "Ops Team Pager 555-0100",
      configurable: true,
    });
    const { error } = await typedFetch("https://example.test/x", { fetch: async () => response });

    expect(isHttpError(error)).toBe(true);
    expect((error as NotFoundError).statusText).toBe("Not Found");
    expect((error as NotFoundError).toJSON().statusText).toBe("Not Found");
    await (error as NotFoundError).cancel();
  });

  test("UnknownHttpError reports the origin's phrase, because it has no label to give", () => {
    const response = new Response(null, { status: 499 });
    Object.defineProperty(response, "statusText", {
      value: "Ops Team Pager 555-0100",
      configurable: true,
    });
    const error = new UnknownHttpError(response);

    expect(error.statusText).toBe("Ops Team Pager 555-0100");
    expect(error.toJSON().statusText).toBe("Ops Team Pager 555-0100");
  });

  test("both documents name that exception where they state the rule", () => {
    // The reference sections used to say the label is always the library's,
    // which made `UnknownHttpError.statusText` the `rawStatusText` field the
    // non-goals list says the package does not have.
    const statedInReadme = README.slice(README.indexOf("`statusText` does not copy"));
    expect(statedInReadme.slice(0, 600)).toContain("UnknownHttpError");

    const jsdoc = BASE_HTTP_ERROR_SOURCE.slice(
      BASE_HTTP_ERROR_SOURCE.indexOf("The library's canonical protocol label"),
    );
    expect(jsdoc.slice(0, 700)).toContain("UnknownHttpError");
  });
});

describe("a request failure's message", () => {
  test("NetworkError carries the library constant, and the platform text stays on cause", async () => {
    const { error } = await typedFetch("https://alice:hunter2@example.invalid/x");

    expect(error?.name).toBe("NetworkError");
    expect(error?.message).toBe("Network error");
    expect((error as NetworkError).cause).toBeInstanceOf(TypeError);
  });

  test("the README no longer claims the library copies that message", () => {
    // Version 2.0.1 made every request-failure message a library constant, and
    // this paragraph still described the removed mechanism as a defence.
    expect(README).not.toContain("`NetworkError` copies its message from the platform rejection");
    expect(README).toContain("`NetworkError.message` is a library constant");
  });
});

describe("the printed error record", () => {
  const RECORD_HEAD = '{"name":"NotFoundError"';

  /** The `"message":"…"` field exactly as `JSON.stringify` writes it. */
  function messageField(): string {
    const error = new NotFoundError(documentedResponse());
    const record = JSON.stringify(error);
    const start = record.indexOf('"message":');
    const end = record.indexOf(',"status"');
    return record.slice(start, end);
  }

  test.each([
    ["README.md", () => README],
    ["src/errors/base-http-error.ts", () => BASE_HTTP_ERROR_SOURCE],
  ])("%s prints the record the code produces", async (_name, source) => {
    const text = source();
    expect(text).toContain(RECORD_HEAD);
    expect(text).toContain(messageField());

    // And the example is honest about the rest of the record, not only the
    // message: a printed record nobody executes drifts one field at a time.
    const error = new NotFoundError(documentedResponse());
    try {
      expect(error.toJSON()).toEqual({
        name: "NotFoundError",
        message: error.message,
        status: 404,
        statusText: "Not Found",
        url: "https://example.test/users/1",
        headers: ["content-type"],
      });
    } finally {
      await error.cancel();
    }
  });
});

describe("what a refused body operation does", () => {
  test("the four readers reject and clone throws, which is what the README now says", async () => {
    const impostor = Object.create(NotFoundError.prototype) as NotFoundError;

    await expect(impostor.json()).rejects.toBeInstanceOf(TypeError);
    await expect(impostor.text()).rejects.toBeInstanceOf(TypeError);
    await expect(impostor.blob()).rejects.toBeInstanceOf(TypeError);
    await expect(impostor.arrayBuffer()).rejects.toBeInstanceOf(TypeError);
    // SYNCHRONOUS, because `tee()` is. A `try`/`catch` written from the old
    // wording sat around an `await` that never happened.
    expect(() => impostor.clone()).toThrow(TypeError);

    expect(README).toContain("`clone()` throws for the same reason");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// THE CLAIMS THAT VERIFIED.
//
// Round 4 enumerated every behavioural claim in the README, both skill files,
// SECURITY.md, the current CHANGELOG sections, and the public JSDoc, then
// executed each one. The three that disagreed with the code are the blocks
// above. These are the rest, kept so the next pass starts from "the docs were
// executed" rather than from the beginning.
// ═══════════════════════════════════════════════════════════════════════════

describe("CONTROLS — the envelope and the guards", () => {
  test("README:113 a success is { response, error: null } and a failure is { response: null, error }", async () => {
    const ok = await typedFetch(server.url({ status: 200, body: '{"a":1}' }));
    expect(ok.error).toBe(null);
    expect(ok.response).not.toBe(null);
    await ok.response?.body?.cancel();

    const bad = await typedFetch(server.url({ status: 404 }));
    expect(bad.response).toBe(null);
    expect(bad.error).not.toBe(null);
    if (isHttpError(bad.error)) await bad.error.cancel();
  });

  test("README:483 typedFetch resolves the failure; it never rejects, even for a broken options object", async () => {
    const { error } = await typedFetch(server.url(), null as never);
    expect(isNetworkError(error)).toBe(true);
    // The setup phase files the url from the INPUT before it reads `options`.
    expect((error as NetworkError).url).toContain("http://localhost:");
  });

  test("README:170-176 the request-failure decision table: each condition reaches its guard", async () => {
    const known = await typedFetch(server.url({ status: 404 }));
    expect(isKnownHttpError(known.error)).toBe(true);
    expect(isHttpError(known.error)).toBe(true);
    if (isHttpError(known.error)) await known.error.cancel();

    const unknown = await httpErrorFrom(() => new Response("x", { status: 420 }));
    expect(unknown).toBeInstanceOf(UnknownHttpError);
    expect(isKnownHttpError(unknown)).toBe(false);
    expect(isHttpError(unknown)).toBe(true);
    expect((unknown as UnknownHttpError).status).toBe(420);
    await unknown.cancel();

    const network = await typedFetch("https://unreachable.invalid/x");
    expect(isNetworkError(network.error)).toBe(true);
  });

  test("README:49/575 AbortedError and TimeoutError are not NetworkError", async () => {
    const controller = new AbortController();
    const aborting = typedFetch(server.url({ delay: 200 }), { signal: controller.signal });
    controller.abort();
    const { error: aborted } = await aborting;
    expect(isAbortError(aborted)).toBe(true);
    expect(isNetworkError(aborted)).toBe(false);

    const { error: timedOut } = await typedFetch(server.url({ delay: 300 }), {
      signal: AbortSignal.timeout(20),
    });
    expect(isTimeoutError(timedOut)).toBe(true);
    expect(isNetworkError(timedOut)).toBe(false);
  });

  test("README:1125 / public skill:108 error.url is present on every member of the union", async () => {
    const failures = [
      (await typedFetch(server.url({ status: 404 }))).error,
      await httpErrorFrom(() => new Response("x", { status: 420 })),
      (await typedFetch("https://unreachable.invalid/x")).error,
      new AbortedError(),
      new TimeoutError(),
    ];
    for (const error of failures) {
      expect(typeof error?.url).toBe("string");
      if (isHttpError(error)) await error.cancel();
    }
    // README:1129 — the empty string when no URL could be resolved.
    expect(new NetworkError().url).toBe("");
  });

  test("README:207/209/211 status 0 stays on the success branch and an opaque body reads as empty", async () => {
    const { response, error } = await typedFetch(server.url(), {
      fetch: async () => Response.error(),
    });
    expect(error).toBe(null);
    expect(response?.status).toBe(0);
    expect(response?.ok).toBe(false);
    expect(response?.type).toBe("error");
    await expect(response!.text()).resolves.toBe("");

    const second = await typedFetch(server.url(), { fetch: async () => Response.error() });
    await expect(second.response!.json()).rejects.toThrow(SyntaxError);
  });

  test("maintainer skill:83 a 3xx with redirect: manual is a success", async () => {
    const { response, error } = await typedFetch(
      `${server.url({ status: 302 })}&header=Location:/next`,
      { redirect: "manual" },
    );
    expect(error).toBe(null);
    expect(response?.status).toBe(302);
    expect(response?.redirected).toBe(false);
    await response?.body?.cancel();
  });
});

describe("CONTROLS — the error record and the disclosure channels", () => {
  test("README:237 Object.keys on an HTTP error returns name, status, statusText", async () => {
    const error = await httpErrorFrom(() => new Response("x", { status: 404 }));
    try {
      expect(Object.keys(error)).toEqual(["name", "status", "statusText"]);
    } finally {
      await error.cancel();
    }
  });

  test("README:1023 the HTTP error record is { name, message, status, statusText, url, headers }", async () => {
    const error = await httpErrorFrom(
      () => new Response("x", { status: 404, headers: { "content-type": "text/plain" } }),
    );
    try {
      expect(Object.keys(error.toJSON())).toEqual([
        "name",
        "message",
        "status",
        "statusText",
        "url",
        "headers",
      ]);
      expect(error.toJSON().headers).toEqual(["content-type"]);
    } finally {
      await error.cancel();
    }
  });

  test("README:1039/1051 the record holds header NAMES, one per set-cookie, others combined", async () => {
    const error = await httpErrorFrom(
      () =>
        new Response("x", {
          status: 404,
          headers: [
            ["set-cookie", "session=SECRET-A"],
            ["set-cookie", "csrf=SECRET-B"],
            ["warning", "w1"],
            ["warning", "w2"],
          ],
        }),
    );
    try {
      const record = error.toJSON();
      expect(record.headers.filter((name) => name === "set-cookie")).toHaveLength(2);
      expect(record.headers.filter((name) => name === "warning")).toHaveLength(1);
      expect(JSON.stringify(record)).not.toContain("SECRET-A");
      // README:1051 — read the values through the escape hatch.
      expect(error.headers.getSetCookie()).toEqual(["session=SECRET-A", "csrf=SECRET-B"]);
      expect(error.headers.get("warning")).toBe("w1, w2");
    } finally {
      await error.cancel();
    }
  });

  test("README:999 error.headers is a COPY; a write through it never reaches the response", async () => {
    const response = new Response("x", { status: 404, headers: { "x-a": "1" } });
    const error = new NotFoundError(response);
    try {
      error.headers.set("x-a", "2");
      expect(response.headers.get("x-a")).toBe("1");
      expect(error.headers.get("x-a")).toBe("2");
    } finally {
      await error.cancel();
    }
  });

  test("README:233/1175 headers, url, cause and reason are non-enumerable, readable and writable", async () => {
    const error = await httpErrorFrom(() => new Response("x", { status: 404 }));
    try {
      expect(Object.keys(error)).not.toContain("url");
      expect(Object.keys(error)).not.toContain("headers");
      expect(Object.getOwnPropertyDescriptor(error, "url")?.writable).toBe(true);
      expect(Object.getOwnPropertyDescriptor(error, "headers")?.writable).toBe(true);
    } finally {
      await error.cancel();
    }

    const aborted = new AbortedError("Request aborted", { cause: new Error("c"), reason: 42 });
    expect(Object.keys(aborted)).toEqual(["name"]);
    expect("cause" in aborted).toBe(true);
    expect("reason" in aborted).toBe(true);
    expect(aborted.reason).toBe(42);
    expect(JSON.stringify(aborted)).not.toContain("reason");
  });

  test("README:1165 cause and reason become own properties only when the key is present", () => {
    const bare = new NetworkError();
    expect("cause" in bare).toBe(false);
    expect(bare.url).toBe("");
    const withCause = new NetworkError("Network error", { cause: 1 });
    expect(Object.hasOwn(withCause, "cause")).toBe(true);
    expect(Object.hasOwn(new AbortedError(), "reason")).toBe(false);
  });

  test("README:1133/1169 the three pre-response classes: default messages and { name, message, url } record", () => {
    expect(new NetworkError().message).toBe("Network error");
    expect(new AbortedError().message).toBe("Request aborted");
    expect(new TimeoutError().message).toBe("Request timed out");
    for (const error of [new NetworkError(), new AbortedError(), new TimeoutError()]) {
      expect(Object.keys(error.toJSON())).toEqual(["name", "message", "url"]);
    }
  });

  test("README:581/1041 the record's url keeps the origin and path and drops userinfo, query and fragment", () => {
    const error = new NetworkError("Network error", {
      url: "https://alice:hunter2@api.test/v1/users?access_token=SECRET#frag",
    });
    expect(error.toJSON().url).toBe("https://api.test/v1/users");
    // README:1045 — the full href stays on the escape hatch.
    expect(error.url).toContain("access_token=SECRET");
  });

  test("README:583 a request failure's message is a library constant, not the platform's text", async () => {
    const { error } = await typedFetch("https://alice:hunter2@example.invalid/x?token=SECRET");
    expect(error?.message).toBe("Network error");
    expect(JSON.stringify(error)).not.toContain("hunter2");
    expect(JSON.stringify(error)).not.toContain("SECRET");
    // README:586 — the platform error stays reachable, unmodified.
    expect(String((error as NetworkError).cause)).toContain("hunter2");
  });

  test("README:1059/1061 the inspect hook prints the stack and the toJSON record, signposting cause and reason", () => {
    const printed = inspect(
      new AbortedError("Request aborted", {
        cause: new TypeError("local 127.0.0.1:1234"),
        reason: new Error("route change"),
        url: "https://api.test/v1?token=SECRET",
      }),
    );
    expect(printed).toContain("AbortedError: Request aborted");
    expect(printed).toContain("[not shown - read error.cause]");
    expect(printed).toContain("[not shown - read error.reason]");
    expect(printed).not.toContain("SECRET");
    expect(printed).not.toContain("127.0.0.1");
    expect(printed).toContain("https://api.test/v1");
  });

  test("README:997 a KNOWN class keeps its canonical statusText and puts the wire phrase in message", async () => {
    const error = await httpErrorFrom(
      () => new Response("x", { status: 404, statusText: "Totally Missing" }),
    );
    try {
      expect(error.statusText).toBe("Not Found");
      expect(error.toJSON().statusText).toBe("Not Found");
      expect(error.message).toContain("Totally Missing");
    } finally {
      await error.cancel();
    }
  });
});

describe("CONTROLS — the body lifecycle", () => {
  test("README:479 a second read rejects with TypeError, and so does a read behind an external reader", async () => {
    const error = await httpErrorFrom(() => new Response('{"a":1}', { status: 404 }));
    await error.json();
    await expect(error.text()).rejects.toThrow(TypeError);

    const response = new Response("hello", { status: 404 });
    const locked = new NotFoundError(response);
    const reader = response.body!.getReader();
    await expect(locked.text()).rejects.toThrow(TypeError);
    reader.releaseLock();
    await locked.cancel();
  });

  test("README:481 an empty or non-JSON body makes json() reject with SyntaxError", async () => {
    const error = await httpErrorFrom(() => new Response("<html>nope</html>", { status: 500 }));
    await expect(error.json()).rejects.toThrow(SyntaxError);
  });

  test("README:502-506 cancel() resolves for no body, an external read, and a failed stream", async () => {
    await new NotFoundError(new Response(null, { status: 404 })).cancel();

    const read = new Response("hello", { status: 404 });
    const afterExternalRead = new NotFoundError(read);
    await read.text();
    await afterExternalRead.cancel();

    const failed = new NotFoundError(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error("truncated"));
          },
        }),
        { status: 404 },
      ),
    );
    await settlesWithin(failed.cancel(), 500, "cancel() on a failed stream");
  });

  test("README:508-511 cancel() rejects only for an external reader lock and for a body-less error", async () => {
    const response = new Response("hello", { status: 404 });
    const error = new NotFoundError(response);
    const reader = response.body!.getReader();
    await expect(error.cancel()).rejects.toThrow(TypeError);
    reader.releaseLock();
    await error.cancel();

    const impostor = Object.create(BaseHttpError.prototype) as BaseHttpError;
    await expect(impostor.cancel()).rejects.toThrow(TypeError);
    await expect(impostor.json()).rejects.toThrow(TypeError);
    await expect(impostor.blob()).rejects.toThrow(TypeError);
    await expect(impostor.arrayBuffer()).rejects.toThrow(TypeError);
  });

  test("README:513 a repeated cancel() settles with the first call", async () => {
    const error = new NotFoundError(new Response("x", { status: 404 }));
    await Promise.all([error.cancel(), error.cancel(), error.cancel()]);
  });

  test("README:517 after a cancel the readers reject and clone() throws", async () => {
    const error = await httpErrorFrom(() => new Response("x", { status: 404 }));
    await error.cancel();
    await expect(error.text()).rejects.toThrow(TypeError);
    expect(() => error.clone()).toThrow(TypeError);
  });

  test("README:523-556 clone() tees: one cancel stays pending, never cancels the sibling", async () => {
    const error = await httpErrorFrom(() => new Response('{"a":1}', { status: 404 }));
    const copy = error.clone();

    let settled = false;
    const cancelling = error.cancel().then(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(settled).toBe(false);

    // README:556 — cancelling one branch never cancels the other.
    await expect(copy.text()).resolves.toBe('{"a":1}');
    await settlesWithin(cancelling, 500, "cancel() after the sibling was released");
    expect(settled).toBe(true);
  });

  test("README:1101-1108 clone() refuses five callback results, releasing the branch each time", async () => {
    const shapes: readonly [string, (response: Response) => unknown][] = [
      ["a non-object (null)", () => null],
      ["a non-object (undefined)", () => undefined],
      ["a non-object (string)", () => "s"],
      ["a non-object (number)", () => 1],
      ["a wrapper claiming this copy", (response) => new Proxy(new NotFoundError(response), {})],
      ["a copy that cannot confirm the branch", () => Object.create(null)],
    ];
    for (const [label, recreate] of shapes) {
      const error = await httpErrorFrom(() => new Response("b", { status: 404 }));
      expect(() => error.clone(recreate as never), label).toThrow(TypeError);
      // README:1112 — a refused clone releases the orphaned branch first.
      await settlesWithin(error.cancel(), 500, `cancel() after a clone refused ${label}`);
    }

    // The same error, and an error built from a DIFFERENT response.
    const sameError = await httpErrorFrom(() => new Response("b", { status: 404 }));
    expect(() => sameError.clone(() => sameError as never)).toThrow(TypeError);
    await settlesWithin(sameError.cancel(), 500, "cancel() after a same-error clone");

    const otherError = await httpErrorFrom(() => new Response("b", { status: 404 }));
    let stranger: NotFoundError | undefined;
    expect(() =>
      otherError.clone(() => {
        stranger = new NotFoundError(new Response("z", { status: 404 }));
        return stranger as never;
      }),
    ).toThrow(TypeError);
    await stranger?.cancel();
    await settlesWithin(otherError.cancel(), 500, "cancel() after a different-response clone");
  });

  test("README:1114 clone() wraps a callback failure; the no-callback form rethrows verbatim", async () => {
    const error = await httpErrorFrom(() => new Response("b", { status: 404 }));
    let wrapped: unknown;
    try {
      error.clone(() => {
        throw new RangeError("boom");
      });
    } catch (caught) {
      wrapped = caught;
    }
    expect(wrapped).toBeInstanceOf(TypeError);
    expect((wrapped as Error).cause).toBeInstanceOf(RangeError);
    await settlesWithin(error.cancel(), 500, "cancel() after a throwing recreate callback");

    class Strict extends BaseHttpError {
      override readonly name = "Strict" as const;
      readonly status = 499 as const;
      readonly statusText = "Strict" as const;
      constructor(
        response: Response,
        readonly tenant?: string,
      ) {
        super(response);
        if (tenant === undefined) throw new RangeError("tenant is required");
      }
    }
    const subclass = new Strict(new Response("b", { status: 499 }), "acme");
    expect(() => subclass.clone()).toThrow(RangeError);
    await settlesWithin(subclass.cancel(), 500, "cancel() after a throwing subclass constructor");
  });

  test("README:392/374 the success response is handed back unmodified and carries no cancel()", async () => {
    const response = new Response("ok", { status: 200 });
    const result = await typedFetch(server.url(), { fetch: async () => response });
    expect(result.response).toBe(response as unknown);
    expect("cancel" in (result.response as object)).toBe(false);
    await response.body?.cancel();
  });
});

describe("CONTROLS — abort, timeout and the transport seam", () => {
  test("README:644 an options signal has priority over a Request's signal", async () => {
    const requestSignal = new AbortController();
    const optionsSignal = new AbortController();
    const request = new Request(server.url({ delay: 200 }), { signal: requestSignal.signal });
    const pending = typedFetch(request, { signal: optionsSignal.signal });
    optionsSignal.abort(new Error("options-signal"));
    const { error } = await pending;
    expect(isAbortError(error)).toBe(true);
    expect(String((error as AbortedError).reason)).toContain("options-signal");
  });

  test("README:646 signal: null detaches a Request's signal", async () => {
    const controller = new AbortController();
    const request = new Request(server.url({ delay: 60 }), { signal: controller.signal });
    const pending = typedFetch(request, { signal: null });
    controller.abort(new Error("detached"));
    const { response, error } = await pending;
    expect(error).toBe(null);
    await response?.body?.cancel();
  });

  test("README:653 an unrelated failure while the signal is aborted stays a NetworkError", async () => {
    const controller = new AbortController();
    controller.abort();
    const { error } = await typedFetch(server.url(), {
      method: "CONNECT",
      signal: controller.signal,
    });
    expect(isNetworkError(error)).toBe(true);
    expect(isAbortError(error)).toBe(false);
  });

  test("README:657 a rejection named AbortError stays a NetworkError when no signal aborted", async () => {
    const { error } = await typedFetch(server.url(), {
      fetch: async () => {
        throw new DOMException("nope", "AbortError");
      },
    });
    expect(isNetworkError(error)).toBe(true);
    expect(isAbortError(error)).toBe(false);
  });

  test("README:682/684 error.reason is the exact abort value; a bare abort supplies a DOMException", async () => {
    const reason = new Error("route change");
    const controller = new AbortController();
    const pending = typedFetch(server.url({ delay: 200 }), { signal: controller.signal });
    controller.abort(reason);
    const { error } = await pending;
    expect(isAbortError(error)).toBe(true);
    expect((error as AbortedError).reason).toBe(reason);

    const bare = new AbortController();
    const barePending = typedFetch(server.url({ delay: 200 }), { signal: bare.signal });
    bare.abort();
    const { error: bareError } = await barePending;
    expect((bareError as AbortedError).reason).toBeInstanceOf(DOMException);
    expect(((bareError as AbortedError).reason as DOMException).name).toBe("AbortError");
  });

  test("README:706-710 a timeout needs a DOMException named TimeoutError; a plain Error stays an abort", async () => {
    const plain = new Error("t");
    plain.name = "TimeoutError";
    const controller = new AbortController();
    const pending = typedFetch(server.url({ delay: 200 }), { signal: controller.signal });
    controller.abort(plain);
    const { error } = await pending;
    expect(isAbortError(error)).toBe(true);
    expect(isTimeoutError(error)).toBe(false);
    expect((error as AbortedError).reason).toBe(plain);

    // README:710 — the reason is consulted first, so a custom implementation
    // that rejects with its own AbortError is still a timeout.
    const { error: viaCustomFetch } = await typedFetch(server.url(), {
      signal: AbortSignal.timeout(10),
      fetch: async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        throw new DOMException("aborted", "AbortError");
      },
    });
    expect(isTimeoutError(viaCustomFetch)).toBe(true);
  });

  test("README:738 AbortSignal.any: a manual abort is an abort and the deadline is a timeout", async () => {
    const controller = new AbortController();
    const manual = typedFetch(server.url({ delay: 300 }), {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
    });
    controller.abort(new Error("route change"));
    expect(isAbortError((await manual).error)).toBe(true);

    const { error } = await typedFetch(server.url({ delay: 300 }), {
      signal: AbortSignal.any([new AbortController().signal, AbortSignal.timeout(20)]),
    });
    expect(isTimeoutError(error)).toBe(true);
  });

  test("README:597/137 an invalid URL and a forbidden method are NetworkError", async () => {
    const relative = await typedFetch("/api/users");
    expect(isNetworkError(relative.error)).toBe(true);
    expect((relative.error as NetworkError).url).toBe("/api/users");
    expect(String((relative.error as NetworkError).cause)).toContain("Failed to parse URL");

    const connect = await typedFetch(server.url(), { method: "CONNECT" });
    expect(isNetworkError(connect.error)).toBe(true);
  });

  test("README:782 a fetch override on the prototype chain is ignored", async () => {
    let called = false;
    const prototype = {
      fetch: async () => {
        called = true;
        return new Response("x", { status: 404 });
      },
    };
    const options = Object.create(prototype) as Record<string, unknown>;
    const { response, error } = await typedFetch(server.url({ status: 200 }), options);
    expect(called).toBe(false);
    expect(error).toBe(null);
    await response?.body?.cancel();
  });

  test("README:828 a partial test double resolves with a NetworkError whose cause is a TypeError", async () => {
    const { error } = await typedFetch(server.url(), {
      fetch: async () => ({ status: 404, ok: false }) as unknown as Response,
    });
    expect(isNetworkError(error)).toBe(true);
    expect((error as NetworkError).cause).toBeInstanceOf(TypeError);
  });

  test("README:1017 each dedicated class carries a static status and statusText", () => {
    expect(NotFoundError.status).toBe(404);
    expect(NotFoundError.statusText).toBe("Not Found");
    expect(new NotFoundError(new Response(null, { status: 404 })).status).toBe(
      NotFoundError.status,
    );
  });
});
