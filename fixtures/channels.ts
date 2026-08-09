import { inspect } from "node:util";

/**
 * THE CHANNEL HARNESS.
 *
 * `disclosure-channels.spec.ts` is the channel INVENTORY: it names the seven
 * channels and asserts, one test per channel, that a planted sentinel does not
 * appear. A redaction hunt asks the same seven channels about one url shape.
 * This module is the rendering both of them share, so that a channel fixed for
 * one caller is fixed for every caller.
 *
 * CONTEXT.md states the rule this module exists to keep: **a disclosure
 * decision applies to the channel set, never to one channel.** Seven hand-made
 * copies of this function had already drifted apart — different return types,
 * eleven renders against seven, `structuredClone` inspected with `showHidden`
 * in some copies and without it in others — so a channel repaired in one hunt
 * stayed unasked in six.
 *
 * The renders below are the UNION of what the inventory and every hunt rendered
 * before they were merged. A shared harness that rendered less than the widest
 * copy would silently weaken a security assertion, so where two copies
 * disagreed about an option set, BOTH option sets are rendered. The inventory
 * is the authority on which channels exist; a render only a hunt performed is
 * kept and marked below.
 */

/**
 * The credential planted by the redaction hunts.
 *
 * One value with one role: the secret that must not leave through any channel.
 * The per-suite `SECRETS` arrays stay in their own files, because each names
 * the population that suite plants, and moving them here would make one
 * suite assert about values another suite planted.
 */
export const PASSWORD = "hunter2";

/** One rendered channel: the label a failure prints, and the text it produced. */
export type RenderedChannels = Record<string, string>;

/**
 * The seven channels, rendered from one error and labelled by channel number,
 * so a failure names the channel.
 *
 * Channels, in the inventory's order: 1 `JSON.stringify` with `toJSON`,
 * 2 `util.inspect` with `console.*`, 3 `toString` with template interpolation,
 * 4 the `message` on its own, 5 own enumerable properties, 6 `structuredClone`
 * with `postMessage`, 7 the fatal-exception printer.
 *
 * Channel 7 is rendered at `customInspect: false`, which is the option set
 * Node's fatal-exception printer uses. It ignores EVERY inspect hook — this
 * library's and the platform's — and walks own ENUMERABLE properties instead,
 * so property enumerability is the only control over that channel. Reproducing
 * it at any other option set would test a channel that does not exist.
 */
export function everyChannel(error: Error): RenderedChannels {
  const asString = error as unknown as string;
  const forIn: string[] = [];
  for (const key in error)
    forIn.push(key, String((error as unknown as Record<string, unknown>)[key]));

  return {
    // ── Channel 1: JSON.stringify / toJSON ────────────────────────────────
    "1 JSON.stringify": JSON.stringify(error) ?? "",
    // UNREACHABLE `?? ""`: the value handed to JSON.stringify here is the
    // plain object literal `{ msg, err }`, not `error` itself. JSON.stringify
    // answers `undefined` only when the TOP-LEVEL value is undefined, a
    // function, or a symbol (or a `toJSON` that returns one of those), and a
    // plain object literal with no `toJSON` of its own is none of those,
    // whatever `error`'s own `toJSON` answers for the `err` property.
    /* v8 ignore start */
    "1 JSON.stringify in a log envelope":
      JSON.stringify({ msg: "request failed", err: error }) ?? "",
    /* v8 ignore stop */

    // ── Channel 2: util.inspect / console.* ───────────────────────────────
    // console.log and console.error format their arguments with util.inspect,
    // so asserting on inspect pins both without capturing stdout.
    "2 util.inspect at default options": inspect(error),
    "2 util.inspect at unlimited depth": inspect(error, { depth: null }),
    "2 util.inspect with showHidden": inspect(error, { showHidden: true, depth: null }),
    "2 util.inspect with colors": inspect(error, { colors: true, depth: null }),
    "2 util.inspect nested": inspect({ wrapped: error }, { depth: null }),
    "2 util.inspect in an array": inspect([error], { depth: null }),

    // ── Channel 3: toString / template interpolation ──────────────────────
    // The three spellings are separate renders because the library stamps a
    // string-conversion hook: `String(error)` takes the "string" hint, and
    // string concatenation takes the "default" hint, so they can answer
    // differently. The concatenation render came from a hunt rather than from
    // the inventory, and it is kept for exactly that reason.
    "3 String(error)": String(error),
    "3 template interpolation": `${error}`,
    "3 error.toString()": error.toString(),
    "3 string concatenation": "log line: " + asString,

    // ── Channel 4: the message, on its own ────────────────────────────────
    // `console.error(error.message)` is the most common logging call there is.
    "4 error.message": error.message,

    // ── Channel 5: own enumerable properties ──────────────────────────────
    // Object.keys, spread, for...in, and every structured logger that walks own
    // enumerable properties instead of calling toJSON.
    "5 Object.keys": JSON.stringify(Object.keys(error)),
    "5 spread": JSON.stringify({ ...error }),
    "5 util.inspect of the spread": inspect({ ...error }, { depth: null }),
    "5 for...in": forIn.join("|"),
    "5 Object.entries": Object.entries(error)
      .map(([key, value]) => `${key}=${String(value)}`)
      .join("&"),

    // ── Channel 6: structuredClone / postMessage ──────────────────────────
    // The HTML error serialization steps keep name, message, stack and cause.
    // There is no hook: no toJSON, no inspect symbol. Rendered at both option
    // sets the copies used — the clone carries no inspect hook, so showHidden
    // decides whether its non-enumerable own properties print.
    "6 structuredClone": inspect(structuredClone(error), { depth: null }),
    "6 structuredClone with showHidden": inspect(structuredClone(error), {
      showHidden: true,
      depth: null,
    }),

    // ── Channel 7: the fatal-exception printer ────────────────────────────
    "7 the fatal-exception printer": inspect(error, {
      customInspect: false,
      showHidden: false,
      depth: null,
    }),
  };
}

/**
 * The channels that emitted any of `secrets`, by label. The empty list is the
 * pass.
 *
 * Returning the labels rather than asserting inside the loop is what makes a
 * failure name every channel that leaked, not just the first one.
 */
export function leakingChannels(rendered: RenderedChannels, secrets: readonly string[]): string[] {
  return Object.entries(rendered)
    .filter(([, text]) => secrets.some((secret) => text.includes(secret)))
    .map(([channel]) => channel);
}
