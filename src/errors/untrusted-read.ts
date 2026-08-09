/**
 * The reads this library performs against a value it does not trust.
 *
 * ## Why one module owns them
 *
 * Four kinds of value arrive from outside and are read here: the value an
 * injected transport resolves with, the options object a consumer hands to a
 * public constructor, the value a `recreate` callback returns, and whatever a
 * guard is asked about. None of those reads is inert. A getter throws, a
 * `Proxy` trap answers the second read differently, a prototype chain runs
 * forever, and a single write to `Object.prototype` answers for every value in
 * the process.
 *
 * Each answer to those hazards had more than one home. The object-likeness test
 * was written out eight times across five files, and the copies had already
 * drifted apart in their null test. `./brand` held the bounded prototype walk
 * twice, and the `Object.prototype` pollution test twice, each copy carrying its
 * own paragraph of the same reason. {@link ownSlot} and {@link textOf} sat in
 * `./response-identity`, a module named for a `Response`, while every caller of
 * either one reads a value a CALLER supplied.
 *
 * One rule joins the five functions below: the value being read decides
 * nothing. It cannot make a read run forever, and it cannot answer a question
 * this library did not ask. Four of the five never throw either. The fifth
 * walks a prototype chain a `Proxy` can refuse, and it hands that refusal to
 * its caller, because the two callers owe a refusal different answers.
 *
 * ## What does not live here
 *
 * A read that carries a POLICY stays with the module that owns the policy.
 * `./response-identity` decides that one `Response` has one identity, and
 * records it. `../response-verdict` decides which surface a foreign response
 * must expose. `./error-body` decides when a body is still claimable. Those are
 * decisions about this library's domain. The five below are decisions about
 * JavaScript.
 *
 * ## This module is INTERNAL
 *
 * It must never be re-exported from `./index` or the root barrel. The public
 * surface is frozen on both the value and the type axis (see
 * `public-surface.spec.ts`), and nothing here is a consumer concern.
 */

/**
 * Is this value an object rather than a primitive?
 *
 * The ECMAScript `Object` type exactly: `null` and every primitive answer
 * `false`, and a FUNCTION answers `true`. Callers ask this question for four
 * jobs — a `WeakMap` key, the target of a property read, the start of a
 * prototype chain, and the structural verdict on a value that must be able to
 * own something — and all four have the same answer for a function as for an
 * ordinary object.
 *
 * ONE predicate, where eight copies stood across five files. Two of the eight
 * tested `value == null` and the other six `value !== null`, which is what
 * drift looks like before it matters: `typeof undefined` is neither `"object"`
 * nor `"function"`, so the two spellings answer the same for every input in the
 * language.
 *
 * `typedFetch` refuses a resolved primitive before `./response-identity` ever
 * runs, so that module's use of this guard is defensive. It stays: an internal
 * caller can violate the `Response` type, and a `WeakMap` refuses a primitive
 * key with a `TypeError`.
 */
export function isObjectLike(value: unknown): value is object {
  return value !== null && (typeof value === "object" || typeof value === "function");
}

/**
 * The value when it is a string, and the empty string otherwise.
 *
 * Total by construction — it never throws, which `String()` cannot promise for a
 * `Symbol` or for a hostile `toString`. A throw inside a normalizer turns a
 * well-formed error into a `NetworkError`, which is the class of surprise the
 * single-read rule exists to remove.
 *
 * Three callers, one rule. `./response-identity` normalizes the `statusText`
 * and the `url` of an injected `Response`, where both are string attributes in
 * WebIDL and a non-string can only come from an injected implementation. The
 * three pre-response classes take a `url` from a CALLER, where `url?: string`
 * is a compile-time claim they must not rely on, because a consumer constructs
 * them directly. `../request-plan` reads the `url` of a handed-over `Request`.
 * Each one keeps a `readonly string` slot holding a string, and each one keeps
 * a non-string out of `redactUrl`.
 *
 * The empty string is the documented "not available" value at every one of
 * those slots: the message line drops the reason phrase for an empty
 * `statusText`, and drops the URL for an empty `url`.
 *
 * The cost to accept: a value that answers with a `URL` OBJECT is lost. A
 * caller must answer with a string, as the platform does.
 */
