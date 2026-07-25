import vm from "node:vm";
import { describe, test, expect } from "vitest";
import { classifyRequestFailure } from "./src/request-failure";
import { AbortedError, NetworkError, TimeoutError } from "./src/errors";

// Every input this module accepts is untrusted, so the helpers below build the
// hostile and foreign shapes directly. That is the whole point of the seam: a
// signal that throws when read, or an error from another realm, is a plain
// function argument here — no server, no stub `fetch`, no promise.

/** Evaluate `source` in a fresh realm, so `instanceof` cannot see the result. */
function crossRealm(source: string): unknown {
  return vm.runInContext(source, vm.createContext({}));
}

/** A real, already-aborted signal. `undefined` means a bare `abort()`. */
function abortedSignal(reason?: unknown): AbortSignal {
  const controller = new AbortController();
  if (reason === undefined) controller.abort();
  else controller.abort(reason);
  return controller.signal;
}

/** A polyfill-shaped signal: reports `aborted` but never sets a `reason`. */
function reasonlessAbortedSignal(): AbortSignal {
  return { aborted: true, reason: undefined } as unknown as AbortSignal;
}

/** A signal whose reads throw, built from explicit getters. */
function hostileSignal(descriptors: PropertyDescriptorMap): AbortSignal {
  return Object.defineProperties({}, descriptors) as AbortSignal;
}

const URL_UNDER_TEST = "https://example.invalid/classify";

describe("classifyRequestFailure — outcomes", () => {
  test("no signal → NetworkError carrying the rejection and the url", () => {
    const rejection = new TypeError("fetch failed");

    const error = classifyRequestFailure(rejection, undefined, URL_UNDER_TEST);

    expect(error).toBeInstanceOf(NetworkError);
    expect(error.cause).toBe(rejection);
    expect(error.url).toBe(URL_UNDER_TEST);
    expect(error.message).toBe("fetch failed");
  });

  test("the rejection IS the signal's reason → AbortedError preserving that reason", () => {
    const reason = new Error("route change");
    const signal = abortedSignal(reason);

    const error = classifyRequestFailure(reason, signal, URL_UNDER_TEST);

    expect(error).toBeInstanceOf(AbortedError);
    expect((error as AbortedError).reason).toBe(reason);
    expect(error.cause).toBe(reason);
    expect(error.url).toBe(URL_UNDER_TEST);
  });

  test("a real timeout reason → TimeoutError classified off the reason", () => {
    const reason = new DOMException("The operation timed out.", "TimeoutError");
    const signal = abortedSignal(reason);

    const error = classifyRequestFailure(reason, signal, URL_UNDER_TEST);

    expect(error).toBeInstanceOf(TimeoutError);
    expect(error.cause).toBe(reason);
  });

  // The classifier is total: it is the last thing that runs inside the request
  // envelope, so a throw here would reject the promise `typedFetch` exists to
  // keep resolved. Cheap to assert exhaustively now that the input space is a
  // plain argument list.
  test.each([
    ["a string rejection", "boom", undefined],
    ["a null rejection", null, undefined],
    ["an undefined rejection", undefined, undefined],
    [
      "a throwing-getter error",
      Object.defineProperty(new Error(), "message", {
        get() {
          throw new Error("hostile");
        },
      }),
      undefined,
    ],
    [
      "a hostile signal",
      new Error("x"),
      hostileSignal({
        aborted: {
          get() {
            throw new Error("hostile aborted");
          },
        },
      }),
    ],
  ])("never throws for %s", (_label, rejection, signal) => {
    expect(() => classifyRequestFailure(rejection, signal, "")).not.toThrow();
    expect(classifyRequestFailure(rejection, signal, "")).toBeInstanceOf(Error);
  });
});

