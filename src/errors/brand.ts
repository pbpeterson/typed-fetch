/**
 * Cross-copy brand symbols for this library's root error classes.
 *
 * ## Why brands exist
 *
 * This package ships two entry points (`.` and `./errors`) and two module
 * formats (ESM + CJS). A consumer can end up with more than one *copy* of an
 * error class in the same process — e.g. `typedFetch` imported from the main
 * entry constructs a `NotFoundError` whose prototype comes from the main
 * entry's copy of `BaseHttpError`, while the consumer imported `BaseHttpError`
 * from `./errors`. Those are two distinct class objects, so a raw
 * `error instanceof BaseHttpError` is `false` even though the value *is* one.
 * The same hazard appears across the CJS/ESM boundary (the dual-package
 * hazard): `require()` and `import()` load independent package copies.
 *
 * `Symbol.for(key)` returns the *same* symbol for the same key across every
 * module copy and every realm in the process. Stamping a brand keyed by such a
 * symbol onto each root error prototype lets the type guards recognize an
 * instance regardless of which copy created it — without depending on class
 * identity.
 *
 * ## Scope of the fix
 *
 * The brands identify the runtime categories a consumer branches on:
 * {@link httpErrorBrand} (any 4xx/5xx), {@link knownHttpErrorBrand} (one of the
 * library's dedicated status classes), {@link unknownHttpErrorBrand} (the
 * catch-all subclass), {@link networkErrorBrand}, {@link abortedErrorBrand},
 * and {@link timeoutErrorBrand}. The library's guards key off these brands
 * instead of `instanceof`, so they work across copies and formats.
 *
 * Discriminating a *specific* HTTP subclass across copies (e.g.
 * `error instanceof NotFoundError` when the two came from different copies) is
 * deliberately NOT solved here — see the README. Use `isKnownHttpError` then
 * `switch (error.status)`, which works across package copies. `isKnownHttpError` also checks
 * the receiving copy's status map so a newer version's newly added status cannot
 * be narrowed to an older copy's union.
 */

/** Brand for any {@link BaseHttpError} subclass (all 4xx/5xx errors). */
export const httpErrorBrand: unique symbol = Symbol.for("@pbpeterson/typed-fetch.BaseHttpError");

/** Brand for one of the library's dedicated, literal-status HTTP errors. */
export const knownHttpErrorBrand: unique symbol = Symbol.for(
  "@pbpeterson/typed-fetch.KnownHttpError",
);

/**
 * Brand for {@link UnknownHttpError} specifically, preserving its identity
 * across module copies independently of the dedicated-error brand.
 */
export const unknownHttpErrorBrand: unique symbol = Symbol.for(
  "@pbpeterson/typed-fetch.UnknownHttpError",
);

/** Brand for {@link NetworkError}. */
export const networkErrorBrand: unique symbol = Symbol.for("@pbpeterson/typed-fetch.NetworkError");

/** Brand for {@link AbortedError}. */
export const abortedErrorBrand: unique symbol = Symbol.for("@pbpeterson/typed-fetch.AbortedError");

/** Brand for {@link TimeoutError}. */
export const timeoutErrorBrand: unique symbol = Symbol.for("@pbpeterson/typed-fetch.TimeoutError");

/**
 * Reads a brand off a value without triggering prototype getters on hostile
 * inputs beyond a plain property access, and without throwing on `null`/
 * primitives. Returns `true` only when the branded symbol resolves to the
 * literal `true` placed by {@link brand}. Property accesses that themselves
 * throw (Proxy `get` traps, hostile symbol-keyed getters) are caught and
 * return `false`.
 */
export function hasBrand(value: unknown, brandSymbol: symbol): boolean {
  if (value == null || (typeof value !== "object" && typeof value !== "function")) {
    return false;
  }
  try {
    return (value as Record<symbol, unknown>)[brandSymbol] === true;
  } catch {
    return false;
  }
}

/**
 * Stamps a non-enumerable brand onto a class prototype. Placed on the prototype
 * (not each instance) so it is inherited by subclasses and costs nothing per
 * instance. Non-enumerable so it never leaks into `JSON.stringify`, `{...err}`,
 * or `for...in`.
 */
export function brand(prototype: object, brandSymbol: symbol): void {
  Object.defineProperty(prototype, brandSymbol, {
    value: true,
    enumerable: false,
    writable: false,
    configurable: false,
  });
}

