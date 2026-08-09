import http from "node:http";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { isAbortError, isHttpError, isNetworkError, isTimeoutError, typedFetch } from "./src/index";
import type { TypedFetchOptions } from "./src/index";

// Round 14, lane H1.
//
// Rounds 12 and 13 both returned clean here. This file goes where neither
// looked, at four surfaces:
//
//  1. THE TWO LEDGER FACTS ROUND 13 RECORDED AND DID NOT TEST AS PROPERTIES.
//     `snapshotRequestInit` has two branches. The one that strips an own
//     `fetch` re-declares the `signal` slot writable and configurable to
//     satisfy the ES proxy `get` invariant; the other proxies the caller's own
//     object and satisfies the same invariant for a different reason — the
//     trap replays `initSignal`, the caller's own FIRST read, so the value it
//     reports is by construction the one the target holds. Round 13 pinned two
//     hand-built objects. Section 1 pins the property over a generated
//     population of 288 options objects: frozen, sealed, non-extensible,
//     proxied, null-prototype and getter-backed, crossed with eight `signal`
//     slots and four `fetch` slots. Three inversions establish non-vacuity.
//  2. THE WEBIDL MEMBER-ORDER DIVERGENCE, recorded in round 13 as a decision.
//     Section 2 answers the question the decision leaves open: is `signal` the
//     ONLY member where the order is observable? It measures the read set of
//     phase 1 against the read set of a bare `fetch`, member by member.
//  3. `snapshotRequestInit` AS A MODULE, judged by what a real server receives.
//     Section 3 sends 27 init shapes — eight `BodyInit` types, three
//     `HeadersInit` forms, and every remaining `RequestInit` member — three
//     ways: a bare `fetch`, `typedFetch` on the no-override branch, and
//     `typedFetch` on the override branch. The bare `fetch` is the oracle. A
//     field this module drops shows as a difference in the bytes the server
//     read.
//  4. THE TIMEOUT PATH'S ARITHMETIC. Section 4. The library performs none: the
//     only timeout input is a caller-built `AbortSignal`, so the property to
//     pin is that every millisecond value the platform ACCEPTS produces a
//     coherent envelope, and every value it refuses is refused before
//     `typedFetch` is reachable at all.

const ABSOLUTE = "https://population.test/resource";

/** A transport that records what it was handed and answers with a 204. */
function recordingTransport(): {
  readonly fetch: typeof fetch;
  readonly inputs: unknown[];
  readonly inits: unknown[];
} {
  const inputs: unknown[] = [];
  const inits: unknown[] = [];
  const impl = async (input: unknown, init: unknown): Promise<Response> => {
    inputs.push(input);
    inits.push(init);
    return new Response(null, { status: 204 });
  };
  return { fetch: impl as unknown as typeof fetch, inputs, inits };
}

// ── 1. The init the transport reads, over a generated population ───────────
//
// One property, five clauses, asserted for every member of the population:
//
//   (a) the call resolves as an envelope and the transport ran;
//   (b) reading `signal` off the init answers the caller's own FIRST read of
//       its own slot — never the RESOLVED signal, never a second answer;
//   (c) no read of the init throws. A `get` trap that reported a value other
//       than the one a frozen own data property of its target holds is a
//       TypeError at the READER, which is a `typedFetch` caller's own code;
//   (d) the caller's other members survive, and `fetch` — this library's
//       extension, not a WebIDL member — is absent from the init exactly when
//       the caller wrote it as an OWN property;
//   (e) the caller's own `signal` slot is read exactly ONCE for the whole
//       call, including every later read of the init.

interface SignalSlot {
  readonly label: string;
  readonly place: "absent" | "own" | "inherited";
  readonly descriptor: PropertyDescriptor | null;
  /** The value the caller's slot produces on its FIRST read. */
  readonly firstValue: unknown;
  readonly reads: () => number;
}

const SIGNAL_A = new AbortController().signal;
const SIGNAL_B = new AbortController().signal;

const signalSlotFactories: readonly (() => SignalSlot)[] = [
  () => ({
    label: "absent",
    place: "absent",
    descriptor: null,
    firstValue: undefined,
    reads: () => 0,
  }),
  () => ({
    label: "own undefined",
    place: "own",
    descriptor: { value: undefined, writable: true, enumerable: true, configurable: true },
    firstValue: undefined,
    reads: () => 0,
  }),
  () => ({
    label: "own null",
    place: "own",
    descriptor: { value: null, writable: true, enumerable: true, configurable: true },
    firstValue: null,
    reads: () => 0,
  }),
  () => ({
    label: "own signal",
    place: "own",
    descriptor: { value: SIGNAL_A, writable: true, enumerable: true, configurable: true },
    firstValue: SIGNAL_A,
    reads: () => 0,
  }),
  () => {
    let reads = 0;
    return {
      label: "own getter, one answer",
      place: "own",
      descriptor: {
        get(): AbortSignal {
          reads += 1;
          return SIGNAL_A;
        },
        enumerable: true,
        configurable: true,
      },
      firstValue: SIGNAL_A,
      reads: () => reads,
    };
  },
  () => {
    let reads = 0;
    return {
      label: "own getter, a different answer every read",
      place: "own",
      descriptor: {
        get(): AbortSignal {
          reads += 1;
          return reads === 1 ? SIGNAL_A : SIGNAL_B;
        },
        enumerable: true,
        configurable: true,
      },
      firstValue: SIGNAL_A,
      reads: () => reads,
    };
  },
  () => {
    let reads = 0;
    return {
      label: "own getter, null then a signal",
      place: "own",
      descriptor: {
        get(): AbortSignal | null {
          reads += 1;
          return reads === 1 ? null : SIGNAL_B;
        },
        enumerable: true,
        configurable: true,
      },
      firstValue: null,
      reads: () => reads,
    };
  },
  () => ({
    label: "inherited signal",
    place: "inherited",
    descriptor: { value: SIGNAL_A, writable: true, enumerable: true, configurable: true },
    firstValue: SIGNAL_A,
    reads: () => 0,
  }),
];

