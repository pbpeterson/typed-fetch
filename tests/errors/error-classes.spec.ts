import { readFileSync } from "node:fs";
import { inspect } from "node:util";
import { describe, test, expect, expectTypeOf } from "vitest";
import {
  AbortedError,
  BadRequestError,
  BaseHttpError,
  NetworkError,
  NotFoundError,
  TimeoutError,
  UnknownHttpError,
} from "../../src/errors";
import { inspectCustom } from "../../src/errors/inspect";
import { ownSlot } from "../../src/errors/response-identity";
import {
  isAbortError,
  isHttpError,
  isKnownHttpError,
  isNetworkError,
  isTimeoutError,
} from "../../src/index";
import { allErrors } from "../../fixtures/error-roster";

// ── B2: cause/reason presence is honest (`declare`, no phantom undefined) ──
describe("NetworkError / AbortedError / TimeoutError — cause & reason presence", () => {
  test("cause is absent (not present-undefined) when none is given", () => {
    for (const e of [new NetworkError("x"), new TimeoutError("x"), new AbortedError("x")]) {
      expect("cause" in e).toBe(false);
      expect(Object.keys(e)).not.toContain("cause");
    }
    // AbortedError.reason is equally absent when not supplied.
    const aborted = new AbortedError("x");
    expect("reason" in aborted).toBe(false);
    expect(Object.keys(aborted)).not.toContain("reason");
  });

  test("an explicitly supplied cause/reason is recorded (guard preserved)", () => {
    const net = new NetworkError("x", { cause: undefined });
    expect("cause" in net).toBe(true);
    expect(net.cause).toBeUndefined();

    const boom = new Error("boom");
    const aborted = new AbortedError("x", { cause: boom, reason: "stop" });
    expect(aborted.cause).toBe(boom);
    expect("reason" in aborted).toBe(true);
    expect(aborted.reason).toBe("stop");
  });

  // A PARTIAL options object is the case an `if (options)` guard cannot tell
  // apart from a supplied cause. Constructing with no options at all exercises
  // neither branch of the `"cause" in options` test.
  test("a partial options object still leaves the absent members absent", () => {
    const net = new NetworkError("x", { url: "https://example.test/a" });
    expect("cause" in net).toBe(false);
    expect(net.url).toBe("https://example.test/a");

    const timedOut = new TimeoutError("x", { url: "https://example.test/b" });
    expect("cause" in timedOut).toBe(false);
    expect(timedOut.url).toBe("https://example.test/b");

    const causeOnly = new AbortedError("x", { cause: new Error("c") });
    expect("reason" in causeOnly).toBe(false);

    const reasonOnly = new AbortedError("x", { reason: "r" });
    expect("cause" in reasonOnly).toBe(false);
    expect(reasonOnly.reason).toBe("r");
  });

  // A partial options object is also what makes a polluted `Object.prototype`
  // reachable: `"cause" in options` and a bare `options?.url` both walk the
  // prototype chain, so a single write anywhere in the process forged a cause
  // and put a URL this request never touched into `toJSON()` — the record a
  // logger ships off-box. `typedFetch` already reads its own `fetch` slot with
  // `Object.hasOwn` for the same reason; these three constructors now read
  // theirs the same way.
  test("a polluted Object.prototype cannot inject cause, reason, or url", () => {
    const polluted = ["cause", "reason", "url"] as const;
    const proto = Object.prototype as unknown as Record<string, unknown>;

    for (const key of polluted) {
      expect(Object.hasOwn(proto, key), `${key} already exists on Object.prototype`).toBe(false);
    }

    proto.cause = { token: "POLLUTED_CAUSE" };
    proto.reason = "POLLUTED_REASON";
    proto.url = "https://evil.test/?k=POLLUTED_URL";
    try {
      // `Object.hasOwn`, not `in`: while the prototype is polluted, `in` walks
      // up to it from the ERROR too and reports true for a slot the constructor
      // never assigned. The question this test asks is whether the constructor
      // installed one, which is exactly what `hasOwn` answers.
      //
      // A PARTIAL options object: it supplies none of the three slots itself,
      // so every read falls through to the prototype unless it is own-guarded.
      for (const e of [new NetworkError("x", {}), new TimeoutError("x", {})]) {
        expect(Object.hasOwn(e, "cause")).toBe(false);
        expect(e.url).toBe("");
        expect(e.toJSON().url).toBe("");
      }

      const aborted = new AbortedError("x", {});
      expect(Object.hasOwn(aborted, "cause")).toBe(false);
      expect(Object.hasOwn(aborted, "reason")).toBe(false);
      expect(aborted.url).toBe("");
      expect(aborted.toJSON().url).toBe("");
    } finally {
      for (const key of polluted) delete proto[key];
    }

    for (const key of polluted) {
      expect(Object.hasOwn(proto, key), `${key} leaked out of the test`).toBe(false);
    }
  });

  // ── cause/reason are non-enumerable, as the platform defines them ──
  test("cause and reason carry the descriptor `new Error(m, { cause })` writes", () => {
    // The reference: the platform's own installation of `cause`.
    expect(Object.getOwnPropertyDescriptor(new Error("x", { cause: "c" }), "cause")).toEqual({
      value: "c",
      writable: true,
      enumerable: false,
      configurable: true,
    });

    const cases: Array<[Error, string]> = [
      [new NetworkError("x", { cause: "c" }), "cause"],
      [new TimeoutError("x", { cause: "c" }), "cause"],
      [new AbortedError("x", { cause: "c" }), "cause"],
      [new AbortedError("x", { reason: "c" }), "reason"],
    ];
    for (const [error, key] of cases) {
      expect(Object.getOwnPropertyDescriptor(error, key)).toEqual({
        value: "c",
        writable: true,
        enumerable: false,
        configurable: true,
      });
    }
  });

  test("a cause never reaches JSON.stringify, a spread, or Object.keys", () => {
    // undici's cause chain carries socket detail — addresses and ports — and an
    // enumerable `cause` puts all of it into any structured log.
    const cause = new Error("socket", { cause: { localAddress: "10.0.0.1", localPort: 51234 } });
    const errors = [
      new NetworkError("fetch failed", { cause, url: "https://example.test/a" }),
      new TimeoutError("timed out", { cause }),
      new AbortedError("aborted", { cause, reason: { token: "secret-value" } }),
    ];

    for (const error of errors) {
      expect(Object.keys(error)).not.toContain("cause");
      expect(Object.keys(error)).not.toContain("reason");
      expect({ ...error }).not.toHaveProperty("cause");
      expect({ ...error }).not.toHaveProperty("reason");
      expect(JSON.stringify(error)).not.toContain("localAddress");
      expect(JSON.stringify(error)).not.toContain("secret-value");
    }
  });

  test("a non-enumerable cause is still readable and still writable", () => {
    const first = new Error("first");
    const error = new NetworkError("x", { cause: first });

    expect(error.cause).toBe(first);
    expect("cause" in error).toBe(true);

    const second = new Error("second");
    error.cause = second;
    expect(error.cause).toBe(second);
  });

  test("the brands and the guards are untouched by the descriptor change", () => {
    const net = new NetworkError("x", { cause: "c" });
    const aborted = new AbortedError("x", { cause: "c", reason: "r" });
    const timedOut = new TimeoutError("x", { cause: "c" });

    expect(net).toBeInstanceOf(NetworkError);
    expect(aborted).toBeInstanceOf(AbortedError);
    expect(timedOut).toBeInstanceOf(TimeoutError);
    expect([isNetworkError(net), isAbortError(aborted), isTimeoutError(timedOut)]).toEqual([
      true,
      true,
      true,
    ]);
  });

  // ── toJSON ──
  test("toJSON records the message and the url, never the cause or the reason", () => {
    const cause = new TypeError("fetch failed");

    expect(
      new NetworkError("fetch failed", { cause, url: "https://example.test/a" }).toJSON(),
    ).toEqual({
      name: "NetworkError",
      message: "fetch failed",
      url: "https://example.test/a",
    });
    expect(new TimeoutError("timed out", { cause }).toJSON()).toEqual({
      name: "TimeoutError",
      message: "timed out",
      url: "",
    });
    expect(new AbortedError("aborted", { cause, reason: "stop" }).toJSON()).toEqual({
      name: "AbortedError",
      message: "aborted",
      url: "",
    });
  });

  test("a cyclic abort reason no longer makes JSON.stringify throw", () => {
    const reason: Record<string, unknown> = {};
    reason.self = reason;
    const aborted = new AbortedError("aborted", { reason });

    // An enumerable `reason` made every logger that serialized this error throw
    // `TypeError: Converting circular structure to JSON`.
    expect(() => JSON.stringify(aborted)).not.toThrow();
    expect(JSON.parse(JSON.stringify(aborted))).toEqual({
      name: "AbortedError",
      message: "aborted",
      url: "",
    });
  });

  test("url defaults to the empty string, including for an explicit undefined", () => {
    for (const e of [new NetworkError("x"), new AbortedError("x"), new TimeoutError("x")]) {
      expect(e.url).toBe("");
    }
    expect(new NetworkError("x", { url: undefined }).url).toBe("");
    expect(new AbortedError("x", { url: undefined }).url).toBe("");
    expect(new TimeoutError("x", { url: undefined }).url).toBe("");
  });

  // These three constructors are public API a consumer calls directly — a mock,
  // an adapter, a re-wrap — so `url?: string` is a compile-time claim and
  // nothing more. An unchecked value reached `hasRedactableSlot`, which calls
  // `.includes` on it, and the CONSTRUCTOR threw: `url.includes is not a
  // function`, in a library whose premise is that errors are values. An array
  // has `.includes`, so it did not throw and sat in a `readonly string` slot
  // instead, from where it flowed into `redactUrl` and the `toJSON()` record.
  describe("a non-string url is normalized, never coerced and never thrown on", () => {
    const notStrings: readonly [string, unknown][] = [
      ["a number", 42],
      ["an array", ["https://evil.test/x"]],
      ["a plain object", { toString: () => "https://evil.test/x" }],
      ["a symbol", Symbol("url")],
      ["null", null],
      ["a boolean", true],
    ];

    test.each(notStrings)("%s does not make the constructor throw", (_label, value) => {
      for (const make of [
        () => new NetworkError("x", { url: value as string }),
        () => new AbortedError("x", { url: value as string }),
        () => new TimeoutError("x", { url: value as string }),
      ]) {
        expect(make).not.toThrow();
      }
    });

    test.each(notStrings)("%s leaves url a string, and the record too", (_label, value) => {
      for (const error of [
        new NetworkError("x", { url: value as string }),
        new AbortedError("x", { url: value as string }),
        new TimeoutError("x", { url: value as string }),
      ]) {
        expect(typeof error.url).toBe("string");
        expect(error.url).toBe("");
        expect(error.toJSON().url).toBe("");
      }
    });
  });
});

