import { describe, expect, test } from "vitest";
import { isKnownHttpError } from "../../src/index";
import { classifyResolvedValue } from "../../src/response-verdict";
import { BaseHttpError } from "../../src/errors/base-http-error";
import { InternalServerError } from "../../src/errors/internal-server-error";
import { NotFoundError } from "../../src/errors/not-found-error";
import { UnknownHttpError } from "../../src/errors/unknown-http-error";
import { foreignResponses } from "../../fixtures/responses";

// ── The response identity is read ONCE ───────────────────────────────────
//
// `status`, `statusText`, and `url` used to be read several times along one
// error-construction path, by three modules that never compared notes. For a
// real `Response` every read agrees, so nothing was visibly wrong. For an
// INJECTED `fetch` — the seam this library documents and invites a consumer to
// use — a getter may answer differently on a second read, and the reads
// disagreed: the class was selected on one value, the message reported a
// second, and `error.status` reported a third.
//
// Every test below counts the reads. An assertion on the value alone would pass
// against code that reads three times and happens to agree, which is exactly
// the code this suite is here to keep out.
//
// THE `TF-NN` PREFIXES ARE IDs, and `base-http-error.spec.ts`'s "no ID names
// two tests" guard treats them as such: a comment in `src/` may cite one, so an
// ID that names two tests makes that reference ambiguous. They travelled with
// the cases from `tests/envelope/typed-fetch.spec.ts` and keep their numbers.
// The DESCRIBES around them are named by subject, which is the scheme `bd90e09`
// applied to the file names.
//
// This whole block used to drive `typedFetch` with an injected transport that
// resolved the prepared response, and read the answer back out of the
// `{ response, error }` envelope. The decision has a name — the RESPONSE phase,
// `classifyResolvedValue` — and the prepared response is its argument, so none
// of that machinery is needed to observe it. A refused value answers
// `{ kind: "refused", cause }`; that `src/index.ts` turns a refusal into a
// `NetworkError` carrying the same cause is pinned once, in
// `resolved-value-verdict.spec.ts`.
//
// The live-request counterparts stay in `tests/envelope/typed-fetch.spec.ts`:
// the 40-class roster sweep against the real server, and the 404 whose `url`
// names a server a request actually reached.

/** Wrap a value so the cycling accessor THROWS it instead of returning it. */
class ThrowOnRead {
  constructor(readonly value: unknown) {}
}

const rethrowing = (value: unknown) => new ThrowOnRead(value);

/**
 * A `Response` whose ONE named identity accessor answers with the next value of
 * a list, holding the last value once the list runs out, and counts its reads.
 *
 * Built with `Object.defineProperty` on a real `Response`: an own accessor
 * shadows the platform's prototype getter, which is exactly what an
 * instrumentation wrapper or a partial test double looks like from inside this
 * library.
 */
