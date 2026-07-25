# typed-fetch 1.0 execution plan (completed)

Take `@pbpeterson/typed-fetch` from `0.8.1` to a production-ready `1.0.0`.

This document is self-contained. An engineer or coding agent can execute it top to
bottom without any other context.

**Status (2026-07-21):** `1.0.0` was published from tag `v1.0.0` on 2026-07-17
through npm trusted publishing with provenance. The release workflow passed,
but the companion CI run for that tag failed its Deno smoke; the Deno issue was
fixed on `main` after publication. The release workflow now depends on the full
reusable Node/Bun/Deno/security matrix so that mismatch cannot recur. This file
is retained as the completed historical execution plan with that exception;
phase descriptions below preserve their pre-release context.

## Ground rules

- Do the work in the order given. Later items assume earlier ones are done.
- **All breaking changes are batched into Phase 3.** Do not sneak a breaking change
  into any other phase.
- Each phase ends with a **gate**. Do not start the next phase until the gate is green.
- The release gates, run from the repo root, are `pnpm lint`,
  `pnpm format:check`, `pnpm typecheck`, `pnpm build`, `pnpm test`,
  `pnpm check-docs`, `pnpm verify-pack`, `pnpm check-consumer`,
  `pnpm audit:prod`, and `pnpm audit`. Vitest currently runs 423 tests across
  four files.
- Hosted CI additionally runs Bun and Deno runtime smokes plus an
  installed-tarball Deno declaration check (`pnpm check-deno-consumer`).
- After any change to `src/`, also run `pnpm build` (tsup) and confirm exit 0.
- Core integration coverage lives in `test.spec.ts` at repo root. It boots a
  real `node:http` server whose response is driven by query params:
  `?status=`, `?body=`, `?header=Key:Value`. Reuse it; do not mock `fetch`.
- Public entry is root `index.ts` (re-exports `src/`). Package build entries are
  `index.ts` and `src/errors/index.ts` (`tsup.config.ts:4-7`).

## Orientation: current file map

- `index.ts` — public re-export barrel (root).
- `src/index.ts` — `typedFetch`, realm-safe Request handling, type guards,
  `TypedResponse`, `TypedFetchReturnType`, and `TypedFetchOptions`.
- `src/errors/base-http-error.ts` — abstract `BaseHttpError` (message build,
  body readers, and `clone()` with optional consumer-subclass recreation).
- `src/errors/network-error.ts` — `NetworkError extends Error` (not `BaseHttpError`).
- `src/errors/unknown-http-error.ts` — `UnknownHttpError` (`status`/`statusText` are
  `number`/`string`, not literals — lines 11-12).
- `src/errors/<name>-error.ts` — 40 concrete classes, e.g. `not-found-error.ts`:
  `status = 404 as const` (instance) + `static readonly status = 404 as const`.
- `src/errors/helpers.ts` — `httpErrors` array (line 97), `ClientErrors` union (48),
  `ServerErrors` union (80), `TypedFetchError` (94), `HttpErrors` (45).
- `src/http-status-codes.ts` — `statusCodeErrorMap` (line 49-90).
- `src/headers.ts` — `StrictHeaders`, `TypedHeaders`.
- `src/methods.ts` — `HttpMethods`.

The error roster is hand-maintained in **five** places that must stay in sync:
the per-code file, `helpers.ts` import + `httpErrors` array + the `ClientErrors`
or `ServerErrors` union, and `http-status-codes.ts` import + map entry. Nothing
currently enforces the sync. **P1-04 makes that enforcement automatic; do it early
so every later change is caught.**

---

## Phase 0 — Truth in documentation (non-breaking, ship-anytime)

The README currently teaches a pattern that throws at runtime and makes two claims
that are false. Fix the docs first; these are pure lies that undermine the pitch and
cost almost nothing.

### P0-01 — Fix the crashing `clone()` example in the README

- **Why:** `README.md:222-235` reads the body with `await error.json()` then calls
  `error.clone().text()`. Verified: `Response.clone()` after the body is consumed
  throws `TypeError: Response.clone: Body has already been consumed`. The one library
  whose headline is "never throws" documents a crash.
- **Files:** `README.md:218-236` (the "Error Response Bodies" block).
- **Change:** clone **before** the first read. Replace the body of the example with:

  ```typescript
  if (error && isHttpError(error)) {
    // Clone BEFORE reading if you need the body more than once.
    const forJson = error.clone();
    const json = await error.json();
    const text = await forJson.text();

    const retryAfter = error.headers.get("Retry-After");
    error.status; // 404 (literal, not number)
    error.statusText; // "Not Found" (literal, not number)
  }
  ```

- **Verify:** paste the snippet into a scratch file, build (`pnpm build`), run it
  against a 404 from the test server pattern, assert no throw. Also grep the README
  for any other `.json()` … `.clone()` ordering: `rg -n "clone\(\)" README.md`.
