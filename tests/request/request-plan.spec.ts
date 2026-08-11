import { describe, expect, test } from "vitest";
import { isAbortError, isNetworkError, isTimeoutError } from "../../src/index";
import type { TypedFetchOptions } from "../../src/index";
import { planFailure, planRequest } from "../../src/request-plan";
import { recordingTransport } from "../../fixtures/recording-transport";

// The setup phase's own interface.
//
// The other `request-*` files ask this module about one behavior each, from the
// side the behavior was found on. This file asks it about the interface: the six
// members of the plan, what each one is for, the init the transport reads, the
// one serialization, and the one promise the module makes about failure.
//
// It exists because the setup phase now HAS an interface. Before, "what does the
// transport receive" and "which signal governs" were answerable only by driving
// a request and reading a transport double's arrays, so a test of the setup
// phase cost fifteen lines minimum and thirty typically. These cost three.
//
// The three blocks after "a refused plan" arrived from
// `tests/envelope/typed-fetch.spec.ts`, where they were spelled as whole
// requests against a live server: the options facade, the captured signal, and
// the single serialization. Each of them is a decision `planRequest` reaches
// SYNCHRONOUSLY, before anything is sent, so the transport double they used to
// read the answer back from was measuring instrument and subject at once.
//
// What did NOT come with them is anything a server has to answer. "the caller's
// header reached the wire" and "the inherited `method` reached the server" are
// claims about a REQUEST, and they stay in the envelope suite.

const ABSOLUTE = "https://plan.test/resource";

describe("the plan a call runs on", () => {
  test("an ordinary string input produces every member", () => {
    const transport = recordingTransport();
    const signal = new AbortController().signal;

    const plan = planRequest(ABSOLUTE, { fetch: transport.fetch, method: "POST", signal });

    expect(plan.transportInput).toBe(ABSOLUTE);
    expect(plan.requestUrl).toBe(ABSOLUTE);
    expect(plan.signal).toBe(signal);
    expect(plan.transport).toBe(transport.fetch);
    expect(plan.ambientTransport).toBe(false);
    expect(plan.init.method).toBe("POST");
    expect(plan.init.signal).toBe(signal);
  });

  test("no options at all runs the platform's own transport", () => {
    const plan = planRequest(ABSOLUTE, {});

    expect(plan.transport).toBe(globalThis.fetch);
    expect(plan.ambientTransport).toBe(true);
    expect(plan.signal).toBe(undefined);
  });

  test("an own fetch: undefined keeps the ambient transport while carrying the key", () => {
    // The distinction the module draws everywhere: which transport RUNS, never
    // whether a KEY is present. The key is present here and the platform still
    // runs, so the abort window the transport phase opens still applies.
    const plan = planRequest(ABSOLUTE, { fetch: undefined });

    expect(plan.ambientTransport).toBe(true);
    // The key was own, so the init hides the extension anyway.
    expect("fetch" in plan.init).toBe(false);
  });

  test("a URL object is serialized once, and the transport receives that string", () => {
    const plan = planRequest(new URL(ABSOLUTE), { fetch: recordingTransport().fetch });

    expect(plan.transportInput).toBe(ABSOLUTE);
    expect(plan.requestUrl).toBe(ABSOLUTE);
  });

  test("a platform Request is handed over whole, and files its own url", () => {
    const request = new Request(ABSOLUTE);

    const plan = planRequest(request, {});

    expect(plan.transportInput).toBe(request);
    expect(plan.requestUrl).toBe(ABSOLUTE);
  });

  test("an inherited fetch is neither used nor stripped", () => {
    // ADR 0003 row H-22. The override is an OWN-property read, so a polluted
    // prototype cannot redirect the transport — and the read that STRIPS the
    // extension is guarded by the same predicate, so an inherited `fetch` stays
    // on the object where WebIDL ignores it.
    const transport = recordingTransport();
    const polluted = Object.create({ fetch: transport.fetch }) as { fetch?: typeof fetch };

    const plan = planRequest(ABSOLUTE, polluted);

    expect(plan.transport).toBe(globalThis.fetch);
    expect(plan.ambientTransport).toBe(true);
    // Not stripped: the caller's own object still reports it.
    expect((plan.init as { readonly fetch?: unknown }).fetch).toBe(transport.fetch);
    expect(transport.inputs).toEqual([]);
  });

  test("an own fetch override wins over an inherited one", () => {
    // The other half of the row above. `Object.hasOwn` decides, so the
    // inherited value is not merely deprioritized — it is never read at all.
    const inherited = recordingTransport();
    const own = recordingTransport();
    const options = Object.assign(Object.create({ fetch: inherited.fetch }) as TypedFetchOptions, {
      fetch: own.fetch,
    });

    const plan = planRequest(ABSOLUTE, options);

    expect(plan.transport).toBe(own.fetch);
    expect(plan.ambientTransport).toBe(false);
  });
});

