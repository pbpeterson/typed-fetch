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
pnpm lint            # oxlint
pnpm format:check    # oxfmt --check
pnpm check-doc-style # links, controlled vocabulary, README Terms table (no build needed)
pnpm typecheck       # tsc --noEmit -p tsconfig.test.json
pnpm build           # tsup — confirm the package actually builds
pnpm test            # vitest run — includes checks against the built dist/
pnpm check-docs      # typecheck every fenced TS block in the docs (run AFTER build)
pnpm verify-pack     # assert the published tarball's file manifest (run AFTER build)
pnpm check-consumer  # pack + install the tarball, exercise it as a real consumer (run AFTER build)
pnpm audit:prod      # fail on any known runtime-dependency vulnerability
pnpm audit           # fail on high/critical vulnerabilities in the full toolchain
```

Run them all locally. CI runs the same checks and fails the PR otherwise.
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
  passed every gate at the time — this axis exists to detect that case. Both entry
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

### How to write the documentation

Read [`docs/writing-standard.md`](./docs/writing-standard.md) before you edit a
document. It defines the language rules, the normative words (`must`, `must
not`, `should`, `can`, `may`), the controlled vocabulary, and the
WARNING / CAUTION / NOTE markers.

Two rules from that standard cause most review comments:

- A request is **aborted**. An error body is **canceled**. The two words are
  not interchangeable.
- Every example that obtains an HTTP error must read, cancel, or transfer its
  body.

#### Documentation review checklist

Work through this list before you request a review of a documentation change.

- [ ] Every current TypeScript example compiles.
- [ ] Every current HTTP error body is read, canceled, or transferred.
- [ ] Every example request URL is absolute.
- [ ] abort refers to a request.
- [ ] cancel refers to an error body.
- [ ] Promise behavior uses resolves or rejects.
- [ ] Synchronous behavior uses throws.
- [ ] Conditions appear before conditional actions.
- [ ] New terminology is defined on first use.
- [ ] README, public skill, and JSDoc describe the same behavior.
- [ ] The README Terms table matches the controlled vocabulary.
- [ ] Each README meaning begins with the standard's meaning.
- [ ] No internal export is presented as public.
- [ ] Warnings describe a concrete consequence.

### Documentation examples are typechecked (`pnpm check-docs`)

`scripts/check-docs.mjs` extracts fenced TypeScript from every documentation
source. It also extracts public JSDoc examples from every file under `src/`.

The gate rewrites package imports to target the built `dist/`. It then
typechecks each block with the project's `tsc`. Run it after `pnpm build`.
If `dist/` is missing, the guard fails.

**Skipping a block.** Some blocks legitimately cannot compile on their own — an
isolated body fragment that assumes `error` from a previous snippet, a bare type
expression, a contributor template full of placeholders (`NNN`, `XxxError`), or
the maintainer template, which imports the internal `./known-http-error` module
that consumers cannot reach. Mark the fence with the `no-check` marker and the
guard skips it:

````markdown
```ts no-check
// a fragment that intentionally does not compile standalone
if (error instanceof BadRequestError) {
  /* ... */
}
```
````

Every skip is **counted and printed** in the CI log, and the guard **fails if
more than half of all TS blocks are skipped**. A marker that every block carries
stops proving anything. Prefer making a block self-contained (add the missing
`type User` / import) over skipping it. Do not use `no-check` to silence a real
error. The printed skip list names every skipped block, so a newly-skipped
headline block is visible to a reviewer.

**A block that documents a removed API.** `CHANGELOG.md` is compiled too, and
its "Migrating from 0.x" examples show what 0.x code looked like. Those halves
import names that 1.x removed, so they can never compile against `dist/`. Mark
the fence ` ```ts historical ` instead of `no-check`:

- `no-check` means "this fragment does not compile standalone, and it should be
  made to compile if you can." `historical` means "this documents an API that no
  longer exists — never edit it to make it compile."
- `historical` is valid **only in `CHANGELOG.md`**. Anywhere else it fails the
  gate, so it cannot become a general escape hatch.
- `historical` blocks leave the skip ratio entirely — neither numerator nor
  denominator. A changelog accumulates them forever, and that ratio must not
  drift toward its cliff because history got longer.
- `historical` blocks are still checked for the example-URL rule below. That is
  a text match, not a compile, and a Before/After pair only reads as a diff if
  both halves follow one URL convention.