- **Breaking:** No.
- **Effort:** XS.

### P0-02 — Document the "never-throws boundary"

- **Why:** "Never throws" is only true up to the response envelope. `response.json()`
  on a non-JSON 200 throws `SyntaxError` (verified); body methods on error classes
  throw the same way; a consumed body makes `clone()` throw. Users must know where
  the guarantee ends.
- **Files:** `README.md` — add a short subsection under "Why typed-fetch?" (after
  line 32) titled "What never-throws means".
- **Change:** state plainly:
  > `typedFetch` never throws for network failures or HTTP status codes — those come
  > back as `error`. Reading a body (`response.json()`, `error.json()`, `.text()`, …)
  > can still throw, exactly like native fetch: malformed JSON throws `SyntaxError`,
  > and reading an already-consumed body throws. Wrap body reads in try/catch (or
  > `.clone()` first) when the payload is untrusted.
- **Verify:** `rg -n "never throws" README.md` returns the qualified statement; the
  Features bullet at `README.md:36` is left intact but now has context above it.
- **Breaking:** No.
- **Effort:** XS.

### P0-03 — Stop claiming `statusText` is what the server sent

- **Why:** `NotFoundError.statusText` is hardcoded `"Not Found" as const`
  (`not-found-error.ts:6`) regardless of the wire value; over HTTP/2 there is no
  reason phrase at all. Meanwhile `error.message` uses the real `response.statusText`
  (`base-http-error.ts:20-24`), so `.message` and `.statusText` can disagree on one
  object. The README (`README.md:384`, `:233`) presents `statusText` as "HTTP status
  text" with no caveat.
- **Files:** `README.md:381-385` and the JSDoc at `base-http-error.ts:16-17`.
- **Change (docs only — no behavior change here):** in both places, describe
  `statusText` as the library's canonical protocol label (normally the current IANA
  phrase), not the server's wire value; note that the server's wire phrase, when
  present, is in `error.message`. The intentional historical labels for 418/510 are
  documented in the final contract.
- **Verify:** `rg -n "canonical" README.md src/errors/base-http-error.ts` shows both
  updated.
- **Breaking:** No. (Exposing a `rawStatusText` field is OUT of scope for 1.0 — see
  the out-of-scope section.)
- **Effort:** XS.

**Phase 0 gate:** All four repo gates green. README contains a working clone example,
a never-throws-boundary section, and an honest `statusText` description. No `src/`
behavior changed yet.

---

## Phase 1 — Correctness, safety nets, and DX (non-breaking)

Everything here is additive or internal. It ships as a `0.9.0` minor if you want an
intermediate release, or rolls straight into 1.0. **P1-04 and P1-05 must land before
Phase 3** because they are the guardrails that make the breaking changes safe.

### P1-01 — Hardcode `error.name` per class (survive minification)

- **Why:** `base-http-error.ts:25` sets `this.name = this.constructor.name`. Consumer
  minifiers (esbuild/Terser, default in browser prod builds — a runtime this package
  claims to support, `README.md:52`) mangle class names, so `error.name` becomes `"a"`.
  Anyone logging or matching on `.name` breaks silently. `clone()` (`:51`) uses
  `this.constructor` for identity, which survives minification, so leave `clone()` alone.
- **Files:** `src/errors/base-http-error.ts:25`; each of the 40 `src/errors/*-error.ts`
  files; `src/errors/unknown-http-error.ts`.
- **Change:** remove the `this.name = this.constructor.name` line from the base ctor.
  Add an explicit `override readonly name = "NotFoundError";` (etc.) to every concrete
  class. Example for `not-found-error.ts`:
  ```typescript
  export class NotFoundError extends BaseHttpError {
    override readonly name = "NotFoundError" as const;
    public readonly status = 404 as const;
    public readonly statusText = "Not Found" as const;
    static readonly status = 404 as const;
    static readonly statusText = "Not Found" as const;
  }
  ```
  `NetworkError` already hardcodes its name (`network-error.ts:10`) — leave it.
  > Note: this is mechanical across 40 files. If you do **P1-08 (codegen)** first,
  > the generator emits the hardcoded name for free and this item collapses into it.
  > Recommended order if attempting both: do P1-08, then P1-01 falls out.
- **Verify:** add to `test.spec.ts` inside the existing parameterized
  `test.each(...)` over all classes (near `test.spec.ts:438`) an assertion:
  `expect(instance.name).toBe(Class.name)` where `Class.name` is the source class
  name — this already passes unminified, but to prove minification-safety add a
  dedicated test that reads the built bundle:
  ```typescript
  // new test, top-level
  test("error .name is a hardcoded string literal, not this.constructor.name", () => {
    const src = readFileSync("src/errors/base-http-error.ts", "utf8");
    expect(src).not.toMatch(/this\.name\s*=\s*this\.constructor\.name/);
  });
  ```
  Run `pnpm test`.
