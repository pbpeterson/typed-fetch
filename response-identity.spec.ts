import { describe, test, expect } from "vitest";
import {
  identityOf,
  lendIdentity,
  statusOf,
  type ResponseIdentity,
} from "./src/errors/response-identity";

/**
 * THE SINGLE-READ CONTRACT, TESTED WITHOUT AN ERROR CLASS.
 *
 * The interface is the test surface. Every case in this file constructs no
 * error class at all, which is the whole point of extracting the module: the
 * normalization policy and the read-once guarantee are testable on their own,
 * the same way `errorBodyOf` made the body lifecycle testable on its own.
 */

type Field = "status" | "statusText" | "url" | "headers";

const FIELDS: readonly Field[] = ["status", "statusText", "url", "headers"];

/**
 * Wrap a value so the counting accessor THROWS it instead of returning it.
 *
 * A getter that throws is a first-class case here, not an edge: it is how an
 * injected implementation reports that it cannot answer, and the module must
 * cache nothing for it.
 */
class Thrown {
  constructor(readonly value: unknown) {}
}

const throwing = (value: unknown) => new Thrown(value);

/**
 * A `Response` whose four identity accessors each count their reads and answer
 * with the next value of a supplied list, holding the LAST value once the list
 * runs out.
 *
 * The counter is what proves the contract. An assertion on the returned value
 * alone would pass just as well against code that reads three times and happens
 * to get the same answer each time, which is precisely the code this module
 * replaced.
 */
function countingResponse(
  overrides: Partial<Record<Field, unknown[]>> = {},
  body: BodyInit | null = null,
): { response: Response; counts: Record<Field, number> } {
  const response = new Response(body);
  const counts: Record<Field, number> = { status: 0, statusText: 0, url: 0, headers: 0 };
  const lists: Record<Field, unknown[]> = {
    status: overrides.status ?? [200],
    statusText: overrides.statusText ?? [""],
    url: overrides.url ?? [""],
    headers: overrides.headers ?? [new Headers()],
  };

  for (const field of FIELDS) {
    const values = lists[field];
    Object.defineProperty(response, field, {
      configurable: true,
      get() {
        const index = Math.min(counts[field], values.length - 1);
        // Counted BEFORE the value is produced, so a read that throws still
        // records that it happened.
        counts[field] += 1;
        const value = values[index];
        if (value instanceof Thrown) throw value.value;
        return value;
      },
    });
  }

  return { response, counts };
}

/** A record that is plainly not what any of these responses would produce. */
function seededIdentity(overrides: Partial<ResponseIdentity> = {}): ResponseIdentity {
  return {
    status: 418,
    statusText: "I'm a Teapot",
    url: "https://seeded.test/teapot",
    headers: new Headers({ "x-seeded": "1" }),
    ...overrides,
  };
}

describe("statusOf — one read per response, ever", () => {
  test("RI-01: three calls perform exactly one read", () => {
    const { response, counts } = countingResponse({ status: [420] });

    expect(statusOf(response)).toBe(420);
    expect(statusOf(response)).toBe(420);
    expect(statusOf(response)).toBe(420);

    expect(counts.status).toBe(1);
  });

  test("RI-02: a getter that cycles 420 -> 200 -> 201 answers 420 every time", () => {
    // The reported defect, at its smallest. The second and third values exist
    // in the list precisely so a regression that reads again reports one of
    // them instead of failing on the count alone.
    const { response } = countingResponse({ status: [420, 200, 201] });

    expect([statusOf(response), statusOf(response), statusOf(response)]).toEqual([420, 420, 420]);
  });

  test("RI-03: identityOf reuses the read statusOf already performed", () => {
    const { response, counts } = countingResponse({ status: [420, 200] });

    expect(statusOf(response)).toBe(420);
    const identity = identityOf(response);

    // This is the handoff between the class-selection site in `src/index.ts`
    // and the `BaseHttpError` constructor: the constructor must not pay for a
    // second read, and must not be able to see a different value.
    expect(identity.status).toBe(420);
    expect(counts.status).toBe(1);
  });

  test("RI-09: a read that THROWS caches nothing, so the next call reads again", () => {
    const boom = new Error("status getter exploded");
    const { response, counts } = countingResponse({ status: [throwing(boom)] });

    expect(() => statusOf(response)).toThrow(boom);
    expect(() => statusOf(response)).toThrow(boom);

    // Recording a failed read would mean answering a later caller with a value
    // nobody ever produced.
    expect(counts.status).toBe(2);
  });
});