// ── Error class invariants ───────────────────────────────────────────

describe("error class consistency", () => {
  test.each(allErrors)(
    "$Class.name ($status): static and instance properties match",
    ({ Class, status }) => {
      const instance = new Class(new Response(null, { status }));

      expect(Class.status).toBe(status);
      expect(instance.status).toBe(Class.status);
      expect(instance.statusText).toBe(Class.statusText);
    },
  );

  test.each(allErrors)("$Class.name extends BaseHttpError and Error", ({ Class, status }) => {
    const instance = new Class(new Response(null, { status }));

    expect(instance).toBeInstanceOf(BaseHttpError);
    expect(instance).toBeInstanceOf(Error);
    // Per class, not once for the roster. `isKnownHttpError` is the guard the
    // README tells consumers to narrow with, and it keys off a brand carried by
    // each class. Asserting it for a single sample left 39 classes free to lose
    // the brand with the suite green — and a real 423 from `typedFetch` would
    // then report `false`.
    expect(isKnownHttpError(instance)).toBe(true);
  });

  test.each(allErrors)(
    "$Class.name.clone() returns a distinct instance of the same class",
    ({ Class, status }) => {
      const instance = new Class(new Response(null, { status }));
      const cloned = instance.clone();

      expect(cloned).toBeInstanceOf(Class);
      expect(cloned).not.toBe(instance);
      expect(cloned.status).toBe(instance.status);
      expect(cloned.statusText).toBe(instance.statusText);
    },
  );

  test.each(allErrors)("$Class.name.name equals the class name", ({ Class, status }) => {
    const instance = new Class(new Response(null, { status }));
    expect(instance.name).toBe(Class.name);
  });

  test("NetworkError.name equals 'NetworkError'", () => {
    expect(new NetworkError("fail").name).toBe("NetworkError");
  });

  test("NetworkError preserves cause", () => {
    const original = new TypeError("fetch failed");
    const error = new NetworkError("fetch failed", { cause: original });
    expect(error.cause).toBe(original);
  });

  test("AbortedError.name equals 'AbortedError'", () => {
    expect(new AbortedError("aborted").name).toBe("AbortedError");
  });

  test("AbortedError preserves cause and reason and does not extend NetworkError", () => {
    const original = new DOMException("This operation was aborted", "AbortError");
    const reason = { code: "ROUTE_CHANGE" };
    const error = new AbortedError("aborted", { cause: original, reason });
    expect(error.cause).toBe(original);
    expect(error.reason).toBe(reason);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(NetworkError);
    expect(error).not.toBeInstanceOf(BaseHttpError);
  });

  test("AbortedError.reason is undefined when no reason is supplied", () => {
    const error = new AbortedError("aborted");
    expect(error.reason).toBeUndefined();
  });

  test("TimeoutError.name equals 'TimeoutError'", () => {
    expect(new TimeoutError("timed out").name).toBe("TimeoutError");
  });

  test("TimeoutError preserves cause and does not extend NetworkError", () => {
    const original = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    const error = new TimeoutError("timed out", { cause: original });
    expect(error.cause).toBe(original);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(NetworkError);
    expect(error).not.toBeInstanceOf(BaseHttpError);
  });

  test("UnknownHttpError reflects the actual response status and clones", () => {
    const instance = new UnknownHttpError(
      new Response(null, { status: 599, statusText: "Custom" }),
    );

    expect(instance.status).toBe(599);
    expect(instance.statusText).toBe("Custom");
    expect(instance.name).toBe("UnknownHttpError");
    expect(instance).toBeInstanceOf(BaseHttpError);

    const cloned = instance.clone();
    expect(cloned).toBeInstanceOf(UnknownHttpError);
    expect(cloned).not.toBe(instance);
    expect(cloned.status).toBe(599);
  });
});