describe("a refused plan", () => {
  test("null options refuse the plan with the url already filed", () => {
    // The ordinary consumer slip. `Object.hasOwn(null, …)` throws, and the
    // correlation between a log line and a request used to go with it.
    let thrown: unknown;
    try {
      planRequest(ABSOLUTE, null as never);
    } catch (refusal) {
      thrown = refusal;
    }

    const error = planFailure(thrown);
    expect(isNetworkError(error)).toBe(true);
    expect(error.url).toBe(ABSOLUTE);
    expect(error.message).toBe("Network error");
  });

  test("a setup failure is never an abort and never a timeout", () => {
    // The rule ADR 0003 rows H-21 and H-28 state. This module never consults a
    // signal, so the rule is structural rather than checked — but a fired
    // timeout beside a throwing options read is the shape that used to break it.
    const signal = AbortSignal.timeout(0);
    let thrown: unknown;
    try {
      planRequest(ABSOLUTE, {
        signal,
        get fetch(): typeof fetch {
          throw new Error("hostile fetch getter");
        },
      });
    } catch (refusal) {
      thrown = refusal;
    }

    const error = planFailure(thrown);
    expect(isNetworkError(error)).toBe(true);
    expect(isAbortError(error)).toBe(false);
    expect(isTimeoutError(error)).toBe(false);
  });

  test("planFailure is total over what it is handed", () => {
    // A value this module did not raise is a defect in this module, and a defect
    // must still leave the caller with an error VALUE rather than an envelope
    // that rejects. It files no url, because a foreign value carries none.
    const cause = new Error("not a plan refusal");

    const error = planFailure(cause);

    expect(isNetworkError(error)).toBe(true);
    expect(error.cause).toBe(cause);
    expect(error.url).toBe("");
    expect(planFailure(undefined).url).toBe("");
  });
});

// ── The init the transport reads ──────────────────────────────────────────
//
// `snapshotRequestInit` builds a facade over the caller's own options object:
// the `fetch` extension is hidden from every reflection channel, the signal is
// materialized so the transport and the classifier agree on one authority, and
// nothing else moves. A fetch implementation is entitled to reflect over its
// init, so the facade must not contradict itself — a key `Reflect.ownKeys`
// lists and `in` denies is a bug the suite has already caught once.

