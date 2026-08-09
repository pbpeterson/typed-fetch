# Audit round 8 — operating protocol

The complete operating procedure for round 8 of the bug and security hunt on
`@pbpeterson/typed-fetch` v2.0.1. Four hunter agents write failing tests. Four
fixer agents make them pass. One verifier agent runs the gates. A `/loop` runs
the cycle until two consecutive clean rounds.

This document is a procedure, not a design record. Read `CONTEXT.md` for the
vocabulary, `CONTRIBUTING.md` for the gates, and `docs/audit-ledger.md` for the
seven rounds that came before this one. This protocol reuses their terms
exactly: module, interface, depth, seam, adapter, identity, channel, envelope,
roster, brand, copy, branch, claim, phase, gate, residual.

## Table of contents

1. [Purpose](#1-purpose)
2. [What round 8 must not repeat](#2-what-round-8-must-not-repeat)
3. [Definitions](#3-definitions)
4. [Round shape](#4-round-shape)
5. [The proof rule](#5-the-proof-rule)
6. [Hunt lanes](#6-hunt-lanes)
7. [Write-collision protocol](#7-write-collision-protocol)
8. [The coverage-to-100 workstream](#8-the-coverage-to-100-workstream)
9. [The docs grill](#9-the-docs-grill)
10. [Fix phase](#10-fix-phase)
11. [Verification gate](#11-verification-gate)
12. [Loop mechanics and the state file](#12-loop-mechanics-and-the-state-file)
13. [Context hygiene and return contracts](#13-context-hygiene-and-return-contracts)
14. [Ledger and git](#14-ledger-and-git)
15. [Anti-patterns that make a round worthless](#15-anti-patterns-that-make-a-round-worthless)

- [Appendix A — hunter prompts](#appendix-a--hunter-prompts)
- [Appendix B — fixer prompts](#appendix-b--fixer-prompts)
- [Appendix C — verifier prompt](#appendix-c--verifier-prompt)
- [Appendix D — docs-grill prompt](#appendix-d--docs-grill-prompt)

## 1. Purpose

**Purpose** — find real defects in the library, prove each one with a failing
test, fix each one without weakening the suite, and close the coverage gaps
that remain after round 7.

**Condition** — the working tree is clean, `main` is checked out, and
`pnpm install` has run. The orchestrator has read `docs/audit-ledger.md`.

**Result** — either the ledger records new settled findings, or two consecutive
rounds report nothing and the loop stops. Both outcomes are success. The ledger
states it: an empty result is a good result.

Two hard rules frame everything below:

- No agent edits code outside its lane. Section 6 and section 10 define the
  lanes so that two agents can never write the same file.
- No finding exists without an executable test that fails on current `main`.
  Section 5 defines this rule. It has no exceptions.

## 2. What round 8 must not repeat

`docs/audit-ledger.md` exists because an unrecorded verdict is re-litigated
forever. Round 8 starts from the frontier. A hunter that re-reports a settled
item wastes its whole lane. The orchestrator must discard such a report and
must record the discard in the round summary.

The following areas are settled. Each entry names the ledger section that
holds the reasoning. A hunter may attack one of these only when it can name
the entry and state why the recorded reasoning fails.

| Settled area                                                                                                                             | Where the ledger records it                       |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Body custody on every refusal path; no leaked listener, timer, or table entry                                                            | "Adjudicated clean — the request path"            |
| The options snapshot's proxy invariants; the empty init dictionary; signal, abort, and timeout interleaving                              | "The request path"                                |
| Header-container reads (the message is a library constant now)                                                                           | "The request path"; ADR 0003 amendment 2026-08-03 |
| The 22 spec claims in `src/`                                                                                                             | "The request path"                                |
| `claimable()` versus `readStarted`, `bodyUsed`, `body.locked`; tee and branch bookkeeping under reentrancy; lent identity                | "The body lifecycle"                              |
| Bun `bodyUsed` divergence; Deno reason-phrase substitution; the Node floor argument                                                      | "Other runtimes"; "What round 4 settled"          |
| The seven channels for a dedicated class, `UnknownHttpError`, a `clone()` copy, and a request failure; retention under forced collection | "Disclosure"; "What round 5 settled"              |
| URL redaction shapes, including the round-5 overlap defect and its round-6 merge fix                                                     | "Disclosure"; "What round 6 settled"              |
| Module resolution, export parity, tree-shaking of brand side effects, narrowing                                                          | "Packaging and types"                             |
| The accessor-shape prototype pollution against `hasBrand` and `asksOwnsResponse`; the `ambientTransport` key test                        | "What round 7 settled"                            |
| Gate-spec strength (50 mutations, 49 killed); the `node16` types-wiring pass                                                             | "What round 7 settled"                            |
| The consumer-reachable `clone()` surface (78 cases); the refusal matrix                                                                  | "What round 6 settled"                            |
| The roster's reason phrases against the RFC and IANA                                                                                     | "What round 6 settled"                            |

Three more classes of non-finding:

- **The eight "Adjudicated closed" entries.** A report that restates one is not
  a finding. Examples: a forged brand is accepted by design; `error.cause`
  carries the platform's text; a `file:` URL keeps its path.
- **The eight permanent exclusions in ADR 0003.** A hostile-`fetch` behavior is
  a row, an exclusion, or an ADR amendment plus a scenario in one commit.
  It is never a lone guard. `conformance.spec.ts` enforces this.
- **The round-7 OPEN item.** The tsup `splitting: true` consequence
  (`Class.name` mangling and the accessor-subclass throw under `require()`) is
  a recorded compatibility trade awaiting a maintainer decision. H4 must not
  re-report it. A fixer must not act on it without an explicit maintainer
  instruction in the round brief.

The five stated residuals stay residuals: `cause` through `structuredClone`
and the fatal-exception printer, vitest's assertion-message stringifier, the
hierarchical path, the trusted ownership answer, and the four identity-loan
edge cases.

## 3. Definitions

- **Round** — one full pass: HUNT, then FIX when the hunt lands confirmed
  findings, then VERIFY, then the ledger append and the commits.
- **Finding** — a claimed defect that carries all six fields of section 5.
- **Confirmed finding** — a finding whose test the orchestrator has re-run and
  seen fail on current `main`, and that survived the docs grill when section 9
  requires one.
- **Clean round** — a round in which (a) all four hunt lanes return zero
  confirmed findings, and (b) the coverage acceptance of section 8 holds, and
  (c) `pnpm build`, `pnpm test`, and `pnpm coverage` pass on the unchanged
  tree. All three conditions are required.
- **Lane** — a named scope of files an agent may read closely and the one spec
  file it may write. Lanes exist for write disjointness, not for read secrecy.
  Any agent may read any file.

Severity is one of four values. Assign the highest row that matches.

| Severity | Criterion                                                                                                                                                                     |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| critical | A secret reaches a reader through a channel; a stream is stranded so `cancel()` never settles; a throw escapes the envelope; the wrong class is selected for a mapped status. |
| high     | An identity field is wrong; a guard answers wrong for a value this library made; a keyed table retains; a packaging defect reaches an installed consumer.                     |
| medium   | Wrong behavior on a hostile input inside ADR 0003's in-scope table; a documented claim is false against the built package.                                                    |
| low      | Two documents disagree; a defect reachable only from test code; a gate that cannot fail when what it guards is broken.                                                        |

## 4. Round shape

Each round has five phases, in this order. No phase starts before the previous
one ends.

```
HUNT (4 agents, parallel)          each writes NEW failing tests in its own spec file
        |
ADJUDICATE (orchestrator)          re-run each claimed test; discard, grill, or confirm
        |
FIX (up to 4 agents, parallel)     only when confirmed findings exist; disjoint src/ ownership
        |
VERIFY (1 agent)                   the full gate list of section 11, in order
        |
CLOSE (orchestrator)               ledger append, commits, state file update
```

**Action, step by step:**

1. The orchestrator reads `.audit-state.json` (section 12). When the file is
   absent, it initializes round 8 and creates the branch of section 14.
2. The orchestrator launches H1, H2, H3, and H4 in parallel, each with its
   verbatim prompt from Appendix A. Hunters run in subagents. The main thread
   receives only the return tables of section 13.
3. When all four hunters return, the orchestrator adjudicates. For each
   claimed finding it runs the named test itself:

   ```bash
   pnpm test round8-h1-request-input.spec.ts
   ```

   A test that passes on `main` is discarded, whatever the hunter argued.
   A finding that claims platform behavior goes to the docs grill (section 9)
   before confirmation.

4. When zero findings are confirmed, the orchestrator skips FIX. It runs the
   short gate (`pnpm build`, `pnpm test`, `pnpm coverage`), evaluates the
   clean-round conditions, updates the state file, and either loops or stops.
   Hunt-phase coverage tests (section 8) still merge in this case: they pass
   by design and they move the metric.
5. When confirmed findings exist, the orchestrator assigns each to exactly one
   fix lane by the arbitration rule of section 10, then launches the needed
   fixers in parallel with their Appendix B prompts.
6. When all fixers return, the orchestrator launches the verifier with the
   Appendix C prompt. Any red command means the round is not closable; the
   orchestrator sends the failure back to the owning fixer and repeats VERIFY.
7. The orchestrator appends to `docs/audit-ledger.md`, commits per section 14,
   updates `.audit-state.json`, and schedules the next round.

WARNING: never run two phases at once. A fixer editing `src/index.ts` while a
hunter measures it produces findings about a tree that no longer exists.

## 5. The proof rule

This rule is non-negotiable, and it is the whole difference between an audit
and an opinion.

**A hunter must not report a finding it has not proved with an executable test
that fails on current `main` for the reason claimed.**

- "Could be", "might", "seems racy", and every other speculation is discarded.
- A code-reading argument without a failing test is discarded. The ledger
  states the standing rule: if a failing test cannot be written, it is not a
  finding yet.
- A test that fails for a different reason than claimed (a typo, a wrong
  import, a missing fixture) is discarded until the hunter repairs it.
- A test that asserts current behavior and passes proves nothing. The test
  must assert the CORRECT behavior, and it must fail because the code is
  wrong.

Every finding carries exactly six fields:

| Field            | Content                                                            |
| ---------------- | ------------------------------------------------------------------ |
| id               | `R8-<lane>-<nn>`, for example `R8-H3-01`.                          |
| title            | One line, ten words or fewer.                                      |
| lane + severity  | The hunt lane, and one value from the table in section 3.          |
| test             | The spec file and the exact test name.                             |
| observed output  | The failing assertion output, quoted verbatim, ten lines or fewer. |
| defect statement | One sentence: the trigger and the wrong outcome a caller observes. |

The defect statement follows the ledger's evidence bar: state the trigger (the
exact input or sequence, not a shape) and state the wrong outcome (what a
caller observes, not what could go wrong).

## 6. Hunt lanes

Four lanes cut the surface so no two hunters write one file. Each lane owns
one NEW spec file at the repository root, next to the existing suites. Spec
files at the root are collected by vitest automatically.

| Lane | Focus                                                                       | Owned spec file (NEW)              | Primary read scope                                                                                                                                                                                                                |
| ---- | --------------------------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1   | Request setup and input classification; the transport seam; coverage-to-100 | `round8-h1-request-input.spec.ts`  | `src/index.ts` (setup + transport phases), `src/request-failure.ts`, `src/methods.ts`, `src/headers.ts`                                                                                                                           |
| H2   | Response handling and error construction                                    | `round8-h2-response-error.spec.ts` | `src/index.ts` (response phase), `src/errors/base-http-error.ts`, `src/errors/error-body.ts`, `src/errors/response-identity.ts`, `src/errors/known-http-error.ts`, `src/errors/unknown-http-error.ts`, `src/http-status-codes.ts` |
| H3   | Disclosure and security                                                     | `round8-h3-disclosure.spec.ts`     | `src/errors/redact-url.ts`, `src/errors/brand.ts`, the `toJSON` and inspect members of `base-http-error.ts`, `disclosure-channels.spec.ts` as the channel inventory                                                               |
| H4   | Public surface, types, packaging, docs claims                               | `round8-h4-surface.spec.ts`        | `index.ts`, `src/errors/index.ts`, `src/errors/helpers.ts`, `package.json`, `tsup.config.ts`, `dist/`, `public-surface.spec.ts`, `type-level.spec.ts`, `docs-claims.spec.ts`                                                      |

Rules that bind every hunter:

- Write ONLY your owned spec file. Never edit `src/**`, never edit an existing
  spec file, never edit `vitest.config.ts`, never edit any document.
- Read anything. The read scopes above are a focus, not a wall.
- Before writing a test, grep the existing suites for one that already pins
  the behavior. The suite is about 19,600 lines across 15 root spec files; a
  duplicate test is noise.
- The interface is the test surface. Drive `typedFetch`, the public guards,
  the error classes, and `errorBodyOf` where the lifecycle is the subject.
  A test that must reach past an interface is reporting a shape problem, not
  writing a proof.
- Run your file before returning: `pnpm test <your-spec-file>`. Quote the
  verbatim failing output for each finding.

### 6.1 H1 — request setup and input classification

Forbidden files for writing: everything except `round8-h1-request-input.spec.ts`.

Attack ideas, in headline form — the full, self-contained list is in the A.1
prompt, and the prompt is authoritative:

1. The coverage recipes of section 8. This is assigned work, not optional.
2. A tagged non-platform "Request" under a custom transport versus the
   ambient one (`transportTakesRequest` answers per side).
3. A `URL` object mutated after the call starts (the input is serialized
   once).
4. A `fetch` override present only on the options prototype chain (the
   override is an OWN property read).
5. A signal already aborted before the call; `AbortSignal.timeout(0)` against
   a synchronous double (only the transport phase can produce `AbortedError`).
6. A `Request` first argument with options carrying only `fetch` (the init
   dictionary must stay empty).
7. Lowercase `patch` versus `PATCH` (platform claim — docs grill).
8. A relative string URL (Node has no document base).
9. An options `signal` getter that answers differently on a second read (the
   signal is captured once).

Do not re-open: the header-container collector (removed by design), H-26 and
H-28 (amended and closed in rounds 6 and 7), the options-snapshot proxy
invariants, and any new hostile-`fetch` guard without an ADR 0003 row.

### 6.2 H2 — response handling and error construction

Forbidden files for writing: everything except `round8-h2-response-error.spec.ts`.

Attack ideas, in headline form — the full, self-contained list is in the A.2
prompt, and the prompt is authoritative:

1. Status boundaries through an injected double: 399, 400, 599, 600, 0,
   404.5, -1, and the string `"404"` (identity normalizes with `Number()` on
   first read).
2. A `status` whose `Number()` coercion throws (`Symbol`; a throwing
   `valueOf`).
3. `statusText` edges: non-string, whitespace-only, 10,000 characters (the
   message stays library-authored).
4. Unmapped 419 and 599 resolve with `UnknownHttpError`; assert both guards.
5. Lifecycle sequences absent from the round-6 refusal matrix, driven through
   `errorBodyOf` directly: `tee()` after cancel; a second `cancel()` after a
   rejected reader; a reader after `tee()` while the branch is unread.
6. A 500 response whose `body` is `null`: readers and `cancel()` settle per
   the interface.
7. `Response.error()` (status 0, type `"error"`) as the resolved value.
8. One `Response` object resolved by two sequential calls: one response has
   one identity.

Do not re-open: `claimable()` internals, Bun `bodyUsed`, loan mechanics,
nested-loan residuals, the 407 exception, and the roster tables (H4 owns
surface questions; the roster tests own drift).

### 6.3 H3 — disclosure and security

Forbidden files for writing: everything except `round8-h3-disclosure.spec.ts`.

The channel inventory is the seven channels of `disclosure-channels.spec.ts`,
and a disclosure decision applies to the channel set, never to one channel.
Every sentinel test here runs across all seven.

Attack ideas, in headline form — the full, self-contained list is in the A.3
prompt, and the prompt is authoritative:

1. A sentinel planted in the server's reason phrase, reaching `statusText`
   (platform claim — docs grill).
2. Redaction shapes the round-5 and round-6 fuzz alphabets never drew:
   `%40`-encoded at-sign, IDN host with userinfo, a `blob:` URL, a needle
   that is the whole message. Assert bytes, not timing.
3. Adversarial cost, correctness-only: 8,000 credentials through
   `redactUrlInMessage` against a chained-form oracle. No time ratios — the
   ledger records why the timing guard was removed.
4. Pollution shapes round 7 did not close: `Object.prototype.toJSON`,
   `Symbol.toPrimitive`, a polluted prototype-level inspect symbol. A forged
   brand on the VALUE stays accepted by design.
5. Candidate new channels (`util.format("%j", …)`, the
   `getOwnPropertyNames` replacer idiom, `console.table`) — recorded covered
   in round 5; report only on a leak involving members added since.
6. `Set-Cookie` and `Authorization` planted on an error response: names,
   never values, across all seven channels and through a `clone()` copy.
7. A sentinel in the query and fragment of the `Request` input's URL on a
   request failure (`structure and value` governs `error.url` and `message`).

Do not re-open: the five residuals, `showHidden: true`, `console.dir` and
`cause`, the accessor-pollution guard shape (round 7), and the redactor's
merge-overlap fix (round 6) except through a genuinely new input shape.

### 6.4 H4 — public surface, types, packaging, docs claims

Forbidden files for writing: everything except `round8-h4-surface.spec.ts`.

Attack ideas, in headline form — the full, self-contained list is in the A.4
prompt, and the prompt is authoritative:

1. The TYPE surface of `./errors` versus `.`, read from the built
   `dist/*.d.mts` with the compiler API; any asymmetry is deliberate or a
   finding.
2. `HttpMethods` excludes `CONNECT` and `TRACE` (spec claim — docs grill);
   also the runtime envelope for a JavaScript caller who passes `"TRACE"`.
3. Envelope narrowing shapes `type-level.spec.ts` does not pin: `satisfies`,
   a generic wrapper, `Array.prototype.map`.
4. README behavioral sentences changed since round 6, asserted against the
   BUILT package (the `docs-claims.spec.ts` pattern).
5. `engines.node` versus the newest built-in `src/` uses, proved with a
   version-gated assertion.
6. The `./package.json` subpath and export-condition order under a bundler
   resolver; report only a NEW regression.
7. `verify-pack`'s exported pure decision against a manifest carrying a stray
   root spec file, at the seam, with no committed breakage.

Do not re-open: the round-7 OPEN splitting item (recorded, awaiting the
maintainer), export parity counts, tree-shaking of brands, node10/node16
resolution, and the frozen-surface mechanism itself.

## 7. Write-collision protocol

The disjointness contract, stated once:

- **Hunters write spec files. Fixers write source files. Nobody writes both.**
- Each hunter writes exactly one NEW file, named in section 6. The four names
  are distinct, so hunter collisions are impossible by construction.
- No hunter edits an existing spec file. A hunter that wants a fixture edits
  nothing under `fixtures/`; it builds the fixture inline in its own file.
- Each fixer owns a fixed set of source files (section 10). The sets are
  disjoint, so fixer collisions are impossible by construction.
- Fixers must not edit any `round8-*.spec.ts`. The failing test is the
  contract. A fixer that believes the test itself is wrong stops, reports
  "test disputed" in its return table, and touches nothing. The orchestrator
  adjudicates: either the finding is discarded and the hunter's test is
  removed or rewritten by the ORCHESTRATOR, or the fixer is overruled.
- Only F4 may regenerate snapshots, and only with
  `pnpm build && pnpm test -u`, and only for a deliberate surface change that
  a finding demands. A hand-edited `.snap` is a protocol violation.
- Every writing agent runs `pnpm test` (full suite) before returning, and
  reports the exit status in its return table. An agent must not return with
  a failing suite unless the failures are exactly its own new, claimed
  finding tests.

Two agents that must touch one file is a scheduling fault, not a merge
problem. The orchestrator resolves it by ownership (section 10), never by
letting both write and reconciling afterwards.

## 8. The coverage-to-100 workstream

**Owner: H1** for the tests, **F1** for the `vitest.config.ts` threshold edit.
The workstream is assigned, not opportunistic: H1's return table must carry a
COVERAGE row every round until acceptance holds.

Current state (from `pnpm coverage` on `main`): all files 99.56% statements,
100% branches, 100% functions, 99.52% lines. The gaps are exactly:

| Gap                                          | What it is                                                                | Decision                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts` line 40                       | `catch {}` in `hasRequestTag` — `Object.prototype.toString.call` throwing | (a) Write the test. Recipe 1 below reaches it.                                                                                                                                                                                                                                                                      |
| `src/index.ts` line 58                       | `catch {}` in `isPlatformRequest` — `value instanceof Request` throwing   | (a) Write the test. Recipe 2 reaches it; recipe 1's revoked Proxy reaches both 40 and 58.                                                                                                                                                                                                                           |
| `src/index.ts` line 426                      | `catch` in `isKnownHttpError` — a hostile `status` getter throwing        | (a) Write the test. Recipe 3 reaches it.                                                                                                                                                                                                                                                                            |
| `src/index.ts` line 699                      | `catch` in `classifyRequestInput` — a hostile `url` getter throwing       | (a) Write the test. Recipe 4 reaches it.                                                                                                                                                                                                                                                                            |
| `src/headers.ts`, `src/methods.ts` report 0% | Type-only modules; no runtime statement is emitted                        | Not a gap. Record in the ledger that the 0% is a reporting artifact. Do not write a fake runtime test. If the reporter keeps counting them after the four lines are covered, F1 may scope the coverage `include` or add a file-level ignore, with the written reason beside it.                                     |
| `src/errors/index.ts` reports 0%             | A pure re-export barrel no runtime test imports directly                  | Same decision path. `public-surface.spec.ts` already proves the barrel's exports from `dist/`. A one-line runtime import in H1's spec file is acceptable ONLY if it asserts something (an export exists and is the same binding the root barrel exports); a bare import written to move a number is anti-pattern 2. |

The decision order for any gap, now and in later rounds:

1. **(a) Preferred:** write a real test that makes the throw happen — a
   hostile getter, a hostile `Symbol.toStringTag`, a revoked Proxy, a Proxy
   with a throwing `getPrototypeOf` trap. The test must assert the documented
   outcome of the defensive arm, not merely execute the line.
2. **(b)** once every reachable line is covered, raise the thresholds to
   100/100/100/100. The exact edit, owned by F1:

   ```diff
        thresholds: {
          branches: 100,
          functions: 100,
   -      lines: 99,
   -      statements: 99,
   +      lines: 100,
   +      statements: 100,
        },
   ```

3. **(c) Last resort:** a `/* v8 ignore */` range with a WRITTEN justification
   beside it, only when no test can reach the line. This is the repository's
   stated norm: every branch is either tested or carries a written `v8
ignore` justification. Round 5 found one false justification, so a new
   ignore must state the exact condition that makes the line unreachable, and
   the verifier reads it.

**Acceptance** — one of the two, checked every round:

- `pnpm coverage` prints 100 / 100 / 100 / 100 for `src/**`, and the
  thresholds in `vitest.config.ts` say 100 four times; or
- every remaining uncovered line sits inside a `v8 ignore` range with a
  written justification, and the type-only 0% artifact is recorded in the
  ledger.

### The four recipes

Each recipe drives the public interface. None reaches past a seam. Each
assertion states the documented outcome of the defensive arm. These are
fragments for H1 to adapt, not finished tests.

Recipe 1 — one revoked Proxy covers lines 40 and 58. `instanceof Request`
walks the prototype chain of a revoked Proxy and throws; the catch on line 58
answers false. `Object.prototype.toString.call` then reads
`Symbol.toStringTag` on the revoked Proxy and throws; the catch on line 40
answers false. The input is classified as URL-like and the call still resolves
with an envelope.

```ts no-check
test("a revoked Proxy input is classified without a throw escaping", async () => {
  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();
  const calls: unknown[] = [];
  const transport = (async (input: unknown) => {
    calls.push(input);
    return new Response(null, { status: 204 });
  }) as typeof fetch;

  const result = await typedFetch(proxy as unknown as string, { fetch: transport });

  // The envelope holds: nothing escapes typedFetch as an exception.
  expect("response" in result && "error" in result).toBe(true);
});
```

Recipe 2 — line 58 in isolation (line 40 stays green on this input): a live
Proxy whose `getPrototypeOf` trap throws breaks `instanceof` but answers the
default for the tag read.

```ts no-check
const hostilePrototypeWalk = new Proxy(
  {},
  {
    getPrototypeOf() {
      throw new Error("hostile prototype walk");
    },
  },
);
```

Recipe 3 — line 426: forge both brands as own `Symbol.for` properties (the
ledger's closed item 3 records that a forged brand is accepted by design),
then make `status` a throwing getter. `isKnownHttpError` must answer false.
Read the two brand keys from `src/errors/brand.ts`; do not guess them.

```ts no-check
const forged = {};
for (const key of bothBrandKeysFromBrandModule) {
  Object.defineProperty(forged, key, { value: true });
}
Object.defineProperty(forged, "status", {
  get() {
    throw new Error("hostile status getter");
  },
});
expect(isKnownHttpError(forged)).toBe(false);
```

Recipe 4 — line 699: a tagged non-platform request whose own `url` getter
throws. Classification records an empty `requestUrl` and the transport still
receives the input.

```ts no-check
const fakeRequest = {
  [Symbol.toStringTag]: "Request",
  get url(): string {
    throw new Error("hostile url getter");
  },
};
// Drive typedFetch with a custom transport double; assert the double received
// fakeRequest itself, and that the resulting error (if any) reports url "".
```

NOTE: these tests exercise defensive arms that already answer correctly, so
they PASS on `main`. They are coverage work, not findings. H1 reports them in
the COVERAGE row, never in the findings table.

## 9. The docs grill

A short verification step against primary documentation, scoped to platform
claims only.

**Required when:** a finding's defect statement says the platform does X — any
claim about `fetch`, `Request`, `Response`, `Headers`, `AbortSignal`,
`ReadableStream`, the WHATWG Fetch, URL, or Streams standards, or Node's
undici. Examples: "the Fetch Standard forbids this method", "undici rejects
this header", "`Request.prototype.url` re-serializes".

**Skipped when:** the finding is pure library logic — a guard answers wrong, a
channel leaks a planted sentinel, a lifecycle sequence refuses incorrectly, a
type fails to narrow. No external authority decides those; the failing test
does.

**Action:** the orchestrator launches one grill subagent with the Appendix D
prompt, naming the claim and the finding id. The grill agent checks the claim
against the WHATWG specification text, MDN, or the Node.js and undici
documentation, and returns VERDICT `SUPPORTED`, `CONTRADICTED`, or
`UNDECIDED` with one citation each.

**Result:** a `CONTRADICTED` claim demotes the finding: the test asserted the
wrong "correct behavior", so the orchestrator discards it and records why. An
`UNDECIDED` claim keeps the finding at medium severity or lower until a later
round settles it. The ledger already verified 22 spec claims in `src/`; a
grill that re-checks one of those is wasted work — read "The request path"
first.

## 10. Fix phase

The fix phase runs only when adjudication confirms at least one finding. Each
confirmed finding is assigned to exactly one fix lane by file ownership.

| Lane | Owned files (writes allowed here and nowhere else)                                                                                                                                               |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F1   | `src/index.ts`, `src/request-failure.ts`, `src/headers.ts`, `src/methods.ts`, `vitest.config.ts`                                                                                                 |
| F2   | `src/errors/base-http-error.ts`, `src/errors/error-body.ts`, `src/errors/response-identity.ts`, `src/errors/known-http-error.ts`, `src/errors/unknown-http-error.ts`, `src/http-status-codes.ts` |
| F3   | `src/errors/redact-url.ts`, `src/errors/brand.ts`, `src/errors/helpers.ts`, the 40 status-class files `src/errors/*-error.ts`                                                                    |
| F4   | `index.ts` (root barrel), `src/errors/index.ts`, `package.json`, `tsup.config.ts`, `scripts/**`, `fixtures/**`, `docs/**`, `README.md`, `CHANGELOG.md`, `__snapshots__/**`                       |

**The arbitration rule.** A finding is owned by the lane that owns the file
where the defect statement locates the wrong code. When a fix spans files in
two lanes, the orchestrator names ONE owner — the lane holding the file with
the substantive change — and the other lane is BLOCKED for that finding: it
must not touch the shared surface, and its return table reports
`blocked by R8-xx`. The orchestrator either widens the owner's grant for this
one finding (naming the extra file explicitly in the prompt) or serializes:
the owner lands first, the second lane runs after the owner returns. Two
agents writing one file is never the answer.

Standing consequences of the ownership table:

- A disclosure finding whose fix lands in `base-http-error.ts` (a `toJSON`
  member, the inspect hook) belongs to F2, even though H3 found it. The
  channel corollary applies: the inspect hook renders the `toJSON()` record,
  so one override fixes both channels — a fix that patches one channel alone
  is wrong by construction.
- Documentation edits demanded by any finding belong to F4 alone. F1, F2, and
  F3 report the needed sentence in their return tables and edit no document.
- A hostile-`fetch` fix is an ADR 0003 amendment plus a scenario in ONE
  commit. The ADR file is under `docs/`, so such a finding is owned by F4 for
  the ADR text and by the source lane for the guard — this is the arbitration
  rule's serialization case, and the orchestrator sequences F-source before
  F4 so the single commit can carry both.

Rules that bind every fixer:

- Fix the defect, not the test. Weakening an assertion, deleting a test,
  loosening a snapshot, or adding an id to `KNOWN_FAILING` is anti-pattern 5
  and voids the round.
- No refactors. The smallest change that makes the failing test pass for the
  right reason. A shape improvement is a proposal for the return table, not
  an edit. Remember the ledger's warning: seventeen percent of the recent
  history was one-more-guard reactions, and each guard became the next
  round's surface.
- Structural, deliberately: no `#private`, `private`, or `protected` on any
  exported class. Prefer a factory over closures to a class with private
  fields in an internal module.
- Identity reads go through `response-identity`; code in `src/` must not read
  `response.status`, `response.statusText`, or `response.url` directly.
- New error-message text follows the library-authored-message rule: a
  constant this library wrote, never a platform echo.
- Before returning, run in order: `pnpm lint`, `pnpm typecheck`,
  `pnpm build`, `pnpm test`. Report each exit status. A fixer must not return
  red.

## 11. Verification gate

One verifier agent runs the complete gate list after every fix phase. The
list is literal and ordered; the order matters because `pnpm test`,
`pnpm check-docs`, `pnpm verify-pack`, `pnpm check-consumer`, and the smokes
read `dist/`, so `pnpm build` runs before them.

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
```

- Any nonzero exit means the round is NOT closable. The verifier reports the
  first red command and its last ten output lines verbatim, and stops.
- `pnpm check-deno-consumer` and `pnpm smoke:deno` require Deno 2 on the
  machine. When Deno 2 is absent, the verifier reports `SKIPPED (no deno 2)`
  for those two rows; CI runs them regardless, so the round may close with
  the skip recorded in the round summary.
- If `pnpm format:check` fails, the verifier runs `pnpm format` once, then
  restarts the list from the top. This is the one self-heal the verifier is
  allowed.
- The verifier edits nothing else. A red gate goes back to the owning fixer
  through the orchestrator.

## 12. Loop mechanics and the state file

The whole protocol runs under `/loop` with dynamic, self-paced scheduling:
the loop wakes, reads the state file, performs the next phase (or one whole
round when the phases are fast), writes the state file, and yields.

### The state file

Path: `.audit-state.json` at the repository root. It is never committed; add
it to `.git/info/exclude` (not `.gitignore`, which is a tracked file) at
round-8 initialization:

```bash
echo ".audit-state.json" >> .git/info/exclude
```

Schema, complete — every field, no optional extras:

```json
{
  "protocol": "audit-round-8-protocol",
  "round": 8,
  "phase": "hunt",
  "startedAt": "2026-08-08T00:00:00Z",
  "branch": "chore/audit-round-8",
  "cleanStreak": 0,
  "coverageAccepted": false,
  "lanes": {
    "H1": { "status": "pending", "verdict": "", "findings": 0 },
    "H2": { "status": "pending", "verdict": "", "findings": 0 },
    "H3": { "status": "pending", "verdict": "", "findings": 0 },
    "H4": { "status": "pending", "verdict": "", "findings": 0 }
  },
  "findings": [
    {
      "id": "R8-H1-01",
      "title": "",
      "lane": "H1",
      "severity": "high",
      "specFile": "round8-h1-request-input.spec.ts",
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
    "auditProd": "pending"
  },
  "stoppedAt": null
}
```

Field semantics:

- `phase` is one of `hunt`, `adjudicate`, `fix`, `verify`, `close`, `done`.
- `lanes.*.status` is `pending`, `running`, or `returned`. A `returned` lane
  is never re-launched inside the same round.
- `findings[].status` is `claimed`, `confirmed`, `discarded`,
  `adjudicated-not-a-defect`, or `fixed`. `findings[].grill` is `required`,
  `done-supported`, `done-contradicted`, or `skipped`.
- `gate.*` is `pending`, `pass`, `fail`, or `skipped`.
- `cleanStreak` counts CONSECUTIVE clean rounds (section 3 definition). Any
  round with a confirmed finding, or with coverage acceptance not holding,
  resets it to 0.
- `coverageAccepted` is true when section 8's acceptance holds; the verifier
  sets it from the `pnpm coverage` output each round.

### Resume behavior

On every wake, the loop:

1. Reads `.audit-state.json`. When absent or unparsable, it initializes the
   schema above at `round: 8, phase: "hunt"`, creates the branch, and starts
   the hunt.
2. When `phase` is `hunt` with lanes still `pending` or `running`, it
   launches or awaits only those lanes. Returned lanes keep their verdicts.
3. When `phase` is `adjudicate`, `fix`, `verify`, or `close`, it continues at
   exactly that phase using the recorded findings and gate rows.
4. When `phase` is `done`, it confirms the stop (below) and performs no work.

### Stop condition

**The loop stops after two CONSECUTIVE rounds in which the hunt phase
produces zero confirmed findings AND the coverage acceptance holds.**

Mechanically, at CLOSE:

1. Evaluate the clean-round conditions of section 3.
2. Clean: `cleanStreak += 1`. Not clean: `cleanStreak = 0`.
3. `cleanStreak >= 2`: set `phase: "done"`, set `stoppedAt` to the current
   ISO timestamp, write the file, append the final ledger note, and terminate
   the loop with `ScheduleWakeup stop`. Do not schedule another wake.
4. Otherwise: `round += 1`, reset `phase` to `hunt`, reset the `lanes` and
   `gate` maps to `pending`, keep `findings` history, write the file, and
   yield until the next wake.

Safety valve: when `round` reaches 15 without two consecutive clean rounds,
stop anyway with a ledger note that the loop hit the cap. An audit that never
converges is reporting something about the audit, and a human must read it.

Later rounds reuse this protocol unchanged, with one substitution: round N
spec files are named `roundN-h1-…` through `roundN-h4-…`, and finding ids are
`RN-<lane>-<nn>`.

NOTE: This section is a historical record of the protocol as it ran, and it
keeps the `roundN-hX-*` names the audit actually used. After the audit closed
at round 15, the spec files were renamed by subject. `docs/audit-ledger.md`
carries the map from each round-numbered name to its current name, in the
section "The audit files, renamed by subject".

## 13. Context hygiene and return contracts

Everything runs inside subagents. The main thread holds the state machine and
nothing else. Its inputs per round are exactly: the round number, one verdict
line per lane, the findings table, and the gate results.

Forbidden in any agent return, without exception:

- Pasted file contents, of any file, of any length.
- Diffs longer than 20 lines. Name the file and the hunk instead.
- Full command output. Quote at most 10 verbatim lines per finding — the
  failing assertion — and one exit status per command.
- Restating the prompt, narrating the exploration, or listing files read.

Every hunter returns exactly this shape, and nothing more:

```text
ROUND: 8
LANE: H1
VERDICT: <one line: "clean" or "N findings, worst severity S">
COVERAGE: <H1 only: "lines 40,58,426,699 -> covered" or remaining gaps; other lanes write "n/a">
SUITE: pnpm test exit <0|1>; failures are exactly my claimed findings: <yes|no>

| id | title | severity | spec file | test name | defect statement |
| -- | ----- | -------- | --------- | --------- | ---------------- |

OBSERVED (per finding, max 10 lines each, verbatim):
R8-H1-01:
<failing assertion output>
```

Every fixer returns exactly this shape:

```text
ROUND: 8
LANE: F1
FINDINGS FIXED: <ids>
FINDINGS DISPUTED: <ids, or none>
BLOCKED: <ids owned elsewhere that touched my files, or none>
FILES EDITED: <paths only>
DOC SENTENCES NEEDED: <one line per needed doc change, or none>
CHECKS: lint <0|1> typecheck <0|1> build <0|1> test <0|1>
```

The verifier returns the 14 gate rows as `pass` / `fail` / `skipped`, plus at
most 10 verbatim lines for the first failure. The grill agent returns the
shape in Appendix D. An agent that returns outside its contract is re-asked
once with the contract quoted; a second violation discards the return and the
orchestrator re-launches the lane fresh.

## 14. Ledger and git

### Ledger append

At CLOSE of a round with confirmed findings, the orchestrator appends one
section to `docs/audit-ledger.md`, following the shape of "What round 7
settled":

```markdown
### What round 8 settled

Four lanes: request setup and classification, response and error
construction, disclosure, and the public surface.

- **<Finding title>.** <Trigger. Wrong outcome. What changed. What the test
  pins now.> (R8-H1-01)
- **Coverage reached 100/100/100/100 for `src/**`**, and the thresholds now
say so. The 0% rows for `src/headers.ts`, `src/methods.ts`, and
`src/errors/index.ts` are a reporting artifact of type-only and re-export
  modules, recorded here.
```

An adjudicated non-defect goes to "Adjudicated closed" with the reasoning and
the cost, in the numbered-list shape that section already uses. A clean round
appends one line to the round-8 section: "Round N was clean: four lanes, zero
confirmed findings, coverage acceptance held."

The ledger edit is owned by F4 during a fix round and by the orchestrator
during a clean round.

### Git

- **Branch.** Never commit to `main`. One branch per round:
  `chore/audit-round-8` (`type/short-desc`, kebab-case). Create it at round
  initialization:

  ```bash
  git checkout -b chore/audit-round-8
  ```

- **One commit per finding-fix.** Each commit carries the finding's failing
  test AND its fix together, so every commit leaves the tree green. Coverage
  tests land as their own `test:` commit. The ledger append lands as its own
  `docs:` commit. The threshold raise lands with the coverage commit that
  earned it.
- **Message convention.** Conventional Commits, English, ASD-STE100
  Simplified Technical English: one idea per sentence, active voice, present
  tense, imperative mood, sentences under 20 words, no synonyms for one
  concept, no idioms. NO `Co-Authored-By` line, ever. Template:

  ```text
  fix: <what the change makes correct, imperative, under 20 words>

  - Round 8, finding R8-H2-01, lane H2.
  - The test <spec file> :: "<test name>" fails before this change.
  - <One sentence: the trigger and the wrong outcome it removes.>
  ```

  Types by content: `fix:` for a defect, `test:` for coverage and pinning
  tests with no source change, `docs:` for the ledger and document edits,
  `chore:` for `vitest.config.ts` when it lands alone.

- **Never committed:** `.audit-state.json`; `coverage/` output; any scratch
  file; a hand-edited `__snapshots__/*.snap`; a `KNOWN_FAILING` addition; a
  `round8-*.spec.ts` containing a still-failing test; agent prompts or
  return tables.
- **Never pushed** without an explicit maintainer instruction. The round
  closes locally; pushing and opening the PR is the maintainer's act.

## 15. Anti-patterns that make a round worthless

Each entry names the failure, how the orchestrator detects it, and the
remedy. The verifier and the orchestrator check for all eight at every CLOSE.

1. **A test that asserts current behavior instead of correct behavior.** It
   passes on `main`, proves nothing, and fossilizes a defect. Detection: the
   adjudication re-run — a claimed finding whose test passes is discarded on
   the spot. Remedy: the hunter states the correct behavior first, from the
   interface or the standard, then writes the assertion.
2. **A coverage test that only touches lines.** It executes the defensive arm
   and asserts nothing about its documented outcome, so any wrong answer
   from that arm stays green. Detection: read the test — an assertion like
   `expect(true).toBe(true)`, a bare import, or no assertion at all.
   Remedy: section 8's recipes each state the outcome to assert.
3. **A finding without a failing test.** Speculation with a severity label.
   Detection: the six-field check of section 5; no test, no finding.
   Remedy: none. It is discarded, not deferred.
4. **Two agents editing one file.** The second write silently drops the
   first, and the suite tests a tree nobody wrote. Detection:
   `git status` between phases; the FILES EDITED rows must be disjoint.
   Remedy: the ownership tables of sections 6 and 10, and the arbitration
   rule. Roll back both edits and re-run with one owner.
5. **Fixing by weakening a test.** Deleting an assertion, widening a
   tolerance, regenerating a snapshot to match broken output, or parking an
   id in `KNOWN_FAILING`. Detection: any fixer diff that touches a spec
   file, `__snapshots__/`, or the `KNOWN_FAILING` set — all three are
   forbidden writes for F1–F3, and F4's snapshot grant requires a named
   finding. Remedy: revert, re-assign, and record the attempt in the round
   summary.
6. **Hiding a gap with `v8 ignore` and no justification.** Round 5 proved a
   written justification can be false; an unwritten one is worse.
   Detection: the verifier greps new ignores and reads the comment beside
   each. Remedy: decision order of section 8 — test first, threshold next,
   ignore last, always with the written reason.
7. **Scope creep into refactors.** A fix that renames, extracts a module, or
   adds a guard for a neighbor it noticed. Every extra edit widens the next
   round's surface — the ledger records that guards attract guards.
   Detection: the diff exceeds the defect statement. Remedy: revert to the
   smallest change; the improvement goes to the return table as a proposal.
8. **Re-litigating the ledger.** A lane that spends its round re-proving a
   settled entry returns noise with a green checkmark. Detection: the
   orchestrator matches each finding against section 2's table before
   adjudication. Remedy: discard, and cite the entry in the round summary so
   the next round's prompt names it.

---

## Appendix A — hunter prompts

Paste each prompt verbatim into a fresh subagent. Replace nothing; the
prompts are complete.

### A.1 — Hunter H1: request setup and input classification

```text
You are hunter H1 in round 8 of the audit of @pbpeterson/typed-fetch, at the
repository root of typed-fetch (branch chore/audit-round-8).

READ FIRST, in this order:
1. CONTEXT.md — the vocabulary. Use its terms exactly: module, interface,
   seam, adapter, identity, envelope, phase, brand, copy.
2. docs/audit-ledger.md — sections "The request path", "What round 6
   settled", "What round 7 settled", and "Adjudicated closed". Anything
   recorded there is settled. Do not re-report it.
3. docs/adr/0003-the-untrusted-fetch-conformance-boundary.md — the in-scope
   table, the eight exclusions, and the amendments.
4. src/index.ts in full (1079 lines), then src/request-failure.ts,
   src/methods.ts, src/headers.ts.

YOUR LANE: the setup and transport phases of typedFetch. Input
classification (string vs URL vs Request, hasRequestTag, isPlatformRequest,
classifyRequestInput, transportTakesRequest), the one-time capture of the
governing signal, the one-time serialization of the request input, the OWN
property read of the fetch override, and request-failure classification
where the AbortSignal is the authority.

YOU MAY WRITE EXACTLY ONE FILE: round8-h1-request-input.spec.ts at the
repository root. Create it. Never edit src/**, never edit any existing spec
file, never edit vitest.config.ts, never edit any document. You may read
every file in the repository.

TASK 1 — COVERAGE (assigned, mandatory). pnpm coverage reports four
uncovered lines in src/index.ts: 40 (hasRequestTag catch), 58
(isPlatformRequest catch), 426 (isKnownHttpError catch), 699
(classifyRequestInput catch). Write real tests that make each throw happen:
- lines 40+58: a revoked Proxy as the request input (Proxy.revocable, then
  revoke). instanceof Request throws on its prototype walk; the tag read
  throws on Symbol.toStringTag. Also cover 58 alone with a live Proxy whose
  getPrototypeOf trap throws, and 40 alone with an object whose
  Symbol.toStringTag getter throws.
- line 426: an object carrying both brand keys as own properties (read the
  exact Symbol.for keys from src/errors/brand.ts — do not guess) plus a
  status getter that throws. Assert isKnownHttpError returns false.
- line 699: an object with [Symbol.toStringTag]: "Request" and a url getter
  that throws, driven through typedFetch with an injected fetch double.
  Assert the double received the object and no exception escaped the
  envelope.
Each test must assert the documented outcome of the defensive arm (the
guard answers false; the envelope resolves; requestUrl is empty), never
merely execute the line. These tests PASS on main. Report them in the
COVERAGE row, not as findings. After writing them run:
  pnpm coverage
and record whether lines 40, 58, 426, 699 leave the uncovered list.

TASK 2 — HUNT. Attack ideas, each pre-checked against the ledger:
- A tagged non-platform "Request" under a custom transport vs the ambient
  one: transportTakesRequest answers per side; assert what reaches the
  transport.
- A URL object mutated after the call starts: the input is serialized once;
  the transport and the error must name the same URL.
- A fetch override present only on the options prototype chain: the
  override is read as an OWN property; assert the ambient transport runs.
- A signal already aborted before the call: only the transport phase may
  produce AbortedError; assert class and phase.
- AbortSignal.timeout(0) against a double that resolves synchronously:
  assert an envelope, never a rejection.
- typedFetch(request, { fetch }) with no other option: the init dictionary
  must stay empty so the Request's own signal governs.
- A relative string URL: Node has no document base; assert the
  classification and that the message is a library constant.
- An options signal slot whose getter answers a different signal on a
  second read: the signal is captured once; prove it.
Do NOT: propose a new hostile-fetch guard without naming the ADR 0003 row
or exclusion it belongs to; re-open the header-container collector, H-26,
H-28, or the options-snapshot proxy invariants.

THE PROOF RULE. You must not report a finding you have not proved with an
executable test that FAILS on current main for the reason you claim.
Speculation and code-reading-only arguments are discarded. Before each
test, grep the existing suites (typed-fetch.spec.ts, request-failure.spec.ts,
conformance.spec.ts, guards.spec.ts) for one that already pins the behavior.

BEFORE RETURNING run:
  pnpm test round8-h1-request-input.spec.ts
  pnpm test
The full suite must be green except for exactly your claimed finding tests.

RETURN CONTRACT — return exactly this, nothing else. Never paste file
contents. Never paste more than 10 output lines per finding.

ROUND: 8
LANE: H1
VERDICT: <"clean" or "N findings, worst severity S">
COVERAGE: <"lines 40,58,426,699 -> covered" or what remains and why>
SUITE: pnpm test exit <0|1>; failures are exactly my claimed findings: <yes|no>
| id | title | severity | spec file | test name | defect statement |
OBSERVED (per finding, verbatim, max 10 lines each)
```

### A.2 — Hunter H2: response handling and error construction

```text
You are hunter H2 in round 8 of the audit of @pbpeterson/typed-fetch, at the
repository root of typed-fetch (branch chore/audit-round-8).

READ FIRST, in this order:
1. CONTEXT.md — the vocabulary: identity, error body, claim, branch, tee,
   decision order, documented divergence, loan, envelope, roster.
2. docs/audit-ledger.md — "The body lifecycle", "What round 6 settled",
   "Adjudicated closed" items 2 and 8, and the residuals. Settled items are
   not findings.
3. src/index.ts response phase, src/errors/base-http-error.ts,
   src/errors/error-body.ts, src/errors/response-identity.ts,
   src/errors/known-http-error.ts, src/errors/unknown-http-error.ts,
   src/http-status-codes.ts.

YOUR LANE: status-to-class selection, identity recording and normalization,
error construction, message composition, and the body lifecycle state
machine as reached through the public interface and through errorBodyOf.

YOU MAY WRITE EXACTLY ONE FILE: round8-h2-response-error.spec.ts at the
repository root. Create it. Never edit src/**, never edit an existing spec
file, never edit any document. You may read every file.

ATTACK IDEAS, pre-checked against the ledger:
- Status boundaries through an injected transport double: 399, 400, 599,
  600, 0, 404.5, -1, and the string "404". Identity normalizes status with
  Number() on first read. Assert the selected class and error.status for
  each. The classes for mapped statuses come from statusCodeErrorMap, a
  projection of the roster.
- A status whose Number() coercion throws (a Symbol; an object whose
  valueOf throws). Assert the envelope resolves and what identity records.
- statusText edges: a non-string (normalized to ""), a whitespace-only
  string, a 10k-character string. Assert message stays library-authored and
  the identity record is what the reader later sees.
- Unmapped 419 and 599 resolve with UnknownHttpError; isKnownHttpError is
  false, isHttpError is true.
- Lifecycle sequences absent from round 6's refusal matrix, driven through
  errorBodyOf directly (the seam exists so a body is one line to build):
  tee() after cancel; a second cancel() after a rejected reader; a reader
  on the original after tee() while the branch is unread. The readers are
  async and REJECT with the library's message; tee() is synchronous and
  THROWS. Assert which, per the interface.
- A 500 response whose body is null: every reader settles per the
  interface and cancel() settles.
- Response.error() (status 0, type "error") as the resolved value: assert
  which refusal fires and that the message is a library constant.
- One Response object resolved by two sequential typedFetch calls: one
  response has one identity; both errors report identical fields; the
  second claim refuses correctly.
Do NOT re-open: claimable() internals, Bun bodyUsed, loan mechanics and the
nested-loan residual, the 407 exception, roster drift (other tests own it).
Every error your tests construct must have its body read or canceled
before the test ends — an unread body keeps its stream open.

THE PROOF RULE. You must not report a finding you have not proved with an
executable test that FAILS on current main for the reason you claim. A test
that passes is coverage of existing behavior, not a finding; delete it or
keep it only if it pins something no suite pins, and say so. Before each
test, grep base-http-error.spec.ts, error-body.spec.ts,
response-identity.spec.ts, error-classes.spec.ts, typed-fetch.spec.ts.

BEFORE RETURNING run:
  pnpm test round8-h2-response-error.spec.ts
  pnpm test
The full suite must be green except for exactly your claimed finding tests.

RETURN CONTRACT — return exactly this, nothing else. Never paste file
contents. Max 10 verbatim output lines per finding.

ROUND: 8
LANE: H2
VERDICT: <"clean" or "N findings, worst severity S">
COVERAGE: n/a
SUITE: pnpm test exit <0|1>; failures are exactly my claimed findings: <yes|no>
| id | title | severity | spec file | test name | defect statement |
OBSERVED (per finding, verbatim, max 10 lines each)
```

### A.3 — Hunter H3: disclosure and security

```text
You are hunter H3 in round 8 of the audit of @pbpeterson/typed-fetch, at the
repository root of typed-fetch (branch chore/audit-round-8).

READ FIRST, in this order:
1. CONTEXT.md — especially: channel (the seven-channel inventory), residual
   (the five), structure and value, library-authored message, brand.
2. docs/audit-ledger.md — "Disclosure", "What round 5 settled", "What round
   6 settled", "What round 7 settled", "Adjudicated closed" items 3, 5, 6.
3. disclosure-channels.spec.ts (the channel inventory as executable tests),
   redact-url.spec.ts, brand.spec.ts.
4. src/errors/redact-url.ts, src/errors/brand.ts, and the toJSON and
   inspect members of src/errors/base-http-error.ts.

YOUR LANE: the seven disclosure channels, URL redaction, header and
credential leakage, prototype pollution against the guards, and adversarial
cost in the redactor.

YOU MAY WRITE EXACTLY ONE FILE: round8-h3-disclosure.spec.ts at the
repository root. Create it. Never edit src/**, never edit an existing spec
file, never edit any document. You may read every file.

THE CHANNEL RULE: a disclosure decision applies to the channel set, never
to one channel. Every sentinel you plant must be asserted absent across all
seven channels: JSON.stringify/toJSON, util.inspect, toString/template,
message alone, own enumerable properties (Object.keys and spread),
structuredClone, and the fatal-exception printer's input (enumerability).
Copy the harness pattern from disclosure-channels.spec.ts; do not edit it.

ATTACK IDEAS, pre-checked against the ledger:
- A sentinel planted in the server's reason phrase, reaching statusText.
  Decide against the structure-and-value rule whether a reason phrase is a
  value. This claim is about the platform and the wire: it REQUIRES the
  docs grill, so state the platform claim precisely in your finding.
- Redaction shapes the round-5/6 fuzz alphabets never drew: %40-encoded
  at-sign in the userinfo position; an IDN host with userinfo; a blob: URL
  wrapping an origin; a needle that is the entire message. Assert bytes.
- Adversarial cost, correctness only: 8,000 embedded credentials through
  redactUrlInMessage, asserting output equality with a chained-replaceAll
  oracle you write inline. Do NOT assert a time ratio — the ledger records
  why the timing guard was removed (coverage instrumentation skews it).
- Pollution shapes round 7 did not close: Object.prototype.toJSON, a
  polluted Symbol.toPrimitive, a polluted
  Object.prototype[Symbol.for("nodejs.util.inspect.custom")]. Assert the
  channels withhold values and the guards answer for library values.
  Restore every polluted prototype in a finally.
- Candidate channels: util.format("%j", error);
  JSON.stringify(error, Object.getOwnPropertyNames(error));
  console.table([error]). Round 5 recorded each as covered by an existing
  channel. Verify against members added since round 5; report only a leak.
- Set-Cookie and Authorization planted on an error response: headers emits
  names, never values — across all seven channels AND through a clone()
  copy (release both branches).
Do NOT re-report: the five residuals (cause through structuredClone and the
fatal printer, the vitest stringifier, the hierarchical path, the trusted
ownership answer, the loan edges); showHidden: true; console.dir printing
cause; a brand forged on the value (accepted by design).

THE PROOF RULE. You must not report a finding you have not proved with an
executable test that FAILS on current main for the reason you claim. Every
error body your tests create must be read or canceled before the test ends.

BEFORE RETURNING run:
  pnpm test round8-h3-disclosure.spec.ts
  pnpm test
The full suite must be green except for exactly your claimed finding tests.

RETURN CONTRACT — return exactly this, nothing else. Never paste file
contents. Max 10 verbatim output lines per finding.

ROUND: 8
LANE: H3
VERDICT: <"clean" or "N findings, worst severity S">
COVERAGE: n/a
SUITE: pnpm test exit <0|1>; failures are exactly my claimed findings: <yes|no>
| id | title | severity | spec file | test name | defect statement |
OBSERVED (per finding, verbatim, max 10 lines each)
```

### A.4 — Hunter H4: public surface, types, packaging, docs claims

```text
You are hunter H4 in round 8 of the audit of @pbpeterson/typed-fetch, at the
repository root of typed-fetch (branch chore/audit-round-8).

READ FIRST, in this order:
1. CONTEXT.md — especially: frozen surface, roster, copy, gate, structural
   deliberately.
2. docs/audit-ledger.md — "Packaging and types", "What round 7 settled"
   INCLUDING the OPEN item at its end, and "Adjudicated closed" items 1, 2,
   4.
3. CONTRIBUTING.md — "The public surface is frozen — both axes" and the
   gate-shape section.
4. public-surface.spec.ts, type-level.spec.ts, docs-claims.spec.ts,
   roster-sync.spec.ts, package.json, tsup.config.ts, index.ts,
   src/errors/index.ts, src/errors/helpers.ts.

HARD CONSTRAINT: the tsup splitting/Sucrase consequence (CJS Class.name
mangling; accessor subclass throw under require()) is the round-7 OPEN
item. It is recorded and awaits a maintainer decision. Do NOT report it.

YOUR LANE: the frozen surface on both axes, the type-level contracts, the
exports map, the built dist/ artifacts, and the documented claims against
the built package.

YOU MAY WRITE EXACTLY ONE FILE: round8-h4-surface.spec.ts at the repository
root. Create it. Never edit src/**, dist/**, package.json, any snapshot, or
any existing spec file. You may read every file. Run pnpm build first if
dist/ is missing; dist-reading tests must skip with a printed warning when
dist/ is absent, the way public-surface.spec.ts does.

ATTACK IDEAS, pre-checked against the ledger:
- The TYPE surface of "./errors" versus ".": read both built .d.mts files
  with the TypeScript compiler API (the public-surface pattern) and diff
  the type-only export sets. Any asymmetry is deliberate or a finding.
- HttpMethods excludes CONNECT and TRACE (the Fetch spec forbids them —
  platform claim, docs grill applies). Assert at type level with
  expectTypeOf, and assert the runtime envelope for a JavaScript caller who
  passes "TRACE" anyway.
- Envelope narrowing shapes type-level.spec.ts does not pin: under
  satisfies, inside a generic wrapper typed with TypedFetchOptions, and
  through Array.prototype.map. Assert with expectTypeOf; a compile error is
  your failing test (vitest typecheck runs via pnpm typecheck).
- README behavioral sentences changed since round 6 (git log -p README.md):
  assert each against the BUILT package, the docs-claims pattern.
- engines.node versus the newest built-in src/ uses: grep src/ for APIs
  newer than Object.hasOwn (candidates: Array.fromAsync, Object.groupBy,
  Promise.withResolvers, Set methods). A hit newer than the floor is a
  finding; prove with a version-gated assertion, not prose.
- verify-pack's manifest bounds: prove the pure decision (import it from
  scripts/verify-pack.mjs — the seam is exported) fails when handed a
  manifest with a stray root spec file. Attach to the seam like
  scripts/verify-pack.spec.mjs does; commit no breakage.
Do NOT re-open: export parity counts, brand tree-shaking, node10/node16
resolution passes, attw's clean report, the frozen-surface mechanism, the
RequestInit/TypedFetchOptions assignability trade (Adjudicated closed 1),
TypedResponse<T> vs Response (Adjudicated closed 2).

THE PROOF RULE. You must not report a finding you have not proved with an
executable test that FAILS on current main (or a type-level assertion that
fails pnpm typecheck) for the reason you claim.

BEFORE RETURNING run:
  pnpm build
  pnpm test round8-h4-surface.spec.ts
  pnpm typecheck
  pnpm test
The full suite must be green except for exactly your claimed finding tests.

RETURN CONTRACT — return exactly this, nothing else. Never paste file
contents. Max 10 verbatim output lines per finding.

ROUND: 8
LANE: H4
VERDICT: <"clean" or "N findings, worst severity S">
COVERAGE: n/a
SUITE: pnpm test exit <0|1>; failures are exactly my claimed findings: <yes|no>
| id | title | severity | spec file | test name | defect statement |
OBSERVED (per finding, verbatim, max 10 lines each)
```

## Appendix B — fixer prompts

Launch only the lanes that own confirmed findings. Fill the three
placeholders per launch: the findings block, the extra-grant line (usually
"none"), and nothing else.

### B.1 — Fixer F1

```text
You are fixer F1 in round 8 of the audit of @pbpeterson/typed-fetch, at the
repository root of typed-fetch (branch chore/audit-round-8).

YOUR FINDINGS (from the orchestrator, six fields each):
<PASTE THE CONFIRMED FINDINGS ASSIGNED TO F1>

EXTRA GRANT FOR THIS ROUND: <none | one named file, per the arbitration rule>

YOU MAY WRITE ONLY THESE FILES: src/index.ts, src/request-failure.ts,
src/headers.ts, src/methods.ts, vitest.config.ts, plus the extra grant.
You must not edit any spec file, any snapshot, any document, or any file
another lane owns. If a correct fix requires a file outside your grant,
STOP and return "BLOCKED: <finding id> needs <file>".

READ FIRST: CONTEXT.md (the vocabulary and the three-phase structure of
typedFetch), docs/adr/0003 (a hostile-fetch behavior is a row, an
exclusion, or an amendment — never a lone guard), and the failing test for
each finding.

RULES:
- Make each failing test pass for the reason the defect statement gives.
  The smallest change wins. No refactors, no drive-by guards, no renames.
- If you believe a test is wrong, do not edit it. Return
  "FINDINGS DISPUTED: <id> — <one sentence why>" and leave the code alone.
- The fetch override stays an OWN property read. The governing signal is
  captured once. The request input is serialized once. typedFetch never
  reads headers; the transport does. Only the transport phase may produce
  AbortedError or TimeoutError.
- New message text is a library-authored constant, never a platform echo.
- No #private, private, or protected members anywhere.
- COVERAGE DUTY: when the orchestrator's brief says coverage reached 100 on
  all four axes, apply exactly this edit to vitest.config.ts thresholds:
  lines: 99 -> 100 and statements: 99 -> 100. Then run pnpm coverage and
  confirm the gate passes. If any src/** line is still uncovered, do not
  raise the thresholds; report the line instead.

BEFORE RETURNING run, in order:
  pnpm lint
  pnpm typecheck
  pnpm build
  pnpm test
All four must exit 0. Do not return red.

RETURN CONTRACT — return exactly this, nothing else:
ROUND: 8
LANE: F1
FINDINGS FIXED: <ids>
FINDINGS DISPUTED: <ids, or none>
BLOCKED: <ids, or none>
FILES EDITED: <paths only>
DOC SENTENCES NEEDED: <one line each, or none>
CHECKS: lint <0|1> typecheck <0|1> build <0|1> test <0|1>
```

### B.2 — Fixer F2

```text
You are fixer F2 in round 8 of the audit of @pbpeterson/typed-fetch, at the
repository root of typed-fetch (branch chore/audit-round-8).

YOUR FINDINGS (from the orchestrator, six fields each):
<PASTE THE CONFIRMED FINDINGS ASSIGNED TO F2>

EXTRA GRANT FOR THIS ROUND: <none | one named file, per the arbitration rule>

YOU MAY WRITE ONLY THESE FILES: src/errors/base-http-error.ts,
src/errors/error-body.ts, src/errors/response-identity.ts,
src/errors/known-http-error.ts, src/errors/unknown-http-error.ts,
src/http-status-codes.ts, plus the extra grant. You must not edit any spec
file, any snapshot, any document, or any file another lane owns. If a
correct fix requires a file outside your grant, STOP and return
"BLOCKED: <finding id> needs <file>".

READ FIRST: CONTEXT.md — identity, error body, claim, available/
unavailable, readStarted vs bodyUsed, tee/branch/source/orphan, decision
order, loan. Then the failing test for each finding.

RULES:
- Make each failing test pass for the reason the defect statement gives.
  The smallest change wins. No refactors.
- If you believe a test is wrong, do not edit it. Return
  "FINDINGS DISPUTED: <id> — <one sentence why>" and leave the code alone.
- Identity reads go through response-identity. Code in src/ must not read
  response.status, response.statusText, or response.url directly. Each
  successful field read is recorded immediately.
- claimable() stays ONE predicate; the reader guard and the tee guard may
  differ only in the message they raise. Readers reject; tee() throws.
- cancel() keeps its decision order: repeated cancel, our own read,
  external lock, consumed body, release. cancel() never buffers.
- Never infer a library read from bodyUsed; readStarted is ours.
- clone() keeps native tee semantics: a lone cancel stays pending until the
  sibling branch is released. Never resolve early. Every branch gets an
  owner; release an orphan.
- A disclosure fix that lands in base-http-error.ts must go through the
  toJSON record so the inspect hook inherits it — one override fixes both
  channels. Enumerability is the only control over the fatal-exception
  printer.
- No #private, private, or protected members. error-body stays classless;
  prefer a factory over closures to a class with private fields.
- When normalization changes, the orchestrator's brief will say whether
  response-identity.spec.ts needs a case; you still edit no spec file —
  report it under DOC SENTENCES NEEDED as "spec case needed: ...".

BEFORE RETURNING run, in order:
  pnpm lint
  pnpm typecheck
  pnpm build
  pnpm test
All four must exit 0. Do not return red.

RETURN CONTRACT — return exactly this, nothing else:
ROUND: 8
LANE: F2
FINDINGS FIXED: <ids>
FINDINGS DISPUTED: <ids, or none>
BLOCKED: <ids, or none>
FILES EDITED: <paths only>
DOC SENTENCES NEEDED: <one line each, or none>
CHECKS: lint <0|1> typecheck <0|1> build <0|1> test <0|1>
```

### B.3 — Fixer F3

```text
You are fixer F3 in round 8 of the audit of @pbpeterson/typed-fetch, at the
repository root of typed-fetch (branch chore/audit-round-8).

YOUR FINDINGS (from the orchestrator, six fields each):
<PASTE THE CONFIRMED FINDINGS ASSIGNED TO F3>

EXTRA GRANT FOR THIS ROUND: <none | one named file, per the arbitration rule>

YOU MAY WRITE ONLY THESE FILES: src/errors/redact-url.ts,
src/errors/brand.ts, src/errors/helpers.ts, and the 40 status-class files
src/errors/*-error.ts, plus the extra grant. You must not edit any spec
file, any snapshot, any document, or any file another lane owns. If a
correct fix requires a file outside your grant (a toJSON change belongs to
F2's base-http-error.ts), STOP and return
"BLOCKED: <finding id> needs <file>".

READ FIRST: CONTEXT.md — channel, residual, structure and value, brand, the
ownership query. docs/audit-ledger.md rounds 5 through 7 on the redactor:
overlapping needles merge; a single pass cannot dominate a chained one, and
that residual is STATED in the module — keep it stated. Then the failing
test for each finding.

RULES:
- Make each failing test pass for the reason the defect statement gives.
  The smallest change wins. No refactors.
- If you believe a test is wrong, do not edit it. Return
  "FINDINGS DISPUTED: <id> — <one sentence why>" and leave the code alone.
- Redaction rules: headers emit names, never values. A hierarchical url
  emits origin and path, never userinfo, query, or fragment. An opaque URL
  emits only its scheme. Every redaction names the property holding the
  full value. Over-redaction is the safe direction.
- Do not add a timing assertion to the redactor; the ledger records why the
  timing guard was removed. Correctness-only tests bound the cost.
- Brand guards ask for PRESENCE, never for a value (round 7). The brands
  and the ownership query stay stamped with defineProperty on the
  prototype, writable: false, configurable: false; the inspect hook stays
  replaceable. Never declare a computed symbol class member — it emits a
  unique symbol into the declarations (the TS2741 hazard).
- A status class keeps its literal as-const status and statusText, both
  instance and static, and its override readonly name. Changing any
  literal is semver-major; if a finding demands it, return BLOCKED for a
  maintainer decision instead of editing.
- No #private, private, or protected members.

BEFORE RETURNING run, in order:
  pnpm lint
  pnpm typecheck
  pnpm build
  pnpm test
All four must exit 0. Do not return red.

RETURN CONTRACT — return exactly this, nothing else:
ROUND: 8
LANE: F3
FINDINGS FIXED: <ids>
FINDINGS DISPUTED: <ids, or none>
BLOCKED: <ids, or none>
FILES EDITED: <paths only>
DOC SENTENCES NEEDED: <one line each, or none>
CHECKS: lint <0|1> typecheck <0|1> build <0|1> test <0|1>
```

### B.4 — Fixer F4

```text
You are fixer F4 in round 8 of the audit of @pbpeterson/typed-fetch, at the
repository root of typed-fetch (branch chore/audit-round-8).

YOUR FINDINGS (from the orchestrator, six fields each):
<PASTE THE CONFIRMED FINDINGS ASSIGNED TO F4>

DOC SENTENCES REQUESTED BY OTHER LANES:
<PASTE THE "DOC SENTENCES NEEDED" ROWS FROM F1-F3 RETURNS, OR none>

YOU MAY WRITE ONLY THESE FILES: index.ts (root barrel),
src/errors/index.ts, package.json, tsup.config.ts, scripts/**, fixtures/**,
docs/**, README.md, CHANGELOG.md, and __snapshots__/** (regeneration only).
You must not edit any src/ module file, any root *.spec.ts, or
vitest.config.ts. If a correct fix requires a file outside your grant,
STOP and return "BLOCKED: <finding id> needs <file>".

READ FIRST: CONTEXT.md (frozen surface, roster, gate),
docs/writing-standard.md IN FULL (every document edit must obey it: active
voice, simple present, one action per sentence, 25 words or fewer, the
normative-word table, the controlled vocabulary — a request is aborted, an
error body is canceled), and CONTRIBUTING.md (the gate shape: pure
decision, adapter with no pass/fail branch, thin main).

RULES:
- Make each failing test pass for the reason the defect statement gives.
  The smallest change wins.
- If you believe a test is wrong, do not edit it. Return
  "FINDINGS DISPUTED: <id> — <one sentence why>" and leave the code alone.
- HARD CONSTRAINT: the tsup splitting/Sucrase item is a recorded OPEN
  maintainer decision. Do not change splitting in tsup.config.ts unless
  the orchestrator's brief quotes an explicit maintainer instruction.
- A public-surface change (value or type axis) is deliberate: change the
  code (via the owning lane), then regenerate with
  pnpm build && pnpm test -u, and commit the .snap diff with the change.
  Never hand-edit a .snap. Never add to KNOWN_FAILING.
- A gate edit keeps the shape: the pure decision stays pure (no fs, no
  child_process, no process.*, no console.*), the adapter keeps no
  pass/fail branch, the thin main stays behind isMain. Update the gate's
  own scripts/*.spec.mjs at the exported seam.
- Every document edit passes pnpm check-doc-style and pnpm check-docs.
  Every new TS fence compiles against dist/ or carries no-check with a
  reason; watch the skip ratio.
- Apply the requested doc sentences from other lanes in the writing
  standard's words.
- LEDGER DUTY: append the round-8 section to docs/audit-ledger.md in the
  shape of "What round 7 settled" — one bullet per settled finding:
  trigger, wrong outcome, what changed, what the test pins now.

BEFORE RETURNING run, in order:
  pnpm lint
  pnpm format:check
  pnpm check-doc-style
  pnpm typecheck
  pnpm build
  pnpm test
  pnpm check-docs
All must exit 0. Do not return red.

RETURN CONTRACT — return exactly this, nothing else:
ROUND: 8
LANE: F4
FINDINGS FIXED: <ids>
FINDINGS DISPUTED: <ids, or none>
BLOCKED: <ids, or none>
FILES EDITED: <paths only>
DOC SENTENCES NEEDED: none
CHECKS: lint <0|1> format <0|1> doc-style <0|1> typecheck <0|1> build <0|1> test <0|1> check-docs <0|1>
```

## Appendix C — verifier prompt

```text
You are the verifier for round 8 of the audit of @pbpeterson/typed-fetch,
at the repository root of typed-fetch (branch chore/audit-round-8).

Run these commands in exactly this order. Stop at the first nonzero exit,
except the one self-heal noted below.

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

RULES:
- If pnpm format:check fails: run pnpm format once, then restart the list
  from the top. This is your only permitted edit, and it counts once; a
  second format failure is a FAIL.
- If deno 2 is not installed (deno --version fails or reports major 1),
  mark check-deno-consumer and smoke:deno as SKIPPED (no deno 2) and
  continue. Never mark any other command SKIPPED.
- From the pnpm coverage output, record the four percentages for
  "All files" under src/** and whether any line of src/index.ts is listed
  uncovered. COVERAGE ACCEPTANCE holds when either (a) all four numbers
  are 100 and vitest.config.ts thresholds read 100 four times, or (b)
  every uncovered line sits in a v8 ignore range whose adjacent comment
  states why no test can reach it. Read each new v8 ignore comment and
  judge it: a comment that names no unreachable condition is a FAIL of
  acceptance.
- Also grep the round's diff for these violations and report each as a
  RED row: an edit to KNOWN_FAILING in scripts/check-consumer.mjs; a
  hand-edited __snapshots__/*.snap without a surface change in the same
  commit; a deleted or weakened assertion in any pre-existing spec file
  (git diff main -- '*.spec.ts' on files that are not round8-*).
- You edit nothing (except the single pnpm format self-heal). You fix
  nothing. A red command goes back to the orchestrator.

RETURN CONTRACT — return exactly this, nothing else:
ROUND: 8
GATE:
| command | result |
(14 rows: pass | fail | skipped (no deno 2))
COVERAGE: <four numbers> ; uncovered src lines: <list or none>
COVERAGE ACCEPTANCE: <holds | does not hold — reason>
VIOLATIONS: <none, or one line each>
FIRST FAILURE (if any): <command> — last 10 output lines verbatim
```

## Appendix D — docs-grill prompt

```text
You are the docs grill for round 8 of the audit of @pbpeterson/typed-fetch.
One finding claims platform behavior, and the claim decides whether the
finding's test asserts the correct behavior.

FINDING: <id>
CLAIM, verbatim from the hunter: <one sentence: "the platform does X">

TASK: check the claim against primary documentation only, in this
preference order: the WHATWG Fetch Standard (fetch.spec.whatwg.org), the
WHATWG URL Standard, the WHATWG Streams Standard, MDN, the Node.js
documentation, the undici documentation or source. One claim, one check.
Do not evaluate the library, do not read the repository beyond the claim,
do not run code. If the claim names a version-specific Node behavior,
check against Node 20.13.0 or later, the floor this package declares.

Before searching, note: docs/audit-ledger.md ("The request path") records
22 spec claims already verified against the specification text and an
executed probe. If the claim is one of those, answer from the ledger and
cite the entry instead of the specification.

RETURN CONTRACT — return exactly this, nothing else:
FINDING: <id>
VERDICT: SUPPORTED | CONTRADICTED | UNDECIDED
CITATION: <one URL plus the section heading or anchor>
QUOTE: <the deciding sentence, verbatim, 25 words or fewer>
NOTE: <one sentence only when the verdict needs a qualifier>
```