// ── json<T>() generic ────────────────────────────────────────────────

describe("json<T>()", () => {
  test("returns typed json from error body", async () => {
    const body = { message: "not found", code: "NOT_FOUND" };
    const error = new NotFoundError(new Response(JSON.stringify(body), { status: 404 }));

    const result = await error.json<{ message: string; code: string }>();
    expect(result).toEqual(body);
  });

  test("defaults to unknown when no type parameter is given", async () => {
    const error = new BadRequestError(
      new Response(JSON.stringify({ error: "bad" }), { status: 400 }),
    );

    const result = await error.json();
    expectTypeOf(result).toEqualTypeOf<unknown>();
    expect(result).toEqual({ error: "bad" });
  });
});

test("error .name is a hardcoded string literal, not this.constructor.name", () => {
  const src = readFileSync("src/errors/base-http-error.ts", "utf8");
  expect(src).not.toMatch(/this\.name\s*=\s*this\.constructor\.name/);
});

describe("message and url agree on what they disclose", () => {
  test("BaseHttpError: the message carries the redacted URL, the property the full href", () => {
    const response = new Response(null, { status: 404, statusText: "Not Found" });
    Object.defineProperty(response, "url", {
      value: "https://api.test/v1/things?access_token=SECRET",
    });
    const error = new NotFoundError(response);

    expect(error.message).toBe('HTTP 404 "Not Found" (https://api.test/v1/things)');
    expect(error.toJSON().url).toBe("https://api.test/v1/things");
    // The record's message and its url describe the same URL.
    expect(error.toJSON().message).toContain(error.toJSON().url);
    // The escape hatch is untouched.
    expect(error.url).toBe("https://api.test/v1/things?access_token=SECRET");
  });

  test("NetworkError: undici's credential message loses the password", () => {
    const url = "http://alice:hunter2@api.test/v1/things";
    const error = new NetworkError(
      `Request cannot be constructed from a URL that includes credentials: ${url}`,
      { url },
    );

    expect(error.message).not.toContain("hunter2");
    expect(JSON.stringify(error)).not.toContain("hunter2");
    expect(error.url).toBe(url);
  });
});

