# Audit round 16 — operating protocol

The complete operating procedure for round 16 of the bug and security hunt on
`@pbpeterson/typed-fetch` v2.0.1, and for every round after it until the loop
stops. Four hunter agents write failing tests. Four fixer agents make them
pass. One verifier agent runs the gates. A `/loop` runs the cycle until two
consecutive clean rounds.

This document is a procedure, not a design record. Read `CONTEXT.md` for the
vocabulary, `CONTRIBUTING.md` for the gates, `docs/audit-ledger.md` for the
eight rounds that came before this one, and
`docs/audit-round-8-protocol.md` for the procedure this one supersedes. This
protocol reuses their terms exactly: module, interface, depth, seam, adapter,
identity, channel, envelope, roster, brand, copy, branch, claim, phase, gate,
residual.

Round 16 differs from rounds 8 through 15 in three ways, and each one changes
the work:

1. **The library source is at 100 percent coverage and the audit frontier has
   moved out of it.** Round 15 closed with two clean lanes and a protocol cap,
   not with a convergence. The remaining reports are concentrated, and section
   2 names them.
2. **The coverage workstream now targets `scripts/**`and`fixtures/**`.**
   `src/**` holds 100 / 100 / 100 / 100 and a threshold that says so. The gate
   scripts that guard the release do not hold it: 541 statements, 209 branch
   arms, and 62 functions never run. Section 8 owns that work, and it is the
   largest single block of assigned work in this round.
3. **The stop condition is the only stop condition.** Round 15 stopped at a
   round cap with `cleanStreak` at zero. Round 16 raises the cap and states
   what a cap means, so a second silent stop cannot happen. Section 12 owns
   it.

## Table of contents

