# AUDIT-PLAN.md — Iterative multi-agent bug hunt for `@pbpeterson/typed-fetch`

> **READ THIS FIRST.** You are reading this file in a fresh context window. You
> have NO memory of the conversation that produced it. Everything you need is in
> this file. Do not look for prior conversation context — there is none. Follow
> this plan from top to bottom. Where this plan says "read file X before doing
> Y", do exactly that.
>
> **This file is disposable.** It is untracked, it is not part of the published
> package (`files` in `package.json` ships only `dist` and `errors/package.json`,
> and `verify-pack` enforces that), and it must never be committed. Delete it
> when the audit is finished.

---

## 1. What this project is

- **Repository:** `/Users/pbpeterson/code/projects/typed-fetch`
- **Package:** `@pbpeterson/typed-fetch` on npm
- **What it does:** a zero-runtime-dependency, type-safe `fetch` wrapper that
  returns request failures **as values** — a `{ response, error }` discriminated
  union (the "envelope") — instead of throwing. 40 dedicated HTTP error classes
  (the "roster"), plus `UnknownHttpError`, `NetworkError`, `AbortedError`,
  `TimeoutError`, and five brand-keyed type guards (`isHttpError`,
  `isKnownHttpError`, `isNetworkError`, `isAbortError`, `isTimeoutError`).
- **Branch:** `main`
- **Version in `package.json`:** still `2.0.1` (the next release will be a
  **major** — see section 12).
- **Node floor:** `>=20.13.0`. Package manager pinned: `pnpm@10.33.0`.
- **Zero runtime dependencies.** Published via npm OIDC trusted publishing with
  provenance.

### Architecture in one paragraph