describe("identityOf — one read per field, per response, ever", () => {
  test("RI-04: three calls read statusText, url, and headers exactly once each", () => {
    const { response, counts } = countingResponse({
      status: [404],
      statusText: ["Not Found", "OK"],
      url: ["https://a.test/x", "https://b.test/y"],
      headers: [new Headers({ "x-a": "1" }), new Headers({ "x-b": "2" })],
    });

    identityOf(response);
    identityOf(response);
    identityOf(response);

    expect(counts.statusText).toBe(1);
    expect(counts.url).toBe(1);
    expect(counts.headers).toBe(1);
    expect(counts.status).toBe(1);
  });

  test("RI-05: a repeated call returns the SAME record object", () => {
    // Identity, not equality. Two errors built from one response must report
    // one identity, and returning a fresh equal object would let a future
    // change diverge them without failing this test.
    const { response } = countingResponse({ status: [404] });

    expect(identityOf(response)).toBe(identityOf(response));
  });

  test("RI-12: the record holds the response's OWN Headers, never a copy", () => {
    // A `Headers` is mutable. One shared COPY across two errors built from one
    // response would let `a.headers.set(...)` edit `b.headers`, which is the
    // aliasing hazard the per-error copy exists to prevent. The record must
    // therefore stay the source object and leave copying to the caller.
    const response = new Response(null, { status: 404, headers: { "x-a": "1" } });

    expect(identityOf(response).headers).toBe(response.headers);
  });

  test("RI-17: the module never touches the body, which is the seam", () => {
    // Identity lives above the seam and the single-use stream below it. If this
    // module ever reads `body`, `bodyUsed`, or `clone`, the two concerns have
    // started to merge. `error-body.spec.ts` asserts the mirror image.
    const response = new Response("payload", { status: 404 });
    const touched = { body: 0, bodyUsed: 0, clone: 0 };
    const realBody = response.body;
    const realClone = response.clone.bind(response);
    Object.defineProperty(response, "body", {
      configurable: true,
      get() {
        touched.body += 1;
        return realBody;
      },
    });
    Object.defineProperty(response, "bodyUsed", {
      configurable: true,
      get() {
        touched.bodyUsed += 1;
        return false;
      },
    });
    Object.defineProperty(response, "clone", {
      configurable: true,
      get() {
        touched.clone += 1;
        return realClone;
      },
    });

    identityOf(response);

    expect(touched).toEqual({ body: 0, bodyUsed: 0, clone: 0 });
  });
});

describe("statusOf — the normalization policy", () => {
  // `Number(raw)` from ONE read. No truncation, no clamping, no range check,
  // and no rejection: the branch decision is identical to the `>= 400`
  // comparison the code used to make, and the only downstream difference is
  // that `statusCodeErrorMap` now receives a number.
  const rows: Array<{ label: string; raw: unknown; expected: number }> = [
    { label: "a real number stays itself", raw: 404, expected: 404 },
    { label: 'the string "404" becomes 404', raw: "404", expected: 404 },
    { label: 'the string "200" becomes 200', raw: "200", expected: 200 },
    { label: "a padded numeric string is trimmed by Number", raw: " 404 ", expected: 404 },
    { label: "a hex string converts the way Number converts it", raw: "0x1F4", expected: 500 },
    { label: "NaN stays NaN", raw: NaN, expected: NaN },
    { label: "Infinity stays Infinity", raw: Infinity, expected: Infinity },
    { label: "a negative number stays negative", raw: -1, expected: -1 },
    { label: "a fractional status is NOT truncated", raw: 404.7, expected: 404.7 },
    { label: "true becomes 1", raw: true, expected: 1 },
    { label: "null becomes 0", raw: null, expected: 0 },
    { label: "undefined becomes NaN", raw: undefined, expected: NaN },
    { label: "a BigInt converts to its number", raw: 404n, expected: 404 },
    {
      label: "an object with valueOf converts through it",
      raw: { valueOf: () => 404 },
      expected: 404,
    },
  ];

  test.each(rows)("RI-06: $label", ({ raw, expected }) => {
    const { response } = countingResponse({ status: [raw] });

    const status = statusOf(response);

    expect(status).toBe(expected);
    // The declared type of `BaseHttpError.status` is `number`. After this
    // normalization it is a promise the runtime keeps for every input that does
    // not throw.
    expect(typeof status).toBe("number");
  });

  test("RI-07: a Symbol status throws the conversion's own TypeError", () => {
    // `Number(symbol)` throws, exactly as `symbol >= 400` threw before. The
    // envelope turns it into a NetworkError and releases the body; nothing here
    // softens it.
    const { response } = countingResponse({ status: [Symbol("hostile")] });

    expect(() => statusOf(response)).toThrowError(TypeError);
  });

  test("RI-08: a throwing valueOf reaches the caller unchanged", () => {
    const boom = new Error("valueOf exploded");
    const { response } = countingResponse({
      status: [
        {
          valueOf() {
            throw boom;
          },
        },
      ],
    });

    let thrown: unknown;
    try {
      statusOf(response);
    } catch (caught) {
      thrown = caught;
    }

    // Identity, so the value the consumer sees as `error.cause` is the one the
    // implementation threw and not a wrapper this library invented.
    expect(thrown).toBe(boom);
  });
});

