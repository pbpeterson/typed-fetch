import { brand } from "./brand";
import { installInspect } from "./inspect";
import { redactUrl, redactUrlInMessage } from "./redact-url";
import { ownSlot, textOf } from "./untrusted-read";

/**
 * The construction the three PRE-RESPONSE error classes share: `NetworkError`,
 * `AbortedError`, and `TimeoutError`.
 *
 * ## Why one module owns it
 *
 * The three classes answer one question, in three files: what does a request
 * failure disclose, and through which member? CONTEXT.md states the rule that
 * question follows — a disclosure decision applies to the channel set, never to
 * one channel — and three copies of one construction made the rule expensive to
 * keep. A decision about `cause`, `reason`, or `url` landed in three places, and
 * the `toJSON`-versus-inspect defect this library already records is what one
 * missed place looks like.
 *
 * Five steps were written out three times: the read of the caller's options, the
 * cleaned message, the non-enumerable member descriptor, the record, and the
 * pair of prototype stamps. Each lives here once. A class keeps its own name,
 * its own brand, its own default message, its own extra member, and its own
 * prose about what it withholds.
 *
 * ## NO BASE CLASS, deliberately
 *
 * The construction is applied to a class the way `./inspect` is applied to one:
 * the class calls in, and nothing joins its prototype chain. These three classes
 * are released public API, so a link added above `Error` is an observable change
 * to the published surface — `extends` in both declaration files, and a new
 * answer from `Object.getPrototypeOf`. A function keeps the chain flat.
 *
 * The same rule that forbids a `#private` field forbids a shared base here. See
 * the header of `./base-http-error` for the declaration-file hazard, and
 * CONTEXT.md's `Structural, deliberately` entry for the rule itself.
 *
 * ## This module is INTERNAL
 *
 * It must never be re-exported from `./index` or the root barrel. The public
 * surface is frozen on both axes (see `public-surface.spec.ts`), and nothing
 * here is a consumer concern.
 */

/**
 * Define an own property with the descriptor the platform uses for
 * `Error.cause`: readable and writable, but NOT enumerable, so it stays out of
 * `{ ...error }`, `Object.keys(error)`, `for...in`, and any printer that walks
 * own enumerable properties.
 *
 * Enumerability is the ONLY control this library holds over Node's
 * fatal-exception printer, which disables every formatting hook. A member
 * defined any other way reaches a crash dump in full.
 *
 * This function lives here because five of the seven members it defines are
 * defined here: `cause`, `reason`, and `url` across the three pre-response
 * classes. `base-http-error` defines the other two, `url` and `headers`, and
 * imports this function, so one descriptor answers for all seven. Seven
 * hand-written copies stood here before, each with its own comment restating the
 * same reason, and none of them had drifted yet.
 */
export function define(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    writable: true,
    enumerable: false,
    configurable: true,
  });
}

/**
 * A member a pre-response constructor takes from its caller, beside `url`.
 *
 * `AbortedError` takes `reason` as well as `cause`; the other two take `cause`
 * alone. The set is per class, and it must stay that way: `"cause" in error` and
 * `"reason" in error` are part of the interface, and the inspect hook signposts
 * the members an error OWNS. A class that defined a member its constructor never
 * accepted would change what two channels print.
 */
export type PreResponseSlot = "cause" | "reason";

/** What a pre-response constructor needs, from ONE read of the caller's options. */
export interface PreResponseFailure {
  /** The message for `super`, with the caller's url struck out of it. */
  readonly message: string;
  /**
   * Define the members this failure carries, on the error under construction.
   *
   * The declared members come first, in the order the class names them, and
   * `url` comes last. That order is the order `Object.getOwnPropertyNames`
   * reports, and a test runner's assertion output walks it — the one residual
   * channel that reads non-enumerable names.
   */
  defineMembers(error: object): void;
}

