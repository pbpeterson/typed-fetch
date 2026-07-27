/**
 * The four identity fields of one `Response`, with each successful read
 * recorded at most ONCE per response.
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
 * through here. The first successful read of a field is the only successful
 * read that happens for that response.
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
 * The consequence, stated so it is a decision rather than a surprise: the
 * first successful field reads fix a response's identity. A getter that changes
 * later cannot replace a recorded answer.
 *
 * There is exactly one identity here that was not read from the response it
 * describes: the one a cloned branch INHERITS. It is a LOAN rather than a
 * record, it lives only for the construction of the copy, and
 * {@link lendIdentity} states in full why the difference is load-bearing.
 *
 * ## Why status and partial identity fields have separate tables
 *
 * `typedFetch` must read `status` first, because that one field decides whether
 * a response becomes an HTTP error. An HTTP error keeps the library's lenient
 * identity normalization for injected implementations. A success must instead
 * satisfy the exact public `TypedResponse` surface before the original object
 * escapes. Even a platform response can carry own properties or a replaced
 * prototype that shadow its native members, so native slots alone do not prove
 * the visible surface.
 *
 * {@link statusOf} therefore fills a status-only table before class selection.
 * On the success branch, {@link hasTypedResponseIdentityScalars} records the
 * remaining identity reads through the per-field tables. On the HTTP-error
 * branch, {@link identityOf} consumes the same tables while constructing the
 * error. Neither path can consume one getter answer and later use another.
 *
 * {@link identityOf} records each remaining field immediately after that read
 * succeeds. It stores the whole record after every field succeeds. If a later
 * getter throws, a retry reuses the earlier successful fields and retries only
 * the failed field.
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
 * The first successful `headers` read passes through UNTOUCHED. The record must
 * not hold a copy. A shared copy would let one error edit another error's
 * headers. `BaseHttpError` prevents that aliasing by making one copy per error.
 *
 * The value is not normalized. A value the `Headers` constructor refuses makes
 * the envelope produce a `NetworkError`.
 *
 * ## Residuals, stated rather than left undiscovered
 *
 * An inherited identity is SCOPED, in two directions that a reader must not
 * confuse with the first-successful-read guarantee above. It reaches AT MOST the copy
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
 * It lets class selection happen before success-surface validation and before
 * HTTP-error construction reads the remaining identity.
 */
const statusByResponse = new WeakMap<object, number>();

/**
 * Whether each normalized identity field originally had the scalar type the
 * public success response promises. HTTP errors deliberately use the normalized
 * values, while successes consult these facts before escaping.
 */
const numericStatusByResponse = new WeakMap<object, boolean>();

/** The whole record, filled the first time an error is actually built from the response. */
const identityByResponse = new WeakMap<object, ResponseIdentity>();

/**
 * Successful field reads that happened before the whole identity was complete.
 *
 * A later getter can throw. Recording each earlier field immediately keeps the
 * first successful read authoritative when the same response is tried again.
 */
const statusTextByResponse = new WeakMap<object, string>();
const stringStatusTextByResponse = new WeakMap<object, boolean>();
const urlByResponse = new WeakMap<object, string>();
const stringUrlByResponse = new WeakMap<object, boolean>();
const headersByResponse = new WeakMap<object, Headers>();

/** Has any successful identity read already claimed this response? */
function hasRecordedIdentityField(response: object): boolean {
  return (
    statusByResponse.has(response) ||
    statusTextByResponse.has(response) ||
    urlByResponse.has(response) ||
    headersByResponse.has(response) ||
    identityByResponse.has(response)
  );
}

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
 * `typedFetch` rejects a resolved primitive before this module. The guard
 * remains defensive for an internal caller that violates the `Response` type.
 * A `WeakMap` refuses such a value, so it is read directly.
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

/** Read and record one field only after its getter and normalization succeed. */
function recordedField<T>(table: WeakMap<object, T>, key: object, read: () => T): T {
  if (table.has(key)) return table.get(key) as T;
  const value = read();
  table.set(key, value);
  return value;
}

/**
 * The response's status, with its first successful read recorded per response.
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

  const rawStatus = response.status as unknown;
  const status = Number(rawStatus);
  numericStatusByResponse.set(response, typeof rawStatus === "number");
  statusByResponse.set(response, status);
  return status;
}

/** Read and record `statusText`, including its original scalar type. */
function statusTextOf(response: Response, key: object | undefined): string {
  if (key === undefined) return textOf(response.statusText);
  return recordedField(statusTextByResponse, key, () => {
    const rawStatusText = response.statusText as unknown;
    stringStatusTextByResponse.set(key, typeof rawStatusText === "string");
    return textOf(rawStatusText);
  });
}

/** Read and record `url`, including its original scalar type. */
function urlOf(response: Response, key: object | undefined): string {
  if (key === undefined) return textOf(response.url);
  return recordedField(urlByResponse, key, () => {
    const rawUrl = response.url as unknown;
    stringUrlByResponse.set(key, typeof rawUrl === "string");
    return textOf(rawUrl);
  });
}

/**
 * The response headers, with the first successful read recorded immediately.
 *
 * Response validation uses this function before class selection. A later error
 * constructor must receive that same value rather than reading a shifting
 * getter again.
 *
 * @internal
 */
export function headersOf(response: Response): Headers {
  if (!keyable(response)) return (response as Response).headers;
  return recordedField(headersByResponse, response, () => response.headers);
}

/**
 * Whether the three cached identity scalars have the types promised by a
 * successful {@link Response}.
 *
 * HTTP errors keep the longstanding normalization contract: numeric strings
 * can still select an HTTP error class, while non-string text fields become
 * empty strings. A success cannot use those normalized values, because the
 * original object itself escapes as the public response. This helper records
 * the remaining first reads and reports their original types.
 *
 * @internal
 */
export function hasTypedResponseIdentityScalars(response: Response): boolean {
  if (!keyable(response)) return false;

  statusOf(response);
  statusTextOf(response, response);
  urlOf(response, response);

  return (
    numericStatusByResponse.get(response) === true &&
    stringStatusTextByResponse.get(response) === true &&
    stringUrlByResponse.get(response) === true
  );
}

/**
 * The response's whole identity, with every successful field read recorded
 * immediately per response.
 *
 * The status is the same single read {@link statusOf} returns: on the
 * `typedFetch` path it is already recorded, so this call reads three fields, not
 * four. Repeated calls return the SAME record object, so two errors built from
 * one response report one identity.
 *
 * Response validation reads and records `status` and `headers` before an
 * HTTP-error constructor checks the remaining identity fields. The order
 * matters only when more than one getter throws; it decides which exception
 * becomes the `cause`.
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

  const status = statusOf(response);
  const statusText = statusTextOf(response, key);
  const url = urlOf(response, key);
  // Passed through, never copied: see the module header on the aliasing hazard
  // a shared copy would create between two errors built from one response.
  const headers = headersOf(response);

  const identity: ResponseIdentity = { status, statusText, url, headers };

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
 *   the tables record the branch's first successful getter reads, that record is
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
  if (hasRecordedIdentityField(response)) return noRevoke;

  lentByResponse.set(response, identity);
  return () => {
    if (lentByResponse.get(response) === identity) lentByResponse.delete(response);
  };
}
