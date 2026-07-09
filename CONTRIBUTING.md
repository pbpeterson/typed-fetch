# Contributing

Thanks for looking at `@pbpeterson/typed-fetch`. This is a small, zero-dependency
library — contributions should stay small and mechanical too.

## Prerequisites

- **Node.js >= 20** (`engines.node` in `package.json`).
- **pnpm**, pinned to an exact version via `packageManager` in `package.json`
  (currently `pnpm@10.33.0`). If you use [corepack](https://nodejs.org/api/corepack.html),
  it will pick up the pinned version automatically.

## Getting started

```bash
git clone https://github.com/pbpeterson/typed-fetch.git
cd typed-fetch
pnpm install
```

pnpm ignores dependencies' build scripts by default (a supply-chain safety
default). This package's devDependencies include `esbuild` (via `tsup`),
which has a build script. If something looks broken after install — e.g. the
build fails in a way that suggests `esbuild`'s native binary wasn't fetched —
run:

```bash
pnpm approve-builds
```

and approve `esbuild`.

## Branching

Never commit directly to `main`. Create a branch named `type/short-desc`
(kebab-case, e.g. `feat/typed-headers`, `fix/auth-expiry`) and open a PR.

## The gates

Before opening a PR, all of these must pass:

```bash
pnpm lint          # oxlint
pnpm format:check  # oxfmt --check
pnpm typecheck     # tsc --noEmit -p tsconfig.test.json
pnpm test          # vitest run
pnpm build          # tsup — confirm the package actually builds
pnpm check-docs     # typecheck every fenced TS block in the docs (run AFTER build)
pnpm verify-pack    # assert the published tarball's file manifest (run AFTER build)
pnpm check-consumer # pack + install the tarball, exercise it as a real consumer (run AFTER build)
```

Run them all locally; CI runs the same checks and will fail the PR otherwise.

If `pnpm format:check` fails, run `pnpm format` to fix it in place, then
re-check.

### Documentation examples are typechecked (`pnpm check-docs`)

`scripts/check-docs.mjs` extracts every fenced ` ```ts ` / ` ```typescript `
block from `README.md`, `CONTRIBUTING.md`, and both `SKILL.md` files, rewrites
the `@pbpeterson/typed-fetch` import to point at the **built `dist/`**, and
typechecks each block with the project's `tsc`. This is why it must run **after
`pnpm build`** — `dist/` is the compile target. If `dist/` is missing the guard
**fails loudly** rather than skipping. It exists because the README's headline
example once shipped broken (`error.status` read on the raw `TypedFetchError`
union, which includes `NetworkError` — a class with no `.status`) and three
rounds of "verify the examples" review never actually ran `tsc`.

**Skipping a block.** Some blocks legitimately cannot compile on their own — an
isolated body fragment that assumes `error` from a previous snippet, a bare type
expression, or a maintainer template full of placeholders (`NNN`, `XxxError`)
that imports a relative `./base-http-error` path. Mark the fence with the
`no-check` marker and the guard skips it:

````markdown
```ts no-check
// a fragment that intentionally does not compile standalone
if (error instanceof BadRequestError) {
  /* ... */
}
```
````

Every skip is **counted and printed** in the CI log, and the guard **fails if
more than half of all TS blocks are skipped** — a marker that everyone reaches
for is a marker that rots. Prefer making a block self-contained (add the missing
`type User` / import) over skipping it. Do not use `no-check` to silence a real
error; a newly-skipped headline block is glaringly visible in the printed skip
list.

**Limitation — compilation is necessary, not sufficient.** A block can typecheck
and still be wrong, so a green `check-docs` is not proof the docs are correct.
The clearest example lives in this repo: the maintainer skill's error-class
template omits `override readonly name = "..."`. That compiles fine, but under
minification the class name is mangled and the error's `.name` becomes garbage —
a real runtime bug this guard will **never** catch. When you edit an error-class
example, verify `override readonly name` is present by eye; `check-docs` won't.

### The packed tarball is consumed as a real user (`pnpm check-consumer`)

`scripts/check-consumer.mjs` closes a hole that no other test covers: **every
other test runs against `src/` or a single built entry point.** `test.spec.ts`
imports `./src/index`; the bun/deno smokes import `dist/index.mjs` (the main
entry only); the API-surface snapshot checks export _names_; `verify-pack`
checks file _paths_. None of them ever installs the artifact and runs it the
way a downstream user does. A whole class of packaging bugs is therefore
invisible to the 300+ test suite.

This gate (zero deps, plain Node, runs **after `pnpm build`**):

1. `npm pack`s the tarball into a temp dir.
2. Installs it into a throwaway consumer project (`npm install ./<tarball>`).
3. Exercises the **installed** package: ESM `import`, CJS `require`, the
   `./errors` subpath, cross-entry and cross-format `instanceof`/`isHttpError`,
   plus abort/timeout/injected-`fetch`/`Request`-first-arg behaviour.
4. Typechecks a consumer `.ts` against the install under **both**
   `moduleResolution: "bundler"` and `"nodenext"` (the nodenext pass doubles as
   an `attw`-style types-wiring check), using the repo's own `tsc`.

It cleans up all temp dirs and exits non-zero with a per-assertion report.

