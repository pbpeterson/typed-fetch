import { readFileSync } from "node:fs";
import { inspect } from "node:util";
import { describe, test, expect } from "vitest";
import {
  AbortedError,
  NetworkError,
  NotFoundError,
  TimeoutError,
  UnknownHttpError,
} from "./src/errors";
import { classifyRequestFailure } from "./src/request-failure";

/**
 * THE CHANNEL INVENTORY, AS TESTS.
 *
 * `toJSON()` was fixed to stop emitting header values, and the fix was correct
 * — for ONE channel. `util.inspect` (every `console.log`/`console.error`, the
 * fatal-exception printer, a test runner's output) never calls `toJSON`, so it
 * kept printing the live `Headers`, the full URL, and — because Node
 * special-cases `cause` on errors regardless of enumerability — the platform
 * cause chain.
 *
 * This file exists so that class of bug cannot recur silently. It enumerates
 * EVERY way an error's data reaches a human or a sink, and asserts per channel
 * that no secret VALUE appears. It follows the pattern the `toJSON` fix used:
 * serialize, then assert the output does not contain a sentinel. That pins the
 * MECHANISM (no secret escapes) rather than a format, so a future change to the
 * record's shape does not have to touch these tests, while a future change that
 * reopens a channel does.
 *
 * A channel with no hook is listed here too, asserted for what it ACTUALLY
 * does. A residual that is written down and tested is a known limit; an
 * untested one is the next defect.
 */

/** Every secret value planted below. No channel may emit any of them. */
const SECRETS = [
  "SESSION_SECRET",
  "CSRF_SECRET",
  "sk_live_INTERNAL",
  "QUERY_TOKEN_SECRET",
  "FRAGMENT_SECRET",
  "hunter2",
  "CAUSE_SECRET",
  "REASON_SECRET",
  "BODY_SECRET",
] as const;

/** Asserts a rendered channel carries none of the planted values. */
function expectNoSecrets(rendered: string): void {
  for (const secret of SECRETS) {
    expect(rendered, `channel emitted the secret ${secret}`).not.toContain(secret);
  }
}

const FULL_URL = "https://api.test/v1/things?access_token=QUERY_TOKEN_SECRET#FRAGMENT_SECRET";

function httpError(): NotFoundError {
  const response = new Response("BODY_SECRET", {
    status: 404,
    statusText: "Not Found",
    headers: [
      ["set-cookie", "session=SESSION_SECRET"],
      ["set-cookie", "csrf=CSRF_SECRET"],
      ["x-internal-api-key", "sk_live_INTERNAL"],
      ["content-type", "text/plain"],
    ],
  });
  // `response.url` is read-only and empty for a synthesised Response; this is
  // the only way to exercise the URL a real fetch would have set.
  Object.defineProperty(response, "url", { value: FULL_URL });
  return new NotFoundError(response);
}

function networkError(): NetworkError {
  return new NetworkError(
    // The message undici really produces for a credentialed URL, copied
    // verbatim into `message` by `classifyRequestFailure`.
    "Request cannot be constructed from a URL that includes credentials: " +
      "http://alice:hunter2@api.test/v1/things",
    { cause: new Error("CAUSE_SECRET"), url: "http://alice:hunter2@api.test/v1/things" },
  );
}

function abortedError(): AbortedError {
  return new AbortedError("Request aborted", {
    cause: new Error("CAUSE_SECRET"),
    reason: new Error("REASON_SECRET"),
    url: FULL_URL,
  });
}

function timeoutError(): TimeoutError {
  return new TimeoutError("Request timed out", {
    cause: new Error("CAUSE_SECRET"),
    url: FULL_URL,
  });
}

/**
 * The header value a platform REFUSED, echoed back in its own rejection
 * message.
 *
 * `redactUrlInMessage` closed the URL half of this: undici quotes a
 * credentialed URL verbatim in the one string every log line carries. It quotes
 * a refused HEADER VALUE the same way — `Headers.append: "…" is an invalid
 * header value.` — and a secret split across lines (a wrapped base64 token, a
 * PEM body) is exactly the shape that gets refused. The value reached `message`
 * and from there every channel below, including the `toJSON()` record that
 * emits header NAMES precisely so it can never emit a value.
 *
 * Built through `classifyRequestFailure`, not by hand: it is the function that
 * decides what `message` carries, so this fixture crosses the real seam. That
 * `typedFetch` reaches it with a real platform rejection is pinned separately,
 * in `typed-fetch.spec.ts`.
 *
 * The planted value is `CAUSE_SECRET` because that is where it genuinely
 * survives. `message` is a library constant; the platform rejection is kept as
 * `cause`, still quoting the value it refused, and `cause` is this file's
 * documented residual on the two channels that print it. Every other channel
 * asserts the value is gone, which is what makes them the proof: a copied
 * platform message carries it into all of them.
 */
