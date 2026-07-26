/**
 * The four identity fields of one `Response`, read at most ONCE per response.
 *
 * ## Why this module exists
 *
 * An HTTP error's identity — `status`, `statusText`, `url`, and `headers` — used
 * to be read from the response several times along a single construction path,
 * by three different modules that never compared notes. `src/index.ts` read
 * `status` to select the error class. The `BaseHttpError` constructor read
 * `statusText` twice and `status` again to build the message line, and read
 * `url` twice: once for the redacted form in `message` and once for the full
 * href on `error.url`. `UnknownHttpError` then read `status` and `statusText` a
 * third time to fill its own fields. For a real `Response` every read answers
 * the same value, so nothing was ever visibly wrong. For an INJECTED `fetch` —
 * the seam this library documents, tests, and invites a consumer to use — a
 * getter is free to answer differently on a second read, and the reads
 * disagreed: a `status` getter cycling 420, 200, 201 produced an
 * `UnknownHttpError` whose class was selected on 420, whose message reported
 * 200, and whose `error.status` reported 201. One response, three answers.
 *
 * This module makes the answer singular. Every caller in `src/` reads identity
 * through here, and the first read of a field is the only read that ever
 * happens for that response.
 *
 * ## Why once per RESPONSE, and not once per construction
 *
 * A single construction path is not the only path. `BaseHttpError.clone()` tees
 * the body and builds a copy from the branch, and two errors can legitimately be
 * built from one response. Caching per construction would let those two errors
 * report different identities for the same `Response`, which is the same defect
 * with a longer fuse. A `Response` has ONE identity, so the record is keyed by
 * the response and survives for as long as the response does.
 *
 * The consequence, stated so it is a decision rather than a surprise: a
 * response's identity is fixed at its first read. A getter that changes its
 * answer later cannot change what this library already recorded.
 *
 * There is exactly one identity here that was not read from the response it
 * describes: the one a cloned branch INHERITS. It is a LOAN rather than a
 * record, it lives only for the construction of the copy, and
 * {@link lendIdentity} states in full why the difference is load-bearing.
 *
 * ## Why two tables and not one partially-filled record
 *
 * The success path must read `status` and NOTHING else. `typedFetch` consults
 * `status` on every resolved value, including every 200. Reading a whole
 * identity there would touch `statusText`, `url`, and `headers` on responses
 * that never become an error, allocate a record nobody reads, and — decisively —
 * turn a hostile `headers` getter on a successful response into a
 * `NetworkError`. That is a behavior change the suite already pins the opposite
 * way. So {@link statusOf} fills a status-only table, and {@link identityOf}
 * fills the whole record and reuses the status the status-only table already
 * holds.
 *
 * ## The normalization rules, and why they are these rules
 *
 * `status` is `Number(raw)` computed from exactly one read. No truncation, no
 * clamping, no range check, and no rejection.
 *
 * - Coercion rather than rejection, because the library's stated position is
 *   that only a read that THROWS becomes a `NetworkError`. A resolved value that
 *   answers a status of 400 or more becomes the matching HTTP error, and
 *   anything else stays on the success branch. Turning a string status into a
 *   `NetworkError` would add a second way to reach that class and contradict a
 *   rule the suite enforces.
 * - Coercion changes no branch decision. The old code compared the raw value
 *   with `>= 400`, and a relational comparison against a number applies the same
 *   numeric conversion `Number()` applies. The only difference is downstream:
 *   the `statusCodeErrorMap` lookup now receives a number, so a double reporting
 *   the string "404" reaches `NotFoundError` instead of reaching
 *   `UnknownHttpError` with a string in a field the type declares as `number`.
 * - No truncation, because truncating 404.7 to 404 would invent a status the
 *   response never reported and route it into `NotFoundError`, where a consumer
 *   `switch (error.status)` would treat it as a real 404. 404.7 stays 404.7,
 *   misses the map, and becomes an `UnknownHttpError` — which is exactly what
 *   that class is for.
 * - No range check, because `statusCodeErrorMap` already decides which statuses
 *   have a dedicated class, and it is a projection of the roster rather than a
 *   second source of truth. A range check here would be that second source.
 *
 * `statusText` and `url` are the value when it is a string, and the empty string
 * otherwise.
 *
 * - Both are string attributes in WebIDL, so a real `Response` always answers
 *   with a string. A non-string reaches this code only from an injected
 *   implementation.
 * - The empty string is already the documented "not available" value for both:
 *   the message line drops the reason phrase for an empty `statusText` and drops
 *   the URL for an empty `url`.
 * - `String(raw)` is NOT used, because it can throw — for a `Symbol`, and for
 *   any object with a hostile `toString`. A throw there would convert a
 *   well-formed HTTP error into a `NetworkError`, which is the exact class of
 *   surprise this module exists to remove. The `typeof` test is total.
 * - The cost to accept: a test double that answers `url` with a `URL` OBJECT
 *   loses it. A double must answer with a string, as the platform does.
 *
 * `headers` is read once and passed through UNTOUCHED. The record must not hold
 * a copy, because a `Headers` is mutable and one shared copy across two errors
 * built from one response would let `a.headers.set(...)` edit `b.headers`. That
 * is the aliasing hazard `BaseHttpError` builds its own copy to prevent, and it
 * keeps building one per error. The value is not normalized either: a value the
 * `Headers` constructor refuses is a signal the envelope already turns into a
 * `NetworkError`, and normalizing it away would silently undo a shipped
 * decision.
 *
 * ## Residuals, stated rather than left undiscovered
 *
 * A `WeakMap` cannot key a primitive. If an injected `fetch` resolves a string
 * or a number whose prototype was polluted with a `status` getter, the reads
 * here are still one per CALL, but the calls are not shared, so two calls can
 * disagree. Every other guarantee this library gives about an injected
 * implementation is equally void for a polluted `String.prototype`, so this is a
 * known limit rather than the next defect. It has a test.
 *
 * An inherited identity is SCOPED, in two directions that a reader must not
 * confuse with the read-once guarantee above. It reaches AT MOST the copy
 * `clone()` builds, and never anything else. Two further cases keep it from
 * reaching even that copy: a branch that already carries a RECORDED identity,
 * where {@link lendIdentity} refuses the loan, and a nested `clone()` whose
 * branch is the same object. Both are stated where they are decided — the first
 * in {@link lendIdentity}'s contract, the second in its rejected alternatives.
 *
 * - These tables belong to one package **copy**. A `recreate` callback that
 *   returns an instance built by a DIFFERENT copy sends the branch through that
 *   copy's constructor and that copy's tables, which never saw the loan. That
 *   error re-reads the branch. For a real `Response` the re-read answers the
 *   same four values, so the divergence is observable only through a shadowed or
 *   hostile own-property getter — and there the re-read values are the truer
 *   ones, because they come from the platform's internal slots.
 * - The loan ends with the construction it exists for. An error built from the
 *   branch afterwards reads the branch, exactly as it would read any response
 *   handed to it. That is the point of the loan, not a gap in it.
 *
 * ## This module is INTERNAL
 *
 * It must never be re-exported from `./index` or the root barrel. The public
 * surface is frozen by snapshots on both the value and the type axis (see
 * `public-surface.spec.ts`), and nothing here is a consumer concern.
 *
 * NO CLASS, and in particular no `#private` field, for the reason the header of
 * `./base-http-error` states in full: TypeScript emits a nominal `#private;`
 * marker into the declarations of any class that has one, and this package ships
 * two declaration files whose types must stay mutually assignable. A plain
 * interface and two module-scoped tables emit nothing at all.
 */

