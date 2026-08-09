import { describe, test, expect } from "vitest";
import {
  hasTypedResponseIdentityScalars,
  headersOf,
  identityOf,
  lendIdentity,
  statusOf,
  type ResponseIdentity,
} from "../../src/errors/response-identity";
import { NotFoundError, UnknownHttpError } from "../../src/errors";
import { typedFetch } from "../../src/index";
import { foreignResponses } from "../../fixtures/responses";

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

describe("statusOf — the first successful read is recorded per response", () => {
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

describe("identityOf — the first successful field reads are recorded per response", () => {
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

  test("RI-18: fields read before a failing headers getter stay recorded", () => {
    const cause = new Error("headers getter exploded");
    const laterHeaders = new Headers({ "x-later": "2" });
    const { response, counts } = countingResponse({
      status: [420, 421],
      statusText: ["FIRST", "SECOND"],
      url: ["https://first.test/x", "https://second.test/y"],
      headers: [throwing(cause), laterHeaders],
    });

    expect(() => identityOf(response)).toThrow(cause);

    const identity = identityOf(response);
    expect(identity).toEqual({
      status: 420,
      statusText: "FIRST",
      url: "https://first.test/x",
      headers: laterHeaders,
    });
    expect(counts).toEqual({ status: 1, statusText: 1, url: 1, headers: 2 });
  });

  test("RI-19: statusText stays recorded when the first url read fails", () => {
    const cause = new Error("url getter exploded");
    const { response, counts } = countingResponse({
      status: [420, 421],
      statusText: ["FIRST", "SECOND"],
      url: [throwing(cause), "https://second.test/y"],
    });

    expect(() => identityOf(response)).toThrow(cause);

    const identity = identityOf(response);
    expect(identity.status).toBe(420);
    expect(identity.statusText).toBe("FIRST");
    expect(identity.url).toBe("https://second.test/y");
    expect(counts).toEqual({ status: 1, statusText: 1, url: 2, headers: 1 });
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

  test("RI-21: a loan cannot shadow fields recorded before a later getter failed", () => {
    const cause = new Error("headers getter exploded");
    const { response, counts } = countingResponse({
      status: [420, 421],
      statusText: ["FIRST", "SECOND"],
      url: ["https://first.test/x", "https://second.test/y"],
      headers: [throwing(cause), new Headers({ "x-later": "2" })],
    });

    expect(() => identityOf(response)).toThrow(cause);

    const revoke = lendIdentity(response, seededIdentity({ status: 404 }));
    const identity = identityOf(response);

    expect(identity.status).toBe(420);
    expect(identity.statusText).toBe("FIRST");
    expect(identity.url).toBe("https://first.test/x");
    expect(identity.headers.get("x-later")).toBe("2");
    expect(counts).toEqual({ status: 1, statusText: 1, url: 1, headers: 2 });

    revoke();
    expect(identityOf(response)).toBe(identity);
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

  test("RI-22: the revoke leaves the response exactly as this module found it", () => {
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

  test("RI-23: statusOf never answers with a live loan", () => {
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

describe("statusOf — defensive input outside the typedFetch contract", () => {
  test("RI-16: a primitive cannot be cached, and is not", () => {
    // `typedFetch` rejects a primitive before this internal function. Keep the
    // function total when a direct caller violates its declared Response type:
    // read once per call and do not fail because WeakMap cannot key the value.
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

// ═══════════════════════════════════════════════════════════════════════════
// ROUND 4 — the branches no test had ever taken.
//
// Every case below closes a branch the coverage report listed as unreached.
// Writing them was the bug hunt: a branch nobody exercises is where a wrong
// guard hides. None of them found one, so each is a regression test for a
// guard that was already right and undefended.
// ═══════════════════════════════════════════════════════════════════════════

const ROUND4_URL = "https://round4.test/resource";

/** A response-shaped foreign object that passes every structural check. */
const foreignResponse = foreignResponses(ROUND4_URL);

const resolving = (value: unknown): typeof fetch =>
  (async () => value as Response) as unknown as typeof fetch;

// src/errors/response-identity.ts — the NON-KEYABLE paths.
//
// `keyable()` is false only for `null`, `undefined`, and the primitives. No
// value of that kind reaches this module through the `fetch` seam: `isResponse`
// refuses a primitive resolved value before any identity is read, and `clone()`
// refuses a primitive branch before it builds anything from it. Both refusals
// are pinned as controls at the bottom of this block.
//
// What remains is the module's own exported interface, which is also its test
// surface, and the public error constructors a JavaScript caller can hand a
// non-`Response` to. Those are the only callers these branches have.
// ──────────────────────────────────────────────────────────────────────────
describe("response-identity: a value that cannot key a WeakMap", () => {
  test("identityOf answers with the normalized identity and files nothing", () => {
    const identity = identityOf(42 as unknown as Response);

    expect(Number.isNaN(identity.status)).toBe(true);
    expect(identity.statusText).toBe("");
    expect(identity.url).toBe("");
    // `headersOf` passes the value through untouched on this path, and a
    // primitive has no `headers`, so the record carries `undefined` where its
    // type promises `Headers`. `BaseHttpError` survives it because
    // `new Headers(undefined)` is an empty `Headers`.
    expect(identity.headers).toBeUndefined();
  });

  test("headersOf reads straight through for a non-keyable value", () => {
    expect(headersOf(42 as unknown as Response)).toBeUndefined();
  });

  test("hasTypedResponseIdentityScalars refuses a non-keyable value", () => {
    expect(hasTypedResponseIdentityScalars(42 as unknown as Response)).toBe(false);
  });

  test("an error class built from a non-Response still constructs", () => {
    const error = new NotFoundError(42 as unknown as Response);

    expect(error.status).toBe(404);
    expect(error.url).toBe("");
    expect([...error.headers.keys()]).toEqual([]);
    expect(error.toJSON().url).toBe("");
  });

  test("CONTROL: the fetch seam refuses a primitive before any identity read", async () => {
    const { response, error } = await typedFetch(ROUND4_URL, { fetch: resolving(42) });

    expect(response).toBeNull();
    expect(error?.name).toBe("NetworkError");
  });

  test("CONTROL: clone() refuses a primitive branch before it builds a copy", async () => {
    const { error } = await typedFetch(ROUND4_URL, {
      fetch: resolving(foreignResponse({ status: 404, clone: () => 42 })),
    });

    expect(error?.name).toBe("NotFoundError");
    expect(() => (error as NotFoundError).clone()).toThrow(TypeError);
  });

  test("CONTROL: nothing is recorded on the non-keyable path, so reads are not deduplicated", () => {
    // A primitive has no own properties, so the only way to make its reads
    // shift is to write an accessor onto the wrapper prototype — the caller
    // attacking its own realm, with a value the `Response` type already forbids.
    // The point of the control is the READ COUNT, not the attack: two reads
    // happen where a keyable response gets one.
    const answers = [500, 404, 599];
    let reads = 0;
    // oxlint-disable-next-line no-extend-native -- the control removes it again below
    Object.defineProperty(String.prototype, "status", {
      configurable: true,
      get() {
        return answers[Math.min(reads++, answers.length - 1)];
      },
    });
    try {
      // `BaseHttpError` reads the identity, `UnknownHttpError` reads it again.
      const error = new UnknownHttpError("x" as unknown as Response);

      expect(reads).toBe(2);
      expect(error.status).toBe(404);
    } finally {
      // @ts-expect-error - removing the accessor this control installed
      delete String.prototype.status;
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────
// src/errors/response-identity.ts — stageIdentity's rollback.
//
// The rollback removes only what THIS call recorded. A field fixed by an
// earlier ACCEPTED call is that response's identity and stays — the property
// the ledger names TF-20, and the arm no test had reached.
// ──────────────────────────────────────────────────────────────────────────
describe("response-identity: a refused call does not delete an earlier accepted record", () => {
  test("a value accepted once keeps its identity through a later refusal", async () => {
    let type: unknown = "basic";
    const shared: Record<string, unknown> = {
      ...(foreignResponse() as unknown as Record<string, unknown>),
      headers: new Headers([["x-round4", "1"]]),
    };
    Object.defineProperty(shared, "type", { configurable: true, get: () => type });
    const fetchImpl = resolving(shared);

    const first = await typedFetch(ROUND4_URL, { fetch: fetchImpl });
    expect(first.error).toBeNull();
    expect(first.response?.status).toBe(200);

    // The same object, refused this time on `type` — a read that is NOT
    // identity-cached, so the refusal happens after the identity reads.
    type = "not-a-response-type";
    const second = await typedFetch(ROUND4_URL, { fetch: fetchImpl });
    expect(second.response).toBeNull();
    expect(second.error?.name).toBe("NetworkError");

    // Healthy again. The identity the first ACCEPTED call fixed is still the
    // answer, so the refusal in between deleted none of it.
    type = "basic";
    shared.status = 404;
    const third = await typedFetch(ROUND4_URL, { fetch: fetchImpl });
    expect(third.error).toBeNull();
    expect(third.response?.headers.get("x-round4")).toBe("1");
  });
});

// ──────────────────────────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════════════
// ROUND 4 — the reason-phrase filter at the recording seam
//
// Round 3 fixed one channel per commit. These cases ask what the SIBLING
// channel of each fix does, which is where rounds 2 and 3 both found their
// defects.
// ═══════════════════════════════════════════════════════════════════════════

describe("C1 — safeReasonPhrase (83064b0) keeps ZWJ/ZWNJ and drops every reorderer", () => {
  function reasonOf(statusText: string): string {
    const response = new Response(null, { status: 404 });
    Object.defineProperty(response, "statusText", { value: statusText, configurable: true });
    return new UnknownHttpError(response).statusText;
  }

  test("ZWJ and ZWNJ survive", () => {
    expect(reasonOf("a\u200Cb\u200Dc")).toBe("a\u200Cb\u200Dc");
  });

  test("every neighbour of the range the commit split still goes", () => {
    expect(reasonOf("a\u200Bb")).toBe("ab"); // ZWSP
    expect(reasonOf("a\u200Eb")).toBe("ab"); // LRM
    expect(reasonOf("a\u200Fb")).toBe("ab"); // RLM
    expect(reasonOf("a؜b")).toBe("ab"); // ALM
    expect(reasonOf("a\u202Eb")).toBe("ab"); // RLO
    expect(reasonOf("a\u2066b\u2069c")).toBe("abc"); // LRI / PDI
    expect(reasonOf("a\u2060b\u2064c")).toBe("abc"); // word joiner / invisible plus
    expect(reasonOf("a\uFEFFb")).toBe("ab"); // BOM
    expect(reasonOf("a\u2028b\u2029c")).toBe("abc"); // LS / PS
    expect(reasonOf("a\u0000b\u001Bc\u007Fd\u009Fe")).toBe("abcde"); // C0 / ESC / DEL / C1
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

/** A real `Response` with one identity field shadowed by an own data property. */
function shadowed(status: number, props: Record<string, unknown>): Response {
  const response = new Response("payload", { status });
  for (const [key, value] of Object.entries(props)) {
    Object.defineProperty(response, key, { value, configurable: true });
  }
  return response;
}

describe("control — the reason-phrase filter is runtime-independent", () => {
  test.each([
    // [id, wire phrase, the phrase that must survive]
    // Escape sequences ONLY — a literal control or bidi character in a source
    // file is invisible to a reviewer, which is the property this filter exists
    // to deny an origin.
    ["escape sequence", "Not \u001b[2K\u001b[1A Found", "Not [2K[1A Found"],
    ["NUL", "a\u0000b", "ab"],
    ["C1", "a\u0080b\u009fc", "abc"],
    ["DEL", "a\u007fb", "ab"],
    ["bidi override", "a\u202eb", "ab"],
    ["bidi embeddings", "a\u202ab\u202bc", "abc"],
    ["bidi isolates", "a\u2066b\u2069c", "abc"],
    ["ALM", "a\u061cb", "ab"],
    ["zero-width space", "a\u200bb", "ab"],
    ["LRM and RLM", "a\u200e\u200fb", "ab"],
    ["BOM", "a\ufeffb", "ab"],
    ["invisible operators", "a\u2060\u2064b", "ab"],
    ["line and paragraph separators", "a\u2028b\u2029c", "abc"],
    // The half the filter deliberately KEEPS.
    ["ZWNJ and ZWJ are kept", "a\u200cb\u200dc", "a\u200cb\u200dc"],
    ["a combining mark is kept", "a\u0301b", "a\u0301b"],
    ["a lone surrogate is kept", "a\ud800b", "a\ud800b"],
  ])("%s", async (_id, wire, expected) => {
    const error = new UnknownHttpError(shadowed(499, { statusText: wire, url: "" }));
    expect(error.statusText).toBe(expected);
    expect(error.message).toBe(`HTTP 499 ${JSON.stringify(expected)}`);
    await error.cancel();
  });

  test("the phrase is bounded at 128 code units", async () => {
    const error = new UnknownHttpError(shadowed(499, { statusText: "y".repeat(200), url: "" }));
    expect(error.statusText).toBe("y".repeat(128));
    await error.cancel();
  });

  test("an astral phrase stops at the first code point that reaches the bound", async () => {
    const error = new UnknownHttpError(
      shadowed(499, { statusText: "\u{1f600}".repeat(90), url: "" }),
    );
    expect(error.statusText).toBe("\u{1f600}".repeat(64));
    await error.cancel();
  });
});