interface FetchSlot {
  readonly label: string;
  readonly place: "absent" | "own" | "inherited";
  /** `true` when the value is the transport itself, `false` for an own `undefined`. */
  readonly callable: boolean;
}

const fetchSlots: readonly FetchSlot[] = [
  { label: "no fetch key", place: "absent", callable: false },
  { label: "own fetch", place: "own", callable: true },
  { label: "own fetch: undefined", place: "own", callable: false },
  { label: "inherited fetch", place: "inherited", callable: true },
];

interface Shell {
  readonly label: string;
  readonly make: (proto: object | null, own: PropertyDescriptorMap) => object;
}

const shells: readonly Shell[] = [
  { label: "plain", make: (proto, own) => Object.create(proto, own) as object },
  { label: "frozen", make: (proto, own) => Object.freeze(Object.create(proto, own)) as object },
  { label: "sealed", make: (proto, own) => Object.seal(Object.create(proto, own)) as object },
  {
    label: "non-extensible",
    make: (proto, own) => Object.preventExtensions(Object.create(proto, own)) as object,
  },
  {
    label: "bare Proxy",
    make: (proto, own) => new Proxy(Object.create(proto, own) as object, {}),
  },
  {
    label: "Proxy over a frozen target",
    make: (proto, own) => new Proxy(Object.freeze(Object.create(proto, own)) as object, {}),
  },
  {
    label: "fully trapped forwarding Proxy",
    make: (proto, own) =>
      new Proxy(Object.create(proto, own) as object, {
        get: (t, k, r) => Reflect.get(t, k, r),
        has: (t, k) => Reflect.has(t, k),
        ownKeys: (t) => Reflect.ownKeys(t),
        getOwnPropertyDescriptor: (t, k) => Reflect.getOwnPropertyDescriptor(t, k),
        getPrototypeOf: (t) => Reflect.getPrototypeOf(t),
      }),
  },
  {
    label: "null prototype",
    make: (_proto, own) => Object.create(null, own) as object,
  },
  {
    label: "frozen, null prototype",
    make: (_proto, own) => Object.freeze(Object.create(null, own)) as object,
  },
];

interface PopulationCase {
  readonly label: string;
  readonly options: TypedFetchOptions;
  readonly expectedSignal: unknown;
  readonly slot: SignalSlot;
  readonly integrityReads: () => number;
}

function buildPopulation(transport: typeof fetch): readonly PopulationCase[] {
  const cases: PopulationCase[] = [];
  for (const shell of shells) {
    for (const makeSlot of signalSlotFactories) {
      for (const fetchSlot of fetchSlots) {
        const slot = makeSlot();
        let integrityReads = 0;
        const own: PropertyDescriptorMap = {
          method: { value: "POST", writable: true, enumerable: true, configurable: true },
          headers: {
            value: { "x-extra": "1" },
            writable: true,
            enumerable: true,
            configurable: true,
          },
          integrity: {
            get(): string {
              integrityReads += 1;
              return "";
            },
            enumerable: true,
            configurable: true,
          },
        };
        const protoDescriptors: PropertyDescriptorMap = {};

        if (slot.place === "own" && slot.descriptor) own.signal = slot.descriptor;
        if (slot.place === "inherited" && slot.descriptor)
          protoDescriptors.signal = slot.descriptor;

        const fetchValue = fetchSlot.callable ? transport : undefined;
        if (fetchSlot.place === "own") {
          own.fetch = { value: fetchValue, writable: true, enumerable: true, configurable: true };
        }
        if (fetchSlot.place === "inherited") {
          protoDescriptors.fetch = {
            value: fetchValue,
            writable: true,
            enumerable: true,
            configurable: true,
          };
        }

        const proto = Object.create(Object.prototype, protoDescriptors) as object;
        // The null-prototype shells drop the prototype, so an inherited slot
        // becomes no slot at all. That is a real shape too, and the expected
        // values below are computed from the object that was actually built.
        const options = shell.make(proto, own) as TypedFetchOptions;
        const inheritedSlotSurvives = slot.place !== "inherited" || !shell.label.includes("null");
        cases.push({
          label: `${shell.label} / signal: ${slot.label} / ${fetchSlot.label}`,
          options,
          expectedSignal: inheritedSlotSurvives ? slot.firstValue : undefined,
          slot,
          integrityReads: () => integrityReads,
        });
      }
    }
  }
  return cases;
}

/**
 * The five clauses, as a checker rather than as assertions, so an inversion
 * can be fed a deliberately wrong init and the checker's own answer measured.
 */