// ── The signal is the authority, not the rejection's name ──────────────
describe("classifyRequestFailure — the abort gate", () => {
  test("an error merely NAMED 'AbortError' with no signal stays a NetworkError", () => {
    const fakeAbort = Object.assign(new Error("x"), { name: "AbortError" });

    const error = classifyRequestFailure(fakeAbort, undefined, URL_UNDER_TEST);

    expect(error).toBeInstanceOf(NetworkError);
  });

  test("an aborted signal is necessary but NOT sufficient — an unrelated rejection stays a NetworkError", () => {
    const unrelated = new TypeError("bad header name");

    const error = classifyRequestFailure(unrelated, abortedSignal(), URL_UNDER_TEST);

    expect(error).toBeInstanceOf(NetworkError);
    expect(error.cause).toBe(unrelated);
  });

  test("arm 2: a polyfill's OWN fresh DOMException is still the cancellation", () => {
    const reason = new Error("user navigated away");
    const polyfillAbort = new DOMException("Aborted", "AbortError");

    const error = classifyRequestFailure(polyfillAbort, abortedSignal(reason), URL_UNDER_TEST);

    expect(error).toBeInstanceOf(AbortedError);
    // The caller's reason stays the authority on WHY; cause keeps the
    // implementation's own error.
    expect((error as AbortedError).reason).toBe(reason);
    expect(error.cause).toBe(polyfillAbort);
  });

  test("arm 2: node-fetch's own Error subclass named 'AbortError' is a cancellation", () => {
    class NodeFetchAbortError extends Error {
      override readonly name = "AbortError";
    }
    const implAbort = new NodeFetchAbortError("The operation was aborted.");

    const error = classifyRequestFailure(implAbort, abortedSignal(), URL_UNDER_TEST);

    expect(error).toBeInstanceOf(AbortedError);
    expect(error.cause).toBe(implAbort);
  });

  test("arm 1 stays first: identity wins even when the reason's `name` getter throws", () => {
    // Arm 2 would have to read `.name` off this value; arm 1 proves the abort
    // without touching a single property of the untrusted rejection.
    const hostileReason = new DOMException("hostile abort reason", "AbortError");
    Object.defineProperty(hostileReason, "name", {
      get() {
        throw new Error("hostile DOMException name getter");
      },
    });

    const error = classifyRequestFailure(
      hostileReason,
      abortedSignal(hostileReason),
      URL_UNDER_TEST,
    );

    expect(error).toBeInstanceOf(AbortedError);
    expect((error as AbortedError).reason).toBe(hostileReason);
    expect(error.cause).toBe(hostileReason);
  });

  test("a reason-less aborted signal + an unrelated DOMException stays a NetworkError", () => {
    const unrelated = new DOMException("denied", "SecurityError");

    const error = classifyRequestFailure(unrelated, reasonlessAbortedSignal(), URL_UNDER_TEST);

    expect(error).toBeInstanceOf(NetworkError);
    expect(error.cause).toBe(unrelated);
  });

  test("a reason-less aborted signal + a DOMException named 'AbortError' → AbortedError", () => {
    const aborted = new DOMException("aborted", "AbortError");

    const error = classifyRequestFailure(aborted, reasonlessAbortedSignal(), URL_UNDER_TEST);

    expect(error).toBeInstanceOf(AbortedError);
    expect((error as AbortedError).reason).toBeUndefined();
  });

  test("a bare object named 'AbortError' can never claim a cancellation", () => {
    // No stack, prototype is Object.prototype: not an error, whatever it calls
    // itself.
    const forged = { name: "AbortError", message: "not an error" };

    const error = classifyRequestFailure(forged, abortedSignal(), URL_UNDER_TEST);

    expect(error).toBeInstanceOf(NetworkError);
  });
});

// ── Timeout vs plain abort ─────────────────────────────────────────────
describe("classifyRequestFailure — the timeout basis", () => {
  test("a plain Error named 'TimeoutError' is NOT a timeout (the name is forgeable)", () => {
    const forged = Object.assign(new Error("user cancelled checkout"), { name: "TimeoutError" });

    const error = classifyRequestFailure(forged, abortedSignal(forged), URL_UNDER_TEST);

    expect(error).toBeInstanceOf(AbortedError);
    expect((error as AbortedError).reason).toBe(forged);
  });

  test("a cross-realm-SHAPED DOMException named 'TimeoutError' IS a timeout (documented honesty)", () => {
    const forgedCrossRealm = { name: "TimeoutError", [Symbol.toStringTag]: "DOMException" };

    const error = classifyRequestFailure(
      forgedCrossRealm,
      abortedSignal(forgedCrossRealm),
      URL_UNDER_TEST,
    );

    expect(error).toBeInstanceOf(TimeoutError);
  });

  test("the signal's reason is read FIRST: a timeout reason beats an 'AbortError' rejection", () => {
    class NodeFetchAbortError extends Error {
      override readonly name = "AbortError";
    }
    const timeoutReason = new DOMException("The operation timed out.", "TimeoutError");

    const error = classifyRequestFailure(
      new NodeFetchAbortError("The operation was aborted."),
      abortedSignal(timeoutReason),
      URL_UNDER_TEST,
    );

    expect(error).toBeInstanceOf(TimeoutError);
    expect(error.cause).toBe(timeoutReason);
  });

  test("the rejection is the fallback basis when a polyfilled timeout signal has no reason", () => {
    const timedOut = new DOMException("timed out", "TimeoutError");

    const error = classifyRequestFailure(timedOut, reasonlessAbortedSignal(), URL_UNDER_TEST);

    expect(error).toBeInstanceOf(TimeoutError);
    expect(error.cause).toBe(timedOut);
  });
});

