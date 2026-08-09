import { typedFetch, type TypedFetchOptions } from "../src/index";
import { foreignResponses } from "./responses";

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
  /**
   * A second act, for a row whose claim is about what the NEXT call sees.
   *
   * `drive()` builds the options once and runs one request, which is all most
   * rows need. H-14 is about what a value refused once carries afterwards, so
   * it has to present the same value again — and without this hook that half
   * of the row was unreachable code inside the scenario.
   */
  readonly after?: (options: TypedFetchOptions) => Promise<void>;
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

/**
 * A response-shaped foreign object that passes every structural check.
 *
 * The accessor-descriptor arm this corpus needs is now the shared builder's, so
 * the four hand-written copies are one. See `fixtures/responses.ts`.
 */
const foreignResponse = foreignResponses(URL_UNDER_TEST);

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
    // Every stream METHOD is present, so the method gate accepts this body and
    // the `locked` typecheck is the read that decides. A body carrying none of
    // them was refused a step earlier, which left the row driving H-03's gate
    // and the check this row names decided nothing anywhere in the suite.
    options: () => ({
      fetch: resolving(
        foreignResponse({
          body: {
            locked: "no",
            cancel: () => {},
            getReader: () => {},
            pipeThrough: () => {},
            pipeTo: () => {},
            tee: () => {},
          },
        }),
      ),
    }),
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
    // An UNMAPPED status, because a dedicated class declares its own
    // `statusText` literal and never publishes the wire value at all — so this
    // row asserted a class field and the normalizer it names decided nothing.
    // `UnknownHttpError` publishes what the identity module recorded, which is
    // where `String(Symbol)` would throw and a coercion would show.
    options: () => ({
      fetch: resolving(foreignResponse({ status: 599, statusText: Symbol("x") })),
    }),
    outcome: { kind: "unknownHttp", status: 599 },
    verify: (error) => {
      if ((error as { statusText: unknown }).statusText !== "") {
        throw new Error("expected the normalized empty string, not a coerced Symbol");
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
      // Refused LATE, on `type`, which is read AFTER the identity fields. A
      // value refused before any identity read — a missing body reader, say —
      // files nothing whatever this row's guard does, so it drove H-03's gate
      // instead of this one.
      const shapeshifter = foreignResponse({ status: 200 }) as unknown as Record<string, unknown>;
      shapeshifter.type = "not-a-response-type";
      return {
        fetch: (async () => shapeshifter) as unknown as typeof fetch,
      };
    },
    outcome: { kind: "network" },
    // The row IS the second presentation. Without it the scenario only drove
    // H-03's gate, and the branch below was unreachable code in the fixture.
    after: async (options) => {
      // The SAME value, healthy now and reporting a 404. If the refused call
      // had filed its 200, this call would answer with that stale status and
      // come back as a success.
      const shapeshifter = (options.fetch as unknown as () => Promise<Record<string, unknown>>)();
      const value = await shapeshifter;
      value.type = "basic";
      value.status = 404;
      value.ok = false;

      const { response, error } = await typedFetch(URL_UNDER_TEST, options);
      if (response !== null) throw new Error("the refused value's identity was filed and reused");
      if ((error as { status?: unknown } | null)?.status !== 404) {
        throw new Error("expected the status this presentation reported");
      }
      await (error as unknown as { cancel: () => Promise<void> }).cancel();
    },
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
    title: "A platform rejection message is never copied into the error message",
    // The platform reports a request it refused by QUOTING the caller's value
    // back. Copying that message put a credential into `message`, and a raw LF
    // with it. The message is a library constant now, whatever was refused.
    options: () => ({ headers: { authorization: "Basic AAAA\nsk_live_CONFORMANCE" } }),
    outcome: { kind: "network" },
    verify: (error) => {
      const { message, cause } = error as { message: string; cause: unknown };
      if (message !== "Network error") throw new Error(`unexpected message: ${message}`);
      // The diagnostic is not lost. It is reachable on purpose, and only there.
      if (!String(cause).includes("sk_live_CONFORMANCE")) {
        throw new Error("the platform error is not reachable through the cause");
      }
    },
  },
  {
    id: "H-25",
    title: "A refused method or referrer never reaches the message either",
    // The header slots were redacted once; these two never were. Every slot the
    // platform can echo is covered by the same rule now.
    options: () => ({
      method: "GET\r\nX-Injected: CONFORMANCE_METHOD",
      referrer: "ht!tp://alice:CONFORMANCE_REFERRER@ref.test/p",
    }),
    outcome: { kind: "network" },
    verify: (error) => {
      const message = (error as { message: string }).message;
      for (const sentinel of ["CONFORMANCE_METHOD", "CONFORMANCE_REFERRER", "\r", "\n"]) {
        if (message.includes(sentinel)) throw new Error(`the message carries ${sentinel}`);
      }
    },
  },
  {
    id: "H-26",
    title: "A request input read twice cannot split the request from the error",
    // The input used to be serialized once by the transport and once more to
    // fill `error.url`. A `toString` with state sent the request to one URL and
    // filed the error against another.
    input: () => {
      let reads = 0;
      return {
        toString() {
          reads += 1;
          return reads === 1
            ? "https://conformance.invalid/first"
            : "https://conformance.invalid/second";
        },
      } as unknown as string;
    },
    options: () => ({}),
    outcome: { kind: "network" },
    verify: (error) => {
      const url = (error as { url: string }).url;
      if (url !== "https://conformance.invalid/first") {
        throw new Error(`the error was filed against ${url}`);
      }
    },
  },
  {
    id: "H-27",
    title: "A response getter that aborts the signal and throws is not an abort",
    // Reading the resolved value is not the transport. A getter that aborts the
    // signal and then throws an abort-shaped exception described a failure the
    // abort never caused, and a retry policy reads that class.
    options: () => {
      const controller = new AbortController();
      const response: Record<string, unknown> = {
        [Symbol.toStringTag]: "Response",
        body: null,
        bodyUsed: false,
        headers: new Headers(),
        ok: true,
        redirected: false,
        statusText: "OK",
        type: "basic",
        url: URL_UNDER_TEST,
        arrayBuffer: async () => new ArrayBuffer(0),
        blob: async () => new Blob(),
        clone: () => response,
        formData: async () => new FormData(),
        json: async () => ({}),
        text: async () => "",
      };
      Object.defineProperty(response, "status", {
        configurable: true,
        get(): never {
          controller.abort();
          throw new DOMException("Aborted", "AbortError");
        },
      });
      return { fetch: resolving(response), signal: controller.signal };
    },
    outcome: { kind: "network" },
  },
  {
    id: "H-28",
    title: "An options read that aborts the signal and throws is not an abort",
    // The same rule on the other side of the transport. Building the init is
    // not the request either.
    options: () => {
      const controller = new AbortController();
      const target = {
        fetch: resolving(new Response(null, { status: 200 })),
        signal: controller.signal,
      };
      return new Proxy(target, {
        ownKeys(): never {
          controller.abort();
          throw new DOMException("Aborted", "AbortError");
        },
      });
    },
    outcome: { kind: "network" },
  },
] as const;

export { URL_UNDER_TEST };
