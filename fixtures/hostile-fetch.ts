import type { TypedFetchOptions } from "../src/index";

/**
 * The conformance corpus for ADR 0003 — one entry per IN-SCOPE row of the
 * untrusted-`fetch` boundary.
 *
 * `typedFetch` documents its `fetch` option as a seam a consumer is invited to
 * use, which makes whatever comes back through it untrusted input. This file is
 * the executable half of the decision about how far that distrust goes: every
 * row of ADR 0003's in-scope table appears here, driven end to end, and
 * `conformance.spec.ts` asserts the two lists are the same set.
 *
 * Adding a defense means adding a row THERE first. A scenario with no ADR row,
 * or an ADR row with no scenario, fails the suite — which is the whole point:
 * the boundary cannot quietly move.
 */

/**
 * What the envelope must produce for a scenario.
 *
 * `success` is a real outcome, not a gap. Some hostile shapes are deliberately
 * NOT errors — a status that compares below 400 is a status, whoever reported
 * it — and a boundary that only lists what it rejects invites the next round to
 * propose rejecting more.
 */
export type Outcome =
  | { readonly kind: "network" }
  | { readonly kind: "aborted" }
  | { readonly kind: "timeout" }
  | { readonly kind: "success" }
  | { readonly kind: "http"; readonly status: number }
  | { readonly kind: "unknownHttp"; readonly status: number };

export interface HostileScenario {
  /** The ADR 0003 row this scenario is the executable half of. */
  readonly id: string;
  /** The row's title, byte-identical to the ADR's. */
  readonly title: string;
  /** Built per run, so a scenario carrying state cannot leak into the next. */
  readonly options: () => TypedFetchOptions;
  /** The request input, when the scenario is about the input rather than the transport. */
  readonly input?: () => string | URL | Request;
  readonly outcome: Outcome;
  /** Extra assertions for a row whose point is not only the outcome. */
  readonly verify?: (error: unknown) => void;
}

const URL_UNDER_TEST = "https://conformance.invalid/probe";

/** An implementation that resolves whatever it is handed. */
function resolving(value: unknown): typeof fetch {
  return (async () => value) as unknown as typeof fetch;
}

/** An implementation that rejects with whatever it is handed. */
function rejecting(value: unknown): typeof fetch {
  return (async () => {
    throw value;
  }) as unknown as typeof fetch;
}

/** A response-shaped foreign object that passes every structural check. */
function foreignResponse(overrides: Record<string, unknown> = {}): Response {
  const base: Record<string, unknown> = {
    [Symbol.toStringTag]: "Response",
    body: null,
    bodyUsed: false,
    headers: new Headers(),
    ok: true,
    redirected: false,
    status: 200,
    statusText: "OK",
    type: "basic",
    url: URL_UNDER_TEST,
    arrayBuffer: async () => new ArrayBuffer(0),
    blob: async () => new Blob(),
    clone: () => foreignResponse(overrides),
    formData: async () => new FormData(),
    json: async () => ({}),
    text: async () => "",
  };
  const response = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (typeof value === "object" && value !== null && "get" in value) {
      Object.defineProperty(response, key, value as PropertyDescriptor);
    } else {
      response[key] = value;
    }
  }
  return response as unknown as Response;
}

/** A real `Response` with one own accessor shadowing the platform's. */
function shadowed(field: string, descriptor: PropertyDescriptor, init?: ResponseInit): Response {
  const response = new Response(null, init);
  Object.defineProperty(response, field, { configurable: true, ...descriptor });
  return response;
}

/** A signal already aborted with the given reason. */
function abortedWith(reason?: unknown): AbortSignal {
  const controller = new AbortController();
  controller.abort(reason);
  return controller.signal;
}

