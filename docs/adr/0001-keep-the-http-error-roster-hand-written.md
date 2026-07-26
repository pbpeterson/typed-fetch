# 0001 — Keep the HTTP error roster hand-written

- **Status:** Accepted
- **Date:** 2026-07-25

## Context

`@pbpeterson/typed-fetch` ships 40 dedicated HTTP error classes — 29 client
(4xx) and 11 server (5xx). Each is a small hand-written file under
`src/errors/`, and each is registered by hand in several parallel lists:

1. the barrel export in `src/errors/index.ts`;
2. the import block in `src/errors/helpers.ts`;
3. the `httpErrors` array in `src/errors/helpers.ts`;
4. the `ClientErrors` union in `src/errors/helpers.ts`;
5. the `ServerErrors` union in `src/errors/helpers.ts`;
6. the import block plus map literal in `src/http-status-codes.ts`.

Six lists, each of which must agree with the other five. That duplication looks
like a candidate for a code generator or a generic factory, and it has
been proposed more than once. This ADR records why it stays hand-written.

### The duplication is not growing

The roster is not a maintenance treadmill. It is a closed set that was written
once and has not moved since.

- All 40 status classes landed in the **initial commit `28c6a04`
  (2025-07-11)**. The set of class names in `httpErrors` at `28c6a04` is
  **byte-identical** to the set at the time of writing — verified by diffing
  the two sorted rosters.
- In the **12.5 months** and **132 commits** (129 excluding merges) between
  that commit and this ADR, **zero** status classes were added or removed.
- The only `src/errors/*-error.ts` files added after the initial commit are
  **not** roster members: `unknown-http-error.ts` (`33c7bd8`),
  `aborted-error.ts` and `timeout-error.ts` (`d535ee4`), and
  `known-http-error.ts` (`7daa209`). Each is a structural error type, not an
  HTTP status code.

The upstream registry explains why. Against the IANA HTTP Status Code Registry
there are 38 registered 4xx/5xx codes, and this roster covers **all 38**, plus
two deliberate extras: `418 I'm a Teapot` (never registered) and
`510 Not Extended` (RFC 2774, since obsoleted and dropped from the registry).
The most recent 4xx/5xx code to be **newly** registered is **425 Too Early
(RFC 8470, 2018)**. RFC 9110 (2022) re-specified many existing codes but
introduced no new 4xx or 5xx code.

So the amortized cost of the hand-written roster is: six list edits, zero times
in 12.5 months, against an upstream that has not minted a new code in seven
years. A generator would be paying an ongoing cost to automate an event that
does not happen.

### A generic factory provably degrades the public contract

This was measured, not assumed. Emitting declarations with
`tsc --declaration` for a hand-written class and for the most favorable
possible generic factory (generic over the status/statusText literals, so the
literal types survive) gives:

Hand-written — a named class, 7 lines:

```
export declare class NotFoundError extends KnownHttpError {
    readonly name: "NotFoundError";
    readonly status: 404;
    readonly statusText: "Not Found";
    static readonly status: 404;
    static readonly statusText: "Not Found";
}
```

Factory — an anonymous object type, 20 lines:

```
export declare const NotFoundError: {
    new (response: Response): {
        readonly name: "NotFoundError";
        readonly status: 404;
        readonly statusText: "Not Found";
        readonly headers: Headers;
        readonly url: string;
        cancel(reason?: unknown): Promise<void>;
        json<T = unknown>(): Promise<T>;
        text(): Promise<string>;
        blob(): Promise<Blob>;
        arrayBuffer(): Promise<ArrayBuffer>;
        clone(recreate?: ((response: Response) => any) | undefined): any;
        message: string;
        stack?: string;
        cause?: unknown;
    };
    readonly status: 404;
    readonly statusText: "Not Found";
};
```

Four distinct regressions, all in the **published** `.d.ts`:

1. **`clone()` loses its type.** The hand-written signature is
   `clone(recreate?: (response: Response) => this): this`. Through the factory
   TypeScript cannot name the anonymous instance type, so the polymorphic
   `this` is elided to **`any`** in both the parameter and the return type.
   `error.clone().whateverYouLike` would compile. This is a silent, public
   type-safety loss on a documented method.
2. **The declaration is no longer a class.** `export declare class NotFoundError`
   becomes `export declare const NotFoundError: { new (...): {...} }`. IDE
   hover, go-to-definition, and any generated API reference show a wall of
   structure instead of a named class.
