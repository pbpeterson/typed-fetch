import http from "node:http";
import { readFileSync } from "node:fs";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { isAbortError, typedFetch } from "../../src/index";
import type { TypedFetchOptions } from "../../src/index";
import { planRequest } from "../../src/request-plan";
import { recordingTransport } from "../../fixtures/recording-transport";

// Round 19, lane H1 — the request path, aimed at what round 18 CHANGED.
//
// Round 18 rewrote `snapshotRequestInit`'s branch condition. The branch that
// materializes a `signal` entry used to turn on `Object.hasOwn(options,
// "fetch")`; it now turns on whether the init owes a spread an entry the target
// does not own. This file attacks the replacement the way round 18 attacked its
// predecessor, and it audits the pin that was supposed to catch the first one.
//
// Section A is the finding: the replacement asks for OWN-ness where the
// property it protects needs OWN AND ENUMERABLE.
// Section B is the gate: the pin that names R18-H1-01's defect still cannot
// fail for it.
// Sections C and D pass. They are measurements, kept because they are the
// evidence behind two frontier verdicts.
//
// EVERYTHING HERE READS `src/`, NOT `dist/`. That is deliberate and it is
// section B's point: the only test in the repository that fails when R18-H1-01
// is reintroduced sits behind `describe.skipIf(!distExists)`.

const ABSOLUTE = "https://round19.test/resource";

// ── A control server, so an abort has an observable ────────────────────────

interface ControlServer {
  url(params?: Record<string, string | number>): string;
  received(): readonly string[];
  finished(): readonly string[];
}

/**
 * An HTTP server that reports both halves of an exchange.
 *
 * The observable that separates a GOVERNED request from an ungoverned one is
 * whether the server finished writing a response the caller had already
 * aborted. A cancelled response clears its own timer, so a tag reaching
 * {@link ControlServer.finished} means the request ran to completion.
 */
function useControlServer(): ControlServer {
  let base = "";
  let server: http.Server;
  const received: string[] = [];
  const finished: string[] = [];

  beforeAll(async () => {
    server = http.createServer((request, response) => {
      const parsed = new URL(request.url ?? "/", "http://control.invalid");
      const tag = parsed.searchParams.get("tag") ?? "";
      const delay = Number(parsed.searchParams.get("delay") ?? 0);
      received.push(tag);
      const timer = setTimeout(() => {
        response.setHeader("Content-Type", "text/plain");
        response.writeHead(200);
        response.end("done");
        finished.push(tag);
      }, delay);
      response.on("close", () => clearTimeout(timer));
    });
    await new Promise<void>((resolve) => {
      server.listen(0, () => resolve());
    });
    base = `http://localhost:${(server.address() as net.AddressInfo).port}`;
  });

  afterAll(() => {
    server.close();
  });

  return {
    url(params = {}) {
      const search = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) search.append(key, String(value));
      return `${base}/?${search}`;
    },
    received: () => received,
    finished: () => finished,
  };
}

const control = useControlServer();

/** The platform's own transport, captured before any test replaces the global. */
const NATIVE_FETCH = globalThis.fetch;

/** Install a transport as the global for one call, and always put it back. */
async function withGlobalTransport<T>(transport: typeof fetch, run: () => Promise<T>): Promise<T> {
  const globals = globalThis as { fetch: typeof fetch };
  globals.fetch = transport;
  try {
    return await run();
  } finally {
    globals.fetch = NATIVE_FETCH;
  }
}

// ── A. The replacement condition, over the shapes a `signal` slot can take ──

type Ownership = "own" | "inherited";
type Enumerability = "enumerable" | "non-enumerable";
type Kind = "data" | "accessor";
type Branch = "the fetch option" | "no fetch option";

interface SlotShape {
  readonly label: string;
  readonly ownership: Ownership;
  readonly enumerability: Enumerability;
  readonly kind: Kind;
  readonly value: AbortSignal | null;
}