const REFUSED_HEADER_VALUE = "Basic AAAA\nsk_live_CAUSE_SECRET";

function headerRefusalError(): NetworkError {
  return classifyRequestFailure(
    new TypeError(`Headers.append: "${REFUSED_HEADER_VALUE}" is an invalid header value.`),
    undefined,
    FULL_URL,
  ) as NetworkError;
}

const everyErrorKind = [
  ["NotFoundError", httpError],
  ["NetworkError", networkError],
  ["AbortedError", abortedError],
  ["TimeoutError", timeoutError],
  ["NetworkError from a refused header value", headerRefusalError],
] as const;

describe("disclosure channels — no channel emits a secret value", () => {
  describe.each(everyErrorKind)("%s", (_name, make) => {
    // ── Channel 1: JSON.stringify / toJSON ──────────────────────────────
    test("JSON.stringify (the structured-logger channel)", () => {
      expectNoSecrets(JSON.stringify(make()));
    });

    test("JSON.stringify nested inside a log envelope", () => {
      expectNoSecrets(JSON.stringify({ msg: "request failed", err: make() }));
    });

    // ── Channel 2: util.inspect / console.* ─────────────────────────────
    // console.log and console.error format their arguments with util.inspect;
    // asserting on inspect pins both without capturing stdout.
    test("util.inspect at default options (console.log / console.error)", () => {
      expectNoSecrets(inspect(make()));
    });

    test("util.inspect at unlimited depth", () => {
      expectNoSecrets(inspect(make(), { depth: null }));
    });

    test("util.inspect with showHidden (walks non-enumerable properties too)", () => {
      expectNoSecrets(inspect(make(), { showHidden: true, depth: null }));
    });

    test("util.inspect with colors (a TTY logger)", () => {
      expectNoSecrets(inspect(make(), { colors: true, depth: null }));
    });

    test("util.inspect nested and in an array", () => {
      expectNoSecrets(inspect({ wrapped: make() }, { depth: null }));
      expectNoSecrets(inspect([make()], { depth: null }));
    });

    // ── Channel 3: toString / template interpolation ────────────────────
    test("String(error) and `${error}`", () => {
      const error = make();
      expectNoSecrets(String(error));
      expectNoSecrets(`${error}`);
      expectNoSecrets(error.toString());
    });

    // ── Channel 4: the message, on its own ──────────────────────────────
    // `console.error(error.message)` is the most common logging call there is.
    test("error.message", () => {
      expectNoSecrets(make().message);
    });

    // ── Channel 5: own enumerable properties ────────────────────────────
    // Object.keys, spread, for...in, and every structured logger that walks
    // own enumerable properties instead of calling toJSON.
    test("Object.keys / spread / for...in", () => {
      const error = make();
      expectNoSecrets(JSON.stringify(Object.keys(error)));
      expectNoSecrets(JSON.stringify({ ...error }));
      expectNoSecrets(inspect({ ...error }, { depth: null }));
      const seen: string[] = [];
      for (const key in error)
        seen.push(key, String((error as unknown as Record<string, unknown>)[key]));
      expectNoSecrets(seen.join("|"));
    });

    test("Object.entries stringified, the shape a naive logger builds", () => {
      expectNoSecrets(
        Object.entries(make())
          .map(([key, value]) => `${key}=${String(value)}`)
          .join("&"),
      );
    });

    // ── Channel 6: structuredClone / postMessage ────────────────────────
    // The HTML error serialization steps keep name, message, stack and CAUSE.
    // There is no hook: no toJSON, no inspect symbol. `headers` and `url` are
    // dropped because they are not part of those steps, which is why this
    // passes for everything except a cause — asserted separately below.
    test("structuredClone keeps no header value and no URL", () => {
      const cloned = structuredClone(make()) as Error;
      const rendered = inspect(cloned, { showHidden: true, depth: null });
      // The cause is the documented residual (see the dedicated test below), so
      // it is excluded here rather than silently passing.
      expectNoSecrets(rendered.replaceAll("CAUSE_SECRET", "<cause>"));
    });
  });

  // ── Channel 7: the fatal-exception printer ────────────────────────────
  // Node renders a crashing error with `customInspect: false`, so it ignores
  // EVERY inspect hook — this library's and undici's. It walks own ENUMERABLE
  // properties instead, which is why `headers` and `url` must not be
  // enumerable. Reproduced here at the exact option set the printer uses,
  // rather than by spawning a child process.
  describe.each(everyErrorKind)("%s — fatal-exception printer", (_name, make) => {
    test("the crash dump carries no header value and no URL", () => {
      const rendered = inspect(make(), { customInspect: false, showHidden: false, depth: null });
      // `cause` is printed by Node's error special-case and cannot be
      // suppressed on this channel; see the residual test below.
      expectNoSecrets(rendered.replaceAll("CAUSE_SECRET", "<cause>"));
    });
  });
});

