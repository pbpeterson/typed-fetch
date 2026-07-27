# 0002 — Refuse a `clone()` copy that cannot confirm the branch

- **Status:** Accepted
- **Date:** 2026-07-25

## Context

`BaseHttpError.clone()` **tees** the error body, hands the **branch** to the
`recreate` callback, and then has to decide one thing: did the returned copy
actually take that branch? The platform frees the teed **source** only once
every branch is read or canceled, so a branch nobody owns is a stream that is
never released and a connection that is never returned.

Until this decision, the whole question was answered by one table read:

```ts no-check
if (!teed.adopt(bodies.get(copy))) { … }
```

`bodies` is a module-scoped `WeakMap` in `src/errors/base-http-error.ts`, and it
is per **package copy**. So `bodies.get(copy)` answering `undefined` means one
of two things, and the method could not separate them:

1. the copy was built by a **different package copy**, whose body table this
   copy cannot see; or
2. the copy took no branch at all.

`adopt(undefined)` returns `true` unconditionally, by its own documented
contract. Case 1 and case 2 were therefore both accepted, and the invisibility
of another copy's table was read as consent.

### What that costs, measured

Reproduced against the built artifacts on Node 20.15.0, with the ESM copy
(`dist/index.mjs`) cloning while the CJS copy (`dist/index.js`) supplies the
recreated instance, built from a **different** `Response`:

```
accepted, copy.name = NotFoundError
branch bodyUsed = false  locked = false
original.cancel() => PENDING
```

`branch.bodyUsed === false` is the mechanical signature of an **orphan**. A
released branch reports `bodyUsed === true` synchronously, because `release()`
calls `branch.body.cancel()` and `Response.bodyUsed` flips inside that call.
The cost is one pinned connection and one unreleased stream per cloned error,
and there is no recovery path: `cancel()` on the original error never settles,
and the branch cannot be released through the copy either.

The same hole returned `null` from `error.clone(() => null)`. `copy === this` is
false, `claimsThisCopy(null)` is false, `bodies.get(null)` is `undefined`, and
`adopt(undefined)` is `true`. The declared return type `(response: Response) =>
this` says that cannot happen; a JavaScript consumer, a mocked callback in a
test double, and one `as any` all say it can.

### The mechanism that makes an answer possible

`ErrorBody.owns(candidate)` already answers "is `candidate` the response this
body took custody of?" **within** one copy. A `Symbol.for`-keyed member is the
only mechanism that crosses a copy seam — it is how `./brand` crosses it for
identity and how `./inspect` crosses it for the inspect hook — so the same
question becomes askable across copies. Every copy from this release forward
stamps `Symbol.for("@pbpeterson/typed-fetch.ownsResponse")` on
`BaseHttpError.prototype`, and `clone()` asks it.

That leaves one population unanswered, and it is the population this ADR is
about: an instance from a copy released **before** the query existed. It has no
member under the key. From the asking side it is indistinguishable from any
other object that lacks the member.

### The two policies

**(a) Keep the lenient accept.** Treat "cannot answer" as consent, exactly as
today, and document the residual hole.

**(b) Release the branch and throw.** Treat "cannot answer" as "not confirmed",
release the branch first so the original error stays usable, and throw a
`TypeError` that names the cause and the fix.

## Decision

**Policy (b).** `clone()` refuses a copy that cannot confirm it took the cloned
branch. It releases the branch before it throws.

The answer is a tri-state, and all three states are acted on:

- `true` — accepted.
- `false` — refused, with the same message a copy built from a different
  response receives, because it is the same state and the same fix.
- `undefined` — refused, with a message that names an older package copy and
  says to upgrade it or to build the new error with the copy that is cloning.

The tri-state exists **solely for the message**. The population that policy (b)
newly breaks is exactly the population that gets `undefined`, and the only thing
that makes (b) acceptable is that they receive an actionable message. Telling
an old-copy consumer that their callback "was built from a different response"
would send them hunting a bug in correct code.

Policy (a) was evaluated and **rejected**. The reasons are below, and they are
about the shape of the failure, not about preference.

## Consequences

### The failure is asymmetric, and the asymmetry is not close

|              | A false accept                                                                                            | A false reject                                                                                                                           |
| ------------ | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| What happens | The branch is an orphan                                                                                   | `clone()` throws a `TypeError`                                                                                                           |
| Recovery     | None. `cancel()` on the original never settles, and the branch cannot be released through the copy either | Immediate. The branch is released first, so the original error is fully usable — `cancel()` settles and `text()` still reads the payload |
| Visibility   | Silent. Surfaces as connection exhaustion under load, far from the call                                   | Loud, at the call site, with a message that names the cause and the fix                                                                  |
| Cost         | One pinned connection and one unreleased stream **per cloned error**                                      | One clone that used to work now needs a one-line change                                                                                  |

### The repository decided this exact question once already

The Proxy and delegate guard in `clone()` broke a previously-accepted case, for
the identical `undefined`-from-the-table ambiguity, with the identical
consequence recorded verbatim in `CHANGELOG.md`: "one pinned connection and one
unreleased stream per cloned error, with no recovery path". That guard is the
precedent. Choosing (a) now would decide the same trade-off the opposite way, in
the same method, in the same release.

### Who policy (b) breaks

