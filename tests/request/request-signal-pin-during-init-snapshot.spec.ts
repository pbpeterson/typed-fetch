import { afterEach, describe, expect, test } from "vitest";
import { isAbortError, typedFetch } from "../../src/index";

const NATIVE_REQUEST = globalThis.Request;
const NATIVE_FETCH = globalThis.fetch;
const NATIVE_SIGNAL = Object.getOwnPropertyDescriptor(NATIVE_REQUEST.prototype, "signal");

function restoreSignal(): void {
  if (NATIVE_SIGNAL === undefined) Reflect.deleteProperty(NATIVE_REQUEST.prototype, "signal");
  else Object.defineProperty(NATIVE_REQUEST.prototype, "signal", NATIVE_SIGNAL);
}

function installSignalDecoy(signal: AbortSignal): void {
  Object.defineProperty(NATIVE_REQUEST.prototype, "signal", {
    configurable: true,
    enumerable: NATIVE_SIGNAL?.enumerable ?? false,
    get: () => signal,
  });
}

function forwardingTransport(): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) =>
    NATIVE_FETCH(input, init)) as typeof fetch;
}

function abortedRequest(): Request {
  const controller = new AbortController();
  const request = new NATIVE_REQUEST("data:text/plain,round6-request", {
    signal: controller.signal,
  });
  controller.abort(new Error("round6 governing abort"));
  return request;
}

afterEach(() => {
  restoreSignal();
});

describe("RequestInit materialization and transport leases", () => {
  test("control: a forwarding transport preserves an aborted Request signal", async () => {
    const result = await typedFetch(abortedRequest(), { fetch: forwardingTransport() });

    expect(isAbortError(result.error)).toBe(true);
    expect(result.response).toBeNull();
  });

  test("control: the ambient lease repairs a signal mutation made by init materialization", async () => {
    const decoy = new AbortController().signal;
    let ownKeysRead = false;
    const options = new Proxy(
      { fetch: undefined },
      {
        ownKeys(target) {
          if (!ownKeysRead) {
            ownKeysRead = true;
            installSignalDecoy(decoy);
          }
          return Reflect.ownKeys(target);
        },
      },
    );

    const result = await typedFetch(abortedRequest(), options);

    expect(ownKeysRead).toBe(true);
    expect(isAbortError(result.error)).toBe(true);
    expect(result.response).toBeNull();
  });

  test("a custom forwarding transport loses the captured Request signal when an init Proxy mutates the prototype", async () => {
    const decoy = new AbortController().signal;
    let ownKeysRead = false;
    let capturedInit: RequestInit | undefined;
    const forwarding = ((input: RequestInfo | URL, init?: RequestInit) => {
      capturedInit = init;
      return NATIVE_FETCH(input, init);
    }) as typeof fetch;
    const options = new Proxy(
      { fetch: forwarding },
      {
        ownKeys(target) {
          if (!ownKeysRead) {
            ownKeysRead = true;
            // This runs while snapshotRequestInit materializes the descriptor
            // bag, after nativeSignalNeedsPin was computed. A caller transport
            // receives the Request unchanged and forwards it to native fetch.
            installSignalDecoy(decoy);
          }
          return Reflect.ownKeys(target);
        },
      },
    );

    const result = await typedFetch(abortedRequest(), options);

    expect(ownKeysRead).toBe(true);
    // The request's internal signal was already aborted. The forwarding path
    // must not let a prototype getter installed during init materialization
    // replace that authority with the live decoy.
    expect(result.response).toBeNull();
    expect(isAbortError(result.error)).toBe(true);
    expect("signal" in (capturedInit ?? {})).toBe(true);
    expect("method" in (capturedInit ?? {})).toBe(false);
  });
});
