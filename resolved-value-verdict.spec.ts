import { describe, expect, test } from "vitest";
import { isKnownHttpError, isNetworkError, typedFetch } from "./src/index";
import { classifyResolvedValue } from "./src/response-verdict";
import { NotFoundError } from "./src/errors/not-found-error";
import { UnknownHttpError } from "./src/errors/unknown-http-error";

// The response phase's own interface.
//
// `classifyResolvedValue` answers one question — what is this value? — and it
// is total over the answer. Every behavior below used to need an injected
// transport, a promise, and the `{ response, error }` envelope to be observed,
// because the decision had no name of its own. The value is now the argument.
//
// The response-phase behaviors this repository already pins END TO END stay
// where they are. `response-seam-and-status.spec.ts`,
// `response-read-inventory.spec.ts` and `conformance.spec.ts` are about what a
// caller receives; this file is about the decision they all run through.

/** A structurally complete foreign `Response`, as a Fetch polyfill ships one. */
function foreignResponse(overrides: Record<string, unknown> = {}): unknown {
  const value: Record<PropertyKey, unknown> = {
    [Symbol.toStringTag]: "Response",
    body: null,
    bodyUsed: false,
    headers: new Headers({ "content-type": "application/json" }),
    ok: true,
    redirected: false,
    status: 200,
    statusText: "OK",
    type: "basic",
    url: "https://verdict.test/resource",
    arrayBuffer: async () => new ArrayBuffer(0),
    blob: async () => new Blob(),
    clone: () => value,
    formData: async () => new FormData(),
    json: async () => ({}),
    text: async () => "",
    ...overrides,
  };
  return value;
}

describe("what a resolved value becomes", () => {
  test("a platform Response below 400 is a success, and the same object", () => {
    const response = new Response("payload", { status: 200 });

    const verdict = classifyResolvedValue(response);

    expect(verdict.kind).toBe("success");
    // The value crosses unmodified. ADR 0003 out-of-scope item 3: this is a
    // check, not a membrane.
    if (verdict.kind === "success") expect(verdict.response).toBe(response);
  });

  test("a status of 400 or more selects the mapped class", async () => {
    const verdict = classifyResolvedValue(
      new Response("gone", { status: 404, statusText: "Not Found" }),
    );

    expect(verdict.kind).toBe("http");
    if (verdict.kind !== "http") throw new Error("expected an HTTP verdict");
    expect(verdict.error).toBeInstanceOf(NotFoundError);
    expect(isKnownHttpError(verdict.error)).toBe(true);
    expect([verdict.error.status, verdict.error.statusText]).toEqual([404, "Not Found"]);
    // The error owns the body now, so this test discharges it.
    await verdict.error.cancel();
  });

  test("a status outside the roster becomes UnknownHttpError, never a guess", async () => {
    const verdict = classifyResolvedValue(new Response(null, { status: 419 }));

    if (verdict.kind !== "http") throw new Error("expected an HTTP verdict");
    expect(verdict.error).toBeInstanceOf(UnknownHttpError);
    expect(verdict.error.status).toBe(419);
    await verdict.error.cancel();
  });

  test("a value that is not a Response is refused, with the reason as the cause", () => {
    const verdict = classifyResolvedValue(42);

    expect(verdict.kind).toBe("refused");
    if (verdict.kind !== "refused") throw new Error("expected a refusal");
    expect((verdict.cause as Error).message).toContain("not a Response");
  });

  test("a structurally complete foreign Response is accepted", () => {
    const value = foreignResponse();

    const verdict = classifyResolvedValue(value);

    expect(verdict.kind).toBe("success");
    if (verdict.kind === "success") expect(verdict.response as unknown).toBe(value);
  });

  test("a type outside the IDL enum is refused after the structural verdict passed", () => {
    // The ORDER is load-bearing. `isResponse` accepts this value, and the
    // success-surface check is what refuses it — so the refusal message names
    // the surface, not the structure.
    const verdict = classifyResolvedValue(foreignResponse({ type: "bogus" }));

    if (verdict.kind !== "refused") throw new Error("expected a refusal");
    expect((verdict.cause as Error).message).toContain("incompatible public surface");
  });

  test("the status dispatch runs BEFORE the success-surface check", async () => {
    // Both would refuse this value, and only one of them may. A response that
    // reports 404 while its `type` is outside the enum is an HTTP error: the
    // success surface is a promise about the SUCCESS arm, and an HTTP error is
    // never handed to a caller as a response.
    const verdict = classifyResolvedValue(
      foreignResponse({ status: 404, statusText: "Not Found", type: "bogus", ok: false }),
    );

    expect(verdict.kind).toBe("http");
    if (verdict.kind === "http") await verdict.error.cancel();
  });

  test("a refusal releases the body the network already opened", async () => {
    // The caller gets no handle to this response, so nothing else can release
    // it. An unreleased body keeps its connection open.
    const body = new Response("payload").body as ReadableStream<Uint8Array>;
    const verdict = classifyResolvedValue(foreignResponse({ body, type: "bogus" }));

    expect(verdict.kind).toBe("refused");
    expect(body.locked).toBe(false);
    await expect(body.getReader().read()).resolves.toEqual({ done: true, value: undefined });
  });

  test("a refused value has no identity filed against it", () => {
    // ADR 0003 row H-14, at the seam rather than through a request. The first
    // presentation is refused on `type`, which `isResponse` accepts; the second
    // presentation is an honest 404 and must be answered as one, not with the
    // 200 the refused call read.
    // `defineProperty`, never a spread: a spread would evaluate each accessor
    // once while it copied it, and the count is the subject.
    let presentations = 0;
    const value = foreignResponse({ statusText: "Not Found" }) as object;
    Object.defineProperty(value, "type", {
      get(): string {
        presentations += 1;
        return presentations === 1 ? "bogus" : "basic";
      },
      configurable: true,
    });
    Object.defineProperty(value, "status", {
      get: (): number => (presentations === 0 ? 200 : 404),
      configurable: true,
    });

    expect(classifyResolvedValue(value).kind).toBe("refused");

    const second = classifyResolvedValue(value);
    expect(second.kind).toBe("http");
    if (second.kind === "http") {
      expect(second.error.status).toBe(404);
      void second.error.cancel();
    }
  });
});

describe("the verdict is what the envelope carries", () => {
  test("each of the three verdicts reaches the caller as its own arm", async () => {
    // The seam is only worth having if the envelope is a projection of it.
    const success = await typedFetch("https://verdict.test/ok", {
      fetch: (async () => new Response(null, { status: 204 })) as unknown as typeof fetch,
    });
    expect(success.error).toBe(null);
    expect(success.response?.status).toBe(204);

    const http = await typedFetch("https://verdict.test/404", {
      fetch: (async () => new Response("gone", { status: 404 })) as unknown as typeof fetch,
    });
    expect(isKnownHttpError(http.error)).toBe(true);
    if (isKnownHttpError(http.error)) await http.error.cancel();

    const refused = await typedFetch("https://verdict.test/junk", {
      fetch: (async () => ({ status: 200 })) as unknown as typeof fetch,
    });
    expect(refused.response).toBe(null);
    expect(isNetworkError(refused.error)).toBe(true);
    // The refusal's cause reaches the caller, and the url is the plan's.
    expect((refused.error as unknown as { readonly url: string }).url).toBe(
      "https://verdict.test/junk",
    );
  });
});