function cyclingResponse(
  field: "status" | "statusText" | "url" | "headers",
  values: readonly unknown[],
  init?: ResponseInit,
  body: BodyInit | null = null,
): { response: Response; reads: () => number } {
  const response = new Response(body, init);
  let reads = 0;
  Object.defineProperty(response, field, {
    configurable: true,
    get() {
      const value = values[Math.min(reads, values.length - 1)];
      reads += 1;
      if (value instanceof ThrowOnRead) throw value.value;
      return value;
    },
  });
  return { response, reads: () => reads };
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

/**
 * The four-way agreement, asserted in one place: the status the branch was
 * taken on, `error.status`, the number in `error.message`, and
 * `error.toJSON().status`. One response has one identity, so all four are the
 * same value.
 */
function expectIdentityAgrees(error: BaseHttpError, status: number): void {
  expect(error.status).toBe(status);
  expect(error.message.startsWith(`HTTP ${status}`)).toBe(true);
  expect(error.toJSON().status).toBe(status);
}

/** The HTTP error a value earned, with the verdict asserted rather than assumed. */
function httpErrorFor(value: unknown): BaseHttpError {
  const verdict = classifyResolvedValue(value);
  if (verdict.kind !== "http") throw new Error(`expected an HTTP verdict, got ${verdict.kind}`);
  return verdict.error as unknown as BaseHttpError;
}

/** The refusal's cause, with the verdict asserted rather than assumed. */
function refusalCause(value: unknown): unknown {
  const verdict = classifyResolvedValue(value);
  if (verdict.kind !== "refused") throw new Error(`expected a refusal, got ${verdict.kind}`);
  return verdict.cause;
}

describe("the first successful identity read fixes what every channel reports", () => {
  test("TF-01: the reported cycle 420 -> 200 -> 201 gives one answer, not three", async () => {
    const { response, reads } = cyclingResponse("status", [420, 200, 201], {
      status: 200,
      statusText: "Weird",
    });

    const error = httpErrorFor(response);

    expect(error).toBeInstanceOf(UnknownHttpError);
    expectIdentityAgrees(error, 420);
    expect(error.message.startsWith('HTTP 420 "Weird"')).toBe(true);
    // The class was selected on 420. Before the fix the message said 200 and
    // `error.status` said 201 — three answers for one response.
    expect(error.message).not.toContain("200");
    expect(error.message).not.toContain("201");
    expect(reads()).toBe(1);
    await error.cancel();
  });

  test("TF-02: a dedicated class's message cannot disagree with its literal", async () => {
    const { response, reads } = cyclingResponse("status", [404, 200, 500], { status: 200 });

    const error = httpErrorFor(response);

    expect(error).toBeInstanceOf(NotFoundError);
    expectIdentityAgrees(error, 404);
    expect(error.message).not.toContain("HTTP 200");
    expect(error.message).not.toContain("HTTP 500");
    expect(reads()).toBe(1);
    await error.cancel();
  });

  test("TF-03: a string status reaches its dedicated class with a numeric status", async () => {
    // It used to resolve as an `UnknownHttpError` carrying the STRING
    // "404", which broke the declared `number` type and made `isKnownHttpError`
    // return false for what is plainly a 404.
    const { response } = cyclingResponse("status", ["404"]);

    const error = httpErrorFor(response);

    expect(error).toBeInstanceOf(NotFoundError);
    expect(error.status).toBe(404);
    expect(typeof error.status).toBe("number");
    expect(isKnownHttpError(error)).toBe(true);
    await error.cancel();
  });

  const statusConversionRows: Array<{
    label: string;
    status: unknown;
    outcome: "error" | "success" | "refused";
    Class?: new (response: Response) => BaseHttpError;
    expected?: number;
  }> = [
    {
      label: '"404" -> NotFoundError',
      status: "404",
      outcome: "error",
      Class: NotFoundError,
      expected: 404,
    },
    {
      label: '"500" -> InternalServerError',
      status: "500",
      outcome: "error",
      Class: InternalServerError,
      expected: 500,
    },
    {
      label: '"599" -> UnknownHttpError',
      status: "599",
      outcome: "error",
      Class: UnknownHttpError,
      expected: 599,
    },
    { label: '"200" cannot escape with a string status', status: "200", outcome: "refused" },
    { label: "NaN stays on the success branch", status: NaN, outcome: "success" },
    { label: "-1 stays on the success branch", status: -1, outcome: "success" },
    { label: "true cannot escape as a numeric status", status: true, outcome: "refused" },
    { label: "null cannot escape as a numeric status", status: null, outcome: "refused" },
    {
      label: "undefined cannot escape as a numeric status",
      status: undefined,
      outcome: "refused",
    },
    {
      label: "Infinity -> UnknownHttpError",
      status: Infinity,
      outcome: "error",
      Class: UnknownHttpError,
      expected: Infinity,
    },
    {
      label: "404.7 is NOT truncated into NotFoundError",
      status: 404.7,
      outcome: "error",
      Class: UnknownHttpError,
      expected: 404.7,
    },
    {
      label: "404n -> NotFoundError",
      status: 404n,
      outcome: "error",
      Class: NotFoundError,
      expected: 404,
    },
    {
      label: "an object with valueOf -> NotFoundError",
      status: { valueOf: () => 404 },
      outcome: "error",
      Class: NotFoundError,
      expected: 404,
    },
    { label: "a Symbol status -> refused", status: Symbol("hostile"), outcome: "refused" },
  ];

  test.each(statusConversionRows)("TF-04: $label", async ({ status, outcome, Class, expected }) => {
    const { response } = cyclingResponse("status", [status]);

    if (outcome === "success") {
      // A numeric value that compares below 400, or numeric NaN, can satisfy
      // the stable success surface and reaches the caller unchanged.
      expect(classifyResolvedValue(response).kind).toBe("success");
      return;
    }

    if (outcome === "refused") {
      expect(refusalCause(response)).toBeInstanceOf(TypeError);
      return;
    }

    const error = httpErrorFor(response);
    expect(error).toBeInstanceOf(Class!);
    expect(error.status).toBe(expected);
    expect(typeof error.status).toBe("number");
    await error.cancel();
  });

  test("TF-06: a status getter that throws on the SECOND read never runs twice", async () => {
    // A readable payload, not `liveBody()`: this case asserts that the
    // body is still the ERROR'S — that it was never released — so the test has
    // to be able to read it to the end.
    const boom = new Error("status getter exploded on the second read");
    const { response, reads } = cyclingResponse(
      "status",
      [404, rethrowing(boom)],
      { status: 200 },
      "payload-that-is-still-open",
    );

    // Before the fix the second read happened inside the constructor, so this
    // was refused and the body was released out from under a consumer who was
    // owed a NotFoundError.
    const error = httpErrorFor(response);

    expect(error).toBeInstanceOf(NotFoundError);
    expect(reads()).toBe(1);
    expect(await error.text()).toBe("payload-that-is-still-open");
  });

  test("TF-07: the class with a THIRD read survives a getter that throws twice", async () => {
    // `UnknownHttpError` is the class where all three reads used to
    // happen.
    const boom = new Error("status getter exploded");
    const { response, reads } = cyclingResponse(
      "status",
      [599, rethrowing(boom), rethrowing(boom)],
      { status: 200 },
      "payload-that-is-still-open",
    );

    const error = httpErrorFor(response);

    expect(error).toBeInstanceOf(UnknownHttpError);
    expect(error.status).toBe(599);
    expect(reads()).toBe(1);
    expect(await error.text()).toBe("payload-that-is-still-open");
  });

  test("TF-08: a statusText getter that throws on the FIRST read releases the live body", () => {
    const cause = new Error("statusText getter exploded");
    const { stream, cancelCalls } = liveBody();
    const { response } = cyclingResponse(
      "statusText",
      [rethrowing(cause)],
      { status: 404 },
      stream,
    );

    expect(refusalCause(response)).toBe(cause);
    // Nobody can reach this body any more, so the phase must have released it.
    expect(response.bodyUsed).toBe(true);
    expect(cancelCalls()).toBe(1);
  });

  test("TF-09: a statusText getter that throws on the SECOND read never runs twice", async () => {
    const boom = new Error("statusText getter exploded on the second read");
    const { response, reads } = cyclingResponse("statusText", ["Weird", rethrowing(boom)], {
      status: 599,
    });

    const error = httpErrorFor(response);

    expect(error).toBeInstanceOf(UnknownHttpError);
    expect(error.message).toContain("Weird");
    expect(reads()).toBe(1);
    await error.cancel();
  });

  const nonStringStatusTextRows: Array<{ label: string; statusText: unknown }> = [
    { label: "a number", statusText: 42 },
    { label: "null", statusText: null },
    { label: "a Symbol", statusText: Symbol("s") },
    {
      label: "a hostile toString",
      statusText: {
        toString() {
          throw new Error("toString exploded");
        },
      },
    },
  ];

  test.each(nonStringStatusTextRows)(
    "TF-10: a non-string statusText ($label) is the empty string, never a refusal",
    async ({ statusText }) => {
      // `String(raw)` would THROW for the Symbol and for the hostile toString,
      // converting a well-formed HTTP error into a refusal. The rule is total
      // instead: the value when it is a string, and "" otherwise.
      const { response } = cyclingResponse("statusText", [statusText], { status: 599 });

      const error = httpErrorFor(response);

      expect(error).toBeInstanceOf(UnknownHttpError);
      expect(error.statusText).toBe("");
      expect(typeof error.statusText).toBe("string");
      // No reason phrase, and no URL: a synthesised Response reports `url` as "".
      expect(error.message).toBe("HTTP 599");
      await error.cancel();
    },
  );

  test("TF-11: a url getter that throws on the FIRST read releases the live body", () => {
    const cause = new Error("url getter exploded");
    const { stream, cancelCalls } = liveBody();
    const { response } = cyclingResponse("url", [rethrowing(cause)], { status: 404 }, stream);

    expect(refusalCause(response)).toBe(cause);
    expect(response.bodyUsed).toBe(true);
    expect(cancelCalls()).toBe(1);
  });

  test("TF-12: a url getter that throws on the SECOND read never runs twice", async () => {
    // TF-12, the previously unreported half of the defect. `message` carried
    // the redacted form of one read and `error.url` carried a second read, so a
    // second read that threw turned a NotFoundError into a refusal.
    const boom = new Error("url getter exploded on the second read");
    const { response, reads } = cyclingResponse("url", ["https://a.test/x", rethrowing(boom)], {
      status: 404,
    });

    const error = httpErrorFor(response);

    expect(error).toBeInstanceOf(NotFoundError);
    expect(reads()).toBe(1);
    await error.cancel();
  });

  test("TF-13: a cycling url cannot make the message and the escape hatch disagree", async () => {
    const { response, reads } = cyclingResponse(
      "url",
      ["https://a.test/x?tok=SECRET", "https://b.test/y"],
      { status: 404 },
    );

    const error = httpErrorFor(response);

    // The full href on the property, the redacted form in the message and in
    // the record — both derived from ONE read, so they describe one server.
    expect(error.url).toBe("https://a.test/x?tok=SECRET");
    expect(error.message).toContain("https://a.test/x");
    expect(error.message).not.toContain("b.test");
    expect(error.message).not.toContain("SECRET");
    expect(error.toJSON().url).toBe("https://a.test/x");
    expect(reads()).toBe(1);
    await error.cancel();
  });

  const nonStringUrlRows: Array<{ label: string; url: unknown }> = [
    { label: "a number", url: 42 },
    { label: "null", url: null },
    { label: "a URL object", url: new URL("https://a.test/") },
  ];

  test.each(nonStringUrlRows)(
    "TF-14: a non-string url ($label) is the empty string, never a refusal",
    async ({ url: rawUrl }) => {
      const { response } = cyclingResponse("url", [rawUrl], { status: 404 });

      const error = httpErrorFor(response);

      expect(error.url).toBe("");
      expect(typeof error.url).toBe("string");
      // The no-url message branch: no parenthesized URL at all.
      expect(error.message).toBe("HTTP 404");
      await error.cancel();
    },
  );

  test("TF-15: the headers accessor is read exactly once for a live error", async () => {
    const { stream } = liveBody();
    const response = new Response(stream, { status: 404 });
    const real = response.headers;
    let reads = 0;
    Object.defineProperty(response, "headers", {
      configurable: true,
      get() {
        reads += 1;
        return real;
      },
    });

    const error = httpErrorFor(response);

    expect(error).toBeInstanceOf(NotFoundError);
    expect(reads).toBe(1);
    await error.cancel();
  });

  const headersRows: Array<{
    label: string;
    headers: unknown;
    outcome: "error" | "refused";
    check?: (error: BaseHttpError) => void;
  }> = [
    {
      label: "a plain empty object builds empty headers",
      headers: {},
      outcome: "error",
      check: (error) => expect([...error.headers.keys()]).toEqual([]),
    },
    {
      label: "a plain record builds the headers it names",
      headers: { "x-a": "1" },
      outcome: "error",
      check: (error) => expect(error.headers.get("x-a")).toBe("1"),
    },
    { label: "null is refused by the Headers constructor", headers: null, outcome: "refused" },
    {
      label: "a string is refused by the Headers constructor",
      headers: "garbage",
      outcome: "refused",
    },
  ];

  test.each(headersRows)("TF-16: $label", async ({ headers, outcome, check }) => {
    // `headers` is passed through UNNORMALIZED. A value the `Headers`
    // constructor refuses is a signal the response phase turns into a refusal,
    // and that is released, documented behavior.
    const { stream, cancelCalls } = liveBody();
    const response = new Response(stream, { status: 404 });
    Object.defineProperty(response, "headers", {
      configurable: true,
      get() {
        return headers;
      },
    });

    if (outcome === "refused") {
      expect(classifyResolvedValue(response).kind).toBe("refused");
      expect(response.bodyUsed).toBe(true);
      expect(cancelCalls()).toBe(1);
      return;
    }

    const error = httpErrorFor(response);
    expect(error).toBeInstanceOf(NotFoundError);
    check?.(error);
    await error.cancel();
  });

  test.each([
    { label: "a mapped 404", status: 404, statusText: "Not Found", Class: NotFoundError },
    { label: "an unmapped 599", status: 599, statusText: "Weird", Class: UnknownHttpError },
  ])(
    "TF-17/TF-18: $label on a real Response reports one identity through every channel",
    async ({ status, statusText, Class }) => {
      // The no-hostility baseline. For a real `Response` the platform answers
      // the same value on every read, so this passed before the change too —
      // which is the point: the refactor changed nothing here. The LIVE-request
      // counterpart is `typed-fetch.spec.ts`'s roster sweep, which asks the
      // same question of a status that travelled over a socket.
      const error = httpErrorFor(new Response("payload", { status, statusText }));

      expect(error).toBeInstanceOf(Class);
      expectIdentityAgrees(error, status);
      await error.cancel();
    },
  );

  test("TF-19: numeric conversion is part of the first successful read", () => {
    // One read, one conversion. A second `Number(raw)` anywhere on the
    // path would run this getter again and could answer a different status.
    let valueOfCalls = 0;
    const status = {
      valueOf() {
        valueOfCalls += 1;
        return 404;
      },
    };

    const { response } = cyclingResponse("status", [status]);

    expect(httpErrorFor(response)).toBeInstanceOf(NotFoundError);
    expect(valueOfCalls).toBe(1);
  });

  test("TF-20: a partial identity failure cannot change earlier fields on retry", async () => {
    const response = new Response(null);
    const cause = new Error("headers getter exploded");
    const laterHeaders = new Headers({ "x-later": "2" });
    const reads = { status: 0, statusText: 0, url: 0, headers: 0 };

    Object.defineProperties(response, {
      status: {
        get() {
          reads.status += 1;
          return reads.status === 1 ? 420 : 421;
        },
      },
      statusText: {
        get() {
          reads.statusText += 1;
          return reads.statusText === 1 ? "FIRST" : "SECOND";
        },
      },
      url: {
        get() {
          reads.url += 1;
          return reads.url === 1 ? "https://first.test/x" : "https://second.test/y";
        },
      },
      headers: {
        get() {
          reads.headers += 1;
          if (reads.headers === 1) throw cause;
          return laterHeaders;
        },
      },
    });

    expect(refusalCause(response)).toBe(cause);

    const error = httpErrorFor(response);
    expect(error).toBeInstanceOf(UnknownHttpError);
    expect(error.status).toBe(420);
    expect(error.message).toContain('HTTP 420 "FIRST" (https://first.test/x)');
    expect(error.url).toBe("https://first.test/x");
    expect(reads).toEqual({ status: 1, statusText: 1, url: 1, headers: 2 });
    await error.cancel();
  });
});

// ── A value refused once has no identity filed against it ────────────────
//
// ADR 0003 row H-14. The rule the recording implements is "the first successful
// read fixes A RESPONSE's identity", and a value that is not a response has no
// identity to fix — so nothing may be filed against one this module refuses.
// The row is also driven end to end by `fixtures/hostile-fetch.ts`'s H-14
// scenario and its `after` hook, and stated once at the seam in
// `resolved-value-verdict.spec.ts`. The cases below are the refusal POINTS,
// one per place this module can still say no.

describe("every refusal point rolls back what the refused call recorded", () => {
  test("TF-21: a value refused by the structural gate files nothing", async () => {
    // Reachable across two presentations of the SAME object: a
    // response-shaped value missing `json` earns its refusal while quietly
    // filing `status: 200`; completed and re-presented as a 404, it is
    // accepted, and `statusOf` answers with the recorded 200. `status >= 400`
    // is then false and a failed request escapes through the success branch.
    // The success-surface check cannot catch it either — it validates the same
    // recorded scalars.
    const shapeshifter = foreignResponses("https://identity.test/shapeshifter")() as unknown as {
      json?: () => Promise<unknown>;
    };
    delete shapeshifter.json;

    expect(classifyResolvedValue(shapeshifter).kind).toBe("refused");

    // The same object, now complete and reporting a failure.
    shapeshifter.json = async () => ({});
    Object.defineProperty(shapeshifter, "status", { value: 404, configurable: true });
    Object.defineProperty(shapeshifter, "ok", { value: false, configurable: true });

    const error = httpErrorFor(shapeshifter);
    expect(error).toBeInstanceOf(NotFoundError);
    expect(error.status).toBe(404);
    await error.cancel();
  });

  test("TF-22: a value refused by the headers read has no status filed against it", async () => {
    // TF-22 — TF-21's rule, reached through the other door. `isResponse` reads
    // `headers` and then `status`, and the `headers` read is ITSELF a refusal
    // point (ADR 0003 row H-13: a throwing getter answers with a refusal). So a
    // value refused there had already had its status filed.
    let headersThrow = true;
    let status = 200;
    const base = new Response("{}", { status: 200 });
    const response = new Proxy(base, {
      get(target, property) {
        if (property === "headers") {
          if (headersThrow) throw new Error("headers getter exploded");
          return new Headers({ "content-type": "application/json" });
        }
        if (property === "status") return status;
        if (property === "ok") return status < 400;
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    expect(classifyResolvedValue(response).kind).toBe("refused");

    // The same object, now readable and reporting a failure.
    headersThrow = false;
    status = 404;

    const error = httpErrorFor(response);
    expect(error).toBeInstanceOf(NotFoundError);
    expect(error.status).toBe(404);
    await error.cancel();
  });

  test("TF-23: a value refused by a LATER identity read keeps nothing from the earlier one", () => {
    // Ordering the identity reads cannot close this on its own.
    // Whichever runs first is filed before the second can refuse the value, so
    // a refused call always left something behind; reading `headers` before
    // `status` only moved WHICH field was stranded.
    //
    // A stranded `headers` is not harmless. `hasCompatibleSuccessSurface` reads
    // through the same cache, so it validated the `Headers` from the refused
    // call — and a value whose `headers` is a plain `{ notHeaders: true }`
    // escaped as a typed success whose `headers` had no `get`.
    let statusThrows = true;
    const shapeshifter = foreignResponses("https://identity.test/late-identity")({
      headers: {
        get: () => new Headers({ "content-type": "application/json" }),
      },
      status: {
        get() {
          if (statusThrows) throw new Error("status getter exploded");
          return 200;
        },
      },
    });

    expect(classifyResolvedValue(shapeshifter).kind).toBe("refused");

    // The same object, now honest and STABLE — plain data properties, no
    // shifting getter — but carrying a `headers` that is not a `Headers`.
    statusThrows = false;
    Object.defineProperty(shapeshifter, "status", { configurable: true, value: 200 });
    Object.defineProperty(shapeshifter, "headers", {
      configurable: true,
      value: { notHeaders: true },
    });

    expect(classifyResolvedValue(shapeshifter).kind).toBe("refused");
  });
});

// TF-21 and TF-23 both refuse INSIDE `isResponse`, and the staging only ever
// spanned that call. `hasCompatibleSuccessSurface` is a refusal point too, and
// it reads `ok`, `redirected`, and `type` WITHOUT the identity cache — the only
// three reads in this phase a value can answer differently on a second
// presentation. So a value refused there kept `status`, `headers`,
// `statusText`, and `url` filed from the refused call.
//
// TF-21's comment says "the success-surface check cannot catch it either",
// which was true and also the hole: the surface check was itself unstaged.

describe("the SUCCESS-SURFACE check is a refusal point, and files nothing either", () => {
  const LATE_SURFACE = "https://identity.test/late-surface";

  function shapeshifterRefusedOn(field: "type" | "ok" | "redirected"): Record<string, unknown> {
    const bad = { type: "not-a-type", ok: "yes", redirected: "no" } as const;
    // One member off the standard, so only the surface check refuses it.
    return foreignResponses(LATE_SURFACE)({
      headers: new Headers({ "content-type": "application/json" }),
      [field]: bad[field],
    }) as unknown as Record<string, unknown>;
  }

  test.each(["type", "ok", "redirected"] as const)(
    "TF-24: refused on `%s`, then re-presented as a 404, is not answered as a success",
    async (field) => {
      const shapeshifter = shapeshifterRefusedOn(field);

      expect(classifyResolvedValue(shapeshifter).kind).toBe("refused");

      // Now honest, and reporting a FAILED request. The filed `status: 200`
      // from the refused call must not answer for it.
      shapeshifter[field] = { type: "basic", ok: false, redirected: false }[field];
      shapeshifter.status = 404;
      shapeshifter.ok = false;

      const error = httpErrorFor(shapeshifter);
      expect(error).toBeInstanceOf(NotFoundError);
      expect(error.status).toBe(404);
      await error.cancel();
    },
  );

  test("the stale headers record cannot let a headerless object escape as a success", () => {
    // TF-23's exact failure, one refusal point later.
    const shapeshifter = shapeshifterRefusedOn("type");

    expect(classifyResolvedValue(shapeshifter).kind).toBe("refused");

    shapeshifter.type = "basic";
    shapeshifter.headers = { notHeaders: true };

    expect(classifyResolvedValue(shapeshifter).kind).toBe("refused");
  });

  test("a throwing error CONSTRUCTOR files nothing either", () => {
    // The construction is a refusal point too. `new Headers(identity.headers)`
    // refuses a value that READ fine — `[["a"]]` is a legal read and an illegal
    // `HeadersInit` — and the caller gets a refusal. The bad `headers` and the
    // `status` beside it used to stay filed, so the same object presented later
    // as a healthy 200 was answered with that refusal forever.
    const shapeshifter = foreignResponses("https://identity.test/bad-headers")({
      headers: [["a"]],
      ok: false,
      status: 404,
      statusText: "Not Found",
    }) as unknown as Record<string, unknown>;

    expect(classifyResolvedValue(shapeshifter).kind).toBe("refused");

    // The same object, now healthy.
    shapeshifter.headers = new Headers({ "content-type": "application/json" });
    shapeshifter.status = 200;
    shapeshifter.ok = true;

    const verdict = classifyResolvedValue(shapeshifter);
    expect(verdict.kind).toBe("success");
    if (verdict.kind === "success") expect(verdict.response.status).toBe(200);
  });

  // The surface check refuses in TWO ways, and only one of them was covered.
  // Every read inside it can THROW instead of reporting a bad value, and that
  // path skipped the rollback. The flag now starts true and only an acceptance
  // clears it, so a refusal added later is covered by omission.
  test.each(["type", "statusText", "url", "ok", "redirected"] as const)(
    "a THROWING `%s` getter files nothing either",
    async (member) => {
      let throws = true;
      const honest = {
        type: "basic",
        statusText: "OK",
        url: LATE_SURFACE,
        ok: true,
        redirected: false,
      }[member];
      const shapeshifter = foreignResponses(LATE_SURFACE)({
        headers: new Headers({ "content-type": "application/json" }),
        [member]: {
          get() {
            if (throws) throw new Error(`${member} getter exploded`);
            return honest;
          },
        },
      }) as unknown as Record<string, unknown>;

      expect(classifyResolvedValue(shapeshifter).kind).toBe("refused");

      // Now honest, and reporting a FAILED request. `defineProperty` for every
      // slot: the getter above replaced one of them, and a plain assignment to
      // an accessor with no setter is silently dropped.
      throws = false;
      for (const [key, value] of [
        [member, honest],
        ["status", 404],
        ["ok", false],
      ] as const) {
        Object.defineProperty(shapeshifter, key, { configurable: true, writable: true, value });
      }

      const error = httpErrorFor(shapeshifter);
      expect(error).toBeInstanceOf(NotFoundError);
      await error.cancel();
    },
  );

  test("an ACCEPTED call still fixes the identity it read", async () => {
    // The rollback drops only what the refused call recorded. A field fixed by
    // an earlier accepted call is that response's identity and stays.
    const shapeshifter = shapeshifterRefusedOn("type");
    shapeshifter.type = "basic";
    shapeshifter.status = 404;
    shapeshifter.ok = false;

    const first = httpErrorFor(shapeshifter);
    expect(first).toBeInstanceOf(NotFoundError);
    await first.cancel();

    shapeshifter.status = 500;
    const second = httpErrorFor(shapeshifter);
    expect(second).toBeInstanceOf(NotFoundError);
    await second.cancel();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The rollback flag is safe by OMISSION — commit 3964f97, audit case C3.
//
// Round 3 fixed one channel per commit; this pair asks what the SIBLING channel
// of that fix does, which is where two later rounds found their defects.
// ═══════════════════════════════════════════════════════════════════════════

describe("the rollback flag is safe by omission", () => {
  test("a throwing read inside the success-surface check drops the staged identity", async () => {
    let refuse = true;
    const victim = new Response("body", { status: 404, statusText: "Not Found" });
    Object.defineProperty(victim, "type", {
      get() {
        if (refuse) throw new TypeError("nope");
        return "basic";
      },
      configurable: true,
    });
    Object.defineProperty(victim, "status", {
      get: () => (refuse ? 200 : 404),
      configurable: true,
    });

    expect(classifyResolvedValue(victim).kind).toBe("refused");

    refuse = false;
    const error = httpErrorFor(victim);
    expect(error).toBeInstanceOf(NotFoundError);
    expect(error.status).toBe(404);
    await error.cancel();
  });

  test("an accepted value keeps its identity — the flag does not over-roll-back", async () => {
    let reads = 0;
    const victim = new Response("body", { status: 404, statusText: "Not Found" });
    Object.defineProperty(victim, "status", {
      get: () => (reads++ === 0 ? 404 : 200),
      configurable: true,
    });

    const first = httpErrorFor(victim);
    expect(first).toBeInstanceOf(NotFoundError);
    await first.cancel();

    const second = httpErrorFor(victim);
    expect(second).toBeInstanceOf(NotFoundError);
    await second.cancel();
  });
});
