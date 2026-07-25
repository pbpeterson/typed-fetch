# Architecture Decision Records

This directory holds the architecture decision records (ADRs) for
`@pbpeterson/typed-fetch`. An ADR captures one decision, the context that
forced it, and the consequences the project accepted by taking it — so that a
future reader (or a future reviewer proposing the opposite) can see the
reasoning without re-deriving it.

Write an ADR when a decision is **structural and likely to be re-litigated**:
something a reasonable contributor would propose changing, where the reasons
against it are not visible from the code alone.

## File naming

```
NNNN-kebab-case-title.md
```

- `NNNN` is a **zero-padded 4-digit** number: `0001`, `0002`, … `0042`.
- Numbers are **monotonic** — each new ADR takes the next unused number.
- Numbers are **never reused and never renumbered**. A number, once spent,
  belongs to that ADR permanently, even if the ADR is later superseded or
  deprecated. Links to `0001-…` from commit messages, code comments, and
  review threads must never silently start pointing at a different decision.
- The title slug is lowercase, kebab-case, and describes the decision, not the
  question (`keep-the-http-error-roster-hand-written`, not
  `should-we-generate-errors`).

## Header fields

Every ADR opens with a short field block:

- **Status** — exactly one of:
  - `Proposed` — written, not yet agreed.
  - `Accepted` — in force. This is the decision the codebase follows.
  - `Superseded` — replaced by a later ADR. Must carry `Superseded by`.
  - `Deprecated` — no longer relevant (the thing it decided about is gone),
    but not replaced by a specific successor.
- **Date** — ISO `YYYY-MM-DD` of the status shown.
- **Supersedes** — the ADR(s) this one replaces, if any.
- **Superseded by** — the ADR that replaced this one, if any.

## Changing a decision

**Never edit the original ADR's Context, Decision, or Consequences to reflect a
new decision, and never renumber it.** The record of what was decided, and on
what evidence, is the point of the file. Instead:

1. Write a **new** ADR with the next number, stating the new decision and why
   the old evidence no longer holds.
2. Add `Supersedes: NNNN-…` to the new ADR.
3. In the old ADR, change `Status` to `Superseded` and add
   `Superseded by: NNNN-…`.

Those two header edits are the only permitted changes to a superseded ADR's
content. Correcting a typo or a broken link is fine; rewriting the argument is
not.

## Index

| ADR                                                       | Title                                   | Status   |
| --------------------------------------------------------- | --------------------------------------- | -------- |
| [0001](./0001-keep-the-http-error-roster-hand-written.md) | Keep the HTTP error roster hand-written | Accepted |