- **Breaking:** No (observable `.name` values are unchanged; only their survival under
  minification improves).
- **Effort:** S (M if not codegenned).

### P1-02 — Add `url` to HTTP errors and to the message

- **Why:** `BaseHttpError` exposes nothing identifying which request failed;
  `error.message` is just `"HTTP 404 Not Found"`. Three concurrent calls produce
  indistinguishable errors in logs. `response.url` is already available.
- **Files:** `src/errors/base-http-error.ts:9-27`; README API section
  (`README.md:379-385`).
- **Change:** add a public field and include it in the message:

  ```typescript
  /** The URL of the failed request (from `response.url`). */
  public readonly url: string;

  constructor(protected readonly response: Response) {
    const line = response.statusText
      ? `HTTP ${response.status} ${response.statusText}`
      : `HTTP ${response.status}`;
    super(response.url ? `${line} (${response.url})` : line);
    this.url = response.url;
    this.headers = response.headers;
  }
  ```

  Document `url` in the "Instance Properties" list in the README.

- **Verify:** in `test.spec.ts`, in the 404 test, assert
  `expect(result.error.url).toBe(url({ status: 404 }))` and
  `expect(result.error.message).toContain("localhost")`. Run `pnpm test`.
- **Breaking:** The `message` **text** changes. Message text is not part of the semver
  contract (assert on `.status`/`.name`, not `.message`). Treat as non-breaking, but
  note it in the CHANGELOG. If the maintainer disagrees, see JUDGMENT CALL J-2.
- **Effort:** S.

### P1-03 — Add `isKnownHttpError` guard (unblock exhaustive status switching)

- **Why:** The 40 literal-status classes exist so consumers can
  `switch (error.status)`. Verified against the built `.d.ts`: today that switch
  narrows to `NotFoundError | UnknownHttpError` because `UnknownHttpError.status: number`
  absorbs every `case`. There is no guard to exclude `UnknownHttpError`, so the core
  type payoff is unreachable and users fall back to `instanceof` chains.
- **Files:** `src/index.ts` (add export near `isHttpError`, lines 21-37); `index.ts`
  root barrel (`index.ts:1` re-export list); README (new subsection under
  "Error Handling").
- **Change:**
  ```typescript
  import { ClientErrors, ServerErrors } from "./errors/helpers";
  // ...
  /**
   * Type guard for a *known*, dedicated HTTP error class (excludes UnknownHttpError).
   * Narrowing on `error.status` after this guard is exhaustive over the mapped codes.
   */
  export function isKnownHttpError(error: unknown): error is ClientErrors | ServerErrors {
    return error instanceof BaseHttpError && !(error instanceof UnknownHttpError);
  }
  ```
  Add `isKnownHttpError` to the root `index.ts` `export { ... }` and to
  `README.md` type-guard docs. Add a README example showing an exhaustive
  `switch (error.status)` after `isKnownHttpError(error)`.
- **Verify:** add a **type test** in `test.spec.ts` (these run under
  `tsconfig.test.json` via `pnpm typecheck`):
  ```typescript
  test("isKnownHttpError enables exhaustive status narrowing", () => {
    const { error } = fakeResult(); // any TypedFetchReturnType value
    if (isKnownHttpError(error)) {
      if (error.status === 404) {
        expectTypeOf(error).toEqualTypeOf<NotFoundError>();
      }
    }
  });
  ```
  Run `pnpm typecheck` (must show 404 → `NotFoundError`, not `NotFoundError | UnknownHttpError`)
  and `pnpm test`.
- **Breaking:** No (pure addition).
- **Effort:** S.

### P1-04 — Type-level roster sync tests (the guardrail)

- **Why:** The roster lives in 5 places (see Orientation). A class added to
  `httpErrors` but omitted from `ClientErrors`, or a literal status widened to
  `number`, type-checks fine today. This is the single cheapest way to make every
  later edit safe. Currently only 3/40 classes get literal assertions
  (`test.spec.ts:616-626`).