describe("disclosure channels — the platform message is never copied", () => {
  test("a refused header value cannot reach the message", () => {
    const message = headerRefusalError().message;

    expect(message).toBe("Network error");
    expect(message).not.toContain("CAUSE_SECRET");
  });

  test("the message cannot forge a log line", () => {
    // A refused value is refused because it carries NUL, CR, or LF. Copying the
    // platform message put a raw newline into the one string every log line
    // carries, so the leak was also a log-injection primitive. A library
    // constant carries no control character at all.
    const message = headerRefusalError().message;

    expect(message).not.toContain("\n");
    expect(message).not.toContain("\r");
    expect(message).not.toContain("\0");
  });

  // The sibling half of the same string. `request-failure.ts` refuses the
  // PLATFORM's message so a control character cannot ride into `message`; an
  // HTTP error's message also carries the ORIGIN's reason phrase, and that
  // arrived unfiltered. `new Response(null, { statusText })` refuses a control
  // character, but the HTTP parser hands every C0 byte except CR and LF
  // straight through, so `defineProperty` is what a real wire read looks like
  // here — the same trick `httpError` already uses for `url`.
  describe("the origin's reason phrase cannot rewrite a log line", () => {
    // Written as escapes, never as literal bytes: a control character in a
    // source file is invisible in a diff and in a review.
    const ESC = "\u001b";
    const NUL = "\u0000";
    const LS = "\u2028";
    const PS = "\u2029";

    function hostileReasonPhrase(statusText: string): NotFoundError {
      const response = new Response(null, { status: 404 });
      Object.defineProperty(response, "statusText", { value: statusText });
      return new NotFoundError(response);
    }

    test("no control character reaches the message", () => {
      // `\x1b[2K\x1b[1A` erases the previous terminal line and repaints it.
      const error = hostileReasonPhrase(`Not Found${ESC}[2K${ESC}[1A${NUL} all clear`);

      expect(error.message).not.toContain(ESC);
      expect(error.message).not.toContain(NUL);
      expect(error.message).not.toContain("\n");
      expect(error.message).not.toContain("\r");
    });

    test("no Unicode line terminator reaches the message", () => {
      // U+2028 opens a new record in a JSON log, and `JSON.stringify` emits it
      // raw rather than escaped.
      const error = hostileReasonPhrase(`Not Found${LS}HTTP 200 OK all clear`);

      expect(error.message).not.toContain(LS);
      expect(error.message).not.toContain(PS);
      expect(JSON.stringify(error)).not.toContain(LS);
    });

    // The half that does not break a line but rewrites how the rest of it
    // READS. Nothing escapes these — `JSON.stringify` and `util.inspect` both
    // emit them raw — so an origin could choose how the URL this library
    // appends after the phrase appears to a human.
    test("no bidi or invisible formatting character reaches the message", () => {
      const RLO = "\u202e";
      const ZWSP = "\u200b";
      const ISOLATE = "\u2066";
      const BOM = "\ufeff";
      const error = hostileReasonPhrase(`Not Found${RLO}${ZWSP}${ISOLATE}${BOM}`);

      expect(error.message).not.toContain(RLO);
      expect(error.message).not.toContain(ZWSP);
      expect(error.message).not.toContain(ISOLATE);
      expect(error.message).not.toContain(BOM);
      expect(JSON.stringify(error)).not.toContain(RLO);
      // The legible half survives.
      expect(error.message).toContain("HTTP 404 Not Found");
    });

    test("a homoglyph is NOT filtered — that would be the deny list", () => {
      // A fullwidth `＠` never delimited an authority for any parser, so
      // nothing is hidden behind it.
      expect(hostileReasonPhrase("Not F＠und").message).toContain("Not F＠und");
    });

    test("the origin does not choose how long the message is", () => {
      // Node accepts a header line of about 15 KB, so an unbounded phrase sets
      // the length of every log line the consumer writes.
      const error = hostileReasonPhrase("Z".repeat(15_000));

      expect(error.message.length).toBeLessThan(1_000);
    });

    test("an ordinary reason phrase is still carried in full", () => {
      // The filter removes what cannot be read, not what can.
      expect(hostileReasonPhrase("Not Found").message).toContain("HTTP 404 Not Found");
      expect(hostileReasonPhrase("Não Encontrado").message).toContain("HTTP 404 Não Encontrado");
    });

    test("a phrase with nothing legible left drops out of the line", () => {
      // The empty-phrase branch already exists for an empty `statusText`.
      expect(hostileReasonPhrase(`${NUL}${ESC}`).message).toBe(`HTTP 404`);
    });

    // `UnknownHttpError` is the one class whose `statusText` is the WIRE value
    // rather than the library's canonical label, and it publishes it as a
    // public field the inherited `toJSON()` emits. Filtering only where the
    // message is composed left that half raw, so the bound was bypassed and a
    // consumer interpolating `error.statusText` still got ESC and NUL. The
    // filter belongs at the recording seam, where there is one reader to miss.
    describe("an unmapped status carries the same filtered phrase", () => {
      function unmapped(statusText: string): UnknownHttpError {
        // 499 has no dedicated class, so this is the catch-all path.
        const response = new Response(null, { status: 499 });
        Object.defineProperty(response, "statusText", { value: statusText });
        return new UnknownHttpError(response);
      }

      test("the public statusText field is filtered and bounded", () => {
        const error = unmapped(`Boom${ESC}[2K${NUL}${LS}${"Z".repeat(9_000)}`);

        expect(error.statusText).not.toContain(ESC);
        expect(error.statusText).not.toContain(NUL);
        expect(error.statusText).not.toContain(LS);
        expect(error.statusText.length).toBeLessThan(200);
      });

      test("the toJSON record carries the filtered value, not the wire one", () => {
        const record = JSON.stringify(unmapped(`Boom${ESC}[2K${NUL}tail`));

        expect(record).not.toContain("\\u001b");
        expect(record).not.toContain("\\u0000");
        expect(record).toContain("Boom");
      });

      test("an ordinary vendor phrase is still carried in full", () => {
        expect(unmapped("Client Closed Request").statusText).toBe("Client Closed Request");
      });
    });
  });

  test("an ordinary transport failure gets the same library message", () => {
    // Redaction is not what closed this. The message is not the platform's
    // under any input, so there is no search string to defeat and no value to
    // leave behind. WHICH failure this was stays readable through
    // `error.cause`.
    const rejection = new TypeError("Failed to fetch");

    const error = classifyRequestFailure(rejection, undefined, "https://api.test/v1/things");

    expect(error.message).toBe("Network error");
    expect(error.cause).toBe(rejection);
  });
});

