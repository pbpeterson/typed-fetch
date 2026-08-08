import { inspect } from "node:util";
import { describe, test, expect } from "vitest";
import { AbortedError, NetworkError, NotFoundError, TimeoutError } from "./src/errors";
import { redactUrl } from "./src/errors/redact-url";

/**
 * ROUND 8, LANE H3 — disclosure and security.
 *
 * Two findings, both proved across the channel SET rather than against one
 * channel, because a disclosure decision applies to the set. The harness below
 * is the `disclosure-channels.spec.ts` pattern, copied rather than shared: that
 * file is the inventory and this one is a hunt.
 */

/** The seven channels, rendered. Labelled, so a failure names the channel. */
function everyChannel(error: Error): [string, string][] {
  return [
    ["1 JSON.stringify", JSON.stringify(error) ?? ""],
    ["1 JSON.stringify in a log envelope", JSON.stringify({ msg: "request failed", err: error })],
    ["2 util.inspect", inspect(error, { depth: null })],
    ["2 util.inspect with colors", inspect(error, { colors: true, depth: null })],
    ["3 String(error)", String(error)],
    ["3 template interpolation", `${error}`],
    ["3 string concatenation", "log line: " + (error as unknown as string)],
    ["4 error.message", error.message],
    ["5 Object.keys", JSON.stringify(Object.keys(error))],
    ["5 spread", JSON.stringify({ ...error })],
    ["6 structuredClone", inspect(structuredClone(error), { depth: null })],
    [
      "7 the fatal-exception printer",
      inspect(error, { customInspect: false, showHidden: false, depth: null }),
    ],
  ];
}

/** The channels that emitted any of `secrets`, by label. The empty list is the pass. */
function leakingChannels(rendered: [string, string][], secrets: string[]): string[] {
  return rendered
    .filter(([, text]) => secrets.some((secret) => text.includes(secret)))
    .map(([channel]) => channel);
}

/** An HTTP error whose response reports `url`, the way a real fetch would. */
function httpErrorFor(url: string): NotFoundError {
  const response = new Response(null, { status: 404 });
  // `response.url` is read-only and empty on a synthesised Response.
  Object.defineProperty(response, "url", { value: url });
  return new NotFoundError(response);
}

/**
 * R8-H3-01 — `redactUrl`'s ABSOLUTE branch reads only the normalized
 * `pathname`. The relative branch reads the RAW input first, and its comment
 * states exactly why: `stripValues` clears the query and the fragment BEFORE
 * the userinfo scan runs, so `://svc:hun?ter2@host/v1` arrives as
 * `/://svc:hun` — an authority truncated mid-credential, with no `@` left to
 * find and the first half of the password still in it.
 *
 * The same input inside the PATH of an absolute url gets no raw scan at all.
 * The URL Standard's path state hands everything after a `?` or a `#` to the
 * query state or the fragment state, so `parsed.pathname` stops inside the
 * credential and the surviving prefix is emitted.
 *
 * `docs/audit-ledger.md`, "What round 5 settled", records this as closed —
 * "Both branches now read both forms". That sentence is false for the absolute
 * branch: `redactUrl` scans `parsed.pathname` there and nothing else.
 * `redact-url.spec.ts` pins `://svc:hun?ter2@host/v1` on the relative branch
 * and never presents the absolute twin.
 */
describe("R8-H3-01 — an absolute url's embedded credential survives a `?` or `#`", () => {
  const PASSWORD = "hunter2";

  test.each([
    ["a query terminator", `https://api.test/go/https://svc:${PASSWORD}?tail@internal.test/v1`],
    ["a fragment terminator", `https://api.test/go/https://svc:${PASSWORD}#tail@internal.test/v1`],
  ])("redactUrl drops a password %s cut in half", (_label, url) => {
    // The relative twin of the same shape is already correct, which is the
    // whole point: one branch reads the raw input and the other does not.
    expect(redactUrl(url.slice("https://api.test".length))).not.toContain(PASSWORD);

    expect(redactUrl(url)).not.toContain(PASSWORD);
  });

  test("a username-only bearer token survives whole", () => {
    const url = `https://api.test/callback/https://tok_${PASSWORD}?x@internal.test/v1`;

    expect(redactUrl(url)).not.toContain(PASSWORD);
  });

  test("no channel of an HTTP error carries the truncated password", async () => {
    const error = httpErrorFor(`https://api.test/go/https://svc:${PASSWORD}?tail@internal.test/v1`);

    try {
      expect(leakingChannels(everyChannel(error), [PASSWORD])).toEqual([]);
    } finally {
      await error.cancel();
    }
  });

  test("no channel of a request failure carries the truncated password", () => {
    const error = new NetworkError("Network error", {
      url: `https://api.test/go/https://svc:${PASSWORD}?tail@internal.test/v1`,
    });

    expect(leakingChannels(everyChannel(error), [PASSWORD])).toEqual([]);
  });
});