/**
 * The cross-copy ownership query: "do you own this exact `Response`?"
 *
 * ## Why a callable, and not a brand
 *
 * The brands above answer "what kind of thing is this?". That question has a
 * fixed answer per class, so a `true` placed on a prototype settles it. This
 * one asks about ONE instance and ONE `Response`, so only the instance can
 * answer it, and the answer has to be computed. A marker cannot carry it.
 *
 * ## Why it has to cross copies at all
 *
 * `clone()` tees the error body and hands the branch to a `recreate` callback.
 * The platform frees the teed source only once EVERY branch is read or
 * canceled, so `clone()` must know whether the returned copy actually took the
 * branch. Within one copy, the module-scoped body table answers it. Across
 * copies the table is blind, and the blindness used to be read as consent: a
 * callback returning an instance from another copy, built from a DIFFERENT
 * response, was accepted, the branch became an orphan, the platform never
 * freed the source, and `cancel()` on the original error never settled. One
 * pinned connection and one unreleased stream per cloned error, with no
 * recovery path.
 *
 * ## The key is a cross-VERSION protocol
 *
 * `Symbol.for` is global to the process, so every copy of this package — every
 * entry point, every module format, and every VERSION a consumer has installed
 * — resolves this key to one symbol. That makes the key, the argument, and the
 * return value a contract between package versions, not an implementation
 * detail. It must never change meaning. A future question about a branch gets
 * a NEW key; this one keeps answering "is `candidate` the response I took?"
 * with a boolean, forever.
 *
 * ## Stamped, never declared
 *
 * Placed on the prototype with `defineProperty`, exactly as {@link brand}
 * places a brand and `./inspect` places the inspect hook — never written as a
 * computed class member. A computed member keyed by a `Symbol.for` const emits
 * `declare const … : unique symbol` into BOTH declaration files, which are two
 * distinct unique symbols, and the two declarations of every error class stop
 * being mutually assignable (`TS2741`). That is the `#private` hazard the
 * header of `./base-http-error` exists to avoid, and a symbol must not
 * reintroduce it.
 */
export const ownsResponseSymbol: unique symbol = Symbol.for("@pbpeterson/typed-fetch.ownsResponse");

/** The signature every copy of this package stamps under {@link ownsResponseSymbol}. */
export type OwnsResponse = (this: unknown, candidate: Response) => boolean;

/**
 * Stamps the ownership query onto a class prototype. Frozen — `writable: false,
 * configurable: false`, the descriptor {@link brand} uses and NOT the one
 * `installInspect` uses. A consumer may legitimately replace their inspect
 * hook; nobody may replace the answer to "do you own this branch?", because a
 * replaced answer strands a body stream that only this method can vouch for.
 */
export function stampOwnsResponse(prototype: object, owns: OwnsResponse): void {
  Object.defineProperty(prototype, ownsResponseSymbol, {
    value: owns,
    enumerable: false,
    writable: false,
    configurable: false,
  });
}

/**
 * Asks `value` — which may come from ANY copy of this package, or from nothing
 * at all — whether it owns `candidate`.
 *
 * THREE answers, and the caller must treat them differently, because only one
 * of them is safe to accept and the other two need different messages:
 *
 * - `true`      — it answered yes.
 * - `false`     — it answered no, or it answered abnormally: the symbol read
 *                 threw, the call threw, or the result was not the literal
 *                 `true`. A value that throws when asked has still answered,
 *                 and the answer is not yes.
 * - `undefined` — it cannot answer: no member under the key, or a member that
 *                 is not callable. This is what an instance from a package
 *                 copy older than this one looks like from here.
 *
 * Hardened the way {@link hasBrand} is hardened, and for a sharper reason. The
 * caller RELEASES a teed branch on the strength of this answer, so a hostile
 * value must not be able to make the call throw past the caller's guard and
 * strand the branch that way. Every failure mode is mapped onto a concrete
 * answer here, and this function never throws.
 *
 * The conservative direction is DOWN. `claimsThisCopy` in `./base-http-error`
 * fails UP — it returns `true` on a throw — because there the conservative
 * outcome is "claims this copy", which leads to a rejection. Here the
 * conservative outcome is "did not confirm", which also leads to a rejection.
 * Both fail toward refusing the clone.
 */
export function asksOwnsResponse(value: unknown, candidate: Response): boolean | undefined {
  if (value == null || (typeof value !== "object" && typeof value !== "function")) {
    return undefined;
  }
  let member: unknown;
  try {
    member = (value as Record<symbol, unknown>)[ownsResponseSymbol];
  } catch {
    // A Proxy `get` trap or a hostile symbol-keyed getter. It refused to be
    // read, which is not a yes.
    return false;
  }
  if (typeof member !== "function") return undefined;
  try {
    // The literal `true` only, exactly as `hasBrand` requires the literal
    // `true`: a truthy `1` or `"yes"` is not an answer this library asked for.
    return (member as OwnsResponse).call(value, candidate) === true;
  } catch {
    return false;
  }
}