describe("disclosure channels — the hook itself", () => {
  test("the hook is installed under util.inspect.custom, without importing node:util", async () => {
    // `Symbol.for("nodejs.util.inspect.custom")` IS `util.inspect.custom`. The
    // library uses the registered symbol so it needs no Node import and works
    // on Deno, Bun, and workerd.
    const registered = Symbol.for("nodejs.util.inspect.custom");
    const { inspect: nodeInspect } = await import("node:util");
    expect(registered).toBe(nodeInspect.custom);

    const error = httpError();
    expect(typeof (error as unknown as Record<symbol, unknown>)[registered]).toBe("function");
    await error.cancel();
  });

  // ── the hook's own defenses ─────────────────────────────────────────
  // The module header's whole justification is "this must never throw, because
  // a throwing custom inspect takes `console.log` down with it" — and its
  // defenses against exactly that were the least-covered branches in the
  // package (79% branch coverage on 100% of the lines). Each one below was
  // removable with the full suite still green.

  test("a non-string name renders as Error rather than propagating", () => {
    const error = new NetworkError("boom");
    // A subclass is free to overwrite `name` with anything at all.
    Object.defineProperty(error, "name", { value: 42, configurable: true });
    Object.defineProperty(error, "stack", { value: "", configurable: true });

    expect(inspect(error)).toContain("Error: boom");
  });

  test("an error with no stack still renders a head line", () => {
    const error = new NetworkError("boom");
    Object.defineProperty(error, "stack", { value: undefined, configurable: true });

    expect(inspect(error)).toContain("NetworkError: boom");
  });

  test("a toJSON that is not a function is skipped, not called", () => {
    const error = new NetworkError("boom");
    Object.defineProperty(error, "toJSON", { value: "not callable", configurable: true });

    // Without the `typeof === "function"` guard the call throws and the catch
    // reports `toJSON: "[threw]"` — a defensible fallback, but it means the
    // guard itself is dead code, and a dead guard is one nobody maintains.
    expect(inspect(error)).not.toContain("[threw]");
  });

  test("the below-depth placeholder renders without a stylize function", () => {
    // A runtime that calls the hook with a bare options object gets no
    // `stylize`. Reached directly, because `util.inspect` always supplies one.
    const error = new NetworkError("boom");
    const hook = (error as unknown as Record<symbol, unknown>)[
      Symbol.for("nodejs.util.inspect.custom")
    ] as (depth: number, options: object) => string;

    expect(hook.call(error, -1, {})).toBe("[NetworkError]");
  });

  test("the hook is not enumerable, so it never becomes a record member", () => {
    const error = httpError();
    const registered = Symbol.for("nodejs.util.inspect.custom");
    expect(Object.getOwnPropertySymbols(error)).not.toContain(registered);
    expect(JSON.stringify(error)).not.toContain("nodejs.util");
  });

  test("a developer still gets the stack, which the record deliberately omits", () => {
    const error = httpError();
    const rendered = inspect(error);

    // The whole point of console.log(error): the stack must survive redaction,
    // or the redaction gets worked around.
    expect(rendered).toContain("NotFoundError: HTTP 404 Not Found");
    expect(rendered).toContain("disclosure-channels.spec.ts");
    // …while the JSON record still omits it, because a record ships off-box.
    expect(JSON.stringify(error)).not.toContain("disclosure-channels.spec.ts");
  });

  test("the rendered record IS the toJSON record, so the channels cannot drift", () => {
    const error = httpError();
    const record = error.toJSON();
    const rendered = inspect(error);

    for (const key of Object.keys(record)) expect(rendered).toContain(`${key}:`);
    expect(rendered).toContain("headers: [ 'content-type', 'set-cookie', 'set-cookie'");
  });

  test("one toJSON override fixes BOTH channels for a consumer subclass", () => {
    class TenantNotFoundError extends NotFoundError {
      constructor(
        response: Response,
        readonly tenant: string,
      ) {
        super(response);
      }
      override toJSON() {
        return { ...super.toJSON(), tenant: this.tenant };
      }
    }
    const error = new TenantNotFoundError(new Response(null, { status: 404 }), "acme");

    expect(JSON.stringify(error)).toContain('"tenant":"acme"');
    expect(inspect(error)).toContain("tenant: 'acme'");
  });

  test("a throwing toJSON cannot take console.log down with it", () => {
    class BrokenJson extends NotFoundError {
      override toJSON(): never {
        throw new Error("toJSON exploded");
      }
    }
    const error = new BrokenJson(new Response(null, { status: 404 }));

    expect(() => inspect(error)).not.toThrow();
    expect(inspect(error)).toContain("[threw]");
  });

  test("the hook works without the inspect callback a runtime may not pass", () => {
    const registered = Symbol.for("nodejs.util.inspect.custom");
    const error = httpError();
    const hook = (error as unknown as Record<symbol, (d: number, o: object) => string>)[
      registered
    ] as (this: unknown, d: number, o: object) => string;

    const rendered = hook.call(error, 2, {});
    expect(rendered).toContain("NotFoundError");
    expectNoSecrets(rendered);
  });

  // The two tests above are both supported paths: a `toJSON` override is
  // documented, and a runtime is not obliged to pass the `inspect` callback.
  // They intersected in the one function whose stated invariant is that it
  // never throws. `recordOf` guarded the CALL; the render was unguarded, and
  // `JSON.stringify` refuses a cycle and a BigInt.
  describe("the hook survives a record its renderer refuses", () => {
    const registered = Symbol.for("nodejs.util.inspect.custom");

    function renderWithoutCallback(error: object): string {
      const hook = (error as Record<symbol, unknown>)[registered] as (
        this: unknown,
        depth: number,
        options: object,
      ) => string;
      return hook.call(error, 2, {});
    }

    test.each([
      [
        "a cyclic record",
        (): unknown => {
          const record: Record<string, unknown> = { name: "NotFoundError" };
          record.self = record;
          return record;
        },
      ],
      ["a record holding a BigInt", (): unknown => ({ name: "NotFoundError", size: 1n })],
    ])("%s does not take console.log down with it", (_label, makeRecord) => {
      class UnserializableJson extends NotFoundError {
        override toJSON(): never {
          return makeRecord() as never;
        }
      }
      const error = new UnserializableJson(new Response(null, { status: 404 }));

      expect(() => renderWithoutCallback(error)).not.toThrow();
      expect(renderWithoutCallback(error)).toContain("NotFoundError");
      expect(renderWithoutCallback(error)).toContain("[record not renderable]");
    });

    // The record was guarded and the HEAD was not, though the head runs first.
    // `BaseHttpError` is documented as a class to subclass, so `name`, `stack`,
    // and `message` are all consumer-definable getters.
    test.each(["name", "stack", "message"] as const)(
      "a throwing `%s` getter does not take console.log down",
      (member) => {
        class Throwing extends NotFoundError {}
        const error = new Throwing(new Response(null, { status: 404 }));
        Object.defineProperty(error, member, {
          get() {
            throw new Error(`${member} refused`);
          },
        });

        expect(() => inspect(error)).not.toThrow();
        expect(() => renderWithoutCallback(error)).not.toThrow();
      },
    );

    test("a throwing stylize below the depth limit does not escape", () => {
      // Only this function's promise is kept: a throwing `stylize` breaks
      // Node's rendering of `42` and `{}` just as thoroughly.
      const error = httpError();
      const hook = (error as unknown as Record<symbol, unknown>)[registered] as (
        this: unknown,
        depth: number,
        options: object,
      ) => string;

      expect(() =>
        hook.call(error, -1, {
          stylize() {
            throw new Error("stylize refused");
          },
        }),
      ).not.toThrow();
    });

    test("a record Node can render is still rendered in full", () => {
      // The guard replaces the render, so it must not swallow a working one.
      expect(inspect(httpError())).toContain("NotFoundError");
      expect(renderWithoutCallback(httpError())).toContain('"status":404');
    });
  });

  test("below the configured depth it renders a placeholder, as Node does", () => {
    const registered = Symbol.for("nodejs.util.inspect.custom");
    const error = httpError();
    const hook = (error as unknown as Record<symbol, (d: number, o: object) => string>)[
      registered
    ] as (this: unknown, d: number, o: object) => string;

    expect(hook.call(error, -1, {})).toBe("[NotFoundError]");
  });
});

