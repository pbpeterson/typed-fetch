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

The 40 concrete error classes (`src/errors/*-error.ts`), the `helpers.ts`
unions/array, and `src/http-status-codes.ts` map are all **code-generated** —
do not hand-edit any of them. They're produced by `scripts/generate-errors.ts`
from a single source-of-truth table, `ERROR_TABLE`, defined at the top of
that script. Each row has the shape:

```typescript
interface ErrorRow {
  code: number; // e.g. 404
  statusText: string; // canonical IANA reason phrase, e.g. "Not Found"
  className: string; // e.g. "NotFoundError"
  kind: "client" | "server"; // 4xx vs 5xx
}
```

To add a new status code:

1. Add a new row to `ERROR_TABLE` in `scripts/generate-errors.ts`, in status
   code order.
2. Regenerate everything from the table:
   ```bash
   pnpm generate
   ```
   This rewrites the per-code file under `src/errors/`, `src/errors/helpers.ts`
   (the `httpErrors` array and the `ClientErrors`/`ServerErrors` unions),
   `src/http-status-codes.ts` (the `statusCodeErrorMap`), and
   `src/errors/index.ts` (the barrel export).
3. Format the generated output:
   ```bash
   pnpm format
   ```
4. Run the gates (above) before opening a PR.

`pnpm generate:check` (`pnpm generate && git diff --exit-code src/`) is the
guard against drift — it fails if the generated tree doesn't match what's
committed, which catches both a stale generator run and a hand-edit to a
generated file. Run it yourself if you're unsure whether `src/` is in sync
with `ERROR_TABLE`.

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
