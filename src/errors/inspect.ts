/**
 * The two channels `toJSON()` does not cover: `util.inspect`, and the string
 * conversion behind `String(error)`.
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
const inspectCustom: unique symbol = Symbol.for("nodejs.util.inspect.custom");

/**
 * Deno's inspect hook key.
 *
 * ## Why a SECOND key, and why it is not optional
 *
 * The rule this module keeps is that every runtime which RENDERS an error
 * resolves a member this library owns. That is one key per runtime, not one
 * key: a runtime whose key nobody stamps reads the first answer on the
 * prototype chain, and `Object.prototype` is on that chain.
 *
 * Three runtimes are gated — CONTEXT.md's `gate` entry names `smoke:node-min`,
 * a Bun runtime smoke, `smoke:deno`, and `check-deno-consumer` — and they
 * resolve two keys between them. Bun's `Bun.inspect.custom` IS
 * `Symbol.for("nodejs.util.inspect.custom")`, measured on Bun 1.3.13, so the
 * Node stamp already covers it. Deno resolves `Symbol.for("Deno.customInspect")`
 * FIRST: an object owning both keys renders through Deno's, measured on Deno
 * 2.9.5.
 *
 * So until this key was stamped, `console.log(error)` and `Deno.inspect(error)`
 * found nothing between the instance and `Object.prototype`, and one polluting
 * write there rendered the error's OWN properties — which is where the
 * non-enumerable `url` lives: the full href, userinfo password and query token
 * included, in the channel a developer reads most.
 *
 * No key is invented for a runtime this package does not gate. The browser and
 * workerd expose no per-object inspect hook to stamp; a devtools formatter is a
 * global array, not a member on the value.
 */
const denoCustomInspect: unique symbol = Symbol.for("Deno.customInspect");

/** The subset of Node's inspect options this hook touches. */
interface InspectOptions {
  readonly stylize?: (text: string, style: string) => string;
}

/**
 * The `util.inspect` reference Node passes as the third argument.
 *
 * Its result is `unknown` because nothing typechecks what a runtime hands over.
 * {@link render} already states an invariant that survives a non-string answer,
 * and the type now says the same thing the guard there says.
 */
type Inspect = (value: unknown, options: InspectOptions) => unknown;

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
  //
  // GUARDED, because `Object.hasOwn` is not the inert test it looks like: it
  // runs `[[GetOwnProperty]]`, so a `Proxy` answers it from its
  // `getOwnPropertyDescriptor` trap. Wrapping an error in a Proxy is the APM
  // instrumentation pattern `./base-http-error` names by hand, and a trap that
  // throws took `console.log` down from the one place in this file still
  // outside a `try`.
  try {
    if (Object.hasOwn(error, "cause")) record.cause = HIDDEN_CAUSE;
    if (Object.hasOwn(error, "reason")) record.reason = HIDDEN_REASON;
  } catch {
    // A value that will not answer which members it owns simply gets no
    // signposts. The record it already produced is still worth printing.
  }
  return record;
}

/**
 * Apply the caller's colouring, and survive it refusing.
 *
 * `options.stylize` is supplied by whoever called `inspect`, and a throwing one
 * breaks Node's own rendering of `42`, `"s"`, and `{}` just as thoroughly — so
 * this guard restores nothing for the CONSUMER. It keeps THIS function's
 * promise, which is the one thing it can keep.
 */
function stylize(label: string, options: InspectOptions): string {
  try {
    return typeof options?.stylize === "function" ? options.stylize(label, "special") : label;
  } catch {
    return label;
  }
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
  // EVERY read below can run consumer code. `name`, `stack`, and `message` are
  // plain properties on an `Error`, but `BaseHttpError` is documented as a class
  // to subclass, and a subclass can define any of them as a throwing getter.
  // The invariant this function states — it never throws, because a throwing
  // custom inspect takes `console.log` down with it — has to hold for the head
  // as well as for the record. Guarding only the record left the half that runs
  // first unprotected.
  let name = "Error";
  try {
    if (typeof this.name === "string") name = this.name;
  } catch {
    // A throwing `name` getter is not a reason to lose the whole line.
  }

  // Below the configured depth, Node renders a placeholder rather than the
  // value. Match it, or a deeply nested error would print in full where a
  // plain object would not.
  if (typeof depth === "number" && depth < 0) {
    const label = `[${name}]`;
    return stylize(label, options);
  }
  // The stack already begins with `Name: message`, which is why the record's
  // own `name`/`message` are not stripped out: seeing the exact record next to
  // the stack is how a developer knows what their logger will keep.
  let head: string;
  try {
    head =
      typeof this.stack === "string" && this.stack !== "" ? this.stack : `${name}: ${this.message}`;
  } catch {
    head = name;
  }
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
    const rendered =
      typeof inspect === "function" ? inspect(record, options) : JSON.stringify(record);
    // The renderer's RESULT is not typechecked either. `inspect` is the third
    // argument the runtime supplies, and a value whose `Symbol.toPrimitive`
    // throws would take this function down from the one expression that used to
    // sit outside the guard — in a function whose stated invariant is that it
    // never throws. No runtime this package targets supplies such a callback;
    // the invariant is unconditional anyway.
    tail = typeof rendered === "string" ? rendered : String(rendered);
  } catch {
    tail = "[record not renderable]";
  }
  return `${head} ${tail}`;
}