describe("disclosure channels — cause and reason", () => {
  test("inspect signposts cause and reason instead of printing them", () => {
    const error = abortedError();
    const rendered = inspect(error, { depth: null });

    // Node special-cases `cause` on errors and prints it whether or not it is
    // enumerable — the asymmetry that made this a channel bug: `reason` gets
    // the identical defineProperty defense and stayed hidden only because Node
    // has no special case for it.
    expect(rendered).not.toContain("CAUSE_SECRET");
    expect(rendered).not.toContain("REASON_SECRET");
    // A signpost, not silence: a developer must be able to find them.
    expect(rendered).toContain("read error.cause");
    expect(rendered).toContain("read error.reason");
    // And they are still right there when asked for.
    expect((error.cause as Error).message).toBe("CAUSE_SECRET");
    expect((error.reason as Error).message).toBe("REASON_SECRET");
  });

  test("no signpost when the error carries no cause", () => {
    expect(inspect(new NetworkError("boom"))).not.toContain("read error.cause");
  });

  // The `reason` twin of the case above. Only the `cause` negative was pinned,
  // so forcing the `reason` guard to `true` printed
  // `reason: '[not shown - read error.reason]'` on every NotFoundError and
  // NetworkError — a signpost to a member they do not carry.
  test.each([
    ["a NetworkError", () => new NetworkError("boom")],
    ["an HTTP error", () => new NotFoundError(new Response(null, { status: 404 }))],
  ])("no reason signpost when %s carries none", (_label, make) => {
    const rendered = inspect(make(), { depth: null });

    expect(rendered).not.toContain("read error.reason");
    expect(rendered).not.toContain("reason:");
  });

  test("a nested error renders its record until Node's own depth cut-off", () => {
    // The hook matches Node's placeholder rule. Both `depth < 0` boundary
    // mutations survived, and either one makes an error nested inside an object
    // collapse to `[NetworkError]` a level EARLIER than a plain object would —
    // the record vanishes from a log that Node would still have printed.
    const error = new NetworkError("boom");

    expect(inspect({ level1: error }, { depth: 1 })).toContain("NetworkError");
    expect(inspect({ level1: error }, { depth: 1 })).not.toBe("[NetworkError]");
    // At the cut-off Node prints the placeholder, and so does the hook.
    expect(inspect({ a: { b: { c: error } } }, { depth: 0 })).toContain("[Object]");
  });

  test("RESIDUAL: structuredClone carries the cause, and there is no hook", () => {
    // The HTML error serialization steps copy `cause`. `structuredClone` and
    // `postMessage` consult neither `toJSON` nor any inspect symbol, so this is
    // a platform channel this library cannot close. Asserted so it stays a
    // known limit rather than becoming a surprise.
    const cloned = structuredClone(networkError()) as Error;
    expect((cloned.cause as Error).message).toBe("CAUSE_SECRET");
    // What it does NOT carry: the headers or the URL.
    expect(Object.getOwnPropertyNames(cloned)).not.toContain("headers");
    expect(Object.getOwnPropertyNames(cloned)).not.toContain("url");
  });

  test("RESIDUAL: the fatal-exception printer still shows the cause chain", () => {
    // `customInspect: false` bypasses the hook, and Node's error special-case
    // prints `cause` regardless of enumerability. Nothing this library can do
    // short of not carrying a cause at all — which would remove the diagnostic
    // the pre-response errors exist to provide.
    const rendered = inspect(networkError(), { customInspect: false, depth: null });
    expect(rendered).toContain("CAUSE_SECRET");
    // The library's OWN half of the render is still clean: the message it wrote
    // and the url it holds are both redacted. Only the cause is not.
    expect(rendered).not.toContain("hunter2");
  });

  // The line above holds because THAT fixture's cause does not quote the URL.
  // The real one does: a platform reports a refused value by quoting it back,
  // and for a credentialed URL the refused value IS the credential. This test
  // exists so the residual is measured with a real credential rather than with
  // a planted sentinel that happens to sit somewhere safer.
  test("RESIDUAL: a credential in the cause reaches the crash-dump channel", () => {
    const url = "https://alice:hunter2@api.test/v1";
    const error = new NetworkError("Network error", {
      // Verbatim undici, which is where this string comes from in production.
      cause: new TypeError(
        `Request cannot be constructed from a URL that includes credentials: ${url}`,
      ),
      url,
    });

    // Every channel the library controls is clean, including the one hook the
    // printer below ignores.
    expect(error.message).not.toContain("hunter2");
    expect(JSON.stringify(error)).not.toContain("hunter2");
    expect(inspect(error, { depth: null })).not.toContain("hunter2");
    expect(String(error)).not.toContain("hunter2");

    // The printer Node uses for an unhandled rejection is not one of them. See
    // SECURITY.md, "Known residuals": handle request failures as values.
    const crashDump = inspect(error, { customInspect: false, showHidden: false, depth: null });
    expect(crashDump).toContain("hunter2");
  });
});