describe("the init the transport reads", () => {
  test("the fetch extension is hidden from every reflection channel", () => {
    const transport = recordingTransport();

    const { init } = planRequest(ABSOLUTE, { method: "POST", fetch: transport.fetch });

    expect("fetch" in init).toBe(false);
    // THE PLAIN READ. A comment once claimed this was covered while the
    // assertions after it checked the `has` trap and the sanitized target
    // instead, so deleting the `get` trap's `fetch` arm left the suite green:
    // `Reflect.get(options, …)` in that trap forwards to the ORIGINAL options
    // object, which does carry the key.
    expect((init as Record<string, unknown>).fetch).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(init, "fetch")).toBeUndefined();
    expect(Reflect.ownKeys(init)).not.toContain("fetch");
    expect(Object.keys({ ...init })).not.toContain("fetch");
    expect(JSON.parse(JSON.stringify(init))).toEqual({ method: "POST" });
  });

  test("an own `fetch` key is stripped even when its value is undefined", () => {
    // The other half of the split the module draws everywhere: which transport
    // RUNS is one question, whether a KEY is present is another. The key is
    // this library's extension and must not reach the transport, whatever it
    // holds.
    const options = { fetch: undefined, method: "POST" as const };

    const { init } = planRequest(ABSOLUTE, options);

    expect("fetch" in init).toBe(false);
    expect(Reflect.ownKeys(init)).not.toContain("fetch");
    expect(init.method).toBe("POST");
  });

  test("no signal slot is invented for a caller that had none", () => {
    // The `signal` descriptor was written unconditionally: `Object.keys` and
    // `Reflect.ownKeys` listed a slot that `"signal" in init` — answered from
    // the original object — denied, and a spread grew a `signal: undefined`
    // member the caller never wrote.
    const { init } = planRequest(ABSOLUTE, {
      method: "POST",
      body: "x",
      fetch: recordingTransport().fetch,
    });

    expect(Reflect.ownKeys(init)).toEqual(["method", "body"]);
    expect(Object.keys(init)).not.toContain("signal");
    expect("signal" in init).toBe(false);
    expect(Object.hasOwn({ ...(init as Record<string, unknown>) }, "signal")).toBe(false);
  });

  test("a caller's own signal slot is present and answers with the captured value", () => {
    // The descriptor exists to keep the `get` trap legal when the target holds
    // an own `signal`, so the slot the caller DID write must still be there and
    // must still answer with the value the plan captured.
    const controller = new AbortController();

    const { init } = planRequest(ABSOLUTE, {
      signal: controller.signal,
      fetch: recordingTransport().fetch,
    });

    expect(Reflect.ownKeys(init)).toContain("signal");
    expect(init.signal).toBe(controller.signal);
    expect("signal" in init).toBe(true);
  });

  test("an inherited signal is materialized as an own key, so a spread keeps it", () => {
    // `{ ...init }` is what a forwarding transport writes, and a spread drops
    // an inherited member. Testing only for an own descriptor dropped it: the
    // `get` trap still answered with the signal, so the request ran UNGOVERNED
    // while `classifyRequestFailure` went on treating that signal as the
    // authority — `controller.abort()` cancelled nothing, and a later network
    // failure was reported as an `AbortedError`.
    // R19-H1-02: this fixture passed NO `fetch` option until round 19. A
    // `fetch` option selects the branch that already carried the entry, so the
    // pin could not fail for the defect its own title names. The `fetch` case
    // is the separate test below, and both branches stay pinned.
    const controller = new AbortController();
    const options = Object.create({ signal: controller.signal }) as Record<string, unknown>;

    const { init } = planRequest(ABSOLUTE, options as TypedFetchOptions);

    expect({ ...init }.signal).toBe(controller.signal);
    expect(init.signal).toBe(controller.signal);
  });

  test("an inherited signal survives the spread on the `fetch`-option branch too", () => {
    // The other arm of the branch R19-H1-02 split out. An own `fetch` makes the
    // snapshot a copy rather than the caller's object, and the entry must reach
    // a forwarding transport's spread there as well.
    const controller = new AbortController();
    const options = Object.create({ signal: controller.signal }) as Record<string, unknown>;
    options.fetch = recordingTransport().fetch;

    const { init } = planRequest(ABSOLUTE, options as TypedFetchOptions);

    expect({ ...init }.signal).toBe(controller.signal);
    expect(init.signal).toBe(controller.signal);
  });

  test("signal: null stays null, and is never rewritten as undefined", () => {
    const { init, signal } = planRequest(ABSOLUTE, {
      signal: null,
      fetch: recordingTransport().fetch,
    });

    expect(init.signal).toBeNull();
    expect(Reflect.ownKeys(init)).toEqual(["signal"]);
    // The plan's own member is the AUTHORITY the classifier consults, and a
    // detached signal governs nothing.
    expect(signal).toBeUndefined();
  });

  test("an inherited WebIDL member survives while the fetch extension is stripped", () => {
    // The platform reads `RequestInit` as a WebIDL dictionary, so an inherited
    // `method` is part of the input. `fetch` is not a dictionary member, so the
    // two are treated differently on purpose.
    const options = Object.assign(Object.create({ method: "POST" }) as TypedFetchOptions, {
      fetch: recordingTransport().fetch,
    });

    const { init } = planRequest(ABSOLUTE, options);

    expect(init.method).toBe("POST");
    expect("fetch" in init).toBe(false);
  });

  test("a prototype getter backed by private state still answers through the facade", () => {
    // Ordinary reads delegate to the ORIGINAL object with the original
    // receiver, because a descriptor-only clone carries neither WebIDL internal
    // slots nor JavaScript private fields.
    class OptionsWithPrivateState {
      readonly #method = "POST";

      constructor(readonly fetch: typeof globalThis.fetch) {}

      get method(): string {
        return this.#method;
      }
    }
    const options = new OptionsWithPrivateState(
      recordingTransport().fetch,
    ) as unknown as TypedFetchOptions;

    const { init } = planRequest(ABSOLUTE, options);

    expect(init.method).toBe("POST");
    expect("fetch" in init).toBe(false);
  });

  test.each([
    ["frozen", (options: Record<string, unknown>) => Object.freeze(options)],
    ["sealed", (options: Record<string, unknown>) => Object.seal(options)],
  ])("a %s options object with an own fetch does not trip the proxy get invariant", (_l, lock) => {
    // A proxy may not report a value other than the one a non-configurable,
    // non-writable own property of its target holds, or the `get` trap throws a
    // TypeError of its own.
    const options: Record<string, unknown> = { method: "PUT", fetch: recordingTransport().fetch };
    Object.defineProperty(options, "readOnly", {
      value: "RO",
      writable: false,
      enumerable: true,
      configurable: false,
    });
    lock(options);

    const init = planRequest(ABSOLUTE, options as TypedFetchOptions).init as unknown as Record<
      string,
      unknown
    >;

    expect(init.method).toBe("PUT");
    expect("fetch" in init).toBe(false);
    expect(init.readOnly).toBe("RO");
    expect(Object.getOwnPropertyDescriptor(init, "readOnly")).toEqual({
      value: "RO",
      writable: false,
      enumerable: true,
      configurable: false,
    });
  });

  test("symbol keys and the prototype survive the facade", () => {
    const marker = Symbol("marker");
    const prototype = { inheritedMethod: "PATCH" };
    const options = Object.create(prototype) as Record<PropertyKey, unknown>;
    options.fetch = recordingTransport().fetch;
    options[marker] = "kept";

    const { init } = planRequest(ABSOLUTE, options as TypedFetchOptions);
    const seen = init as Record<PropertyKey, unknown>;

    expect(Reflect.ownKeys(seen)).toContain(marker);
    expect(seen[marker]).toBe("kept");
    expect(Object.getPrototypeOf(seen)).toBe(prototype);
    expect(seen.inheritedMethod).toBe("PATCH");
  });

  test("an options Proxy reporting keys it does not have does not break the facade", () => {
    const target = { fetch: recordingTransport().fetch };
    const options = new Proxy(target, {
      ownKeys(inner) {
        return [...Reflect.ownKeys(inner), "ghost", "signal"];
      },
      getOwnPropertyDescriptor(inner, property) {
        if (property === "ghost") {
          return { value: "G", enumerable: true, configurable: true, writable: true };
        }
        return Reflect.getOwnPropertyDescriptor(inner, property);
      },
      get(inner, property) {
        return property === "ghost" ? "G" : Reflect.get(inner, property);
      },
      has(inner, property) {
        return property === "ghost" || Reflect.has(inner, property);
      },
    }) as TypedFetchOptions;

    const init = planRequest(ABSOLUTE, options).init as unknown as Record<string, unknown>;

    expect(Reflect.ownKeys(init)).toEqual(["ghost"]);
    expect(init.ghost).toBe("G");
    // `signal` was reported by `ownKeys` but has no descriptor, so it is not
    // invented as an own key of the init.
    expect(Reflect.ownKeys(init)).not.toContain("signal");
  });

  test("a lying has trap on the options object cannot refuse the plan", () => {
    const target: Record<string, unknown> = { fetch: recordingTransport().fetch };
    Object.defineProperty(target, "locked", {
      value: "L",
      writable: false,
      enumerable: true,
      configurable: false,
    });
    const options = new Proxy(target, {
      has(inner, property) {
        return property === "locked" ? false : Reflect.has(inner, property);
      },
    }) as TypedFetchOptions;

    expect(() => planRequest(ABSOLUTE, options)).not.toThrow();
  });

  test.each([
    ["a record", { "X-Custom-Header": "from-a-record" }],
    ["a Headers instance", new Headers({ "X-Custom-Header": "from-a-headers-instance" })],
    ["tuple pairs", [["X-Custom-Header", "from-tuple-pairs"]] as [string, string][]],
  ])("the facade forwards a headers %s BY IDENTITY", (_label, headers) => {
    // The facade delegates each read to the original object, and the transport
    // is the ONLY reader of this slot — `headers` is deliberately not
    // snapshotted, so its getter runs exactly once, as it does under a bare
    // `fetch`. Whether the value then reaches the wire unchanged is a claim
    // about a REQUEST, and it is pinned against the real server in
    // `tests/envelope/typed-fetch.spec.ts`.
    const { init } = planRequest(ABSOLUTE, {
      headers: headers as never,
      fetch: recordingTransport().fetch,
    });

    expect(init.headers).toBe(headers);
  });

  test("the init handed over for planRequest(request) has no own keys", () => {
    const request = new Request(ABSOLUTE);

    const { init, transportInput } = planRequest(request, { fetch: recordingTransport().fetch });

    expect(Reflect.ownKeys(init)).toEqual([]);
    expect("signal" in init).toBe(false);
    expect(init.signal).toBeUndefined();
    expect(transportInput).toBe(request);
  });
});

