# Writing standard

This document defines how to write the documentation in this repository.

The style is inspired by aviation maintenance manuals. Those manuals are read
under pressure, by people who work in a second or third language. This package
has readers in the same position.

The direct English is intentional. A restricted vocabulary and repeated terms
help international readers reach the same meaning.

NOTE: This document does not claim conformance with ASD-STE100 or any other
formal standard. It borrows the ideas only.

Apply this standard to `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`,
`CONTEXT.md`, `RELEASING.md`, both `SKILL.md` files, the files under `docs/`,
and every public JSDoc comment in `src/`.

An accepted ADR keeps the original Context, Decision, and Consequences as a
historical record. Do not rewrite those sections for rules adopted later.
Apply the current standard to amendments.

Public JSDoc attaches to an exported declaration or a public member. This scope
excludes a declaration marked `@internal` and all its members.

Two limits on that scope:

- A code identifier keeps the spelling the code uses, even when the code
  disagrees with this standard. `` `cancelled` `` names a variable in
  `src/errors/error-body.ts`; the prose around it says "canceled".
- A runtime message string is program output, not documentation. Editing one
  changes program output and the tests that assert on it, so it does not belong
  in a documentation change. It is not forbidden: `README.md` states that
  `error.message` text can change in any release. Land it as its own patch.

`README.md` is the only document in the npm tarball. A link from it to any
other repository file must be an absolute URL, or a reader who opens it from
`node_modules` follows a dead link.

## Purpose

The documentation must let a reader find a procedure, apply it, and know what
happens next. It must not ask the reader to infer a rule from an example.

## Compatibility facts

Machine-readable files are the sources for compatibility facts. `package.json`
is the source for the current Node.js floor.

Write all three version components in current compatibility prose. For a range
of `>=X.Y.Z`, write "Node.js X.Y.Z or later" in reader instructions.

Do not shorten the value to the major version. A minor version can be required
for correct behavior.

`pnpm check-doc-style` compares current operational documents with this field.

Historical release records keep the compatibility statement that applied to
that release.

## Language rules

- Use American English.
- Use the active voice. Write "the guard rejects a value", not "a value is
  rejected".
- Use the simple present tense. Write "the promise rejects", not "the promise
  will reject".
- Put the condition before the action when the condition is necessary. Write
  "If the body is not needed, cancel it", not "Cancel the body if it is not
  needed".
- Use one main action per sentence.
- Keep sentences to 25 words or fewer.
- Write code identifiers exactly as the API spells them. `typedFetch`, not
  `typedFetch()` in prose, and never `TypedFetch`.
- Do not use idioms, metaphors, or figures of speech.
- Do not use these words: `simply`, `just`, `easy`, `obvious`, `clearly`.
- Do not use a synonym for variety when a defined term exists. Repetition is
  correct here.
- Explain a technical term at its first use in each document.

## Normative words

Use these five words with these meanings, and no others for the same job.

| Word     | Meaning                                                      |
| -------- | ------------------------------------------------------------ |
| must     | A requirement for correct use. Ignoring it causes a defect.  |
| must not | A forbidden operation.                                       |
| should   | A strong recommendation.                                     |
| can      | A capability or a possibility.                               |
| may      | Permitted behavior, or behavior that depends on the runtime. |

Do not write "need to", "have to", or "it is recommended". Use the table.

## Controlled vocabulary

Use these terms exactly. Each names one thing.

| Term                  | Meaning                                                                                                                                |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| resolves with         | A promise finishes normally and supplies a value.                                                                                      |
| rejects               | A promise finishes with an error.                                                                                                      |
| throws                | A synchronous operation raises an exception.                                                                                           |
| abort the request     | An `AbortSignal` stops a request.                                                                                                      |
| cancel the error body | `error.cancel()` releases the body of an HTTP error.                                                                                   |
| read the error body   | `json()`, `text()`, `blob()`, or `arrayBuffer()` consumes the body.                                                                    |
| known HTTP error      | A status code that has a dedicated error class.                                                                                        |
| unknown HTTP error    | A status code of 400 or more with no dedicated class.                                                                                  |
| package copy          | One loaded instance of this package in a process.                                                                                      |
| reason phrase         | The status text that the server sends on the wire. It can differ from the library's `statusText`.                                      |
| error record          | The plain object that `error.toJSON()` returns. `JSON.stringify(error)` writes it, and `console.log(error)` prints it below the stack. |

Two rules follow from that table, and both are load-bearing:

- Do not write "cancel the request". A request is aborted. A body is canceled.
- Do not write "stop the request" or "the request was canceled" for an abort.

`typedFetch` never rejects for a request failure, so never describe a request
failure with "throws" or "rejects". It **resolves with** an error value. Body
readers are separate operations, and they do reject.

The Terms table in `README.md` mirrors this table. It carries the same terms in
the same order, and each meaning begins with the meaning above. A README
meaning can append one package-specific sentence. `pnpm check-doc-style`
enforces the relation.

This document is the one place where a forbidden phrase can be written down, so
`pnpm check-doc-style` does not scan it for vocabulary violations. Every other
document in the scope above is scanned.

## Markers

Use three markers, and use them rarely. A page of warnings has no warnings.

| Marker  | Use when                                                             |
| ------- | -------------------------------------------------------------------- |
| WARNING | Ignoring the instruction can cause an error or keep a resource open. |
| CAUTION | The operation has an important consequence.                          |
| NOTE    | Supplementary information.                                           |

Write the marker in capitals, followed by a colon. State the consequence, not
the feeling:

> WARNING: Read or cancel every HTTP error body. An unread body can keep its
> connection open.

Do not write "WARNING: be careful here".

## Procedure structure

Use this shape for anything a reader performs. Omit a heading that has no
content.

- **Purpose** — what the procedure achieves.
- **Condition** — what must be true before the reader starts.
- **Action** — the steps, in order.
- **Result** — the observable outcome.
- **Warning / Caution / Note** — placed immediately before the step it governs.

## Examples

Every TypeScript example for the current API must compile. `pnpm check-docs`
compiles each current fenced block against the built package in `dist/`.

A `historical` block in `CHANGELOG.md` records an API that no longer exists.
It is archival evidence, not current usage guidance. It is exempt from
compilation and body-ownership rules because the current package cannot execute
it.

Every current example that obtains an HTTP error must do one of three things
with the body:

1. read it, with `json()`, `text()`, `blob()`, or `arrayBuffer()`;
2. cancel it, with `await error.cancel()`;
3. transfer it, by returning the error to a caller — and the surrounding text
   must say that the caller now owns the body.

An example that does none of these teaches a resource leak.

Two further rules:

- Call `clone()` before the first body read. Release every branch a `clone()`
  creates.
- Do not wrap `typedFetch` in `try`/`catch` to handle a request failure. It
  resolves with the failure. A body read can use `try`/`catch`.

Mark a deliberately partial example with the `no-check` marker on its fence,
and state in the surrounding text who owns the body. Prefer a complete example.