function initViolations(
  init: unknown,
  expected: {
    readonly signal: unknown;
    readonly ownFetchKey: boolean;
    readonly hasAnyFetchKey: boolean;
  },
): readonly string[] {
  const problems: string[] = [];
  if (init === null || typeof init !== "object") {
    return ["the transport received no init object"];
  }
  const record = init as Record<string, unknown>;

  try {
    if (record.signal !== expected.signal)
      problems.push("init.signal is not the caller's first read");
    // Read it AGAIN: the trap must be stable, and it must not re-run the
    // caller's own getter.
    if (record.signal !== expected.signal) problems.push("init.signal changed between two reads");
  } catch (cause) {
    problems.push(`reading init.signal threw: ${String(cause)}`);
  }

  try {
    if (record.method !== "POST") problems.push("init.method did not survive");
    if ((record.headers as Record<string, string>)["x-extra"] !== "1") {
      problems.push("init.headers did not survive");
    }
  } catch (cause) {
    problems.push(`reading a caller member threw: ${String(cause)}`);
  }

  try {
    const keys = Reflect.ownKeys(init);
    if (keys.includes("fetch")) problems.push("the fetch extension is an own key of the init");
    for (const key of keys) Reflect.get(init, key, init);
    Object.getOwnPropertyDescriptors(init);
    void { ...(init as object) };
    void Object.keys(init as object);
  } catch (cause) {
    problems.push(`reflecting over the init threw: ${String(cause)}`);
  }

  try {
    if (record.fetch !== undefined && expected.ownFetchKey) {
      problems.push("an own fetch extension reached the transport");
    }
    const visible = Reflect.has(init, "fetch");
    if (expected.ownFetchKey && visible) problems.push("`fetch` in init is true for an own fetch");
    if (!expected.ownFetchKey && visible !== expected.hasAnyFetchKey) {
      problems.push("`fetch` in init does not match the caller's object");
    }
  } catch (cause) {
    problems.push(`reading the fetch slot threw: ${String(cause)}`);
  }

  return problems;
}

describe("round 14 / H1 — the init the transport reads, over a generated population", () => {
  test("288 options objects: the snapshot is faithful and no read of it throws", async () => {
    const transport = recordingTransport();
    const nativeFetch = globalThis.fetch;
    const failures: string[] = [];
    let checked = 0;

    globalThis.fetch = transport.fetch;
    try {
      for (const item of buildPopulation(transport.fetch)) {
        const before = transport.inits.length;
        let envelope;
        try {
          envelope = await typedFetch(ABSOLUTE, item.options);
        } catch (cause) {
          failures.push(`${item.label}: typedFetch REJECTED — ${String(cause)}`);
          continue;
        }
        if (envelope.error !== null) {
          failures.push(`${item.label}: the call failed — ${String(envelope.error)}`);
          continue;
        }
        if (transport.inits.length !== before + 1) {
          failures.push(`${item.label}: the transport did not run exactly once`);
          continue;
        }

        // Measured BEFORE the checker runs, because the checker reads the init
        // itself. A member that is not snapshotted — `integrity` here — is read
        // through the proxy on every read, which is the design: only `signal`
        // is captured.
        const signalReadsDuringCall = item.slot.reads();
        const integrityReadsDuringCall = item.integrityReads();

        const ownFetchKey = Object.hasOwn(item.options, "fetch");
        for (const problem of initViolations(transport.inits[before], {
          signal: item.expectedSignal,
          ownFetchKey,
          hasAnyFetchKey: Reflect.has(item.options, "fetch"),
        })) {
          failures.push(`${item.label}: ${problem}`);
        }

        // Clause (e), in two halves. The call itself reads the caller's slot at
        // most once, and every LATER read of the init — the four the checker
        // just performed — is answered by the trap without touching the slot
        // again.
        if (signalReadsDuringCall > 1) {
          failures.push(
            `${item.label}: the call read the signal slot ${signalReadsDuringCall} times`,
          );
        }
        if (item.slot.reads() !== signalReadsDuringCall) {
          failures.push(`${item.label}: reading the init re-ran the caller's signal getter`);
        }
        // The transport is the only reader of a member this module does not
        // snapshot, so the call itself reads it once.
        if (integrityReadsDuringCall > 1) {
          failures.push(`${item.label}: the call read integrity ${integrityReadsDuringCall} times`);
        }
        checked += 1;
      }
    } finally {
      globalThis.fetch = nativeFetch;
    }

    expect(failures).toEqual([]);
    expect(checked).toBe(288);
  });

  test("inversion 1: the no-override branch would trip the proxy get invariant", () => {
    // NON-VACUITY, and the sharpest form of it: this is `snapshotRequestInit`'s
    // no-override branch with ONE change — the trap answers with the RESOLVED
    // signal rather than with `initSignal`, the caller's own first read. For a
    // frozen `{ signal: null }` those differ (`null ?? undefined`), and the
    // engine refuses the read. The real branch cannot reach this state, and
    // that is exactly what the population above proves.
    const options = Object.freeze({ signal: null });
    const resolved = options.signal ?? undefined;
    const wrong = new Proxy(options, {
      get(target, property) {
        if (property === "signal") return resolved;
        return Reflect.get(target, property, target);
      },
    });

    expect(() => (wrong as { signal?: unknown }).signal).toThrow(TypeError);
  });

  test("inversion 2: the override branch would hand the transport the wrong signal", () => {
    // The other branch re-declares the descriptor writable and configurable, so
    // the same mistake is SILENT there: no invariant binds it, and the transport
    // simply receives a signal the caller never wrote. Only clause (b) catches
    // it, which is why clause (b) exists.
    const options = Object.freeze({
      signal: null,
      fetch: undefined,
      method: "POST",
      integrity: "",
    });
    const resolved = options.signal ?? undefined;
    const descriptors = Object.getOwnPropertyDescriptors(options) as PropertyDescriptorMap;
    delete descriptors.fetch;
    descriptors.signal = { value: resolved, writable: true, enumerable: true, configurable: true };
    const target = Object.create(Object.getPrototypeOf(options), descriptors) as object;
    const wrong = new Proxy(target, {
      get(_target, property) {
        if (property === "signal") return resolved;
        if (property === "fetch") return undefined;
        return Reflect.get(options, property, options);
      },
      has: (_target, property) => (property === "fetch" ? false : Reflect.has(options, property)),
    });

    expect((wrong as { signal?: unknown }).signal).toBe(undefined);
    expect(
      initViolations(wrong, { signal: null, ownFetchKey: true, hasAnyFetchKey: true }),
    ).toContain("init.signal is not the caller's first read");
  });

  test("inversion 3: the checker fails an init that drops a caller member", () => {
    const init = new Proxy(
      { signal: null, method: "POST", headers: { "x-extra": "1" } },
      {
        get(target, property) {
          if (property === "method") return undefined;
          return Reflect.get(target, property, target);
        },
      },
    );

    expect(
      initViolations(init, { signal: null, ownFetchKey: false, hasAnyFetchKey: false }),
    ).toContain("init.method did not survive");
  });
});