function slotDescriptor(shape: SlotShape): PropertyDescriptor {
  const enumerable = shape.enumerability === "enumerable";
  if (shape.kind === "accessor") {
    return { get: () => shape.value, enumerable, configurable: true };
  }
  return { value: shape.value, writable: true, enumerable, configurable: true };
}

function buildOptions(
  shape: SlotShape,
  branch: Branch,
  transport: typeof fetch,
): TypedFetchOptions {
  const descriptor = slotDescriptor(shape);
  const prototype =
    shape.ownership === "inherited"
      ? Object.create(Object.prototype, { signal: descriptor })
      : Object.prototype;
  const own: PropertyDescriptorMap = {
    method: { value: "POST", writable: true, enumerable: true, configurable: true },
  };
  if (shape.ownership === "own") own.signal = descriptor;
  if (branch === "the fetch option") {
    own.fetch = { value: transport, writable: true, enumerable: true, configurable: true };
  }
  return Object.create(prototype as object, own) as TypedFetchOptions;
}

describe("round 19 / H1 — the entry a forwarding transport's spread carries", () => {
  test("R19-H1-01: a signal the init reports is a signal a spread of the init carries", () => {
    // THE PROPERTY, and it is the one round 18 installed:
    //
    //     `{ ...init }` is what a forwarding transport writes. So whenever the
    //     init ANSWERS a `signal` read with a signal, a spread of that init
    //     must carry the same one.
    //
    // `src/request-plan.ts`, `snapshotRequestInit`, states both halves:
    //
    //     "the caller's object can be the target only while every entry the
    //      init owes a spread is already an own key of it"
    //
    //     "A proxy invariant does not require it … but `{ ...init }` does, and
    //      that spread is what a forwarding transport writes. Without it the
    //      request ran UNGOVERNED while `classifyRequestFailure` went on
    //      treating that signal as the authority."
    //
    // THE DEFECT. The condition asks `Object.hasOwn(options, "signal")`. A
    // spread does not copy own keys; it copies own ENUMERABLE keys. The two
    // differ for exactly one descriptor shape, and that shape is what the
    // two-argument `Object.create` and a bare `Object.defineProperty` both
    // produce by default:
    //
    //     Object.create(defaults, { signal: { value: controller.signal } })
    //
    // `enumerable` defaults to `false` there. `Object.hasOwn` answers `true`,
    // so the caller's object stays the proxy target, and the spread drops the
    // signal. The OTHER branch drops it too: it copies the caller's
    // enumerability forward with `enumerable: descriptors.signal?.enumerable ??
    // true`, so an own non-enumerable slot is re-declared non-enumerable and
    // the sanitized target's spread loses it as well. Both branches fail, which
    // is why this is not a branch asymmetry but a gap in the condition itself.
    //
    // THE MATRIX. Sixteen cells: own/inherited × enumerable/non-enumerable ×
    // data/accessor × both branches, each with the same real signal. The
    // eight enumerable cells and the four inherited non-enumerable cells are
    // governed — an inherited slot is not an own key under any enumerability,
    // so `inheritedSignal` sends it to the branch that materializes the entry
    // as enumerable. Only the four OWN non-enumerable cells lose it, on both
    // branches. So a failure here cannot be blamed on the spread as such, on
    // the accessor, or on the branch: the only thing that moves is whether the
    // caller's own descriptor happens to be enumerable.
    const transport = recordingTransport().fetch;
    const signal = new AbortController().signal;
    const observed: Record<string, string> = {};

    for (const branch of ["the fetch option", "no fetch option"] satisfies Branch[]) {
      for (const ownership of ["own", "inherited"] satisfies Ownership[]) {
        for (const enumerability of ["enumerable", "non-enumerable"] satisfies Enumerability[]) {
          for (const kind of ["data", "accessor"] satisfies Kind[]) {
            const shape: SlotShape = {
              label: `${ownership} ${enumerability} ${kind}`,
              ownership,
              enumerability,
              kind,
              value: signal,
            };
            const options = buildOptions(shape, branch, transport);
            const plan = planRequest(ABSOLUTE, options);
            const spread = { ...(plan.init as Record<string, unknown>) };
            observed[`${branch} / ${shape.label}`] =
              plan.init.signal === signal && plan.signal === signal
                ? spread.signal === signal
                  ? "governed"
                  : "the init reports the signal, the spread drops it"
                : "the init does not even report the signal";
          }
        }
      }
    }

    const expected: Record<string, string> = {};
    for (const key of Object.keys(observed)) expected[key] = "governed";
    expect(
      observed,
      '`snapshotRequestInit` asks `Object.hasOwn(options, "signal")` where the entry it ' +
        "protects needs own AND enumerable, so an own non-enumerable `signal` — what " +
        "`Object.create(defaults, { signal: { value } })` and a bare `Object.defineProperty` " +
        "both write — is dropped by the spread a forwarding transport performs, on both branches",
    ).toEqual(expected);
  });

  test("R19-H1-01: the caller aborts, and the envelope reports a success", async () => {
    // THE CONSEQUENCE, over a real socket, in the shape round 18 used for its
    // own finding so the two are directly comparable.
    //
    // A forwarding transport spreads the init it was handed — that is what a
    // tracing, retry, or mock wrapper writes — and the caller aborts while the
    // server is still holding the response. When the signal survives the
    // spread, the socket closes and the server never finishes. When it does
    // not, the server writes the whole response and the envelope reports a
    // SUCCESS for a request the caller aborted, while `plan.signal` — the
    // authority `classifyRequestFailure` consults — still holds that same
    // signal.
    //
    // Both rows build the options object the SAME way, with the two-argument
    // `Object.create` a per-call wrapper over a shared configuration writes.
    // The only difference is the one word `enumerable`.
    async function drive(enumerability: Enumerability): Promise<{
      readonly spreadKeepsSignal: boolean;
      readonly outcome: string;
      readonly serverFinished: boolean;
    }> {
      const tag = `round19-${enumerability}`;
      const target = control.url({ tag, delay: 400 });
      const controller = new AbortController();

      const options = Object.create(Object.prototype, {
        signal: {
          value: controller.signal,
          writable: true,
          configurable: true,
          enumerable: enumerability === "enumerable",
        },
      }) as TypedFetchOptions;

      let spreadKeepsSignal = false;
      const forwarding = (async (input: unknown, init: RequestInit) => {
        const forwarded = { ...init } as RequestInit;
        spreadKeepsSignal = forwarded.signal === controller.signal;
        return await NATIVE_FETCH(input as string, forwarded);
      }) as unknown as typeof fetch;

      setTimeout(() => controller.abort(), 60);
      const { response, error } = await withGlobalTransport(
        forwarding,
        async () => await typedFetch(target, options),
      );
      if (response) await response.text().catch(() => "");

      return {
        spreadKeepsSignal,
        outcome: error === null ? "success" : isAbortError(error) ? "AbortedError" : error.name,
        serverFinished: control.finished().includes(tag),
      };
    }

    const governed = { spreadKeepsSignal: true, outcome: "AbortedError", serverFinished: false };
    const observed = {
      "an own enumerable signal": await drive("enumerable"),
      "an own non-enumerable signal": await drive("non-enumerable"),
    };

    expect(
      observed,
      "an own non-enumerable `signal` never reaches the transport's spread, so " +
        "`controller.abort()` cancels nothing: the server writes the whole response and the " +
        "envelope reports a success for a request the caller aborted",
    ).toEqual({
      "an own enumerable signal": governed,
      "an own non-enumerable signal": governed,
    });
  }, 30_000);
});

