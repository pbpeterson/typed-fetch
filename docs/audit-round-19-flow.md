# Audit round 19 — the complete flow

The complete operating record and procedure for round 19 of the bug and
security hunt on `@pbpeterson/typed-fetch` v2.0.1. Round 19 runs under
`docs/audit-round-16-protocol.md`, which governs round 16 and every round after
it until the loop stops. This document does not replace that protocol. It
restates the protocol for round 19, with round 19's measured state, round 19's
lane assignment, and round 19's file names, so a reader who has never seen this
repository can run the round without asking a question.

Read `CONTEXT.md` for the vocabulary. Read `CONTRIBUTING.md` for the gates.
Read `docs/audit-ledger.md` for what eighteen rounds have already settled.
Read `.audit-state.json` for the live state machine. This document quotes the
load-bearing parts of all four, so it stands alone for the duration of the
round.

Four hunter agents write failing tests. Up to four fixer agents make them
pass. One verifier agent runs the gates. One orchestrator holds the state
machine and nothing else. A `/loop` runs the cycle until two consecutive clean
rounds, or until the round-30 cap.

## Table of contents

1. [Purpose, condition, result](#1-purpose-condition-result)
2. [The state at round 19 start](#2-the-state-at-round-19-start)
3. [Why round 19 exists](#3-why-round-19-exists)
4. [Definitions](#4-definitions)
5. [Severity](#5-severity)
6. [The five phases](#6-the-five-phases)
7. [The proof rule](#7-the-proof-rule)
8. [The coverage HOLD obligation](#8-the-coverage-hold-obligation)
9. [The write-collision protocol](#9-the-write-collision-protocol)
10. [The docs grill](#10-the-docs-grill)
11. [The verification gate](#11-the-verification-gate)
12. [The stop condition](#12-the-stop-condition)
13. [Loop mechanics and the state file](#13-loop-mechanics-and-the-state-file)
14. [Return contracts](#14-return-contracts)
15. [Ledger and git](#15-ledger-and-git)
16. [The sixteen anti-patterns](#16-the-sixteen-anti-patterns)
17. [The round timeline](#17-the-round-timeline)
18. [Appendix — the round 19 briefs](#18-appendix--the-round-19-briefs)

Lane sections, inside the flow:

- [H1 — request path, cross-call custody, transport seam](#61-lane-h1--request-path-cross-call-custody-transport-seam)
- [H2 — response phase, redactor cost, the interaction surface](#62-lane-h2--response-phase-redactor-cost-the-interaction-surface)
- [H3 — disclosure, the generators, the judges](#63-lane-h3--disclosure-the-generators-the-judges)
- [H4 — public surface, packaging, documents, release readiness](#64-lane-h4--public-surface-packaging-documents-release-readiness)

## 1. Purpose, condition, result

**Purpose.** Find real defects in the library, in its documents, and in the
gates that guard it. Prove each defect with an executable test that fails on
the current tree. Fix each one without weakening the suite. Hold the 100
percent coverage the earlier rounds earned. Test every interaction between the
fixes rounds 16 through 18 landed, because round 18's largest finding was an
interaction between two fixes that were each correct alone.

**Condition.** The working tree is clean. The branch is
`chore/audit-round-16`. HEAD is `7b4c09a docs: record what round 18 settled`.
`pnpm install` has run. The orchestrator has read `docs/audit-ledger.md`
through "What round 18 settled", and has read `.audit-state.json`.

**Result.** One of two outcomes, and both are success:

- The ledger records new settled findings, and the loop schedules round 20.
- All four lanes return zero confirmed findings, the coverage hold and the
  gate both pass, `cleanStreak` moves to 1, and the loop schedules round 20 as
  the possible second clean round.

Three hard rules frame everything below:

- No agent edits code outside its lane. Sections 6 and 9 define the lanes so
  two agents can never write one file.
- No finding exists without an executable test that fails on the current tree.
  Section 7 defines this rule. It has no exceptions.
- No agent returns file contents to the main thread. Section 14 defines the
  return contracts. The orchestrator holds the state machine and nothing else.

## 2. The state at round 19 start

Every row below is a measured fact at round 19 initialization. State these as
given. Do not re-measure them at HUNT. The verifier re-measures them at
VERIFY.

| Item                | Measured value                                                         |
| ------------------- | ---------------------------------------------------------------------- |
| Branch              | `chore/audit-round-16`                                                 |
| Working tree        | clean, `git status --porcelain` empty                                  |
| HEAD                | `7b4c09a docs: record what round 18 settled`                           |
| `pnpm test`         | 83 files, 3224 tests, all pass, exit 0                                 |
| `pnpm coverage`     | 100 percent on all four axes                                           |
| Statements          | 2391 / 2391                                                            |
| Branches            | 1135 / 1135                                                            |
| Functions           | 433 / 433                                                              |
| Lines               | 2139 / 2139                                                            |
| Coverage scope      | `src/**`, `scripts/**`, `fixtures/**`                                  |
| Coverage exclusions | exactly `scripts/smoke/bun.mjs` and `scripts/smoke/deno.ts`            |
| Thresholds          | the four at 100 in `vitest.config.ts`, pinned by value since R18-H4-04 |
| `pnpm typecheck`    | exit 0                                                                 |
| `pnpm format:check` | exit 0                                                                 |
| `pnpm lint`         | exit 0, warnings only                                                  |
| State file          | `.audit-state.json`: `round` 19, `phase` `hunt`, `cleanStreak` 0       |
| Lanes               | H1, H2, H3, H4 all `pending`, zero findings recorded                   |
| Release readiness   | FALSE — see section 6.4                                                |

Round 19 therefore begins with no failing test and no coverage debt. The
coverage workstream of protocol section 8 is CLOSED. What remains is a HOLD
obligation, not a raise. Section 8 of this document states the hold.

The recent history, from `.audit-state.json`:

| Round | Findings               | Clean | Note                                                             |
| ----- | ---------------------- | ----- | ---------------------------------------------------------------- |
| 16    | 8, 7 fixed, 1 to RES-6 | no    | Coverage workstream closed: 708/1249 to 2345/2345 statements     |
| 17    | 8 claimed, 7 distinct  | no    | Four findings were defects in round 16's own work                |
| 18    | 11, 3 high, 10 fixed   | no    | Highest severity of the audit; the biggest was a fix interaction |

Eleven rounds have now passed without two consecutive clean rounds.

## 3. Why round 19 exists

The audit has not converged, and the state file says why. The
`convergenceAnalysis` object records eleven rounds without two clean rounds in
a row, a severity trend of UP — rounds 16 and 17 produced no high finding and
round 18 produced three — and this reasoning, quoted from the state file:

> Round 18's largest finding was an INTERACTION between two fixes, each
> correct alone. The number of fix pairs grows with the square of the number
> of fixes, so a round that lands N fixes hands the next round a larger
> interaction surface than the one it cleared.

Round 19 exists to attack that square. Rounds 16 through 18 landed fixes in
the request plan, in the redactor's cursor, in the redactor's suppression, in
the redactor's anchor, and in the release documents. Each pair of those fixes
is a surface no single round has tested, and round 18 proved one pair wrong.

The same object also records what is NOT self-generated churn:

> R18-H4-03 and R18-H4-01 predate the rounds that found them. R18-H1-01 lived
> in code no recent round touched. The lanes are still reaching new territory,
> not only auditing themselves.

So round 19 has two jobs at once. It audits what round 18 changed, because
three consecutive rounds have proved that a round's own fixes are the least
tested code in the tree. And it keeps reaching territory no round has touched,
because the last three rounds each found at least one defect that predates the
audit's reopening.

## 4. Definitions

These terms come from the protocol's section 4 and from `CONTEXT.md`. Each is
restated in one sentence. Use each term for exactly one concept.

- **Round** — one full pass: HUNT, then FIX when the hunt lands confirmed
  findings, then VERIFY, then the ledger append and the commits.
- **Finding** — a claimed defect that carries all six fields of section 7.
- **Confirmed finding** — a finding whose test the orchestrator has re-run and
  seen fail on the current tree, and that survived the docs grill when section
  10 requires one.
- **Clean round** — a round where all four hunt lanes return zero confirmed
  findings, the coverage hold of section 8 holds, `pnpm build`, `pnpm test`
  and `pnpm coverage` pass on the unchanged tree, and the gate of section 11
  returns no fail row.
- **Lane** — a named scope of files an agent may read closely, plus the files
  it may write; lanes exist for write disjointness, never for read secrecy.
- **Frontier item** — an entry in a lane's section 6 list marked as owned; the
  lane must return one verdict row per item.
- **Residual** — a limit the library cannot close, stated in `SECURITY.md`
  rather than left undiscovered; seven exist, RES-1 through RES-7.
- **Channel** — one mechanism through which an error's data reaches a reader;
  `fixtures/channels.ts` holds the inventory and a disclosure decision applies
  to the whole set, never to one channel.
- **Envelope** — the `{ response, error }` discriminated union `typedFetch`
  returns; anything that can throw inside a request goes inside it.
- **Seam** — the place where a module's interface lives, where behavior can be
  altered without editing in that place.
- **Roster** — the internal `httpErrors` array and the `ClientErrors` and
  `ServerErrors` groups; `statusCodeErrorMap` is a projection of it, not part
  of it.
- **Brand** — a `Symbol.for`-keyed marker stamped on a root error prototype so
  the guards answer across package copies; the brands, not the type system,
  decide identity.

## 5. Severity

Severity is one of four values. Assign the highest row that matches. The
criteria are the protocol's, verbatim in meaning. The example column names one
round-18 finding per row where round 18 produced one.

| Severity | Criterion                                                                                                                                                                                                       | Round-18 example                                                                                                                        |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| critical | A secret reaches a reader through a channel; a stream ends with no reader and `cancel()` never settles; a throw escapes the envelope; the wrong class is selected for a mapped status.                          | None. Round 18 produced no critical finding. The most recent criticals are round 14's, recorded in the ledger.                          |
| high     | An identity field is wrong; a guard answers wrong for a value this library made; a keyed table retains; a packaging defect reaches an installed consumer; a release gate passes while what it guards is broken. | R18-H1-01: an inherited `options.signal` never reached a forwarding transport, so the envelope reported success for an aborted request. |
| medium   | Wrong behavior on a hostile input inside ADR 0003's in-scope table; a documented claim is false against the built package; a remote-controlled cost that a caller cannot bound.                                 | R18-H2-02: `readsAsHostAndPort` walked 14,011,000 characters for a 14 KB redirect target the server chose.                              |
| low      | Two documents disagree; a defect reachable only from test code; a gate that cannot fail when what it guards is broken and does not guard a release.                                                             | R18-H4-05: the rewritten transport re-entry sentence is false with an own `fetch`, the audit's fourth false corrected sentence.         |

## 6. The five phases

Each round has five phases, in this order. No phase starts before the previous
one ends.

```
HUNT (4 agents, parallel)          each writes NEW failing tests in its own spec files
        |
ADJUDICATE (orchestrator)          re-run each claimed test; discard, grill, or confirm
        |
FIX (up to 4 agents, parallel)     only when confirmed findings exist; disjoint ownership
        |
VERIFY (1 agent)                   the full gate list of section 11, in order
        |
CLOSE (orchestrator)               ledger append, commits, state file update
```

The table below states, for every phase: who acts, what they may read, what
they may write, what they must return, how long it takes, what makes the phase
fail, and what the orchestrator does with the result.

| Phase      | Who acts       | May read | May write                                       | Must return                                        | Expected duration   | Fails when                                                           | Orchestrator's action on the result                              |
| ---------- | -------------- | -------- | ----------------------------------------------- | -------------------------------------------------- | ------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------- |
| HUNT       | H1, H2, H3, H4 | anything | only the lane's two round-19 spec files         | the hunter contract of section 14                  | tens of minutes     | a lane edits a file it does not own, or returns outside its contract | writes each verdict into the state file, sets lane to `returned` |
| ADJUDICATE | orchestrator   | anything | the state file; a disputed spec, after ruling   | `confirmed` or `discarded` per finding             | minutes per finding | a claimed test passes, or a settled item is re-reported              | assigns each confirmed finding a fix lane; records each discard  |
| FIX        | F1, F2, F3, F4 | anything | only the lane's owned source files of section 9 | the fixer contract of section 14                   | tens of minutes     | a fixer edits a spec, weakens a test, or returns red                 | collects returns; forwards DOC SENTENCES NEEDED lines to F4      |
| VERIFY     | one verifier   | anything | nothing, except the one `pnpm format` self-heal | the 15 gate rows plus the five coverage-hold items | tens of minutes     | any command exits nonzero without an allowed skip                    | routes a red gate back to the owning fixer; records the rows     |
| CLOSE      | orchestrator   | anything | ledger, commits, state file                     | the stop evaluation of section 12                  | minutes             | the tree is not green, or an anti-pattern of section 16 is detected  | appends the ledger, commits, evaluates the stop, schedules       |

Action, step by step:

1. The orchestrator reads `.audit-state.json` and confirms `round` 19,
   `phase` `hunt`. Section 13.2 governs any other state.
2. It launches H1 through H4 in one message, in parallel, each with its
   verbatim section 18 brief. Each lane's status moves to `running`.
3. Each hunter returns the section 14 contract. The orchestrator records the
   verdict, the frontier rows and the findings, and sets the lane to
   `returned`.
4. It adjudicates on an idle tree, after ALL four lanes return: for each
   claimed finding it runs `pnpm test <spec file> -t "<test name>"` and
   requires a failure. Round 18 recorded that concurrent-lane load produces
   false timeouts.
5. Zero confirmed findings: the round skips FIX and goes to VERIFY.
6. Otherwise it assigns each finding a fix lane by the section 9 table,
   resolves collisions by the arbitration rule, and launches the fixers in
   parallel. A finding that lives in a spec file belongs to the orchestrator,
   because no fixer may edit a spec; rounds 17 and 18 both used that path.
7. The verifier runs the section 11 gate list and returns the rows.
8. The orchestrator closes the round: ledger append, commits, state file
   update, and the stop evaluation of section 12.

The four lane sections below are the round 19 assignment. Each lane owns two
NEW spec files, one for defect proofs and one for gate-and-instrument work.
The eight names are distinct, so hunter collisions are impossible by
construction.

### 6.1 Lane H1 — request path, cross-call custody, transport seam

**Writes only:** `tests/request/round19-h1-request.spec.ts` and
`scripts/round19-h1-gate.spec.mjs`. Everything else is forbidden for writing:
not `src/**`, not an existing spec, not `vitest.config.ts`, not a document.

**Primary read scope:** `src/index.ts` setup and transport phases,
`src/request-plan.ts`, `src/request-failure.ts`, `src/methods.ts`,
`src/headers.ts`, `fixtures/hostile-fetch.ts`, `tests/request/**`, and
`docs/adr/0003-the-untrusted-fetch-conformance-boundary.md`. Read scope is a
focus, never a wall; any agent may read any file.

**Frontier items H1 owns.** One verdict row per item, with `finding`,
`closed-by-measurement`, or `closed-in-writing`.

1. **The `snapshotRequestInit` branch round 18 rewrote for R18-H1-01.** The
   branch now turns on whether the init owes a spread an entry the target does
   not own, not on the `fetch` extension alone. That predicate is one round
   old and has one shape of test behind it. Enumerate what the init can owe a
   spread: an inherited `signal`, an inherited `signal` beside an own one, a
   getter that answers differently per read, a symbol key, and a frozen
   caller object. For each shape, assert both branches, because R18-H1-01's
   own pin selected the working branch one line before it asserted.
2. **The re-entering transport that loses its own override.** The init a
   transport receives carries no own `fetch`, so a transport that calls
   `typedFetch` again with that init re-enters on the ambient transport and
   never on itself. The behavior is decided and pinned; the sentence for it is
   one of the three `docSentencesNeeded` entries H4 owns. H1's job is the
   BEHAVIOR under the round-18 branch rewrite: prove the re-entry answer did
   not move when the branch predicate moved.
3. **ADR 0003 out-of-scope item 3 as the precondition for the whole phase 3
   refusal path.** Round 17 decided, and the state file records: no genuine
   platform `Response` can reach a phase 3 refusal, so out-of-scope item 3 is
   the precondition for the WHOLE refusal path, not for one arm. The ADR
   states that only for the release path. Pin the property executably: drive
   every phase 3 refusal point and assert that each one needs a value that
   answers a structural read differently on a second presentation.
4. **The unmeasured abort-window premise on Bun, Deno and workerd.** The
   premise that the ambient `fetch` normalizes its init in a synchronous
   prologue is measured on Node only. H1 cannot run Bun or Deno here. Restate,
   in one sentence per runtime, the exact assertion a runtime smoke must
   carry, and reconcile it with the third `docSentencesNeeded` entry the state
   file already holds for the smokes.

**Forbidden re-reports:** the header-container collector, the options-snapshot
proxy invariants, the empty init dictionary, signal and abort and timeout
interleaving, body custody on refusal paths, the 22 verified spec claims in
`src/`, the round-9 through round-11 signal-read history, and any new
hostile-`fetch` guard with no ADR 0003 row.

### 6.2 Lane H2 — response phase, redactor cost, the interaction surface

**Writes only:** `tests/response/round19-h2-response.spec.ts` and
`scripts/round19-h2-gate.spec.mjs`.

**Primary read scope:** `src/index.ts` response phase,
`src/response-verdict.ts`, `src/errors/base-http-error.ts`,
`src/errors/error-body.ts`, `src/errors/response-identity.ts`,
`src/errors/redact-url.ts`, `src/errors/userinfo-spans.ts`,
`tests/response/**`, and the round-18 spec files.

**Frontier items H2 owns.**

1. **Round 18's anchor change.** The suppression's mark is now asked once,
   where the region OPENS, and condition 2 reads a colon that has text in
   front of it and precedes the authority's last `@`. That anchor closed
   R18-H2-01 and R18-H3-01 together. It is the newest rule in the module's
   most defect-dense file. Attack it the way round 18 attacked round 17's
   rule: find the input where the opening the anchor reads is not the opening
   the rebuild produces.
2. **The authority-slice clip that closed the 14,011,000-character walk.**
   R18-H2-02's fix clips the backward search to the authority slice. Verify
   the clip on the shapes the fix was not measured on: nested regions, a
   region whose slice the anchor change moves, and the interaction of the
   clip with the round-16 crossing. A cost fix that moves work to another
   walk is not a fix; round 14 recorded that lesson.
3. **The ALPHA scheme test.** R18-H2-03's fix replaced a one-character read
   with a scheme test, because a scheme must begin with ALPHA. Enumerate the
   spellings at the boundary: a one-letter scheme, a scheme with digits after
   the first letter, `+`, `-` and `.` inside the scheme, and the uppercase
   forms. Assert that the module and `new URL` agree on every one.
4. **The pairwise interaction of every redactor fix rounds 16, 17 and 18
   landed.** This is the lane's largest item and the round's reason to exist.
   The fixes: the round-16 crossing (`pastOnePop`, `popsBefore`), the
   round-17 grammar floors in `popsBefore`, the round-17 suppression
   (`readsAsHostAndPort`), the round-17 needle-route closures, the round-18
   anchor, the round-18 clip, and the round-18 scheme test. Round 18 proved
   one pair wrong: 111 of 131 answer differences belonged to the crossing
   and the suppression together and to neither alone. Build a grid that
   crosses the trigger shapes of every fix with every other fix's trigger
   shape, and judge the grid with the fixed-point property, the subsequence
   property, the no-moved-origin property, and the calibrated over-redaction
   judge. A fix verified against the suite and against its own corpus is not
   verified against the previous fix.

**Forbidden re-reports:** `claimable()` internals, the loan mechanics, the
four clone-and-loan residuals, the base64 under-redaction and the host1 case,
the path-segment secret, `file:` keeping its path, RES-6 and RES-7 as
verdicts (H3 owns their pins), and the relative branch's caller-owned
quadratic, which round 15 recorded as a residual.

### 6.3 Lane H3 — disclosure, the generators, the judges

**Writes only:** `tests/redaction/round19-h3-disclosure.spec.ts` and
`scripts/round19-h3-gate.spec.mjs`.

**Primary read scope:** `src/errors/redact-url.ts`,
`src/errors/userinfo-spans.ts`, `src/errors/brand.ts`,
`src/errors/untrusted-read.ts`, `src/errors/inspect.ts`,
`fixtures/channels.ts`, `tests/redaction/**`, `SECURITY.md`'s residual list,
and the round-16 through round-18 disclosure specs.

**Frontier items H3 owns.**

1. **RES-6.** A well-formed embedded url whose authority the parser reads
   completely, followed by a path segment holding an ordinary `@`, loses that
   authority. Round 17 proved the conflict undecidable in the module's
   current shape: the RES-6 proxy url and the pinned base64 url are two label
   substitutions of one shape, and one string carries both requirements at
   once. The residual is pinned in both directions. H3's job is the pins'
   EDGES: assert that the round-18 anchor and clip moved neither direction of
   the RES-6 pin, and report any input where the residual's recorded extent
   widened.
2. **RES-7.** The bare-`//` gap. Round 18 measured its residue on the
   over-redaction axis at 414 misleading records of 504 rows, the fixer built
   a separation, and the orchestrator reversed it because it moved five
   pinned answers. The limit is recorded and pinned in both directions. Same
   job as RES-6: hold the pins, and measure whether any round-18 change moved
   the 504-row extent.
3. **The instrument defect round 18 named.** Every `leakingChannels` sentinel
   in this repository is a raw-substring judge. Round 18's TRANSFORMED axis
   fired on 9,258 rows where the secret is absent verbatim and present in the
   spelling the URL parser writes for it, so a raw-substring judge calls it
   removed. No leak followed, because the plain spelling survived on none of
   the 9,258 rows. But the instrument class is weaker than its numbers read,
   and every removal count this audit has ever reported carries that blind
   spot. H3 owns the repair as instrument work in its gate spec: build the
   transformed-spelling judge as a reusable check, run it across the channel
   set for the planted-sentinel corpus, and report any row where a
   transformed spelling reaches a channel. A row where one does is a
   finding. A clean run upgrades every sentinel in the repository from
   argument to measurement.

**Forbidden re-reports:** RES-1 through RES-5 as findings, `showHidden: true`,
`console.dir` with `cause`, the accessor-pollution guard shape, the forged
brand on a value, the round-17 judge calibration (R17-H3-03 is fixed and its
fix is pinned), and the round-18 separation the orchestrator reversed —
re-proposing it without new evidence re-litigates a recorded decision.

### 6.4 Lane H4 — public surface, packaging, documents, release readiness

**Writes only:** `tests/surface/round19-h4-surface.spec.ts` and
`scripts/round19-h4-gate.spec.mjs`.

**Primary read scope:** `index.ts`, `src/errors/index.ts`,
`src/errors/helpers.ts`, `package.json`, `tsup.config.ts`, `dist/`,
`README.md`, `CHANGELOG.md`, `SECURITY.md`, `RELEASING.md`, `CONTEXT.md`,
`CONTRIBUTING.md`, `.github/workflows/**`, `scripts/gate-properties.spec.mjs`,
and `tests/surface/**`.

**Frontier items H4 owns.**

1. **Release readiness is still FALSE.** The state file records the exact
   gap: `package.json` is 2.0.1, the `[Unreleased]` block is uncut, and
   `validate-release` refuses every tag while the block is non-empty. Semver
   rule 8 forces at least 2.1.0, because the block declares `toJSON().url`
   moved and rule 8 forbids a patch for that. Round 18 closed R18-H4-01, 02
   and 03, so the roster, the ordinary-input sentence and the advisory step
   are believed fixed. H4 re-verifies each of the recorded remaining items
   against the current files, marks each one still-open or closed, and
   asserts the two that are assertable: the version floor rule and the
   uncut-block refusal.
2. **The three `docSentencesNeeded` entries.** The state file carries three
   owed sentences, all owner F4, all from H1: the ADR 0003 out-of-scope item
   3 sentence about phase 3's release on both arms; the `CONTEXT.md` and
   `src/request-plan.ts` sentence about a re-entering transport; and the Bun
   and Deno smoke assertion for the abort-window premise. For each entry,
   H4 checks whether the target document already carries the sentence. A
   carried sentence closes the entry, and H4 says so in its return. An owed
   sentence stays owed, and H4 writes the failing assertion that the target
   lacks it, so the entry cannot be forgotten silently. Round 18's H4-05
   lesson binds any test here: assert the sentence's CLAIM against `dist`,
   never only the sentence's presence, because this audit has produced four
   false sentences while correcting documents.
3. **The rule round 18 wrote in blood.** Every gate this audit adds must be
   tested by BREAKING what it guards, never by reading that it is mentioned.
   The R16-ORCH-01 shape has now appeared three times: the coverage include
   override (round 16), the exclusion-list pattern pin (round 17, R17-H4-02),
   and the threshold pin that read a brace and no number (round 18,
   R18-H4-04). H4 sweeps every pin the audit has added since round 16 —
   the exclusion pin, the include pin, the threshold pin, the gate-roster
   pin in `scripts/gate-properties.spec.mjs`, the workflow coverage steps,
   and the semver rule 8 assertions — and for each one demonstrates, in a
   copy or in memory and never by mutating the shared tree, that breaking
   the guarded thing turns the pin red. A pin that stays green under a
   broken guard is a finding.

**Forbidden re-reports:** the round-7 OPEN tsup `splitting` item, export
parity counts, tree-shaking of brands, node10 and node16 resolution, the
frozen-surface mechanism, and the reversed advisory-policy decision — the
maintainer restored the email channel deliberately, and step 9 opens the
draft now.

## 7. The proof rule

This rule is non-negotiable, and it is the whole difference between an audit
and an opinion.

**A hunter must not report a finding it has not proved with an executable test
that fails on the current tree for the reason claimed.**

- "Could be", "might", "seems racy", and every other speculation is discarded.
- A code-reading argument with no failing test is discarded. The ledger states
  the standing rule: if a failing test cannot be written, it is not a finding
  yet.
- A test that fails for a different reason than claimed — a typo, a wrong
  import, a missing fixture — is discarded until the hunter repairs it.
- A test that asserts current behavior and passes proves nothing. The test
  must assert the CORRECT behavior, and it must fail because the code is
  wrong.
- A cost finding states a bound and an input the caller does not control. A
  time ratio alone is not a finding, and `CONTRIBUTING.md` forbids it. State
  the remote input, state the growth, and prove the termination bound
  separately.

Every finding carries exactly six fields:

| Field            | Content                                                            |
| ---------------- | ------------------------------------------------------------------ |
| id               | `R19-<lane>-<nn>`, for example `R19-H2-01`.                        |
| title            | One line, ten words or fewer.                                      |
| lane + severity  | The hunt lane, and one value from the table in section 5.          |
| test             | The spec file and the exact test name.                             |
| observed output  | The failing assertion output, quoted verbatim, ten lines or fewer. |
| defect statement | One sentence: the trigger and the wrong outcome a caller observes. |

The defect statement follows the ledger's evidence bar. State the trigger as
the exact input or sequence, not as a shape. State the wrong outcome as what a
caller observes, not as what could go wrong.

Three worked examples of a report that is DISCARDED, and why. Each example is
an illustration of a shape, not a claim about the current tree.

1. **The argument without a test.** A hunter returns: "the round-18 anchor
   probably reads the wrong opening after two crossings, severity high", with
   a code walkthrough and no spec file. Discarded at adjudication, before any
   re-run, because field four is empty. The six-field check is mechanical: no
   test, no finding. The walkthrough may be right, and it is still not a
   finding until an input makes an assertion fail.
2. **The test that fails for the wrong reason.** A hunter's test imports a
   helper by a name the module does not export, so the run fails at load with
   a resolution error. The observed output is a module-not-found line, not
   the claimed wrong answer. Discarded until the hunter repairs the import
   and the failure becomes the claimed one. The orchestrator records the
   discard; the hunter may resubmit inside the same round.
3. **The test that pins the present.** A hunter's test asserts that a known
   pinned answer is emitted, runs it, sees green, and reports the behavior as
   a finding because the hunter believes the answer is wrong. Discarded on
   the adjudication re-run, because a claimed finding whose test passes is
   discarded on the spot. If the hunter believes a pinned answer is wrong, the
   report is an attack on the pin, and it must name the ledger entry and say
   why the recorded reasoning fails — and it still needs a failing test
   against the correct behavior.

## 8. The coverage HOLD obligation

The coverage-to-100 workstream of protocol section 8 closed in round 16 and
has held through rounds 17 and 18. Round 19 inherits an obligation to HOLD it,
not to raise anything. The baseline to hold: statements 2391/2391, branches
1135/1135, functions 433/433, lines 2139/2139, over `src/**`, `scripts/**`
and `fixtures/**`, with `scripts/smoke/bun.mjs` and `scripts/smoke/deno.ts`
the only two excluded paths.

The measurement command is the repository's own script, and nothing else:

```bash
pnpm coverage
```

Two rules govern any other measurement. First, no command-line
`--coverage.include` flag; R16-ORCH-01 was a CLI include that silently beat
the config file, and a pin now forbids the flag in the script. Second, two
agents must not run vitest with coverage at once; round 16 recorded that
concurrent runs clobber `coverage/.tmp`. An agent that must measure privately
uses `--coverage.reportsDirectory` outside the repository.

What each lane must check, every round until the loop stops:

- Every hunter's return carries a COVERAGE row stating that its new spec
  files leave the totals at 100, or naming the exact uncovered line its work
  exposed.
- Every fixer that adds a branch, a function or a statement adds the test
  that reaches it IN THE SAME COMMIT. A fix commit that lowers any of the
  four axes is not landable, because the threshold gate fails at VERIFY and
  the round cannot close.
- The verifier evaluates the five acceptance items below after
  `pnpm coverage` and reports `coverageAccepted`.

The five acceptance items, adapted from protocol section 8.6 to the held
state:

1. `pnpm coverage` prints 100 / 100 / 100 / 100, and its include names
   `src/**`, `scripts/**` and `fixtures/**`.
2. `vitest.config.ts` carries the four thresholds at 100 — read BY VALUE, not
   by the presence of a `thresholds` block, which is R18-H4-04's rule — and
   the exclude list holds exactly the two cross-runtime smokes, each with a
   written reason.
3. The pin tests assert item 2's lists by extracting the arrays and reading
   every string and every number, and they fail when a path is added anywhere
   or a digit moves.
4. Every `v8 ignore` range in the repository carries a written justification
   that states the exact condition that makes the line unreachable. The
   verifier reads each one; round 5 found a false justification, and round 16
   found an adjacent live guard next to a dead one.
5. No coverage or gate spec asserts nothing: no bare import, no
   `expect(true).toBe(true)`, no test body without an `expect`.

A hold that fails is handled as a finding against the commit that broke it,
owned by the fixer whose lane owns the file, and the round is not clean.

## 9. The write-collision protocol

The disjointness contract, stated once: hunters write spec files, fixers write
source files, nobody writes both. Two agents that must touch one file is a
scheduling fault, not a merge problem. The orchestrator resolves it by
ownership, never by letting both write and reconciling afterwards.

### 9.1 Hunt-phase ownership, round 19

| Lane | Owned proof spec (NEW)                          | Owned gate spec (NEW)              |
| ---- | ----------------------------------------------- | ---------------------------------- |
| H1   | `tests/request/round19-h1-request.spec.ts`      | `scripts/round19-h1-gate.spec.mjs` |
| H2   | `tests/response/round19-h2-response.spec.ts`    | `scripts/round19-h2-gate.spec.mjs` |
| H3   | `tests/redaction/round19-h3-disclosure.spec.ts` | `scripts/round19-h3-gate.spec.mjs` |
| H4   | `tests/surface/round19-h4-surface.spec.ts`      | `scripts/round19-h4-gate.spec.mjs` |

Rules that bind every hunter:

- Write ONLY your two owned files. Never edit `src/**`, an existing spec,
  `vitest.config.ts`, or any document.
- A hunter that wants a fixture builds it inline in its own file, because
  `fixtures/**` is F4's source lane.
- A spec under `scripts/` is `.mjs`; `tsconfig.test.json` globs `tests/`
  only, so a TypeScript spec must live under `tests/`. `CONTRIBUTING.md`
  states the rule and the reason.
- Before writing a test, grep the existing suites; the tree holds 3224 tests
  across 83 files, and a duplicate is noise.
- Run both of your files, then `pnpm test` once, before you return, and
  report both exit codes.

### 9.2 Fix-phase ownership

The fix lanes own fixed, disjoint sets of source files. The table is the
protocol's section 11 table, unchanged for round 19.

| Lane | Owned files. Writes are allowed here and nowhere else.                                                                                                                                                                                                                                              |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1   | `src/index.ts`, `src/request-plan.ts`, `src/request-failure.ts`, `src/headers.ts`, `src/methods.ts`, `scripts/check-consumer.mjs`, `scripts/check-deno-consumer.mjs`                                                                                                                                |
| F2   | `src/response-verdict.ts`, `src/errors/base-http-error.ts`, `src/errors/error-body.ts`, `src/errors/response-identity.ts`, `src/errors/known-http-error.ts`, `src/errors/unknown-http-error.ts`, `src/http-status-codes.ts`, `scripts/check-docs.mjs`, `scripts/check-doc-style.mjs`                |
| F3   | `src/errors/redact-url.ts`, `src/errors/userinfo-spans.ts`, `src/errors/brand.ts`, `src/errors/untrusted-read.ts`, `src/errors/inspect.ts`, `src/errors/helpers.ts`, the 40 status-class files `src/errors/*-error.ts`, `scripts/verify-pack.mjs`, `scripts/validate-release.mjs`, `scripts/lib/**` |
| F4   | `index.ts`, `src/errors/index.ts`, `package.json`, `tsup.config.ts`, `vitest.config.ts`, `tsconfig*.json`, `fixtures/**`, `scripts/smoke/**`, `docs/**`, `README.md`, `CHANGELOG.md`, `SECURITY.md`, `RELEASING.md`, `CONTEXT.md`, `CONTRIBUTING.md`, `tests/**/__snapshots__/**`                   |

Standing consequences and amendments:

- **The arbitration rule.** A finding is owned by the lane that owns the file
  where the defect statement locates the wrong code. When a fix spans two
  lanes, the orchestrator names ONE owner — the lane holding the substantive
  change — and BLOCKS the other for that finding. The orchestrator either
  widens the owner's grant for that one finding, naming the extra file in the
  prompt, or serializes the work. Two agents writing one file is never the
  answer.
- **Fixers must not edit any round-numbered spec file.** The failing test is
  the contract. A fixer that believes the test is wrong stops, reports
  `test disputed` with evidence, and touches nothing. The orchestrator
  adjudicates. Rounds 15, 16 and 17 each upheld a fixer's dispute, so this
  path is real and it works.
- **The round-17 amendment stands:** a fixer may extend the gate spec its own
  hunt lane wrote, once that hunter has returned, when a newly exported entry
  point needs a test the hunter could not write before the export existed.
- **Defects in spec files belong to the orchestrator**, because no fixer may
  edit a spec. Rounds 17 and 18 both routed instrument defects this way.
- **Document edits demanded by any finding belong to F4 alone.** F1, F2 and
  F3 report the needed sentence in DOC SENTENCES NEEDED and edit no document.
- **A hostile-`fetch` fix is an ADR 0003 amendment plus a scenario in ONE
  commit.** F4 owns the ADR text, the source lane owns the guard, and the
  orchestrator sequences the source lane first.
- **Only F4 may regenerate snapshots**, only with `pnpm build && pnpm test
-u`, and only for a deliberate surface change a confirmed finding demands.
- Every writing agent runs `pnpm test` before it returns and reports the exit
  status. A hunter may return red only when the failures are exactly its own
  claimed finding tests. A fixer must not return red at all.

## 10. The docs grill

A short verification step against primary documentation, scoped to platform
claims only. The instruments are `/grill-with-docs` and the Context7
documentation tool; the grill agent uses Context7 first and the specification
text second.

**Required when** a finding's defect statement says the platform does X. That
covers any claim about `fetch`, `Request`, `Response`, `Headers`,
`AbortSignal`, `ReadableStream`, the WHATWG Fetch, URL or Streams standards,
WebIDL, Node's undici, or the npm pack manifest format.

**Skipped when** the finding is pure library logic: a guard answers wrong, a
channel leaks a planted sentinel, a lifecycle sequence refuses incorrectly, a
type fails to narrow, a document disagrees with `dist`, or a gate script's own
decision is wrong. The failing test decides those, and no external authority
does. Rounds 16 through 18 skipped the grill for every finding, and the state
file records the reason each time: every finding was the library's own
algorithm, a document against `dist`, or the repository's own gate wiring.

**Action.** The orchestrator launches one grill subagent with the section 18.10
brief, naming the claim and the finding id. The agent returns one verdict of
`SUPPORTED`, `CONTRADICTED`, `UNDECIDED` or `SETTLED`, with one citation, and
executes the claim in a scratch file when it can — a measurement beats a
citation.

**Result.** A `CONTRADICTED` claim demotes the finding: the test asserted the
wrong correct behavior, so the orchestrator discards it and records why. An
`UNDECIDED` claim caps the finding at medium severity until a later round
settles it. A `SETTLED` verdict names the ledger entry that already verified
the claim; the ledger holds 22 verified spec claims, and re-checking one is
wasted work.

**Budget.** One grill per finding, and at most four per round. A round that
wants more is reporting that its hunters argued from the platform instead of
measuring it.

## 11. The verification gate

One verifier agent runs the complete gate list after every fix phase, and also
after a hunt phase that confirms nothing. The list is literal and ordered.
The order matters because `pnpm test`, `pnpm check-docs`, `pnpm verify-pack`,
`pnpm check-consumer` and the smokes read `dist/`, so `pnpm build` runs before
them.

```bash
pnpm lint
pnpm format:check
pnpm check-doc-style
pnpm typecheck
pnpm build
pnpm test
pnpm coverage
pnpm check-docs
pnpm verify-pack
pnpm check-consumer
pnpm check-deno-consumer
pnpm smoke:node-min
pnpm smoke:deno
pnpm audit:prod
pnpm run audit:ci
```

What each command guards, from `CONTRIBUTING.md`:

| Command                    | Guards                                                                                          |
| -------------------------- | ----------------------------------------------------------------------------------------------- |
| `pnpm lint`                | oxlint over source and specs                                                                    |
| `pnpm format:check`        | oxfmt formatting, check only                                                                    |
| `pnpm check-doc-style`     | document links, vocabulary, the Terms table, and the Node floor; needs no build                 |
| `pnpm typecheck`           | `tsc --noEmit` over `tsconfig.test.json`; it does not cover `scripts/`                          |
| `pnpm build`               | tsup builds `dist/`; the package actually builds                                                |
| `pnpm test`                | the whole vitest suite, including the frozen-surface checks against the built `dist/`           |
| `pnpm coverage`            | 100 percent on all four axes over `src/`, `scripts/` and `fixtures/`; the threshold is enforced |
| `pnpm check-docs`          | every fenced TS block in the documents typechecks against `dist/`                               |
| `pnpm verify-pack`         | the published tarball's file manifest, by allowlist and exact counts                            |
| `pnpm check-consumer`      | pack and install the tarball, exercise it as a real consumer                                    |
| `pnpm check-deno-consumer` | the packed artifact under Deno                                                                  |
| `pnpm smoke:node-min`      | the declared engines floor against the built `dist/`                                            |
| `pnpm smoke:deno`          | the built package under Deno's own runtime                                                      |
| `pnpm audit:prod`          | no known runtime-dependency vulnerability; the package has zero runtime dependencies            |
| `pnpm run audit:ci`        | no known vulnerability anywhere in the toolchain                                                |

Rules:

- Any nonzero exit means the round is NOT closable. The verifier reports the
  first red command and its last ten output lines verbatim, and stops.
- **The self-heal rule.** If `pnpm format:check` fails, the verifier runs
  `pnpm format` once, then restarts the list from the top, and reports that
  it did so. This is the one edit the verifier may make.
- **The Deno-absent skip rule.** `pnpm check-deno-consumer` and
  `pnpm smoke:deno` require Deno 2 on the machine. When Deno 2 is absent, the
  verifier reports `SKIPPED (no deno 2)` for those two rows. CI runs them
  regardless, so the round may close with the skip recorded in the round
  summary.
- `pnpm smoke:node-min` runs against the built `dist`. When a Node 20.13.0
  binary is available through asdf or an equivalent, the verifier uses it and
  records the version string. Otherwise it records
  `PASS (host node <version>, floor not exercised)`.
- After `pnpm coverage`, the verifier evaluates the five hold items of
  section 8 and reports `coverageAccepted` as true or false with the failing
  item number.
- The verifier reads the number a gate PRINTS, never only the code it exits
  with. R16-ORCH-01 was found by a printed total of 1100 statements where
  2345 were expected, under an exit code that said pass.
- The verifier edits nothing else. A red gate goes back to the owning fixer
  through the orchestrator.

## 12. The stop condition

The loop stops in exactly two ways, and no other way. Either two consecutive
clean rounds occur, or the round counter reaches the cap. Nothing else stops
it: not a quiet lane, not a maintainer's mood, not a long round.

**The clean-streak mechanics, at every CLOSE:**

1. Evaluate the four clean-round conditions of section 4: zero confirmed
   findings in all four lanes, the coverage hold, a green
   build-test-coverage on the unchanged tree, and no fail row from the gate.
2. Clean: `cleanStreak += 1`. Not clean: `cleanStreak = 0`. Any single
   confirmed finding resets the streak, whatever its severity.
3. `cleanStreak >= 2`: set `phase` to `done`, set `stoppedAt` to the current
   ISO timestamp, set `stopReason` to `two consecutive clean rounds`, write
   the file, append the final ledger note, and terminate the loop. Do not
   schedule another wake.
4. Otherwise: increment `round`, reset `phase` to `hunt`, reset the `lanes`
   and `gate` maps to `pending`, keep the findings history, append one
   `history` entry, write the file, and yield until the next wake.

A clean verdict from a lane that did not state its corpus does not count
toward `cleanStreak` until the corpus statement arrives. That is anti-pattern
10, and the orchestrator enforces it at CLOSE.

**The cap, and what a cap means.** When `round` reaches 30 without two
consecutive clean rounds, the loop stops with `stopReason` set to
`round cap, no convergence`. Round 15 stopped at a cap with `cleanStreak` at
zero, and that cap is the reason the audit has no convergence record from its
first eight rounds. A stop at the cap is a report about the audit, not about
the code, and it demands a human read. The orchestrator writes that sentence
into the final ledger note, so the next reader cannot mistake a cap for a
clean finish.

At round 19 start, `cleanStreak` is 0 and eleven rounds have passed without
two clean rounds in a row. The earliest possible stop by convergence is the
CLOSE of round 20, and only if rounds 19 and 20 are both clean.

## 13. Loop mechanics and the state file

The whole protocol runs under `/loop` with dynamic, self-paced scheduling. The
loop wakes, reads the state file, performs the next phase — or one whole round
when the phases are fast — writes the state file, and yields.

### 13.1 The state file

Path: `.audit-state.json` at the repository root. It is never committed; it is
listed in `.git/info/exclude`. The core schema is the protocol's section 13.1
schema. The round 19 shape of the core fields:

```json
{
  "protocol": "audit-round-16-protocol",
  "round": 19,
  "phase": "hunt",
  "startedAt": "<ISO timestamp>",
  "branch": "chore/audit-round-16",
  "cleanStreak": 0,
  "coverageAccepted": true,
  "coverage": { "srcHeld": true, "...": "held sub-lane records from round 16" },
  "lanes": {
    "H1": { "status": "pending", "verdict": "", "findings": 0, "frontier": [] },
    "H2": { "status": "pending", "verdict": "", "findings": 0, "frontier": [] },
    "H3": { "status": "pending", "verdict": "", "findings": 0, "frontier": [] },
    "H4": { "status": "pending", "verdict": "", "findings": 0, "frontier": [] }
  },
  "findings": [],
  "gate": { "lint": "pending", "...": "one row per section 11 command" },
  "history": [],
  "notes": [],
  "stoppedAt": null,
  "stopReason": null
}
```

Field semantics:

- `phase` is one of `hunt`, `adjudicate`, `fix`, `verify`, `close`, `done`.
- `lanes.*.status` is `pending`, `running`, or `returned`. A `returned` lane
  is never re-launched inside the same round.
- `lanes.*.frontier` holds one entry per owned frontier item, each with the
  item text and a verdict of `finding`, `closed-by-measurement`, or
  `closed-in-writing`.
- `findings[].status` is `claimed`, `confirmed`, `discarded`,
  `adjudicated-not-a-defect`, or `fixed`.
- `findings[].grill` is `required`, `done-supported`, `done-contradicted`, or
  `skipped`.
- `gate.*` is `pending`, `pass`, `fail`, or `skipped`.
- `cleanStreak` counts CONSECUTIVE clean rounds under the section 4
  definition.
- `notes` holds one line per lesson the round learned. Rounds 8 through 18
  produced dozens, and they are the highest-value output of this audit after
  the fixes.

Beyond the core schema, the file carries the audit's accumulated records, and
round 19 reads them as inputs: `residuals` (RES-6's full record),
`docSentencesNeeded` (the three owed sentences of section 6.4),
`round18Frontier`, `convergenceAnalysis` (quoted in section 3),
`decidedOpenQuestions` (the phase 3 precondition of section 6.1),
`protocolCorrections`, `ledgerCorrections`, and the per-round findings
archives. Round 19 appends; it never deletes an accumulated record.

### 13.2 Resume behavior

On every wake, the loop:

1. Reads `.audit-state.json`. When the file is absent, unparsable, or names
   another protocol, it archives the old file and re-initializes — but at
   round 19 the file exists and is current, so this arm should not fire.
2. When `phase` is `hunt` with lanes still `pending` or `running`, it launches
   or awaits only those lanes. Returned lanes keep their verdicts.
3. When `phase` is `adjudicate`, `fix`, `verify`, or `close`, it continues at
   exactly that phase using the recorded findings and gate rows.
4. When `phase` is `done`, it confirms the stop and performs no work.

A wake that finds a phase in progress and no agent running treats the phase as
interrupted, resets the `running` lanes to `pending`, and relaunches them. A
partially written spec file from an interrupted lane is deleted first, and the
deletion is recorded in `notes`.

### 13.3 Pacing

The loop is self-paced. A hunt phase with four parallel subagents takes tens
of minutes, so the orchestrator schedules the next wake at 1200 seconds or
more and relies on the task notification for the real signal. It never polls
at a short interval for work the harness already reports.

## 14. Return contracts

Everything runs inside subagents. The main thread holds the state machine and
nothing else. Its inputs per round are exactly: the round number, one verdict
line per lane, the findings table, the frontier rows, the coverage rows, and
the gate results.

Forbidden in any agent return, with no exception:

- Pasted file contents, of any file, of any length.
- Diffs longer than 20 lines. Name the file and the hunk instead.
- Full command output. Quote at most 10 verbatim lines per finding — the
  failing assertion — and one exit status per command.
- Restating the prompt, narrating the exploration, or listing files read.

An agent that returns outside its contract is re-asked once with the contract
quoted. A second violation discards the return, and the orchestrator
relaunches the lane fresh.

**The hunter contract, in full:**

```text
ROUND: 19
LANE: H1
VERDICT: <one line: "clean" or "N findings, worst severity S">
COVERAGE: <totals still 100/100/100/100 with my files in the run: yes|no; if no, the exact uncovered line>
FRONTIER:
| item | verdict | one-line reason |
| ---- | ------- | --------------- |
SUITE: pnpm test exit <0|1>; failures are exactly my claimed findings: <yes|no>

| id | title | severity | spec file | test name | defect statement |
| -- | ----- | -------- | --------- | --------- | ---------------- |

OBSERVED (per finding, max 10 lines each, verbatim):
R19-H1-01:
<failing assertion output>

NOTES: <at most three lines. A lesson for the ledger, or "none".>
```

**The fixer contract, in full:**

```text
ROUND: 19
LANE: F1
FINDINGS FIXED: <ids>
FINDINGS DISPUTED: <ids, or none>
BLOCKED: <ids owned elsewhere that touched my files, or none>
FILES EDITED: <paths only>
INTERNAL EXPORTS ADDED: <symbol and file, or none>
DOC SENTENCES NEEDED: <one line per needed doc change, or none>
CHECKS: lint <0|1> typecheck <0|1> build <0|1> test <0|1>
NOTES: <at most three lines, or "none">
```

**The verifier contract, in full:**

```text
ROUND: 19
GATES:
| command | pass | fail | skipped |   (one row per command, in order)
COVERAGE ACCEPTANCE:
| item | hold | fail |            (five rows)
coverageAccepted: <true|false>
FIRST FAILURE: <command, then at most 10 verbatim output lines, or "none">
```

**The grill contract, in full:**

```text
FINDING: <id>
VERDICT: <SUPPORTED | CONTRADICTED | UNDECIDED | SETTLED>
CITATION: <one source, with the section or heading>
QUOTE: <at most three lines from the source>
MEASURED: <what you executed and what it did, or "not executed">
CONSEQUENCE: <one sentence: what this does to the finding>
```

## 15. Ledger and git

### 15.1 Ledger append

At CLOSE of a round with confirmed findings, F4 appends one section to
`docs/audit-ledger.md`, following the shape of "What round 18 settled": one
opening paragraph naming the lanes, then one bullet per settled finding with
the trigger, the wrong outcome, what changed, and what the test pins now, with
the finding id in parentheses. An adjudicated non-defect goes to "Adjudicated
closed" with the reasoning and the cost. A clean round appends one line —
"Round 19 was clean: four lanes, zero confirmed findings, coverage acceptance
held" — and that append belongs to the orchestrator, because a clean round
launches no fixer.

At the final CLOSE of the whole audit, the orchestrator appends the name map
for every round-numbered spec file to "The audit files, renamed by subject",
and renames each file to its subject name. The round-numbered names exist for
write disjointness during the round, and they carry no meaning after it.

### 15.2 Git

- **Branch.** Never commit to `main`. The audit's branch is
  `chore/audit-round-16`, and round 19 continues on it.
- **One commit per finding-fix.** Each commit carries the finding's failing
  test AND its fix together, so every commit leaves the tree green. The
  ledger append lands as its own `docs:` commit.
- **Message convention.** Conventional Commits, English, Simplified Technical
  English: one idea per sentence, active voice, present tense, imperative
  mood, sentences under 20 words. No `Co-Authored-By` line, ever. Template:

  ```text
  fix: <what the change makes correct, imperative, under 20 words>

  - Round 19, finding R19-H2-01, lane H2.
  - The test <spec file> :: "<test name>" fails before this change.
  - <One sentence: the trigger and the wrong outcome it removes.>
  ```

  Types by content: `fix:` for a defect, `test:` for pinning tests with no
  source change, `docs:` for the ledger and document edits, `chore:` for
  config landing alone, and `refactor:` never.

- **Never committed:** `.audit-state.json`, any archived state file, the
  `coverage/` output, any scratch file, a hand-edited `.snap` file, a
  `KNOWN_FAILING` addition, a `round19-*` spec file that still holds a
  failing test, and agent prompts or return tables.
- **Never pushed** without an explicit maintainer instruction. The round
  closes locally. Pushing and opening the pull request is the maintainer's
  act.

## 16. The sixteen anti-patterns

Each entry names the failure, how the orchestrator detects it, and the
remedy. The verifier and the orchestrator check for all sixteen at every
CLOSE. The first ten are the protocol's section 16. Rounds 16 through 18
added the last six, each from a defect the audit found in its own work.

1. **A test that asserts current behavior instead of correct behavior.** It
   passes, proves nothing, and fossilizes a defect. Detection: the
   adjudication re-run discards any claimed finding whose test passes.
   Remedy: state the correct behavior first, then write the assertion.
2. **A coverage test that only touches lines.** It reaches code and asserts
   nothing, so a wrong answer stays green. Detection: read the test for a
   bare import, an `expect(true).toBe(true)`, or a body with no `expect`.
   Remedy: assert the documented outcome set.
3. **A finding with no failing test.** Speculation with a severity label.
   Detection: the six-field check. Remedy: none; it is discarded, not
   deferred.
4. **Two agents editing one file.** The second write drops the first in
   silence. Detection: `git status` between phases, and disjoint FILES
   EDITED rows. Remedy: the ownership tables and the arbitration rule; roll
   back both edits and re-run with one owner.
5. **Fixing by weakening a test.** Deleting an assertion, widening a
   tolerance, regenerating a snapshot to match broken output, or parking an
   id in `KNOWN_FAILING`. Detection: any fixer diff that touches a spec, a
   `__snapshots__` directory, or the `KNOWN_FAILING` set. Remedy: revert,
   re-assign, record the attempt.
6. **Hiding a gap with `v8 ignore` and no justification.** Round 5 proved a
   written justification can be false; an unwritten one is worse. Detection:
   the verifier reads the comment beside every new ignore. Remedy: the
   protocol's decision order for a gap.
7. **Growing the exclusion list.** A third excluded file turns the threshold
   into decoration. Detection: the exclusion pin. Remedy: the file comes
   under test, or the round records why the list must change.
8. **Scope creep into refactors.** Every extra edit widens the next round's
   surface. Detection: the diff exceeds the defect statement. Remedy: revert
   to the smallest change; move the improvement into the return table as a
   proposal.
9. **Re-litigating the ledger.** A lane that re-proves a settled entry
   returns noise. Detection: the orchestrator matches each finding against
   the settled tables before adjudication. Remedy: discard, and cite the
   entry so the next round's brief names it.
10. **A clean lane with no stated corpus.** Reporting clean without naming
    what was drawn, and what could not be drawn, reports the lane's own
    silence. Detection: the FRONTIER rows and NOTES. Remedy: the lane is
    re-asked once, and its clean verdict does not count toward `cleanStreak`
    until the corpus statement arrives.
11. **A pin that reads text instead of breaking what it guards.** Round 16's
    coverage script override, round 17's exclusion-pattern pin, and round
    18's threshold pin are one shape three times: a check whose assertion
    reads something other than what it guards. Detection: for every pin the
    round adds, demonstrate that breaking the guarded thing turns the pin
    red, in a copy or in memory. Remedy: rewrite the pin to extract and read
    the guarded values themselves.
12. **A fix verified against the suite but not against the previous fix.**
    Round 16's crossing and round 17's suppression were each correct alone
    and wrong together; 111 of 131 answer differences were the interaction.
    Detection: a differential grid that crosses the new fix's trigger shapes
    with every earlier fix's trigger shapes. Remedy: the fixer runs the
    pairwise grid before returning, and H2's frontier item 4 audits it.
13. **An instrument that counts only what the last defect used.** Round 18's
    14-million-character walk was invisible to both the rebuild counter and
    the probe counter, because it spent its cost in neither. Detection: when
    a cost instrument reports flat, measure wall time and characters walked
    once as a cross-check. Remedy: instrument the resource the module
    consumes, not the mechanism the last defect used.
14. **A raw-substring judge reporting a re-spelled secret as removed.** Round
    18 found 9,258 rows where the secret is absent verbatim and present in
    the spelling the URL parser writes. Every `leakingChannels` sentinel is a
    raw-substring judge. Detection: run the transformed-spelling judge H3
    builds this round beside every raw-substring count. Remedy: a removal
    count states which spellings its judge can see.
15. **A document sentence corrected into a fourth false configuration.**
    Rounds 13, 14, 16 and 18 each produced a false sentence WHILE correcting
    a document; R18-H4-05 is the fourth. Detection: every corrected sentence
    is asserted against `dist` in the configuration it quantifies over,
    including inherited values and both branch selections. Remedy: a claim
    quantified over "any X" is measured over the whole set of X, or it names
    its scope.
16. **A gate roster that no gate reads.** Round 17 updated three rosters and
    left `RELEASING.md`'s two a gate short, and the pin read three of the
    repository's four rosters — the unread one being the release procedure.
    Detection: `scripts/gate-properties.spec.mjs` reads all four rosters
    now, and H4 verifies that property by breaking it. Remedy: every roster
    a maintainer can follow is read by a test that compares it with the
    others.

## 17. The round timeline

What fires, in what order, with the expected wall-clock. The durations are
expectations from the pacing rule and from rounds 16 through 18; they are not
promises. The loop is self-paced and relies on task notifications, never on
polling.

| Step | What fires                                                       | Actor        | Expected wall-clock       |
| ---- | ---------------------------------------------------------------- | ------------ | ------------------------- |
| 1    | State read, precondition check: clean tree, branch, green suite  | orchestrator | minutes                   |
| 2    | HUNT: four hunter subagents launched in one message              | H1–H4        | tens of minutes, parallel |
| 3    | Collect: four returns written into the state file                | orchestrator | minutes                   |
| 4    | ADJUDICATE: each claimed test re-run on an idle tree             | orchestrator | minutes per finding       |
| 5    | Docs grill, only for platform claims, at most four               | grill agent  | minutes per claim         |
| 6    | Fix-lane assignment, collision resolution, blocked-lane records  | orchestrator | minutes                   |
| 7    | FIX: only the lanes with assignments, launched in one message    | F1–F4        | tens of minutes, parallel |
| 8    | Sequenced second wave, when a fix depends on another lane's land | one fixer    | tens of minutes           |
| 9    | VERIFY: the 15 commands of section 11, in order, on a quiet tree | verifier     | tens of minutes           |
| 10   | CLOSE: commits, ledger append, state file, stop evaluation       | orchestrator | minutes                   |
| 11   | Next wake scheduled at 1200 seconds or more, or the loop stops   | orchestrator | immediate                 |

Notes on the timeline:

- Steps 5 and 8 fire only when their condition holds. A clean hunt skips
  steps 6 through 8 and goes from step 4 to step 9.
- Step 4 waits for ALL four lanes; a loaded tree produces false timeouts.
- Step 9 runs on a quiet tree with no other agent alive; round 16 recorded
  dist-contention timeouts during a concurrent rebuild.
- The whole round is expected to take a small number of hours. No phase has a
  deadline; a phase has only an owner and an exit condition.

## 18. Appendix — the round 19 briefs

Paste each brief verbatim into a fresh subagent. Replace nothing. The briefs
are complete and self-contained.

### 18.1 — Hunter H1: request path and cross-call custody

```text
You are hunter H1 in round 19 of a bug and security audit of
@pbpeterson/typed-fetch, a zero-dependency typed fetch wrapper that returns
errors as values. Repository root: the current working directory.

YOUR ONE OUTPUT is a set of NEW tests that FAIL on the current tree for a
stated reason. You write exactly two files:
  tests/request/round19-h1-request.spec.ts   (defect proofs)
  scripts/round19-h1-gate.spec.mjs           (gate and instrument work)
You edit NOTHING else. Not src/, not an existing spec, not vitest.config.ts,
not a document. If a fix is needed, you describe it; a fixer performs it.

READ FIRST, in this order:
  docs/audit-round-19-flow.md       sections 2, 6.1, 7, 8, 9, 14
  docs/audit-ledger.md              "What round 18 settled" and
                                    "Adjudicated clean - the request path"
  CONTEXT.md                        the vocabulary
  docs/adr/0003-the-untrusted-fetch-conformance-boundary.md
  src/request-plan.ts               in full, including its comments

THE STATE, GIVEN. The tree is green: 3224 tests pass, coverage is 100 on all
four axes. Do not re-measure; your job is to break it.

THE PROOF RULE. A finding without an executable failing test is not a
finding. A test that passes proves nothing. A test must assert the CORRECT
behavior and fail because the code is wrong. Speculation is discarded.

SETTLED. Do not re-report: the header-container collector, the
options-snapshot proxy invariants, the empty init dictionary, signal and
abort and timeout interleaving, body custody on refusal paths, the 22 spec
claims in src/, the signal-read history of rounds 9 through 11, and any new
hostile-fetch guard with no ADR 0003 row.

FRONTIER ITEMS YOU OWN. Return one row per item with a verdict of finding,
closed-by-measurement, or closed-in-writing.
  1. The snapshotRequestInit branch round 18 rewrote for R18-H1-01. It now
     turns on whether the init owes a spread an entry the target does not
     own. Enumerate what an init can owe a spread — an inherited signal, an
     inherited signal beside an own one, a per-read getter, a symbol key, a
     frozen caller object — and assert BOTH branches for each shape. The pin
     that missed R18-H1-01 selected the working branch one line before it
     asserted. Do not repeat that shape.
  2. The re-entering transport. The init a transport receives carries no own
     fetch, so a re-entering call runs on the ambient transport. Prove the
     re-entry answer did not move when round 18 moved the branch predicate.
     Report whether the owed document sentence for this is now carried.
  3. The phase 3 precondition. The state file records the decision: no
     genuine platform Response reaches a phase 3 refusal, so ADR 0003
     out-of-scope item 3 is the precondition for the WHOLE refusal path.
     Pin it executably: drive every refusal point of phase 3 and assert each
     one needs a value that answers a structural read differently on a
     second presentation.
  4. The abort-window premise on Bun, Deno and workerd is unmeasured, and
     you cannot run those runtimes here. Restate, one sentence per runtime,
     the exact assertion a runtime smoke must carry, and reconcile it with
     the docSentencesNeeded entry the state file already holds.

COVERAGE HOLD. Your two files must leave pnpm coverage at 100 on all four
axes. Report the hold in your COVERAGE row. Do not run coverage while
another agent is running it; use --coverage.reportsDirectory outside the
repository if you must measure privately.

BEFORE YOU RETURN: run
`pnpm test tests/request/round19-h1-request.spec.ts scripts/round19-h1-gate.spec.mjs`,
then run `pnpm test` once. Report both exit codes.

RETURN CONTRACT: the exact hunter shape in section 14 of
docs/audit-round-19-flow.md, with ROUND: 19 and LANE: H1. No file contents,
no diffs over 20 lines, no narration.
```

### 18.2 — Hunter H2: response phase, redactor cost, the interaction surface

```text
You are hunter H2 in round 19 of a bug and security audit of
@pbpeterson/typed-fetch. Repository root: the current working directory.

YOUR ONE OUTPUT is a set of NEW tests that FAIL on the current tree for a
stated reason. You write exactly two files:
  tests/response/round19-h2-response.spec.ts   (defect proofs)
  scripts/round19-h2-gate.spec.mjs             (gate and instrument work)
You edit NOTHING else.

READ FIRST: docs/audit-round-19-flow.md sections 2, 6.2, 7, 8, 9, 14;
docs/audit-ledger.md "What round 16 settled" through "What round 18
settled"; src/errors/redact-url.ts and src/errors/userinfo-spans.ts in
full; the round-18 spec files; CONTEXT.md.

THE PROOF RULE. A finding without an executable failing test is not a
finding. A cost finding states the remote input, the growth, and a separate
termination bound. A time ratio alone is not a finding; CONTRIBUTING.md
forbids it.

SETTLED. Do not re-report: claimable() internals, the loan mechanics, the
four clone-and-loan residuals, the base64 under-redaction, the host1 case,
the path-segment secret, file: keeping its path, the relative branch's
caller-owned quadratic, and RES-6 and RES-7 as verdicts — H3 owns their
pins.

FRONTIER ITEMS YOU OWN.
  1. THE ANCHOR. Round 18 moved the suppression's question to where the
     region OPENS: condition 2 reads a colon with text in front of it that
     precedes the authority's last @. It is the newest rule in the module's
     most defect-dense file. Find the input where the opening the anchor
     reads is not the opening the rebuild produces. Rounds 13 through 18
     each found a defect in exactly that gap for the previous round's rule.
  2. THE CLIP. R18-H2-02's fix clips the backward search to the authority
     slice. Verify it on shapes it was not measured on: nested regions, a
     slice the anchor moves, and the clip under the round-16 crossing. A
     cost moved to another walk is not a cost closed.
  3. THE ALPHA SCHEME TEST. R18-H2-03 replaced a one-character read with a
     scheme test. Enumerate the boundary spellings — one letter, digits
     after the first letter, +, - and . inside the scheme, uppercase — and
     assert the module and new URL agree on every one.
  4. THE PAIRWISE INTERACTION, your largest item. The fixes in play: the
     round-16 crossing, the round-17 popsBefore floors, the round-17
     suppression, the round-17 needle-route closures, the round-18 anchor,
     the round-18 clip, the round-18 scheme test. Round 18 proved one pair
     wrong with 111 of 131 answer differences belonging to the interaction.
     Build a grid that crosses every fix's trigger shape with every other
     fix's trigger shape. Judge it with the fixed-point property, the
     subsequence property, the no-moved-origin property, and the calibrated
     over-redaction judge. State the grid's size and generator in your
     return, and commit the generator inside your spec: round 17 recorded
     that an uncommitted verification population cannot be cited later.

INSTRUMENT RULES, learned at cost: separate rebuild counts from probe
counts; a flat counter does not prove a flat cost, so cross-check with
characters walked (R18-H2-02 was invisible to both existing counters). A
bound you pin must be the property's number, not the defective tree's
number; round 16's orchestrator rewrote three tests for that mistake.

COVERAGE HOLD: as in the H1 brief, verbatim.

BEFORE YOU RETURN: run your two files, then `pnpm test` once. Report both
exit codes.

RETURN CONTRACT: the exact hunter shape in section 14, with ROUND: 19 and
LANE: H2.
```

### 18.3 — Hunter H3: disclosure, the generators, the judges

```text
You are hunter H3 in round 19 of a bug and security audit of
@pbpeterson/typed-fetch. Repository root: the current working directory.

YOUR ONE OUTPUT is a set of NEW tests that FAIL on the current tree for a
stated reason. You write exactly two files:
  tests/redaction/round19-h3-disclosure.spec.ts   (defect proofs)
  scripts/round19-h3-gate.spec.mjs                (instrument work)
You edit NOTHING else.

READ FIRST: docs/audit-round-19-flow.md sections 2, 6.3, 7, 8, 9, 14;
docs/audit-ledger.md "Disclosure" and "What round 18 settled"; SECURITY.md
the residual list; fixtures/channels.ts;
tests/redaction/disclosure-channels.spec.ts; the round-16 through round-18
disclosure specs; src/errors/redact-url.ts.

THE PROOF RULE. A finding without an executable failing test is not a
finding. A disclosure decision applies to the CHANNEL SET, never to one
channel. Every sentinel test runs across every channel in
fixtures/channels.ts.

SETTLED. Do not re-report: RES-1 through RES-5, showHidden: true,
console.dir with cause, the accessor-pollution guard shape, a forged brand
on the value, the fixed round-17 judge calibration, and the round-18
separation the orchestrator reversed — re-proposing it without new evidence
re-litigates a recorded decision.

FRONTIER ITEMS YOU OWN.
  1. RES-6. The residual is pinned in both directions: the corpus
     over-redacts a fixed row count and the documented example emits exactly
     its recorded answer. Your job is the pins' edges: assert the round-18
     anchor and clip moved NEITHER direction, and report any input where the
     recorded extent widened. Round 17 proved the conflict undecidable in
     the module's shape; do not re-argue it, measure its boundary.
  2. RES-7. The bare-// gap: 504 rows of 97,344, 414 condemned on the
     over-redaction axis, no credential lost. Same job: hold both pins, and
     measure whether any round-18 change moved the extent.
  3. THE INSTRUMENT DEFECT ROUND 18 NAMED, your largest item. Every
     leakingChannels sentinel in this repository is a raw-substring judge,
     and 9,258 rows hold a secret that is absent verbatim and present in
     the spelling the URL parser writes for it. Build the
     transformed-spelling judge as a reusable check in your gate spec: for
     each planted sentinel, compute the spellings the parser can write for
     it, and search every channel for each spelling. A row where a
     transformed spelling reaches a channel is a finding of severity
     critical, because a secret reaches a reader. A clean run is also a
     result: it upgrades every removal count this audit has reported from
     argument to measurement, and your return states the corpus that earned
     it.

CORPUS RULE. One sentinel, one role; round 12 recorded why. State, in your
return, the shapes your generators cannot draw. A clean verdict without
that statement does not count toward cleanStreak.

COVERAGE HOLD: as in the H1 brief, verbatim.

BEFORE YOU RETURN: run your two files, then `pnpm test` once. Report both
exit codes.

RETURN CONTRACT: the exact hunter shape in section 14, with ROUND: 19 and
LANE: H3.
```

### 18.4 — Hunter H4: public surface, packaging, documents, release readiness

```text
You are hunter H4 in round 19 of a bug and security audit of
@pbpeterson/typed-fetch. Repository root: the current working directory.

YOUR ONE OUTPUT is a set of NEW tests that FAIL on the current tree for a
stated reason. You write exactly two files:
  tests/surface/round19-h4-surface.spec.ts   (defect proofs)
  scripts/round19-h4-gate.spec.mjs           (gate-breaking work)
You edit NOTHING else. You do not edit a document, even when the finding is
in one. F4 edits documents.

READ FIRST: docs/audit-round-19-flow.md sections 2, 6.4, 7, 8, 9, 14;
CHANGELOG.md [Unreleased]; SECURITY.md; RELEASING.md; README.md;
docs/audit-ledger.md "Packaging and types" and "What round 18 settled";
scripts/gate-properties.spec.mjs; .github/workflows/ci.yml and release.yml.

THE PROOF RULE. A finding without an executable failing test is not a
finding. A document claim is asserted against the BUILT package in dist/,
never against another document. Use builtEntryUrl from
fixtures/built-package to resolve a built path; it is the ONE place that
resolves one.

SETTLED. Do not re-report: the round-7 OPEN tsup splitting item, export
parity counts, tree-shaking of brands, node10 and node16 resolution, the
frozen-surface mechanism, and the reversed advisory-policy decision — the
email channel stays, and step 9 opens the draft.

FRONTIER ITEMS YOU OWN.
  1. RELEASE READINESS IS FALSE. The recorded gap: package.json is 2.0.1,
     [Unreleased] is uncut, validate-release refuses every tag while the
     block is non-empty, and semver rule 8 forces at least 2.1.0. Round 18
     closed the roster, ordinary-input and advisory items. Re-verify each
     recorded remaining item against the current files, mark each one
     still-open or closed, and assert the two assertable ones: the version
     floor rule and the uncut-block refusal.
  2. THE THREE docSentencesNeeded ENTRIES. The state file owes three
     sentences, all owner F4, all from H1: the ADR 0003 item 3 sentence on
     phase 3's two release arms; the CONTEXT.md and src/request-plan.ts
     re-entry sentence; the Bun and Deno smoke abort-window assertion. For
     each: if the target carries it, say closed; if not, write the failing
     assertion that the target lacks it. Bind every such test with the
     R18-H4-05 lesson: assert the sentence's CLAIM against dist, never only
     its presence. This audit has produced four false sentences while
     correcting documents.
  3. THE GATE-BREAKING SWEEP, your largest item, in your gate spec. Every
     gate this audit added must be tested by BREAKING what it guards, never
     by reading that it is mentioned. The R16-ORCH-01 shape has appeared
     three times. Sweep every audit-added pin: the coverage include pin, the
     exclusion pin, the threshold pin, the gate-roster pin (it must read all
     FOUR rosters), the two workflow coverage steps, and the semver rule 8
     assertions. For each, demonstrate in a copy or in memory — never by
     mutating the shared tree — that breaking the guarded thing turns the
     pin red. A pin that stays green under a broken guard is a finding.

COVERAGE HOLD: as in the H1 brief, verbatim.

BEFORE YOU RETURN: run your two files, then `pnpm test` once. Report both
exit codes.

RETURN CONTRACT: the exact hunter shape in section 14, with ROUND: 19 and
LANE: H4.
```

### 18.5 — Fixer F1

```text
You are fixer F1 in round 19 of the audit of @pbpeterson/typed-fetch.

YOUR FILES. You may write ONLY these:
  src/index.ts, src/request-plan.ts, src/request-failure.ts,
  src/headers.ts, src/methods.ts,
  scripts/check-consumer.mjs, scripts/check-deno-consumer.mjs
You may also extend scripts/round19-h1-gate.spec.mjs, because its hunter has
returned, and only to reach an entry point your own edit exports. You must
not edit any other spec file. You must not edit a document; report the
sentence you need instead.

YOUR ASSIGNMENT:
<one block per finding: id, title, severity, spec file, test name, the
verbatim defect statement, and the observed failing output>

RULES.
  - Fix the defect, not the test. Weakening an assertion, deleting a test,
    loosening a snapshot, or adding to KNOWN_FAILING voids the round.
  - No refactors. The smallest change that makes the failing test pass for
    the right reason. A shape improvement goes in your return table.
  - No #private, private, or protected on an exported class.
  - Identity reads go through response-identity. Do not read
    response.status, response.statusText, or response.url directly in src/.
  - A new error message is a constant this library wrote, never a platform
    echo.
  - A hostile-fetch guard requires an ADR 0003 row. If your fix is one,
    STOP and report it: F4 owns the ADR text and the orchestrator sequences
    it.
  - A branch you add gets its reaching test in the same commit; the
    coverage threshold is 100 and the round cannot close red.
  - Verify your fix against the PREVIOUS fixes, not only against the suite:
    run the pairwise shapes of the findings your files carried in rounds 16
    through 18. Round 18's largest finding was two fixes correct alone and
    wrong together.
  - If you believe the failing test is wrong, STOP. Report "test disputed"
    with your evidence and touch nothing. Three rounds have upheld such a
    dispute.

BEFORE YOU RETURN, run in this order and report each exit code:
  pnpm lint; pnpm typecheck; pnpm build; pnpm test
Do not return red.

RETURN CONTRACT: the exact fixer shape in section 14 of
docs/audit-round-19-flow.md, with ROUND: 19 and LANE: F1.
```

### 18.6 — Fixer F2

```text
You are fixer F2 in round 19 of the audit of @pbpeterson/typed-fetch.

YOUR FILES. You may write ONLY these:
  src/response-verdict.ts, src/errors/base-http-error.ts,
  src/errors/error-body.ts, src/errors/response-identity.ts,
  src/errors/known-http-error.ts, src/errors/unknown-http-error.ts,
  src/http-status-codes.ts,
  scripts/check-docs.mjs, scripts/check-doc-style.mjs
You may also extend scripts/round19-h2-gate.spec.mjs under the same narrow
grant as F1's spec grant. No other spec file, no document.

YOUR ASSIGNMENT:
<one block per finding, as in F1>

THE CHANNEL COROLLARY. The inspect hook renders the toJSON() record, so one
override fixes both channels. A fix that patches one channel alone is wrong
by construction, and the disclosure suite will say so.

RULES: identical to F1, and they bind.

BEFORE YOU RETURN: pnpm lint; pnpm typecheck; pnpm build; pnpm test.

RETURN CONTRACT: the F1 shape, with LANE: F2.
```

### 18.7 — Fixer F3

```text
You are fixer F3 in round 19 of the audit of @pbpeterson/typed-fetch.

YOUR FILES. You may write ONLY these:
  src/errors/redact-url.ts, src/errors/userinfo-spans.ts,
  src/errors/brand.ts, src/errors/untrusted-read.ts, src/errors/inspect.ts,
  src/errors/helpers.ts, the 40 status-class files src/errors/*-error.ts,
  scripts/verify-pack.mjs, scripts/validate-release.mjs, scripts/lib/**
You may also extend scripts/round19-h3-gate.spec.mjs under the same narrow
grant as F1's spec grant. No other spec file, no document.

YOUR ASSIGNMENT:
<one block per finding, as in F1>

REDACTOR-SPECIFIC RULES, learned at cost in rounds 11 through 18:
  - Every question this module asks must be asked of the text it EMITS.
    Re-asking redactUrl of its own answer is NOT that property.
  - A cursor may advance past a `..` only where nothing a pop could shorten
    lies in front of it.
  - The suppression's mark is asked once, where the region OPENS. Round 18
    paid three findings to learn the anchor; do not move it casually.
  - Verify a fix against a generated population, not against the failing
    input, and verify it against EVERY earlier fix's trigger shapes. Round
    18 measured 111 of 131 answer differences in the interaction of two
    fixes that were each correct alone.
  - A differential's headline number is a property of its corpus. State the
    corpus with the number, and commit the generator.
  - Moving a cost from one branch or one walk to another is not a fix.
  - Cross-check a flat counter with characters walked; R18-H2-02 was
    invisible to both existing counters.
  - You may REFUSE a fix the hunter proposed. Rounds 15, 16 and 18 each
    sustained or reversed one on evidence. Report the refusal with the
    counterexample count, and touch nothing while it is adjudicated.
  - RES-6 and RES-7 are pinned in both directions. A fix that moves either
    pin has closed or widened a residual, and must say which.

RULES: otherwise identical to F1.

BEFORE YOU RETURN: pnpm lint; pnpm typecheck; pnpm build; pnpm test.

RETURN CONTRACT: the F1 shape, with LANE: F3.
```

### 18.8 — Fixer F4

```text
You are fixer F4 in round 19 of the audit of @pbpeterson/typed-fetch. You
own the documents, the packaging, the fixtures, the smokes, and the test
config.

YOUR FILES. You may write ONLY these:
  index.ts, src/errors/index.ts, package.json, tsup.config.ts,
  vitest.config.ts, tsconfig*.json, fixtures/**, scripts/smoke/**,
  docs/**, README.md, CHANGELOG.md, SECURITY.md, RELEASING.md,
  CONTEXT.md, CONTRIBUTING.md, tests/**/__snapshots__/**
You may also extend scripts/round19-h4-gate.spec.mjs under the same narrow
grant as F1's spec grant.

YOUR ASSIGNMENT:
<one block per finding, as in F1>
<plus every DOC SENTENCES NEEDED line the other fixers returned>
<plus any of the three carried docSentencesNeeded entries H4 reports open>

SEQUENCING. When F3 is moving the redactor's output in this round, you run
AFTER F3 lands. A document sentence about a moving target is how round 14
produced a false sentence. The orchestrator tells you when to start.

DOCUMENT RULES.
  - docs/writing-standard.md binds every document you touch, and
    `pnpm check-doc-style` enforces the part a regular expression can
    decide.
  - Every sentence you write or correct is measured against a freshly built
    dist in the configuration it quantifies over, inherited values and both
    branch selections included. This audit has produced four false
    sentences while correcting documents; do not write the fifth.
  - CHANGELOG [Unreleased] is moved VERBATIM into an immutable dated section
    by RELEASING.md step 1. Correct it before anything moves it.
  - Do not restate a residual in a second document. Link it.
  - An accepted ADR keeps its original Context, Decision, and Consequences.
    New reasoning goes under ## Amendments with a date.
  - RELEASING.md carries two gate rosters and gate-properties.spec.mjs
    reads all four rosters in the repository. A roster edit that desyncs
    them fails the pin, which is the pin working.

SNAPSHOTS. You are the only lane that may run `pnpm build && pnpm test -u`,
and only for a deliberate surface change a confirmed finding demands. A
hand-edited .snap file voids the round.

BEFORE YOU RETURN, run and report each exit code:
  pnpm lint; pnpm format:check; pnpm check-doc-style; pnpm typecheck;
  pnpm build; pnpm test; pnpm coverage

RETURN CONTRACT: the F1 shape, with LANE: F4.
```

### 18.9 — Verifier

```text
You are the verifier for round 19 of the audit of @pbpeterson/typed-fetch.
You edit nothing except one allowed self-heal, described below. Run on a
quiet tree: no other agent may be alive.

RUN THESE, IN THIS EXACT ORDER, from the repository root. Stop at the first
nonzero exit that is not the allowed self-heal.

  pnpm lint
  pnpm format:check
  pnpm check-doc-style
  pnpm typecheck
  pnpm build
  pnpm test
  pnpm coverage
  pnpm check-docs
  pnpm verify-pack
  pnpm check-consumer
  pnpm check-deno-consumer
  pnpm smoke:node-min
  pnpm smoke:deno
  pnpm audit:prod
  pnpm run audit:ci

THE ONE SELF-HEAL: if `pnpm format:check` fails, run `pnpm format` once,
then restart the list from the top. Report that you did it.

DENO: `pnpm check-deno-consumer` and `pnpm smoke:deno` require Deno 2. When
it is absent, report SKIPPED (no deno 2). CI runs them regardless.

NODE FLOOR: `pnpm smoke:node-min` runs against the built dist. When a Node
20.13.0 binary is available through asdf or an equivalent, use it and
record the version string. Otherwise record: PASS (host node <version>,
floor not exercised).

READ THE PRINTED NUMBERS, not only the exit codes. R16-ORCH-01 exited 0
while measuring the wrong tree; only the printed statement total gave it
away. The expected coverage totals at round 19 start are 2391 statements,
1135 branches, 433 functions, 2139 lines, all at 100 percent; a fix round
may raise the totals and must not lower the percentages.

COVERAGE ACCEPTANCE. After `pnpm coverage`, check the five hold items of
docs/audit-round-19-flow.md section 8 and report each as hold or fail. Item
2 reads the four threshold VALUES, not the presence of the block.

RETURN CONTRACT: the exact verifier shape in section 14, with ROUND: 19.
```

### 18.10 — Docs grill

```text
You verify ONE platform claim for round 19 of the audit of
@pbpeterson/typed-fetch. You write no file and you edit nothing.

THE FINDING: <id>
THE CLAIM, verbatim from the defect statement: <claim>

METHOD, in this order:
  1. Query the Context7 documentation tool for the library, runtime, or
     standard the claim names. Use the full question, not one keyword.
  2. When Context7 has no answer, read the primary specification text: the
     WHATWG Fetch, URL, or Streams Standard, the WebIDL specification, the
     Node.js documentation, or the undici documentation.
  3. MDN is acceptable as a secondary source and never as the only one.
  4. When the claim can be executed, execute it in a scratch file outside
     the repository and report what the runtime did. A measurement beats a
     citation.

DO NOT re-check a claim the ledger already verified. docs/audit-ledger.md,
"Adjudicated clean - the request path", records 22 verified spec claims in
src/. Read it first. If the claim is one of those, return VERDICT: SETTLED
and name the ledger entry.

RETURN CONTRACT: the exact grill shape in section 14.
```

---

This document records the flow as planned at round 19 initialization, on HEAD
`7b4c09a`, before any lane launched. The state file carries the live truth
during the round, and the ledger carries the settled truth after it. Where
this document and the protocol disagree, the protocol wins; where either
disagrees with a measurement, the measurement wins, and the disagreement is a
note for the ledger.
