import { createRequire } from "node:module";
import { Readable } from "node:stream";
import { describe, expect, test } from "vitest";
import { classifyResolvedValue } from "../../src/response-verdict";
import { InternalServerError } from "../../src/errors/internal-server-error";
import { NotFoundError } from "../../src/errors/not-found-error";
import { foreignResponses } from "../../fixtures/responses";
import type { BaseHttpError } from "../../src/errors/base-http-error";

// WHAT THE RESPONSE PHASE ACCEPTS, AND WHAT IT REFUSES.
//
// Every case here used to live in `tests/envelope/typed-fetch.spec.ts`, where
// it was driven by injecting a `fetch` that resolved the value, awaiting a
// promise, and reading the answer back out of the `{ response, error }`
// envelope. The decision has a name now, and the value is its argument:
// `classifyResolvedValue(value)`. CONTEXT.md states the rule this file follows
// — the interface is the test surface, and needing to test PAST an interface
// means the module is the wrong shape.
//
// The translation is mechanical and it is total. A refused value answered with
// a `NetworkError` whose `cause` was the refusal's; here it answers
// `{ kind: "refused", cause }`, and `src/index.ts` turns that into the
// `NetworkError` — pinned once, at
// `resolved-value-verdict.spec.ts`'s "each of the three verdicts reaches the
// caller as its own arm", rather than at every case below.
//
// What stayed behind in the envelope suite: anything that needs a real request
// (the live server's own 404s and 204s), the 40-class roster sweep, and the
// abort-window cases, where the subject is which PHASE a failure belongs to
// rather than what a value is.
//
// Sibling files: `resolved-value-verdict.spec.ts` is this module's interface
// tour; `response-identity-recording.spec.ts` owns the first-successful-read
// rule; `response-read-inventory.spec.ts` owns the read inventory as a closed
// set.

const URL_UNDER_TEST = "https://acceptance.test/resource";

/** A response-shaped foreign object that passes every structural check. */
const foreignResponse = foreignResponses(URL_UNDER_TEST);

type NodeFetchResponse = Response & { readonly body: Readable };

const nodeRequire = createRequire(import.meta.url);
const NodeFetchResponse = (
  nodeRequire("node-fetch") as {
    Response: new (
      body?: unknown,
      init?: { status?: number; headers?: Record<string, string> },
    ) => NodeFetchResponse;
  }
).Response;

/** The refusal's cause, with the verdict asserted rather than assumed. */
function refusalCause(value: unknown): unknown {
  const verdict = classifyResolvedValue(value);
  if (verdict.kind !== "refused") throw new Error(`expected a refusal, got ${verdict.kind}`);
  return verdict.cause;
}

/** The HTTP error a value earned, with the verdict asserted rather than assumed. */
function httpErrorFor(value: unknown): BaseHttpError {
  const verdict = classifyResolvedValue(value);
  if (verdict.kind !== "http") throw new Error(`expected an HTTP verdict, got ${verdict.kind}`);
  return verdict.error as unknown as BaseHttpError;
}

/** The accepted value, with the verdict asserted rather than assumed. */
function successFor(value: unknown): Response {
  const verdict = classifyResolvedValue(value);
  if (verdict.kind !== "success") throw new Error(`expected a success, got ${verdict.kind}`);
  return verdict.response;
}

/**
 * A body stream that is genuinely open, and that records the release.
 *
 * Every assertion about a released body needs one: a `new Response(null, …)`
 * has no stream, so `bodyUsed` stays `false` forever and a "the body was
 * released" assertion would be silently meaningless.
 */
function liveBody(): { stream: ReadableStream<Uint8Array>; cancelCalls: () => number } {
  let cancelCalls = 0;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("payload-that-is-still-open"));
    },
    cancel() {
      cancelCalls += 1;
    },
  });
  return { stream, cancelCalls: () => cancelCalls };
}

// ── What is not a Response at all ────────────────────────────────────────
//
// An injected fetch is outside the library's control. A value that is not a
// response must be refused rather than escape through the typed success branch
// — and the refusal must be a value, never a throw, because this module is
// total.