/** The four identity fields an HTTP error takes from its `Response`. */
export interface ResponseIdentity {
  /** The status, normalized with `Number` from exactly one read. */
  readonly status: number;
  /** The wire reason phrase when the response answered with a string, else `""`. */
  readonly statusText: string;
  /** The full href when the response answered with a string, else `""`. */
  readonly url: string;
  /**
   * The response's OWN `Headers`, untouched. Every caller that keeps headers
   * builds its own copy from this; the record must never hold a shared copy.
   */
  readonly headers: Headers;
}

/**
 * The status-only cache, filled by {@link statusOf} on the class-selection path
 * in `src/index.ts` and read again by {@link identityOf} inside the constructor.
 * It exists so the success path can read `status` and nothing else.
 */
const statusByResponse = new WeakMap<object, number>();

/** The whole record, filled the first time an error is actually built from the response. */
const identityByResponse = new WeakMap<object, ResponseIdentity>();

/**
 * Identities LENT to a response for the duration of one construction, and taken
 * back after it. Filled and emptied by {@link lendIdentity}; consulted by
 * {@link identityOf} before the recorded table, and by nothing else.
 *
 * Separate from {@link identityByResponse} on purpose, and the separation is the
 * whole guard. A recorded identity is something this library READ from that
 * response, and it is true about it forever. A lent identity is something this
 * library was TOLD about a response it never read, by a `clone()` it does not
 * control. The two are different claims, so they must not share a table: one
 * outlives the response, and the other must not outlive one call.
 *
 * {@link statusOf} does NOT consult this table. That is deliberate — see the
 * module header on what a `statusOf` that honored a loan would do to a later
 * request — and it costs nothing, because {@link identityOf} answers from the
 * loan before it would have called {@link statusOf} at all.
 */