// ── B. The pin that names R18-H1-01's defect and cannot fail for it ────────

/**
 * `snapshotRequestInit` as it stood before round 18, reconstructed verbatim
 * from `0488d47^:src/request-plan.ts`.
 *
 * This is the implementation R18-H1-01 proved defective. It is here so a pin
 * can be fed a KNOWN-BAD subject and its own verdict measured — the only way to
 * establish that a passing gate is a gate that can fail.
 */
function preRound18SnapshotRequestInit(
  options: TypedFetchOptions,
  signal: AbortSignal | null | undefined,
  removeFetchOverride: boolean,
): RequestInit {
  if (!removeFetchOverride) {
    return new Proxy(options, {
      get(target, property) {
        if (property === "signal") return signal;
        return Reflect.get(target, property, target);
      },
    }) as RequestInit;
  }

  const descriptors = Object.getOwnPropertyDescriptors(options);
  delete descriptors.fetch;
  if (descriptors.signal || signal !== undefined) {
    descriptors.signal = {
      value: signal,
      writable: true,
      enumerable: descriptors.signal?.enumerable ?? true,
      configurable: true,
    };
  }
  const sanitizedTarget = Object.create(Object.getPrototypeOf(options), descriptors) as RequestInit;

  return new Proxy(sanitizedTarget, {
    get(_target, property) {
      if (property === "signal") return signal;
      if (property === "fetch") return undefined;
      return Reflect.get(options, property, options);
    },
    has(_target, property) {
      return property === "fetch" ? false : Reflect.has(options, property);
    },
  }) as RequestInit;
}