// ── The captured signal ───────────────────────────────────────────────────
//
// `plan.signal` is the ONE authority `classifyRequestFailure` consults. It is
// read once, into a local, for the same reason `statusOf` records the status it
// read: an injected options object can answer differently on a second read, and
// a second read that answered `undefined` would classify a real abort as a
// network failure and a timeout as neither.

describe("the captured signal", () => {
  test("a signal getter that answers twice cannot split the authority", () => {
    const governing = new AbortController();
    const decoy = new AbortController();
    let reads = 0;
    const options = {
      get signal(): AbortSignal {
        reads += 1;
        return reads === 1 ? governing.signal : decoy.signal;
      },
    } as TypedFetchOptions;

    const plan = planRequest(ABSOLUTE, options);

    expect(reads).toBe(1);
    expect(plan.signal).toBe(governing.signal);
    // And the init reports the SAME object, so the transport governs the
    // request with the signal the classifier will be asked about.
    expect(plan.init.signal).toBe(governing.signal);
  });

  test.each([
    ["no options member at all", {}],
    ["an explicit signal: undefined", { signal: undefined }],
  ])("a Request's own signal is the authority under %s", (_label, options) => {
    // WebIDL treats an explicit `undefined` dictionary member as absent, so
    // `signal: undefined` is NOT a detach.
    const controller = new AbortController();
    const request = new Request(ABSOLUTE, { signal: controller.signal });

    expect(planRequest(request, options).signal).toBe(request.signal);
    expect(controller.signal.aborted).toBe(false);
  });

  test("a Request's own signal survives a fetch override", () => {
    // This module cannot see what caller code does with a `Request`, so it must
    // not branch on which transport runs: a wrapper that logs, retries or
    // counts calls hands the `Request` over WHOLE, and the platform aborts on
    // the slot.
    const controller = new AbortController();
    const request = new Request(ABSOLUTE, { signal: controller.signal });

    const plan = planRequest(request, { fetch: recordingTransport().fetch });

    expect(plan.signal).toBe(request.signal);
  });

  test("an options signal replaces a Request's own signal", () => {
    const fromInit = new AbortController();
    const fromRequest = new AbortController();
    const request = new Request(ABSOLUTE, { signal: fromRequest.signal });

    expect(planRequest(request, { signal: fromInit.signal }).signal).toBe(fromInit.signal);
  });

  test("signal: null detaches a Request's own signal", () => {
    const controller = new AbortController();
    const request = new Request(ABSOLUTE, { signal: controller.signal });

    expect(planRequest(request, { signal: null }).signal).toBeUndefined();
  });
});