// ── 2. The WebIDL member-order divergence ──────────────────────────────────
//
// Round 13 recorded the divergence as a DECISION: `typedFetch` reads
// `options.signal` in phase 1, while a bare `fetch` converts `init` as a WebIDL
// dictionary and reads `signal` in member order, after several other members. A
// self-mutating getter can therefore change the request under one and not the
// other.
//
// The decision leaves a question open, and it is the one that decides how wide
// the divergence is: is `signal` the ONLY member where the order is observable?
// The answer is measured here rather than argued, by giving every `RequestInit`
// member an accessor that records its own read.

const REQUEST_INIT_MEMBERS = [
  "body",
  "cache",
  "credentials",
  "duplex",
  "headers",
  "integrity",
  "keepalive",
  "method",
  "mode",
  "priority",
  "redirect",
  "referrer",
  "referrerPolicy",
  "signal",
  "window",
] as const;

const MEMBER_VALUES: Readonly<Record<string, unknown>> = {
  body: undefined,
  cache: "no-store",
  credentials: "same-origin",
  duplex: undefined,
  headers: { "x-member": "1" },
  integrity: "",
  keepalive: false,
  method: "GET",
  mode: "cors",
  priority: "auto",
  redirect: "follow",
  referrer: "about:client",
  referrerPolicy: "",
  signal: undefined,
  window: null,
};

function recordingOptions(withFetch: typeof fetch | undefined): {
  readonly options: TypedFetchOptions;
  readonly order: string[];
  readonly counts: Record<string, number>;
} {
  const order: string[] = [];
  const counts: Record<string, number> = {};
  const descriptors: PropertyDescriptorMap = {};
  for (const member of REQUEST_INIT_MEMBERS) {
    descriptors[member] = {
      get(): unknown {
        order.push(member);
        counts[member] = (counts[member] ?? 0) + 1;
        return MEMBER_VALUES[member];
      },
      enumerable: true,
      configurable: true,
    };
  }
  if (withFetch !== undefined) {
    descriptors.fetch = {
      get(): typeof fetch {
        order.push("fetch");
        counts.fetch = (counts.fetch ?? 0) + 1;
        return withFetch;
      },
      enumerable: true,
      configurable: true,
    };
  }
  return {
    options: Object.create(Object.prototype, descriptors) as TypedFetchOptions,
    order,
    counts,
  };
}

describe("round 14 / H1 — which init members the setup phase reads", () => {
  test("the override branch reads exactly two slots before the transport runs", async () => {
    const transport = recordingTransport();
    const { options, order } = recordingOptions(transport.fetch);

    const { error } = await typedFetch(ABSOLUTE, options);

    expect(error).toBe(null);
    expect(transport.inits.length).toBe(1);
    // `fetch` is this library's own extension, not a WebIDL member: a bare
    // `fetch` never reads it at all. Among the fifteen members the Fetch
    // Standard declares, `signal` is the ONLY one the setup phase reads, and
    // that is the whole of the divergence round 13 recorded.
    expect(order).toEqual(["fetch", "signal"]);
  });

  test("the no-override branch reads exactly one slot before the transport runs", async () => {
    const transport = recordingTransport();
    const { options, order } = recordingOptions(undefined);
    const nativeFetch = globalThis.fetch;

    globalThis.fetch = transport.fetch;
    try {
      const { error } = await typedFetch(ABSOLUTE, options);
      expect(error).toBe(null);
    } finally {
      globalThis.fetch = nativeFetch;
    }

    expect(transport.inits.length).toBe(1);
    expect(order).toEqual(["signal"]);
  });

  test("a real fetch reads every member exactly as often through the snapshot", async () => {
    // The ORDER differs for `signal`, and that is the recorded decision. The
    // COUNT must not differ for anything: a member read twice is a member the
    // caller can answer twice, which is ADR 0003 row H-26. `headers` is the one
    // that matters most — the module stopped snapshotting it precisely so its
    // getter would run once, "as it does under a bare fetch", and that sentence
    // is measured here rather than trusted.
    const forward = ((input: RequestInfo | URL, init?: RequestInit) =>
      fetch(input, init)) as typeof fetch;

    const bare = recordingOptions(undefined);
    const bareResponse = await fetch(base, bare.options as RequestInit);
    await bareResponse.arrayBuffer();

    const plain = recordingOptions(undefined);
    const plainResult = await typedFetch(base, plain.options);
    if (plainResult.response) await plainResult.response.arrayBuffer();

    const stripped = recordingOptions(forward);
    const strippedResult = await typedFetch(base, stripped.options);
    if (strippedResult.response) await strippedResult.response.arrayBuffer();

    expect(plainResult.error).toBe(null);
    expect(strippedResult.error).toBe(null);

    // Non-vacuity: the oracle really did read all fifteen members.
    expect(Object.keys(bare.counts).sort()).toEqual([...REQUEST_INIT_MEMBERS].sort());
    for (const member of REQUEST_INIT_MEMBERS) expect(bare.counts[member]).toBe(1);

    const { fetch: _strippedFetchReads, ...strippedMembers } = stripped.counts;
    expect(plain.counts).toEqual(bare.counts);
    expect(strippedMembers).toEqual(bare.counts);
  });
});