The full intersection: a consumer holds **two** copies of this package, one at
this version and one at `1.1.0` or older; **and** passes a `recreate` callback;
**and** builds the copy from the older copy's class; **and** builds it correctly
from the handed branch. Everyone in that intersection gets a `TypeError` whose
message names the cause and both fixes. Nobody in it loses data, and nobody's
original error becomes unusable.

Semver did not constrain the choice. `CHANGELOG.md → [Unreleased]` is already a
major and already lists two `clone(recreate)` refusals under `### Breaking`, so
policy (b) is one more bullet in that list.

### Policy (b) fails closed on a build regression

If a future bundler configuration tree-shakes the `stampOwnsResponse(…)` side
effect out of one format, cross-copy `clone()` starts throwing — loudly, at the
call site — instead of silently stranding branches. Under policy (a) the same
regression would be invisible. The hazard itself is not new: `brand()` and
`installInspect()` are side effects on the same prototype and carry it too.

### What policy (b) costs, stated plainly

The `undefined` answer cannot distinguish an older package copy from a hostile
object that omits the member. Both are refused, and both get the older-copy
message. That is acceptable for the same reason Bun's `bodyUsed` divergence is
acceptable: the two states are genuinely indistinguishable from here, and the
library chooses the reading that is correct for the population that actually
exists.

### Two limits, deliberate and permanent

- **The query is a protocol, not a proof.** A copy that answers `true` while
  holding a different response is believed. Nothing on this side of the seam can
  check it — that is what a seam is. The alternative is to hand a foreign object
  the `Response` and let it prove custody, which is what `recreate` already does.
  This is a **documented divergence** between what the library verifies within a
  copy and what it takes on trust across one. It is asserted as a residual in
  `base-http-error.spec.ts`, so the limit is executable rather than remembered.
- **A stamped method that hangs strands the branch.** No timeout is possible
  around a synchronous call. The hazard is not new either: `recreate` is
  consumer code on the same teed path and can hang identically.

### The key is now a cross-version protocol

From this release forward,
`Symbol.for("@pbpeterson/typed-fetch.ownsResponse")` and its
`(candidate: Response) => boolean` shape are a permanent contract between
package **versions**, not an implementation detail. Changing either is a break
for every consumer holding two copies. A future question about a branch takes a
**new** key; this one keeps answering the same question forever.

## What would change our mind

This decision rests on the asymmetry above and on the release window that was
open when it was taken. Revisit it if **any** of the following becomes true:

1. **The fix has to ship as a patch on a released line.** This is the one
   condition that flips the decision outright. Had this landed as a patch on
   `1.1.x`, policy (a) would have been mandatory: a patch must not refuse input
   that the released minor accepted. A future backport to a maintenance branch
   takes policy (a) and documents the hole, and this ADR is not evidence against
   that.
2. **The refusal starts hitting correct code in numbers.** The intersection in
   "Who policy (b) breaks" is narrow by construction. If reports arrive from
   consumers who hold two copies at this version or newer and are still refused,
   the query itself is wrong, and the bug is in the stamping or in the reader —
   not in this policy.
3. **A mechanism appears that proves custody instead of asking for it.** If a
   future platform lets the asking side observe which branch a foreign object
   holds, the first limit above evaporates, the protocol becomes a proof, and
   both the tri-state and the message split can be reconsidered.
4. **The stamping stops being reliable across formats.** If bundlers routinely
   drop the prototype side effects, "cannot answer" stops meaning "older copy"
   and starts meaning "same version, broken build". The message would then be
   actively misleading, and the detection has to move somewhere a bundler cannot
   remove.

Superseding this ADR means writing a new one — see [README.md](./README.md).
Do not edit this file's argument.

## Amendments

### 2026-07-26 — an accepted cross-copy copy does not inherit the identity

This decision creates a population that did not previously exist in a confirmed
form: an instance from a different package **copy** that `clone()` accepts. A
later review recorded a fact about that population. It does not reverse anything
above.

`BaseHttpError.clone()` hands the **branch** the identity the new error inherits,
so a copy reports the identity of the error it was cloned from rather than a
fresh reading of the branch. That handoff is written into the identity tables of
`src/errors/response-identity.ts`, and those tables are module-scoped, so they
are per package **copy** — exactly as the body table this ADR is about is per
package copy. A `recreate` callback that returns an instance from a different
package copy therefore runs that copy's constructor against that copy's tables,
which never saw the handoff. That instance reads the branch.

Reproduced against the built artifacts: an ESM error built from a real
`Response` carrying a shifting own `statusText` getter reports `"FIRST"`; a
same-copy clone inherits `"FIRST"`; a CJS-copy clone reports `"Real"`, the
platform's internal slot. Two errors from one response disagree.

The scope is narrow, and the direction matters. It is observable only through a
shadowed or hostile own-property getter combined with a cross-copy `recreate`,
and the re-read values are the truer ones for a real `Response`, because they
come from the platform's internal slots. Nothing is stranded and nothing is
disclosed: the body **branch** still has a confirmed owner, which is the only
question this ADR decides. The documentation stated the inheritance without that
qualification. It is now qualified in `CONTEXT.md`, in `CHANGELOG.md`, and in the
headers of `src/errors/response-identity.ts` and `src/errors/base-http-error.ts`.

The identity handoff is also a **loan** rather than a record, revoked once the
copy is built. The reason is unrelated to this decision and is stated in
`src/errors/response-identity.ts`.