- **Files:** `test.spec.ts` (add a new `describe` block).
- **Change:** add these assertions.
  1. **Union ⇄ array exhaustiveness (compile-time):**
     ```typescript
     import type { HttpErrors, ClientErrors, ServerErrors } from "./src/errors/helpers";
     // every constructor in httpErrors produces a ClientErrors | ServerErrors instance
     expectTypeOf<InstanceType<HttpErrors>>().toEqualTypeOf<ClientErrors | ServerErrors>();
     ```
  2. **Cardinality (runtime):**
     ```typescript
     test("roster cardinality is exactly 40 and map ⇄ array agree", () => {
       expect(httpErrors.length).toBe(40);
       expect(statusCodeErrorMap.size).toBe(40);
       const arrayStatuses = new Set(httpErrors.map((C) => C.status));
       const mapStatuses = new Set(statusCodeErrorMap.keys());
       expect(arrayStatuses).toEqual(mapStatuses);
       for (const [code, C] of statusCodeErrorMap) expect(C.status).toBe(code);
     });
     ```
  3. **Literal status/statusText for ALL 40 (compile-time), not just 3.** Replace the
     3-class block at `test.spec.ts:616-626` with a data-driven check. Because
     `expectTypeOf` needs literals, assert per class in the existing
     `test.each(httpErrors)` loop using the static side:
     ```typescript
     // inside test.each over [name, Class]
     expectTypeOf(Class.status).not.toEqualTypeOf<number>();
     expectTypeOf(Class.statusText).not.toEqualTypeOf<string>();
     expect(Number.isInteger(Class.status)).toBe(true);
     ```
     > If `expectTypeOf(...).not.toEqualTypeOf<number>()` proves too weak (it passes for
     > any literal), also keep an explicit `expectTypeOf(NotFoundError.status).toEqualTypeOf<404>()`
     > style assertion for a representative code per hundred (400, 418, 451, 500, 511).
- **Verify:** `pnpm typecheck` and `pnpm test`. Then prove the guard bites: temporarily
  widen `not-found-error.ts:5` to `status: number = 404` and confirm `pnpm typecheck`
  **fails**; revert.
- **Breaking:** No.
- **Effort:** S.

### P1-05 — Handle opaque / status-0 responses

- **Why:** In browsers, `mode: "no-cors"` yields `response.type === "opaque"`,
  `status === 0`. That passes the `res.status >= 400` check at `src/index.ts:107` as
  "success," and the caller's `response.json()` then throws. The package explicitly
  claims browser support and this path is unhandled and untested.
- **Files:** `src/index.ts:107-120`; README never-throws section (P0-02).
- **Change (chosen behavior — document it): leave opaque responses on the success
  branch but document them.** They are not HTTP errors; forcing them into the error
  channel would surprise CORS-preflight users. Add to the never-throws doc: "Opaque
  responses (`mode:"no-cors"`, `status:0`) come back as `response`, per the fetch spec;
  their body is unreadable and `json()`/`text()` will reject." No code change if you
  accept this; if the maintainer wants them as errors, see JUDGMENT CALL J-1.
- **Verify:** opaque responses cannot be produced under `node:http`, so add a **unit**
  test that constructs a synthetic status-0 `Response` and asserts current
  classification is documented behavior. Minimal:
  ```typescript
  test("status 0 is treated as success (documented opaque behavior)", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = async () =>
      Object.assign(new Response(null, { status: 200 }), { status: 0 }) as Response;
    // simplest: assert typedFetch does NOT return an HTTP error for status 0
    // (skip if Response.status is non-configurable in your Node; then document-only)
    globalThis.fetch = orig;
  });
  ```
  If `Response.status` is read-only in the target Node (it is in current undici),
  this item is **documentation-only** and the test is skipped with a comment. Run `pnpm test`.
- **Breaking:** No.
- **Effort:** S (mostly docs).

### P1-06 — Optional `fetch` injection

- **Why:** No way to swap the underlying fetch for testing, DI, a custom agent, or a
  polyfill without patching `globalThis`. Three lines. Removes global-patch hacks from
  consumer test suites.
- **Files:** `src/index.ts:61-98`; README API section.
- **Change:**
  ```typescript
  export type TypedFetchOptions = FetchParams[1] & {
    headers?: TypedHeaders;
    method?: HttpMethods | (string & {});
    /** Override the fetch implementation (testing, DI, custom agents). */
    fetch?: typeof fetch;
  };
  // in typedFetch:
  const { fetch: fetchImpl = fetch, ...init } = options;
  res = await fetchImpl(url, init);
  ```
  Ensure `fetch` is stripped from what's forwarded to the real fetch (destructure it out).
- **Verify:** `test.spec.ts` — pass a stub `fetch` that returns a canned 404 and assert
  `error instanceof NotFoundError` without the test server. Assert the stub received
  no `fetch` key in its `init`. Run `pnpm test`.
- **Breaking:** No.
- **Effort:** XS.

### P1-07 — Fill the enumerated coverage gaps

- **Why:** The audit found specific untested paths. Close them with concrete
  assertions (no coverage tool needed).
- **Files:** `test.spec.ts`.
- **Change — add these tests:**
  - `src/index.ts:100` fallback branch: stub `fetch` to reject with a non-`Error`
    (e.g. `throw "boom"`); assert `error instanceof NetworkError` and
    `error.message === "Network error"`.
  - `src/index.ts:100` `|| err.name` branch: reject with an `Error` whose `message`
    is `""` but `name` is `"AbortError"`; assert `error.message === "AbortError"`.
  - `base-http-error.ts:40-46`: assert `error.clone().blob()` and
    `error.clone().arrayBuffer()` resolve for a 400 with a body.
  - `base-http-error.ts:20-24` empty-statusText branch: respond with a status whose
    reason phrase the server omits; assert `error.message === "HTTP <code>"` (no phrase).
  - `redirect: "error"` mode: assert it surfaces as `NetworkError`.
  - `method` as arbitrary string `(string & {})`: call with `method: "REPORT"` and
    assert it round-trips (server echoes method via a header).
  - `TypedHeaders` as a `Headers` instance and as `[["k","v"]]` tuples: assert both
    compile and send.
