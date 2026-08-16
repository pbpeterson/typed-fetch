import { describe, expect, test, vi } from "vitest";

type GlobalName = "Request" | "Response" | "ReadableStream" | "fetch";

function swapGlobal(name: GlobalName, value: unknown): () => void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, {
    configurable: true,
    enumerable: previous?.enumerable ?? false,
    value,
    writable: true,
  });

  return () => {
    if (previous) Object.defineProperty(globalThis, name, previous);
    else Reflect.deleteProperty(globalThis, name);
  };
}

async function freshRequestPlan() {
  vi.resetModules();
  return import("../../src/request-plan");
}

function cloneResponseShape(overrides: Record<PropertyKey, unknown> = {}): Response {
  const bodyMethods = {
    cancel: () => undefined,
    getReader: () => ({}),
    pipeThrough: () => undefined,
    pipeTo: () => Promise.resolve(),
    tee: () => [],
  };
  const response: Record<PropertyKey, unknown> = {
    [Symbol.toStringTag]: "Response",
    body: null,
    bodyUsed: false,
    headers: new Headers(),
    ok: false,
    redirected: false,
    status: 404,
    statusText: "Not Found",
    type: "basic",
    url: "https://coverage.invalid/clone",
    arrayBuffer: async () => new ArrayBuffer(0),
    blob: async () => new Blob(),
    clone: () => response,
    formData: async () => new FormData(),
    json: async () => ({}),
    text: async () => "",
  };
  Object.assign(response, overrides);
  if (overrides.body === "object") response.body = { locked: false, ...bodyMethods };
  return response as unknown as Response;
}