// ── The status a class was selected on is the status it reports ──────

/**
 * A `Response` whose `status` and `statusText` accessors answer with the next
 * value of a list and count their reads. A shifting getter is what an injected
 * `fetch` can hand this library, and the counters are what prove the reads
 * collapsed to one.
 */
function shiftingResponse(
  status: readonly unknown[],
  statusText: readonly unknown[] = [""],
  init?: ResponseInit,
): { response: Response; reads: { status: number; statusText: number } } {
  const response = new Response(null, init);
  const reads = { status: 0, statusText: 0 };
  Object.defineProperty(response, "status", {
    configurable: true,
    get() {
      const value = status[Math.min(reads.status, status.length - 1)];
      reads.status += 1;
      return value;
    },
  });
  Object.defineProperty(response, "statusText", {
    configurable: true,
    get() {
      const value = statusText[Math.min(reads.statusText, statusText.length - 1)];
      reads.statusText += 1;
      return value;
    },
  });
  return { response, reads };
}

describe("UnknownHttpError — the class where all three reads diverged", () => {
  test("EC-01: every member reports the first read", () => {
    const { response, reads } = shiftingResponse([420, 200, 201], ["Weird", "OK"], { status: 404 });

    const error = new UnknownHttpError(response);

    expect(error.status).toBe(420);
    expect(error.statusText).toBe("Weird");
    expect(error.message).toBe('HTTP 420 "Weird"');
    expect(error.toJSON()).toEqual({
      name: "UnknownHttpError",
      message: 'HTTP 420 "Weird"',
      status: 420,
      statusText: "Weird",
      url: "",
      headers: [],
    });
    // One read each, for the class that used to perform three of `status` and
    // three of `statusText` on a single construction.
    expect(reads).toEqual({ status: 1, statusText: 1 });

    expect(isHttpError(error)).toBe(true);
    expect(isKnownHttpError(error)).toBe(false);
  });

  const statusShapes: Array<{ label: string; raw: unknown; expected: number }> = [
    { label: "a real number", raw: 404, expected: 404 },
    { label: 'the string "404"', raw: "404", expected: 404 },
    { label: 'the string "200"', raw: "200", expected: 200 },
    { label: "a padded numeric string", raw: " 404 ", expected: 404 },
    { label: "a hex string", raw: "0x1F4", expected: 500 },
    { label: "NaN", raw: NaN, expected: NaN },
    { label: "Infinity", raw: Infinity, expected: Infinity },
    { label: "a negative number", raw: -1, expected: -1 },
    { label: "a fractional status", raw: 404.7, expected: 404.7 },
    { label: "true", raw: true, expected: 1 },
    { label: "null", raw: null, expected: 0 },
    { label: "undefined", raw: undefined, expected: NaN },
  ];

  test.each(statusShapes)("EC-02: status is a number for $label", ({ raw, expected }) => {
    // `abstract readonly status: number` used to be a promise the runtime could
    // break: a response reporting the string "404" produced an
    // `UnknownHttpError` whose `status` was a string.
    const { response } = shiftingResponse([raw], [""], { status: 599 });

    const error = new UnknownHttpError(response);

    expect(typeof error.status).toBe("number");
    expect(error.status).toBe(expected);
  });
});