// ── The single serialization ──────────────────────────────────────────────
//
// The input is serialized AT MOST ONCE per call, and the transport receives
// that exact string. ADR 0003 row H-26: a request input read twice cannot split
// the request from the error.

describe("the single serialization", () => {
  test("a counting toString is called exactly once", () => {
    let reads = 0;
    const input = {
      toString() {
        reads += 1;
        return ABSOLUTE;
      },
    } as unknown as string;

    const plan = planRequest(input, {});

    expect(reads).toBe(1);
    expect(plan.transportInput).toBe(ABSOLUTE);
    expect(plan.requestUrl).toBe(ABSOLUTE);
  });

  test("a URL subclass is serialized once, through its own toString", () => {
    let reads = 0;
    class CountingUrl extends URL {
      override toString(): string {
        reads += 1;
        return super.toString();
      }
    }

    const plan = planRequest(new CountingUrl(ABSOLUTE), {});

    expect(reads).toBe(1);
    expect(plan.transportInput).toBe(ABSOLUTE);
  });

  test("a platform Request is never serialized", () => {
    const request = new Request(ABSOLUTE);
    let reads = 0;
    Object.defineProperty(request, "toString", {
      configurable: true,
      value() {
        reads += 1;
        return "SERIALIZED";
      },
    });

    const plan = planRequest(request, {});

    expect(reads).toBe(0);
    expect(plan.transportInput).toBe(request);
    expect(plan.requestUrl).toBe(ABSOLUTE);
  });

  test("an own url property cannot shadow the native Request accessor", () => {
    // `Request.prototype.url` is a read-only accessor, so
    // `Object.defineProperty(request, "url", { value })` is the known way a
    // Node adapter rewrites a URL — and a plain read lets that own property
    // shadow the getter. The transport does not consult it: it sends the
    // request to the real URL, and the error named the shadow.
    const request = new Request(ABSOLUTE);
    Object.defineProperty(request, "url", {
      configurable: true,
      value: "https://shadow.invalid/decoy",
    });

    const plan = planRequest(request, {});

    expect(request.url).toBe("https://shadow.invalid/decoy");
    expect(plan.requestUrl).toBe(ABSOLUTE);
  });

  test("a Request-shaped foreign input under the AMBIENT transport files its serialization", () => {
    // The ambient `fetch` resolves `RequestInfo` with its own realm-bound brand
    // check and converts everything else to a `USVString`, so this value is
    // serialized — and the url must name the string the transport receives.
    const foreign = {
      [Symbol.toStringTag]: "Request",
      url: "https://foreign.invalid/real",
      toString() {
        return "https://foreign.invalid/serialized";
      },
    } as unknown as Request;

    const plan = planRequest(foreign, {});

    expect(plan.transportInput).toBe("https://foreign.invalid/serialized");
    expect(plan.requestUrl).toBe("https://foreign.invalid/serialized");
  });

  test("a tagged input handed to a CUSTOM transport files its first url read", () => {
    // Caller code running as the transport writes its own rule about what a
    // request is, so the wider tag check applies and the object is handed over
    // whole. Its `url` is read once.
    let reads = 0;
    const foreign = {
      [Symbol.toStringTag]: "Request",
      get url(): string {
        reads += 1;
        return reads === 1 ? "https://foreign.invalid/first" : "https://foreign.invalid/second";
      },
    } as unknown as Request;

    const plan = planRequest(foreign, { fetch: recordingTransport().fetch });

    expect(reads).toBe(1);
    expect(plan.transportInput).toBe(foreign);
    expect(plan.requestUrl).toBe("https://foreign.invalid/first");
  });

  test("an input whose toString throws refuses the plan with an empty url", () => {
    const input = {
      toString(): never {
        throw new Error("hostile toString");
      },
    } as unknown as string;

    let thrown: unknown;
    try {
      planRequest(input, {});
    } catch (refusal) {
      thrown = refusal;
    }

    const error = planFailure(thrown);
    expect(isNetworkError(error)).toBe(true);
    expect(error.url).toBe("");
  });

  test.each([
    [
      "a Request-tagged object whose url is not a string",
      (): Request =>
        ({
          [Symbol.toStringTag]: "Request",
          get url() {
            return 42;
          },
        }) as unknown as Request,
      "",
    ],
    [
      "a genuine Request subclass that lies about url",
      (): Request => {
        class ForeignRequest extends Request {
          override get url(): string {
            return 42 as unknown as string;
          }
        }
        return new ForeignRequest("https://example.invalid/subclass");
      },
      "https://example.invalid/subclass",
    ],
  ])("%s files a string url naming the request the transport will make", (_l, make, expected) => {
    // The two answers differ, and the difference is the point. A platform
    // `Request` is read through `Request.prototype`'s own getter, because that
    // is the value the TRANSPORT uses. A merely tagged object is not a platform
    // `Request` at all, so there is no native slot to read and the non-string
    // is dropped rather than coerced.
    const plan = planRequest(make(), { fetch: recordingTransport().fetch });

    expect(typeof plan.requestUrl).toBe("string");
    expect(plan.requestUrl).toBe(expected);
  });

  test("a Request-shaped input whose url coerces by throwing does not refuse the plan", () => {
    // `redactUrlInMessage` calls `replaceAll` with the url, which performs
    // ToString on it. A hostile `toString` threw there — past the point the
    // envelope can absorb it — and `typedFetch` rejected instead of returning
    // an error value.
    const hostileInput = {
      [Symbol.toStringTag]: "Request",
      get url() {
        return {
          toString() {
            throw new Error("hostile toString");
          },
        };
      },
    } as unknown as Request;

    expect(planRequest(hostileInput, { fetch: recordingTransport().fetch }).requestUrl).toBe("");
  });
});
