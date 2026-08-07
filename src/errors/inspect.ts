/**
 * The `util.inspect` channel — the one `toJSON()` does not cover.
 *
 * `console.log(error)`, `console.error(error)`, Node's fatal-exception printer,
 * `util.format`'s `%s`/`%o`, and a test runner's failure output all reach an
 * error through `util.inspect`. NONE of them calls `toJSON`. So every member
 * `toJSON` withholds was still printed in full: `headers` is an own enumerable
 * property holding a live `Headers`, and Node's inspect SPECIAL-CASES `cause`
 * on errors and prints it whether or not it is enumerable.
 *
 * That asymmetry is what makes this a channel bug rather than a member bug.
 * `AbortedError.reason` is given the identical `defineProperty` defense as
 * `cause` and stays hidden — only because Node happens to have no special case
 * for it. The same defense, two members, one leaks.
 *
 * ## Why the record comes from `toJSON()`
 *
 * This hook does not carry its own list of safe members. It renders whatever
 * {@link BaseHttpError.toJSON} returns. The two channels therefore CANNOT
 * drift: a member added to the record appears in both, a member withheld is
 * withheld in both, and a consumer subclass that overrides `toJSON` fixes both
 * with one override.
 *
 * ## Where it deliberately differs
 *
 * It prints the STACK, which `toJSON` omits. A JSON record is shipped off the
 * box and the stack carries local file paths; `console.log(error)` is read by a
 * developer for whom the stack is the entire point. Removing it would be the
 * kind of redaction that gets worked around, which defeats itself.
 *
 * It also signposts `cause` and `reason` instead of dropping them silently, so
 * a developer sees that a cause exists and is told the one expression that
 * shows it. Their CONTENT stays out: for `NetworkError` the cause is a platform
 * error whose own chain carries local and remote addresses and ports.
 *
 * ## Why `Symbol.for`, and why it is stamped rather than declared
 *
 * `Symbol.for("nodejs.util.inspect.custom")` IS `util.inspect.custom` — the
 * same registered symbol — so this file imports nothing and the package stays
 * zero-dependency and runtime-agnostic. Importing `node:util` would break Deno,
 * workerd, and the browser.
 *
 * It is stamped onto the prototype with `defineProperty` (exactly as
 * `./brand` stamps the cross-copy brands) and NOT written as a computed class
 * member. A computed member keyed by a `Symbol.for` const emits
 * `declare const … : unique symbol` into the declaration file and makes the
 * class type depend on it. This package ships `index.d.ts` AND `index.d.mts`,
 * so that produces two DISTINCT unique symbols and the two declarations of
 * `NotFoundError` stop being mutually assignable — `TS2741: Property
 * '[nodeInspect]' is missing`. That is precisely the `#private` hazard the
 * header of `./base-http-error` exists to avoid, and it must not be
 * reintroduced through a symbol.
 */

/** `util.inspect.custom`, obtained without importing `node:util`. */
export const inspectCustom: unique symbol = Symbol.for("nodejs.util.inspect.custom");

/** The subset of Node's inspect options this hook touches. */
interface InspectOptions {
  readonly stylize?: (text: string, style: string) => string;
}

/** The `util.inspect` reference Node passes as the third argument. */
type Inspect = (value: unknown, options: InspectOptions) => string;

const HIDDEN_CAUSE = "[not shown - read error.cause]";
const HIDDEN_REASON = "[not shown - read error.reason]";

/** An error carrying the record method this hook renders. */
interface Serializable extends Error {
  toJSON?: () => unknown;
}

/**
 * The record to print: `toJSON()`'s, plus a signpost for each hidden member the
 * error actually carries.
 *
 * `toJSON` is a consumer-overridable method, so it is called defensively: this
 * function must never throw, because a throwing custom inspect takes
 * `console.log` down with it.
 */
function recordOf(error: Serializable): Record<string, unknown> {
  let record: Record<string, unknown>;
  try {
    const json = typeof error.toJSON === "function" ? error.toJSON() : undefined;
    // Spread, so adding the signposts below cannot mutate a record a subclass
    // built and kept.
    record = typeof json === "object" && json !== null ? { ...json } : {};
  } catch {
    record = { toJSON: "[threw]" };
  }
  // `hasOwn`, not `in`: these members exist only when a constructor actually
  // assigned them, which is the whole point of the `"cause" in options` guard.
  if (Object.hasOwn(error, "cause")) record.cause = HIDDEN_CAUSE;
  if (Object.hasOwn(error, "reason")) record.reason = HIDDEN_REASON;
  return record;
}

/**
 * The hook itself. Node calls it as `error[util.inspect.custom](depth, options,
 * inspect)`; `this` is the error.
 */
function render(
  this: Serializable,
  depth: number,
  options: InspectOptions,
  inspect?: Inspect,
): string {
  const name = typeof this.name === "string" ? this.name : "Error";
  // Below the configured depth, Node renders a placeholder rather than the
  // value. Match it, or a deeply nested error would print in full where a
  // plain object would not.
  if (typeof depth === "number" && depth < 0) {
    const label = `[${name}]`;
    return typeof options?.stylize === "function" ? options.stylize(label, "special") : label;
  }
  // The stack already begins with `Name: message`, which is why the record's
  // own `name`/`message` are not stripped out: seeing the exact record next to
  // the stack is how a developer knows what their logger will keep.
  const head =
    typeof this.stack === "string" && this.stack !== "" ? this.stack : `${name}: ${this.message}`;
  const record = recordOf(this);
  // A runtime that calls the hook with only `(depth, options)` still gets a
  // readable record.
  //
  // The RENDER is guarded, not only the `toJSON` call above. `recordOf` keeps a
  // throwing `toJSON` from escaping, and then handed whatever it returned to a
  // renderer that has its own refusals: `JSON.stringify` throws on a cycle and
  // on a `BigInt`, and the no-callback branch is a supported path — a runtime
  // is not obliged to pass `inspect`. Two documented, supported behaviours
  // intersected in a function whose stated invariant is that it never throws,
  // because a throwing custom inspect takes `console.log` down with it.
  let tail: string;
  try {
    tail = typeof inspect === "function" ? inspect(record, options) : JSON.stringify(record);
  } catch {
    tail = "[record not renderable]";
  }
  return `${head} ${tail}`;
}

/**
 * Stamp the hook onto a class prototype, so all 40+ status subclasses inherit
 * it from `BaseHttpError.prototype` at no per-instance cost.
 *
 * Non-enumerable (it must never reach `Object.keys`, a spread, or `for...in`),
 * but writable and configurable — the descriptor an ordinary class method gets,
 * so a consumer can still replace it.
 */
export function installInspect(prototype: object): void {
  Object.defineProperty(prototype, inspectCustom, {
    value: render,
    enumerable: false,
    writable: true,
    configurable: true,
  });
}