/** The pre-round-18 init for one options object, built the way `planRequest` builds it. */
function preRound18Init(options: TypedFetchOptions): RequestInit {
  return preRound18SnapshotRequestInit(
    options,
    options.signal,
    Object.hasOwn(options as object, "fetch"),
  );
}

describe("round 19 / H1 — what the signal-forwarding pins can still fail for", () => {
  test("R19-H1-02: the pin that names R18-H1-01's defect passes against the defect", () => {
    // THE GATE UNDER TEST. `tests/request/request-plan.spec.ts`:
    //
    //   test("an inherited signal is materialized as an own key, so a spread
    //         keeps it", () => {
    //     const controller = new AbortController();
    //     const options = Object.create({ signal: controller.signal }) as …;
    //     options.fetch = recordingTransport().fetch;          // ← the line
    //     const { init } = planRequest(ABSOLUTE, options as TypedFetchOptions);
    //     expect({ ...init }.signal).toBe(controller.signal);
    //     expect(init.signal).toBe(controller.signal);
    //   });
    //
    // Round 18 recorded that this pin "passes a `fetch` option, so it selects
    // the working branch one line before it asserts". The fix landed. The pin
    // did not change. So the pin still cannot fail for the defect its own title
    // names, and this measures that rather than asserting it.
    //
    // THE INSTRUMENT. The pin's exact fixture is run through the pre-round-18
    // implementation — the one R18-H1-01 proved wrong — and the pin's exact two
    // assertions are evaluated against the result. A gate that can fail reports
    // at least one violation here. This one reports none.
    //
    // MEASURED SEPARATELY, and this is what makes it matter: forcing
    // `inheritedSignal` to `false` in `src/request-plan.ts` — the whole of
    // R18-H1-01 — leaves `pnpm test` with exactly ONE failure, in
    // `tests/request/round18-h1-request.spec.ts`, which is
    // `describe.skipIf(!distExists)`. On a checkout with no `dist/`, the round
    // 18 defect passes the entire suite.
    // THE REPAIR THIS TEST NOW GUARDS. The `fetch` line is gone from the pin,
    // and the `fetch` case is a separate test beside it. So the fixture the pin
    // actually runs is read out of the committed source rather than copied
    // here: a test that hardcodes the fixture it audits measures a constant,
    // and it can never go green when the pin is repaired. Re-adding a `fetch`
    // option to the pin turns this red, which is what breaking-what-it-guards
    // means for a gate whose subject is another test.
    const pinSource = readFileSync(
      fileURLToPath(new URL("./request-plan.spec.ts", import.meta.url)),
      "utf8",
    );
    const pinStart = pinSource.indexOf(
      'test("an inherited signal is materialized as an own key, so a spread keeps it"',
    );
    expect(pinStart, "the pin R18-H1-01 named must still exist").not.toBe(-1);
    const pinBody = pinSource
      .slice(pinStart, pinSource.indexOf("\n  });", pinStart))
      // The prose above the fixture discusses the `fetch` option; the code must
      // not use it.
      .replaceAll(/^\s*\/\/.*$/gm, "");
    expect(
      /\bfetch\b/.test(pinBody),
      "the pin must not pass a `fetch` option: that selects the branch which already " +
        "carried the entry, one line before the pin asserts",
    ).toBe(false);

    const controller = new AbortController();
    const options = Object.create({ signal: controller.signal }) as Record<string, unknown>;

    const defectiveInit = preRound18Init(options as TypedFetchOptions);
    const violations: string[] = [];
    // The pin's own two assertions, as predicates.
    if ({ ...(defectiveInit as Record<string, unknown>) }.signal !== controller.signal) {
      violations.push("the spread drops the inherited signal");
    }
    if (defectiveInit.signal !== controller.signal) {
      violations.push("the init does not report the inherited signal");
    }

    // Non-vacuity: the SAME reconstruction, on the branch the pin does not
    // select — no `fetch` option — reports the defect at once. So the
    // reconstruction is faithful and the instrument works; it is the pin's
    // fixture that hides the branch.
    const unguarded = Object.create({ signal: controller.signal }) as TypedFetchOptions;
    const unguardedInit = preRound18Init(unguarded);
    expect({ ...(unguardedInit as Record<string, unknown>) }.signal).not.toBe(controller.signal);

    expect(
      violations,
      '`request-plan.spec.ts` > "an inherited signal is materialized as an own key, so a ' +
        'spread keeps it" writes `options.fetch` one line before it asserts, which selects the ' +
        "branch that already carried the entry: the pin passes against the very implementation " +
        "R18-H1-01 proved defective, so it cannot fail for the defect it names",
    ).not.toEqual([]);
  });
});