// ── Realm-safe error detection ─────────────────────────────────────────
//
// Each test below pins ONE layer of `isError`, observed through the
// `NetworkError`'s message: the message is the only place the layered
// detection is externally visible ("Network error" when the value is not an
// error, the value's own message when it is). Every one of these layers
// survived mutation testing while the module was private, because reaching a
// layer required a bespoke stub `fetch` and the surviving assertions were
// about the error CLASS, never the message.
describe("classifyRequestFailure — realm-safe error detection", () => {
  test("layer 2 (platform tag): a tag-only `[object Error]` is an error", () => {
    // Prototype is `Object.prototype` and there is no `stack`, so layer 3
    // rejects it; only the platform tag identifies it. Remove the tag layer and
    // the message falls back to "Network error".
    const tagged = { [Symbol.toStringTag]: "Error", message: "tagged failure" };
    expect(Object.prototype.toString.call(tagged)).toBe("[object Error]");

    const error = classifyRequestFailure(tagged, undefined, URL_UNDER_TEST);

    expect(error).toBeInstanceOf(NetworkError);
    expect(error.message).toBe("tagged failure");
  });

  test("layer 2 (platform tag): a tag-only `[object DOMException]` is an error", () => {
    const tagged = { [Symbol.toStringTag]: "DOMException", message: "foreign platform failure" };

    const error = classifyRequestFailure(tagged, undefined, URL_UNDER_TEST);

    expect(error.message).toBe("foreign platform failure");
  });

  test("layer 3 (structure): a foreign subclass that overrides the tag is still an error", () => {
    // The tag says "[object ImplError]", so layer 2 cannot help; `instanceof`
    // is blind across realms, so layer 1 cannot either. Only the structural
    // check (a real prototype plus a string `stack`) recognizes it.
    const foreign = crossRealm(
      `class ImplError extends Error {
         get [Symbol.toStringTag]() { return "ImplError"; }
       }
       new ImplError("structural failure")`,
    );
    expect(foreign instanceof Error).toBe(false);
    expect(Object.prototype.toString.call(foreign)).toBe("[object ImplError]");

    const error = classifyRequestFailure(foreign, undefined, URL_UNDER_TEST);

    expect(error).toBeInstanceOf(NetworkError);
    expect(error.message).toBe("structural failure");
  });

  test("layer 3 (structure): an object literal with a fake `stack` is still not an error", () => {
    // The prototype check is what keeps a hand-written literal out.
    const forged = { name: "AbortError", message: "not an error", stack: "fake" };

    const error = classifyRequestFailure(forged, abortedSignal(), URL_UNDER_TEST);

    expect(error).toBeInstanceOf(NetworkError);
    expect(error.message).toBe("Network error");
  });

  test("layer 3 (structure): a prototype-bearing object with NO `stack` is not an error", () => {
    // The prototype check alone is not the whole layer: a null-prototype object
    // clears it, so the string `stack` requirement is what actually keeps a
    // non-error out. Without it this forged value would claim a cancellation.
    const forged = Object.assign(Object.create(null) as object, { name: "AbortError" });
    expect(Object.getPrototypeOf(forged)).toBe(null);

    const error = classifyRequestFailure(forged, abortedSignal(), URL_UNDER_TEST);

    expect(error).toBeInstanceOf(NetworkError);
    expect(error.message).toBe("Network error");
  });

  test("catch arm 1: a rejection whose prototype cannot be read is not an error", () => {
    // `value instanceof Error` walks the prototype chain, so this trap throws
    // inside layer 1. If that catch reported `true`, the proxy's message would
    // leak into the NetworkError instead of the neutral fallback.
    const hostile = new Proxy(new Error("leaked message"), {
      getPrototypeOf() {
        throw new Error("hostile getPrototypeOf trap");
      },
    });

    const error = classifyRequestFailure(hostile, undefined, URL_UNDER_TEST);

    expect(error).toBeInstanceOf(NetworkError);
    expect(error.message).toBe("Network error");
    expect(error.cause).toBe(hostile);
  });

  test("catch arm 2: a rejection whose `Symbol.toStringTag` read throws is not an error", () => {
    // `instanceof` succeeds (no prototype trap) and the value IS an object, so
    // this reaches the second `try` — and dies on the tag read.
    const hostile = new Proxy(
      { message: "leaked message" },
      {
        get(target, property, receiver) {
          if (property === Symbol.toStringTag) throw new Error("hostile toStringTag");
          return Reflect.get(target, property, receiver);
        },
      },
    );

    const error = classifyRequestFailure(hostile, undefined, URL_UNDER_TEST);

    expect(error).toBeInstanceOf(NetworkError);
    expect(error.message).toBe("Network error");
    expect(error.cause).toBe(hostile);
  });

  test("a cross-realm error keeps its message", () => {
    const foreign = crossRealm("new TypeError('foreign network failure')");
    expect(foreign instanceof Error).toBe(false);

    const error = classifyRequestFailure(foreign, undefined, URL_UNDER_TEST);

    expect(error.message).toBe("foreign network failure");
    expect(error.cause).toBe(foreign);
  });

  test("a cross-realm implementation AbortError is still a cancellation", () => {
    const foreign = crossRealm("const e = new Error('aborted'); e.name = 'AbortError'; e");

    const error = classifyRequestFailure(foreign, abortedSignal(), URL_UNDER_TEST);

    expect(error).toBeInstanceOf(AbortedError);
  });

  test("an empty message falls back to the name, then to 'Network error'", () => {
    const dnsLike = new Error("");
    dnsLike.name = "ENOTFOUND";
    expect(classifyRequestFailure(dnsLike, undefined, "").message).toBe("ENOTFOUND");

    const hostileName = new Error("");
    Object.defineProperty(hostileName, "name", {
      get() {
        throw new Error("hostile name getter");
      },
    });
    expect(classifyRequestFailure(hostileName, undefined, "").message).toBe("Network error");

    expect(classifyRequestFailure("boom", undefined, "").message).toBe("Network error");
    expect(classifyRequestFailure("boom", undefined, "").cause).toBe("boom");
  });
});