**`KNOWN_FAILING` (currently empty).** The script keeps a `KNOWN_FAILING` set at
the top for staging a fix: when an assertion encodes a contract the artifact
does not yet satisfy (e.g. cross-entry `instanceof` under a dual-bundle build),
put its id there and it is reported but does not fail CI, so the gate can land
green while the fix is in flight. The set is **self-policing** — if a
`KNOWN_FAILING` assertion starts **passing**, the gate fails with "KNOWN_FAILING
is stale", forcing you to delete the id. It is currently empty: every assertion
is enforced strictly. Never add an id to paper over a real regression, and never
leave a fixed bug's id behind.

**Contracts vs. limitations.** A handful of checks are _informational_ (`note`,
printed with `·`) rather than assertions — they document a limitation the
library deliberately does not promise to fix. The clearest is cross-**format**
`instanceof` (an ESM-minted error is never `instanceof` the CJS class copy):
that is an inherent property of the dual-package boundary, which is exactly why
the library brands its root error kinds and tells consumers to prefer
`isHttpError(...)` (and the other `is*` guards) over `instanceof`. Those guards
_are_ asserted to work across entries and formats.

## Adding a new HTTP status code

The 40 concrete error classes are plain, hand-written source. There is no
code generator — adding a status code is a mechanical edit across a fixed set
of files. It's a chore, but the **roster tests in `test.spec.ts` are the
safety net**: miss a step and one of them goes red (see the end of this
section for exactly which). Follow the existing 404 (`NotFoundError`) as a
template.

To add a new status code — say `NNN <Status Text>` as an `XxxError` client
error — do all of the following:

1. **Create the error class file** `src/errors/<kebab>-error.ts` (e.g.
   `not-found-error.ts`). Copy an existing sibling and change the class name,
   `status`, and `statusText`. Both the instance fields and the `static`
   fields must be `as const` literals:

   ```typescript no-check
   import { BaseHttpError } from "./base-http-error";

   /** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/NNN */
   export class XxxError extends BaseHttpError {
     override readonly name = "XxxError" as const;
     public readonly status = NNN as const;
     public readonly statusText = "<Status Text>" as const;
     static readonly status = NNN as const;
     static readonly statusText = "<Status Text>" as const;
   }
   ```

2. **Barrel-export it** from `src/errors/index.ts` — add
   `export { XxxError } from "./<kebab>-error";` alongside the others.

3. **Register it in `src/errors/helpers.ts`** in THREE places:
   - add the `import { XxxError } from "./<kebab>-error";` line;
   - add `XxxError` to the `httpErrors` array (keep it alphabetically sorted,
     as the array is);
   - add `| XxxError` to the correct union — `ClientErrors` for a 4xx,
     `ServerErrors` for a 5xx (both unions are alphabetically sorted).

4. **Map the status code in `src/http-status-codes.ts`** — add the
   `import { XxxError } from "./errors/<kebab>-error";` line and a
   `[NNN, XxxError],` entry to `statusCodeErrorMap` (entries are in
   ascending status-code order).

5. **Update `test.spec.ts`**:
   - add `{ Class: XxxError, status: NNN },` to the `allErrors` table (in
     status-code order);
   - bump the cardinality counts from `40` to `41` in the "roster cardinality
     is exactly 40" test, the "httpErrors contains all 40 error classes" test,
     and the "statusCodeErrorMap contains all 40 status codes" test;
   - add an explicit per-class assertion pair inside the "every class's status
     and statusText are their own literal type" test:
     ```typescript no-check
     expectTypeOf<XxxError["status"]>().toEqualTypeOf<NNN>();
     expectTypeOf<XxxError["statusText"]>().toEqualTypeOf<"<Status Text>">();
     ```

6. Run `pnpm format` to normalise the new files, then run the gates (above).

### The safety net

If you miss a step, the `test.spec.ts` roster tests fail — that is the whole
point of them:

- Forgetting to add the class to a `ClientErrors`/`ServerErrors` union (but
  leaving it in `httpErrors`) fails **typecheck** via the
  `"HttpErrors instance union matches ClientErrors | ServerErrors"` test.
- Dropping the class from the `httpErrors` array, or a mismatched
  status-code map entry, fails the **runtime**
  `"roster cardinality is exactly 40 and map <-> array agree"` test (and the
  cardinality assertions in the `"httpErrors & statusCodeErrorMap"` block).
- Widening a class's `status`/`statusText` off its literal type fails
  **typecheck** via the per-class assertions in
  `"every class's status and statusText are their own literal type, not
number/string"`.

So the invariant that the roster is complete and every class carries its exact
literal `status`/`statusText` is enforced by the test suite, not by a
generator.

Adding a new error class this way is a `minor` release — see the semver
policy below.

## Release process and semver policy

Releasing is manual and tag-driven; see [`RELEASING.md`](./RELEASING.md) for
the full process. The semver rules that govern what counts as `patch` /
`minor` / `major` for this package are also defined there — read them before
making a change that touches an error class, an export, or `status`/
`statusText`. In short:

- Adding a new dedicated HTTP error class is `minor`.
- Moving a code from `UnknownHttpError` to a dedicated class is `major`.
- `error.message` text is never part of the contract; `error.status` /
  `error.name` / `error.statusText` are.
- Removing or renaming a named export, or changing a class's `status` /
  `statusText` literal, is `major`.
- Dropping a supported Node major version is `major`.

Full detail: [`RELEASING.md`](./RELEASING.md#semver-policy).