describe("identityOf — statusText and url normalization", () => {
  // One rule for both fields: the value when it is a string, and the empty
  // string otherwise. `String(raw)` is not used because it THROWS for a Symbol
  // and for a hostile `toString`, which would turn a well-formed HTTP error
  // into a NetworkError.
  const hostileToString = {
    toString() {
      throw new Error("toString exploded");
    },
  };

  const textRows: Array<{ label: string; raw: unknown; expected: string }> = [
    { label: "a string is kept verbatim", raw: "Not Found", expected: "Not Found" },
    { label: "the empty string stays empty", raw: "", expected: "" },
    { label: "undefined becomes the empty string", raw: undefined, expected: "" },
    { label: "null becomes the empty string", raw: null, expected: "" },
    { label: "a number becomes the empty string", raw: 42, expected: "" },
    {
      label: "a Symbol becomes the empty string and does not throw",
      raw: Symbol("s"),
      expected: "",
    },
    { label: "a hostile toString becomes the empty string", raw: hostileToString, expected: "" },
    { label: "an array becomes the empty string", raw: ["a"], expected: "" },
  ];

  test.each(textRows)("RI-10: statusText — $label", ({ raw, expected }) => {
    const { response } = countingResponse({ status: [599], statusText: [raw] });

    let identity: ResponseIdentity | undefined;
    expect(() => {
      identity = identityOf(response);
    }).not.toThrow();

    expect(identity?.statusText).toBe(expected);
    expect(typeof identity?.statusText).toBe("string");
  });

  const urlRows: Array<{ label: string; raw: unknown; expected: string }> = [
    {
      label: "a string href is kept verbatim",
      raw: "https://a.test/x",
      expected: "https://a.test/x",
    },
    { label: "the empty string stays empty", raw: "", expected: "" },
    { label: "undefined becomes the empty string", raw: undefined, expected: "" },
    { label: "null becomes the empty string", raw: null, expected: "" },
    { label: "a number becomes the empty string", raw: 42, expected: "" },
    {
      label: "a Symbol becomes the empty string and does not throw",
      raw: Symbol("s"),
      expected: "",
    },
    { label: "a hostile toString becomes the empty string", raw: hostileToString, expected: "" },
    // The cost of the rule, pinned deliberately: a double that answers with a
    // URL OBJECT loses it. A double must answer with a string, as the platform
    // does.
    {
      label: "a URL object becomes the empty string",
      raw: new URL("https://a.test/"),
      expected: "",
    },
  ];

  test.each(urlRows)("RI-11: url — $label", ({ raw, expected }) => {
    const { response } = countingResponse({ status: [599], url: [raw] });

    let identity: ResponseIdentity | undefined;
    expect(() => {
      identity = identityOf(response);
    }).not.toThrow();

    expect(identity?.url).toBe(expected);
    expect(typeof identity?.url).toBe("string");
  });
});

