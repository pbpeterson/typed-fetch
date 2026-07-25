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
pnpm build         # tsup — confirm the package actually builds
pnpm test          # vitest run — includes checks against the built dist/
pnpm check-docs     # typecheck every fenced TS block in the docs (run AFTER build)
pnpm verify-pack    # assert the published tarball's file manifest (run AFTER build)
pnpm check-consumer # pack + install the tarball, exercise it as a real consumer (run AFTER build)
pnpm audit:prod     # fail on any known runtime-dependency vulnerability
pnpm audit          # fail on high/critical vulnerabilities in the full toolchain
```

Run them all locally; CI runs the same checks and will fail the PR otherwise.
CI additionally runs Bun and Deno runtime smokes. Its Deno job runs
`pnpm check-deno-consumer` after the build, installing the packed artifact and
typechecking the package's public `.d.mts` declarations by bare package name.
Run that command locally too when Deno 2 is installed. Deno 1 cannot resolve
an unpublished local tarball through the required manual `node_modules` mode.

If `pnpm format:check` fails, run `pnpm format` to fix it in place, then
re-check.

### The public surface is frozen — both axes (`pnpm test`)

`public-surface.spec.ts` snapshots the exact public export surface of the **built**
package so any addition or removal is a red test and a reviewable snapshot
diff, never a silent minor/major. It freezes **two independent axes**, because
one snapshot cannot see the other:

- **Value surface** (`public API surface is frozen`): the runtime named
  exports, read via `Object.keys(await import("dist/index.mjs"))`. This sees
  only bindings that exist at runtime — functions, classes, values. The same
  suite also derives every dedicated class from the internal `httpErrors`
  roster and requires both `.` and `./errors` to export it, catching a future
  class that is registered internally but omitted from a barrel.
- **Type surface** (`public TYPE surface is frozen`): the type-only exports,
  read from the built `dist/*.d.mts` with the **TypeScript compiler API**
  (`getExportsOfModule`, keeping symbols that carry a type meaning but no value
  meaning). Type-only exports (`export type { … }`, re-exported interfaces and
  type aliases) never exist at runtime, so `Object.keys()` is structurally
  blind to them. Deleting `export type { HttpMethods }` from the barrel once
  passed every gate at the time — this axis exists to close that hole. Both entry
  points (`.` and `./errors`) are covered.

Both blocks read from `dist/`, so run them **after `pnpm build`** (e.g.
`pnpm build && pnpm test`); on a clean checkout with no `dist/` they skip with
a printed warning (CI runs `pnpm test` after `pnpm build`, so they run there).

**Changing the surface on purpose.** Adding or removing a public export — value
_or_ type — is a deliberate, reviewed act. After you change the code, rebuild
and update the snapshots:

```bash
pnpm build && pnpm test -u   # rewrites __snapshots__/public-surface.spec.ts.snap
```

Commit the snapshot diff alongside the code change so the reviewer sees exactly
which names entered or left the public API. Never hand-edit the `.snap` file to
make a test pass — regenerate it from a real build.

### Documentation examples are typechecked (`pnpm check-docs`)

`scripts/check-docs.mjs` extracts every fenced ` ```ts ` / ` ```typescript `
block from `README.md`, `CONTRIBUTING.md`, both `SKILL.md` files, and the public
JSDoc examples in `src/index.ts`. It rewrites the
`@pbpeterson/typed-fetch` import to point at the **built `dist/`**, then
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
A class template can, for example, compile while omitting
`override readonly name = "..."`. Under minification the constructor name may
then be mangled and the error's `.name` becomes incorrect — a runtime contract
this guard will **never** prove. When you edit an error-class example, verify
`override readonly name` and the intended literal values by eye; `check-docs`
only proves the TypeScript example is well-formed.

### The packed tarball is consumed as a real user (`pnpm check-consumer`)

`scripts/check-consumer.mjs` closes a hole that no other test covers: **every
other test runs against `src/` or a single built entry point.** The root
`*.spec.ts` suites import `./src/index`; the bun/deno smokes import
`dist/index.mjs` (the main
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

### How a release gate is shaped

Every gate under `scripts/` is **one file** with three parts and exactly one
seam:

```
        ┌── adapter ──┐   ┌─ pure decision ─┐   ┌── thin main ──┐
 world →│ gather facts│ → │ facts → verdict │ → │ render + exit │→ world
        └─────────────┘   └─────────────────┘   └───────────────┘
                        ↑ THE SEAM ↑
                    the spec attaches here
```

- **The pure decision** is `export`ed and takes plain data — arrays, strings,
  records — that a test can write down as a literal. No `node:fs`, no
  `node:child_process`, no `process.*`, no `console.*`. This is what
  `scripts/<gate>.spec.mjs` calls. Exporting is safe: `files: ["dist"]` means
  `scripts/` never ships, and `verify-pack` asserts exactly that.
- **The adapter** does all the I/O and **may not contain a branch that decides
  pass/fail.** Branching on "the subprocess crashed" is an I/O outcome and is
  fine; branching on "the manifest is wrong" is policy and belongs across the
  seam. If this line drifts, the spec starts asserting a mock while the real
  gate goes untested — the worst outcome available, because the suite is green.
- **The thin main** owns every `console.log`, every exit code, and is fenced
  behind an `isMain` guard so importing the module does nothing.

The verdict's shape follows the gate's failure arity, and this part is
deliberately **not** uniform:

- A **fail-fast** gate stops at the first violation and prints one message, so
  its decision **throws an `Error`** whose message is verbatim what the report
  prints. `validate-release` and `verify-pack` are these.
- An **accumulating** gate must print every failure, so its decision **returns a
  verdict record**. Throwing would truncate the report to the first failure.
  `check-docs` and `check-consumer` are these.

Uniformity of _purity_ is the invariant; uniformity of _error protocol_ is not.

Two things deliberately absent: there is **no shared gate harness** (the genuine
overlap between the five gates is about six lines, and a shared module would
make one file a single point of failure for every release check while destroying
the locality that lets you read a gate top to bottom), and `scripts/lib/` holds
only _plumbing_ — scratch directories and npm pack/install — never policy.

`check-deno-consumer.mjs` is the deliberate exception: its pass/fail verdict is
`deno check`'s exit code, which the gate does not compute. There is no decision
in it, so there is no interface to give it. Leave it alone.

Note that `pnpm typecheck` does **not** cover `scripts/`: `tsconfig.test.json`
has no `allowJs`/`checkJs`. The `// @ts-check` comments and JSDoc types in these
files are for editors and readers; do not rely on them for CI enforcement.

## Adding a new HTTP status code

The 40 concrete error classes are plain, hand-written source. There is no
code generator — adding a status code is a mechanical edit across a fixed set
of files. It's a chore, but the **roster tests in `roster-sync.spec.ts` are the
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
   import { KnownHttpError } from "./known-http-error";

   /** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/NNN */
   export class XxxError extends KnownHttpError {
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

4. **Nothing to do in `src/http-status-codes.ts`.** `statusCodeErrorMap` is
   derived from `httpErrors` — it reads each class's own `static status` — so
   step 3 already registered the status code. Do not add a hand-written entry.

5. **Update the tests**:
   - in `fixtures/error-roster.ts`, add `{ Class: XxxError, status: NNN },` to
     the `allErrors` table (in status-code order). Write the row by hand from
     the RFC — never derive it from `src/`, or the table stops being an
     independent second source of truth;
   - the cardinality assertions in `roster-sync.spec.ts` count
     `allErrors.length`, so there are no magic numbers to bump. The test
     **titles** still say "40" and are worth updating for readability;
   - in `roster-sync.spec.ts`, add an explicit per-class assertion pair inside
     the "every class's status and statusText are their own literal type"
     test:
     ```typescript no-check
     expectTypeOf<XxxError["status"]>().toEqualTypeOf<NNN>();
     expectTypeOf<XxxError["statusText"]>().toEqualTypeOf<"<Status Text>">();
     ```

6. Run `pnpm format` to normalise the new files, then run the gates (above).

### The safety net

If you miss a step, the `roster-sync.spec.ts` roster tests fail — that is the
whole point of them:

- Forgetting to add the class to a `ClientErrors`/`ServerErrors` union (but
  leaving it in `httpErrors`) fails **typecheck** via the
  `"HttpErrors instance union matches ClientErrors | ServerErrors"` test.
- Dropping the class from the `httpErrors` array fails the **runtime**
  `"roster cardinality is exactly 40 and map <-> array agree"` test (and the
  cardinality assertions in the `"httpErrors & statusCodeErrorMap"` block),
  which count against the independently authored `allErrors` table. A
  status-code map entry that disagrees with the class's own `static status` is
  no longer possible at all — `statusCodeErrorMap` is derived from
  `httpErrors`.
- Widening a class's `status`/`statusText` off its literal type fails
  **typecheck** via the per-class assertions in
  `"every class's status and statusText are their own literal type, not
number/string"`.
- Omitting a registered class from either public barrel fails the dist-gated
  `"exports every dedicated class in the internal roster"` checks for `.` and
  `./errors`.

So the invariant that the roster is complete and every class carries its exact
literal `status`/`statusText` is enforced by the test suite, not by a
generator.

Registering a new error class this way is a `major` release — see the semver
policy below.

### Do not propose generating, collapsing, or factory-building the roster

The steps above are repetitive, and the natural reaction is to propose a code
generator or a generic `makeHttpError(status, statusText)` factory. That has
been evaluated in depth and **rejected**. Please read
[ADR 0001](./docs/adr/0001-keep-the-http-error-roster-hand-written.md) before
opening an issue or PR for it. The four facts that settle it:

1. **The roster does not change.** All 40 classes landed in the initial commit
   and not one status class has been added or removed in the 12.5 months and
   132 commits since. Upstream is equally static: the roster already covers
   every IANA-registered 4xx/5xx code, and the newest one to be newly
   registered is 425 Too Early (RFC 8470, **2018**).
2. **A factory measurably degrades the published `.d.ts`.** Under
   `tsc --declaration`, `clone()`'s polymorphic `this` collapses to `any`, the
   named `declare class` becomes an anonymous object type, `extends
KnownHttpError` disappears, and the whole `BaseHttpError` surface inlines
   into all 40 declarations (about +520 lines). The duplication buys precisely
   the thing the factory removes.
3. **It was already built, and reverted the same day.** Commit `31fa896` added
   a 431-line `scripts/generate-errors.ts`; `6cc8c56` deleted it 84 minutes
   later because it could not actually add a status code (it crashed on a
   hardcoded `!== 40` guard, then emitted non-compiling code), never pruned
   orphaned files, and relocated the parallel lists into four hidden ones
   inside itself. Read both commit messages.
4. **Drift is already impossible past CI.** The `roster sync` tests are an
   independently authored second source of truth — see "The safety net" above.
   The duplication is checked, not trusted.

One argument that is **not** a reason to keep things hand-written: "a factory
would break class names and stack traces." That is false —
`Object.defineProperty(C, "name", ...)` reproduces the instance `name`, the
`stack` header line, and `String(error)` exactly. Do not use it. The case
rests on the emitted declarations, not on runtime behaviour.

A proposal that clears the bar in ADR 0001's "What would change our mind"
section is genuinely welcome; one that re-runs the arguments above is not.

### Error response bodies

`BaseHttpError` keeps the failed `Response` in a private field, so the body is
only reachable through `json()`/`text()`/`blob()`/`arrayBuffer()`,
`cancel()`, and `clone()`. Two invariants hold there:

- The shared reader guard rejects a body that is consumed, cancelled, or
  locked by a reader, and it must stay in sync with the `clone()` guard.
  Both throw the library's `TypeError` instead of the platform's opaque
  "Body is unusable".
- `cancel()` never buffers. Test it with a `ReadableStream` whose `cancel()`
  callback records the call and whose `pull()` records buffering — a passing
  test asserts the cancel callback ran and `pull` never did.
- Never infer "we already read this body" from `response.bodyUsed`. That flag
  is runtime-specific: Bun sets it when `getReader()` locks the stream, Node,
  Deno, and workerd do not. The state carries its own `readStarted`, and
  `cancel()` decides in a fixed order — repeated cancel, library read, external
  lock, consumed body, releasable body.
- `clone()` tees the stream, so a `cancel()` on one branch stays pending until
  the sibling is released. Keep that native semantics; do not resolve early.
- The per-instance state lives in a module-scoped `WeakMap`, not in `#private`
  fields. `#private` emits a nominal `#private;` marker into the declarations,
  which makes the `.d.ts` and `.d.mts` copies of every error class mutually
  unassignable. Do not reintroduce `#private`, `private`, or `protected` on any
  publicly exported class.

### Consumer subclasses and cloning

Built-in classes support `BaseHttpError.clone()` without extra configuration.
Consumer subclasses retain the response-only `clone()` behavior from 1.0.0,
but it cannot preserve additional constructor or private state. Pass the
optional recreation callback when a subclass has such state. For example:
`error.clone((response) => new CustomHttpError(response, error.context))`.
Add a regression test that consumes both bodies and verifies custom state is
preserved.

## Release process and semver policy

Releasing is PR-reviewed and tag-driven; see [`RELEASING.md`](./RELEASING.md)
for the full process and required npm OIDC setup. The semver rules that govern
what counts as `patch` / `minor` / `major` for this package are also defined
there — read them before making a change that touches an error class, an
export, or `status`/`statusText`. In short:

- Registering a new dedicated HTTP error class is `major`: it widens the
  returned union and moves that status away from `UnknownHttpError`.
- `error.message` text is never part of the contract; `error.status` /
  `error.name` / `error.statusText` are.
- Removing or renaming a named export, or changing a class's `status` /
  `statusText` literal, is `major`.
- Dropping a supported Node major version is `major`.

Full detail: [`RELEASING.md`](./RELEASING.md#semver-policy).