3. **`extends KnownHttpError` disappears.** The inheritance chain
   (`NotFoundError` → `KnownHttpError` → `BaseHttpError`) is absent
   from the emitted type. The relationship that the whole error hierarchy is
   built on stops being _stated_ in the public types.
4. **The entire `BaseHttpError` surface inlines into all 40 declarations.**
   Every class grows from a 7-line block to a 20-line block: **+13 lines each,
   roughly +520 lines** of published declarations, repeating `headers`, `url`,
   `cancel`, `json`, `text`, `blob`, `arrayBuffer`, `clone`, `message`,
   `stack`, and `cause` forty times over.

The five remaining lists exist to keep 40 _named, nominally-related, precisely
typed_ declarations in the published surface. The factory removes the
duplication by removing exactly the thing the duplication buys.

### It was already built, and reverted the same day

This is not a hypothetical. The generator was written, landed, and removed
within 84 minutes.

- **`31fa896`** (2026-07-09 12:51) — _"feat: codegen error classes with
  minifier-safe hardcoded names"_ — added **`scripts/generate-errors.ts`, 431
  lines**, generating the 40 class files, `src/errors/helpers.ts`, and
  `src/http-status-codes.ts` from a single `ERROR_TABLE`.
- **`6cc8c56`** (2026-07-09 14:15) — _"revert: remove code generator, keep
  hand-written error classes"_ — deleted it.

The revert commit records why, and the reasons are specific:

- **It could not do the one job it existed for.** Adding a 41st row to
  `ERROR_TABLE` and running the generator **crashed** on a hardcoded
  `ERROR_TABLE.length !== 40` assertion.
- **Bumping that guard then emitted non-compiling code.** The import and export
  orders were hand-maintained arrays _inside the generator_, not derived from
  `ERROR_TABLE` — so the new class was referenced in `helpers.ts`'s union and
  in the `httpErrors` array but never imported (`TS2304: Cannot find name`).
- **It never pruned orphaned files**, so removing a code left a stale class
  behind.
- **It relocated the duplication rather than removing it.** The six visible
  lists became four hidden ones inside the generator: `ERROR_TABLE`,
  `importOrder`, `exportOrder`, and the `!== 40` assertion — now invisible to
  the roster tests and to review.

The one genuine improvement from `31fa896` — a hardcoded
`override readonly name = "NotFoundError" as const` on every class, which
survives minification where `this.constructor.name` does not — was **kept**.
The revert removed the generator, not the fix.

### Drift is already impossible past CI

The duplication is safe because nothing must be remembered. The
`roster sync` block in the test suite is an independent second source of truth,
hand-authored in the tests rather than derived from `src/`:

- compile-time exhaustiveness of `InstanceType<HttpErrors>` against
  `ClientErrors | ServerErrors` — catches a class added to or dropped from a
  union;
- runtime cardinality and `httpErrors` ↔ `statusCodeErrorMap` agreement;
- **40 explicit per-class assertions** of the form
  `expectTypeOf<NotFoundError["status"]>().toEqualTypeOf<404>()` — the only
  construct that actually catches a _single_ class's literal being widened
  (verified empirically, and documented in the block comment above those
  tests);
- dist-gated checks that every roster class is exported from both public
  barrels.

Miss a step in the hand-edit workflow and CI fails, by name, pointing at the
list you forgot. The duplication is checked, not trusted.

## Decision

**The 40 HTTP error classes and the lists that register them stay
hand-written.** We will not generate them, collapse them into a generic
factory, or replace the per-class files with table-driven construction.

Adding a status code remains the documented hand-edit workflow in
`CONTRIBUTING.md`, backed by the `roster sync` tests.

This decision is about lists that carry information no other list holds. It
does **not** forbid deriving a list that is a pure projection of another.
Derive projections; keep declarations.

## Consequences

### Costs we accept

- Adding a status code touches five lists across three files plus a new class
  file, and the test roster. It is tedious, and the tedium is real.
- A contributor who does not read `CONTRIBUTING.md` will get it wrong the first
  time. CI catches it, but only after a failed run.
- The duplication looks like a defect to anyone reading `src/errors/` cold.
  That is precisely why this ADR exists — the cost of re-litigating it is now
  one link instead of one investigation.

