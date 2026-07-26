import { describe, it, expect } from "vitest";
import {
  isHttpError,
  isNetworkError,
  isAbortError,
  isTimeoutError,
  isKnownHttpError,
} from "./src/index";
import { BaseHttpError, NotFoundError } from "./src/errors";
import {
  asksOwnsResponse,
  hasBrand,
  httpErrorBrand,
  ownsResponseSymbol,
  type OwnsResponse,
} from "./src/errors/brand";

describe("hardened brand reads", () => {
  it("guards return false for a Proxy whose get trap throws", () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("trap");
        },
      },
    );

    expect(() => isHttpError(hostile)).not.toThrow();
    expect(() => isNetworkError(hostile)).not.toThrow();
    expect(() => isAbortError(hostile)).not.toThrow();
    expect(() => isTimeoutError(hostile)).not.toThrow();
    expect(() => isKnownHttpError(hostile)).not.toThrow();

    expect(isHttpError(hostile)).toBe(false);
    expect(isNetworkError(hostile)).toBe(false);
    expect(isAbortError(hostile)).toBe(false);
    expect(isTimeoutError(hostile)).toBe(false);
    expect(isKnownHttpError(hostile)).toBe(false);
  });

  it("hasBrand returns false when a symbol-keyed getter throws", () => {
    const obj = Object.defineProperty({}, httpErrorBrand, {
      get() {
        throw new Error("hostile");
      },
    });

    expect(hasBrand(obj, httpErrorBrand)).toBe(false);
  });

  it("hasBrand still detects real branded instances", () => {
    const error = new NotFoundError(new Response(null, { status: 404 }));

    expect(hasBrand(error, httpErrorBrand)).toBe(true);
  });
});

// ── The cross-copy ownership query ───────────────────────────────────
//
// `clone()` RELEASES a teed branch on the strength of this answer, so the
// reader has one absolute requirement above every other: it must never throw.
// A hostile value that could throw past the caller's guard would strand the
// branch exactly the way the defect this query closes did.

/** The `Response` every query below is asked about. */
const candidate = () => new Response(null, { status: 404 });

/** Puts `member` under the ownership key on a fresh object. */
function withMember(member: unknown): object {
  return { [ownsResponseSymbol]: member };
}

/** The shapes that must all answer without throwing (A1–A9). */
const everyShape = (): unknown[] => [
  {},
  withMember(1),
  withMember("yes"),
  withMember(true),
  withMember({}),
  withMember(() => {
    throw new Error("member exploded");
  }),
  Object.defineProperty({}, ownsResponseSymbol, {
    get() {
      throw new Error("symbol read exploded");
    },
  }),
  new Proxy(
    {},
    {
      get() {
        throw new Error("trap");
      },
    },
  ),
  withMember(() => 1),
  withMember(() => false),
  withMember(() => true),
  null,
  undefined,
  42,
  "s",
  Symbol("s"),
];

