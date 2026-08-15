import { afterEach, describe, expect, test } from "vitest";
import type { TypedFetchOptions } from "../../src/index";
import { isNetworkError, typedFetch } from "../../src/index";

const NATIVE_REQUEST = globalThis.Request;
const NATIVE_FETCH = globalThis.fetch;
const NATIVE_URL = Object.getOwnPropertyDescriptor(NATIVE_REQUEST.prototype, "url");
const NATIVE_SIGNAL = Object.getOwnPropertyDescriptor(NATIVE_REQUEST.prototype, "signal");

function restore(
  target: object,
  property: PropertyKey,
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor === undefined) Reflect.deleteProperty(target, property);
  else Object.defineProperty(target, property, descriptor);
}

afterEach(() => {
  globalThis.Request = NATIVE_REQUEST;
  globalThis.fetch = NATIVE_FETCH;
  restore(NATIVE_REQUEST.prototype, "url", NATIVE_URL);
  restore(NATIVE_REQUEST.prototype, "signal", NATIVE_SIGNAL);
});

describe("request descriptor restoration", () => {
  test("control: an untouched temporary repair restores the caller descriptor", async () => {
    const callerDescriptor = {
      configurable: true,
      enumerable: true,
      get: () => "https://round5-control.invalid/visible",
    } satisfies PropertyDescriptor;
    Object.defineProperty(NATIVE_REQUEST.prototype, "url", callerDescriptor);

    const result = await typedFetch(new NATIVE_REQUEST("http://127.0.0.1:1/round5-control"), {
      headers: {},
    } satisfies TypedFetchOptions);

    expect(isNetworkError(result.error)).toBe(true);
    expect(Object.getOwnPropertyDescriptor(NATIVE_REQUEST.prototype, "url")?.get).toBe(
      callerDescriptor.get,
    );
  });

  test("control: direct native fetch keeps a descriptor mutation made by its init getter", async () => {
    const callerDescriptor = {
      configurable: true,
      enumerable: true,
      get: () => "https://round5-direct.invalid/visible",
    } satisfies PropertyDescriptor;
    Object.defineProperty(NATIVE_REQUEST.prototype, "url", callerDescriptor);

    await NATIVE_FETCH(new NATIVE_REQUEST("http://127.0.0.1:1/round5-direct"), {
      get headers(): HeadersInit {
        Object.defineProperty(NATIVE_REQUEST.prototype, "url", NATIVE_URL!);
        return {};
      },
    }).catch(() => undefined);

    expect(Object.getOwnPropertyDescriptor(NATIVE_REQUEST.prototype, "url")).toEqual(NATIVE_URL);
  });

  // Open question, parked here on purpose. The wrapper installs the captured
  // native descriptor as its lease. A caller that re-installs that same native
  // descriptor during the window makes a real mutation the wrapper cannot see:
  // the value is byte-for-byte equal to the lease. Telling the two apart needs
  // an identity the caller cannot forge (a fresh getter installed for the
  // window). Until src/request-plan.ts does that, this test states the gap.
  // When the gap closes, vitest reports this `fails` test as unexpectedly
  // passing, and the marker comes off.
  test.fails("a mutation to the captured descriptor is not mistaken for an untouched lease", async () => {
    const callerDescriptor = {
      configurable: true,
      enumerable: true,
      get: () => "https://round5-before.invalid/visible",
    } satisfies PropertyDescriptor;
    Object.defineProperty(NATIVE_REQUEST.prototype, "url", callerDescriptor);

    const request = new NATIVE_REQUEST("http://127.0.0.1:1/round5-captured");
    let headersRead = false;
    const options = {
      get headers(): HeadersInit {
        headersRead = true;
        // The caller removes its temporary patch while the wrapper has the
        // captured native descriptor installed. This is a real mutation even
        // though the resulting descriptor is byte-for-byte equal to the
        // wrapper's lease. A direct native fetch leaves the native descriptor
        // in place; typedFetch must preserve the same observable state.
        Object.defineProperty(NATIVE_REQUEST.prototype, "url", NATIVE_URL!);
        return {};
      },
    } satisfies TypedFetchOptions;

    const result = await typedFetch(request, options);

    expect(headersRead).toBe(true);
    expect(isNetworkError(result.error)).toBe(true);
    expect(Object.getOwnPropertyDescriptor(NATIVE_REQUEST.prototype, "url")).toEqual(NATIVE_URL);
  });
});