/**
 * The same hook, under Deno's calling convention.
 *
 * Deno calls `error[denoCustomInspect](inspect, options)`: the `inspect`
 * reference FIRST, and no depth. It needs none — measured on Deno 2.9.5, Deno
 * applies its own depth limit BEFORE the hook, printing `[Object]` without
 * calling in, so the depth passed here is the one that means "not below the
 * limit" and `render`'s placeholder branch stays the business of the runtime
 * that does hand a depth over.
 *
 * It DELEGATES rather than rendering, for the reason this module already gives
 * for reading the record from `toJSON()`: two renderings of one error are two
 * things to keep in step, and the one that drifts is the one no Node developer
 * ever sees.
 *
 * Called with neither argument it still answers. At this depth `render` reads
 * `options` only through the renderer, and it type-tests the renderer first, so
 * the invariant that this file never throws does not rest on a runtime's
 * argument list. It cannot: Deno propagates a throwing hook straight out of
 * `Deno.inspect`, exactly as Node does.
 */
function renderForDeno(this: Serializable, inspect: Inspect, options: InspectOptions): string {
  return render.call(this, 0, options, inspect);
}

/**
 * The string-conversion channel: `String(error)`, `` `${error}` ``, and
 * `"log line: " + error`.
 *
 * ## Why this member has to exist
 *
 * Every other channel resolves a member THIS library owns, so a write to
 * `Object.prototype` never reaches it. `toJSON` is a method on each root error
 * prototype. The hook above is stamped under the inspect key of every gated
 * platform. Even `toString` is shielded, by `Error.prototype.toString`.
 *
 * `Symbol.toPrimitive` was the one lookup with nothing between the instance and
 * `Object.prototype`, and it is the FIRST step of `ToPrimitive` — before
 * `valueOf`, before `toString`. So one polluting write took over all three
 * spellings of this channel at once and rendered the error itself, which is
 * where the non-enumerable `url` lives: the full href, query token and userinfo
 * password included, in the one string every log line carries.
 *
 * That is the `Object.prototype` source `./brand` already refuses for the brand
 * guards and the ownership query, and the pre-response constructors already
 * refuse for `cause`, `reason`, and `url`. It is refused here for the same
 * stated reason: no real error inherits this member from `Object.prototype`, so
 * owning it costs nothing.
 *
 * ## Why it DELEGATES rather than rendering
 *
 * `this.toString()`, not a line of its own. The result is what `ToPrimitive`
 * produced before this member existed, for every hint — `Object.prototype`'s
 * `valueOf` answers with the object, so the ordinary algorithm always fell
 * through to `toString` anyway. Nothing a caller reads changes.
 *
 * It is also what keeps the subclass extension point open. A subclass that
 * overrides `toString` still decides this channel, because the lookup starts at
 * the instance and finds the override first. A subclass that wants the whole
 * conversion defines its own `Symbol.toPrimitive`, which shadows this one on
 * its own prototype. Neither needs this member to be replaceable — but it is,
 * with the descriptor {@link installInspect} gives the inspect hook, and for
 * the same reason: a consumer may legitimately install their own.
 *
 * Replaceable does not weaken the defense. The write this member answers is a
 * pollution gadget that reaches `Object.prototype` and nothing else. A writer
 * who can reach `BaseHttpError.prototype` can already read `error.url`, which
 * ADR 0003 keeps as a documented escape hatch.
 */
function toPrimitive(this: Serializable): string {
  return this.toString();
}