describe("asksOwnsResponse — three answers, and never a throw", () => {
  it("A1: a value with no member under the key CANNOT answer", () => {
    // `undefined`, not `false`. This is what an instance from a package copy
    // older than this one looks like from here, and it needs its own message.
    expect(asksOwnsResponse({}, candidate())).toBeUndefined();
  });

  it("A2: a member that is not callable cannot answer either", () => {
    for (const member of [1, "yes", true, {}]) {
      expect(asksOwnsResponse(withMember(member), candidate())).toBeUndefined();
    }
  });

  it("A3: a member that throws has answered, and the answer is not yes", () => {
    const value = withMember(() => {
      throw new Error("member exploded");
    });

    expect(asksOwnsResponse(value, candidate())).toBe(false);
  });

  it("A4: a symbol-keyed getter that throws answers no", () => {
    const value = Object.defineProperty({}, ownsResponseSymbol, {
      get() {
        throw new Error("symbol read exploded");
      },
    });

    expect(asksOwnsResponse(value, candidate())).toBe(false);
  });

  it("A5: a Proxy whose get trap throws answers no", () => {
    const value = new Proxy(
      {},
      {
        get() {
          throw new Error("trap");
        },
      },
    );

    expect(asksOwnsResponse(value, candidate())).toBe(false);
  });

  it("A6: only the literal true is a yes", () => {
    // The same rule `hasBrand` applies to a brand: a truthy `1` or `"yes"` is
    // not an answer this library asked for.
    for (const result of [1, "yes", {}, []]) {
      expect(
        asksOwnsResponse(
          withMember(() => result),
          candidate(),
        ),
      ).toBe(false);
    }
  });

  it("A7: an explicit false is a no", () => {
    expect(
      asksOwnsResponse(
        withMember(() => false),
        candidate(),
      ),
    ).toBe(false);
  });

  it("A8: an explicit true is a yes", () => {
    expect(
      asksOwnsResponse(
        withMember(() => true),
        candidate(),
      ),
    ).toBe(true);
  });

  it("A9: a value that cannot carry a member cannot answer", () => {
    for (const value of [null, undefined, 42, "s", Symbol("s")]) {
      expect(asksOwnsResponse(value, candidate())).toBeUndefined();
    }
  });

  it("A10: the member is called once, on the value, with the Response alone", () => {
    const calls: Array<{ self: unknown; args: unknown[] }> = [];
    const value = withMember(function (this: unknown, ...args: unknown[]) {
      calls.push({ self: this, args });
      return true;
    });
    const response = candidate();

    asksOwnsResponse(value, response);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.self).toBe(value);
    expect(calls[0]?.args).toEqual([response]);
  });

  it("A11: no shape at all makes it throw", () => {
    // The invariant `clone()` depends on. A throw here would escape past the
    // caller's release and strand the teed branch.
    for (const value of everyShape()) {
      expect(() => asksOwnsResponse(value, candidate())).not.toThrow();
    }
  });
});

describe("the stamped ownership query", () => {
  it("A12: the descriptor is frozen on the prototype", () => {
    // `writable` and `configurable` are the security-relevant bits: a
    // replaceable answer strands a body stream that only this method can vouch
    // for. Mirrors the "brand descriptors are frozen" assertion in
    // guards.spec.ts, and deliberately uses the STRICTER descriptor the brands
    // use rather than the replaceable one the inspect hook uses.
    expect(Object.getOwnPropertyDescriptor(BaseHttpError.prototype, ownsResponseSymbol)).toEqual({
      value: expect.any(Function),
      enumerable: false,
      writable: false,
      configurable: false,
    });
  });

  it("A13: the key is the cross-version protocol, spelled exactly", () => {
    // A rename compiles, passes every other test in this repository, and
    // silently stops every OTHER copy of this package from answering — which
    // reopens the defect for exactly the population the query exists for.
    expect(ownsResponseSymbol).toBe(Symbol.for("@pbpeterson/typed-fetch.ownsResponse"));
    expect(Symbol.keyFor(ownsResponseSymbol)).toBe("@pbpeterson/typed-fetch.ownsResponse");
  });

  it("A14: a real error answers for its own response and no other", async () => {
    const response = new Response("payload", { status: 404 });
    const error = new NotFoundError(response);

    expect(asksOwnsResponse(error, response)).toBe(true);
    expect(asksOwnsResponse(error, new Response("elsewhere", { status: 404 }))).toBe(false);

    await error.cancel();
  });

  it("A15: the stamped method is total — detached, foreign this, junk candidate", async () => {
    const response = new Response("payload", { status: 404 });
    const error = new NotFoundError(response);
    const owns = (error as unknown as Record<symbol, OwnsResponse>)[ownsResponseSymbol]!;

    // `WeakMap.prototype.get` answers `undefined` for a key that is not an
    // object instead of throwing, and `owns` is an identity comparison, so
    // every one of these is a plain `false`.
    expect(owns.call(undefined, response)).toBe(false);
    expect(owns.call({}, response)).toBe(false);
    expect(owns.call(error, undefined as unknown as Response)).toBe(false);
    expect(() => owns.call(42, response)).not.toThrow();

    await error.cancel();
  });
});