/**
 * Read the caller's options ONCE, and answer with the message and the members.
 *
 * ## Why one read, and not two
 *
 * The message and the `url` member come from the same slot. A constructor that
 * read it twice would let a getter answer differently the second time, so
 * `error.message` and `error.url` could name two different servers. That is the
 * rule `./response-identity` keeps for a `Response`, kept here for the options
 * object a consumer supplies.
 *
 * ## The url
 *
 * The url this error is told about, so the message can be cleaned of it before
 * it becomes the string every log line carries. undici rejects a credentialed
 * URL with a `TypeError` whose message contains the PASSWORD. `typedFetch` no
 * longer passes that text on — every message it writes is a library constant —
 * but these constructors are public API, and a consumer wrapping an adapter
 * passes whatever it holds. See `./redact-url`.
 *
 * ## OWN properties only, on every slot
 *
 * A bare `options?.url` and a bare `"cause" in options` each walk the prototype
 * chain, so a single `Object.prototype.url = ...` write anywhere in the process
 * puts a URL this request never touched into `toJSON()` — the record a logger
 * ships off-box — and a polluted `cause` forges the chain underneath it. This is
 * the guard `typedFetch` applies to its `fetch` slot, applied to the slots its
 * siblings read. `typedFetch` itself is unaffected either way: it always builds
 * an own-property literal.
 *
 * The READ is normalized too, not only the value: `ownSlot` reports a slot that
 * throws as absent, because neither `Object.hasOwn` nor the getter after it is
 * inert.
 *
 * ## NORMALIZED, not trusted
 *
 * `url?: string` is a compile-time claim, and these constructors are public API:
 * a consumer building a mock, an adapter, or a re-wrap passes whatever it holds.
 * An unchecked value made a constructor THROW — `hasRedactableSlot` calls
 * `.includes` on it — in a library whose premise is that errors are values. An
 * array carries `.includes`, so it got through instead and sat in a
 * `readonly string` slot. `typedFetch` already applies this rule to its own
 * resolved url.
 *
 * @param message - The library-authored message the class chose.
 * @param options - Whatever the caller passed. Untrusted, and read as own slots
 *   only.
 * @param slots - The members this class accepts beside `url`, in the order it
 *   defines them.
 */
export function preResponseFailureOf(
  message: string,
  options: unknown,
  slots: readonly PreResponseSlot[],
): PreResponseFailure {
  // The declared slots first and `url` last, which is the order the three
  // constructors read them in before this module existed. A read order is
  // observable: every one of these getters belongs to the caller.
  const members = slots.map((key) => ({ key, slot: ownSlot(options, key) }));
  const url = textOf(ownSlot(options, "url").value);
  return {
    message: redactUrlInMessage(message, url),
    defineMembers(error: object): void {
      for (const { key, slot } of members) {
        if (!slot.present) continue;
        // `defineProperty`, not `error.cause = ...`. A plain assignment creates
        // an ENUMERABLE own property, while `new Error(message, { cause })`
        // creates a non-enumerable one. The difference is not cosmetic: an
        // enumerable `cause` enters `JSON.stringify(error)`, `{ ...error }`, and
        // `Object.keys(error)`, and the cause of a failed `fetch` is a platform
        // error whose own chain carries socket detail — local and remote
        // addresses and ports on undici. That reaches any structured log that
        // serializes the error.
        //
        // `reason` carries one hazard of its own. It is whatever the caller
        // passed to `controller.abort(reason)`, so it can be a cyclic object,
        // and an enumerable one makes `JSON.stringify(error)` throw inside
        // whatever logger reached for it.
        define(error, key, slot.value);
      }
      // Non-enumerable for the same reason, plus one of its own: the full href
      // can carry a credential in its query, and an enumerable property puts it
      // into `{ ...error }`, `Object.keys(error)`, and Node's fatal-exception
      // printer, which ignores every inspect hook. The redacted form is in
      // `message` and in the `toJSON()` record.
      define(error, "url", url);
    },
  };
}

/**
 * The record `JSON.stringify(error)` produces for a pre-response error, and the
 * record the inspect hook renders below the stack.
 *
 * Three fields, one shape, one definition. What the record CARRIES is a single
 * decision about the channel set, so it is written once. What each record
 * WITHHOLDS stays documented on the class, because a `NetworkError` cause and an
 * `AbortedError` reason are different values with different hazards.
 */
export function preResponseRecord(error: {
  readonly name: string;
  readonly message: string;
  readonly url: string;
}): { name: string; message: string; url: string } {
  // Origin and path, never the query. `error.url` keeps the full href.
  return { name: error.name, message: error.message, url: redactUrl(error.url) };
}

/**
 * Stamp the cross-copy brand and this library's render hooks onto a pre-response
 * class prototype.
 *
 * ONE call, for the reason `installInspect` gives for stamping its own three
 * hooks together: a class that receives one stamp and not the other is a class
 * whose channels disagree. `toJSON` covers `JSON.stringify`; the hooks cover
 * `console.log` and `util.inspect`, Node's fatal-exception printer, which prints
 * `cause` whatever its enumerability, and `String(error)`. The brand is what
 * makes the matching guard answer across package copies. See `./brand` and
 * `./inspect`.
 */
export function installPreResponseError(prototype: object, brandSymbol: symbol): void {
  brand(prototype, brandSymbol);
  installInspect(prototype);
}