describe("a value that is not a Response", () => {
  test.each([
    ["undefined", undefined],
    ["an object with a status", { status: 404 }],
    ["a string", "not a response"],
    ["a bare object", {}],
    ["a spoofed Response tag", { status: 200, [Symbol.toStringTag]: "Response" }],
  ])("%s is refused, never a typed success", (_label, value) => {
    expect(refusalCause(value)).toBeInstanceOf(TypeError);
  });

  test("a structurally complete object with no Response tag is refused", () => {
    // The tag gate could be made to never refuse, and a plain object with the
    // whole surface then became a NotFoundError — or, on the success path, a
    // TypedResponse.
    const untagged: Record<string, unknown> = {
      body: null,
      bodyUsed: false,
      headers: new Headers(),
      ok: false,
      redirected: false,
      status: 404,
      statusText: "Not Found",
      type: "basic",
      url: `${URL_UNDER_TEST}/untagged`,
      arrayBuffer: async () => new ArrayBuffer(0),
      blob: async () => new Blob(),
      clone: () => untagged,
      formData: async () => new FormData(),
      json: async () => ({}),
      text: async () => "",
    };

    expect(refusalCause(untagged)).toBeInstanceOf(TypeError);
  });

  test("a Response-tagged double missing ok, redirected, and type is refused", () => {
    // The FOREIGN_RESPONSE_FIELDS presence gate. Without it a 404 double
    // missing three fields became a NotFoundError instead of a NetworkError.
    const partial: Record<string, unknown> = {
      [Symbol.toStringTag]: "Response",
      body: null,
      bodyUsed: false,
      headers: new Headers(),
      status: 404,
      statusText: "Not Found",
      url: `${URL_UNDER_TEST}/partial`,
      arrayBuffer: async () => new ArrayBuffer(0),
      blob: async () => new Blob(),
      clone: () => partial,
      formData: async () => new FormData(),
      json: async () => ({}),
      text: async () => "",
    };

    expect(refusalCause(partial)).toBeInstanceOf(TypeError);
  });

  test("a foreign Request shape is refused, not read as a Response", () => {
    // A `Request` carries `body`, `bodyUsed`, `headers`, `url`, and every read
    // method, so the member set has to be the one that separates it from a
    // response: it has no `status`, `statusText`, `ok`, or `redirected`.
    const requestShape = {
      body: null,
      bodyUsed: false,
      headers: new Headers(),
      method: "GET",
      url: URL_UNDER_TEST,
      arrayBuffer: async () => new ArrayBuffer(0),
      blob: async () => new Blob(),
      clone() {
        return this;
      },
      json: async () => ({}),
      text: async () => "",
      [Symbol.toStringTag]: "Response",
    };

    expect(refusalCause(requestShape)).toBeInstanceOf(TypeError);
  });

  test("a body that is a primitive is refused by isObjectLike's last arm", () => {
    expect(refusalCause(foreignResponse({ body: "not-a-stream" }))).toBeInstanceOf(TypeError);
  });

  test("headers that are a primitive are refused on the success surface", () => {
    expect(refusalCause(foreignResponse({ headers: "not-headers" }))).toBeInstanceOf(TypeError);
  });

  test("node-fetch@2 is refused and its Node stream is destroyed", async () => {
    const response = new NodeFetchResponse(Readable.from(["payload"]), { status: 404 });
    const stream = response.body;

    // Close the two obvious surface gaps so this regression reaches the body
    // compatibility check. A Node Readable must not become a typed WHATWG
    // Response merely because an adapter decorates the missing members.
    Object.defineProperties(response, {
      formData: {
        configurable: true,
        value: async () => new FormData(),
      },
      type: {
        configurable: true,
        value: "default",
      },
    });

    expect(refusalCause(response)).toBeInstanceOf(TypeError);
    expect(stream.destroyed).toBe(true);
  });
});

// ── The foreign success surface ──────────────────────────────────────────
//
// A standards-compatible Fetch polyfill is accepted, and the value crosses
// unmodified. `TypedResponse` is the promise the success arm makes, so every
// member the type names is a member the accepted value must carry.