**Example request URLs.** `check-docs` fails a `typedFetch` call with a relative
string literal. Browsers can resolve it against a document base. Node has no
document base, so it rejects the URL. The gate ignores computed URLs.

**Limitation — compilation is necessary, not sufficient.** A block can typecheck
and still be wrong, so a green `check-docs` is not proof the docs are correct.
A class template can, for example, compile while omitting
`override readonly name = "..."`. Under minification the constructor name may
then be mangled and the error's `.name` becomes incorrect — a runtime contract
this guard will **never** prove. When you edit an error-class example, read
`override readonly name` and the intended literal values and confirm them
manually. `check-docs` only proves the TypeScript example is well-formed.

### Documentation prose is linted (`pnpm check-doc-style`)

`scripts/check-doc-style.mjs` reads the documents as text. It needs no `dist/`
and no `tsc`, so it runs before `pnpm build` and fails in milliseconds. It
accumulates three classes of violation and prints all of them:

For TypeScript, it scans JSDoc on exported declarations and public members.
Private, protected, non-exported, and `@internal` declarations are excluded.

1. **A relative link in `README.md`.** This file is the only document in the npm
   tarball. Links to repository files must use absolute URLs. A `#fragment`
   remains valid inside the file.
2. **A controlled-vocabulary violation in prose.** A request is aborted, an
   error body is canceled.
3. **A README Terms table that has drifted.** The table must carry the same
   terms as the controlled vocabulary in `docs/writing-standard.md`, in the same
   order, and each README meaning must begin with the standard's meaning. A
   README meaning can append one package-specific sentence.

Rules 1 and 2 read the same prose. Fenced code blocks and inline code spans are
stripped first, so `` `cancelled` `` — the variable in
`src/errors/error-body.ts` — is never flagged as prose, and a Markdown link
printed inside backticks is not read as a link.

`docs/writing-standard.md` is exempt from the vocabulary rules. It is the one
document that must state a forbidden phrase to forbid it.

**What it cannot see.** Two limits, both deliberate, and both pinned by a test in
`scripts/check-doc-style.spec.mjs`.

The rules are **lexical**. "reissue calls the caller had explicitly aborted"
says "calls", not "requests", and no regular expression reaches it. Vocabulary
inside a fenced example is not scanned either,
because a legitimate reproduction can contain `new Error("canceled")`. Tense and
sentence length are not checked at all.

The rules are also **line-by-line**. A violation split across a line break is
missed: CommonMark allows a line ending between `](` and a link destination, and
a forbidden phrase can wrap between two words. Catching either means matching
across joined lines, and every function in the gate returns one output line per
input line so that a violation can be reported as `file:line`. `pnpm format`
owns the wrapping of every document in the roster. Both misses are review items.

### The packed tarball is consumed as a real user (`pnpm check-consumer`)

`scripts/check-consumer.mjs` covers a case no other test reaches: **every
other test runs against `src/` or a single built entry point.** The root
`*.spec.ts` suites import `./src/index`; the bun/deno smokes import
`dist/index.mjs` (the main
entry only); the API-surface snapshot checks export _names_; `verify-pack`
checks file _paths_. None of them installs the artifact and runs it the
way a downstream user does. A whole class of packaging bugs is therefore
invisible to every other suite in this repository, however many tests those
suites contain.

This gate (zero deps, plain Node, runs **after `pnpm build`**):

1. `npm pack`s the tarball into a temp dir.
2. Installs it into a throwaway consumer project (`npm install ./<tarball>`).
3. Exercises the **installed** package: ESM `import`, CJS `require`, the
   `./errors` subpath, cross-entry and cross-format `instanceof`/`isHttpError`,
   plus abort/timeout/injected-`fetch`/`Request`-first-arg behavior.
4. Typechecks a consumer `.ts` against the install under **both**
   `moduleResolution: "bundler"` and `"nodenext"` (the nodenext pass doubles as
   an `attw`-style types-wiring check), using the repo's own `tsc`.

It cleans up all temp dirs and exits non-zero with a per-assertion report.