// ── C. The re-entering transport, after round 18's rewrite ────────────────

describe("round 19 / H1 — transport re-entry on the branch round 18 opened", () => {
  test("an init built on the new branch still carries no fetch a re-entry can select", async () => {
    // FRONTIER ITEM 3, measured. Round 18's rewrite made the SANITIZED branch
    // reachable with no own `fetch` at all: an inherited `signal` now selects
    // it. That is a shape the transport-re-entry sentence had never been read
    // on, and the sentence is stated in two places — CONTEXT.md, "Transport
    // re-entry", and the `snapshotRequestInit` docblock.
    //
    // The five reads, on that new branch, with an inherited `fetch` sitting on
    // the same prototype: the three that inspect the init's own shape answer
    // absent, and the two that walk the chain answer the caller's value. That
    // is the round-17-corrected sentence exactly, and it still holds.
    const inheritedFetch = (async () => new Response("never")) as unknown as typeof fetch;
    const controller = new AbortController();
    const options = Object.create({
      signal: controller.signal,
      fetch: inheritedFetch,
    }) as TypedFetchOptions;

    const plan = planRequest(ABSOLUTE, options);
    const init = plan.init as Record<string, unknown>;

    expect(Object.getOwnPropertyDescriptor(init, "fetch")).toBe(undefined);
    expect(Reflect.ownKeys(init)).not.toContain("fetch");
    expect(Object.hasOwn({ ...init }, "fetch")).toBe(false);
    // The two chain reads answer the caller's value, because no own `fetch` was
    // passed and nothing was stripped.
    expect(init.fetch).toBe(inheritedFetch);
    expect("fetch" in init).toBe(true);
    // And the entry the new branch exists for is there.
    expect({ ...init }.signal).toBe(controller.signal);
    // The transport a re-entry would select is the AMBIENT one, because
    // `Object.hasOwn` decides that and it answers false.
    expect(planRequest(ABSOLUTE, plan.init as TypedFetchOptions).transport).toBe(globalThis.fetch);
  });

  test("a transport that calls typedFetch again with its own init runs exactly once", async () => {
    // The consequence the sentence exists for, at two levels of re-entry, with
    // an inherited `signal` on the options so the NEW branch is the one under
    // test. `outer` re-enters with the init it was handed; the inner call reads
    // no own `fetch` off it and runs the ambient transport, which reaches the
    // real server. One infinite loop avoided, and it is avoided by
    // `Object.hasOwn`, never by a plain get or an `in` check.
    const target = control.url({ tag: "reentry" });
    let entries = 0;
    const outer = (async (input: unknown, init: RequestInit) => {
      entries += 1;
      const { response, error } = await typedFetch(input as string, init as TypedFetchOptions);
      if (error !== null) throw error;
      return response as unknown as Response;
    }) as unknown as typeof fetch;

    const options = Object.create({ signal: new AbortController().signal }) as Record<
      string,
      unknown
    >;
    options.fetch = outer;

    const { response, error } = await typedFetch(target, options as TypedFetchOptions);
    expect(error).toBe(null);
    expect(await response?.text()).toBe("done");
    expect(entries).toBe(1);
  }, 20_000);
});