// ── The guarded signal snapshot ────────────────────────────────────────
describe("classifyRequestFailure — the guarded signal snapshot", () => {
  test("a signal whose `aborted` read throws never yields a cancellation", () => {
    // The fallback must report "not aborted". A fallback that guessed
    // `aborted: true` would turn any abort-shaped rejection into a cancellation
    // on a signal whose state could not be read at all — so the rejection here
    // is deliberately abort-shaped.
    const signal = hostileSignal({
      aborted: {
        get() {
          throw new Error("aborted getter exploded");
        },
      },
      reason: {
        get() {
          throw new Error("reason getter exploded");
        },
      },
    });
    const rejection = new DOMException("Aborted", "AbortError");

    const error = classifyRequestFailure(rejection, signal, URL_UNDER_TEST);

    expect(error).toBeInstanceOf(NetworkError);
    expect(error.cause).toBe(rejection);
  });

  test("a signal that reports aborted but whose `reason` read throws never yields a cancellation", () => {
    // Half a snapshot is worse than none. Reading `reason` outside the guard —
    // or falling back to `{ aborted: true }` — would report a cancellation the
    // signal never actually confirmed.
    const signal = hostileSignal({
      aborted: {
        get() {
          return true;
        },
      },
      reason: {
        get() {
          throw new Error("reason getter exploded");
        },
      },
    });
    const rejection = new DOMException("Aborted", "AbortError");

    const error = classifyRequestFailure(rejection, signal, URL_UNDER_TEST);

    expect(error).toBeInstanceOf(NetworkError);
    expect(error.cause).toBe(rejection);
    expect(error.message).toBe("Aborted");
  });

  test("a signal that is not aborted is never consulted for a reason", () => {
    const controller = new AbortController();
    const rejection = new Error("connection refused");

    const error = classifyRequestFailure(rejection, controller.signal, URL_UNDER_TEST);

    expect(error).toBeInstanceOf(NetworkError);
    expect(error.cause).toBe(rejection);
  });
});
