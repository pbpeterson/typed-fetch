import { describe, it, expect } from "vitest";
import {
  isHttpError,
  isNetworkError,
  isAbortError,
  isTimeoutError,
  isKnownHttpError,
} from "./src/index";
import {
  AbortedError,
  BaseHttpError,
  NetworkError,
  NotFoundError,
  TimeoutError,
} from "./src/errors";
import { inspectCustom } from "./src/errors/inspect";
import {
  abortedErrorBrand,
  asksOwnsResponse,
  hasBrand,
  httpErrorBrand,
  networkErrorBrand,
  ownsResponseSymbol,
  timeoutErrorBrand,
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

  // The brand read walks the prototype chain, which is what carries it across
  // package copies — and what made `Object.prototype` a place to write one.
  // One write turned every guard into a constant `true`, so the README's own
  // pattern (`if (isHttpError(error)) await error.cancel()`) threw a TypeError
  // inside error handling. No real error inherits its brand from
  // `Object.prototype`, so refusing that source costs the mechanism nothing.
  describe("a polluted Object.prototype cannot forge a brand", () => {
    const brands = [
      "BaseHttpError",
      "KnownHttpError",
      "NetworkError",
      "AbortedError",
      "TimeoutError",
    ] as const;

    function withPollutedPrototypes<T>(run: () => T): T {
      const written = brands.map((name) => Symbol.for(`@pbpeterson/typed-fetch.${name}`));
      const proto = Object.prototype as unknown as Record<symbol, unknown>;
      for (const key of written) proto[key] = true;
      try {
        return run();
      } finally {
        for (const key of written) delete proto[key];
      }
    }

    it("every guard still refuses a value that is not an error", () => {
      withPollutedPrototypes(() => {
        for (const value of [{}, { not: "an error" }, [], () => {}, new Error("plain")]) {
          expect(isHttpError(value)).toBe(false);
          expect(isKnownHttpError(value)).toBe(false);
          expect(isNetworkError(value)).toBe(false);
          expect(isAbortError(value)).toBe(false);
          expect(isTimeoutError(value)).toBe(false);
        }
      });
    });

    it("a real error is still recognized while the prototype is polluted", () => {
      const error = new NotFoundError(new Response(null, { status: 404 }));

      withPollutedPrototypes(() => {
        expect(isHttpError(error)).toBe(true);
        expect(isKnownHttpError(error)).toBe(true);
        expect(isNetworkError(error)).toBe(false);
      });
    });

    // The fallback walks a chain the CALLER supplies. The engine refuses a
    // cyclic prototype chain on ordinary objects, but `[[GetPrototypeOf]]` on a
    // Proxy over an extensible target is checked against no invariant: the trap
    // can answer with the proxy itself forever. Nothing throws, so no `try`
    // catches it, and `isHttpError` never returns. Trading a wrong answer for a
    // stalled process is not a fix.
    it("a cyclic prototype chain is bounded, not walked forever", () => {
      let steps = 0;
      const cyclic: object = new Proxy(
        {},
        {
          getPrototypeOf(target) {
            steps += 1;
            if (steps > 5_000) return Object.getPrototypeOf(target) as object;
            return cyclic;
          },
        },
      );

      withPollutedPrototypes(() => {
        expect(isHttpError(cyclic)).toBe(false);
      });

      expect(steps).toBeLessThan(100);
    });

    it("a throwing getPrototypeOf trap answers false and never propagates", () => {
      const hostile = new Proxy(
        {},
        {
          getPrototypeOf() {
            throw new Error("prototype refused");
          },
        },
      );

      withPollutedPrototypes(() => {
        expect(() => isHttpError(hostile)).not.toThrow();
        expect(isHttpError(hostile)).toBe(false);
      });
    });

    it("a foreign copy's error is still recognized — the cross-copy read holds", () => {
      // What the prototype-chain read exists for: a value branded on its OWN
      // prototype, by a copy this one never loaded.
      const foreignPrototype = Object.defineProperty({}, httpErrorBrand, {
        value: true,
        enumerable: false,
      });
      const foreign = Object.create(foreignPrototype) as object;

      expect(isHttpError(foreign)).toBe(true);
      withPollutedPrototypes(() => {
        expect(isHttpError(foreign)).toBe(true);
      });
    });
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

  // The read walks the prototype chain, exactly as the brand read does, so one
  // polluting write of this symbol answered for EVERY value — and this answer
  // releases custody of a teed branch. A non-owner accepted here orphans the
  // branch: nothing can cancel it, and `cancel()` on the original never
  // settles. `hasBrand` refuses a brand from `Object.prototype`; this had no
  // such guard.
  describe("a polluted Object.prototype cannot answer for a value", () => {
    function withPollutedOwnership<T>(run: () => T): T {
      const proto = Object.prototype as unknown as Record<symbol, unknown>;
      proto[ownsResponseSymbol] = () => true;
      try {
        return run();
      } finally {
        delete proto[ownsResponseSymbol];
      }
    }

    it("a plain object still cannot answer", () => {
      withPollutedOwnership(() => {
        expect(asksOwnsResponse({}, candidate())).toBeUndefined();
        expect(asksOwnsResponse(new Error("plain"), candidate())).toBeUndefined();
        expect(asksOwnsResponse(() => {}, candidate())).toBeUndefined();
      });
    });

    it("a value that owns the member on its own prototype still answers", () => {
      // What the prototype-chain read exists for: `stampOwnsResponse` puts the
      // member on `BaseHttpError.prototype`, including a foreign copy's.
      const owner = withMember(() => true);

      withPollutedOwnership(() => {
        expect(asksOwnsResponse(owner, candidate())).toBe(true);
      });
    });
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

// ═══════════════════════════════════════════════════════════════════════════
// ROUND 7 — the pollution guard asked for a VALUE, and a value read has a
// receiver.
//
// An accessor on `Object.prototype` answers `undefined` when `this` is
// `Object.prototype` and the payload for every other receiver, so the guard saw
// a clean prototype and the next line resolved the polluted member through the
// chain. Every brand guard became a constant `true`, and `asksOwnsResponse`
// answered "yes" for a value that owns nothing — which orphans a teed branch
// and leaves `cancel()` pending forever. The blocks the previous round wrote
// cover only the data-property shape.
// ═══════════════════════════════════════════════════════════════════════════

function polluteWithAccessor(key: symbol, payload: () => unknown): () => void {
  Object.defineProperty(Object.prototype, key, {
    get(this: unknown) {
      if (this === Object.prototype) return undefined;
      return payload();
    },
    configurable: true,
  });
  return () => {
    delete (Object.prototype as Record<symbol, unknown>)[key];
  };
}

describe("round 7 lane 2 — a polluting ACCESSOR walks past the Object.prototype guard", () => {
  it("D1: hasBrand answers true for a plain object", () => {
    const restore = polluteWithAccessor(httpErrorBrand, () => true);
    let probeRead: unknown;
    let answer: boolean;
    try {
      probeRead = (Object.prototype as Record<symbol, unknown>)[httpErrorBrand];
      answer = hasBrand({}, httpErrorBrand);
    } finally {
      restore();
    }

    // What the guard itself sees: nothing.
    expect(probeRead).toBeUndefined();
    // What every other receiver sees: the forged brand. `hasBrand` must still
    // refuse it — `Object.prototype` is a source no real error uses.
    expect(answer).toBe(false);
  });

  it("D2: every brand-keyed guard turns into a constant true", () => {
    const answers: Record<string, boolean> = {};
    const restores = [
      polluteWithAccessor(httpErrorBrand, () => true),
      polluteWithAccessor(networkErrorBrand, () => true),
      polluteWithAccessor(abortedErrorBrand, () => true),
      polluteWithAccessor(timeoutErrorBrand, () => true),
    ];
    try {
      answers.isHttpError = isHttpError({});
      answers.isNetworkError = isNetworkError({});
      answers.isAbortError = isAbortError({});
      answers.isTimeoutError = isTimeoutError({});
    } finally {
      for (const restore of restores) restore();
    }

    // The README's own pattern is `if (isHttpError(error)) await error.cancel()`.
    // A constant `true` makes that line throw a TypeError inside a catch block,
    // which is the exact harm the round-3 guard was added to prevent.
    expect(answers).toEqual({
      isHttpError: false,
      isNetworkError: false,
      isAbortError: false,
      isTimeoutError: false,
    });
  });

  it("D3: asksOwnsResponse answers 'yes' for a value that owns nothing", () => {
    const candidate = new Response("x", { status: 404 });
    const restore = polluteWithAccessor(ownsResponseSymbol, () => () => true);
    let probeRead: unknown;
    let answer: boolean | undefined;
    try {
      probeRead = (Object.prototype as Record<symbol, unknown>)[ownsResponseSymbol];
      answer = asksOwnsResponse({}, candidate);
    } finally {
      restore();
    }

    expect(typeof probeRead).toBe("undefined");
    // A plain object carries no member under the key, so the only honest answer
    // is "it cannot answer".
    expect(answer).toBeUndefined();
  });

  it("D4: clone() accepts a non-owner, and the original's cancel() never settles", async () => {
    const error = new NotFoundError(new Response("body", { status: 404 }));
    const restore = polluteWithAccessor(ownsResponseSymbol, () => () => true);
    let outcome: string;
    try {
      await error.clone(() => ({ notAnError: true }) as never);
      outcome = "clone RESOLVED with the non-owner";
    } catch {
      outcome = "clone REFUSED";
    } finally {
      restore();
    }

    // The cost of accepting it: the teed source is never freed, so the original
    // error's own `cancel()` stays pending forever.
    const settled = await Promise.race([
      error.cancel().then(
        () => "cancel settled",
        () => "cancel settled",
      ),
      new Promise<string>((resolve) => setTimeout(() => resolve("cancel PENDING FOREVER"), 250)),
    ]);

    // The branch has no owner, so `clone()` must refuse it and release the
    // branch — ADR 0002.
    expect([outcome, settled]).toEqual(["clone REFUSED", "cancel settled"]);
  });

  it("D5: the proposed fix — a PRESENCE check — refuses both shapes", () => {
    // `Object.getOwnPropertyDescriptor` takes no receiver, so an accessor
    // cannot answer it selectively. This is the one-line replacement for both
    // guard reads in `src/errors/brand.ts`.
    const polluted = (key: symbol): boolean =>
      Object.getOwnPropertyDescriptor(Object.prototype, key) !== undefined;

    const seen: Record<string, boolean> = {};
    let restore = polluteWithAccessor(httpErrorBrand, () => true);
    try {
      seen.accessorDetected = polluted(httpErrorBrand);
    } finally {
      restore();
    }
    Object.defineProperty(Object.prototype, httpErrorBrand, { value: true, configurable: true });
    try {
      seen.dataDetected = polluted(httpErrorBrand);
    } finally {
      delete (Object.prototype as Record<symbol, unknown>)[httpErrorBrand];
    }
    seen.cleanNotDetected = !polluted(httpErrorBrand);

    expect(seen).toEqual({ accessorDetected: true, dataDetected: true, cleanNotDetected: true });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ROUND 7 — the stamp map, as an executable statement.
//
// Every symbol-keyed member this library stamps, with its descriptor flags.
// The asymmetry is a design decision recorded in CONTEXT.md's third channel
// corollary: the brands and the ownership query are frozen, because a replaced
// answer to "do you own this branch?" strands a stream only that method can
// vouch for; the inspect hook stays replaceable, because a consumer may
// legitimately install their own. A descriptor that drifts is a red test.
//
// "Frozen" is not "unshadowable", and the last case says so: the flags lock the
// property on THAT object, and a subclass prototype may still own its own. That
// is the "believed, not proved" residual restated for the query.
// ═══════════════════════════════════════════════════════════════════════════

describe("the stamp map", () => {
  const FROZEN = [
    ["BaseHttpError brand", BaseHttpError.prototype, httpErrorBrand],
    ["NetworkError brand", NetworkError.prototype, networkErrorBrand],
    ["AbortedError brand", AbortedError.prototype, abortedErrorBrand],
    ["TimeoutError brand", TimeoutError.prototype, timeoutErrorBrand],
    ["the ownership query", BaseHttpError.prototype, ownsResponseSymbol],
  ] as const;

  it.each(FROZEN)("%s is non-enumerable, non-writable, non-configurable", (_name, target, key) => {
    const descriptor = Object.getOwnPropertyDescriptor(target, key);

    expect(descriptor).toBeDefined();
    expect(descriptor?.enumerable).toBe(false);
    expect(descriptor?.writable).toBe(false);
    expect(descriptor?.configurable).toBe(false);
  });

  it.each(FROZEN)("%s refuses both a redefine and an assignment", (_name, target, key) => {
    const before = (target as unknown as Record<symbol, unknown>)[key];

    expect(() => Object.defineProperty(target, key, { value: "forged" })).toThrow(TypeError);
    // Non-strict assignment is silent; the value is what matters.
    expect(() => {
      (target as unknown as Record<symbol, unknown>)[key] = "forged";
    }).toThrow(TypeError);
    expect((target as unknown as Record<symbol, unknown>)[key]).toBe(before);
  });

  it("the inspect hook is replaceable, deliberately", () => {
    const descriptor = Object.getOwnPropertyDescriptor(BaseHttpError.prototype, inspectCustom);

    expect(descriptor).toBeDefined();
    expect(descriptor?.enumerable).toBe(false);
    expect(descriptor?.writable).toBe(true);
    expect(descriptor?.configurable).toBe(true);
  });

  it("a dedicated class owns no symbol of its own — every stamp is inherited", () => {
    // A computed class member keyed by a `Symbol.for` const would emit a
    // `unique symbol` into both declaration files and make the two copies of
    // every class mutually unassignable. Nothing is stamped per class.
    expect(Object.getOwnPropertySymbols(NotFoundError.prototype)).toEqual([]);
  });

  it("no stamped member is enumerable, so none reaches the crash dump", () => {
    for (const target of [
      BaseHttpError.prototype,
      NetworkError.prototype,
      AbortedError.prototype,
      TimeoutError.prototype,
    ]) {
      for (const key of Object.getOwnPropertySymbols(target)) {
        expect(Object.getOwnPropertyDescriptor(target, key)?.enumerable, String(key)).toBe(false);
      }
    }
  });

  it("frozen locks the property on that object, not on the chain", () => {
    // Stated rather than defended: a subclass prototype can own its own answer,
    // and the walk finds the nearest one first. That is the seam the ownership
    // query crosses — a protocol, not a proof.
    class Shadowing extends NotFoundError {}
    Object.defineProperty(Shadowing.prototype, ownsResponseSymbol, {
      value: () => true,
      configurable: true,
    });

    expect(Object.getOwnPropertyDescriptor(Shadowing.prototype, ownsResponseSymbol)).toBeDefined();
    expect(
      Object.getOwnPropertyDescriptor(BaseHttpError.prototype, ownsResponseSymbol)?.writable,
    ).toBe(false);
  });
});