- **Verify:** `pnpm test` — new tests pass; `pnpm typecheck` still green.
- **Breaking:** No.
- **Effort:** M.

### P1-08 — (Optional, recommended) Codegen the 40 error files

- **Why:** 40 near-identical 9-line files, each declaring status/statusText twice, plus
  the array/map/unions, are a standing sync liability. A generator from one data table
  eliminates the 5-place problem structurally and emits P1-01's hardcoded `name` for free.
- **Files:** new `scripts/generate-errors.ts`; it regenerates `src/errors/*-error.ts`,
  `src/errors/helpers.ts` (array + unions), `src/http-status-codes.ts` (map).
  Source of truth: a `[code, statusText, className, "client"|"server"]` table.
- **Change:** write the generator; add `"generate": "tsx scripts/generate-errors.ts"`
  and a `"generate:check"` that regenerates to a temp dir and diffs, wired into CI so a
  hand-edit that drifts from the table fails.
- **Verify:** run `pnpm generate`, then `git diff --exit-code src/` must be empty
  (generator reproduces current tree byte-for-byte after formatting). Then
  `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check && pnpm build`.
- **Breaking:** No.
- **Effort:** M–L.
- **JUDGMENT CALL J-3** (see below): do this now, or defer to post-1.0. Recommendation:
  do it now if you also want P1-01 clean; otherwise defer and do P1-01 by hand.

**Phase 1 gate:** All four gates green + `pnpm build` exit 0. `isKnownHttpError` exported
and proven to narrow. Roster sync tests (P1-04) in place and demonstrated to fail on a
deliberate drift. Coverage gaps from P1-07 closed. `error.url` present. If P1-08 done,
`git diff --exit-code src/` after `pnpm generate` is empty.

---

## Phase 2 — Release engineering & runtime proof (non-breaking)

Make the release process trustworthy and prove the runtime claims before the 1.0 tag.

### P2-01 — Prove Bun / Deno / Node 24 support in CI

- **Why:** README (`README.md:52`) claims browsers, Deno, Bun, edge runtimes. CI matrix
  is Node 20 + 22 only; local dev is Node 24. Untested claims are marketing.
- **Files:** `.github/workflows/ci.yml`.
- **Change:** add Node 24 to the matrix. Add two jobs: a Bun job (`oven-sh/setup-bun`,
  run a tiny script that imports the built `dist` and asserts a 404 → `NotFoundError`)
  and a Deno job (`deno check` against a `.ts` that imports the package, plus a runtime
  smoke). Keep them as smoke tests, not full suites.
- **Verify:** CI green on all matrix legs on a PR.
- **Breaking:** No.
- **Effort:** S.

### P2-02 — Pin GitHub Actions to commit SHAs

- **Why:** Actions are pinned to major tags (`@v6`), mutable. Low blast radius (OIDC,
  no secrets) but cheap to harden and expected for a published-to-npm package.
- **Files:** `.github/workflows/ci.yml`, `.github/workflows/release.yml`.
- **Change:** replace `@v6` etc. with `@<full-sha> # v6` for every third-party action.
  Dependabot already tracks github-actions weekly and will keep them current.
- **Verify:** `rg -n "uses:" .github/workflows/*.yml` shows every third-party action
  pinned to a 40-char SHA. CI green.
- **Breaking:** No.
- **Effort:** S.

### P2-03 — Adopt a mechanical release + changelog process

- **Why:** Versioning is manual; git tags are missing for 0.4.0–0.7.2; CHANGELOG only
  details 0.8.0. Going into a 1.x support commitment this must be reproducible.
- **Files:** add `.changeset/` config (or a documented manual `RELEASING.md`); update
  `release.yml` if using changesets' action.
- **Change (choose one — see JUDGMENT CALL J-4):**
  - **A. Changesets:** `pnpm add -D @changesets/cli`, `pnpm changeset init`, PRs carry a
    changeset, release action opens a version PR. Highest ceremony, best changelog.
  - **B. Manual, disciplined:** keep hand versioning but add a `RELEASING.md` that
    mandates: bump version, write CHANGELOG entry, merge a green PR, tag the exact
    `origin/main` tip, and push only `v<x>` (the tag push triggers `release.yml`).
    Every publish gets a tag, no exceptions.
  - **Recommendation:** B for a solo maintainer. Changesets is overhead you'll fight.