describe("a foreign Response on the success path", () => {
  test("a standards-compatible foreign Response shape stays supported", async () => {
    const polyfill = foreignResponse({ json: async () => ({ source: "polyfill" }) });

    const accepted = successFor(polyfill);

    expect(accepted).toBe(polyfill);
    expect(await accepted.json()).toEqual({ source: "polyfill" });
  });

  test.each([
    ["bodyUsed", "false"],
    ["ok", "true"],
    ["redirected", 0],
    ["status", "200"],
    ["statusText", { text: "OK" }],
    ["type", "invalid"],
    ["url", new URL("https://polyfill.test/")],
  ])("an incompatible %s scalar never escapes as TypedResponse", (field, incompatibleValue) => {
    expect(refusalCause(foreignResponse({ [field]: incompatibleValue }))).toBeInstanceOf(TypeError);
  });

  test("a NaN status cannot bypass success-scalar validation", () => {
    // `ok` is the incompatible member; the NaN status is what carries the value
    // past the `status >= 400` dispatch and into the success-surface check.
    expect(
      refusalCause(foreignResponse({ ok: "true", status: Number.NaN, statusText: "Unknown" })),
    ).toBeInstanceOf(TypeError);
  });

  test.each([
    ["ok", "ok getter exploded"],
    ["bodyUsed", "bodyUsed getter exploded"],
  ])("a throwing %s getter remains the refusal's cause", (member, message) => {
    const cause = new Error(message);

    expect(
      refusalCause(
        foreignResponse({
          [member]: {
            get(): never {
              throw cause;
            },
          },
        }),
      ),
    ).toBe(cause);
  });

  test("a throwing headers getter remains the refusal's cause", () => {
    const cause = new Error("headers getter exploded");

    expect(
      refusalCause(
        foreignResponse({
          status: 404,
          statusText: "Not Found",
          ok: false,
          headers: {
            get(): never {
              throw cause;
            },
          },
        }),
      ),
    ).toBe(cause);
  });

  test.each(["cors", "opaque", "opaqueredirect", "default", "error", "basic"])(
    "a success whose response.type is %s is accepted, not refused",
    (type) => {
      // Node only ever produces `basic` and `default`, so `FOREIGN_RESPONSE_TYPES`
      // was asserted for those two alone. Blanking the `cors` member turned
      // EVERY genuine cross-origin success into an incompatible-surface
      // refusal — the widest blast radius in the file, invisible here.
      const response = new Response("{}", { status: 200 });
      Object.defineProperty(response, "type", { configurable: true, value: type });

      expect(successFor(response).type).toBe(type);
    },
  );

  test("a status of 399 is a success — the boundary is pinned from BELOW too", () => {
    // `400 → 401` was killed; `400 → 399` was not. Nothing asserted that the
    // largest status below the boundary stays on the success branch.
    expect(successFor(new Response("{}", { status: 399 })).status).toBe(399);
  });

  test("a runtime with no Response global still validates a foreign response", () => {
    const saved = globalThis.Response;
    // @ts-expect-error - an exotic runtime without the global
    delete globalThis.Response;
    try {
      expect(successFor(foreignResponse()).status).toBe(200);
    } finally {
      globalThis.Response = saved;
    }
  });

  test("a Response global with no status accessor still validates a foreign response", () => {
    const saved = globalThis.Response;
    // A polyfill whose prototype carries no `status` accessor at all.
    globalThis.Response = class PolyfillResponse {
      readonly polyfill = true;
    } as unknown as typeof Response;
    try {
      expect(successFor(foreignResponse()).status).toBe(200);
    } finally {
      globalThis.Response = saved;
    }
  });

  // `TypedResponse.headers` names the ambient `Headers`, so a member the type
  // promises must be a member the accepted value carries. `getSetCookie` is
  // therefore validated on the SUCCESS path. It has been on
  // `Headers.prototype` since Node 20.0.0, the package floor.
  test("a polyfill whose headers lack getSetCookie is refused", () => {
    const incomplete = new Headers({ "content-type": "application/json" });
    const withoutGetSetCookie = Object.create(incomplete) as object;
    Object.defineProperty(withoutGetSetCookie, "getSetCookie", { value: undefined });

    expect(refusalCause(foreignResponse({ headers: withoutGetSetCookie }))).toBeInstanceOf(
      TypeError,
    );
  });

  test("a complete polyfill still succeeds, and its headers keep the method", () => {
    const accepted = successFor(foreignResponse({ headers: new Headers({ "set-cookie": "a=1" }) }));

    expect(accepted.headers.getSetCookie()).toEqual(["a=1"]);
  });

  test("a refusal releases the visible inherited body, not an ancestor body", () => {
    let visibleCancelCalls = 0;
    let ancestorCancelCalls = 0;
    const visibleBody = new ReadableStream<Uint8Array>({
      cancel() {
        visibleCancelCalls += 1;
      },
    });
    const ancestorBody = new ReadableStream<Uint8Array>({
      cancel() {
        ancestorCancelCalls += 1;
      },
    });
    const ancestor = Object.create(null, {
      body: { configurable: true, get: () => ancestorBody },
    });
    const nearest = Object.create(ancestor, {
      body: { configurable: true, get: () => visibleBody },
    });
    // `ok` is the incompatible member, so the refusal happens on the success
    // surface — after the body has been accepted, which is the only state in
    // which a release has anything to release.
    const polyfill = Object.assign(Object.create(nearest) as object, {
      bodyUsed: false,
      headers: new Headers(),
      ok: "true",
      redirected: false,
      status: 200,
      statusText: "OK",
      type: "basic",
      url: URL_UNDER_TEST,
      arrayBuffer: async () => new ArrayBuffer(0),
      blob: async () => new Blob(),
      clone() {
        return this;
      },
      formData: async () => new FormData(),
      json: async () => ({}),
      text: async () => "",
      [Symbol.toStringTag]: "Response",
    });

    expect(refusalCause(polyfill)).toBeInstanceOf(TypeError);
    expect(visibleCancelCalls).toBe(1);
    expect(ancestorCancelCalls).toBe(0);
  });

  test("a foreign Response records its first successful headers read", async () => {
    const firstHeaders = new Headers({ "x-identity": "first" });
    const secondHeaders = new Headers({ "x-identity": "second" });
    let headerReads = 0;
    const polyfill = foreignResponse({
      status: 404,
      statusText: "Not Found",
      ok: false,
      headers: {
        get(): Headers {
          headerReads += 1;
          return headerReads === 1 ? firstHeaders : secondHeaders;
        },
      },
    });

    const error = httpErrorFor(polyfill);

    expect(error).toBeInstanceOf(NotFoundError);
    expect(error.headers.get("x-identity")).toBe("first");
    expect(headerReads).toBe(1);
    await error.cancel();
  });
});