1. [Purpose](#1-purpose)
2. [The frontier round 15 handed over](#2-the-frontier-round-15-handed-over)
3. [What round 16 must not repeat](#3-what-round-16-must-not-repeat)
4. [Definitions](#4-definitions)
5. [Round shape](#5-round-shape)
6. [The proof rule](#6-the-proof-rule)
7. [Hunt lanes](#7-hunt-lanes)
8. [The coverage-to-100 workstream](#8-the-coverage-to-100-workstream)
9. [Write-collision protocol](#9-write-collision-protocol)
10. [The docs grill](#10-the-docs-grill)
11. [Fix phase](#11-fix-phase)
12. [Verification gate](#12-verification-gate)
13. [Loop mechanics and the state file](#13-loop-mechanics-and-the-state-file)
14. [Context hygiene and return contracts](#14-context-hygiene-and-return-contracts)
15. [Ledger and git](#15-ledger-and-git)
16. [Anti-patterns that make a round worthless](#16-anti-patterns-that-make-a-round-worthless)

- [Appendix A — hunter prompts](#appendix-a--hunter-prompts)
- [Appendix B — fixer prompts](#appendix-b--fixer-prompts)
- [Appendix C — verifier prompt](#appendix-c--verifier-prompt)
- [Appendix D — docs-grill prompt](#appendix-d--docs-grill-prompt)
- [Appendix E — orchestrator runbook](#appendix-e--orchestrator-runbook)
- [Appendix F — coverage recipes](#appendix-f--coverage-recipes)

## 1. Purpose

**Purpose** — find real defects in the library and in the gates that guard it,
prove each one with a failing test, fix each one without weakening the suite,
and raise `scripts/**` and `fixtures/**` to 100 percent coverage under an
enforced threshold.

**Condition** — the working tree is clean, `main` is checked out,
`pnpm install` has run, and the orchestrator has read
`docs/audit-ledger.md` and section 2 of this document.

**Result** — either the ledger records new settled findings, or two
consecutive rounds report nothing and the loop stops. Both outcomes are
success. The ledger states it: an empty result is a good result.

Three hard rules frame everything below:

- No agent edits code outside its lane. Sections 7, 8, and 11 define the lanes
  so that two agents can never write the same file.
- No finding exists without an executable test that fails on current `main`.
  Section 6 defines this rule. It has no exceptions.
- No agent returns file contents to the main thread. Section 14 defines the
  return contracts. The orchestrator holds the state machine and nothing else.

## 2. The frontier round 15 handed over

Round 15 wrote a handover per lane: what the lane proved, what it assumed, and
what the next round attacks first. That handover is the input to round 16. A
hunter that ignores it repeats eight rounds of work.

The full text lives in the `handover` object of `.audit-state.json` from round 15. The load-bearing items are copied here so this document stands alone.

### 2.1 Carried from H1 — request path and cross-call state

Proved, and therefore closed unless a NEW input shape breaks it:

- The envelope is total. Every failure class the request path can produce is a
  value, never a throw.
- No read that merely describes a request can prevent it, over 1063 hostile
  inputs.
- `snapshotRequestInit` is faithful: 288 options objects and 31 init shapes,
  judged by a real HTTP server. The WebIDL divergence is order only, never
  count.
- The module cross-call state is exactly one `WeakSet`, and the declaration
  list is pinned executably. That `WeakSet` is not a validation cache: four
  refusal points revalidate a value the previous call accepted.
- Phases 1 and 3 contain no `await`, measured over 24 concurrent calls. That
  is the structural reason no identity-table race exists.
- One `AbortController` over two calls yields two independent errors. A
  deadline that fires after the envelope is decided never reclassifies it.

Attack first, in this order:

1. **The cross-call body release.** The phase 3 catch releases the body of a
   `Response` that an earlier call already returned as a success. The first
   caller's stream then ends without a reader asking for it. Reaching the path
   requires ADR 0003 item 3, so it is not a defect today. Round 16 decides it
   deliberately: an ADR sentence, or a release conditional on this call having
   taken custody. A lone guard with no ADR row is a protocol violation.
2. **`validatedResponseStructures` is never rolled back on a refusal.** A
   second caller for that helper inherits a stale-acceptance defect on its
   first day. Prove it with a helper-level test or close it in writing.
3. **The abort-window premise on a non-Node runtime.** The premise that the
   ambient `fetch` normalizes its init in a synchronous prologue is measured on
   Node only. Bun, Deno, and workerd are unmeasured, and no smoke exercises
   H-28.
4. **A re-entering transport loses its own override**, because the init carries
   no `fetch`. The behavior is correct and pinned, and no document states it.

### 2.2 Carried from H2 — response phase and redactor cost

Proved:

- Redaction is total over 120000 hostile strings and the structured corpus, at
  both entry points.
- The `cleaned` loop terminates with a bound. The measure is
  `parsed.pathname.length`, the emitted text never grows, and the rebuild never
  lengthens the text.
- The bound is tight, which is what R15-H2-01 reported: the loop is quadratic,
  never unbounded, and cannot hang.
- The rebuild is total: zero throws over 400000 inputs.
- The response phase read inventory is a closed set. Twelve members refuse a
  mapped 404, and three are never reached.
- Identity is a function of the response, over 512 read schedules and across a
  macrotask boundary. Release happens exactly once.

Attack first:

1. **The cursor class R15-H2-01 belongs to.** For every place the redactor
   advances a cursor past a removal, ask whether it advances past everything
   the next parse deletes. A third cursor that answers the old way is the next
   finding of this shape.
2. **Put a pass-count seam on `cleaned`.** Every cost defect in this module was
   found by instrumenting a copy, because the loop has no observable output
   except its answer. Round 15 found the seam already exists in the platform:
   the module resolves `URL` as a global on every call, so a `URL` subclass
   installed for one synchronous call observes every parse the loop performs.
3. ~~**State the termination measure in a comment on `cleaned`.** The measure is
   written nowhere, and the surrounding comment stops one step short of the
   bound.~~ CORRECTED, 2026-08-09: this item was already closed when it was
   written. Round 15 landed the measure in the doc comment on `cleaned`, which
   names `parsed.pathname.length` and states that the emitted text never grows.
   Section 2.2's own "Proved" list above says the same thing. The item is struck
   rather than deleted, so a reader who meets it in a hunter's return can find
   the correction.
4. **The relative branch's own loop is still quadratic**, and its
   unreachability rests on one property of one platform serialization.

### 2.3 Carried from H3 — disclosure

Proved:

- The absolute branch cannot be broken by input normalization. It computes the
  origin from the parsed URL and never reads the raw string again. That closes
  eight of the twelve normalizations by unreachability.
- The rebuild is absorbed by the loop. `cleaned` returns only from a pass where
  the clean text equals the path, so the text returned is the text scanned.
- The output never begins a credential for a second reader, over 1.5 million
  answers, with every suffix parsed at a scheme-token boundary both ways.
- Round 15 H3 returned clean for the first time in eight rounds, over four
  million inputs across five generators, and states the class is closed
  structurally.

Attack first: a clean lane is the strongest signal in this audit and the
weakest evidence. H3 in round 16 attacks the generator, not the module. A
generator that cannot draw a shape cannot report it, and rounds 13 and 14 both
recorded a corpus gap that looked like a judge gap.

### 2.4 Carried from H4 — surface, documents, release readiness

Proved:

- Every round-14 `SECURITY.md` correction holds against `dist`.
- The load-bearing invariants hold over 20580 generated URLs and 41160 error
  constructions: zero non-fixed-points, zero relative answers that begin with
  two solidi, zero query bytes, zero fragment bytes, zero throws.
- `CONTEXT.md`'s five stamped members is exact for `BaseHttpError.prototype`.
- The artifact gates are green.
- The declared Node floor is verified. `pnpm smoke:node-min` ran on a real Node
  20.13.0 against a freshly built `dist` and exited 0. That closed the largest
  assumed item of the audit.

Attack first:

1. **Release readiness is FALSE and round 16 owns it.** Round 15 recorded four
   reasons: the `[Unreleased]` block carried a defect, it has no lead sentence
   naming the affected versions and the impact class, it omits the behavior
   change in the redactor output, and the semver policy permits a patch release
   that moves a security-relevant field.
2. **Say what the `SECURITY.md` residual list is for, at its head.** Four
   limits sit in the source and not in the list. All four cost a diagnostic and
   never a secret, and the omission must be a decision.
3. **Link the README `toJSON` section to the residual list. Do not restate
   it.** Two copies is how rounds 13 and 14 each produced a false sentence.
4. **Bun stays unexercised locally.** The Bun smoke and the Bun inspect key run
   in CI only.

### 2.5 The five residuals

They stay residuals. A report that restates one is not a finding.

| Id    | State    | Statement                                                                                                                                          |
| ----- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| RES-1 | recorded | A `://` inside the query cuts an embedded credential region short when the credential has no `@` before it. Closing it would delete a pinned host. |
| RES-2 | split    | The `%3A`-shielded `//` case is closed, because the region rule requires a literal colon. `%40` as an encoded at-sign stays open.                  |
| RES-3 | closed   | Round 9. A userinfo region opens at a scheme colon plus every solidus and closes only at `://`.                                                    |
| RES-4 | closed   | Round 10. The solidus count is gone from `looksLikeUserinfo`.                                                                                      |
| RES-5 | recorded | A non-special scheme under fewer than two solidi keeps its text. The URL Standard reads it as an opaque path with no authority.                    |

## 3. What round 16 must not repeat

`docs/audit-ledger.md` exists because an unrecorded verdict is re-litigated
forever. Round 16 starts from the frontier. A hunter that re-reports a settled
item wastes its whole lane. The orchestrator must discard such a report and
must record the discard in the round summary.

The following areas are settled. Each entry names the ledger section that
holds the reasoning. A hunter may attack one of these only when it can name
the entry and state why the recorded reasoning fails.

| Settled area                                                                                            | Where the ledger records it                       |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Body custody on every refusal path; no leaked listener, timer, or table entry                           | "Adjudicated clean — the request path"            |
| The options snapshot's proxy invariants; the empty init dictionary; signal, abort, timeout interleaving | "The request path"                                |
| Header-container reads. The message is a library constant now                                           | "The request path"; ADR 0003 amendment 2026-08-03 |
| The 22 spec claims in `src/`                                                                            | "The request path"                                |
| `claimable()` against `readStarted`, `bodyUsed`, and `body.locked`; tee and branch bookkeeping          | "The body lifecycle"                              |
| Bun `bodyUsed` divergence; Deno reason-phrase substitution; the Node floor argument                     | "Other runtimes"; "What round 4 settled"          |
| The seven disclosure channels for every error shape, and retention under forced collection              | "Disclosure"; "What round 5 settled"              |
| URL redaction shapes through round 15, including the overlap defect and the seam fix                    | "Disclosure"; rounds 6, 12, 13, 14, 15            |
| Module resolution, export parity, tree-shaking of brand side effects, narrowing                         | "Packaging and types"                             |
| The accessor-shape prototype pollution against `hasBrand` and `asksOwnsResponse`                        | "What round 7 settled"                            |
| Gate-spec strength, 50 mutations with 49 killed; the `node16` types-wiring pass                         | "What round 7 settled"                            |
| The consumer-reachable `clone()` surface, 78 cases, and the refusal matrix                              | "What round 6 settled"                            |
| The roster's reason phrases against the RFC and IANA                                                    | "What round 6 settled"                            |
| The declared Node floor, executed                                                                       | Round 15 `floorVerified`                          |

Three more classes of non-finding:

- **The "Adjudicated closed" entries.** A report that restates one is not a
  finding. Examples: a forged brand is accepted by design, `error.cause`
  carries the platform's text, and a `file:` URL keeps its path.
- **The permanent exclusions in ADR 0003.** A hostile-`fetch` behavior is a
  row, an exclusion, or an ADR amendment plus a scenario in one commit. It is
  never a lone guard. `tests/envelope/conformance.spec.ts` enforces this.
- **The round-7 OPEN item.** The tsup `splitting: true` consequence, which
  mangles `Class.name` and makes an accessor subclass throw under `require()`,
  is a recorded compatibility trade that waits for a maintainer decision. No
  lane re-reports it, and no fixer acts on it without an explicit maintainer
  instruction in the round brief.

One class of finding is newly IN scope, and rounds 8 through 15 excluded it:

- **A defect in a gate script or a fixture is a finding of severity low, or
  higher when the gate guards a release.** `scripts/validate-release.mjs` is
  the only check between a git tag and `npm publish`. A defect there is high,
  not low. Section 8 puts the gate scripts under test for the first time, and
  the tests it demands will find things.

## 4. Definitions

- **Round** — one full pass: HUNT, then FIX when the hunt lands confirmed
  findings, then VERIFY, then the ledger append and the commits.
- **Finding** — a claimed defect that carries all six fields of section 6.
- **Confirmed finding** — a finding whose test the orchestrator has re-run and
  seen fail on current `main`, and that survived the docs grill when section 10
  requires one.
- **Clean round** — a round in which all four of these hold:
  1. All four hunt lanes return zero confirmed findings.
  2. The coverage acceptance of section 8 holds.
  3. `pnpm build`, `pnpm test`, and `pnpm coverage` pass on the unchanged tree.
  4. The verification gate of section 12 returns no `fail` row.
- **Lane** — a named scope of files an agent may read closely, plus the files
  it may write. Lanes exist for write disjointness, not for read secrecy. Any
  agent may read any file.
- **Coverage sub-lane** — the block of `scripts/**` or `fixtures/**` files that
  one hunt lane raises to 100 percent. Section 8 assigns the four blocks.
- **Frontier item** — an entry in section 2 marked "attack first". A lane must
  address every frontier item it owns, and its return table must carry one row
  per item with a verdict.

Severity is one of four values. Assign the highest row that matches.

| Severity | Criterion                                                                                                                                                                                                       |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| critical | A secret reaches a reader through a channel; a stream ends with no reader and `cancel()` never settles; a throw escapes the envelope; the wrong class is selected for a mapped status.                          |
| high     | An identity field is wrong; a guard answers wrong for a value this library made; a keyed table retains; a packaging defect reaches an installed consumer; a release gate passes while what it guards is broken. |
| medium   | Wrong behavior on a hostile input inside ADR 0003's in-scope table; a documented claim is false against the built package; a remote-controlled cost that a caller cannot bound.                                 |
| low      | Two documents disagree; a defect reachable only from test code; a gate that cannot fail when what it guards is broken and does not guard a release.                                                             |

## 5. Round shape

Each round has five phases, in this order. No phase starts before the previous
one ends.

```
HUNT (4 agents, parallel)          each writes NEW failing tests in its own spec files
        |
ADJUDICATE (orchestrator)          re-run each claimed test; discard, grill, or confirm
        |
FIX (up to 4 agents, parallel)     only when confirmed findings exist; disjoint ownership
        |
VERIFY (1 agent)                   the full gate list of section 12, in order
        |
CLOSE (orchestrator)               ledger append, commits, state file update
```

**Action, step by step:**

1. The orchestrator reads `.audit-state.json`. When the file names a protocol
   other than `audit-round-16-protocol`, the orchestrator archives it to
   `.audit-state.round15.json`, initializes the round 16 schema of section 13,
   and creates the branch of section 15.
2. The orchestrator launches H1, H2, H3, and H4 in parallel, each with its
   verbatim prompt from Appendix A. Hunters run in subagents. The main thread
   holds no hunter output except the return contract of section 14.
3. Each hunter returns. The orchestrator writes the lane verdict and the
   findings into the state file, and sets each lane status to `returned`.
4. The orchestrator adjudicates. For each claimed finding it re-runs the named
   test on the current tree and records `confirmed` or `discarded`. A finding
   whose defect statement makes a platform claim goes to the docs grill of
   section 10 before it is confirmed.
5. When zero findings are confirmed, the round skips FIX and goes to VERIFY.
6. When findings are confirmed, the orchestrator assigns each one to a fix lane
   by the ownership table of section 11, resolves every collision by the
   arbitration rule, and launches the fixers in parallel with their Appendix B
   prompts.
7. The verifier runs the gate list of section 12 in one subagent and returns
   the rows.
8. The orchestrator closes the round: ledger append, commits, state file
   update, and the stop evaluation of section 13.

## 6. The proof rule

This rule is non-negotiable, and it is the whole difference between an audit
and an opinion.

**A hunter must not report a finding it has not proved with an executable test
that fails on current `main` for the reason claimed.**

- "Could be", "might", "seems racy", and every other speculation is discarded.
- A code-reading argument with no failing test is discarded. The ledger states
  the standing rule: if a failing test cannot be written, it is not a finding
  yet.
- A test that fails for a different reason than claimed, such as a typo, a
  wrong import, or a missing fixture, is discarded until the hunter repairs it.
- A test that asserts current behavior and passes proves nothing. The test must
  assert the CORRECT behavior, and it must fail because the code is wrong.
- A cost finding states a bound and an input the caller does not control. A
  time ratio alone is not a finding, and `CONTRIBUTING.md` forbids it.
  R15-H2-01 is the shape that works: name the remote input, name the growth,
  and prove the termination bound separately.

Every finding carries exactly six fields:

| Field            | Content                                                            |
| ---------------- | ------------------------------------------------------------------ |
| id               | `R16-<lane>-<nn>`, for example `R16-H3-01`.                        |
| title            | One line, ten words or fewer.                                      |
| lane + severity  | The hunt lane, and one value from the table in section 4.          |
| test             | The spec file and the exact test name.                             |
| observed output  | The failing assertion output, quoted verbatim, ten lines or fewer. |
| defect statement | One sentence: the trigger and the wrong outcome a caller observes. |

The defect statement follows the ledger's evidence bar. State the trigger, as
the exact input or sequence and not as a shape. State the wrong outcome, as
what a caller observes and not as what could go wrong.

## 7. Hunt lanes

Four lanes cut the surface so no two hunters write one file. Each lane owns two
NEW spec files: one for defect proofs, and one for its coverage sub-lane. The
eight names are distinct, so hunter collisions are impossible by construction.

| Lane | Focus                                            | Owned proof spec (NEW)                          | Owned coverage spec (NEW)                                                               |
| ---- | ------------------------------------------------ | ----------------------------------------------- | --------------------------------------------------------------------------------------- |
| H1   | Request path, cross-call custody, transport seam | `tests/request/round16-h1-request.spec.ts`      | `scripts/round16-consumer-entry.spec.mjs`                                               |
| H2   | Response phase, redactor cost and cursor class   | `tests/response/round16-h2-response.spec.ts`    | `scripts/round16-docs-entry.spec.mjs`                                                   |
| H3   | Disclosure, generators, channel inventory        | `tests/redaction/round16-h3-disclosure.spec.ts` | `scripts/round16-release-entry.spec.mjs`                                                |
| H4   | Public surface, packaging, documents, release    | `tests/surface/round16-h4-surface.spec.ts`      | `tests/fixtures/round16-h4-fixtures.spec.ts` and `scripts/round16-smoke-entry.spec.mjs` |

Primary read scope per lane:

| Lane | Primary read scope                                                                                                                                                                                                  |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1   | `src/index.ts` setup and transport phases, `src/request-plan.ts`, `src/request-failure.ts`, `src/methods.ts`, `src/headers.ts`, `fixtures/hostile-fetch.ts`, `tests/request/**`                                     |
| H2   | `src/index.ts` response phase, `src/response-verdict.ts`, `src/errors/base-http-error.ts`, `src/errors/error-body.ts`, `src/errors/response-identity.ts`, `src/errors/redact-url.ts` cost only, `tests/response/**` |
| H3   | `src/errors/redact-url.ts`, `src/errors/userinfo-spans.ts`, `src/errors/brand.ts`, `src/errors/untrusted-read.ts`, `src/errors/inspect.ts`, `tests/redaction/**`, `fixtures/channels.ts` as the channel inventory   |
| H4   | `index.ts`, `src/errors/index.ts`, `src/errors/helpers.ts`, `package.json`, `tsup.config.ts`, `dist/`, `README.md`, `CHANGELOG.md`, `SECURITY.md`, `RELEASING.md`, `tests/surface/**`                               |

Rules that bind every hunter:

- Write ONLY your two owned spec files. Never edit `src/**`, never edit an
  existing spec file, never edit `vitest.config.ts`, never edit any document.
- Read anything. The read scopes above are a focus, not a wall.
- Before writing a test, grep the existing suites for one that already pins the
  behavior. The suite holds 2764 tests across 66 files, and a duplicate test is
  noise.
- The interface is the test surface. Drive `typedFetch`, the public guards, the
  error classes, and `errorBodyOf` where the lifecycle is the subject. A test
  that must reach past an interface is reporting a shape problem, not writing a
  proof. The gate scripts are the one exception, and section 8 states the
  narrow seam it allows there.
- Address every frontier item your lane owns in section 2. One row per item in
  the return table, with a verdict of `finding`, `closed-by-measurement`, or
  `closed-in-writing`.
- Run both of your files before you return:
  `pnpm test <proof spec> <coverage spec>`. Quote the verbatim failing output
  for each finding.

### 7.1 H1 — request path and cross-call custody

Forbidden files for writing: everything except
`tests/request/round16-h1-request.spec.ts` and
`scripts/round16-consumer-entry.spec.mjs`.

Frontier items this lane owns: 2.1 items 1, 2, 3, and 4.

Attack ideas, in headline form. The A.1 prompt is authoritative.

1. **The cross-call release.** Build the ADR 0003 item 3 sequence with a
   transport that returns a `Response` a previous call already resolved as a
   success. Assert what the FIRST caller observes on its body. The outcome
   decides between an ADR sentence and a custody condition.
2. **`validatedResponseStructures` after a refusal.** Drive a refusal, then
   drive an acceptance of a structurally identical value, and assert the second
   call revalidates. The frontier claim is that the table is never rolled back.
3. **A re-entering transport.** A custom `fetch` that calls `typedFetch` again
   from inside itself. Assert what the inner call uses as its transport, and
   whether any document states the answer.
4. **A `URL` subclass installed for one synchronous call.** Round 15 found the
   platform seam. Use it here for the request path, not for the redactor: count
   the parses the setup phase performs, and pin the count.
5. **Concurrency against the identity tables.** 24 interleaved calls whose
   responses are the same object, and an assertion that each envelope reports
   its own identity.
6. **The signal read order under a self-mutating getter**, re-checked against
   the recorded decision, and only reported when the OUTCOME differs from the
   pinned one.

Do not re-open: the header-container collector, the options-snapshot proxy
invariants, the empty init dictionary, and any new hostile-`fetch` guard with
no ADR 0003 row.

### 7.2 H2 — response phase and redactor cost

Forbidden files for writing: everything except
`tests/response/round16-h2-response.spec.ts` and
`scripts/round16-docs-entry.spec.mjs`.

Frontier items this lane owns: 2.2 items 1, 2, 3, and 4.

Attack ideas, in headline form. The A.2 prompt is authoritative.

1. **The cursor class.** Enumerate every cursor advance in `redact-url.ts`.
   For each one, build an input where the next parse deletes text in front of
   the cursor. R15-H2-01 was one of sixteen cursors, and the fixer's principle
   is written in the round 15 notes: a cursor may advance past a `..` only
   where nothing a pop could shorten lies in front of it.
2. **The pass-count seam, asserted.** Install a `URL` subclass for one
   synchronous call, count the parses, and pin the bound as an executable
   assertion rather than a comment.
3. **The relative branch.** Its loop is quadratic and its unreachability rests
   on one platform property. Either prove the branch unreachable from
   `typedFetch`, or find the input that reaches it.
4. **The response phase read inventory** against a `Response` whose members
   answer differently on a second read, driven through a 302 chain from a real
   `node:http` server.
5. **Status and identity edges** that the existing suites do not hold: a
   `status` whose `Number()` coercion throws, a 10000-character `statusText`,
   `Response.error()` as the resolved value, and one `Response` object resolved
   by two sequential calls.

Do not re-open: `claimable()` internals, the loan mechanics, the four
clone-and-loan residuals, the base64 under-redaction, the host1 case, the
path-segment secret, and `file:` keeping its path.

### 7.3 H3 — disclosure and the generators

Forbidden files for writing: everything except
`tests/redaction/round16-h3-disclosure.spec.ts` and
`scripts/round16-release-entry.spec.mjs`.

Frontier item this lane owns: 2.3, in full.

The channel inventory is the channel set in `fixtures/channels.ts`, and a
disclosure decision applies to the channel set, never to one channel. Every
sentinel test here runs across every channel.

Attack ideas, in headline form. The A.3 prompt is authoritative.

1. **Attack the generator, not the module.** Round 15 H3 returned clean over
   four million inputs. State, in the return table, the shapes the five
   generators cannot draw. Then draw them.
2. **Shapes the alphabets never held**: `%40` as an encoded at-sign, an IDN
   host with userinfo, a `blob:` URL, a `data:` URL whose payload spells an
   authority, and a needle that is the whole message.
3. **The over-redaction axis.** The round 14 oracle judges credential survival
   only, so over-redaction is invisible to it by construction. Build the second
   judge, and run it over the same corpus.
4. **Pollution shapes** that round 7 did not close: `Object.prototype.toJSON`,
   `Symbol.toPrimitive`, and a polluted prototype-level inspect symbol. A
   forged brand on the value stays accepted by design.
5. **`Set-Cookie` and `Authorization` planted on an error response**: names,
   never values, across every channel and through a `clone()` copy.

Do not re-open: the five residuals of section 2.5, `showHidden: true`,
`console.dir` with `cause`, the accessor-pollution guard shape, and the
redactor's merge-overlap fix, except through a genuinely new input shape.

### 7.4 H4 — surface, packaging, documents, release

Forbidden files for writing: everything except
`tests/surface/round16-h4-surface.spec.ts`,
`tests/fixtures/round16-h4-fixtures.spec.ts`, and
`scripts/round16-smoke-entry.spec.mjs`.

Frontier items this lane owns: 2.4 items 1, 2, 3, and 4.

Attack ideas, in headline form. The A.4 prompt is authoritative.

1. **Release readiness.** Turn each of the four recorded reasons into an
   assertion against the files: the `[Unreleased]` block, its lead sentence,
   the missing `Changed` section for the redactor behavior change, and the
   semver rule that permits a patch to move a security-relevant field.
2. **The `SECURITY.md` residual list**, asserted against the source. Four
   limits sit in the code and not in the list. The test states the rule the
   list follows, then checks the list against it.
3. **The README `toJSON` section**, asserted to LINK the residual list rather
   than restate it. Two copies produced a false sentence twice.
4. **The type surface of `./errors` against `.`**, read from the built
   `dist/*.d.mts` with the compiler API. Any asymmetry is deliberate or a
   finding.
5. **`engines.node` against the newest built-in that `src/` uses**, proved with
   a version-gated assertion.
6. **The document set as a graph.** `CONTEXT.md`, `README.md`, `SECURITY.md`,
   `CONTRIBUTING.md`, and the ledger each state behavior. Assert one behavior
   at a time against `dist`, never against another document.

Do not re-open: the round-7 OPEN splitting item, the export parity counts,
tree-shaking of brands, node10 and node16 resolution, and the frozen-surface
mechanism itself.

## 8. The coverage-to-100 workstream

This is the largest assigned block of round 16. It is not opportunistic. Every
hunter's return table carries a COVERAGE row every round until the acceptance
of section 8.6 holds.

### 8.1 The current state, measured

`src/**` holds 100 percent on all four axes, with the threshold in
`vitest.config.ts` enforcing it. That is not the target of this workstream and
no lane may lower it.

The target is `scripts/**` and `fixtures/**`, measured on `main` at round 16
initialization:

| Axis        | Covered | Total | Uncovered |
| ----------- | ------- | ----- | --------- |
| Statements  | 708     | 1249  | 541       |
| Branch arms | 340     | 549   | 209       |
| Functions   | 180     | 242   | 62        |

Reproduce the measurement with this command. It writes nothing into the
repository:

```bash
npx vitest run --coverage.enabled --coverage.provider=v8 \
  "--coverage.include=scripts/**" "--coverage.include=fixtures/**" \
  --coverage.reporter=text --coverage.thresholds.100=false
```

### 8.2 The uncovered set has one shape

Read the per-file table of section 8.3 and the shape appears at once. Almost
every uncovered line sits in one of three places:

1. **The process entry point.** Each gate script ends with
   `if (isMainModule(import.meta.url)) main();`, and `main` is NOT exported.
   A spec can import the module and reach every exported pure decision, and it
   can never reach `main`. `scripts/check-consumer.mjs` lines 924 through 1176
   are that one function and its helpers.
2. **The printer.** Each gate formats its verdict for a human before it exits.
   `scripts/check-doc-style.mjs` lines 685 through 813 and
   `scripts/check-docs.mjs` lines 519 through 790 are printers and their
   callers.
3. **The cross-runtime smokes.** `scripts/smoke/bun.mjs`,
   `scripts/smoke/deno.ts`, and `scripts/smoke/node-min.mjs` report 0 percent
   because a Node vitest worker never runs them. Two of the three cannot run
   inside one, by design.

This shape is the reason the number is a finding and not an accounting gap. The
repository tests what each gate DECIDES and never tests what each gate DOES.
`scripts/validate-release.mjs` is the only check between a git tag and
`npm publish`, and its `main` has never run under a test.

### 8.3 The gaps, per file

Every line number below comes from the measurement of section 8.1 on
`main` at round 16 initialization. A fixer that changes a file changes its
numbers, so the owning lane re-measures before it claims a gap closed.

| File                              | Statements | Uncovered statement lines                                                     | Uncovered branch lines                                    | Uncovered function declarations                 |
| --------------------------------- | ---------- | ----------------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------- |
| `scripts/check-consumer.mjs`      | 42 / 162   | 924-925, 935-939, 946-947, 951-952, 956-959, 971-1176 in blocks               | 923-924, 958, 982, 984, 1107, 1109, 1141-1176             | 923, 934, 945, 967, 980, 993, 997               |
| `scripts/check-docs.mjs`          | 115 / 245  | 81-90, 519-790 in blocks                                                      | 83-86, 535, 555, 568, 570, 614, 641, 657-790              | 79, 517, 523, 524, 528, 548, 552, 553, 650, 655 |
| `scripts/check-doc-style.mjs`     | 189 / 268  | 242-243, 247, 450, 604, 685-813 in blocks                                     | 241, 246, 355, 405, 450, 604, 687-813                     | 683, 698, 700, 704, 708, 728, 730, 766          |
| `scripts/verify-pack.mjs`         | 63 / 87    | 256-333 in blocks                                                             | 305, 309, 333                                             | 255, 265, 279, 300                              |
| `scripts/validate-release.mjs`    | 48 / 62    | 94, 153, 157-159, 173-175, 186-187, 189-191                                   | 93, 99, 158, 161, 174, 185, 189                           | 152, 156                                        |
| `scripts/check-deno-consumer.mjs` | 10 / 31    | 95-97, 101, 103, 107, 111, 113, 122, 135, 141, 147, 152-155, 162-163, 165-167 | 161, 165                                                  | 91, 151                                         |
| `scripts/lib/scratch-dir.mjs`     | 20 / 24    | 62, 79-80                                                                     | none                                                      | 58, 78                                          |
| `scripts/lib/npm-pack.mjs`        | 16 / 16    | none                                                                          | 75                                                        | none                                            |
| `scripts/lib/is-main-module.mjs`  | 5 / 5      | none                                                                          | none                                                      | none                                            |
| `scripts/smoke/node-min.mjs`      | 0 / 63     | 25-147, the whole file                                                        | 44-45, 51, 58, 62, 75, 85, 95                             | 41, 74, 84, 88, 140, 141                        |
| `scripts/smoke/bun.mjs`           | 0 / 26     | 10-64, the whole file                                                         | 21, 24, 27, 30, 44                                        | 12                                              |
| `scripts/smoke/deno.ts`           | 0 / 34     | 16-80, the whole file                                                         | 26, 29, 32, 38, 41, 44, 58, 69, 74                        | 17, 18                                          |
| `fixtures/hostile-fetch.ts`       | 91 / 107   | 213, 223, 272, 274, 341, 369, 382, 385, 402, 428, 450-455                     | 159, 212, 223, 272-273, 341, 369, 382, 384, 402, 417, 427 | 131-134, 450-455                                |
| `fixtures/responses.ts`           | 34 / 40    | 133-138                                                                       | none                                                      | 133-138                                         |
| `fixtures/built-package.ts`       | 13 / 16    | 56-57, 63                                                                     | 55-56                                                     | none                                            |
| `fixtures/channels.ts`            | 10 / 11    | 133                                                                           | 63, 65                                                    | 133                                             |
| `fixtures/http-server.ts`         | 43 / 43    | none                                                                          | 52, 56                                                    | none                                            |
| `fixtures/error-roster.ts`        | 1 / 1      | none                                                                          | none                                                      | none                                            |
| `fixtures/recording-transport.ts` | 8 / 8      | none                                                                          | none                                                      | none                                            |

### 8.4 Sub-lane assignment

The four blocks are disjoint by file, so four hunters can work in parallel.

| Sub-lane | Owner | Files to raise to 100 percent                                                                                        | Owned coverage spec                                                                  |
| -------- | ----- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| C1       | H1    | `scripts/check-consumer.mjs`, `scripts/check-deno-consumer.mjs`                                                      | `scripts/round16-consumer-entry.spec.mjs`                                            |
| C2       | H2    | `scripts/check-docs.mjs`, `scripts/check-doc-style.mjs`                                                              | `scripts/round16-docs-entry.spec.mjs`                                                |
| C3       | H3    | `scripts/verify-pack.mjs`, `scripts/validate-release.mjs`, `scripts/lib/scratch-dir.mjs`, `scripts/lib/npm-pack.mjs` | `scripts/round16-release-entry.spec.mjs`                                             |
| C4       | H4    | `fixtures/**`, `scripts/smoke/**`                                                                                    | `tests/fixtures/round16-h4-fixtures.spec.ts`, `scripts/round16-smoke-entry.spec.mjs` |

A coverage spec under `scripts/` is `.mjs`, next to the module it drives. That
is the established convention in this repository: `scripts/*.spec.mjs` already
holds ten such files. `tsconfig.test.json` globs `tests/` only, so a `.mjs`
spec under `scripts/` is outside the typecheck gate by design, and a
TypeScript spec must live under `tests/`. `CONTRIBUTING.md` states the rule and
the reason.

### 8.5 The decision order for a gap

Apply the first option that works. Record which option each file used.

**(a) Drive the real entry point through a seam that already exists.** Several
gates already export the pure decision the printer renders. A test that calls
`judgeDocs`, `judgeConsumer`, `judgeDocStyle`, `verifyPackManifest`, or
`validateRelease` covers the decision and never the printer. Where a printer
takes the verdict object as its only input, the fix is to export the printer
and call it. That is option (b).

**(b) Export the entry point and the printer, marked `@internal`.** This is the
preferred option for every gate script, and it is a source edit, so a FIXER
performs it and a hunter never does. The grant is narrow and the reasoning is
this: `scripts/**` is not in the published tarball. `package.json` `files` is
`["dist", "errors/package.json"]`, so a new export in a gate script cannot
reach a consumer and cannot move `public-surface.spec.ts`. The shape is fixed:

```js no-check
/** @internal Exported for the entry-point spec. Not a public interface. */
export function main(io = defaultIo) { … }

if (isMainModule(import.meta.url)) main();
```

The `io` parameter carries whatever the entry point reaches for that a test
must control: `argv`, `cwd`, a writer for standard output, a writer for
standard error, and an exit function. A gate that calls `process.exit` directly
takes an `exit` member and calls that instead. No gate reads a global the test
cannot replace after this edit.

**(c) Run the script as a real process and merge its coverage.** Rejected for
the Node gates, and the reason is recorded here so a later round does not
re-propose it. `NODE_V8_COVERAGE` writes a separate profile directory that the
vitest v8 provider does not merge, so the number the gate prints stays wrong
while the work looks done. Option (b) costs one exported symbol per file and
produces a number the threshold can enforce.

**(d) Exclude, with a written justification and a test that pins the exclusion
list.** This is the last resort, and round 16 grants it to exactly two files:

- `scripts/smoke/bun.mjs` runs under Bun, and imports `Bun` globals a Node
  worker does not have.
- `scripts/smoke/deno.ts` runs under Deno, and imports `Deno` globals a Node
  worker does not have.

Both are executed in CI by their own runtimes, which is the coverage that
matters for them. The exclusion is written in `vitest.config.ts` with the
reason beside it, and `tests/surface/round16-h4-surface.spec.ts` asserts that
the exclusion list holds exactly those two paths. An exclusion list that can
grow in silence is the defect this pin removes.

`scripts/smoke/node-min.mjs` does NOT get the exclusion. It is a Node script,
option (b) reaches it, and it guards the declared engines floor that seven
rounds never executed.

### 8.6 Acceptance

The coverage acceptance holds when ALL of the following are true. The verifier
checks each one and writes `coverageAccepted` in the state file.

1. `pnpm coverage` prints 100 / 100 / 100 / 100, and its `include` names
   `src/**`, `scripts/**`, and `fixtures/**`.
2. `vitest.config.ts` carries the four thresholds at 100, and the `exclude`
   list holds exactly `scripts/smoke/bun.mjs` and `scripts/smoke/deno.ts`,
   each with a written reason.
3. `tests/surface/round16-h4-surface.spec.ts` asserts item 2's exclusion list
   and fails when a path is added.
4. Every remaining `v8 ignore` range in the repository carries a written
   justification that states the exact condition that makes the line
   unreachable. Round 5 found one false justification, so the verifier reads
   each one.
5. No coverage test asserts nothing. Section 16 anti-pattern 2 defines the
   check, and the verifier greps the new coverage specs for a bare import, an
   `expect(true).toBe(true)`, and a test body with no `expect`.

The target `vitest.config.ts`, which F4 owns and lands with the commit that
earns it:

```ts no-check
coverage: {
  provider: "v8",
  include: ["src/**", "scripts/**", "fixtures/**"],
  // Each smoke runs under a runtime a Node worker cannot host, and each one
  // is executed by that runtime in CI. Coverage for them is measured there or
  // not at all. tests/surface/round16-h4-surface.spec.ts pins this list.
  exclude: ["scripts/smoke/bun.mjs", "scripts/smoke/deno.ts"],
  reporter: ["text"],
  thresholds: { branches: 100, functions: 100, lines: 100, statements: 100 },
},
```

### 8.7 What a coverage test must assert

A coverage test is a test. It states the documented outcome of the code it
reaches, and reaching a line is a side effect of that statement. For a gate
entry point the outcome set is small and complete:

- The exit code for a passing gate, and the exit code for each distinct
  failure class the gate can report.
- The text the gate writes for a failure, asserted by the substring a reader
  uses to find the problem, and never by the whole rendered block.
- The side effects on disk, and their absence: a scratch directory that is
  removed, a tarball that is deleted, and a repository file that is never
  written.
- The one behavior each gate exists for, driven from a fixture that breaks it.
  A `verify-pack` test builds a manifest with a stray root spec file and
  asserts the gate reports it. A `validate-release` test builds a candidate
  whose tag disagrees with `package.json` and asserts the refusal.

The last item is the reason this workstream finds defects. A gate that has
never failed under test is a gate nobody has seen work.

## 9. Write-collision protocol

The disjointness contract, stated once:

- **Hunters write spec files. Fixers write source files. Nobody writes both.**
- Each hunter writes only the files named for it in section 7. The names are
  distinct across lanes, so hunter collisions are impossible by construction.
- No hunter edits an existing spec file. A hunter that wants a fixture builds
  it inline in its own file. `fixtures/**` is C4's coverage sub-lane and F4's
  source lane, so a hunter that edits a fixture collides with both.
- Each fixer owns a fixed set of source files, in section 11. The sets are
  disjoint, so fixer collisions are impossible by construction.
- Fixers must not edit any `round16-*` spec file. The failing test is the
  contract. A fixer that believes the test itself is wrong stops, reports
  `test disputed` in its return table, and touches nothing. The orchestrator
  adjudicates: either the finding is discarded and the ORCHESTRATOR removes or
  rewrites the hunter's test, or the fixer is overruled. Round 15 F3 refused a
  hunter-proposed fix with evidence and was upheld, so this path is real.
- Only F4 may regenerate snapshots, and only with `pnpm build && pnpm test -u`,
  and only for a deliberate surface change that a finding demands. A
  hand-edited `.snap` file is a protocol violation.
- Every writing agent runs `pnpm test` before it returns, and reports the exit
  status in its return table. An agent must not return with a failing suite
  unless the failures are exactly its own new, claimed finding tests.

Two agents that must touch one file is a scheduling fault, not a merge problem.
The orchestrator resolves it by ownership, never by letting both write and
reconciling afterwards.

## 10. The docs grill

A short verification step against primary documentation, scoped to platform
claims only. Use the Context7 documentation tool first, and the specification
text second.

**Required when** a finding's defect statement says the platform does X. That
covers any claim about `fetch`, `Request`, `Response`, `Headers`,
`AbortSignal`, `ReadableStream`, the WHATWG Fetch, URL, or Streams standards,
Node's undici, or the npm pack manifest format. Examples: "the Fetch Standard
forbids this method", "undici rejects this header", "`npm pack --json` reports
this field".

**Skipped when** the finding is pure library logic. A guard answers wrong, a
channel leaks a planted sentinel, a lifecycle sequence refuses incorrectly, a
type fails to narrow, or a gate script's own decision is wrong. No external
authority decides those, and the failing test does.

**Action** — the orchestrator launches one grill subagent with the Appendix D
prompt, naming the claim and the finding id. The grill agent checks the claim
against the specification text, MDN, or the Node and undici documentation, and
returns one verdict of `SUPPORTED`, `CONTRADICTED`, or `UNDECIDED`, with one
citation.

**Result** — a `CONTRADICTED` claim demotes the finding. The test asserted the
wrong correct behavior, so the orchestrator discards it and records why. An
`UNDECIDED` claim keeps the finding at medium severity or lower until a later
round settles it. The ledger already verified 22 spec claims in `src/`, so a
grill that re-checks one of those is wasted work.

**Budget** — one grill per finding, and at most four per round. A round that
wants more is reporting that its hunters argued from the platform instead of
measuring it.

## 11. Fix phase

The fix phase runs only when adjudication confirms at least one finding. Each
confirmed finding is assigned to exactly one fix lane by file ownership.

| Lane | Owned files. Writes are allowed here and nowhere else.                                                                                                                                                                                                                                              |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1   | `src/index.ts`, `src/request-plan.ts`, `src/request-failure.ts`, `src/headers.ts`, `src/methods.ts`, `scripts/check-consumer.mjs`, `scripts/check-deno-consumer.mjs`                                                                                                                                |
| F2   | `src/response-verdict.ts`, `src/errors/base-http-error.ts`, `src/errors/error-body.ts`, `src/errors/response-identity.ts`, `src/errors/known-http-error.ts`, `src/errors/unknown-http-error.ts`, `src/http-status-codes.ts`, `scripts/check-docs.mjs`, `scripts/check-doc-style.mjs`                |
| F3   | `src/errors/redact-url.ts`, `src/errors/userinfo-spans.ts`, `src/errors/brand.ts`, `src/errors/untrusted-read.ts`, `src/errors/inspect.ts`, `src/errors/helpers.ts`, the 40 status-class files `src/errors/*-error.ts`, `scripts/verify-pack.mjs`, `scripts/validate-release.mjs`, `scripts/lib/**` |
| F4   | `index.ts`, `src/errors/index.ts`, `package.json`, `tsup.config.ts`, `vitest.config.ts`, `tsconfig*.json`, `fixtures/**`, `scripts/smoke/**`, `docs/**`, `README.md`, `CHANGELOG.md`, `SECURITY.md`, `RELEASING.md`, `CONTEXT.md`, `CONTRIBUTING.md`, `tests/**/__snapshots__/**`                   |

The source lane and the coverage sub-lane are aligned on purpose. C1's files
belong to F1, C2's to F2, C3's to F3, and C4's to F4. A hunter that finds a
gate defect while writing its coverage spec hands it to the fixer that already
owns that file, and no cross-lane serialization is required.

**The arbitration rule.** A finding is owned by the lane that owns the file
where the defect statement locates the wrong code. When a fix spans files in
two lanes, the orchestrator names ONE owner, which is the lane holding the file
with the substantive change. The other lane is BLOCKED for that finding: it
must not touch the shared surface, and its return table reports
`blocked by R16-xx`. The orchestrator either widens the owner's grant for that
one finding, naming the extra file explicitly in the prompt, or serializes the
work so the owner lands first. Two agents writing one file is never the answer.

Standing consequences of the ownership table:

- A disclosure finding whose fix lands in `base-http-error.ts` belongs to F2,
  even when H3 found it. The channel corollary applies: the inspect hook
  renders the `toJSON()` record, so one override fixes both channels, and a fix
  that patches one channel alone is wrong by construction.
- Document edits demanded by any finding belong to F4 alone. F1, F2, and F3
  report the needed sentence in their return tables and edit no document.
- A hostile-`fetch` fix is an ADR 0003 amendment plus a scenario in ONE commit.
  The ADR file is under `docs/`, so F4 owns the ADR text and the source lane
  owns the guard. The orchestrator sequences the source lane before F4 so one
  commit carries both.
- `vitest.config.ts` belongs to F4 in round 16, not to F1. The threshold raise
  and the exclusion list land together with the pin test that guards them.

Rules that bind every fixer:

- Fix the defect, not the test. Weakening an assertion, deleting a test,
  loosening a snapshot, or adding an id to `KNOWN_FAILING` is anti-pattern 5
  and voids the round.
- No refactors. Make the smallest change that makes the failing test pass for
  the right reason. A shape improvement is a proposal for the return table, not
  an edit. The ledger records that guards attract guards.
- Structural, deliberately: no `#private`, `private`, or `protected` on any
  exported class. Prefer a factory over closures to a class with private fields
  in an internal module.
- Identity reads go through `response-identity`. Code in `src/` must not read
  `response.status`, `response.statusText`, or `response.url` directly.
- New error-message text follows the library-authored-message rule. It is a
  constant this library wrote, never a platform echo.
- An `@internal` export added under section 8.5 option (b) carries the JSDoc
  line that names its reason. A reviewer must see why it exists without asking.
- Before returning, run in this order: `pnpm lint`, `pnpm typecheck`,
  `pnpm build`, `pnpm test`. Report each exit status. A fixer must not return
  red.

## 12. Verification gate

One verifier agent runs the complete gate list after every fix phase, and also
after a hunt phase that confirms nothing. The list is literal and ordered. The
order matters because `pnpm test`, `pnpm check-docs`, `pnpm verify-pack`,
`pnpm check-consumer`, and the smokes read `dist/`, so `pnpm build` runs before
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

- Any nonzero exit means the round is NOT closable. The verifier reports the
  first red command and its last ten output lines verbatim, and stops.
- `pnpm check-deno-consumer` and `pnpm smoke:deno` require Deno 2 on the
  machine. When Deno 2 is absent, the verifier reports `SKIPPED (no deno 2)`
  for those two rows. CI runs them regardless, so the round may close with the
  skip recorded in the round summary.
- `pnpm smoke:node-min` runs against the built `dist`. Round 15 executed it on
  a real Node 20.13.0 binary for the first time in the audit. When the machine
  has that binary through `asdf` or an equivalent, the verifier uses it and
  records the version string. When it does not, the verifier records
  `PASS (host node <version>, floor not exercised)`.
- If `pnpm format:check` fails, the verifier runs `pnpm format` once, then
  restarts the list from the top. This is the one self-heal the verifier is
  allowed.
- After `pnpm coverage`, the verifier evaluates the five acceptance items of
  section 8.6 and reports `coverageAccepted` as true or false with the failing
  item number.
- The verifier edits nothing else. A red gate goes back to the owning fixer
  through the orchestrator.

## 13. Loop mechanics and the state file

The whole protocol runs under `/loop` with dynamic, self-paced scheduling. The
loop wakes, reads the state file, performs the next phase or one whole round
when the phases are fast, writes the state file, and yields.

### 13.1 The state file

Path: `.audit-state.json` at the repository root. It is never committed. Add it
to `.git/info/exclude`, which is not a tracked file, at round 16
initialization:

```bash
grep -qxF '.audit-state.json' .git/info/exclude || echo '.audit-state.json' >> .git/info/exclude
```

At initialization the orchestrator archives the round 15 state rather than
deleting it, because section 2 quotes it:

```bash
cp .audit-state.json .audit-state.round15.json
grep -qxF '.audit-state.round15.json' .git/info/exclude || echo '.audit-state.round15.json' >> .git/info/exclude
```

Schema, complete. Every field is required and there are no optional extras.

```json
{
  "protocol": "audit-round-16-protocol",
  "round": 16,
  "phase": "hunt",
  "startedAt": "2026-08-09T00:00:00Z",
  "branch": "chore/audit-round-16",
  "cleanStreak": 0,
  "coverageAccepted": false,
  "coverage": {
    "srcHeld": true,
    "scriptsStatements": "708/1249",
    "scriptsBranches": "340/549",
    "scriptsFunctions": "180/242",
    "subLanes": {
      "C1": "pending",
      "C2": "pending",
      "C3": "pending",
      "C4": "pending"
    }
  },
  "lanes": {
    "H1": { "status": "pending", "verdict": "", "findings": 0, "frontier": [] },
    "H2": { "status": "pending", "verdict": "", "findings": 0, "frontier": [] },
    "H3": { "status": "pending", "verdict": "", "findings": 0, "frontier": [] },
    "H4": { "status": "pending", "verdict": "", "findings": 0, "frontier": [] }
  },
  "findings": [
    {
      "id": "R16-H1-01",
      "title": "",
      "lane": "H1",
      "severity": "high",
      "specFile": "tests/request/round16-h1-request.spec.ts",
      "testName": "",
      "defect": "",
      "grill": "skipped",
      "fixLane": "F1",
      "status": "confirmed",
      "commit": ""
    }
  ],
  "gate": {
    "lint": "pending",
    "formatCheck": "pending",
    "checkDocStyle": "pending",
    "typecheck": "pending",
    "build": "pending",
    "test": "pending",
    "coverage": "pending",
    "checkDocs": "pending",
    "verifyPack": "pending",
    "checkConsumer": "pending",
    "checkDenoConsumer": "pending",
    "smokeNodeMin": "pending",
    "smokeDeno": "pending",
    "auditProd": "pending",
    "auditCi": "pending"
  },
  "history": [],
  "notes": [],
  "stoppedAt": null,
  "stopReason": null
}
```

Field semantics:

- `phase` is one of `hunt`, `adjudicate`, `fix`, `verify`, `close`, `done`.
- `lanes.*.status` is `pending`, `running`, or `returned`. A `returned` lane is
  never re-launched inside the same round.
- `lanes.*.frontier` holds one entry per frontier item the lane owns, each with
  the item text and a verdict of `finding`, `closed-by-measurement`, or
  `closed-in-writing`.
- `findings[].status` is `claimed`, `confirmed`, `discarded`,
  `adjudicated-not-a-defect`, or `fixed`.
- `findings[].grill` is `required`, `done-supported`, `done-contradicted`, or
  `skipped`.
- `gate.*` is `pending`, `pass`, `fail`, or `skipped`.
- `coverage.subLanes.*` is `pending`, `partial`, or `100`.
- `cleanStreak` counts CONSECUTIVE clean rounds under the section 4 definition.
  Any round with a confirmed finding, or with coverage acceptance not holding,
  resets it to 0.
- `notes` holds one line per lesson the round learned. Rounds 8 through 15
  produced 29 of them, and they are the highest-value output of this audit
  after the fixes.

### 13.2 Resume behavior

On every wake, the loop:

1. Reads `.audit-state.json`. When the file is absent, unparsable, or names
   another protocol, it archives the old file, initializes the schema above at
   `round: 16, phase: "hunt"`, creates the branch, and starts the hunt.
2. When `phase` is `hunt` with lanes still `pending` or `running`, it launches
   or awaits only those lanes. Returned lanes keep their verdicts.
3. When `phase` is `adjudicate`, `fix`, `verify`, or `close`, it continues at
   exactly that phase using the recorded findings and gate rows.
4. When `phase` is `done`, it confirms the stop below and performs no work.

A wake that finds a phase in progress and no agent running treats the phase as
interrupted, resets the `running` lanes to `pending`, and relaunches them. A
partially written spec file from an interrupted lane is deleted first, and the
deletion is recorded in `notes`.

### 13.3 Stop condition

**The loop stops after two CONSECUTIVE rounds in which the hunt phase produces
zero confirmed findings AND the coverage acceptance holds AND the verification
gate reports no `fail` row.**

Mechanically, at CLOSE:

1. Evaluate the four clean-round conditions of section 4.
2. Clean: `cleanStreak += 1`. Not clean: `cleanStreak = 0`.
3. `cleanStreak >= 2`: set `phase` to `done`, set `stoppedAt` to the current
   ISO timestamp, set `stopReason` to `two consecutive clean rounds`, write the
   file, append the final ledger note, and terminate the loop with a
   `ScheduleWakeup` stop. Do not schedule another wake.
4. Otherwise: increment `round`, reset `phase` to `hunt`, reset the `lanes` and
   `gate` maps to `pending`, keep the `findings` history, append one `history`
   entry, write the file, and yield until the next wake.

**The cap, and what a cap means.** When `round` reaches 30 without two
consecutive clean rounds, the loop stops with `stopReason` set to
`round cap, no convergence`. Round 15 stopped at a cap with `cleanStreak` at
zero, and the cap is the reason the audit has no convergence record. A stop at
the cap is a report about the audit, not about the code, and it demands a human
read. The orchestrator writes that sentence into the final ledger note, so the
next reader cannot mistake a cap for a clean finish.

**Pacing.** The loop is self-paced. A hunt phase with four parallel subagents
takes tens of minutes, so the orchestrator schedules the next wake at 1200
seconds or more and relies on the task notification for the real signal. It
never polls at a short interval for work the harness already reports.

## 14. Context hygiene and return contracts

Everything runs inside subagents. The main thread holds the state machine and
nothing else. Its inputs per round are exactly: the round number, one verdict
line per lane, the findings table, the frontier rows, the coverage rows, and
the gate results.

Forbidden in any agent return, with no exception:

- Pasted file contents, of any file, of any length.
- Diffs longer than 20 lines. Name the file and the hunk instead.
- Full command output. Quote at most 10 verbatim lines per finding, which is
  the failing assertion, and one exit status per command.
- Restating the prompt, narrating the exploration, or listing files read.

Every hunter returns exactly this shape, and nothing more:

```text
ROUND: 16
LANE: H1
VERDICT: <one line: "clean" or "N findings, worst severity S">
COVERAGE: <sub-lane id> <file>: <before> -> <after>; blockers: <none | option (b) edit needed in <file>>
FRONTIER:
| item | verdict | one-line reason |
| ---- | ------- | --------------- |
SUITE: pnpm test exit <0|1>; failures are exactly my claimed findings: <yes|no>

| id | title | severity | spec file | test name | defect statement |
| -- | ----- | -------- | --------- | --------- | ---------------- |

OBSERVED (per finding, max 10 lines each, verbatim):
R16-H1-01:
<failing assertion output>

NOTES: <at most three lines. A lesson for the ledger, or "none".>
```

Every fixer returns exactly this shape:

```text
ROUND: 16
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

The verifier returns the 15 gate rows as `pass`, `fail`, or `skipped`, the
five coverage acceptance items as `hold` or `fail`, and at most 10 verbatim
lines for the first failure. The grill agent returns the shape in Appendix D.

An agent that returns outside its contract is re-asked once with the contract
quoted. A second violation discards the return, and the orchestrator relaunches
the lane fresh.

## 15. Ledger and git

### 15.1 Ledger append

At CLOSE of a round with confirmed findings, the orchestrator appends one
section to `docs/audit-ledger.md`, following the shape of "What round 15
settled":

```markdown
### What round 16 settled

Four lanes: the request path and cross-call custody, the response phase and
redactor cost, disclosure and the generators, and the public surface with the
release documents. One workstream: the gate scripts under test.

- **<Finding title>.** <Trigger. Wrong outcome. What changed. What the test
  pins now.> (R16-H1-01)
- **The gate scripts run under test for the first time.** `scripts/**` and
  `fixtures/**` reached 100 percent on all four axes, and the threshold now
  says so. Two cross-runtime smokes are excluded with a written reason, and a
  test pins the exclusion list.
```

An adjudicated non-defect goes to "Adjudicated closed" with the reasoning and
the cost, in the numbered-list shape that section already uses. A clean round
appends one line: "Round N was clean: four lanes, zero confirmed findings,
coverage acceptance held."

The ledger edit belongs to F4 during a fix round and to the orchestrator during
a clean round.

At the final CLOSE, the orchestrator also appends the round-16 name map to "The
audit files, renamed by subject", and renames each `round16-*` spec file to its
subject name. The round-numbered names exist for write disjointness during the
round, and they carry no meaning after it.

### 15.2 Git

- **Branch.** Never commit to `main`. One branch for the audit:
  `chore/audit-round-16`, in `type/short-desc` kebab-case. Create it at
  initialization:

  ```bash
  git checkout -b chore/audit-round-16
  ```

- **One commit per finding-fix.** Each commit carries the finding's failing
  test AND its fix together, so every commit leaves the tree green. Coverage
  tests land as their own `test:` commit, one per sub-lane. The ledger append
  lands as its own `docs:` commit. The threshold raise lands with the coverage
  commit that earns it.
- **Message convention.** Conventional Commits, English, and Simplified
  Technical English: one idea per sentence, active voice, present tense,
  imperative mood, sentences under 20 words, no synonyms for one concept, no
  idioms. No `Co-Authored-By` line, ever. Template:

  ```text
  fix: <what the change makes correct, imperative, under 20 words>

  - Round 16, finding R16-H2-01, lane H2.
  - The test <spec file> :: "<test name>" fails before this change.
  - <One sentence: the trigger and the wrong outcome it removes.>
  ```

  Types by content: `fix:` for a defect, `test:` for coverage and pinning tests
  with no source change, `docs:` for the ledger and document edits, `chore:`
  for `vitest.config.ts` when it lands alone, and `refactor:` never.

- **Never committed:** `.audit-state.json`, `.audit-state.round15.json`, the
  `coverage/` output, any scratch file, a hand-edited `.snap` file, a
  `KNOWN_FAILING` addition, a `round16-*` spec file that still holds a failing
  test, and agent prompts or return tables.
- **Never pushed** without an explicit maintainer instruction. The round closes
  locally. Pushing and opening the pull request is the maintainer's act.

## 16. Anti-patterns that make a round worthless

Each entry names the failure, how the orchestrator detects it, and the remedy.
The verifier and the orchestrator check for all ten at every CLOSE.

1. **A test that asserts current behavior instead of correct behavior.** It
   passes on `main`, proves nothing, and fossilizes a defect. Detection: the
   adjudication re-run, where a claimed finding whose test passes is discarded
   on the spot. Remedy: the hunter states the correct behavior first, from the
   interface or the standard, then writes the assertion.
2. **A coverage test that only touches lines.** It reaches the code and asserts
   nothing about the outcome, so a wrong answer stays green. Detection: read
   the test for a bare import, an `expect(true).toBe(true)`, or a body with no
   `expect`. Remedy: section 8.7 states the outcome set to assert.
3. **A finding with no failing test.** Speculation with a severity label.
   Detection: the six-field check of section 6. No test, no finding. Remedy:
   none. It is discarded, not deferred.
4. **Two agents editing one file.** The second write drops the first in
   silence, and the suite tests a tree nobody wrote. Detection: `git status`
   between phases, and the FILES EDITED rows must be disjoint. Remedy: the
   ownership tables of sections 7, 8.4, and 11, plus the arbitration rule. Roll
   back both edits and re-run with one owner.
5. **Fixing by weakening a test.** Deleting an assertion, widening a tolerance,
   regenerating a snapshot to match broken output, or parking an id in
   `KNOWN_FAILING`. Detection: any fixer diff that touches a spec file, a
   `__snapshots__` directory, or the `KNOWN_FAILING` set. Remedy: revert,
   re-assign, and record the attempt in the round summary.
6. **Hiding a gap with `v8 ignore` and no justification.** Round 5 proved a
   written justification can be false, and an unwritten one is worse.
   Detection: the verifier greps new ignores and reads the comment beside each.
   Remedy: the decision order of section 8.5.
7. **Growing the exclusion list.** An exclusion that reaches a third file turns
   the threshold into decoration. Detection: the pin test of section 8.6 item 3. Remedy: the file gets option (b), or the round records why the exclusion
   list must change and amends this document.
8. **Scope creep into refactors.** A fix that renames, extracts a module, or
   adds a guard for a neighbor it noticed. Every extra edit widens the next
   round's surface. Detection: the diff exceeds the defect statement. Remedy:
   revert to the smallest change, and move the improvement into the return
   table as a proposal.
9. **Re-litigating the ledger.** A lane that spends its round re-proving a
   settled entry returns noise with a green checkmark. Detection: the
   orchestrator matches each finding against section 3 before adjudication.
   Remedy: discard, and cite the entry in the round summary so the next round's
   prompt names it.
10. **A clean lane with no stated corpus.** A lane that reports clean without
    naming what it drew, and what it could not draw, has reported its own
    silence. Detection: the FRONTIER rows and the NOTES line. Remedy: the lane
    is re-asked once for the corpus statement, and its clean verdict does not
    count toward `cleanStreak` until it arrives.

---

## Appendix A — hunter prompts

Paste each prompt verbatim into a fresh subagent. Replace nothing. The prompts
are complete and self-contained.

### A.1 — Hunter H1: request path and cross-call custody

```text
You are hunter H1 in round 16 of a bug and security audit of
@pbpeterson/typed-fetch, a zero-dependency typed fetch wrapper that returns
errors as values. Repository root: the current working directory.

YOUR ONE OUTPUT is a set of NEW tests that FAIL on current main for a stated
reason, plus one coverage spec. You write exactly two files:
  tests/request/round16-h1-request.spec.ts     (defect proofs)
  scripts/round16-consumer-entry.spec.mjs      (coverage sub-lane C1)
You edit NOTHING else. Not src/, not an existing spec, not vitest.config.ts,
not a document. If a fix is needed, you describe it; a fixer performs it.

READ FIRST, in this order:
  docs/audit-round-16-protocol.md   sections 2.1, 3, 6, 7.1, 8, 14
  docs/audit-ledger.md              "Adjudicated clean - the request path"
  CONTEXT.md                        the vocabulary
  docs/adr/0003-the-untrusted-fetch-conformance-boundary.md

THE PROOF RULE. A finding without an executable failing test is not a finding.
A test that passes on main proves nothing. A test must assert the CORRECT
behavior and fail because the code is wrong. Speculation is discarded.

SETTLED. Do not re-report: the header-container collector, the options
snapshot proxy invariants, the empty init dictionary, signal and abort and
timeout interleaving, body custody on refusal paths, the 22 spec claims in
src/, and any new hostile-fetch guard with no ADR 0003 row.

FRONTIER ITEMS YOU OWN. Return one row per item with a verdict of finding,
closed-by-measurement, or closed-in-writing.
  1. The cross-call body release. The phase 3 catch releases the body of a
     Response an earlier call already returned as a success, so the first
     caller's stream ends with no reader asking for it. Reaching it requires
     ADR 0003 item 3. Build the sequence, assert what the FIRST caller
     observes, and state whether the outcome demands an ADR sentence or a
     custody condition.
  2. validatedResponseStructures is never rolled back on a refusal. Drive a
     refusal, then drive an acceptance of a structurally identical value, and
     assert the second call revalidates in full.
  3. A re-entering transport loses its own override, because the init carries
     no fetch. Assert what transport the inner call uses, and report whether
     any document states it.
  4. The abort-window premise on a non-Node runtime is unmeasured. You cannot
     run Bun or Deno here. State precisely which assertion a runtime smoke
     would have to carry, in one sentence, for the docs lane to add it.

FURTHER ATTACK IDEAS, all optional and all subordinate to the frontier items:
  - A URL subclass installed for one synchronous call, used to COUNT the
    parses the setup phase performs. Pin the count.
  - 24 interleaved calls whose responses are the same object, each envelope
    asserted to report its own identity.
  - A signal getter that answers differently on a second read. Report only
    when the OUTCOME differs from the pinned decision.

COVERAGE SUB-LANE C1. Files: scripts/check-consumer.mjs (42/162 statements)
and scripts/check-deno-consumer.mjs (10/31). The uncovered mass is main() and
its printer, which are NOT exported, so a spec cannot reach them today.
  - Cover every exported decision that is still uncovered, with real
    assertions about the outcome, in scripts/round16-consumer-entry.spec.mjs.
  - For the entry point itself, DO NOT edit the script. Report in your
    COVERAGE row that the file needs the section 8.5 option (b) edit, name
    the exact symbols to export (main, and each printer it calls), and name
    the io members a test must control: argv, cwd, an out writer, an err
    writer, and an exit function.
  - A coverage test asserts an outcome. Section 8.7 lists the outcome set:
    exit code per failure class, the substring a reader looks for, the disk
    side effects and their absence, and the one behavior the gate exists for,
    driven from a fixture that breaks it.

BEFORE YOU RETURN: run `pnpm test tests/request/round16-h1-request.spec.ts
scripts/round16-consumer-entry.spec.mjs`, then run `pnpm test` once. Report
both exit codes.

RETURN CONTRACT. Return exactly this and nothing else. No file contents, no
diffs over 20 lines, no full command output, no narration.

ROUND: 16
LANE: H1
VERDICT: <"clean" or "N findings, worst severity S">
COVERAGE: C1 <file>: <before> -> <after>; blockers: <...>
FRONTIER:
| item | verdict | one-line reason |
SUITE: pnpm test exit <0|1>; failures are exactly my claimed findings: <yes|no>

| id | title | severity | spec file | test name | defect statement |

OBSERVED (per finding, max 10 verbatim lines each):

NOTES: <at most three lines, or "none">
```

### A.2 — Hunter H2: response phase and redactor cost

```text
You are hunter H2 in round 16 of a bug and security audit of
@pbpeterson/typed-fetch. Repository root: the current working directory.

YOUR ONE OUTPUT is a set of NEW tests that FAIL on current main for a stated
reason, plus one coverage spec. You write exactly two files:
  tests/response/round16-h2-response.spec.ts   (defect proofs)
  scripts/round16-docs-entry.spec.mjs          (coverage sub-lane C2)
You edit NOTHING else.

READ FIRST: docs/audit-round-16-protocol.md sections 2.2, 3, 6, 7.2, 8, 14;
docs/audit-ledger.md "What round 14 settled" and "What round 15 settled";
src/errors/redact-url.ts in full; CONTEXT.md.

THE PROOF RULE. A finding without an executable failing test is not a finding.
A cost finding states the remote input, the growth, and a separate termination
bound. A time ratio alone is not a finding; CONTRIBUTING.md forbids it.

SETTLED. Do not re-report: claimable() internals, the loan mechanics, the four
clone-and-loan residuals, the base64 under-redaction, the host1 case, the
path-segment secret, and file: keeping its path.

FRONTIER ITEMS YOU OWN.
  1. THE CURSOR CLASS. R15-H2-01 was one cursor of sixteen. The fixer's
     principle: a cursor may advance past a `..` only where nothing a pop
     could shorten lies in front of it, which is the seam position and no
     other. Enumerate every cursor advance in redact-url.ts. For each one,
     construct an input where the NEXT parse deletes text in front of the
     cursor. A third cursor that answers the old way is the next finding.
  2. THE PASS-COUNT SEAM. The loop has no observable output except its
     answer, and every cost defect here was found by instrumenting a copy.
     The seam already exists in the platform: the module resolves URL as a
     global on every call, so a URL subclass installed for one synchronous
     call observes every parse. Use it, and pin the bound as an assertion.
  3. THE TERMINATION MEASURE is written nowhere. State it as a sentence a
     fixer can paste into a comment on cleaned: the measure is
     parsed.pathname.length, the emitted text never grows, and the rebuild
     never lengthens because clean is already a parser output.
  4. THE RELATIVE BRANCH loop is still quadratic. Its unreachability rests on
     one property of one platform serialization. Either prove the branch
     unreachable from typedFetch, or find the input that reaches it.

FURTHER ATTACK IDEAS: the response phase read inventory against a Response
whose members answer differently on a second read, driven through a 302 chain
from a real node:http server (fixtures/http-server.ts); a status whose
Number() coercion throws; a 10000-character statusText; Response.error() as
the resolved value; one Response object resolved by two sequential calls.

COVERAGE SUB-LANE C2. Files: scripts/check-docs.mjs (115/245 statements) and
scripts/check-doc-style.mjs (189/268). Uncovered: check-docs.mjs 81-90 and
519-790; check-doc-style.mjs 242-247, 450, 604, and 685-813. The mass is
main() and the printers, which are not exported.
  - Cover every exported decision that is still uncovered, with real
    assertions, in scripts/round16-docs-entry.spec.mjs. judgeDocs,
    judgeDocStyle, findVocabularyViolations, findRelativeLinks,
    parseTermsTable, diffTermsTables, termsAgree, and findNodeFloorViolations
    are exported today.
  - For the entry point, DO NOT edit the script. Report the section 8.5
    option (b) edit in your COVERAGE row, naming the symbols and the io
    members.
  - Assert outcomes, never line reach. Section 8.7 lists the outcome set.

BEFORE YOU RETURN: run your two files, then `pnpm test` once. Report both.

RETURN CONTRACT: the exact shape in section 14, with LANE: H2.
```

### A.3 — Hunter H3: disclosure and the generators

```text
You are hunter H3 in round 16 of a bug and security audit of
@pbpeterson/typed-fetch. Repository root: the current working directory.

YOUR ONE OUTPUT is a set of NEW tests that FAIL on current main for a stated
reason, plus one coverage spec. You write exactly two files:
  tests/redaction/round16-h3-disclosure.spec.ts  (defect proofs)
  scripts/round16-release-entry.spec.mjs         (coverage sub-lane C3)
You edit NOTHING else.

READ FIRST: docs/audit-round-16-protocol.md sections 2.3, 2.5, 3, 6, 7.3, 8,
14; docs/audit-ledger.md "Disclosure"; SECURITY.md; fixtures/channels.ts;
tests/redaction/disclosure-channels.spec.ts; src/errors/redact-url.ts.

THE PROOF RULE. A finding without an executable failing test is not a finding.
A disclosure decision applies to the CHANNEL SET, never to one channel. Every
sentinel test runs across every channel in fixtures/channels.ts.

SETTLED. Do not re-report: the five residuals (RES-1 through RES-5),
showHidden: true, console.dir with cause, the accessor-pollution guard shape,
and the merge-overlap fix, except through a genuinely new input shape.

YOUR FRONTIER ITEM, and it is the whole lane. Round 15 H3 returned CLEAN for
the first time in eight rounds, over four million inputs across five
generators, and stated the class is closed structurally. A clean lane is the
strongest signal in this audit and the weakest evidence. Rounds 13 and 14 each
recorded a corpus gap that looked like a judge gap.

  ATTACK THE GENERATOR, NOT THE MODULE.
  1. State, in your return table, the shapes the five existing generators
     CANNOT draw. Read them; do not guess.
  2. Then draw them. Start with: %40 as an encoded at-sign, an IDN host with
     userinfo, a blob: URL, a data: URL whose payload spells an authority,
     and a needle that is the whole message.
  3. Build the SECOND judge. The round 14 oracle judges credential survival
     only, so OVER-redaction is invisible to it by construction, and
     R14-H4-02 could not have been found by it. Write a judge for
     over-redaction and run it over the same corpus.
  4. Pollution shapes round 7 did not close: Object.prototype.toJSON,
     Symbol.toPrimitive, and a polluted prototype-level inspect symbol. A
     forged brand on the VALUE stays accepted by design.
  5. Set-Cookie and Authorization planted on an error response: names, never
     values, across every channel and through a clone() copy.

COVERAGE SUB-LANE C3. Files: scripts/verify-pack.mjs (63/87 statements),
scripts/validate-release.mjs (48/62), scripts/lib/scratch-dir.mjs (20/24),
scripts/lib/npm-pack.mjs (branch at line 75).
  - validate-release.mjs is the ONLY check between a git tag and npm publish.
    A defect there is severity high, not low. Its main() has never run under
    a test. Drive validateRelease with a candidate whose tag disagrees with
    package.json and assert the refusal, and do the same for every other
    refusal class the function reports.
  - verify-pack.mjs: build a manifest with a stray root spec file and assert
    the gate reports it. Cover readTarballManifest, readPackManifest, and
    verifyPackManifest edges at 256-333.
  - scratch-dir.mjs lines 58-80 and npm-pack.mjs branch 75 are reachable from
    their exports today.
  - For each entry point, DO NOT edit the script. Report the section 8.5
    option (b) edit in your COVERAGE row.

BEFORE YOU RETURN: run your two files, then `pnpm test` once. Report both.

RETURN CONTRACT: the exact shape in section 14, with LANE: H3.
```

### A.4 — Hunter H4: surface, packaging, documents, release

```text
You are hunter H4 in round 16 of a bug and security audit of
@pbpeterson/typed-fetch. Repository root: the current working directory.

YOUR ONE OUTPUT is a set of NEW tests that FAIL on current main for a stated
reason, plus coverage specs. You write exactly three files:
  tests/surface/round16-h4-surface.spec.ts      (defect proofs)
  tests/fixtures/round16-h4-fixtures.spec.ts    (coverage, fixtures/**)
  scripts/round16-smoke-entry.spec.mjs          (coverage, scripts/smoke/**)
You edit NOTHING else. You do not edit a document, even when the finding is
in one. F4 edits documents.

READ FIRST: docs/audit-round-16-protocol.md sections 2.4, 3, 6, 7.4, 8, 14;
CHANGELOG.md [Unreleased]; SECURITY.md; RELEASING.md; README.md the toJSON
section; docs/audit-ledger.md "Packaging and types".

THE PROOF RULE. A finding without an executable failing test is not a finding.
A document claim is asserted against the BUILT package in dist/, never against
another document. Use builtEntryUrl from fixtures/built-package to resolve a
built path; it is the ONE place that resolves one.

SETTLED. Do not re-report: the round-7 OPEN tsup splitting item, export parity
counts, tree-shaking of brands, node10 and node16 resolution, and the
frozen-surface mechanism itself.

FRONTIER ITEMS YOU OWN.
  1. RELEASE READINESS IS FALSE, and round 16 owns it. Turn each recorded
     reason into an assertion:
       a. The [Unreleased] block carried R15-H4-02, a superseded seam rule.
          RELEASING.md step 1 moves [Unreleased] VERBATIM into an immutable
          dated section, so a wrong sentence there becomes permanent.
       b. It has no lead sentence naming the affected released versions (all
          are 2.0.1 or earlier) and the impact class.
       c. It omits the behavior change: the redactor output moved in BOTH
          directions for ordinary inputs, and there is no Changed section.
       d. A strict reading of RELEASING.md permits 2.0.2, a patch that
          changes what a security-relevant field emits, and no step publishes
          a security advisory although SECURITY.md directs reporters there.
  2. THE SECURITY.md RESIDUAL LIST has no stated purpose at its head, and
     four limits sit in the source and not in the list. All four cost a
     diagnostic and never a secret. State the rule the list follows, then
     assert the list against it.
  3. THE README toJSON SECTION must LINK to the residual list, not restate
     it. Two copies is how rounds 13 and 14 each produced a false sentence.
  4. BUN is unexercised locally. State, in one sentence, the assertion a Bun
     smoke would have to carry.

FURTHER ATTACK IDEAS: the type surface of ./errors against . read from the
built dist/*.d.mts with the TypeScript compiler API; engines.node against the
newest built-in that src/ uses, with a version-gated assertion; the document
set as a graph, one behavior at a time against dist.

COVERAGE SUB-LANE C4. Two blocks.
  BLOCK 1, fixtures/**, in tests/fixtures/round16-h4-fixtures.spec.ts:
    hostile-fetch.ts 91/107 statements, uncovered at 213, 223, 272, 274, 341,
    369, 382, 385, 402, 428, 450-455, with functions at 131-134 and 450-455;
    responses.ts 34/40, uncovered 133-138; built-package.ts 13/16, uncovered
    56-57 and 63; channels.ts 10/11, uncovered 133; http-server.ts branches
    at 52 and 56. A fixture is test code, so its coverage test asserts the
    fixture's own contract: the hostile behavior it promises, and the shape
    it returns.
  BLOCK 2, scripts/smoke/**, in scripts/round16-smoke-entry.spec.mjs:
    node-min.mjs is 0/63 and is a NODE script, so it gets the section 8.5
    option (b) edit and a real test. It guards the declared engines floor,
    which seven rounds never executed. Report the edit in your COVERAGE row.
    bun.mjs and deno.ts import runtime globals a Node worker does not have.
    They get the section 8.5 option (d) exclusion. Your surface spec MUST
    assert that the vitest exclusion list holds exactly those two paths, so
    the list cannot grow in silence. Write that assertion now; it fails until
    F4 lands the config, and that failing test is finding-shaped work, not a
    defect report. Put it in your COVERAGE row, not in your findings table.

BEFORE YOU RETURN: run your three files, then `pnpm test` once. Report both.

RETURN CONTRACT: the exact shape in section 14, with LANE: H4.
```

## Appendix B — fixer prompts

Launch a fixer only for confirmed findings. Fill the bracketed slots from the
state file before you paste.

### B.1 — Fixer F1

```text
You are fixer F1 in round 16 of the audit of @pbpeterson/typed-fetch.

YOUR FILES. You may write ONLY these:
  src/index.ts, src/request-plan.ts, src/request-failure.ts,
  src/headers.ts, src/methods.ts,
  scripts/check-consumer.mjs, scripts/check-deno-consumer.mjs
You may write no other file. You must not edit any spec file. You must not
edit a document; report the sentence you need instead.

YOUR ASSIGNMENT:
<one block per finding: id, title, severity, spec file, test name, the
verbatim defect statement, and the observed failing output>

<when C1 requires it, add:>
ALSO: apply the section 8.5 option (b) edit to <file>. Export main and the
printers it calls, each marked with a JSDoc line:
  /** @internal Exported for the entry-point spec. Not a public interface. */
Give main an io parameter that defaults to the real one and carries argv,
cwd, an out writer, an err writer, and an exit function. Change no behavior.
scripts/** is not in the published tarball, so this cannot move the public
surface, and public-surface.spec.ts must stay green without a snapshot update.

RULES.
  - Fix the defect, not the test. Weakening an assertion, deleting a test,
    loosening a snapshot, or adding to KNOWN_FAILING voids the round.
  - No refactors. The smallest change that makes the failing test pass for
    the right reason. A shape improvement goes in your return table.
  - No #private, private, or protected on an exported class.
  - Identity reads go through response-identity. Do not read response.status,
    response.statusText, or response.url directly in src/.
  - A new error message is a constant this library wrote, never a platform
    echo.
  - A hostile-fetch guard requires an ADR 0003 row. If your fix is one, STOP
    and report it: F4 owns the ADR text and the orchestrator sequences it.
  - If you believe the failing test is wrong, STOP. Report "test disputed"
    with your evidence and touch nothing. Round 15 F3 did this and was upheld.

BEFORE YOU RETURN, run in this order and report each exit code:
  pnpm lint; pnpm typecheck; pnpm build; pnpm test
Do not return red.

RETURN CONTRACT. Exactly this, nothing else:
ROUND: 16
LANE: F1
FINDINGS FIXED: <ids>
FINDINGS DISPUTED: <ids, or none>
BLOCKED: <ids, or none>
FILES EDITED: <paths only>
INTERNAL EXPORTS ADDED: <symbol and file, or none>
DOC SENTENCES NEEDED: <one line each, or none>
CHECKS: lint <0|1> typecheck <0|1> build <0|1> test <0|1>
NOTES: <at most three lines, or "none">
```

### B.2 — Fixer F2

```text
You are fixer F2 in round 16 of the audit of @pbpeterson/typed-fetch.

YOUR FILES. You may write ONLY these:
  src/response-verdict.ts, src/errors/base-http-error.ts,
  src/errors/error-body.ts, src/errors/response-identity.ts,
  src/errors/known-http-error.ts, src/errors/unknown-http-error.ts,
  src/http-status-codes.ts,
  scripts/check-docs.mjs, scripts/check-doc-style.mjs

YOUR ASSIGNMENT:
<one block per finding, as in B.1>

<when C2 requires it, add the option (b) paragraph from B.1, naming the file.>

THE CHANNEL COROLLARY. The inspect hook renders the toJSON() record, so one
override fixes both channels. A fix that patches one channel alone is wrong by
construction, and the disclosure suite will say so.

RULES: identical to B.1, and they bind.

BEFORE YOU RETURN: pnpm lint; pnpm typecheck; pnpm build; pnpm test.

RETURN CONTRACT: the B.1 shape, with LANE: F2.
```

### B.3 — Fixer F3

```text
You are fixer F3 in round 16 of the audit of @pbpeterson/typed-fetch.

YOUR FILES. You may write ONLY these:
  src/errors/redact-url.ts, src/errors/userinfo-spans.ts,
  src/errors/brand.ts, src/errors/untrusted-read.ts, src/errors/inspect.ts,
  src/errors/helpers.ts, the 40 status-class files src/errors/*-error.ts,
  scripts/verify-pack.mjs, scripts/validate-release.mjs, scripts/lib/**

YOUR ASSIGNMENT:
<one block per finding, as in B.1>

REDACTOR-SPECIFIC RULES, learned at cost in rounds 11 through 15:
  - A cursor may advance past a `..` only where nothing a pop could shorten
    lies in front of it, which is the seam position and no other. State one
    rule with a set parameter, not one call per site.
  - Every question this module asks must be asked of the text it EMITS.
    Re-asking redactUrl of its own answer is NOT that property and does not
    imply it, because a second call recomputes the origin.
  - Verify a fix against a generated population, not against the failing
    input. Round 11 F3 broke its own first fix and caught it with the
    fixed-point property: 1925 failures over 604204 URLs where the head input
    had none.
  - Moving a cost from one branch to another is not a fix. Round 14 F3 moved
    the quadratic from the relative branch to the absolute branch, which a
    redirect reaches.
  - You may REFUSE a fix the hunter proposed. Round 15 F3 refused one with
    evidence and was upheld. Report the refusal with the counterexample count.

RULES: otherwise identical to B.1.

BEFORE YOU RETURN: pnpm lint; pnpm typecheck; pnpm build; pnpm test.

RETURN CONTRACT: the B.1 shape, with LANE: F3.
```

### B.4 — Fixer F4

```text
You are fixer F4 in round 16 of the audit of @pbpeterson/typed-fetch. You own
the documents, the packaging, the fixtures, the smokes, and the test config.

YOUR FILES. You may write ONLY these:
  index.ts, src/errors/index.ts, package.json, tsup.config.ts,
  vitest.config.ts, tsconfig*.json, fixtures/**, scripts/smoke/**,
  docs/**, README.md, CHANGELOG.md, SECURITY.md, RELEASING.md,
  CONTEXT.md, CONTRIBUTING.md, tests/**/__snapshots__/**

YOUR ASSIGNMENT:
<one block per finding, as in B.1>
<plus every DOC SENTENCES NEEDED line the other fixers returned>

THE COVERAGE CONFIG, when the round has earned it. Land this in
vitest.config.ts together with the commit that closes the last sub-lane:
  include: ["src/**", "scripts/**", "fixtures/**"]
  exclude: ["scripts/smoke/bun.mjs", "scripts/smoke/deno.ts"]
  thresholds: branches 100, functions 100, lines 100, statements 100
Write the reason for the exclusion beside it: each smoke runs under a runtime
a Node worker cannot host, and CI executes it there. Do not land the exclusion
before the pin test in tests/surface/round16-h4-surface.spec.ts is green.

DOCUMENT RULES.
  - docs/writing-standard.md binds every document you touch, and
    `pnpm check-doc-style` enforces the part a regular expression can decide.
    American English, active voice, simple present, one action per sentence,
    25 words or fewer. Do not write simply, just, easy, obvious, or clearly.
    A request is aborted, never canceled. An error body is canceled, never
    aborted. Use must, must not, should, can, or may, never "needs to".
  - CHANGELOG [Unreleased] is moved VERBATIM into an immutable dated section
    by RELEASING.md step 1. Correct it before anything moves it.
  - Do not restate a residual in a second document. Link it.
  - An accepted ADR keeps its original Context, Decision, and Consequences.
    New reasoning goes under ## Amendments with a date.

SNAPSHOTS. You are the only lane that may run `pnpm build && pnpm test -u`,
and only for a deliberate surface change a confirmed finding demands. A
hand-edited .snap file voids the round.

BEFORE YOU RETURN, run and report each exit code:
  pnpm lint; pnpm format:check; pnpm check-doc-style; pnpm typecheck;
  pnpm build; pnpm test; pnpm coverage

RETURN CONTRACT: the B.1 shape, with LANE: F4, plus one line:
COVERAGE CONFIG: <landed | not yet earned | not applicable>
```

## Appendix C — verifier prompt

```text
You are the verifier for round 16 of the audit of @pbpeterson/typed-fetch. You
edit nothing except one allowed self-heal, described below.

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

THE ONE SELF-HEAL: if `pnpm format:check` fails, run `pnpm format` once, then
restart the list from the top. Report that you did it.

DENO: `pnpm check-deno-consumer` and `pnpm smoke:deno` require Deno 2. When it
is absent, report SKIPPED (no deno 2). CI runs them regardless.

NODE FLOOR: `pnpm smoke:node-min` runs against the built dist. When a Node
20.13.0 binary is available through asdf or an equivalent, use it and record
the version string. Otherwise record: PASS (host node <version>, floor not
exercised).

COVERAGE ACCEPTANCE. After `pnpm coverage`, check all five and report each as
hold or fail:
  1. The report prints 100/100/100/100 and its include names src/**,
     scripts/**, and fixtures/**.
  2. vitest.config.ts carries four thresholds at 100, and its exclude list
     holds exactly scripts/smoke/bun.mjs and scripts/smoke/deno.ts, each with
     a written reason.
  3. tests/surface/round16-h4-surface.spec.ts asserts that exclusion list.
  4. Every `v8 ignore` range in the repository carries a written
     justification that states the exact condition making the line
     unreachable. Read each one. Round 5 found a false justification.
  5. No new coverage spec contains a bare import with no assertion, an
     expect(true).toBe(true), or a test body with no expect.

RETURN CONTRACT. Exactly this, nothing else:
ROUND: 16
GATES:
| command | pass | fail | skipped |   (one row per command, in order)
COVERAGE ACCEPTANCE:
| item | hold | fail |            (five rows)
coverageAccepted: <true|false>
FIRST FAILURE: <command, then at most 10 verbatim output lines, or "none">
```

## Appendix D — docs-grill prompt

```text
You verify ONE platform claim for round 16 of the audit of
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
  4. When the claim can be executed, execute it in a scratch file outside the
     repository and report what the runtime did. A measurement beats a
     citation.

DO NOT re-check a claim the ledger already verified. docs/audit-ledger.md,
"Adjudicated clean - the request path", records 22 verified spec claims in
src/. Read it first. If the claim is one of those, return VERDICT: SETTLED
and name the ledger entry.

RETURN CONTRACT. Exactly this, nothing else:
FINDING: <id>
VERDICT: <SUPPORTED | CONTRADICTED | UNDECIDED | SETTLED>
CITATION: <one source, with the section or heading>
QUOTE: <at most three lines from the source>
MEASURED: <what you executed and what it did, or "not executed">
CONSEQUENCE: <one sentence: what this does to the finding>
```

## Appendix E — orchestrator runbook

This is the main thread's whole job. It holds the state machine and nothing
else.

### E.1 Initialization, once

```bash
git status --porcelain                 # must be empty
git checkout -b chore/audit-round-16
cp .audit-state.json .audit-state.round15.json
grep -qxF '.audit-state.json' .git/info/exclude || echo '.audit-state.json' >> .git/info/exclude
grep -qxF '.audit-state.round15.json' .git/info/exclude || echo '.audit-state.round15.json' >> .git/info/exclude
pnpm install
pnpm build && pnpm test               # the baseline must be green
```

Then write `.audit-state.json` with the section 13.1 schema at `round: 16`,
`phase: "hunt"`.

### E.2 One round

1. **HUNT.** Launch four subagents in ONE message, so they run concurrently.
   Each gets its Appendix A prompt verbatim. Set each lane to `running`.
2. **Collect.** Write each return into the state file. Set the lane to
   `returned`. Never paste a return into the conversation.
3. **ADJUDICATE.** For each claimed finding:
   - Match it against section 3. A settled item is discarded, and the discard
     is recorded.
   - Re-run the named test: `pnpm test <spec file> -t "<test name>"`. It must
     FAIL. A passing test is discarded on the spot.
   - When the defect statement makes a platform claim, launch one grill
     subagent with the Appendix D prompt. A `CONTRADICTED` verdict discards
     the finding.
   - Set `status` to `confirmed` or `discarded`, and assign `fixLane` by the
     section 11 ownership table.
4. **Resolve collisions.** Two findings whose fixes touch one file get one
   owner by the arbitration rule. Record the blocked lane.
5. **FIX.** Launch only the lanes with assignments, in one message, each with
   its Appendix B prompt. Skip the phase when nothing is confirmed.
6. **VERIFY.** Launch one subagent with the Appendix C prompt. Write the rows
   and `coverageAccepted` into the state file.
7. **CLOSE.** Commit per section 15.2, append the ledger per section 15.1,
   evaluate the stop condition of section 13.3, and write the state file.
8. **Schedule.** When the loop continues, schedule the next wake at 1200
   seconds or more with a one-line reason. Do not poll.

### E.3 What the orchestrator never does

- It never reads a source file to form its own opinion about a finding. It
  re-runs the test. The test is the evidence.
- It never writes a spec file, except to remove or rewrite a disputed test
  after it has adjudicated the dispute.
- It never relays a sentence between documents without checking which member
  the sentence describes. Round 14 produced a false security sentence exactly
  that way: `error.url` and `toJSON().url` have opposite contracts by design.
- It never generalizes a residual from one measured spelling. Round 13
  produced R13-H4-02 by measuring the two-solidus spelling of `%3A` and
  writing the general claim.
- It never lets a clean verdict count toward `cleanStreak` when the lane did
  not state its corpus.

## Appendix F — coverage recipes

Fragments for the hunters to adapt. None of them is a finished test.

### F.1 A gate entry point, after the option (b) edit

```js no-check
import { main } from "./validate-release.mjs";

test("the gate refuses a tag that disagrees with package.json", () => {
  const out = [];
  const err = [];
  let code = null;
  main({
    argv: ["node", "validate-release.mjs", "v9.9.9"],
    cwd: scratch,
    out: (s) => out.push(s),
    err: (s) => err.push(s),
    exit: (c) => {
      code = c;
    },
  });
  expect(code).toBe(1);
  expect(err.join("")).toContain("v9.9.9");
});
```

The assertion names the exit code and the substring a reader looks for. It
does not assert the whole rendered block, because the block's wording is
program output and changes without a behavior change.

### F.2 A gate that must fail, driven from a broken fixture

```js no-check
test("verify-pack reports a stray root spec file in the manifest", () => {
  const manifest = readTarballManifest(listingWith("round16-stray.spec.ts"));
  const verdict = verifyPackManifest(manifest.files, manifest.files.length);
  expect(verdict.ok).toBe(false);
  expect(verdict.problems.map((p) => p.path)).toContain("round16-stray.spec.ts");
});
```

This is the item that finds defects. A gate that has never failed under test is
a gate nobody has seen work.

### F.3 A fixture's own contract

```ts no-check
test("the hostile transport returns the second answer on a second read", () => {
  const transport = hostileFetchThatChangesItsAnswer();
  const first = transport.status;
  const second = transport.status;
  expect(first).not.toBe(second);
});
```

A fixture is test code, and its coverage test asserts the behavior the fixture
promises. A fixture whose promise is untested makes every suite that uses it
weaker than it reads.

### F.4 The exclusion pin

```ts no-check
test("the coverage exclusion list holds exactly the two cross-runtime smokes", async () => {
  const config = await readFile("vitest.config.ts", "utf8");
  const listed = [...config.matchAll(/"(scripts\/smoke\/[^"]+)"/g)].map((m) => m[1]);
  expect(listed.sort()).toEqual(["scripts/smoke/bun.mjs", "scripts/smoke/deno.ts"]);
});
```

An exclusion list that can grow in silence turns a 100 percent threshold into
decoration. This test is the reason the threshold means something.

### F.5 The pass-count seam

```ts no-check
test("the redaction loop parses the input a bounded number of times", () => {
  const original = globalThis.URL;
  let parses = 0;
  class CountingUrl extends original {
    constructor(input: string | URL, base?: string | URL) {
      parses += 1;
      super(input, base);
    }
  }
  globalThis.URL = CountingUrl as unknown as typeof URL;
  try {
    redactUrl(hostileInput);
  } finally {
    globalThis.URL = original;
  }
  expect(parses).toBeLessThanOrEqual(expectedBound);
});
```

The module resolves `URL` as a global on every call, so a subclass installed
for one synchronous call observes every parse the loop performs. Round 15 found
this seam and declined to add a pass counter to the module surface, because the
platform already provides one.