`typedFetch` (in `src/index.ts`) runs in THREE phases, each with its own catch:
SETUP (read options, serialize the request input once, capture the governing
signal once), TRANSPORT (the single awaited `fetch` call — the ONLY phase that
can produce `AbortedError` or `TimeoutError`), and RESPONSE (validate the
resolved value; select the error class with `statusOf(res) >= 400`).
`src/request-failure.ts` classifies rejections (the AbortSignal is the
authority, never the rejection's name). `src/errors/base-http-error.ts` owns
HTTP error IDENTITY (`status`, `statusText`, `url`, `headers`, `message`);
`src/errors/error-body.ts` owns the single-use body lifecycle (claim, cancel,
tee) behind a closure — the `Response` is never reachable from the error;
`src/errors/response-identity.ts` records the FIRST successful read of every
identity field per `Response` so a shifting getter cannot make two errors
disagree. Cross-copy recognition uses `Symbol.for` brands, never `instanceof`.
`src/` contains ZERO regular expressions, deliberately (no ReDoS surface — keep
it that way).

### Documents you MUST read before reporting anything

Open and read these files in the repository before triaging any finding:

1. `CONTRIBUTING.md` — especially the section **"The gates"** (the full gate
   list, reproduced in section 9 of this plan) and "Read the audit ledger
   before reporting a defect".
2. `CONTEXT.md` — the design vocabulary (module, seam, envelope, brand, copy,
   identity, claim, channel, residual) and the module map. Use these words
   exactly; do not invent synonyms.
3. `.claude/skills/typed-fetch-maintainer/SKILL.md` — the maintainer guide
   (core flow, error contract, guard semantics, gotchas).
4. `docs/audit-ledger.md` — **mandatory before reporting.** Three parts: the
   evidence bar, "Adjudicated clean" (areas already verified, with reasoning),
   and "Adjudicated closed" (reports that are correct about the code and still
   not defects). Re-reporting a ledger entry without naming it and refuting its
   reasoning is a wasted finding.
5. `SECURITY.md` — the **"Known residuals"** section (see section 6 of this
   plan).
6. `docs/adr/0003-the-untrusted-fetch-conformance-boundary.md` — the
   untrusted-`fetch` boundary: 28 in-scope rows (H-01 … H-28), 8 permanent
   out-of-scope items, and the rule that a new hostile-input defense is an ADR
   amendment PLUS a scenario in `fixtures/hostile-fetch.ts`, in one commit.
   `conformance.spec.ts` binds the ADR rows and the fixture scenarios to the
   same set with the same titles — a guard without a row fails the suite, and
   so does a row without a guard.

### The user's global rules (from `/Users/pbpeterson/.claude/CLAUDE.md`)

These bind everything you do here:

- **Answer the user in simple, plain Portuguese.** Short sentences, everyday
  words. This plan is in English because it is a working artifact, but every
  message TO the user is Portuguese.
- **All code is English:** identifiers, comments, docstrings, log messages,
  commit messages, branch names, PR titles/descriptions. Never mix languages
  inside code.
- **Conventional Commits** format (`feat:`, `fix:`, `chore:`, `test:`,
  `docs:`).
- **Commit messages in ASD-STE100 Simplified Technical English:** one idea per
  sentence, active voice, present tense, imperative mood, no idioms, sentences
  under 20 words.
- **NEVER add a Co-Authored-By line** for Claude in commit messages.
- **Never commit directly to `main`** (also a rule in `CONTRIBUTING.md`).
  Branch names: `type/short-desc`, kebab-case, e.g. `fix/audit-round-4`.
- **Commit only when asked in the flow this plan defines; never push without
  an explicit instruction from the user.**
- Prefer `rg` over `grep`, `fd` over `find`. In non-interactive Bash the
  user's shell aliases do NOT load — call real tools by name.

---

## 2. State of the repository (as of writing this plan)

- Current branch: `main`.
- Three audit rounds have already run. They found **35 defects, all fixed in
  35 commits**, all now **merged to `main`**.
- The test suite grew from 1387 to **1481 tests, all passing**.
- **Every gate is green** (full gate list in section 9).
- The working tree is **clean except for**:
  - the uncommitted `@vitest/coverage-v8@4.1.10` devDependency (shows as
    modified `package.json` and `pnpm-lock.yaml` — it is already installed in
    `node_modules`, just not committed), and
  - this plan file (`AUDIT-PLAN.md`, untracked, stays untracked).
- There is **no `vitest.config.ts`** yet — vitest runs on defaults.
- Useful orientation command (the 35 audit commits are everything after the
  `2.0.1` release commit `f0fcb7c`):

```bash
git -C /Users/pbpeterson/code/projects/typed-fetch log --oneline f0fcb7c..HEAD
```

---

## 3. What already happened: rounds 1–3

| Round   | Agents | Defects | Severity                 |
| ------- | ------ | ------- | ------------------------ |
| Round 1 | 4      | 11      | 1 high, 4 medium, 6 low  |
| Round 2 | 4      | 16      | 1 high, 5 medium, 10 low |
| Round 3 | 2      | 8       | 2 high, 2 medium, 4 low  |

### The central lesson — this drives the entire method

**Of round 2's 16 defects, 11 were caused by round 1's own fixes. Half of
round 3's 8 defects were caused by round 2's fixes.**

The failure mode was identical every time: **a fix closes one channel and
misses its sibling.** Concrete examples from the actual rounds:

- `message` was filtered (bidi/control characters removed) but its sibling
  `statusText` was not — the same hostile value reached readers through the
  other field.
- The FIRST `://` authority in a malformed URL was scanned for userinfo, but
  not the SECOND — an embedded credential in an absolute URL survived.
- `hasBrand` got a guard against a brand answered from `Object.prototype`,
  but its neighbour `asksOwnsResponse` (the ownership query) did not get the
  same guard.
- A refusal that RETURNS `false` was handled, but a refusal that THROWS was
  not.

Two **structural** fixes came out of that pattern, and future work must
respect them (do not undo them, and imitate their shape when fixing):

1. **The reason-phrase filter lives at the seam where the value is RECORDED**
   (`safeReasonPhrase` inside `statusTextOf` in
   `src/errors/response-identity.ts`), so every reader gets the safe form and
   there is no second reader to forget. When a value needs sanitizing, sanitize
   it where it is recorded, never where one consumer composes it.
2. **The identity rollback flag starts `true`** ("roll back unless the value
   was accepted", commit `3964f97`), so a refusal path added LATER is covered
   by omission — the safe outcome is the default, not one more branch to
   remember.

**Practical consequence:** when you fix anything in round 4+, immediately ask
"what is this fix's sibling?" — the other field carrying the same value, the
other guard with the same shape, the other exit path (return-false vs throw),
the second occurrence of the same pattern in the string. Grep for the pattern
before committing.

---

## 4. The seven binding rules

These are the rules of the audit. They are not suggestions.

1. **Every round is exactly 4 agents.** Never 3, never 5. (Round 3 ran with 2
   and that was a mistake — a thinner round proves less.)
2. **A round only counts as CLEAN if (a) all four agents covered DIFFERENT
   areas AND (b) at least one agent specifically attacked the fixes made in
   the immediately preceding round.** A round where nobody looked at the new
   code does not count as clean, no matter how many agents found nothing —
   because rounds 2 and 3 proved the new code is where the bugs are.
3. **Every reported defect must be proved by a test that FAILS against the
   current code.** Reading code and reasoning about it is NOT acceptable
   evidence. A hypothesis whose test passes is discarded as a defect and kept
   as a passing control test. Agents must report the exact failure output
   (the assertion diff / error text from vitest), not a description of it.
4. **Coverage target: 100% of branches** on `src/**`. Each currently uncovered
   branch gets either a real test or a `/* v8 ignore ... */` comment with a
   written justification recorded in an inventory (a table in the coverage
   lane's report: file, line, branch, why it is unreachable). Nothing passes
   silently.
5. **This artifact is disposable.** `AUDIT-PLAN.md` stays untracked, never
   ships, and is deleted at the end.
6. **Stop-and-report rule:** iterate 4 agents at a time with NO fixed ceiling
   on the number of rounds, BUT stop and report to the user as soon as a round
   finds nothing above LOW severity. The user then decides whether to keep
   hunting low findings or finish. Do not run another round on your own after
   such a result.
7. **Coverage tooling stays.** `@vitest/coverage-v8@4.1.10` is already
   installed as a devDependency (currently uncommitted). Commit it, add a
   `coverage` script, and configure a vitest coverage threshold of **100%
   branches** so a future fix that uncovers a branch breaks the gate. (Exact
   sequencing in the runbook, section 11 — the 100% threshold can only land
   once the 26 branches are closed, because the suite must never be red
   between commits.)

---

## 5. Contract facts every agent must know (so findings are valid)

- **`error.message` is explicitly NOT part of the semver contract.** Behaviour
  tests must assert on `.status`, `.name`, `.statusText` — never on message
  text. A narrow constructor regression test may characterize a message branch
  without promoting the text to a guarantee. A finding whose only observable
  is message wording is at most LOW.
- **Adding a hostile-input defence may require a row in ADR 0003.**
  `conformance.spec.ts` binds the ADR's in-scope rows to the scenarios in
  `fixtures/hostile-fetch.ts` — same set, same titles, and the counts must
  match. A new guard against an injected `fetch` behavior is a two-part
  commit: ADR amendment (new row) + scenario. Check first whether the behavior
  is one of the ADR's **8 permanent out-of-scope items** — if so, it is not a
  defect at all.
- **A refused read REJECTS (the readers are `async`); a refused `clone()`
  THROWS (`tee()` is synchronous).** Keep that split; a finding that proposes
  merging them is wrong.
- **`AbortedError` and `TimeoutError` do NOT extend `NetworkError`** —
  `isNetworkError()` is `false` for both. That is the contract, not a bug.
- **`statusCodeErrorMap` is a projection derived from the `httpErrors`
  roster,** not a second source of truth. There is no map literal.
- **The error classes are structurally typed on purpose** (no `#private`,
  `private`, or `protected` anywhere on public classes) — `#private` emits a
  nominal marker that makes the `.d.ts` and `.d.mts` copies mutually
  unassignable. Do not report structural assignability as a defect (it is
  ledger item "Adjudicated closed #3"-adjacent), and never introduce a private
  member in a fix.
- Tests hit a **real local HTTP server** (no mocks). Query params drive
  responses: `?status=`, `?body=`, `?header=Key:Value`. Follow the existing
  spec files' server setup pattern.
- `pnpm typecheck` uses `tsconfig.test.json`, whose include glob is
  **root-only** — spec files must stay at the repo root to be typechecked.
  (Proof tests in `round4/` are therefore not typechecked by that gate; the
  permanent regression tests you convert them into WILL be, because they land
  in root spec files.)

---

## 6. Documented residuals — do NOT re-report these as defects

Six residuals are documented, tested, and deliberately kept. Reporting any of
them is a wasted finding. Read `SECURITY.md` ("Known residuals") and
`docs/audit-ledger.md` ("Adjudicated closed") IN FULL before reporting
anything — the list below is the summary, the files are the authority.

1. **`error.cause` reaching a crash dump.** Node's fatal-exception printer
   renders `[cause]` and ignores every inspect hook, so an unhandled `throw
error` can print the platform's message (credentials included). Every
   channel the library controls redacts it; this one it cannot.
2. **A secret in a URL PATH SEGMENT survives in `error.url`'s redacted form.**
   The redactor drops userinfo, query, and fragment, and keeps origin + path;
   dropping the path would make concurrent failures indistinguishable.
3. **A forged brand passes a type guard.** `Symbol.for` is process-global.
   The guards answer "does this claim to be one of ours?" — that is what makes
   them work across package copies. The README says the brand is not a
   security control.
4. **A `recreate` callback that locks the branch and strands it.** A callback
   that takes `branch.body.getReader()` and then returns a refused value
   defeats the release — only the reader's holder can cancel a locked stream.
   Stated on `clone()`; the rule is "do not take a reader inside `recreate`".
5. **Over-redaction in `src/errors/redact-url.ts`, case 1:** a malformed URL
   whose authority carries a port is over-redacted.
6. **Over-redaction in `src/errors/redact-url.ts`, case 2:** an `@` inside a
   path segment is over-redacted.

Also treat the ADR 0003 out-of-scope list (8 items: consistent lying, body
content, anything after the handoff, timing/resource exhaustion, forged
brands/tags, subclass self-sabotage, the deliberate `error.url`/`error.headers`
escape hatches, what `error.cause` carries) and the ledger's "Adjudicated
closed" entries as non-findings.

---

## 7. What previous rounds already proved SAFE — do not spend a round here

The following areas were attacked and held. Re-verifying them wholesale is a
waste of an agent. (A targeted finding that contradicts one of these with a
failing test is still welcome — but name what the earlier pass missed.)

- **URL redaction across well-formed shapes:** IPv6 hosts, IDN, punycode,
  percent-encoded userinfo, protocol-relative URLs, opaque schemes
  (`data:`, `mailto:`), uppercase schemes, embedded whitespace/tabs. (The
  malformed-authority edge was where rounds 2–3 found bugs — that area is NOT
  on this safe list.)
- **CRLF injection in header names and values, and method injection.** The
  transport is the authority on ByteString conversion and refusal; the
  library's messages are constants.
- **Prototype pollution** of `url`, `fetch`, `cause`, `reason`, and
  `__proto__` — the `fetch` override is read as an OWN property only (ADR row
  H-22).
- **Unbounded error bodies are never buffered.** `cancel()` never reads;
  proven with a stream whose `pull()` records buffering.
- **Zero regexes in `src/`** — no ReDoS surface at all. (Keep it that way in
  any fix.)
- **Supply chain and CI:** SHA-pinned actions, OIDC publishing with
  provenance, no `pull_request_target`, no dangerous lifecycle scripts, zero
  runtime dependencies.
- **Concurrency and resource lifetime:** 600 concurrent requests with no
  rejections; zero listener accumulation across 400 requests on one shared
  signal; no timers left alive; zero unhandled rejections on every failure
  path.
- **The error-class roster:** all 40 classes agree static-vs-instance, no
  duplicate status, `isKnownHttpError` never disagrees with `error.status`.
  Mutation testing scored the 40 status classes, `known-http-error`, and
  `unknown-http-error` at 100%.
- **Cross-copy behaviour** verified with two genuine library copies loaded in
  one process (guards, `clone()` ownership query, refusal paths).

---

## 8. Measured coverage baseline (round 3 end state)

Command used (reproduce it exactly to re-measure):

```bash
npx vitest run --coverage.enabled --coverage.provider=v8 --coverage.include='src/**' --coverage.reporter=text
```

Results:

| Metric     | Coverage | Counted |
| ---------- | -------- | ------- |
| Statements | 98.48%   | 847/860 |
| Branches   | 94.19%   | 422/448 |
| Functions  | 100%     | 117/117 |
| Lines      | 99.23%   | 774/780 |

### The 26 uncovered branches, per file

- **`src/index.ts` — 6:**
  - line 143 col 57, binary-expr arm 2 — the `typeof value === "function"`
    arm of `isObjectLike` is never the deciding arm.
  - line 180, if arm 0 — `if (!validatedResponseStructures.has(response))
return false;` in `hasCompatibleSuccessSurface`: the early-return arm.
  - two `if` arm 1 with no line recorded.
  - line 685 col 77, cond-expr arm 1 — the fallback arm of
    `nativeRequestUrl`: `typeof getter === "function" ? Reflect.apply(...) :
request.url` — the plain-read arm only runs on a runtime where
    `Request.prototype.url` is a data property.
  - one more `if` arm 1 with no line recorded.
- **`src/request-failure.ts` — 2:**
  - line 43 col 49, cond-expr arm 1 — in `readStringProperty`, the
    `: undefined` arm (a `name` read that succeeds but is not a string).
  - line 76, if arm 0 — in `isError`, `if (value === null || typeof value !==
"object") return false;`: the early-return arm.
- **`src/errors/base-http-error.ts` — 1:**
  - line 526 col 72, cond-expr arm 1 — `identity ? lendIdentity(...) :
undefined` in `clone()`: the no-identity arm (an error whose `identities`
    table entry is absent).
- **`src/errors/error-body.ts` — 9:**
  - lines 135, 137, 139, 142, cond-expr arm 0 — the module-load platform
    guards: `typeof Response === "undefined" ? undefined : ...` and
    `typeof ReadableStream === "undefined" ? undefined : ...` (capturing
    `nativeResponseBodyGetter`, `nativeResponsePrototype`,
    `nativeReadableStreamCancel`, `nativeReadableStreamLockedGetter`).
  - four `if` arm 1 with no line recorded.
  - line 227, if arm 0 — `if (typeof nativeReadableStreamLockedGetter !==
"function") return false;` in `isNativeReadableStream`: the arm taken only
    when the platform guard above fired.
- **`src/errors/response-identity.ts` — 8:**
  - line 333 col 45, binary-expr arm 1 — `character.codePointAt(0) ?? 0` in
    `safeReasonPhrase`: the `?? 0` arm (unreachable for a `for...of`
    character — the untaken arm of the `||`/`??` chain).
  - lines 368, 382, 400, 417, if arm 0 — the `key === undefined` /
    `!keyable(response)` NON-KEYABLE paths in `statusTextOf`, `urlOf`,
    `headersOf`, and `hasTypedResponseIdentityScalars` (line 368:
    `if (key === undefined) return safeReasonPhrase(textOf(response.statusText));`).
  - line 450 col 45, cond-expr arm 1 — `keyable(response) ? response :
undefined` in `identityOf`: the `undefined` arm.
  - two `if` arm 1 with no line recorded.

### Characterization (verified against the source)

- The **9 in `error-body.ts` around lines 135–142** are module-load platform
  guards (`typeof Response === "undefined"`, `typeof ReadableStream ===
"undefined"`, plus `?.get` optional chaining on the descriptor lookups).
  They only fire in a runtime lacking those globals — likely genuinely
  unreachable without loading the module in a worker/VM context with the
  globals deleted BEFORE import. Candidates for justified `v8 ignore` if a
  real test is impractical; but first try loading the module in a
  `node:worker_threads` or `node:vm` context with the global removed.
- The **`response-identity.ts` ones** split in two:
  - the untaken arms inside `safeReasonPhrase` (`?? 0`) — near-unreachable by
    construction;
  - the `key === undefined` **non-keyable path** in `statusTextOf`, `urlOf`,
    `headersOf`, `hasTypedResponseIdentityScalars`, `identityOf` — a response
    that is not a valid `WeakMap` key (i.e. a primitive-adjacent or
    non-keyable value reaching identity reads). **This looks like a REAL test
    gap worth closing** — write the test; if the path is reachable with a
    hostile response, it may hide a defect (an unrecorded identity means a
    second read CAN diverge on that path).
- **`src/index.ts:143`** is the untaken `typeof value === "function"` arm of
  `isObjectLike` — a callable masquerading as a response/body/headers object
  exercises it.

---

## 9. The gates — run ALL of them before EVERY commit

The authoritative list is `CONTRIBUTING.md`, "The gates". Reproduced here as
directly runnable commands (use `npx` so nothing depends on shell aliases or
a global install):

```bash
npx oxlint src
npx oxfmt --check
node scripts/check-doc-style.mjs
npx tsc --noEmit -p tsconfig.test.json
npx tsup
npx vitest run --exclude 'round4/**' --exclude '**/node_modules/**'
node scripts/check-docs.mjs
node scripts/verify-pack.mjs
node scripts/check-consumer.mjs
node scripts/check-deno-consumer.mjs
deno check scripts/smoke/deno.ts && deno run --allow-net scripts/smoke/deno.ts
node scripts/smoke/node-min.mjs
npx pnpm@10.33.0 audit --prod --audit-level low
npx pnpm@10.33.0 audit --audit-level low
```

Ordering constraints:

- **`check-docs`, `verify-pack`, `check-consumer`, and `check-deno-consumer`
  all require `npx tsup` to have run first** — they read `dist/`. Run the
  build before them, always.
- `public-surface.spec.ts` also reads `dist/` — with no `dist/` it silently
  skips (with a printed warning), so a test run without a fresh build proves
  less than it appears to.
- The two audits use the pinned pnpm version (`pnpm@10.33.0`, the
  `packageManager` value) via `npx pnpm@10.33.0 ...`.
- `smoke:node-min` proves nothing unless it runs on a real Node 20.13.0
  binary — on a newer runtime it warns instead of failing. Run it anyway; do
  not treat the warning as a failure.
- The vitest run **excludes `round4/**`** while proof tests exist — see
section 10. After `round4/`is deleted, run plain`npx vitest run`.

**The official suite must NEVER be left red between commits.** Every commit on
the fix branch must pass the entire list above.

---

## 10. Round 4 — the four lanes

Launch **exactly four agents, in parallel, in a single message** (rule 1).
Each agent gets: the project context (section 1), the contract facts
(section 5), the residuals (section 6), the safe list (section 7), the
mechanics below, and its own lane brief. Each agent must return: defects
found (each with a proof test file path and the EXACT vitest failure output),
hypotheses that did not reproduce (kept as passing control tests), and — for
the coverage lane — the branch inventory.

### Mechanics that bind all four agents

- Each agent writes its proof tests into the per-round directory
  **`round4/`** at the repo root (for a later round N, `roundN/`). One or more
  files per agent, e.g. `round4/coverage-lane.spec.ts`,
  `round4/anti-regression-lane.spec.ts`, `round4/portability-lane.spec.ts`,
  `round4/docs-behavior-lane.spec.ts`.
- **WARNING:** vitest's default include glob picks `round4/**/*.spec.ts` up,
  so the normal `npx vitest run` will show failures while proofs exist. That
  is expected — a proof test SHOULD fail. To run the official suite while
  proofs exist, use exactly:

  ```bash
  npx vitest run --exclude 'round4/**' --exclude '**/node_modules/**'
  ```

  To run only one lane's proofs:

  ```bash
  npx vitest run round4/coverage-lane.spec.ts
  ```

- Agents must **NOT modify `src/`** and must **NOT modify any existing file**.
  Only their own new file(s) under `round4/`. No fixes during the hunt —
  fixing is a separate, sequential phase (section 11).
- Every defect claim needs the failing output pasted verbatim. "This would
  fail" is not evidence (rule 3).

### Two traps hit repeatedly in previous rounds — warn every agent

1. **Never write literal control, bidi, or invisible characters into a spec
   file.** Always use escape sequences: `"\u0000"` (NUL), `"\u0007"` (BEL),
   `"\u200B"` (zero-width space), `"\u202E"` (right-to-left override),
   `"\u200C"` (zero-width non-joiner), `"\r\n"`, etc. Literal bytes are
   invisible in review and in diffs, and a formatter or editor can silently
   destroy them. (Escape-sequence discipline is also what made the round-3
   ZWJ/ZWNJ over-filtering bug findable.)
2. **`cp` and `rm` are aliased to interactive mode in this user's shell, and
   zsh aborts a whole command when a glob matches nothing.** In scripts and
   Bash calls, prefer Node one-liners
   (`node -e "fs.rmSync('round4', { recursive: true, force: true })"`) or
   per-path commands without globs.

### Lane 1 — Coverage lane

Target: **close all 26 uncovered branches** listed in section 8, one by one.

- For each branch: first try to write a real test that takes the branch. The
  attempt itself is the bug-finding activity — a branch nobody ever exercised
  is exactly where a wrong guard hides. Report every bug the attempt reveals
  (with its failing proof test).
- The `key === undefined` non-keyable paths in `response-identity.ts` (lines
  368, 382, 400, 417, 450) are the highest-value targets — a real gap, and on
  that path identity is NOT recorded, so a second read can diverge. Ask: can a
  hostile `fetch` deliver a non-keyable "response" that reaches those reads?
- The `error-body.ts` module-load guards (lines 135–142, 227) may need a
  `node:worker_threads` or `node:vm` context with `Response` /
  `ReadableStream` deleted before importing the module. If genuinely
  impractical, mark for `/* v8 ignore */` with a one-line written
  justification.
- Deliverable: a table (the **inventory**) with one row per branch — file,
  line, branch arm, resolution (`test added` / `v8 ignore + justification`),
  and the justification text where applicable. Nothing passes silently
  (rule 4).

### Lane 2 — Anti-regression lane

Target: **attack the 6 commits of round 3.** They are, newest first:

| Commit    | Subject                                                           |
| --------- | ----------------------------------------------------------------- |
| `3eefcf1` | docs: stop naming an unsafe forwarding idiom                      |
| `25f2b0a` | fix: escape the message layout's own delimiters                   |
| `52ae530` | fix: guard the two hasOwn calls in the inspect record             |
| `83064b0` | fix: keep the zero-width joiner and non-joiner in a reason phrase |
| `da46b4f` | fix: redact an embedded credential in an absolute URL too         |
| `3964f97` | fix: roll back unless the value was accepted                      |

The pre-round-3 baseline commit — the parent of the oldest one — is
**`5763d2e`** ("fix: tell a credential from a path before removing it", which
belongs to round 2 and is therefore OUTSIDE the range).

Verify the range before starting:

```bash
cd /Users/pbpeterson/code/projects/typed-fetch
git log --oneline 5763d2e..HEAD          # must print exactly the 6 above
git diff 5763d2e..HEAD -- src/           # the code under attack
```

The method that worked twice: for each suspicious behavior, write ONE test
file and run it against BOTH the current `HEAD` and the pre-round-3 commit,
using a **separate git worktree**, to separate:

- a **REGRESSION** — passed on `5763d2e`, fails on `HEAD` (round 3 broke it),
  from
- a **RESIDUAL** — fails on both (the round-3 fix did not close what its
  commit message claims).

Worktree commands. `$SCRATCH` below is **your own session scratchpad
directory** — the path printed in your system prompt under "Scratchpad
Directory". Do not reuse a path from a previous session; it will not exist.
Export it once and use it everywhere:

```bash
# Substitute the scratchpad path from YOUR system prompt:
export SCRATCH="<your scratchpad directory>"

cd /Users/pbpeterson/code/projects/typed-fetch

# Create the worktree at the pre-round-3 commit:
git worktree add "$SCRATCH/pre-round3" 5763d2e

# The worktree has no node_modules of its own — install them:
npx pnpm@10.33.0 --dir "$SCRATCH/pre-round3" install

# Copy the probe in. A Node one-liner, because `cp` is aliased to
# interactive mode in this user's shell and will hang waiting for input:
node -e 'const fs=require("fs"); fs.copyFileSync("round4/anti-regression.spec.ts", process.env.SCRATCH + "/pre-round3/probe.spec.ts")'

# Run it THERE. Change directory; there is no --prefix flag for this:
(cd "$SCRATCH/pre-round3" && npx vitest run probe.spec.ts)

# Run the same file on HEAD for the comparison:
npx vitest run round4/anti-regression.spec.ts

# Remove the worktree when done — always, even on failure:
git worktree remove --force "$SCRATCH/pre-round3"
```

Hunt with the sibling heuristic from section 3: for every round-3 fix, ask
"what is the sibling channel this fix did not touch?" Examples of the shape:
a filter applied to one field but not the field recorded next to it; a guard
on the return-false path but not the throw path; the first occurrence of a
pattern in a string but not the second; a flag defaulting to the unsafe value
in one module after being flipped in another.

Three round-3 proofs are known to be STALE and must not be treated as open
defects if you rediscover them: a control that counted `url` reads through a
spy getter which `9e205be` now deliberately bypasses by reading the native
`Request.prototype.url` accessor; and two body-lifecycle proofs that assert
the pre-fix behaviour of `clone()`.

### Lane 3 — Portability and tooling lane

Two halves.

**Half A — runtime portability:** Deno, Bun, browser and edge runtime
differences. Known verified facts (do not re-prove): Bun sets `bodyUsed` when
`getReader()` locks the stream (Node/Deno/workerd do not); identity,
redaction, `toJSON`, guards, and class selection are byte-identical on
Deno/Bun vs Node; `Deno.inspect` and `Bun.inspect` honour the inspect hook.
Hunt in what changed since those measurements — the round-2/3 fixes were never
re-run on Deno/Bun.

**Half B — the repo's own gate scripts (`scripts/*.mjs`).** Round 1 recorded
four gaps in the gates and NOBODY EVER RETURNED to them. They are the lane's
primary targets:

1. `public-surface.spec.ts` snapshots only the **ESM** export names and never
   the **CJS** ones.
2. `scripts/check-docs.mjs` compiles every fence under **one profile only**
   and never exercises the `.d.mts` declarations or a **no-DOM** profile.
3. `scripts/check-deno-consumer.mjs` imports only the **main entry** and never
   the **`/errors` subpath**.
4. `check-consumer` emulates the node10 directory redirect **in JavaScript
   only** and never runs `tsc` with `moduleResolution: "node"`.

For each gap: demonstrate with a failing (or trivially-passing-when-it-should-
fail) probe whether the gap hides a real defect TODAY, and report the gate
gap itself as a finding with a proposed closure.

### Lane 4 — Docs versus behaviour lane

- Round 1 only verified that README examples **COMPILE** (`check-docs` is a
  typecheck, and `CONTRIBUTING.md` itself states "compilation is necessary,
  not sufficient"). This lane executes the documented claims: for each README
  / JSDoc / skill-file behavioral claim, write a test that asserts the claimed
  behavior against the real library. A doc that claims X while the code does Y
  is a finding (decide in triage whether the code or the doc is wrong).
- Also: deeper **type-level soundness** beyond round 1's pass — narrowing in
  both directions, guard exhaustiveness (`never` checks), `JsonReturnType`
  claims, `TypedResponse` assignability edges, the `./errors` subpath types
  vs the root types. Use `expectTypeOf` / `@ts-expect-error` in a root-style
  spec (proofs still live under `round4/`).
- Respect the ledger: "Adjudicated closed" items 1 and 2 (the
  `RequestInit`-assignability and `TypedResponse`-vs-`Response` decisions) are
  settled — do not re-report.

---

## 11. The runbook — follow these steps in order

1. **Create a branch.** Never work on `main`:

   ```bash
   git -C /Users/pbpeterson/code/projects/typed-fetch switch -c fix/audit-round-4
   ```

2. **Commit the coverage tooling** (rule 7). The `@vitest/coverage-v8@4.1.10`
   devDependency is already in `package.json`/`pnpm-lock.yaml`, uncommitted.
   Add a `coverage` script to `package.json`:

   ```json
   "coverage": "vitest run --coverage.enabled --coverage.provider=v8 --coverage.include='src/**' --coverage.reporter=text"
   ```

   Create `vitest.config.ts` with coverage configuration. Set the thresholds
   at the MEASURED baseline for now (branches 94%, statements 98, functions
   100, lines 99) — the 100% branch threshold cannot land before the 26
   branches are closed, because the suite must never be red between commits.
   Raising `branches` to `100` happens in the same commit that closes the
   last uncovered branch (step 8). Remember `oxfmt` formats and sorts
   `package.json` — accept its output. Run ALL gates (section 9), then commit
   (Conventional Commits, ASD-STE100, English, no Co-Authored-By), e.g.:
   `chore: add v8 coverage tooling and a coverage script`.

3. **Launch the four round-4 agents in parallel, in a single message** — one
   per lane in section 10, each with the full shared context and its lane
   brief. They only create files under `round4/`.

4. **Wait for all four to finish.** Do not fix anything while they run.

5. **Triage findings.** For each claimed defect: re-run its proof test and
   confirm the failure output; check it against section 6 (residuals),
   section 7 (proved safe), `docs/audit-ledger.md`, and ADR 0003's
   out-of-scope list; assign severity (high / medium / low). Hypotheses whose
   tests pass are controls, not defects.

6. **Fix defects — ONE COMMIT PER DEFECT.** For each fix, in order:
   - write the fix in `src/` (English, no regexes in `src/`, no private
     members, sanitize where recorded, default-safe flags — section 3);
   - hunt the fix's SIBLING before committing (grep for the same pattern);
   - if the fix adds a hostile-input defense, amend ADR 0003 (new row) and
     `fixtures/hostile-fetch.ts` (new scenario) in the SAME commit;
   - run the COMPLETE gate list from section 9 (with the `round4/` exclusion
     while proofs still exist);
   - commit with a Conventional Commit in ASD-STE100.

7. **Convert every proof test into a permanent regression test** placed in
   the EXISTING root spec file that owns that contract. The candidates:
   `typed-fetch.spec.ts`, `base-http-error.spec.ts`, `error-body.spec.ts`,
   `response-identity.spec.ts`, `error-classes.spec.ts`, `brand.spec.ts`,
   `guards.spec.ts`, `redact-url.spec.ts`, `disclosure-channels.spec.ts`,
   `type-level.spec.ts`, `public-surface.spec.ts`, `conformance.spec.ts`.
   (Conformance scenarios go through `fixtures/hostile-fetch.ts`.) Passing
   control tests worth keeping go to the same owners. Only after every proof
   is converted, **delete the `round4/` directory**:

   ```bash
   node -e "fs.rmSync('/Users/pbpeterson/code/projects/typed-fetch/round4', { recursive: true, force: true })"
   ```

8. **Re-measure coverage** with the exact command in section 8. Close any
   branch a fix newly uncovered. When branches reach 100% (real tests plus
   justified `v8 ignore` comments), raise the vitest threshold to
   `branches: 100` and commit. From then on, an uncovered branch breaks the
   gate.

9. **Run the full gate list one final time** with NO exclusions
   (`npx vitest run`), on the branch tip.

10. **Decide per rule 6:**
    - If round 4 found anything above LOW severity → prepare round 5:
      re-measure coverage, pick four DIFFERENT areas ensuring at least one
      agent attacks the ROUND-4 fixes (rule 2 — the anti-regression lane
      repeats with the new commit range), and repeat from step 3 with
      `round5/`.
    - If round 4 found nothing above LOW severity → **STOP and report to the
      user in simple, plain Portuguese**: defects found and fixed, severities,
      test count, coverage numbers, and the question — keep hunting low
      findings, or finish? Do NOT start round 5 on your own.

11. **Never push, never merge, never tag without the user's explicit
    instruction.** When the audit ends, remind the user that `AUDIT-PLAN.md`
    should be deleted.

---

## 12. Release note (for when the user asks to release)

The next release will be a **MAJOR** version, because three already-merged
changes break compatibility:

1. The result envelope (`{ response, error }`) is now **`readonly`**.
2. **`getSetCookie` is validated on the success path**, which raises the
   effective browser floor to **Chrome 113 / Safari 17 / Firefox 112**.
3. The **error message format changed** — the reason phrase is now quoted.
   (Message text is outside the semver contract, but the format change is
   still called out.)

Releasing follows `RELEASING.md` exactly (PR-reviewed, tag-driven, OIDC).
Registering a new dedicated error class would also be major on its own. Do
not release anything as part of this audit unless the user asks.

---

## 13. Quick reference card

| Thing                       | Value                                                               |
| --------------------------- | ------------------------------------------------------------------- |
| Repo                        | `/Users/pbpeterson/code/projects/typed-fetch`                       |
| Package / version           | `@pbpeterson/typed-fetch` / `2.0.1` (next: major)                   |
| Branch                      | `main` (work on `fix/audit-round-4`)                                |
| Tests                       | 1481, all passing                                                   |
| Rounds done / defects fixed | 3 rounds / 35 defects in 35 merged commits                          |
| Coverage (branches)         | 94.19% (422/448) — 26 branches to close                             |
| Round-3 commit range        | `062d74e..HEAD` (16 commits, `5beceaa`…`3eefcf1`)                   |
| Proof-test directory        | `round4/` (excluded via `--exclude 'round4/**'`)                    |
| Agents per round            | exactly 4                                                           |
| Stop rule                   | stop + report when a round finds nothing above LOW                  |
| Clean-round rule            | 4 different areas AND one agent attacked the previous round's fixes |
| Evidence rule               | a defect exists only with a test that FAILS on current code         |
| Answers to the user         | simple, plain Portuguese; all code and commits in English           |
