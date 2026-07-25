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