describe("disclosure channels — the escape hatches still work", () => {
  test("error.headers keeps every value, error.url keeps the full href", async () => {
    const error = httpError();

    expect(error.headers.getSetCookie()).toEqual(["session=SESSION_SECRET", "csrf=CSRF_SECRET"]);
    expect(error.headers.get("x-internal-api-key")).toBe("sk_live_INTERNAL");
    expect(error.url).toBe(FULL_URL);
    expect(await error.text()).toBe("BODY_SECRET");
  });

  test("headers and url are readable but not enumerable", () => {
    const error = httpError();

    expect(Object.keys(error)).not.toContain("headers");
    expect(Object.keys(error)).not.toContain("url");
    // Still own properties, still readable — only hidden from enumeration.
    expect(Object.getOwnPropertyNames(error)).toContain("headers");
    expect(error.headers).toBeInstanceOf(Headers);
  });

  test("the pre-response classes hide url the same way", () => {
    for (const error of [networkError(), abortedError(), timeoutError()]) {
      expect(Object.keys(error)).not.toContain("url");
      expect(error.url).not.toBe("");
    }
  });
});

describe("disclosure channels — the cross-copy ownership query", () => {
  test("D1: the stamped query is an inventory entry, not a channel", async () => {
    // CONTEXT.md: "Add a channel there before adding a member anywhere." This
    // member is a FUNCTION and carries no data, so it cannot leak a value — and
    // that is exactly why it needs an entry rather than a pass. The inventory is
    // only useful while it is complete.
    const key = Symbol.for("@pbpeterson/typed-fetch.ownsResponse");
    const error = httpError();

    // Stamped on the PROTOTYPE with defineProperty, never declared as a
    // computed class member: a computed member would emit a `unique symbol`
    // into both declaration files and reintroduce the `#private` cross-format
    // assignability hazard.
    expect(Object.getOwnPropertySymbols(error)).toEqual([]);
    expect(Object.prototype.hasOwnProperty.call(error, key)).toBe(false);
    expect(
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(error) as object, key),
    ).toBeUndefined();
    expect(typeof (error as unknown as Record<symbol, unknown>)[key]).toBe("function");

    // Every one of the seven channels, asserted for the member's NAME rather
    // than for a sentinel, because a function has no value to plant in.
    const channels = [
      JSON.stringify(error),
      inspect(error, { depth: null }),
      inspect(error, { showHidden: true, depth: null }),
      inspect(error, { customInspect: false, showHidden: false, depth: null }),
      String(error),
      inspect(structuredClone(error) as Error, { showHidden: true, depth: null }),
      JSON.stringify({ keys: Object.keys(error), spread: { ...error } }),
    ];
    for (const rendered of channels) {
      expect(rendered).not.toContain("ownsResponse");
    }

    await error.cancel();
  });
});