// ── A platform Response with hostile own members ─────────────────────────
//
// An own accessor shadows the platform's prototype getter, which is what an
// instrumentation wrapper or a partial test double looks like from inside this
// library. A `Response` this library refuses is a `Response` no caller will
// ever hold, so its body has to be released here or it stays open with no
// owner.

describe("a platform Response whose own members were replaced", () => {
  test.each([
    ["bodyUsed", "false"],
    ["ok", "true"],
    ["redirected", 0],
    ["status", "200"],
    ["statusText", { text: "OK" }],
    ["type", "invalid"],
    ["url", new URL("https://platform.test/")],
  ])("an incompatible own %s scalar never escapes as TypedResponse", (field, incompatibleValue) => {
    const response = new Response(null, { status: 200 });
    Object.defineProperty(response, field, { configurable: true, value: incompatibleValue });

    expect(refusalCause(response)).toBeInstanceOf(TypeError);
  });

  test.each([
    ["body", {}],
    ["headers", null],
    ["json", null],
  ])("an incompatible own %s member never escapes as TypedResponse", (field, incompatibleValue) => {
    const response = new Response(null, { status: 200 });
    Object.defineProperty(response, field, { configurable: true, value: incompatibleValue });

    expect(refusalCause(response)).toBeInstanceOf(TypeError);
  });

  test("a replaced prototype never escapes as TypedResponse, and the body is released", () => {
    const { stream, cancelCalls } = liveBody();
    const response = new Response(stream, { status: 200 });
    const replacement = {};
    Object.setPrototypeOf(response, replacement);

    expect(refusalCause(response)).toBeInstanceOf(TypeError);
    expect(cancelCalls()).toBe(1);
    // The refusal is a check, never a membrane: the value is handed back
    // exactly as it arrived. ADR 0003, out-of-scope item 3.
    expect(Object.getPrototypeOf(response)).toBe(replacement);
  });

  test("a shadowed stream cancel still releases the body", () => {
    const { stream, cancelCalls } = liveBody();
    const response = new Response(stream, { status: 200 });
    const body = response.body;
    if (!body) throw new Error("expected a response body");
    Object.defineProperty(body, "cancel", { configurable: true, value: null });

    expect(refusalCause(response)).toBeInstanceOf(TypeError);
    expect(cancelCalls()).toBe(1);
  });

  test("an HTTP response with a broken reader never creates an unusable HTTP error", () => {
    const response = new Response(null, { status: 404 });
    Object.defineProperty(response, "json", { configurable: true, value: null });

    expect(refusalCause(response)).toBeInstanceOf(TypeError);
  });

  test.each([
    ["headers", "headers getter exploded"],
    ["url", "url getter exploded"],
    ["status", "status getter exploded"],
  ])("a throwing own %s getter remains the refusal's cause", (field, message) => {
    const cause = new Error(message);
    const response = new Response(null, { status: 404 });
    Object.defineProperty(response, field, {
      configurable: true,
      get(): never {
        throw cause;
      },
    });

    expect(refusalCause(response)).toBe(cause);
  });

  // The status reads were the last two response reads OUTSIDE a release guard.
  // A `status` getter that throws never reaches the error-class construction,
  // so the throw escaped with the body still open and no caller able to reach
  // it. The same two lines read `status` twice, so a getter that shifts could
  // pick a class for a status the branch was never taken on.
  test("a live body is released when the status getter throws, and status is read once", () => {
    const cause = new Error("status getter exploded");
    const { stream, cancelCalls } = liveBody();
    let statusReads = 0;
    const response = new Response(stream, { status: 404 });
    Object.defineProperty(response, "status", {
      configurable: true,
      get(): never {
        statusReads += 1;
        throw cause;
      },
    });

    expect(refusalCause(response)).toBe(cause);
    // `bodyUsed` proves the stream was disturbed; the counter proves the
    // release reached the underlying source as a cancel.
    expect(response.bodyUsed).toBe(true);
    expect(cancelCalls()).toBe(1);
    // A second read here would call a getter that has already reported it
    // cannot answer, and would report the second failure as the cause.
    expect(statusReads).toBe(1);
  });

  test("the error class keys on the status the branch was taken on", async () => {
    let reads = 0;
    const response = new Response(null, { status: 404 });
    Object.defineProperty(response, "status", {
      configurable: true,
      get() {
        reads += 1;
        return reads === 1 ? 404 : 500;
      },
    });

    // The 400 branch was taken because the first read said 404. Selecting the
    // class from a later read would answer 500, a status this call never saw.
    const error = httpErrorFor(response);
    expect(error).toBeInstanceOf(NotFoundError);
    expect(error).not.toBeInstanceOf(InternalServerError);
    await error.cancel();
  });

  test("a live body is released when constructing the HTTP error throws", () => {
    // Every other hostile-response case uses a NULL body, so none of them can
    // observe what happens to a live one. The refusal is caught and
    // reclassified, and the caller receives no handle to the body the network
    // already opened.
    const cause = new Error("headers getter exploded");
    const response = new Response("payload-that-is-still-open", { status: 404 });
    Object.defineProperty(response, "headers", {
      get(): never {
        throw cause;
      },
    });

    expect(refusalCause(response)).toBe(cause);
    expect(response.bodyUsed).toBe(true);
  });

  test("a failed release does not replace the original cause", () => {
    const cause = new Error("headers getter exploded");
    const releaseCause = new Error("body getter exploded");
    const response = new Response("payload-that-is-still-open", { status: 404 });
    const realBody = response.body;
    Object.defineProperty(response, "headers", {
      get(): never {
        throw cause;
      },
    });
    // The body must survive VALIDATION and fail during RELEASE, which is the
    // only arrangement that reaches the property under test. `isResponse`
    // checks the body's shape before it reads any identity field — it must not
    // file a status against a value it is still deciding on — so a getter that
    // threw on its first read would fail validation and become the reported
    // cause itself, never reaching the release path at all.
    let bodyReads = 0;
    Object.defineProperty(response, "body", {
      get() {
        bodyReads += 1;
        if (bodyReads > 1) throw releaseCause;
        return realBody;
      },
    });

    // Releasing is best effort, so its failure must not become the cause.
    expect(refusalCause(response)).toBe(cause);
  });
});