describe("lendIdentity — an inherited identity, for one construction only", () => {
  test("RI-13: a live loan is answered with, and the response is never read", () => {
    const { response, counts } = countingResponse({
      status: [404],
      statusText: ["Not Found"],
      url: ["https://branch.test/x"],
    });
    const lent = seededIdentity();

    const revoke = lendIdentity(response, lent);

    // Read MANY times inside one construction: `BaseHttpError` reads it, then
    // `UnknownHttpError` reads it again. A take-once channel would give the
    // second reader a fresh read of the branch.
    expect(identityOf(response)).toBe(lent);
    expect(identityOf(response)).toBe(lent);
    // The point of the handoff: the branch is never asked what it thinks it is.
    expect(counts).toEqual({ status: 0, statusText: 0, url: 0, headers: 0 });

    revoke();
  });

  test("RI-14: first claim wins — a loan cannot shadow an identity already read", () => {
    const { response } = countingResponse({ status: [404], statusText: ["Not Found"] });

    const first = identityOf(response);
    const revoke = lendIdentity(response, seededIdentity());

    // A loan must not be able to rewrite an identity this library has already
    // answered with.
    expect(identityOf(response)).toBe(first);
    expect(identityOf(response).status).toBe(404);

    revoke();
    expect(identityOf(response)).toBe(first);
  });

  test("RI-15: neither the loan nor its revoke throws for a non-object key", () => {
    // This is the invariant `clone()` depends on, twice over. The branch is
    // already teed at that call site, so a throw at the loan would orphan it and
    // `cancel()` on the original error would wait forever — and the revoke runs
    // in a `finally`, where a throw would replace the exception the caller is
    // already handling.
    let revoke: (() => void) | undefined;
    expect(() => {
      revoke = lendIdentity("not an object" as unknown as Response, seededIdentity());
    }).not.toThrow();
    expect(() => revoke?.()).not.toThrow();
  });

  test("RI-18: the revoke leaves the response exactly as this module found it", () => {
    // THE GUARD, and the reason the handoff is a loan rather than a record.
    //
    // A custom Fetch implementation can answer `clone()` with a `Response` it
    // did not create — a real one that a later, unrelated request will resolve.
    // A permanent record would bind that `Response` to the cloning error's
    // identity for as long as it lives, so the later request would report 418
    // here instead of its own 200.
    const { response } = countingResponse({
      status: [200],
      statusText: ["OK"],
      url: ["https://victim.test/x"],
    });

    lendIdentity(response, seededIdentity())();

    expect(statusOf(response)).toBe(200);
    expect(identityOf(response).status).toBe(200);
    expect(identityOf(response).statusText).toBe("OK");
    expect(identityOf(response).url).toBe("https://victim.test/x");
  });

  test("RI-19: statusOf never answers with a live loan", () => {
    // `statusOf` is the read on the SUCCESS path: `typedFetch` calls it for
    // every resolved response, including every 200. It is also the exact read a
    // poisoned table would reach. `identityOf` answers from the loan before it
    // would ever call `statusOf`, so honoring one here would buy nothing and
    // would put the inherited answer on the one path that reaches a later
    // request.
    const { response } = countingResponse({ status: [200] });

    const revoke = lendIdentity(response, seededIdentity());

    expect(statusOf(response)).toBe(200);

    revoke();
  });

  test("RI-20: a revoke removes only its own loan, and is idempotent", () => {
    // `clone()` hands the branch to CONSUMER code, which can clone again before
    // it builds the copy. Nested loans on one response must not let the inner
    // revoke strand the outer one, or the outer revoke remove a live inner loan.
    const { response } = countingResponse({ status: [200] });

    const revokeOuter = lendIdentity(response, seededIdentity({ status: 418 }));
    const revokeInner = lendIdentity(response, seededIdentity({ status: 451 }));

    // The table holds the INNER loan, so the outer revoke has nothing to remove.
    revokeOuter();
    expect(identityOf(response).status).toBe(451);

    revokeInner();
    expect(identityOf(response).status).toBe(200);

    expect(revokeInner).not.toThrow();
    expect(identityOf(response).status).toBe(200);
  });
});

describe("statusOf — the documented residual", () => {
  test("RI-16: a primitive resolved value cannot be cached, and is not", () => {
    // A `WeakMap` refuses a primitive key. An injected `fetch` that resolves a
    // STRING whose prototype was polluted with a `status` getter therefore gets
    // one read per call rather than one read per response. Every other
    // guarantee this library makes about an injected implementation is equally
    // void for a polluted `String.prototype`, so this is a known limit, tested
    // so it stays one.
    let reads = 0;
    // oxlint-disable-next-line no-extend-native -- polluting it IS the test
    Object.defineProperty(String.prototype, "status", {
      configurable: true,
      get() {
        reads += 1;
        return 404;
      },
    });

    try {
      const value = "a string" as unknown as Response;

      expect(statusOf(value)).toBe(404);
      expect(statusOf(value)).toBe(404);
      expect(reads).toBe(2);
    } finally {
      delete (String.prototype as unknown as Record<string, unknown>).status;
    }
  });
});