// ---------------------------------------------------------------------------
// This file IS the inventory. `CONTEXT.md` says so ("the inventory lives in
// disclosure-channels.spec.ts as executable tests, one per channel") and then
// listed a different seven: it named a test runner's diff output — which is a
// RESIDUAL that does leak, and so can never satisfy the no-sentinel rule every
// channel here asserts — and omitted `message` on its own.
//
// A prose list cannot be trusted to agree with a file it does not read. This
// pins the authoritative side: the numbering must stay dense and complete, so
// a channel added, removed, or renumbered is a visible failure rather than a
// silent divergence from the document that points here.
// ---------------------------------------------------------------------------
describe("the channel inventory", () => {
  test("declares channels 1..7 with no gap, duplicate, or renumbering", () => {
    const source = readFileSync(new URL("./disclosure-channels.spec.ts", import.meta.url), "utf8");
    const declared = [...source.matchAll(/──\s*Channel\s+(\d+):\s*(.+?)\s*─/g)];

    expect(declared.map((match) => Number(match[1]))).toEqual([1, 2, 3, 4, 5, 6, 7]);

    // The names, so a renamed channel is a reviewed diff and `CONTEXT.md` has
    // one place to copy from.
    expect(declared.map((match) => match[2])).toEqual([
      "JSON.stringify / toJSON",
      "util.inspect / console.*",
      "toString / template interpolation",
      "the message, on its own",
      "own enumerable properties",
      "structuredClone / postMessage",
      "the fatal-exception printer",
    ]);
  });
});
