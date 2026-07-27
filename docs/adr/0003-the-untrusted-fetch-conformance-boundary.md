# 0003 — The untrusted-`fetch` conformance boundary

- **Status:** Accepted
- **Date:** 2026-07-27

## Context

`typedFetch` takes a `fetch` option and documents it as a seam a consumer is
invited to use. That makes four things untrusted input: the value the
implementation resolves, the value it rejects with, the governing
`AbortSignal`, and the options object itself. Each can come from another realm,
a polyfill, a test double, or an outright hostile object.

The library has defended against that for a long time. What it has never had is
a statement of **how far the distrust goes**.

### An undecided boundary generates findings forever

This is not a theoretical concern. It is the measured behavior of this
repository.

Between 2026-07-09 and 2026-07-26, 139 non-merge commits landed. Classified by
reading their bodies, 24 of them — 17% — are this one shape: a review proposed a
new "what if the injected implementation also did X", and the library grew a
defense for it. There was no rule that could answer any of those proposals with
"that is out of scope", because no rule existed.

The cost compounds, because each defense is new surface for the next round:

| commit    | `src/` lines deleted | authored under 7 days earlier |
| --------- | -------------------- | ----------------------------- |
| `4d96013` | 120                  | 111 (92%)                     |
| `3b51e69` | 21                   | 21 (100%)                     |
| `9f603f0` | 111                  | 110 (99%)                     |
| `2f53b40` | 53                   | 42 (79%)                      |

`src/errors/response-identity.ts` is the clearest case. It was created by
`2f53b40` to make the identity reads happen once, and every commit since has
rewritten part of it. A module that exists to close a hostile-input hole became
the place the next hostile-input hole was found.

An adversary with no stated limit is not a threat model. It is a generator.

### What a boundary must be to hold

A prose boundary would not survive. Two of this repository's documents already
carry real decisions in a form nobody treats as binding, and a reviewer who
finds one stale claim discounts the rest of the file. A boundary that lives only
in prose is a boundary that drifts.

So the decision below has an executable half, and the two are bound together by
a test.

## Decision

**The rows in the in-scope table are the whole of what this library defends
against in an injected `fetch`. Everything in the out-of-scope section is
permanently out, and adding a row is an amendment to this ADR, never a code
change on its own.**

Each row names a behavior an implementation can exhibit and what the caller
gets. Every row is driven end to end by `fixtures/hostile-fetch.ts`, and
`conformance.spec.ts` asserts that the rows here and the scenarios there are the
same set, with the same titles. A scenario with no row fails. A row with no
scenario fails.

### In scope

| Row  | The implementation's behavior                                             | What the caller gets           |
| ---- | ------------------------------------------------------------------------- | ------------------------------ |
| H-01 | The implementation resolves a value that is not an object                 | `NetworkError`                 |
| H-02 | The implementation resolves an object that only spoofs the Response tag   | `NetworkError`                 |
| H-03 | The implementation resolves a Response missing a body reader              | `NetworkError`                 |
| H-04 | The implementation resolves a Response whose body is not a stream         | `NetworkError`                 |
| H-05 | The implementation resolves a Response whose bodyUsed is not a boolean    | `NetworkError`                 |
| H-06 | A status getter answers differently on a second read                      | the dedicated HTTP error class |
| H-07 | A status getter throws                                                    | `NetworkError`                 |
| H-08 | A status that compares below 400, including NaN, is still a success       | the response, unchanged        |
| H-09 | A status outside the roster becomes UnknownHttpError, not a guess         | `UnknownHttpError`             |
| H-10 | A fractional status is not truncated into a real one                      | `UnknownHttpError`             |
| H-11 | A statusText that is not a string is normalized, never coerced            | the dedicated HTTP error class |
| H-12 | A url that is not a string is normalized, never coerced                   | the dedicated HTTP error class |
| H-13 | A headers getter throws                                                   | `NetworkError`                 |
| H-14 | A value refused once has no identity filed against it                     | `NetworkError`                 |
| H-15 | The implementation rejects with a value that is not an error              | `NetworkError`                 |
| H-16 | The implementation throws before it returns a promise                     | `NetworkError`                 |
| H-17 | The governing signal is the authority on an abort, not the rejection name | `AbortedError`                 |
| H-18 | An unrelated failure while the signal is aborted stays a network failure  | `NetworkError`                 |
| H-19 | A timeout is classified by the shape the platform produces                | `TimeoutError`                 |
| H-20 | A polyfill that rejects with its own AbortError, not the signal reason    | `AbortedError`                 |
| H-21 | An options object whose property read throws                              | `NetworkError`                 |
| H-22 | A fetch override inherited from a polluted prototype is never used        | `NetworkError`                 |
| H-23 | A Request-shaped input whose url is not a string                          | `NetworkError`                 |
| H-24 | A header value the platform refuses never reaches the message             | `NetworkError`                 |

Two decisions about a hostile implementation live in their own records and are
in scope by reference, not repeated here:

- A `clone()` copy that cannot confirm it took the teed branch is refused —
  [ADR 0002](./0002-refuse-a-clone-copy-that-cannot-confirm-the-branch.md).
- The disclosure channels an error's data can reach a reader through are
  enumerated in `disclosure-channels.spec.ts`, and a decision about one applies
  to the set.