const lentByResponse = new WeakMap<object, ResponseIdentity>();

/**
 * Can this value be a `WeakMap` key?
 *
 * An injected `fetch` may resolve anything at all, including a primitive, and a
 * `WeakMap` refuses a primitive key. Every function here answers for a
 * non-keyable value by reading it directly, once per call — see the residual in
 * the module header.
 */
function keyable(value: unknown): value is object {
  return value !== null && (typeof value === "object" || typeof value === "function");
}

/**
 * The normalizer for `statusText` and `url`: the value when it is a string, and
 * the empty string otherwise. Total by construction — it never throws, which
 * `String()` cannot promise for a `Symbol` or a hostile `toString`.
 */
function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * The response's status, read at most once per response, ever.
 *
 * This is the read the error class is selected on, and the same value reaches
 * `error.status`, `error.message`, and `error.toJSON()`, so the four can no
 * longer disagree.
 *
 * It can still THROW, which is deliberate: a `status` getter that throws, and a
 * `valueOf` that throws during the numeric conversion, are how an injected
 * implementation reports that it cannot answer. The caller turns that into a
 * `NetworkError` and releases the body first. A failed read records nothing, so
 * a later call reads again rather than answering with a value nobody produced.
 *
 * `undefined` is the cache sentinel, and it is sound: `Number()` returns a
 * `number` for every input it does not throw on, so it can never return
 * `undefined` and a recorded status can never be mistaken for a missing one.
 */
export function statusOf(response: Response): number {
  if (!keyable(response)) return Number((response as Response).status);

  const recorded = statusByResponse.get(response);
  if (recorded !== undefined) return recorded;

  const status = Number(response.status);
  statusByResponse.set(response, status);
  return status;
}

/**
 * The response's whole identity, with every field read at most once per
 * response, ever.
 *
 * The status is the same single read {@link statusOf} returns: on the
 * `typedFetch` path it is already recorded, so this call reads three fields, not
 * four. Repeated calls return the SAME record object, so two errors built from
 * one response report one identity.
 *
 * The read order is `status`, `statusText`, `url`, `headers`. The order is
 * observable only when two of them throw, in which case it decides which one
 * becomes the `cause` — a case no contract names.
 *
 * A LENT identity answers before a recorded one, and before any read. That is
 * the {@link lendIdentity} handoff: while `clone()` is building the copy, the
 * branch answers with the identity the copy inherits. The loan is taken back
 * when that construction ends, so every later caller reads the response.
 */
export function identityOf(response: Response): ResponseIdentity {
  const key = keyable(response) ? response : undefined;
  if (key !== undefined) {
    // The loan first. It is read MANY times inside one construction —
    // `BaseHttpError` reads it, then `UnknownHttpError` reads it again — so it
    // cannot be a take-once channel. It is revoked by the lender instead.
    const lent = lentByResponse.get(key);
    if (lent !== undefined) return lent;

    const recorded = identityByResponse.get(key);
    if (recorded !== undefined) return recorded;
  }

  const identity: ResponseIdentity = {
    status: statusOf(response),
    statusText: textOf(response.statusText),
    url: textOf(response.url),
    // Passed through, never copied: see the module header on the aliasing
    // hazard a shared copy would create between two errors built from one
    // response.
    headers: response.headers,
  };

  if (key !== undefined) identityByResponse.set(key, identity);
  return identity;
}

/** The revoke a refused loan returns. Shared, so a refusal allocates nothing. */
function noRevoke(): void {}

