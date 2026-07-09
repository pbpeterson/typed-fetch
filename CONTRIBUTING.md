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
pnpm build         # tsup — confirm the package actually builds
```

Run them all locally; CI runs the same checks and will fail the PR otherwise.

If `pnpm format:check` fails, run `pnpm format` to fix it in place, then
re-check.

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

   ```typescript
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
     ```typescript
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