- **Verify:** `RELEASING.md` exists (or changesets configured); the tag → publish path
  is documented; a dry run `npm pack --dry-run` matches the live tarball file list
  (14 files today).
- **Breaking:** No.
- **Effort:** S (B) / M (A).

### P2-04 — Confirm provenance actually attaches

- **Why:** `release.yml` passes `--provenance` but CLI metadata couldn't confirm an
  `attestations` block on the published tarball. Provenance that isn't actually
  attached is a false trust signal.
- **Files:** none (verification only) — or fix `release.yml` if broken.
- **Verify:** after the next publish, `npm view @pbpeterson/typed-fetch --json` shows a
  `dist.attestations`/provenance field, and the npmjs.com page shows the provenance
  badge. If absent, ensure `id-token: write` (already present) and npm ≥ 11.5 in the
  runner (already installed), and that the workflow uses OIDC trusted publishing.
- **Breaking:** No.
- **Effort:** XS (check) — S if it needs fixing.

### P2-05 — Write the human-onboarding docs

- **Why:** All contributor knowledge lives only in the Claude maintainer skill,
  invisible on GitHub and to non-Claude agents. There is no `CONTRIBUTING.md`.
- **Files:** add `CONTRIBUTING.md`; add a "Development" section link from `README.md`.
- **Change:** a short `CONTRIBUTING.md`: prerequisites (Node ≥ 20, `pnpm@10.33.0` —
  note it's pinned via `packageManager` and esbuild is explicitly allowlisted in
  `onlyBuiltDependencies`), the release gates, how to add a status code (or
  "edit the table and run `pnpm generate`" if P1-08 landed), and the release policy
  from P2-03 + the semver policy from the Release Policy section below.
- **Verify:** `CONTRIBUTING.md` present; a fresh `git clone && pnpm install && pnpm test`
  following only the doc succeeds.
- **Breaking:** No.
- **Effort:** S.

**Phase 2 gate:** CI matrix covers Node 20/22/24 + Bun + Deno, all green. Actions
SHA-pinned. Release process documented and tag-driven. Provenance confirmed on a real
publish (or a dry run demonstrably wired). `CONTRIBUTING.md` present.

---

## Phase 3 — Breaking changes (single window, cut as 1.0.0)

**This is the only phase allowed to break the API.** Land all of it together, behind
the `1.0.0` tag, with a "Migrating from 0.x" section in the CHANGELOG. P1-03 and P1-04
must already be in place.

### P3-01 — Remove the `ErrorType` generic from `typedFetch`

- **Why:** `typedFetch<User, NotFoundError>` is enforced by an unchecked cast at
  `src/index.ts:112`. Ask for `NotFoundError`, receive a 403, and you get a
  `ForbiddenError` typed as `NotFoundError`. The feature makes the type system lie.
  Narrowing via `instanceof` / `isKnownHttpError` + `switch (error.status)` (P1-03) is
  the sound replacement.