/**
 * Stamp this module's hooks onto a ROOT error prototype, so all 40+ status
 * subclasses inherit them from `BaseHttpError.prototype` at no per-instance
 * cost.
 *
 * EVERY hook, from one call, because they answer one question: which member
 * does a channel resolve when it renders this error? Three members answer it
 * for two channels — the inspect hook under Node's key and again under Deno's,
 * and the string-conversion hook — and the four call sites are exactly the four
 * root prototypes this library owns: `BaseHttpError`, `NetworkError`,
 * `AbortedError`, and `TimeoutError`. So a channel the library means to own is
 * owned on all four, on every gated runtime, or on none. Splitting the stamp
 * into an exported function per hook is one forgotten call away from the
 * asymmetry the header of this file describes — and a stamp added per key
 * rather than per call site is one forgotten runtime away from it.
 *
 * Non-enumerable (none may reach `Object.keys`, a spread, or `for...in`), but
 * writable and configurable — the descriptor an ordinary class method gets, so
 * a consumer can still replace any of them.
 */
export function installInspect(prototype: object): void {
  Object.defineProperty(prototype, inspectCustom, {
    value: render,
    enumerable: false,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(prototype, denoCustomInspect, {
    value: renderForDeno,
    enumerable: false,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(prototype, Symbol.toPrimitive, {
    value: toPrimitive,
    enumerable: false,
    writable: true,
    configurable: true,
  });
}

/** One render of one value, one entry per gated runtime. */
export interface InspectRenders {
  /** What `util.inspect` prints on Node. Bun resolves the same key. */
  readonly node: string;
  /** What `Deno.inspect` prints. */
  readonly deno: string;
}

/** Node's convention: `error[inspectCustom](depth, options, inspect)`. */
type NodeHook = (this: object, depth: number, options: InspectOptions, inspect?: Inspect) => string;

/** Deno's convention: `error[denoCustomInspect](inspect, options)`. */
type DenoHook = (this: object, inspect?: Inspect, options?: InspectOptions) => string;

/**
 * The hook `key` resolves on `value`, or a refusal that names the runtime.
 *
 * The cast is the one read this file cannot type. The member comes off an
 * object of unknown shape, and the callability test above it is what makes the
 * cast true.
 */
function hookAt<Hook>(value: object, key: symbol, runtime: string): Hook {
  const hook = (value as Record<symbol, unknown>)[key];
  if (typeof hook !== "function") {
    throw new TypeError(`this value resolves no ${runtime} inspect hook`);
  }
  return hook as Hook;
}

/**
 * Render one value the way each gated runtime renders it, and answer with both
 * renders.
 *
 * ## Why both renders, from one call
 *
 * The two keys are ONE channel, reached from two runtimes. CONTEXT.md states
 * the rule: a disclosure decision applies to the channel set, never to one
 * channel. A caller that can ask for Node's render alone reproduces the drift
 * this module already paid for once. {@link installInspect} stamped Node's key
 * only, and on Deno the inspect channel resolved `Object.prototype`. So this
 * function takes no runtime argument. Both renders come back, or neither does.
 *
 * ## Why it takes the VALUE and finds the hook itself
 *
 * Each runtime resolves its member by a lookup on the value, so the lookup
 * belongs here rather than in the caller. It starts at the instance. A subclass
 * override answers, a replacement a consumer installed answers, and a `Proxy`
 * around an error answers. A class from another package **copy** answers with
 * its own hook, which is how a prototype from the built package under `dist/`
 * is reachable at all. A caller holding the key alone would also learn two
 * calling conventions: Node passes `(depth, options, inspect)`, and Deno passes
 * `(inspect, options)`.
 *
 * `renderer` is the callback a runtime supplies. Omit it, and both hooks take
 * the documented no-callback path, which is `JSON.stringify`.
 *
 * Node's hook receives depth `0`. That is the value which means "not below the
 * limit". {@link render} answers a placeholder for `depth < 0`, and a caller
 * that wants the placeholder measures Node's depth protocol, not a render.
 *
 * This function adds no guard of its own. Both hooks state that they never
 * throw, and a guard here would answer in place of that invariant.
 *
 * @throws TypeError when the value resolves no hook under one of the two keys.
 */
export function inspectRendersOf(value: object, renderer?: Inspect): InspectRenders {
  const node = hookAt<NodeHook>(value, inspectCustom, "Node");
  const deno = hookAt<DenoHook>(value, denoCustomInspect, "Deno");
  return {
    node: node.call(value, 0, {}, renderer),
    deno: deno.call(value, renderer, {}),
  };
}
