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

describe("round 4 / agent 1 — request-plan and transport boundary", () => {
  test("a prototype mutation made by an init getter is not overwritten by temporary repair", async () => {
    const beforeTransport = {
      configurable: true,
      enumerable: true,
      get: () => "https://round4-before.invalid/visible",
    } satisfies PropertyDescriptor;
    const duringTransport = {
      configurable: true,
      enumerable: true,
      get: () => "https://round4-during.invalid/visible",
    } satisfies PropertyDescriptor;
    Object.defineProperty(NATIVE_REQUEST.prototype, "url", beforeTransport);

    const bareRequest = new NATIVE_REQUEST("http://127.0.0.1:1/round4-bare");
    await NATIVE_FETCH(bareRequest, {
      get headers(): HeadersInit {
        Object.defineProperty(NATIVE_REQUEST.prototype, "url", duringTransport);
        return {};
      },
    }).catch(() => undefined);
    // The platform call itself leaves a mutation made by its init getter in
    // place. This is the control establishing the expected observable state;
    // the wrapper below is the only extra actor.
    expect(Object.getOwnPropertyDescriptor(NATIVE_REQUEST.prototype, "url")?.get).toBe(
      duringTransport.get,
    );
    Object.defineProperty(NATIVE_REQUEST.prototype, "url", beforeTransport);

    const request = new NATIVE_REQUEST("http://127.0.0.1:1/round4-mutation");

    let getterRan = false;
    const options = {
      get headers(): HeadersInit {
        getterRan = true;
        Object.defineProperty(NATIVE_REQUEST.prototype, "url", duringTransport);
        return {};
      },
    } as TypedFetchOptions;

    const result = await typedFetch(request, options);

    expect(getterRan).toBe(true);
    expect(isNetworkError(result.error)).toBe(true);
    // `fetchWithCapturedRequestPrototype` repairs the native getters only for
    // the synchronous native-fetch normalization. Once caller code runs in
    // that normalization, its later mutation is caller state and must remain
    // observable after the wrapper returns. The current implementation
    // restores `beforeTransport` unconditionally and loses this mutation.
    expect(Object.getOwnPropertyDescriptor(NATIVE_REQUEST.prototype, "url")?.get).toBe(
      duringTransport.get,
    );
  });
});