export function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * One own slot of a value a CALLER supplied: whether it is there, and what it
 * holds. Total by construction — it never throws.
 *
 * The three pre-response classes take their `cause`, `reason`, and `url` from a
 * caller, and they are public API a consumer constructs directly. Neither half
 * of the read is inert. `Object.hasOwn` runs `[[GetOwnProperty]]`, which a
 * `Proxy` trap answers, and the read that follows it runs an ordinary getter,
 * which needs no `Proxy` at all. Either one can throw, and a constructor that
 * throws is the one outcome a library whose premise is errors-as-values must
 * not produce.
 *
 * A slot that refuses to answer is ABSENT. That is the honest report: the
 * constructors define an own `cause` or `reason` only for a value they hold, so
 * a refusal keeps `"cause" in error` false rather than filing `undefined`.
 *
 * OWN, never inherited. A bare `options?.url` walks the prototype chain, so a
 * single `Object.prototype.url` write anywhere in the process puts a URL this
 * request never touched into the record a logger ships off-box.
 */
export function ownSlot(source: unknown, key: string): { present: boolean; value: unknown } {
  if (source === null || source === undefined) return { present: false, value: undefined };
  try {
    if (!Object.hasOwn(source, key)) return { present: false, value: undefined };
    return { present: true, value: (source as Record<string, unknown>)[key] };
  } catch {
    return { present: false, value: undefined };
  }
}

/**
 * Does `Object.prototype` own this key?
 *
 * PRESENCE, not value. A read has a RECEIVER, and an accessor installed on
 * `Object.prototype` can answer `undefined` for `this === Object.prototype` and
 * the payload for every other receiver — so a value question walked straight
 * past the guard while the very next line resolved the polluted member through
 * the chain. A descriptor lookup takes no receiver, so nothing can answer it
 * selectively.
 *
 * Two guards in `./brand` ask this, and each states its own consequence at its
 * own call site: one polluting write made every brand guard a constant `true`,
 * and a non-owner accepted by the ownership query orphans a teed branch. The
 * reason above is one reason, so it is written once here. `hasBrand` states why
 * refusing this one source costs the cross-copy mechanism nothing.
 */
export function objectPrototypeCarries(key: PropertyKey): boolean {
  return Object.getOwnPropertyDescriptor(Object.prototype, key) !== undefined;
}

/**
 * The longest prototype chain {@link descriptorBelowObject} walks.
 *
 * The longest chain this library builds is eight links — instance,
 * `NotFoundError`, `KnownHttpError`, `BaseHttpError`, `Error`,
 * `Object.prototype` — and a consumer subclass adds one each. Thirty-two leaves
 * room for any real hierarchy and stops a fabricated one immediately.
 */
const PROTOTYPE_WALK_LIMIT = 32;

/**
 * The first own descriptor for `key` on `value` or on a prototype below
 * `Object.prototype`.
 *
 * This answers the one question pollution cannot: does something OTHER than
 * `Object.prototype` own this key? A caller reaches it only when
 * {@link objectPrototypeCarries} reports the polluted state, so the walk costs
 * nothing in the ordinary case.
 *
 * The DESCRIPTOR, and not a boolean, because the two callers ask different
 * questions of one walk. A brand counts only when the descriptor holds the
 * literal `true`, while the ownership query accepts any member under its key,
 * because it calls what it finds and checks the result instead. Both stop at the
 * first descriptor the chain owns, so one walk answers both.
 *
 * BOUNDED, because the chain belongs to the caller. The engine refuses a cyclic
 * prototype chain on ordinary objects, but `[[GetPrototypeOf]]` on a `Proxy`
 * over an extensible target is checked against no invariant at all: the trap can
 * answer with the proxy itself forever. Nothing throws, so no `try` catches it,
 * and `isHttpError` — the function the README puts in every catch block — never
 * returns. Trading a wrong answer for a stalled process is not a fix.
 *
 * It CAN throw, and deliberately does not catch: a `Proxy` trap can refuse both
 * operations below. Each caller already runs this walk inside a `try` that maps
 * a throw onto the answer its own guard owes, and those two answers differ.
 */
export function descriptorBelowObject(
  value: object,
  key: PropertyKey,
): PropertyDescriptor | undefined {
  let link: object | null = value;
  for (let steps = 0; steps < PROTOTYPE_WALK_LIMIT; steps += 1) {
    if (link === null || link === Object.prototype) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(link, key);
    if (descriptor) return descriptor;
    link = Object.getPrototypeOf(link) as object | null;
  }
  return undefined;
}