// ── D. Genuine platform responses phase 3 has never been shown ─────────────

describe("round 19 / H1 — phase 3 against the platform values round 18 did not build", () => {
  test("no constructed platform Response reaches a refusal either", async () => {
    // FRONTIER ITEM 4. Round 18 measured ten responses spelled on the wire.
    // These are the ones a wire cannot produce and a program can: the two
    // static constructors, a synthetic `Response.error()` whose `type` is
    // `"error"` and whose `status` is `0`, a body that is already LOCKED, a
    // body that is already DISTURBED, a `clone()` pair, and a subclass
    // instance. Each is a genuine platform value, so each satisfies every
    // structural read in `src/response-verdict.ts` by construction — and none
    // reaches a refusal.
    //
    // This does not close item 4 in code; it is the evidence for closing it in
    // WRITING. The ADR states out-of-scope item 3 as the precondition for the
    // RELEASE path alone, and it is the precondition for the whole refusal
    // path.
    const disturbed = new Response("used");
    await disturbed.text();
    const locked = new Response("locked");
    locked.body?.getReader();
    class Subclassed extends Response {}
    const cloneSource = new Response("clone", { status: 500 });
    const clonedPair = cloneSource.clone();

    const values: readonly (readonly [string, Response])[] = [
      ["Response.error()", Response.error()],
      ["Response.redirect(308)", Response.redirect("https://round19.test/next", 308)],
      ["Response.json()", Response.json({ ok: true }, { status: 418 })],
      ["a disturbed body", disturbed],
      ["a locked body", locked],
      ["a clone source", cloneSource],
      ["a clone", clonedPair],
      ["a subclass instance", new Subclassed("sub", { status: 404 })],
      ["a null body, 204", new Response(null, { status: 204 })],
      ["a null body, 500", new Response(null, { status: 500 })],
    ];

    const refusals: string[] = [];
    const verdicts: string[] = [];
    for (const [label, value] of values) {
      const transport = (async () => value) as unknown as typeof fetch;
      const { response, error } = await typedFetch(ABSOLUTE, { fetch: transport });
      if (error === null) {
        verdicts.push(`${label}: success ${response.status}`);
        continue;
      }
      if (error.name === "NetworkError") {
        refusals.push(`${label}: refused with ${String(error.cause)}`);
        continue;
      }
      verdicts.push(`${label}: ${error.name}`);
    }

    expect(refusals).toEqual([]);
    expect(verdicts.length).toBe(values.length);
    // Non-vacuity: the corpus spans both arms of the verdict.
    expect(verdicts.some((entry) => entry.includes("success"))).toBe(true);
    expect(verdicts.some((entry) => entry.includes("Error"))).toBe(true);
  }, 20_000);
});
