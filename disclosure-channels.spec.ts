import { inspect } from "node:util";
import { describe, test, expect } from "vitest";
import { AbortedError, NetworkError, NotFoundError, TimeoutError } from "./src/errors";

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

const everyErrorKind = [
  ["NotFoundError", httpError],
  ["NetworkError", networkError],
  ["AbortedError", abortedError],
  ["TimeoutError", timeoutError],
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
    // But the URL and the credential in it are gone even there.
    expect(rendered).not.toContain("hunter2");
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