- **Files:** `src/index.ts:46-54` (`TypedFetchReturnType`), `:92-95` (signature),
  `:112` (cast); `index.ts` exported-type list; `README.md:205-216` ("Narrowing with
  Specific Client Errors"), `README.md:313-332` (API reference).
- **Change:** drop the second type parameter everywhere.

  ```typescript
  export type TypedFetchReturnType<JsonReturnType> =
    | { response: TypedResponse<JsonReturnType>; error: null }
    | { response: null; error: TypedFetchError }; // ClientErrors | ServerErrors | UnknownHttpError | NetworkError

  export async function typedFetch<JsonReturnType>(
    url: FetchInput,
    options: TypedFetchOptions = {},
  ): Promise<TypedFetchReturnType<JsonReturnType>> { ... }
  ```

  Remove the `as ErrorType | ServerErrors` cast at `:112`; construct the mapped class
  directly. Rewrite the README section to teach `isKnownHttpError` + `switch`.

- **Verify:** `pnpm typecheck` — replace the old narrowing type test with:
  ```typescript
  const { error } = await typedFetch<User>(url());
  if (error && isKnownHttpError(error)) {
    if (error.status === 403) expectTypeOf(error).toEqualTypeOf<ForbiddenError>();
  }
  ```
  Confirm `typedFetch<User, NotFoundError>(...)` now fails to compile (grep the test
  file to ensure no call site still passes two type args). Run `pnpm test`.
- **Breaking:** **Yes.** Callers passing a second type arg won't compile. Migration:
  delete the second arg; use `isKnownHttpError` + `switch`/`instanceof`.
- **Effort:** S.

### P3-02 — Split abort & timeout out of `NetworkError`

- **Why:** User cancellation and timeouts are not network failures. Today all three
  collapse into `NetworkError`, and the README's own workaround
  (`README.md:154`: `(error.cause as Error)?.name === "AbortError"`) is an untyped cast
  that admits the taxonomy is missing members. `AbortSignal.timeout()` (which the
  README recommends) produces a `TimeoutError` DOMException flattened the same way.
- **Files:** `src/index.ts:97-105` (catch block); new
  `src/errors/aborted-error.ts` + `src/errors/timeout-error.ts`; `src/errors/index.ts`;
  `src/errors/helpers.ts` (`TypedFetchError` union at line 94); root `index.ts`;
  `README.md:143-168`.
- **Change:** in the catch, inspect the caught error:
  ```typescript
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { response: null, error: new AbortedError("Request aborted", { cause: err }) };
    }
    if (err instanceof Error && err.name === "TimeoutError") {
      return { response: null, error: new TimeoutError("Request timed out", { cause: err }) };
    }
    const message = err instanceof Error ? err.message || err.name : "Network error";
    return { response: null, error: new NetworkError(message, { cause: err }) };
  }
  ```
  Model `AbortedError`/`TimeoutError` like `NetworkError` (extend `Error`, hardcoded
  `name`, `cause`). Add both to the `TypedFetchError` union and consider
  `isAbortError` / `isTimeoutError` guards. Rewrite the README "Network Errors" and
  "Timeouts" sections to use the new classes instead of `cause` casting.
  > Decision point: whether `AbortedError`/`TimeoutError` extend `NetworkError`
  > (backward-lenient — `isNetworkError` still catches them) or extend `Error`
  > directly (clean taxonomy — existing `isNetworkError` checks stop matching aborts).
  > See JUDGMENT CALL J-5. Recommendation: extend `Error` directly; that is the whole
  > point, and 1.0 is the window to break it.
- **Verify:** `test.spec.ts` — the existing pre-aborted-signal test (currently asserts
  `NetworkError` + `AbortError` cause) becomes: assert `error instanceof AbortedError`
  and `error.cause?.name === "AbortError"`. Add a timeout test using
  `AbortSignal.timeout(1)` against a slow server route; assert `error instanceof TimeoutError`.
  Run `pnpm test` and `pnpm typecheck`.
- **Breaking:** **Yes.** Code matching aborts/timeouts as `NetworkError` must switch to
  the new classes (or the `isNetworkError` behavior change, per J-5).
- **Effort:** M.

### P3-03 — Freeze the public surface and lock the semver contract in types

- **Why:** Before promising 1.x stability, assert the exact export set so an accidental
  addition/removal is a red test, not a silent minor.
- **Files:** `test.spec.ts` (or a new `api-surface.spec.ts`).
- **Change:** snapshot the named exports of the built package:
  ```typescript
  test("public API surface is frozen", async () => {
    const mod = await import("../dist/index.mjs");
    expect(Object.keys(mod).sort()).toMatchSnapshot();
  });
  ```
  Commit the snapshot. Any export change now requires an intentional snapshot update
  and a semver decision.
- **Verify:** `pnpm test` after `pnpm build`; deliberately add a throwaway export,
  confirm the test fails, revert.
- **Breaking:** No (test-only), but it gates all future breaking changes.
- **Effort:** S.

**Phase 3 gate (this IS the 1.0 gate — see "Definition of production ready"):** All four
gates green, `pnpm build` exit 0, CI matrix (Node 20/22/24 + Bun + Deno) green. Second
type arg removed and its removal proven by a failing-compile check. Abort/timeout split
landed with tests. API-surface snapshot committed. CHANGELOG has a "Migrating from 0.x"
section covering P3-01 and P3-02. Bump to `1.0.0`, tag `v1.0.0`, push tag.

---

## Explicitly OUT of scope for 1.0

Paste-ready for the README ("Non-goals"):

- **Retries** — belongs to a policy layer; a thin fetch wrapper shouldn't own backoff.
- **Interceptors / hooks / middleware** — the moment we add them we're a worse `ky`;
  compose `typedFetch` in your own function instead.
- **Base-URL / instance configuration (`create()`)** — wrap `typedFetch` yourself; the
  README shows the 3-line pattern.
- **Query-string builder** — use `URL`/`URLSearchParams`; that's what they're for.
- **Request-body serialization** — pass `body`/`headers` exactly like native fetch.
- **Response caching** — out of a request library's remit.
- **Runtime response-body validation as a hard dependency** — a Standard Schema hook is
  planned as an _additive, zero-dependency_ feature for a later minor, not 1.0.
- **`rawStatusText` field** — the wire reason phrase is already on `error.message`;
  adding a second field is post-1.0 if demand appears.
- **Making body reads never-throw (eager buffering)** — it would break streaming
  semantics; the never-throws guarantee is documented to end at the response envelope.

---

## Release / semver policy (must be written into CONTRIBUTING.md + README)

1. **Registering a new HTTP error class in `ClientErrors`/`ServerErrors` is a
   `major`.** It widens the returned union and necessarily moves that status
   from `UnknownHttpError` to a different runtime class. Consumers should still
   keep a `default` branch for forward compatibility and mixed versions.
2. **`error.message` text is NOT part of the contract.** Assert on `.status`/`.name`.
   We may change message wording in any release.
3. **`statusText` is the library's canonical protocol label, not the wire value**, and
   is part of the contract (it's literal-typed). Labels normally follow the current
   IANA registry; 418 (`"I'm a teapot"`) and 510 (`"Not Extended"` without the
   registry's lifecycle annotation) are intentional historical exceptions.
4. **Removing/renaming any named export, or changing a class's `status`/`statusText`
   literal, is `major`.** Enforced by the API-surface snapshot (P3-03) and roster tests
   (P1-04).
5. **Every publish gets a git tag `v<version>`**, and the tag push is what triggers the
   release workflow. No more untagged npm versions.
6. **Node engines:** `>=20` stays. Dropping a Node major is `major`.

---

## Definition of "production ready" — the 1.0.0 checklist

All must be green before cutting `v1.0.0`:

- [x] `pnpm test` passes (423 tests, including the release-policy suite).
- [x] `pnpm typecheck`, `pnpm lint`, `pnpm format:check` all exit 0.
- [x] `pnpm build` exits 0; `npm pack --dry-run` file list matches expectations
      (no source/test/config leak).
- [x] Documentation examples, packed-tarball consumer checks, and both dependency
      audits pass.
- [ ] CI green on Node 20, 22, 24 **and** Bun **and** Deno smoke jobs before
      `v1.0.0` (historical exception: the tag's Deno job failed and was fixed
      post-release; the release dependency is now fail-closed).
- [x] Roster sync test (P1-04) present and proven to fail on a deliberate drift.
- [x] API-surface snapshot (P3-03) committed and proven to fail on a stray export.
- [x] `isKnownHttpError` exported and proven to narrow `switch (error.status)` to a
      single class.
- [x] Consumer-defined `BaseHttpError` subclasses are proven not to pass the
      `isKnownHttpError` predicate.
- [x] `ErrorType` second type parameter removed; two-arg calls fail to compile.
- [x] Abort and timeout return `AbortedError` / `TimeoutError`, not `NetworkError`.
- [x] README: never-throws boundary documented, clone example doesn't throw,
      `statusText` policy and historical exceptions documented, narrowing section
      rewritten, timeouts/abort section rewritten.
- [x] `CONTRIBUTING.md` present; frozen-lockfile install and the documented gates pass.
- [x] Semver policy (above) written into CONTRIBUTING.md and README.
- [x] Actions SHA-pinned; release provenance and OIDC are configured in code.
- [x] npm trusted publisher configured and provenance confirmed after publication.
- [x] CHANGELOG has a complete `1.0.0` entry with a "Migrating from 0.x" section.
- [x] Git tag `v1.0.0` pushed; release workflow published with provenance.

---

## Resolved judgment calls

- **J-1 (P1-05) — Opaque/status-0 responses: success or error?**
  Options: (a) keep on success branch, document (chosen default); (b) classify as an
  error class. **Decision: (a).** They're spec-normal for `no-cors`; erroring
  would surprise. Only revisit if users report silent-body-read failures.

- **J-2 (P1-02) — Is changing `error.message` text a breaking change?**
  Options: (a) non-breaking, message text is not contract (chosen default);
  (b) breaking, defer to Phase 3. **Decision: (a)** with policy rule #3 so
  this is settled forever.

- **J-3 (P1-08) — Codegen the 40 error files now, or defer post-1.0?**
  Options: (a) now — clean P1-01, structurally kills the 5-place sync problem;
  (b) defer — do P1-01 by hand. **Decision: (b)** for 1.0, with the roster and
  literal-type guardrails from P1-04.

- **J-4 (P2-03) — Changesets vs. disciplined manual releases?**
  **Decision: manual + `RELEASING.md`** for a solo maintainer; adopt changesets
  only if/when there are multiple contributors.

- **J-5 (P3-02) — Should `AbortedError`/`TimeoutError` extend `NetworkError` or `Error`?**
  Options: (a) extend `NetworkError` (existing `isNetworkError` still catches them —
  lenient); (b) extend `Error` directly (clean taxonomy, `isNetworkError` stops matching
  — a break). **Decision: (b).** Clean separation is the entire reason for the
  split, and 1.0 is the one window to make it. Provide `isAbortError`/`isTimeoutError`.

- **J-6 (Semver policy #1) — Adding an error class: minor or major?**
  Options: (a) minor (conventional for some union widening); (b) major
  (maximally safe for both exhaustive-switch consumers and runtime
  `UnknownHttpError` checks). **Final decision: (b)** because registering a
  mapped class necessarily changes an existing status's runtime type. Keep the
  `default` recommendation for forward compatibility and mixed versions.