export const HOSTILE_SCENARIOS: readonly HostileScenario[] = [
  // ── The resolved value is not a Response ─────────────────────────────
  {
    id: "H-01",
    title: "The implementation resolves a value that is not an object",
    options: () => ({ fetch: resolving(undefined) }),
    outcome: { kind: "network" },
  },
  {
    id: "H-02",
    title: "The implementation resolves an object that only spoofs the Response tag",
    options: () => ({ fetch: resolving({ [Symbol.toStringTag]: "Response", status: 200 }) }),
    outcome: { kind: "network" },
  },
  {
    id: "H-03",
    title: "The implementation resolves a Response missing a body reader",
    options: () => {
      const partial = foreignResponse();
      delete (partial as unknown as Record<string, unknown>).json;
      return { fetch: resolving(partial) };
    },
    outcome: { kind: "network" },
  },
  {
    id: "H-04",
    title: "The implementation resolves a Response whose body is not a stream",
    options: () => ({ fetch: resolving(foreignResponse({ body: { locked: "no" } })) }),
    outcome: { kind: "network" },
  },
  {
    id: "H-05",
    title: "The implementation resolves a Response whose bodyUsed is not a boolean",
    options: () => ({ fetch: resolving(foreignResponse({ bodyUsed: "no" })) }),
    outcome: { kind: "network" },
  },

  // ── The identity a Response reports ──────────────────────────────────
  {
    id: "H-06",
    title: "A status getter answers differently on a second read",
    options: () => {
      let reads = 0;
      return {
        fetch: resolving(
          shadowed("status", {
            get() {
              reads += 1;
              return reads === 1 ? 404 : 500;
            },
          }),
        ),
      };
    },
    outcome: { kind: "http", status: 404 },
  },
  {
    id: "H-07",
    title: "A status getter throws",
    options: () => ({
      fetch: resolving(
        shadowed("status", {
          get() {
            throw new Error("status getter exploded");
          },
        }),
      ),
    }),
    outcome: { kind: "network" },
  },
  {
    id: "H-08",
    title: "A status that compares below 400, including NaN, is still a success",
    options: () => ({ fetch: resolving(foreignResponse({ status: Number.NaN })) }),
    outcome: { kind: "success" },
  },
  {
    id: "H-09",
    title: "A status outside the roster becomes UnknownHttpError, not a guess",
    options: () => ({ fetch: resolving(foreignResponse({ status: Number.POSITIVE_INFINITY })) }),
    outcome: { kind: "unknownHttp", status: Number.POSITIVE_INFINITY },
  },
  {
    id: "H-10",
    title: "A fractional status is not truncated into a real one",
    options: () => ({ fetch: resolving(foreignResponse({ status: 404.7 })) }),
    outcome: { kind: "unknownHttp", status: 404.7 },
  },
  {
    id: "H-11",
    title: "A statusText that is not a string is normalized, never coerced",
    options: () => ({
      fetch: resolving(foreignResponse({ status: 404, statusText: Symbol("x") })),
    }),
    outcome: { kind: "http", status: 404 },
    verify: (error) => {
      if ((error as { statusText: unknown }).statusText !== "Not Found") {
        throw new Error("expected the class literal, not the wire value");
      }
    },
  },
  {
    id: "H-12",
    title: "A url that is not a string is normalized, never coerced",
    options: () => ({ fetch: resolving(foreignResponse({ status: 404, url: 42 })) }),
    outcome: { kind: "http", status: 404 },
    verify: (error) => {
      if ((error as { url: unknown }).url !== "") throw new Error("expected an empty url");
    },
  },
  {
    id: "H-13",
    title: "A headers getter throws",
    options: () => ({
      fetch: resolving(
        shadowed(
          "headers",
          {
            get() {
              throw new Error("headers getter exploded");
            },
          },
          { status: 404 },
        ),
      ),
    }),
    outcome: { kind: "network" },
  },
  {
    id: "H-14",
    title: "A value refused once has no identity filed against it",
    options: () => {
      const shapeshifter = foreignResponse() as unknown as Record<string, unknown>;
      delete shapeshifter.json;
      let call = 0;
      return {
        fetch: (async () => {
          call += 1;
          if (call === 1) return shapeshifter;
          shapeshifter.json = async () => ({});
          shapeshifter.status = 404;
          shapeshifter.ok = false;
          return shapeshifter;
        }) as unknown as typeof fetch,
      };
    },
    outcome: { kind: "network" },
  },

  // ── How the implementation fails ─────────────────────────────────────
  {
    id: "H-15",
    title: "The implementation rejects with a value that is not an error",
    options: () => ({ fetch: rejecting("just a string") }),
    outcome: { kind: "network" },
  },
  {
    id: "H-16",
    title: "The implementation throws before it returns a promise",
    options: () => ({
      fetch: (() => {
        throw new Error("synchronous transport failure");
      }) as unknown as typeof fetch,
    }),
    outcome: { kind: "network" },
  },
  {
    id: "H-17",
    title: "The governing signal is the authority on an abort, not the rejection name",
    options: () => {
      const signal = abortedWith(new Error("caller's own reason"));
      return { fetch: rejecting(signal.reason), signal };
    },
    outcome: { kind: "aborted" },
  },
  {
    id: "H-18",
    title: "An unrelated failure while the signal is aborted stays a network failure",
    options: () => ({
      fetch: rejecting(new TypeError("bad header name")),
      signal: abortedWith(),
    }),
    outcome: { kind: "network" },
  },
  {
    id: "H-19",
    title: "A timeout is classified by the shape the platform produces",
    options: () => ({
      fetch: rejecting(new DOMException("The operation timed out.", "TimeoutError")),
      signal: abortedWith(new DOMException("The operation timed out.", "TimeoutError")),
    }),
    outcome: { kind: "timeout" },
  },
  {
    id: "H-20",
    title: "A polyfill that rejects with its own AbortError, not the signal reason",
    options: () => ({
      fetch: rejecting(new DOMException("Aborted", "AbortError")),
      signal: abortedWith(),
    }),
    outcome: { kind: "aborted" },
  },

  // ── The options object and the request input ─────────────────────────
  {
    id: "H-21",
    title: "An options object whose property read throws",
    options: () =>
      new Proxy({} as TypedFetchOptions, {
        get(target, property) {
          if (property === "fetch") return resolving(foreignResponse());
          throw new Error("hostile options getter");
        },
      }),
    outcome: { kind: "network" },
  },
  {
    id: "H-22",
    title: "A fetch override inherited from a polluted prototype is never used",
    options: () => {
      const inherited = { fetch: resolving(foreignResponse({ status: 404 })) };
      return Object.create(inherited) as TypedFetchOptions;
    },
    outcome: { kind: "network" },
  },
  {
    id: "H-23",
    title: "A Request-shaped input whose url is not a string",
    input: () =>
      ({
        [Symbol.toStringTag]: "Request",
        get url() {
          return 42;
        },
      }) as unknown as Request,
    options: () => ({ fetch: rejecting(new Error("transport refused")) }),
    outcome: { kind: "network" },
    verify: (error) => {
      if ((error as { url: unknown }).url !== "") throw new Error("expected an empty url");
    },
  },
  {
    id: "H-24",
    title: "A header value the platform refuses never reaches the message",
    options: () => ({ headers: { authorization: "Basic AAAA\nsk_live_CONFORMANCE" } }),
    outcome: { kind: "network" },
    verify: (error) => {
      const message = (error as { message: string }).message;
      if (message.includes("sk_live_CONFORMANCE")) throw new Error("the value reached the message");
      if (message.includes("\n")) throw new Error("a raw newline reached the message");
    },
  },
] as const;

export { URL_UNDER_TEST };
