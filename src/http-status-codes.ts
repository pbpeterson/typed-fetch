import { HttpErrors, httpErrors } from "./errors/helpers";

/**
 * Maps HTTP status codes (400-511) to their corresponding error class
 * constructors.
 *
 * DERIVED, not hand-maintained, and deliberately so. Every class in
 * `httpErrors` already carries its own `static status` as a literal — that
 * field is the single authority on which code a class answers to. A second
 * hand-written `[404, NotFoundError]` list could never *add* information; the
 * only state it could reach that this derivation cannot is DISAGREEMENT with
 * the classes' own `static status`, which is precisely the bug the roster-sync
 * tests existed to catch. Deriving the map makes that state unrepresentable
 * instead of merely tested, and removes one of the parallel lists a new status
 * code used to have to be registered in (see
 * `docs/adr/0001-keep-the-http-error-roster-hand-written.md`, which explains
 * why the *remaining* lists stay hand-written: they carry declarations, this
 * one was only ever a projection).
 *
 * Iteration order is `httpErrors` order (alphabetical by class name), not
 * ascending status code. Nothing depends on it: both call sites in
 * `src/index.ts` are key lookups — `.has()` in `isKnownHttpError` and `.get()`
 * in `typedFetch`.
 *
 * INTERNAL. It is re-exported from no barrel — not `src/errors/index.ts`, not
 * `src/index.ts`, not the root `index.ts` — and so is not part of the public
 * API. Consumers read `error.status` off the error instance instead. It is
 * typed `ReadonlyMap` so it is not mutated internally either.
 */
export const statusCodeErrorMap: ReadonlyMap<number, HttpErrors> = new Map(
  httpErrors.map((ErrorClass) => [ErrorClass.status, ErrorClass]),
);