**`KNOWN_FAILING` (currently empty).** The script keeps a `KNOWN_FAILING` set at
the top for staging a fix: when an assertion encodes a contract the artifact
does not yet satisfy (e.g. cross-entry `instanceof` under a dual-bundle build),
put its id there and it is reported but does not fail CI, so the gate can land
green while the fix is still in progress. The set **polices itself** — if a
`KNOWN_FAILING` assertion starts **passing**, the gate fails with "KNOWN_FAILING
is stale", which requires you to delete the id. It is currently empty: every
assertion is enforced strictly. Never add an id to hide a real regression, and
never leave a fixed bug's id behind.

**Contracts vs. limitations.** A handful of checks are _informational_ (`note`,
printed with `·`) rather than assertions — they document a limitation the
library deliberately does not promise to fix. The clearest is cross-**format**
`instanceof` (an error created by the ESM copy is never `instanceof` the CJS
class copy):
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
  seam. If this line moves, the spec asserts against a mock while the real gate
  runs untested, and the suite still reports success.
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

Two things are deliberately absent: there is **no shared gate harness** (the
genuine overlap between the gates is about six lines, and a shared module
would make one file a common failure point for every release check, and would
split each gate across two files instead of one readable file), and
`scripts/lib/` holds only _plumbing_ — scratch directories and npm
pack/install — never policy.

`check-deno-consumer.mjs` applies the same structure. Its pure decision checks
the Deno version requirement. The adapter records the `deno check` exit as an
I/O fact, and the thin `main` owns the report.

Note that `pnpm typecheck` does **not** cover `scripts/`: `tsconfig.test.json`
has no `allowJs`/`checkJs`. The `// @ts-check` comments and JSDoc types in these
files are for editors and readers; do not rely on them for CI enforcement.

## Adding a new HTTP status code

The 40 concrete error classes are plain, hand-written source. There is no
code generator — adding a status code is a mechanical edit across a fixed set
of files. The work is repetitive. The **roster tests in `roster-sync.spec.ts`
catch most omissions**, but they do not catch every one. See
"What the roster tests catch" at the end of this section for the test that
covers each step, and for the one step no test covers. Follow the existing 404
(`NotFoundError`) as a template.

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
   - in `typed-fetch.spec.ts`, add `{ status: NNN, Class: XxxError },` to the
     `errorCases` table (in status-code order). That table drives the
     `test.each` that sends one live request per status code and asserts the
     class `typedFetch` resolves with.

     CAUTION: No test enforces this row. If you omit it, `test.each` runs one
     case fewer and the suite still passes, so the new status code never goes
     through a real request.

   - the cardinality assertions in `roster-sync.spec.ts` count
     `allErrors.length`, so there are no magic numbers to bump. The test
     **titles** still say "40" and should be updated for readability;
   - in `roster-sync.spec.ts`, add an explicit per-class assertion pair inside
     the "every class's status and statusText are their own literal type"
     test:
     ```typescript no-check
     expectTypeOf<XxxError["status"]>().toEqualTypeOf<NNN>();
     expectTypeOf<XxxError["statusText"]>().toEqualTypeOf<"<Status Text>">();
     ```

6. Run `pnpm format` to normalize the new files, then run the gates (above).

### What the roster tests catch

Most steps above are enforced by a test. Each entry names the omission and the
test that fails for it:

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

**Every step is enforced.** Omitting the `errorCases` row in
`typed-fetch.spec.ts` used to fail no test: `test.each` ran one case fewer and
the suite stayed green. The test named "errorCases covers the whole roster"
now compares that table against `allErrors` and names the missing status. Status
407 is the one documented exception, because Node's fetch rejects a 407 at the
network level before a response exists; it has its own direct-construction test.

So the invariant that the roster is complete and every class carries its exact
literal `status`/`statusText` is enforced by the test suite, not by a
generator. Coverage of the new status code by a live request is not.

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
   into all 40 declarations (about +520 lines). The duplication produces the
   declaration quality that the factory removes.
3. **It was already built, and reverted the same day.** Commit `31fa896` added
   a 431-line `scripts/generate-errors.ts`; `6cc8c56` deleted it 84 minutes
   later because it could not actually add a status code (it crashed on a
   hardcoded `!== 40` guard, then emitted non-compiling code), never pruned
   orphaned files, and relocated the parallel lists into four hidden ones
   inside itself. Read both commit messages.
4. **Drift is already impossible past CI.** The `roster sync` tests are an
   independently authored second source of truth — see "What the roster tests
   catch" above.
   The duplication is checked, not trusted.