// ── 3. `snapshotRequestInit` judged by what a server received ──────────────
//
// The module builds what the transport reads, so the honest judge of it is a
// real request. Every shape below is sent three ways — a bare `fetch`, and
// `typedFetch` on each of the two branches — and the bare `fetch` is the
// oracle. A member this module drops, reorders into a second read, or answers
// with a stale value shows up as a difference in what the server read.

interface RequestRecord {
  readonly method: string;
  readonly path: string;
  readonly headers: Record<string, string>;
  readonly body: string;
}

const received: RequestRecord[] = [];
let server: http.Server;
let base: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(req.headers)) {
        headers[name] = Array.isArray(value) ? value.join(", ") : (value ?? "");
      }
      received.push({
        method: req.method ?? "",
        path: req.url ?? "",
        headers,
        body: Buffer.concat(chunks).toString("base64"),
      });
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, () => resolve()));
  base = `http://localhost:${(server.address() as { port: number }).port}/echo`;
});

afterAll(() => {
  server.close();
});

/**
 * Multipart bodies carry a fresh boundary per request, and the boundary is in
 * both the `content-type` and the bytes. Normalizing it is the only difference
 * this comparison is allowed to forgive.
 */
function normalize(record: RequestRecord): RequestRecord {
  const headers: Record<string, string> = { ...record.headers };
  delete headers.connection;
  delete headers["keep-alive"];
  const contentType = headers["content-type"] ?? "";
  const boundary = /boundary=(?<value>[-\w]+)/u.exec(contentType)?.groups?.value;
  let body = record.body;
  if (boundary) {
    headers["content-type"] = contentType.replace(boundary, "BOUNDARY");
    body = Buffer.from(record.body, "base64").toString("binary").split(boundary).join("BOUNDARY");
    // The length changes with the boundary spelling, so it stops being
    // comparable once the boundary is normalized.
    delete headers["content-length"];
  }
  return { method: record.method, path: record.path, headers, body };
}

type InitShape = { readonly label: string; readonly make: () => Record<string, unknown> };