/**
 * R8-H3-02 — channel 3 (`toString` and template interpolation) is the one
 * channel this library owns no member for.
 *
 * `toJSON` is a method on every error prototype and the inspect hook is stamped
 * under `Symbol.for("nodejs.util.inspect.custom")`, so a write to
 * `Object.prototype` cannot reach either: the library's own member is found
 * first. `Error.prototype.toString` shields the `toString` lookup the same way.
 * Nothing shields `Symbol.toPrimitive` or `valueOf` — neither key exists
 * anywhere between the instance and `Object.prototype` — so a single polluting
 * write takes over `String(error)`, `` `${error}` ``, and `"…" + error`, and it
 * runs with the ERROR as its receiver.
 *
 * The payload below names nothing this library owns. It is the generic
 * "serialize any object" shape, so the attacker needs no knowledge of
 * `typed-fetch`: it reads own property names, which is where `url` lives —
 * non-enumerable precisely so a generic walker cannot reach it, and redacted in
 * every other channel precisely because a query slot carries a credential.
 *
 * This is the `Object.prototype` source round 7 already refused for `hasBrand`
 * and `asksOwnsResponse`, on the stated ground that no real error inherits
 * anything from it. The refusal was applied to the guards and not to the
 * channels.
 */
describe("R8-H3-02 — a polluted Object.prototype takes over channel 3", () => {
  const FULL_URL = "https://api.test/v1?access_token=QUERY_TOKEN_SECRET#FRAGMENT_SECRET";
  const CREDENTIALED_URL = "https://alice:hunter2@api.test/v1";

  /** Every own STRING property, joined: a serializer that names no library member. */
  function genericStringifier(this: object): string {
    return Object.getOwnPropertyNames(this)
      .map((key) => {
        const value = (this as Record<string, unknown>)[key];
        return typeof value === "string" ? `${key}=${value}` : key;
      })
      .join("&");
  }

  /**
   * Runs `render` with `Object.prototype[key]` replaced, and RESTORES before
   * returning. Nothing is asserted inside the window: a failing assertion there
   * would run the runner's own stringifier against a polluted prototype.
   */
  function underPollution<T>(key: string | symbol, render: () => T): T {
    const original = Object.getOwnPropertyDescriptor(Object.prototype, key);
    Object.defineProperty(Object.prototype, key, {
      value: genericStringifier,
      writable: true,
      enumerable: false,
      configurable: true,
    });
    try {
      return render();
    } finally {
      if (original) Object.defineProperty(Object.prototype, key, original);
      else delete (Object.prototype as Record<string | symbol, unknown>)[key];
    }
  }

  const SECRETS = ["QUERY_TOKEN_SECRET", "FRAGMENT_SECRET"];

  test("a polluted Symbol.toPrimitive leaks the full href through every channel it owns", async () => {
    const error = httpErrorFor(FULL_URL);
    // Materialize the lazy `stack` BEFORE the window: formatting it inside runs
    // the runner's own `prepareStackTrace` through the polluted hook.
    void error.stack;

    const rendered = underPollution(Symbol.toPrimitive, () => everyChannel(error));
    try {
      expect(leakingChannels(rendered, SECRETS)).toEqual([]);
    } finally {
      await error.cancel();
    }
  });

  test("a polluted valueOf leaks the full href through string concatenation", async () => {
    const error = httpErrorFor(FULL_URL);
    void error.stack;

    // `valueOf` is consulted first for the "default" hint, which is the hint
    // `"…" + error` uses. `Error.prototype.toString` never runs.
    const rendered = underPollution("valueOf", () => everyChannel(error));
    try {
      expect(leakingChannels(rendered, SECRETS)).toEqual([]);
    } finally {
      await error.cancel();
    }
  });

  test.each([
    ["NetworkError", () => new NetworkError("Network error", { url: CREDENTIALED_URL })],
    ["AbortedError", () => new AbortedError("Request aborted", { url: CREDENTIALED_URL })],
    ["TimeoutError", () => new TimeoutError("Request timed out", { url: CREDENTIALED_URL })],
  ])("a polluted Symbol.toPrimitive leaks %s's credentialed url", (_label, make) => {
    const error = make();
    void error.stack;

    const rendered = underPollution(Symbol.toPrimitive, () => [
      ["3 template interpolation", `${error}`] as [string, string],
    ]);

    expect(leakingChannels(rendered, ["hunter2"])).toEqual([]);
  });
});