describe("coverage edges that are observable through the public seams", () => {
  test("takes the transport fallback when captured Request slots are absent", async () => {
    class BareRequest {
      readonly url = "https://coverage.invalid/bare";
      readonly signal = null;
    }
    const fetchCalls: unknown[] = [];
    const transport = (async (input: unknown) => {
      fetchCalls.push(input);
      return new Response(null);
    }) as typeof fetch;
    const restoreRequest = swapGlobal("Request", BareRequest);
    const restoreFetch = swapGlobal("fetch", transport);
    try {
      const { planRequest } = await freshRequestPlan();
      Object.defineProperties(BareRequest.prototype, {
        url: { configurable: true, value: "prototype-url" },
        signal: { configurable: true, value: null },
      });

      const input = new BareRequest();
      const plan = planRequest(input as never, {});
      await plan.transport(plan.transportInput, plan.init);

      expect(fetchCalls).toEqual([input]);
    } finally {
      restoreFetch();
      restoreRequest();
      vi.resetModules();
    }
  });

  test("covers data descriptors and explicit data/accessor stringifiers", async () => {
    class NativeRequest {
      readonly url = "https://coverage.invalid/native";
      readonly signal = null;
    }
    Object.defineProperties(NativeRequest.prototype, {
      url: { configurable: true, enumerable: true, value: "prototype-url", writable: true },
      signal: { configurable: true, enumerable: true, value: null, writable: true },
    });
    const transport = (async () => new Response(null)) as typeof fetch;
    const restoreRequest = swapGlobal("Request", NativeRequest);
    const restoreFetch = swapGlobal("fetch", transport);
    try {
      const { planRequest } = await freshRequestPlan();
      const nativeInput = new NativeRequest();
      expect(planRequest(nativeInput as never, {}).transportInput).toBe(nativeInput);

      Object.defineProperty(NativeRequest.prototype, "url", {
        configurable: true,
        enumerable: false,
        value: "prototype-url",
        writable: true,
      });
      const enumerableMismatch = planRequest(nativeInput as never, {});
      await enumerableMismatch.transport(
        enumerableMismatch.transportInput,
        enumerableMismatch.init,
      );

      Object.defineProperty(NativeRequest.prototype, "signal", {
        configurable: false,
        enumerable: true,
        value: null,
        writable: true,
      });
      const restoreFailure = planRequest(nativeInput as never, {});
      await restoreFailure.transport(restoreFailure.transportInput, restoreFailure.init);

      class DataStringRequest {
        readonly url = "https://coverage.invalid/data";
      }
      Object.defineProperty(DataStringRequest.prototype, "toString", {
        configurable: true,
        value: () => "[object Object]",
      });
      Object.defineProperty(globalThis, "Request", {
        configurable: true,
        value: DataStringRequest,
        writable: true,
      });
      const data = planRequest(new DataStringRequest() as never, {});
      expect(data.requestUrl).toBe("[object Object]");

      class PrimitiveStringRequest {
        readonly url = "https://coverage.invalid/primitive";
      }
      Object.defineProperty(PrimitiveStringRequest.prototype, Symbol.toPrimitive, {
        configurable: true,
        value: () => "[object Object]",
      });
      Object.defineProperty(globalThis, "Request", {
        configurable: true,
        value: PrimitiveStringRequest,
        writable: true,
      });
      const primitive = planRequest(new PrimitiveStringRequest() as never, {});
      expect(primitive.requestUrl).toBe("[object Object]");

      class AccessorPrimitiveRequest {
        readonly url = "https://coverage.invalid/accessor-primitive";
      }
      Object.defineProperty(AccessorPrimitiveRequest.prototype, Symbol.toPrimitive, {
        configurable: true,
        get: () => () => "[object Object]",
      });
      Object.defineProperty(globalThis, "Request", {
        configurable: true,
        value: AccessorPrimitiveRequest,
        writable: true,
      });
      const accessorPrimitive = planRequest(new AccessorPrimitiveRequest() as never, {});
      expect(accessorPrimitive.requestUrl).toBe("[object Object]");

      class AccessorStringRequest {
        readonly url = "https://coverage.invalid/accessor-string";
      }
      Object.defineProperty(AccessorStringRequest.prototype, "toString", {
        configurable: true,
        get: () => () => "[object Object]",
      });
      Object.defineProperty(globalThis, "Request", {
        configurable: true,
        value: AccessorStringRequest,
        writable: true,
      });
      const accessorString = planRequest(new AccessorStringRequest() as never, {});
      expect(accessorString.requestUrl).toBe("[object Object]");

      function LooseRequest(): void {}
      Object.defineProperty(LooseRequest, Symbol.hasInstance, {
        configurable: true,
        value: () => true,
      });
      Object.defineProperty(globalThis, "Request", {
        configurable: true,
        value: LooseRequest,
        writable: true,
      });
      const noStringifier = Object.create(null) as { url: string; valueOf(): string };
      noStringifier.url = "https://coverage.invalid/no-stringifier";
      noStringifier.valueOf = () => "[object Object]";
      const noStringifierPlan = planRequest(noStringifier as never, {});
      expect(noStringifierPlan.requestUrl).toBe(noStringifier.url);

      class CallerRequest {
        readonly signal = null;
      }
      Object.defineProperty(globalThis, "Request", {
        configurable: true,
        value: CallerRequest,
        writable: true,
      });
      const callerTransport = ((input: RequestInfo | URL, init?: RequestInit) =>
        transport(input, init)) as typeof fetch;
      const callerPlan = planRequest(new CallerRequest() as never, { fetch: callerTransport });
      expect(callerPlan.signal).toBeUndefined();

      const noSignalPlan = planRequest("https://coverage.invalid/no-signal", { method: "GET" });
      expect(noSignalPlan.init.method).toBe("GET");
    } finally {
      restoreFetch();
      restoreRequest();
      vi.resetModules();
    }
  });

  test("restores a captured property whose previous descriptor was absent", async () => {
    class BareRequest {
      readonly url = "https://coverage.invalid/restore";
      readonly signal = null;
    }
    Object.defineProperties(BareRequest.prototype, {
      url: { configurable: true, value: "prototype-url", writable: true },
      signal: { configurable: true, value: null, writable: true },
    });
    const transport = (async () => new Response(null)) as typeof fetch;
    const restoreRequest = swapGlobal("Request", BareRequest);
    const restoreFetch = swapGlobal("fetch", transport);
    try {
      const { planRequest } = await freshRequestPlan();
      Reflect.deleteProperty(BareRequest.prototype, "url");
      const input = new BareRequest();
      const plan = planRequest(input as never, {});
      await plan.transport(plan.transportInput, plan.init);

      expect(Object.hasOwn(BareRequest.prototype, "url")).toBe(false);
    } finally {
      restoreFetch();
      restoreRequest();
      vi.resetModules();
    }
  });

  test("exercises the foreign clone-response validation matrix without a native Response", async () => {
    const restoreResponse = swapGlobal("Response", undefined);
    try {
      vi.resetModules();
      const { NotFoundError } = await import("../../src/errors/not-found-error");

      const valid = cloneResponseShape({ body: "object" });
      const original = {
        body: null,
        bodyUsed: false,
        headers: new Headers(),
        status: 404,
        statusText: "Not Found",
        url: "https://coverage.invalid/original",
        clone: () => valid,
      } as unknown as Response;
      const accepted = new NotFoundError(original).clone();
      expect(accepted).toBeInstanceOf(NotFoundError);

      const invalidShapes: Array<Record<PropertyKey, unknown>> = [
        { arrayBuffer: undefined },
        { body: "text" },
        { body: { locked: "no", cancel: () => undefined } },
        {
          body: {
            locked: false,
            cancel: () => undefined,
            getReader: () => ({}),
            pipeThrough: () => undefined,
            pipeTo: () => Promise.resolve(),
          },
        },
        { bodyUsed: "false" },
        { headers: null },
        { headers: { get: () => undefined } },
        {
          headers: {
            append: () => undefined,
            delete: () => undefined,
            entries: () => [],
            forEach: () => undefined,
            get: () => undefined,
            has: () => false,
            keys: () => [],
            set: () => undefined,
            values: () => [],
          },
        },
      ];

      for (const shape of invalidShapes) {
        const branch = cloneResponseShape(shape);
        const victim = {
          body: null,
          bodyUsed: false,
          headers: new Headers(),
          status: 404,
          statusText: "Not Found",
          url: "https://coverage.invalid/victim",
          clone: () => branch,
        } as unknown as Response;
        expect(() => new NotFoundError(victim).clone()).toThrow(TypeError);
      }

      const throwing = new Proxy(cloneResponseShape(), {
        get(target, property, receiver) {
          if (property === "body") throw new Error("clone body read failed");
          return Reflect.get(target, property, receiver);
        },
      });
      const throwingVictim = {
        body: null,
        bodyUsed: false,
        headers: new Headers(),
        status: 404,
        statusText: "Not Found",
        url: "https://coverage.invalid/throwing",
        clone: () => throwing,
      } as unknown as Response;
      expect(() => new NotFoundError(throwingVictim).clone()).toThrow(TypeError);

      const hostileMethod = cloneResponseShape();
      Object.defineProperty(hostileMethod, "text", {
        configurable: true,
        get() {
          throw new Error("clone method read failed");
        },
      });
      const hostileVictim = {
        body: null,
        bodyUsed: false,
        headers: new Headers(),
        status: 404,
        statusText: "Not Found",
        url: "https://coverage.invalid/hostile-method",
        clone: () => hostileMethod,
      } as unknown as Response;
      expect(() => new NotFoundError(hostileVictim).clone()).toThrow(TypeError);
    } finally {
      restoreResponse();
      vi.resetModules();
    }
  });

  test("exercises the error-body cleanup fallbacks and hostile reads", async () => {
    vi.resetModules();
    const bodyModule = await import("../../src/errors/error-body");
    const primitive = 1 as unknown as Response;
    expect(bodyModule.rememberResponseBody(primitive, null)).toBeUndefined();
    bodyModule.forgetResponseBody(primitive);
    expect(bodyModule.responseBodySnapshot(primitive)).toBeUndefined();

    const unreadable = {
      get locked(): never {
        throw new Error("locked read failed");
      },
    };
    expect(bodyModule.rememberResponseBody({} as Response, unreadable)).toBeUndefined();

    const noFallbackBody = { locked: false };
    await bodyModule.errorBodyOf({ body: noFallbackBody, bodyUsed: false } as Response).cancel();

    const thenGetterThrows = {
      // oxlint-disable-next-line no-thenable -- the probe intentionally models a hostile thenable
      get then(): never {
        throw new Error("then read failed");
      },
      catch: () => undefined,
    };
    bodyModule.releaseResponseBody({
      body: { locked: false, cancel: () => thenGetterThrows },
    } as unknown as Response);

    let release!: () => void;
    let calls = 0;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pendingResponse = {
      body: {
        locked: false,
        cancel: () => {
          calls += 1;
          return pending;
        },
      },
    } as unknown as Response;
    bodyModule.releaseResponseBody(pendingResponse);
    bodyModule.releaseResponseBody(pendingResponse);
    release();
    await Promise.resolve();
    await Promise.resolve();
    bodyModule.releaseResponseBody(pendingResponse);
    expect(calls).toBe(2);

    const lockedStream = new ReadableStream<Uint8Array>();
    lockedStream.getReader();
    bodyModule.releaseResponseBody({ body: lockedStream } as unknown as Response);

    const badBodyUsed = {} as Record<string, unknown>;
    Object.defineProperty(badBodyUsed, "body", { value: noFallbackBody });
    Object.defineProperty(badBodyUsed, "bodyUsed", {
      configurable: true,
      get: () => "not-a-boolean",
    });
    await bodyModule.errorBodyOf(badBodyUsed as unknown as Response).cancel();

    const throwingBodyUsed = {} as Record<string, unknown>;
    Object.defineProperty(throwingBodyUsed, "body", { value: noFallbackBody });
    Object.defineProperty(throwingBodyUsed, "bodyUsed", {
      configurable: true,
      get: () => {
        throw new Error("bodyUsed read failed");
      },
    });
    await expect(
      bodyModule.errorBodyOf(throwingBodyUsed as unknown as Response).cancel(),
    ).resolves.toBeUndefined();
  });

  test("records status re-entry and protects an active body from a nested refusal", async () => {
    vi.resetModules();
    const identity = await import("../../src/errors/response-identity");
    const verdictModule = await import("../../src/response-verdict");

    let statusResponse!: Response;
    statusResponse = {
      get status() {
        return identity.statusOf(statusResponse);
      },
    } as Response;
    expect(() => identity.statusOf(statusResponse)).toThrow(
      "response status read was re-entered before it completed",
    );

    let phase = 0;
    let lockDepth = 0;
    let bodyReads = 0;
    let nestedFirst: unknown;
    let nestedSecond: unknown;
    const sharedBody: Record<PropertyKey, unknown> = {
      cancel: () => undefined,
      getReader: () => ({}),
      pipeThrough: () => sharedBody,
      pipeTo: () => Promise.resolve(),
      tee: () => [],
      get locked() {
        if (lockDepth === 0 && phase === 0) {
          lockDepth += 1;
          nestedFirst = verdictModule.classifyResolvedValue(nestedResponse);
          lockDepth -= 1;
          phase = 1;
        }
        return false;
      },
    };
    const nestedResponse: Record<PropertyKey, unknown> = {
      [Symbol.toStringTag]: "Response",
      get body() {
        bodyReads += 1;
        return bodyReads === 1 ? sharedBody : "not-a-body";
      },
      bodyUsed: false,
      headers: new Headers(),
      ok: true,
      redirected: false,
      status: 200,
      statusText: "OK",
      type: "basic",
      url: "https://coverage.invalid/nested",
      arrayBuffer: async () => new ArrayBuffer(0),
      blob: async () => new Blob(),
      clone: () => nestedResponse,
      // The first nested presentation is refused after its body is registered.
      get formData() {
        return phase === 0 ? undefined : async () => new FormData();
      },
      json: async () => ({}),
      text: async () => "",
    };
    const outerResponse: Record<PropertyKey, unknown> = {
      [Symbol.toStringTag]: "Response",
      body: sharedBody,
      bodyUsed: false,
      headers: new Headers(),
      get ok() {
        return true;
      },
      redirected: false,
      get status() {
        if (phase === 1) {
          phase = 2;
          nestedSecond = verdictModule.classifyResolvedValue(nestedResponse);
        }
        return 200;
      },
      statusText: "OK",
      type: "basic",
      url: "https://coverage.invalid/outer",
      arrayBuffer: async () => new ArrayBuffer(0),
      blob: async () => new Blob(),
      clone: () => outerResponse,
      formData: async () => new FormData(),
      json: async () => ({}),
      text: async () => "",
    };

    const outer = verdictModule.classifyResolvedValue(outerResponse);
    expect(outer.kind).toBe("success");
    expect((nestedFirst as { kind: string }).kind).toBe("refused");
    expect((nestedSecond as { kind: string }).kind).toBe("refused");

    const bodyOwner = await import("../../src/errors/error-body");
    let seededBodyLock = false;
    let triggerSeededNested = false;
    let seededOuter!: unknown;
    const seededBody: Record<PropertyKey, unknown> = {
      cancel: () => undefined,
      getReader: () => ({}),
      pipeThrough: () => seededBody,
      pipeTo: () => Promise.resolve(),
      tee: () => [],
      get locked() {
        if (triggerSeededNested && !seededBodyLock) {
          seededBodyLock = true;
          seededOuter = verdictModule.classifyResolvedValue(seededNestedResponse);
        }
        return false;
      },
    };
    const seededNestedResponse = {
      [Symbol.toStringTag]: "Response",
      body: "not-a-body",
      bodyUsed: false,
      headers: new Headers(),
      ok: true,
      redirected: false,
      status: 200,
      statusText: "OK",
      type: "basic",
      url: "https://coverage.invalid/seeded-nested",
      arrayBuffer: async () => new ArrayBuffer(0),
      blob: async () => new Blob(),
      clone: () => seededNestedResponse,
      formData: async () => new FormData(),
      json: async () => ({}),
      text: async () => "",
    } as unknown as Response;
    bodyOwner.rememberResponseBody(seededNestedResponse, seededBody);
    const seededOuterResponse = {
      [Symbol.toStringTag]: "Response",
      body: seededBody,
      bodyUsed: false,
      headers: new Headers(),
      ok: true,
      redirected: false,
      status: 200,
      statusText: "OK",
      type: "basic",
      url: "https://coverage.invalid/seeded-outer",
      arrayBuffer: async () => new ArrayBuffer(0),
      blob: async () => new Blob(),
      clone: () => seededOuterResponse,
      formData: async () => new FormData(),
      json: async () => ({}),
      text: async () => "",
    } as unknown as Response;
    bodyOwner.rememberResponseBody(seededOuterResponse, seededBody);
    triggerSeededNested = true;
    const seeded = verdictModule.classifyResolvedValue(seededOuterResponse);
    expect(seeded.kind).toBe("success");
    expect((seededOuter as { kind: string }).kind).toBe("refused");

    const throwingStatus = {
      [Symbol.toStringTag]: "Response",
      body: seededBody,
      bodyUsed: false,
      headers: new Headers(),
      ok: true,
      redirected: false,
      get status(): never {
        throw new Error("status failure after body");
      },
      statusText: "OK",
      type: "basic",
      url: "https://coverage.invalid/status-failure",
      arrayBuffer: async () => new ArrayBuffer(0),
      blob: async () => new Blob(),
      clone: () => throwingStatus,
      formData: async () => new FormData(),
      json: async () => ({}),
      text: async () => "",
    } as unknown as Response;
    const statusFailure = verdictModule.classifyResolvedValue(throwingStatus);
    expect(statusFailure.kind).toBe("refused");

    const inheritedSetterPrototype = {};
    Object.defineProperty(inheritedSetterPrototype, "bodyUsed", {
      configurable: true,
      set: () => undefined,
    });
    const inheritedSetterResponse = Object.create(inheritedSetterPrototype) as Record<
      PropertyKey,
      unknown
    >;
    inheritedSetterResponse.body = { locked: false };
    await bodyOwner.errorBodyOf(inheritedSetterResponse as unknown as Response).cancel();
  });
  test("cleanup settles and raises no unhandled rejection when the Promise intrinsics are hostile", async () => {
    // WHAT THIS ASSERTS, and why it is not a coverage row. `releaseResponseBody`
    // returns `void`: its whole contract is that a best-effort cleanup never
    // throws at the caller and never leaves a rejection nobody observed. Three
    // fallbacks exist for a platform whose `Promise.resolve` or
    // `Promise.prototype.then` throws — `error-body.ts:263, 273, 286` — and the
    // row that used to cover them executed all three and asserted NOTHING, so
    // every mutation on those lines survived. These assertions read the contract
    // instead of the line number.
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    const settle = async (): Promise<void> => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    };
    try {
      const NativePromise = globalThis.Promise;
      const resolveDescriptor = Object.getOwnPropertyDescriptor(NativePromise, "resolve")!;
      const thenDescriptor = Object.getOwnPropertyDescriptor(NativePromise.prototype, "then")!;

      const restorePromise = (): void => {
        Object.defineProperty(NativePromise, "resolve", resolveDescriptor);
        // oxlint-disable-next-line no-thenable -- restore the native Promise method
        Object.defineProperty(NativePromise.prototype, "then", thenDescriptor);
        vi.resetModules();
      };

      const resolveSentinel = {};
      Object.defineProperty(NativePromise, "resolve", {
        configurable: true,
        value(value: unknown) {
          if (value === resolveSentinel) throw new Error("resolve failed");
          return Reflect.apply(resolveDescriptor.value as typeof Promise.resolve, NativePromise, [
            value,
          ]);
        },
        writable: true,
      });
      try {
        vi.resetModules();
        const bodyModule = await import("../../src/errors/error-body");
        bodyModule.releaseResponseBody({
          body: { locked: false, cancel: () => resolveSentinel },
        } as unknown as Response);
      } finally {
        restorePromise();
      }

      let thenCalls = 0;
      let armThenFailure = false;
      const nativeThen = thenDescriptor.value as typeof Promise.prototype.then;
      // oxlint-disable-next-line no-thenable -- replace the native method for the rejection probe
      Object.defineProperty(NativePromise.prototype, "then", {
        configurable: true,
        value(this: Promise<unknown>, ...args: Parameters<typeof nativeThen>) {
          if (armThenFailure && thenCalls++ === 0) throw new Error("then failed");
          return Reflect.apply(nativeThen, this, args);
        },
        writable: true,
      });
      try {
        vi.resetModules();
        const bodyModule = await import("../../src/errors/error-body");
        armThenFailure = true;
        bodyModule.releaseResponseBody({
          body: { locked: false, cancel: () => undefined },
        } as unknown as Response);
      } finally {
        restorePromise();
      }

      const legacySentinel = {};
      Object.defineProperty(NativePromise, "resolve", {
        configurable: true,
        value(value: unknown) {
          if (value === legacySentinel) throw new Error("legacy resolve failed");
          return Reflect.apply(resolveDescriptor.value as typeof Promise.resolve, NativePromise, [
            value,
          ]);
        },
        writable: true,
      });
      try {
        vi.resetModules();
        const bodyModule = await import("../../src/errors/error-body");
        bodyModule.releaseResponseBody({
          body: {
            locked: false,
            cancel: () => ({
              // oxlint-disable-next-line no-thenable -- the probe intentionally models a catch-only thenable
              then: undefined,
              catch: () => legacySentinel,
            }),
          },
        } as unknown as Response);
      } finally {
        restorePromise();
      }
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }

    await settle();
    expect(unhandled, "a hostile Promise intrinsic must not strand a rejection").toEqual([]);
  });
  test("treats a throwing Request descriptor surface as modified", async () => {
    let throwDescriptors = false;
    const prototypeTarget = {
      url: "https://coverage.invalid/throwing-prototype",
      signal: null,
    };
    const prototype = new Proxy(prototypeTarget, {
      getOwnPropertyDescriptor(target, property) {
        if (throwDescriptors) throw new Error("descriptor read failed");
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });
    const constructorTarget = function RequestTarget(): void {};
    const RequestProxy = new Proxy(constructorTarget, {
      get(target, property, receiver) {
        if (property === "prototype") return prototype;
        return Reflect.get(target, property, receiver);
      },
    });
    const input = Object.create(prototype) as { url: string; signal: null };
    const transport = (async () => new Response(null)) as typeof fetch;
    const restoreRequest = swapGlobal("Request", RequestProxy);
    const restoreFetch = swapGlobal("fetch", transport);
    try {
      const { planRequest } = await freshRequestPlan();
      throwDescriptors = true;
      const plan = planRequest(input as never, {});
      expect(plan.transportInput).toBe(input);
    } finally {
      restoreFetch();
      restoreRequest();
      vi.resetModules();
    }
  });

  test("uses the no-platform cleanup path when Response is absent", async () => {
    const restoreResponse = swapGlobal("Response", undefined);
    const restoreStream = swapGlobal("ReadableStream", undefined);
    try {
      vi.resetModules();
      const bodyModule = await import("../../src/errors/error-body");
      // The row this replaces called `cancel()` and asserted NOTHING, so every
      // mutation on `error-body.ts:464` survived. `cancel()` is documented to
      // settle rather than throw — README, "A repeated `cancel()` … never
      // reports success before the first call settles" — and that is the
      // property a runtime with no `Response` must not break.
      await expect(
        bodyModule
          .errorBodyOf({ body: { locked: false }, bodyUsed: false } as unknown as Response)
          .cancel(),
        "cancel() must settle when the runtime exposes no Response",
      ).resolves.toBeUndefined();
    } finally {
      restoreStream();
      restoreResponse();
      vi.resetModules();
    }
  });
  test("covers a captured bodyUsed getter with no repair prototype", async () => {
    let prototypeReads = 0;
    const fakePrototype = {
      get body() {
        throw new Error("body slot unavailable");
      },
      get bodyUsed() {
        throw new Error("bodyUsed slot unavailable");
      },
    };
    const responseBinding = {
      get prototype() {
        prototypeReads += 1;
        return prototypeReads <= 2 ? fakePrototype : undefined;
      },
    };
    const restoreResponse = swapGlobal("Response", responseBinding);
    try {
      vi.resetModules();
      const bodyModule = await import("../../src/errors/error-body");
      // Same repair as the row above: assert the settle, not the line.
      await expect(
        bodyModule
          .errorBodyOf({ body: { locked: false }, bodyUsed: false } as unknown as Response)
          .cancel(),
        "cancel() must settle when the repair prototype refuses every slot",
      ).resolves.toBeUndefined();
    } finally {
      restoreResponse();
      vi.resetModules();
    }
  });
  test("works when the runtime has no Request global", async () => {
    const restore = swapGlobal("Request", undefined);
    const restoreFetch = swapGlobal("fetch", undefined);
    try {
      const { planRequest } = await freshRequestPlan();
      const input = {
        [Symbol.toStringTag]: "Request",
        url: "https://coverage.invalid/no-request",
        signal: null,
      };
      const transport = (async () => new Response(null)) as typeof fetch;
      const plan = planRequest(input as never, { fetch: transport });

      expect(plan.transportInput).toBe(input);
      expect(plan.requestUrl).toBe(input.url);
      expect(plan.signal).toBeUndefined();
    } finally {
      restoreFetch();
      restore();
      vi.resetModules();
    }
  });

  test("survives hostile tag, URL, and signal reads", async () => {
    const { planRequest } = await freshRequestPlan();
    const transport = (async () => new Response(null)) as typeof fetch;
    const tagFailure = new Proxy(
      {
        toString: () => "https://coverage.invalid/tag-failure",
      },
      {
        get(target, property, receiver) {
          if (property === Symbol.toStringTag) throw new Error("tag read failed");
          return Reflect.get(target, property, receiver);
        },
      },
    );
    expect(planRequest(tagFailure as never, {}).requestUrl).toBe(
      "https://coverage.invalid/tag-failure",
    );

    const urlFailure = {
      [Symbol.toStringTag]: "Request",
      get url(): never {
        throw new Error("url read failed");
      },
      signal: null,
    };
    const urlPlan = planRequest(urlFailure as never, { fetch: transport });
    expect(urlPlan.requestUrl).toBe("");

    const signalFailure = {
      [Symbol.toStringTag]: "Request",
      url: "https://coverage.invalid/signal-failure",
      get signal(): never {
        throw new Error("signal read failed");
      },
    };
    const signalPlan = planRequest(signalFailure as never, { fetch: transport });
    expect(signalPlan.signal).toBeUndefined();
  });
});