### Benefits retained

- 40 named `declare class` declarations in the published `.d.ts`, each with its
  literal `status`/`statusText` and its real `extends` chain.
- `clone()` keeps its polymorphic `this` return type.
- Roughly 520 lines of published declarations not duplicated.
- `ClientErrors`/`ServerErrors` stay flat, readable unions of named classes.
- No build step, no generated-file/source-file skew, no `pnpm generate` to
  forget, and no fourth hidden copy of the roster inside a script.

### Explicitly _not_ claimed

Two arguments are commonly made in this direction and are **wrong**. They must
not be used to defend this decision:

- **"A factory would break class names and stack traces."** **False, and
  retired here.** `Object.defineProperty(C, "name", { value: "NotFoundError" })`
  reproduces the constructor's `name` exactly, and the instance `name`, the
  first line of `stack`, and `String(error)` are then **identical** to the
  hand-written class. Verified by direct execution. Separately, this library
  already sets instance `name` as a hardcoded literal field, which a factory
  would take as a parameter — so minifier-safety is unaffected either way. The
  case against a factory is the emitted **declaration**, not the runtime.
- **"Hand-writing prevents drift."** Backwards. Hand-writing _permits_ drift;
  the `roster sync` tests prevent it. If those tests were deleted, this
  decision would no longer be safe.

### Not evaluated here

Two adjacent ideas were considered alongside this one and rejected on their own
merits; neither is re-opened by this ADR:

- Deriving `ClientErrors`/`ServerErrors` from `httpErrors` with a conditional
  type. It works, but the emitted `.d.ts` becomes the conditional expression
  instead of a flat, readable union of 29 named classes — the same class of
  public-type degradation described above.
- Collapsing `helpers.ts`'s import block. It saves two lines and introduces an
  import cycle.

## What would change our mind

This decision is contingent on the evidence above, not on principle. Revisit it
if **any** of the following becomes true:

1. **The roster starts moving.** Three or more status classes added or removed
   within any twelve-month window. The core premise is that the set is closed;
   if it stops being closed, the amortized cost calculation flips.
2. **A generator that can actually add a code.** A concrete implementation that
   derives _every_ ordering (imports, exports, unions, array, map) from one
   table, prunes orphaned files, and is demonstrated end-to-end by adding a
   41st code and passing all gates unmodified. `31fa896` failed each of those
   four points; a proposal that passes them is a different proposal.
3. **TypeScript emits named class declarations from a factory.** If a future
   TypeScript version can emit `declare class NotFoundError extends
KnownHttpError` for a factory-produced class — preserving the `extends`
   clause and the polymorphic `this` on `clone()` — the entire declaration
   argument evaporates and the factory becomes strictly better. Re-run the
   `tsc --declaration` comparison in this ADR against the new compiler; if the
   two outputs match, supersede this ADR.
4. **The per-class files stop being trivial.** Today each class is six lines of
   literals. If real per-class behavior accumulates (custom messages,
   per-status parsing, retry hints), the duplication stops being mechanical and
   the trade-off must be re-costed — in either direction.
5. **The `roster sync` guardrail is weakened or removed.** The safety of this
   decision rests entirely on those tests. If they go, hand-maintenance is no
   longer defensible and something must replace them.

Superseding this ADR means writing a new one — see [README.md](./README.md).
Do not edit this file's argument.

## Amendments

An amendment records a fact that changed AFTER this ADR was accepted. It never
rewrites the Context, the Decision, or the Consequences above, which record what
was true and what was argued on the date in the header.

### 2026-07-25 — `statusCodeErrorMap` is now derived

Context item 6 listed `src/http-status-codes.ts` as one of six hand-maintained
lists. That list is gone. `statusCodeErrorMap` is now derived from `httpErrors`,
because every class already carries its own `static status`, so a second
hand-maintained copy could only ever disagree with it.

This follows the Decision rather than reversing it: the map was always a pure
projection, and the Decision protects only lists that carry information no other
list holds. Five such lists remain, and they stay hand-written.

Two statements above are stale as a result, and are left in place because this
section is the correct place to correct them:

- The cost calculation says "six list edits". It is five.
- The guardrail list names the `httpErrors` to `statusCodeErrorMap` agreement.
  Derivation makes that agreement unrepresentable, so the test proves nothing.
  The remaining guardrails are unaffected.