function textStream(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

function multipart(): FormData {
  const form = new FormData();
  form.append("field", "value");
  form.append("file", new Blob(["file-bytes"], { type: "text/plain" }), "name.txt");
  return form;
}

const initShapes: readonly InitShape[] = [
  { label: "no init members at all", make: () => ({}) },
  { label: "body: string", make: () => ({ method: "POST", body: "hello" }) },
  {
    label: "body: URLSearchParams",
    make: () => ({ method: "POST", body: new URLSearchParams({ a: "1", b: "two" }) }),
  },
  {
    label: "body: ArrayBuffer",
    make: () => ({ method: "POST", body: new TextEncoder().encode("arraybuffer").buffer }),
  },
  {
    label: "body: Uint8Array",
    make: () => ({ method: "POST", body: new Uint8Array([1, 2, 3, 250]) }),
  },
  {
    label: "body: DataView",
    make: () => ({ method: "POST", body: new DataView(new Uint8Array([9, 8, 7]).buffer) }),
  },
  {
    label: "body: Blob",
    make: () => ({ method: "POST", body: new Blob(["blob-bytes"], { type: "text/plain" }) }),
  },
  { label: "body: FormData", make: () => ({ method: "POST", body: multipart() }) },
  {
    label: "body: ReadableStream with duplex",
    make: () => ({ method: "POST", body: textStream("stream-bytes"), duplex: "half" }),
  },
  {
    label: "body: ReadableStream without duplex",
    make: () => ({ method: "POST", body: textStream("no-duplex") }),
  },
  {
    label: "headers: a record",
    make: () => ({ headers: { "x-one": "1", "x-two": "2" } }),
  },
  {
    label: "headers: an array of pairs",
    make: () => ({
      headers: [
        ["x-one", "1"],
        ["x-two", "2"],
      ],
    }),
  },
  {
    label: "headers: a Headers instance",
    make: () => ({ headers: new Headers({ "x-one": "1" }) }),
  },
  {
    label: "headers: a repeated name",
    make: () => ({
      headers: [
        ["x-rep", "a"],
        ["x-rep", "b"],
      ],
    }),
  },
  { label: "method: an uppercase custom method", make: () => ({ method: "REPORT" }) },
  { label: "method: lowercase patch", make: () => ({ method: "patch" }) },
  { label: "method: HEAD", make: () => ({ method: "HEAD" }) },
  { label: "credentials: include", make: () => ({ credentials: "include" }) },
  { label: "credentials: omit", make: () => ({ credentials: "omit" }) },
  { label: "cache: no-store", make: () => ({ cache: "no-store" }) },
  { label: "cache: reload", make: () => ({ cache: "reload" }) },
  { label: "redirect: error", make: () => ({ redirect: "error" }) },
  { label: "redirect: manual", make: () => ({ redirect: "manual" }) },
  { label: "referrerPolicy: no-referrer", make: () => ({ referrerPolicy: "no-referrer" }) },
  { label: "referrer: an absolute url", make: () => ({ referrer: "http://ref.test/page" }) },
  { label: "keepalive: true", make: () => ({ keepalive: true }) },
  { label: "priority: high", make: () => ({ priority: "high" }) },
  { label: "mode: cors", make: () => ({ mode: "cors" }) },
  { label: "window: null", make: () => ({ window: null }) },
  {
    label: "integrity: a hash the body cannot match",
    make: () => ({ integrity: "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" }),
  },
  {
    label: "every member at once",
    make: () => ({
      method: "POST",
      body: "everything",
      headers: { "x-all": "1" },
      cache: "no-store",
      credentials: "include",
      keepalive: false,
      mode: "cors",
      priority: "low",
      redirect: "follow",
      referrer: "about:client",
      referrerPolicy: "origin",
      window: null,
    }),
  },
];

interface Outcome {
  /** The status the server answered with, or `null` when no response arrived. */
  readonly status: number | null;
  /** The request never produced a response at all. */
  readonly failedBeforeResponse: boolean;
  readonly record: RequestRecord | null;
}

describe("round 14 / H1 — every init member survives the snapshot", () => {
  test("31 init shapes reach the server exactly as a bare fetch sends them", async () => {
    const differences: string[] = [];
    const bodiesSeen = new Set<string>();
    const headerNamesSeen = new Set<string>();
    let reached = 0;

    for (const shape of initShapes) {
      const outcomes: Record<string, Outcome> = {};

      const run = async (
        name: string,
        perform: () => Promise<{ status: number | null; failed: boolean }>,
      ): Promise<void> => {
        received.length = 0;
        let result: { status: number | null; failed: boolean };
        try {
          result = await perform();
        } catch {
          result = { status: null, failed: true };
        }
        outcomes[name] = {
          status: result.status,
          failedBeforeResponse: result.failed,
          record: received.length === 1 ? normalize(received[0]!) : null,
        };
      };

      // The ORACLE. A bare `fetch` resolves for every status, so the comparison
      // is against the status the server answered with — never against "did it
      // fail", which the envelope answers differently by design.
      await run("bare fetch", async () => {
        try {
          const response = await fetch(base, shape.make() as RequestInit);
          await response.arrayBuffer().catch(() => undefined);
          return { status: response.status, failed: false };
        } catch {
          return { status: null, failed: true };
        }
      });

      const drive = async (
        options: TypedFetchOptions,
      ): Promise<{ status: number | null; failed: boolean }> => {
        const { response, error } = await typedFetch(base, options);
        if (response) {
          await response.arrayBuffer().catch(() => undefined);
          return { status: response.status, failed: false };
        }
        if (isHttpError(error)) {
          const status = error.status;
          await error.cancel().catch(() => undefined);
          return { status, failed: false };
        }
        return { status: null, failed: true };
      };

      await run("typedFetch, no override", () => drive(shape.make() as TypedFetchOptions));

      await run("typedFetch, override", () => {
        const forward = ((input: RequestInfo | URL, init?: RequestInit) =>
          fetch(input, init)) as typeof fetch;
        return drive({ ...shape.make(), fetch: forward } as TypedFetchOptions);
      });

      const oracle = outcomes["bare fetch"]!;
      if (oracle.record) {
        reached += 1;
        bodiesSeen.add(oracle.record.body);
        for (const name of Object.keys(oracle.record.headers)) headerNamesSeen.add(name);
      }
      for (const name of ["typedFetch, no override", "typedFetch, override"]) {
        const actual = outcomes[name]!;
        if (
          actual.status !== oracle.status ||
          actual.failedBeforeResponse !== oracle.failedBeforeResponse
        ) {
          differences.push(
            `${shape.label} / ${name}: status ${String(actual.status)}/failed ${actual.failedBeforeResponse} vs bare fetch ${String(oracle.status)}/failed ${oracle.failedBeforeResponse}`,
          );
        }
        if (JSON.stringify(actual.record) !== JSON.stringify(oracle.record)) {
          differences.push(
            `${shape.label} / ${name}: the server read a different request\n  bare: ${JSON.stringify(oracle.record)}\n  this: ${JSON.stringify(actual.record)}`,
          );
        }
      }
    }

    expect(differences).toEqual([]);
    expect(initShapes.length).toBe(31);
    // NON-VACUITY. A comparison of two nulls is not a comparison: most shapes
    // must have reached the server, and the bytes must be the ones written.
    expect(reached).toBeGreaterThanOrEqual(25);
    expect(bodiesSeen.has(Buffer.from("hello").toString("base64"))).toBe(true);
    expect(bodiesSeen.has(Buffer.from("a=1&b=two").toString("base64"))).toBe(true);
    expect(bodiesSeen.has(Buffer.from("stream-bytes").toString("base64"))).toBe(true);
    expect(headerNamesSeen.has("x-one")).toBe(true);
  });

  test("inversion: a transport that discards the init is caught by the same comparison", async () => {
    // The oracle above answers "no difference". This proves the instrument can
    // answer otherwise: the same three shapes, driven through a transport that
    // forwards the input and DROPS the init, differ from the bare `fetch` in
    // exactly the way a dropped member would.
    const dropping = ((input: RequestInfo | URL) => fetch(input)) as typeof fetch;
    const shapes = initShapes.filter((shape) =>
      ["body: string", "headers: a record", "method: an uppercase custom method"].includes(
        shape.label,
      ),
    );
    const differences: string[] = [];

    for (const shape of shapes) {
      received.length = 0;
      const bare = await fetch(base, shape.make() as RequestInit);
      await bare.arrayBuffer();
      const oracle = received.length === 1 ? normalize(received[0]!) : null;

      received.length = 0;
      const { response } = await typedFetch(base, {
        ...shape.make(),
        fetch: dropping,
      } as TypedFetchOptions);
      if (response) await response.arrayBuffer();
      const actual = received.length === 1 ? normalize(received[0]!) : null;

      if (JSON.stringify(actual) !== JSON.stringify(oracle)) differences.push(shape.label);
    }

    expect(differences.length).toBe(3);
  });

  test("a frozen init reaches the server exactly as an unfrozen one does", async () => {
    // The two branches build the init differently for a frozen object, and only
    // one of them copies descriptors. What the wire carries must not tell them
    // apart.
    const shapes = [
      { method: "POST", body: "frozen-body", headers: { "x-frozen": "1" } },
      { method: "REPORT", headers: [["x-frozen", "2"]] as [string, string][] },
    ];
    const differences: string[] = [];

    for (const shape of shapes) {
      const runs: RequestRecord[] = [];
      for (const options of [
        shape as TypedFetchOptions,
        Object.freeze({ ...shape }) as TypedFetchOptions,
        Object.freeze({ ...shape, fetch: fetch }) as TypedFetchOptions,
      ]) {
        received.length = 0;
        const { response, error } = await typedFetch(base, options);
        if (response) await response.arrayBuffer();
        if (error !== null) differences.push(`${shape.method}: the call failed — ${String(error)}`);
        if (received.length === 1) runs.push(normalize(received[0]!));
      }
      const [first, ...rest] = runs;
      for (const other of rest) {
        if (JSON.stringify(other) !== JSON.stringify(first)) {
          differences.push(
            `${shape.method}: a frozen init sent a different request\n  ${JSON.stringify(first)}\n  ${JSON.stringify(other)}`,
          );
        }
      }
    }

    expect(differences).toEqual([]);
  });
});

describe("round 14 / H1 — a handed-over Request, against the same oracle", () => {
  // The init a `Request` first argument travels with is the one place where an
  // EMPTY init is load-bearing: the Fetch Standard's "init is not empty" branch
  // resets the request's referrer and origin, and an `init["signal"]` that
  // EXISTS and is null detaches the request's own signal. The ledger pins that
  // `typedFetch(request)` keeps the init empty. This block asks the harder
  // question — whether the branch that STRIPS an own `fetch` keeps it empty
  // too — and it asks a real server rather than the object.
  function makeRequest(body: string | null): Request {
    return new Request(base, {
      method: "POST",
      headers: { "x-req": "from-the-request" },
      body,
    });
  }

  test("options carrying only a fetch override do not change the request", async () => {
    const differences: string[] = [];
    const forward = ((input: RequestInfo | URL, init?: RequestInit) =>
      fetch(input, init)) as typeof fetch;

    const runs: Record<string, RequestRecord | null> = {};
    const record = async (name: string, perform: () => Promise<unknown>): Promise<void> => {
      received.length = 0;
      await perform();
      runs[name] = received.length === 1 ? normalize(received[0]!) : null;
    };

    await record("bare fetch", async () => {
      const response = await fetch(makeRequest("request-body"));
      await response.arrayBuffer();
    });
    await record("typedFetch, no options", async () => {
      const { response } = await typedFetch(makeRequest("request-body"));
      if (response) await response.arrayBuffer();
    });
    await record("typedFetch, only a fetch override", async () => {
      const { response } = await typedFetch(makeRequest("request-body"), { fetch: forward });
      if (response) await response.arrayBuffer();
    });

    const oracle = runs["bare fetch"]!;
    for (const [name, actual] of Object.entries(runs)) {
      if (JSON.stringify(actual) !== JSON.stringify(oracle)) {
        differences.push(
          `${name}: the server read a different request\n  bare: ${JSON.stringify(oracle)}\n  this: ${JSON.stringify(actual)}`,
        );
      }
    }
    expect(differences).toEqual([]);
  });

  test("the Request's own signal still governs under a forwarding transport", async () => {
    // A stripped `fetch` key must not leave an own `signal` behind in the init:
    // `init["signal"]` that EXISTS and is null detaches the Request's signal,
    // and the request would then run ungoverned while the classifier went on
    // treating that signal as the authority.
    const forward = ((input: RequestInfo | URL, init?: RequestInit) =>
      fetch(input, init)) as typeof fetch;
    const controller = new AbortController();
    const request = new Request(`${base}?slow=1`, { signal: controller.signal });
    controller.abort();

    const { response, error } = await typedFetch(request, { fetch: forward });

    expect(response).toBe(null);
    expect(isAbortError(error)).toBe(true);
    expect(isNetworkError(error)).toBe(false);
  });

  test("an init member the caller writes beside a Request still overrides it", async () => {
    const differences: string[] = [];
    const forward = ((input: RequestInfo | URL, init?: RequestInit) =>
      fetch(input, init)) as typeof fetch;

    const shapes: readonly { label: string; init: () => RequestInit }[] = [
      { label: "method", init: () => ({ method: "PUT" }) },
      { label: "headers", init: () => ({ headers: { "x-req": "from-the-init" } }) },
      { label: "body", init: () => ({ method: "POST", body: "init-body" }) },
    ];

    for (const shape of shapes) {
      const runs: RequestRecord[] = [];
      received.length = 0;
      const bare = await fetch(makeRequest(null), shape.init());
      await bare.arrayBuffer();
      if (received.length === 1) runs.push(normalize(received[0]!));

      for (const options of [
        shape.init() as TypedFetchOptions,
        { ...shape.init(), fetch: forward } as TypedFetchOptions,
      ]) {
        received.length = 0;
        const { response, error } = await typedFetch(makeRequest(null), options);
        if (response) await response.arrayBuffer();
        if (error !== null) differences.push(`${shape.label}: the call failed — ${String(error)}`);
        if (received.length === 1) runs.push(normalize(received[0]!));
      }

      const [oracle, ...rest] = runs;
      for (const actual of rest) {
        if (JSON.stringify(actual) !== JSON.stringify(oracle)) {
          differences.push(
            `${shape.label}: the server read a different request\n  bare: ${JSON.stringify(oracle)}\n  this: ${JSON.stringify(actual)}`,
          );
        }
      }
    }

    expect(differences).toEqual([]);
  });
});

// ── 4. The timeout path's arithmetic ───────────────────────────────────────
//
// The library performs NO timeout arithmetic. Its only timeout input is an
// `AbortSignal` the caller built, so the property is a two-sided one: every
// millisecond value the platform ACCEPTS produces a coherent envelope, and
// every value it refuses is refused at the caller's own call site, before
// `typedFetch` can be reached at all.

describe("round 14 / H1 — the timeout path over the millisecond values a caller can write", () => {
  const candidates = [
    0,
    0.5,
    1,
    -1,
    -0,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    2 ** 31,
    2 ** 32 - 1,
    Number.MAX_SAFE_INTEGER,
  ];

  test("no accepted millisecond value can make the envelope reject or misclassify", async () => {
    const problems: string[] = [];
    let accepted = 0;
    let refused = 0;

    for (const ms of candidates) {
      let signal: AbortSignal;
      try {
        signal = AbortSignal.timeout(ms);
      } catch {
        // The platform refused the value. `typedFetch` never sees it, which is
        // the whole of this library's timeout arithmetic.
        refused += 1;
        continue;
      }
      accepted += 1;

      const transport = (async (): Promise<Response> => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        if (signal.aborted) throw signal.reason;
        return new Response(null, { status: 204 });
      }) as typeof fetch;

      let envelope;
      try {
        envelope = await typedFetch(ABSOLUTE, { signal, fetch: transport });
      } catch (cause) {
        problems.push(`timeout(${String(ms)}): typedFetch REJECTED — ${String(cause)}`);
        continue;
      }

      const { response, error } = envelope;
      if (signal.aborted) {
        // The signal fired, so the transport rejected with its reason. The
        // classifier owes a TimeoutError, never an abort and never a bare
        // network failure.
        if (!isTimeoutError(error)) {
          problems.push(`timeout(${String(ms)}): fired but classified as ${String(error?.name)}`);
        }
        if (isAbortError(error)) problems.push(`timeout(${String(ms)}): classified as an abort`);
        if (response !== null) problems.push(`timeout(${String(ms)}): fired and still succeeded`);
      } else {
        if (error !== null) {
          problems.push(`timeout(${String(ms)}): did not fire and still failed — ${String(error)}`);
        }
      }
    }

    expect(problems).toEqual([]);
    // Non-vacuity in both directions: at least one value fired and at least one
    // was refused before `typedFetch` could be reached.
    expect(accepted).toBeGreaterThan(0);
    expect(refused).toBeGreaterThan(0);
  });

  test("a timeout that already fired is a TimeoutError with the request's url filed", async () => {
    const signal = AbortSignal.timeout(0);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(signal.aborted).toBe(true);

    const transport = (async (): Promise<Response> => {
      throw signal.reason;
    }) as typeof fetch;

    const { response, error } = await typedFetch(ABSOLUTE, { signal, fetch: transport });

    expect(response).toBe(null);
    expect(isTimeoutError(error)).toBe(true);
    expect(isNetworkError(error)).toBe(false);
    expect(isAbortError(error)).toBe(false);
    expect((error as unknown as { readonly url: string }).url).toBe(ABSOLUTE);
  });

  test("a fired timeout cannot reclassify a SETUP-phase failure", async () => {
    // Only the transport phase can produce a timeout. A signal that has already
    // fired while the setup phase throws must still resolve a NetworkError.
    const signal = AbortSignal.timeout(0);
    await new Promise((resolve) => setTimeout(resolve, 5));

    const options = {
      signal,
      get fetch(): typeof fetch {
        throw new Error("hostile fetch getter");
      },
    };

    const { response, error } = await typedFetch(ABSOLUTE, options as TypedFetchOptions);

    expect(response).toBe(null);
    expect(isNetworkError(error)).toBe(true);
    expect(isTimeoutError(error)).toBe(false);
    expect((error as unknown as { readonly url: string }).url).toBe(ABSOLUTE);
  });
});