describe("every dedicated class keys on the status it was selected on", () => {
  test.each(allErrors)(
    "EC-03: $Class.name reads the status once and reports its own literal",
    ({ Class, status }) => {
      const { response, reads } = shiftingResponse([status, 200], [""], { status });

      const error = new Class(response);

      expect(error.status).toBe(Class.status);
      expect(error.message.startsWith(`HTTP ${Class.status}`)).toBe(true);
      // A second read reported 200, which no dedicated class can ever be
      // selected on.
      expect(error.message).not.toContain("HTTP 200");
      expect(reads.status).toBe(1);
    },
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// ROUND 4 — an options object whose slots refuse to answer
//
// Round 3 fixed one channel per commit. These cases ask what the SIBLING
// channel of each fix does, which is where rounds 2 and 3 both found their
// defects.
// ═══════════════════════════════════════════════════════════════════════════

describe("D4 — the same hasOwn/read pair in the public error constructors", () => {
  test("CONTROL — the inspect record survives a refusing own-property test", () => {
    const error = new NetworkError("boom", { url: "https://api.test/x" });
    const wrapped = new Proxy(error, {
      getOwnPropertyDescriptor() {
        throw new TypeError("no");
      },
    });
    const render = (error as unknown as Record<symbol, unknown>)[inspectCustom] as (
      this: unknown,
      depth: number,
      options: object,
      inspect?: unknown,
    ) => string;
    expect(() => render.call(wrapped, 2, {})).not.toThrow();
  });

  test("an options object with a throwing `url` getter makes the constructor throw", () => {
    const options = {
      get url(): string {
        throw new TypeError("no");
      },
    };
    expect(() => new NetworkError("boom", options)).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ROUND 4 — the values Deno and Bun answered with.
//
// The ledger's "Other runtimes" entry was measured on Deno 1.46.3, BEFORE the
// reason-phrase filter, the absolute-path userinfo scan, and the message
// layout's escaping existed. Round 4 re-ran all three on Deno 2.9.5 and Bun
// 1.3.13 against `dist/index.mjs`, and every case below produced the SAME
// string on all three runtimes. They are pinned here as the Node side of that
// comparison, so a future divergence shows up as a plain failure.
//
// One runtime fact came out of it and belongs with the cases: Deno's client
// DISCARDS the origin's reason phrase and substitutes the canonical one, so
// the filter has nothing to filter there. Bun exercises it fully and answers
// exactly as Node does.
// ═══════════════════════════════════════════════════════════════════════════

describe("control — a non-string url on the three pre-response classes", () => {
  test.each([
    ["an array, which answers .includes", [1, 2, 3]],
    ["a number", 42],
    ["null", null],
    ["a URL object", new URL("https://u:p@api.test/v1?t=1")],
    [
      "a value whose toString and includes both throw",
      {
        toString() {
          throw new Error("boom");
        },
        includes() {
          throw new Error("boom");
        },
      },
    ],
  ])("%s normalizes to the empty string instead of throwing", (_id, raw) => {
    for (const Klass of [NetworkError] as const) {
      const error = new Klass("m", { url: raw as unknown as string });
      expect(typeof error.url).toBe("string");
      expect(error.url).toBe("");
      expect(error.message).toBe("m");
    }
  });
});

/**
 * ROUND 5, LANE 2 — the mutations the round-4 suite did not kill.
 *
 * Each block below was written against a SURVIVOR: a one-line change to `src/`
 * that the whole official suite stayed green for. Every test here was verified
 * to fail against the mutation it names and to pass against the real source.
 *
 * Nothing here re-asserts a behaviour another spec already pins. Where an
 * existing test covers one instance of a rule, the block covers the instances
 * it left out, and says which mutation reached each one.
 */
// ═══════════════════════════════════════════════════════════════════════════
// 1. `ownSlot` at every call site, not only one.
//
// Commit 4169207 ("keep a refusing options slot from making a constructor
// throw") routed SEVEN caller-supplied slots through `ownSlot`: `cause` and
// `url` on NetworkError and TimeoutError, and `cause`, `reason`, and `url` on
// AbortedError. `error-classes.spec.ts`'s D4 block asserts exactly ONE of them
// — NetworkError's `url` — so reverting any of the other six to the
// pre-round-4 `options && Object.hasOwn(options, k) ? options[k] : …` idiom
// leaves the suite green while the constructor throws again.
//
// Both halves of the read are covered, because both can run consumer code and
// `ownSlot`'s own JSDoc says so: `Object.hasOwn` runs `[[GetOwnProperty]]`,
// which a `Proxy` answers from a trap, and the read after it runs an ordinary
// getter. Moving `Object.hasOwn` back out of the `try` — the half NO existing
// test reaches for ANY of the seven slots — also survives the suite.
// ═══════════════════════════════════════════════════════════════════════════

/** The public pre-response classes, and the caller-supplied slots each reads. */
const PRE_RESPONSE_SLOTS = [
  ["NetworkError.cause", NetworkError, "cause"],
  ["NetworkError.url", NetworkError, "url"],
  ["AbortedError.cause", AbortedError, "cause"],
  ["AbortedError.reason", AbortedError, "reason"],
  ["AbortedError.url", AbortedError, "url"],
  ["TimeoutError.cause", TimeoutError, "cause"],
  ["TimeoutError.url", TimeoutError, "url"],
] as const satisfies readonly (readonly [
  string,
  new (message?: string, options?: never) => Error,
  string,
])[];

describe("a refusing options slot never makes a public constructor throw", () => {
  test.each(PRE_RESPONSE_SLOTS)("%s — the getter throws", (_pair, ErrorClass, slot) => {
    const options = {
      get [slot](): unknown {
        throw new TypeError("this slot refuses to answer");
      },
    };

    let built: Error | undefined;
    expect(() => {
      built = new ErrorClass("boom", options as never);
    }).not.toThrow();
    // Still a usable error value, which is the whole reason the throw matters.
    expect(built).toBeInstanceOf(Error);
    expect(typeof built?.message).toBe("string");
  });

  test.each(PRE_RESPONSE_SLOTS)(
    "%s — an options `Proxy` whose [[GetOwnProperty]] trap throws",
    (_pair, ErrorClass, slot) => {
      // Wrapping an options bag in a Proxy is the instrumentation pattern the
      // library already names by hand. `Object.hasOwn` is NOT inert against it.
      const options = new Proxy(
        { [slot]: "a value the trap will never let anyone see" },
        {
          getOwnPropertyDescriptor() {
            throw new TypeError("this object will not say what it owns");
          },
        },
      );

      let built: Error | undefined;
      expect(() => {
        built = new ErrorClass("boom", options as never);
      }).not.toThrow();
      expect(built).toBeInstanceOf(Error);
    },
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. A refusing slot is ABSENT, not present-with-`undefined`.
//
// `ownSlot`'s JSDoc states the verdict in full: "A slot that refuses to answer
// is ABSENT. That is the honest report: the constructors define an own `cause`
// or `reason` only for a value they hold, so a refusal keeps `"cause" in error`
// false rather than filing `undefined`."
//
// Nothing asserted it. Changing the `catch` to `return { present: true, value:
// undefined }` kept all 1640 tests green, and that mutation is observable: the
// constructor then defines an own `cause` holding `undefined`, and the inspect
// hook prints a signpost telling a reader to go read a cause that is not there.
// ═══════════════════════════════════════════════════════════════════════════

describe("a slot that refuses to answer is absent, not present-with-undefined", () => {
  test("`ownSlot` reports a throwing getter as absent", () => {
    const source = {
      get secret(): unknown {
        throw new TypeError("no");
      },
    };
    expect(ownSlot(source, "secret")).toEqual({ present: false, value: undefined });
  });

  test("`ownSlot` reports a refusing [[GetOwnProperty]] trap as absent", () => {
    const source = new Proxy(
      { secret: "held" },
      {
        getOwnPropertyDescriptor() {
          throw new TypeError("no");
        },
      },
    );
    expect(ownSlot(source, "secret")).toEqual({ present: false, value: undefined });
  });

  test("a refusing `cause` leaves no own cause and no inspect signpost", () => {
    const error = new NetworkError("boom", {
      get cause(): unknown {
        throw new TypeError("no");
      },
    });

    expect(Object.hasOwn(error, "cause")).toBe(false);
    expect("cause" in error).toBe(false);
    expect(inspect(error)).not.toContain("[not shown - read error.cause]");
  });

  test("a refusing `reason` leaves no own reason and no inspect signpost", () => {
    const error = new AbortedError("boom", {
      get reason(): unknown {
        throw new TypeError("no");
      },
    });

    expect(Object.hasOwn(error, "reason")).toBe(false);
    expect("reason" in error).toBe(false);
    expect(inspect(error)).not.toContain("[not shown - read error.reason]");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ROUND 6 — a consumer subclass cannot break the library's invariants.
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// ROUND 7 — the inspect hook's LAST expression was outside its own guard.
//
// The runtime supplies the `inspect` callback as the third argument, and its
// return value is not typechecked. Interpolating it was the one expression
// still outside the `try`, in a function whose stated invariant is that it
// never throws. No runtime this package targets supplies such a callback; the
// invariant is unconditional anyway.
// ═══════════════════════════════════════════════════════════════════════════

describe("the inspect hook survives its own renderer", () => {
  function renderWith(callback: unknown): string {
    const error = new NetworkError("boom", { url: "https://api.test/x" });
    const hook = (error as unknown as Record<symbol, unknown>)[inspectCustom] as (
      this: unknown,
      depth: number,
      options: object,
      inspect?: unknown,
    ) => string;
    return hook.call(error, 2, {}, callback);
  }

  test("a renderer that answers with a non-string still produces a line", () => {
    const line = renderWith(() => 42);

    expect(typeof line).toBe("string");
    expect(line).toContain("42");
  });

  test("a renderer whose answer refuses string conversion is reported, not thrown", () => {
    const hostile = {
      [Symbol.toPrimitive]() {
        throw new TypeError("this record refuses to become a string");
      },
    };

    expect(() => renderWith(() => hostile)).not.toThrow();
    expect(renderWith(() => hostile)).toContain("[record not renderable]");
  });
});