### Out of scope, permanently

These are not gaps, and a report that the library does not handle one is not a
defect. Each is here because it cannot be closed, or because closing it would
cost more than the failure it prevents.

1. **An implementation that lies consistently.** A `Response` reporting `200`
   while its body carries an error page is indistinguishable from a real server
   doing the same thing. This library reports what the response says. Deciding
   whether the response is telling the truth is the caller's job, and no amount
   of structural checking substitutes for it.

2. **Body content.** `json()`, `text()`, `arrayBuffer()`, `blob()`, and
   `formData()` return whatever the implementation returns. The library never
   inspects a payload, and `JsonReturnType` is a compile-time claim with no
   runtime validation. This is stated in the README already; it is repeated here
   because "the injected implementation returned attacker-controlled JSON" is
   otherwise a report someone will file.

3. **Anything after the handoff.** The success-surface check is a check, not a
   membrane. `typedFetch` returns the same object it validated, so an
   implementation whose getters answer differently after the return answers
   differently to the caller. Wrapping the response in a proxy would change the
   object identity a consumer gets back, break `instanceof Response`, and add a
   layer to every property read on the hot path.

4. **Timing and resource exhaustion.** A getter that blocks, a stream that never
   ends, a promise that never settles, and a response large enough to exhaust
   memory are all outside this boundary. The library adds no timeout of its own:
   `AbortSignal.timeout()` is the caller's tool, and it composes.

5. **Forged brands and forged platform tags.** `Symbol.for` brands are readable
   and writable by anyone in the process, and `Object.prototype.toString` reads a
   `Symbol.toStringTag` a hostile object can set. Both are load-bearing on
   purpose: they are what makes recognition work across package copies and
   across realms, where `instanceof` cannot. A mechanism that cannot tell a real
   foreign copy from a forged one is the same mechanism that accepts the real
   foreign copy.

6. **A consumer subclass that breaks its own invariants.** `BaseHttpError` is
   structurally typed with no `#private` field, deliberately, so a subclass can
   do anything a subclass can do.

7. **The values the error deliberately keeps.** `error.url` holds the full href
   and `error.headers` holds every header value. They are non-enumerable escape
   hatches, and the redacted forms are what reach `message` and the `toJSON()`
   record. A report that `error.url` contains a query token is a report about a
   documented feature.

8. **A platform message that echoes a value the platform ACCEPTED.** H-24 covers
   the values a platform must refuse, which is the only way a header value
   reaches a rejection message on any runtime this library targets. A runtime
   that quotes an accepted value back in some other message is not covered, and
   neither are the enum-valued init slots (`mode`, `credentials`, `cache`,
   `redirect`), which echo the caller's own string but can only hold a program
   constant.

## Consequences

### What this costs

The boundary is a commitment, so a genuine new attack shape is now a two-step
change rather than a one-step one: amend this ADR, then add the scenario. That
is the intended friction. A defense worth adding is worth writing down, and the
step that was missing is the one that says what the library will not do.

The out-of-scope list will look complacent to a reviewer reading it for the
first time. Items 1, 2, and 3 in particular describe real ways a hostile
implementation can mislead a caller. They are out of scope because the caller —
who chose to inject the implementation — is the only party who can judge them.

### Explicitly _not_ claimed

- This is **not** a security boundary against a hostile implementation the
  caller did not choose. A consumer who injects a `fetch` has handed it the
  whole request, including credentials. The defenses here keep a broken or
  malicious implementation from corrupting **this library's** contract — the
  envelope never rejects, the identity is read once, a body is never stranded —
  not from betraying the caller.
- This does **not** claim the in-scope list is exhaustive of everything a
  hostile implementation can do. It claims the list is exhaustive of what this
  library **answers for**.
- No row promises a specific `message` string. Message text is outside the
  semver contract (`RELEASING.md`, rule 2), and the conformance suite asserts
  classes and fields, never wording.

### Not evaluated here

- Whether `typedFetch` should validate response bodies against a schema. That is
  a feature question, and a different one.
- Whether the success surface should become a membrane. Item 3 records the
  refusal and its reasons, but the cost was estimated rather than measured, and
  a serious proposal should measure it.
- The `fetch` seam's ergonomics. This record is about what crosses it, not about
  what it looks like.

## What would change our mind

Any one of these should reopen the boundary. Nothing else should.

1. **A row's defense is shown to be reachable in a way the row does not
   describe.** That is a defect in the row, not in the boundary. Fix the
   scenario, keep the row.
2. **A shape appears that is neither in the table nor covered by an out-of-scope
   item.** The table is then incomplete: propose the row, with the scenario that
   fails without it.
3. **An out-of-scope item stops being unclosable.** Item 3 is the likeliest: if
   the platform gains a way to hand back a validated view of a response without
   changing its identity, the argument against a membrane loses its cost.
4. **A runtime this library targets echoes an ACCEPTED header value in a
   rejection message.** Item 8 assumes refusal is the only path. Evidence
   against that assumption reopens H-24's bound, not the whole boundary.
5. **The conformance suite stops being the executable half.** If the rows here
   and the scenarios there ever disagree without the suite failing, the binding
   is broken, and this record has degraded into the prose it was written to
   avoid.