/**
 * LEND a response the identity it inherits, for the duration of one
 * construction, and return the revoke that takes the loan back.
 *
 * `BaseHttpError.clone()` is the only caller. It tees the body and builds the
 * copy from the branch, and a branch produced by a real `Response.clone()`
 * reports the response's internal slots rather than the hostile own-property
 * getter that produced the original error's identity. Without this handoff, a
 * copy of an error built from a shifting double would report a different status,
 * a different message, and a different url than the error it was cloned from.
 * For a real `Response` the loan changes nothing, because the platform clone
 * already carries the same values.
 *
 * ## Why it is a LOAN and not a record
 *
 * Every other write in this module records what this library READ from the
 * response it was handed. This one records what a `clone()` implementation
 * SAID, about an object that same implementation chose. Those are different
 * claims, and the second one has an owner the library does not control.
 *
 * A custom Fetch implementation is free to answer `clone()` with a `Response` it
 * did not create. Reproduced: a double `{ status: 404, clone: () => victim }`,
 * where `victim` is a real 200 `Response` the process will use later. A
 * permanent record would bind `victim` to the double's identity in a
 * module-scoped table that lives as long as `victim` does — so a later,
 * entirely legitimate request that resolves `victim` would produce
 * `NotFoundError status=404` instead of a success. One lie about one response
 * would corrupt a different, future request for the life of the process.
 *
 * The loan makes the claim as narrow as the reason for it. The reason is one
 * constructor call: `BaseHttpError` reads the identity, `UnknownHttpError` reads
 * it again, and after that nothing in this library reads a branch's identity
 * ever again. So the window closes with the construction, and the loan is gone
 * before `clone()` returns. `victim` is left exactly as it was found, and the
 * later request reads its own 200.
 *
 * ## Why {@link statusOf} does not consult the loan
 *
 * `statusOf` is the read on the SUCCESS path: `typedFetch` calls it for every
 * resolved response, including every 200. It is also the exact read the attack
 * above lands on. Honoring a loan there would buy nothing — `identityOf`
 * answers from the loan before it would ever call `statusOf` — and would put
 * the poisoned answer on the one path that reaches a future request.
 *
 * ## Two alternatives, rejected
 *
 * - **Keep the permanent record and state the hazard as a residual.** It leaves
 *   a self-inflicted, process-lifetime corruption of an unrelated request in
 *   place, and it is silent: the later request succeeds in the wrong class,
 *   nowhere near the `clone()` that caused it. A residual is for something the
 *   library cannot close. This one closes in a `finally`.
 * - **A staged side channel — one module-level slot the constructor takes and
 *   clears.** The same shape was rejected for the construction path, and the
 *   objection holds here: it is global mutable state whose correctness depends
 *   on nothing running between the stage and the take. A single slot is also
 *   strictly worse than a table for this job. `clone()` hands the branch to
 *   CONSUMER code, and that code can call `clone()` again on ANOTHER error
 *   before it builds the copy. A slot is clobbered by every such nested call,
 *   and the outer copy re-reads its branch without a signal. A table keyed by
 *   the branch loses only to a nested call whose branch is the SAME OBJECT,
 *   which a platform `Response.clone()` never answers with.
 * - **A per-key stack of loans, so a nested `clone()` restores the outer one.**
 *   This closes the one case the table still loses, and it is stated here
 *   instead. A double that answers `clone()` with one `Response` every time
 *   gives both loans one key. The inner `lendIdentity` overwrites the outer
 *   loan, the inner revoke deletes it, and the outer copy then reads the branch.
 *   The original reports the double's identity and the copy reports the
 *   branch's, so the two disagree.
 *
 *   That is silent copy divergence, and it is NOT the poisoning above. The
 *   branch's own getters are read exactly once, the record that read produces is
 *   true about the branch, and a later request that resolves the branch still
 *   reports its own status. The case needs a double that lies twice over: it
 *   answers `clone()` with a `Response` it did not create, and it answers with
 *   the same one every time.
 *
 *   A stack buys that case a per-key array, an ordering contract between a
 *   revoke and the loan under it, and a way for one dropped revoke to leave a
 *   permanent record behind — which is the exact outcome this table exists to
 *   make impossible. The trade is refused.
 *
 * ## The contract the one call site depends on
 *
 * FIRST CLAIM WINS: a response this library has already read keeps the identity
 * it read. A loan must not be able to shadow one.
 *
 * NEITHER THIS FUNCTION NOR THE REVOKE IT RETURNS CAN THROW. Both ignore a
 * non-object key, and `WeakMap.set`, `get`, and `delete` do not throw for one
 * they accept. That matters at the call site twice over: the branch is already
 * teed when the loan is made, so a throw there would orphan it, and the revoke
 * runs in a `finally`, where a throw would replace the exception the caller is
 * already handling.
 *
 * The revoke is idempotent, and it removes ONLY this loan: it compares the
 * recorded record by reference first. A second call, or a call after another
 * loan replaced this one on the same response, does nothing.
 */
export function lendIdentity(response: Response, identity: ResponseIdentity): () => void {
  if (!keyable(response)) return noRevoke;
  if (identityByResponse.has(response)) return noRevoke;

  lentByResponse.set(response, identity);
  return () => {
    if (lentByResponse.get(response) === identity) lentByResponse.delete(response);
  };
}