One argument that is **not** a reason to keep things hand-written: "a factory
would break class names and stack traces." That is false —
`Object.defineProperty(C, "name", ...)` reproduces the instance `name`, the
`stack` header line, and `String(error)` exactly. Do not use it. The case
rests on the emitted declarations, not on runtime behavior.

A proposal that clears the bar in ADR 0001's "What would change our mind"
section is genuinely welcome; one that re-runs the arguments above is not.

### Error response bodies

The body lifecycle is a seam between two modules. `src/errors/base-http-error.ts`
owns HTTP error identity — `status`, `statusText`, `url`, `headers`, and the
message line. `src/errors/error-body.ts` owns the single-use body.

Identity is read through `src/errors/response-identity.ts`.
`statusOf(response)` answers the class-selection read in `src/index.ts`.
`identityOf(response)` answers the whole record inside the error constructors.

Both functions record each successful field read immediately. A later getter
failure cannot make an earlier field run again. Code in `src/` must not read
`response.status`, `response.statusText`, or `response.url` directly.

A direct read can make one error report conflicting values. When normalization
changes, add a case to `response-identity.spec.ts`.

`BaseHttpError` never stores the failed `Response`. The constructor passes the
response to `errorBodyOf(response)`, which captures it in a **closure** and
returns an `ErrorBody` handle. A module-scoped
`WeakMap<BaseHttpError, ErrorBody>` in `base-http-error.ts` maps each instance
to its handle, and `bodyOf(error)` reads it. Every body method on the error —
`json()`, `text()`, `blob()`, `arrayBuffer()`, `cancel()`, and `clone()` — is a
delegation across that seam.

Two consequences follow. The `Response` is not reachable from the error a
consumer holds, so nothing can route around the guards. The handle is not an
own property, so it stays out of `JSON.stringify(err)`, `{...err}`,
`Object.keys(err)`, and structured loggers.

Test the lifecycle against `errorBodyOf` directly. A body is constructible in
one line, with no error class — that is why the seam is here.

These invariants hold below the seam, in `error-body.ts`:

- One predicate, `claimable()`, decides availability for both the readers and
  `tee()`. It refuses a body that this library canceled or read
  (`readStarted`), that the platform reports as consumed (`bodyUsed`), or whose
  stream is `locked`. The two callers share the predicate and differ only in
  the message they raise, so the guards cannot drift apart. A reader raises the
  library's `TypeError` inside `claim()`, and because the readers are `async`
  the caller receives a **rejection**. `tee()` is synchronous, so `clone()`
  **throws**. Either way the caller sees the library's message rather than the
  platform's opaque "Body is unusable".
- `cancel()` never buffers. Test it with a `ReadableStream` whose `cancel()`
  callback records the call and whose `pull()` records buffering — a passing
  test asserts the cancel callback ran and `pull` never did.
- Never infer "we already read this body" from `response.bodyUsed`. That flag
  is runtime-specific: Bun sets it when `getReader()` locks the stream, Node,
  Deno, and workerd do not. `errorBodyOf` tracks its own `readStarted` in a
  closure variable, and `cancel()` decides in a fixed order — repeated cancel,
  library read, external lock, consumed body, releasable body.
- `clone()` tees the stream, so a `cancel()` on one branch stays pending until
  the sibling is released. Keep that native semantics; do not resolve early.
- Neither module uses a class with a `#private` field, and `error-body.ts` uses
  no class at all. `#private` emits a nominal `#private;` marker into the
  declarations, which makes the `.d.ts` and `.d.mts` copies of every error class
  mutually unassignable. Do not reintroduce `#private`, `private`, or
  `protected` on any publicly exported class, and prefer a factory over closures
  to a class with private fields in an internal module.

### Consumer subclasses and cloning

Built-in classes support `BaseHttpError.clone()` without extra configuration.
Consumer subclasses retain the response-only `clone()` behavior from 1.0.0,
but it cannot preserve additional constructor or private state. Pass the
optional recreation callback when a subclass has such state. For example:
`error.clone((response) => new CustomHttpError(response, error.context))`.
Add a regression test that consumes both bodies and verifies custom state is
preserved.

A `recreate` callback that builds the new error from a **different** package
copy needs that copy to be at this version or newer. `clone()` asks the returned
error whether it took the cloned branch, through a `Symbol.for` method that
every copy at this version stamps. A copy older than this one cannot answer, so
`clone()` releases the branch and throws.

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
