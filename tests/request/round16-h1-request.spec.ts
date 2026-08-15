import { describe, expect, test } from "vitest";
import { isHttpError, isNetworkError, typedFetch } from "../../src/index";

// Round 16, lane H1 — the request path, cross-call custody, and the transport
// seam.
//
// Round 15 handed over four items. This file answers three of them by
// MEASUREMENT and states the fourth as a decision, because no test on a Node
// worker can reach it.
//
//  1. THE CROSS-CALL BODY RELEASE. Phase 3's catch releases the body of a
//     `Response` an earlier call already handed to a caller. Round 15 pinned the
//     SUCCESS arm of that (`request-cross-call-isolation.spec.ts`). Section A
//     takes the arm it did not: the victim is the body an HTTP ERROR owns, and
//     what the first caller observes is not an empty stream but a REJECTED read.
//     Both arms need the same sentence in ADR 0003, so both are pinned together.
//  2. `validatedResponseStructures` IS NEVER ROLLED BACK ON A REFUSAL. Section B
//     drives a refusal that happens AFTER the value entered the set, then an
//     acceptance of the same value, and counts every structural read. The stale
//     membership buys the second call nothing: all fifteen members are read
//     again.
//  3. A RE-ENTERING TRANSPORT LOSES ITS OWN OVERRIDE. Round 15 pinned that it
//     does not recurse. Section C pins WHICH transport the inner call runs on,
//     positively, and the three reads of `fetch` the handed-over init answers.
//  4. THE ABORT WINDOW ON A NON-NODE RUNTIME. Unmeasurable here; stated in the
//     lane's return instead of guessed at.
//
// Section D is the setup phase's parse count, taken through the platform seam
// round 15 found for the redactor: a `URL` subclass installed for the length of
// one SYNCHRONOUS call observes every parse the phase performs.

const FOREIGN_URL = "https://round16.test/resource";

/** A transport that answers every call with one value. */
function resolving(value: unknown): typeof fetch {
  return (async () => value) as unknown as typeof fetch;
}

/** Every member `isResponse` and the success-surface check read, in one place. */
const STRUCTURAL_MEMBERS = [
  "arrayBuffer",
  "blob",
  "body",
  "bodyUsed",
  "clone",
  "formData",
  "headers",
  "json",
  "ok",
  "redirected",
  "status",
  "statusText",
  "text",
  "type",
  "url",
] as const;

interface ForeignResponse {
  [key: string]: unknown;
}

/**
 * A structurally complete foreign `Response` whose members are own data
 * properties, so a test can break one between two calls.
 *
 * Built here rather than taken from `fixtures/responses.ts` for the reason
 * `request-cross-call-isolation.spec.ts` states: this file replaces members
 * with accessors that count their reads, and the shared builder reads an object
 * literal as a property DESCRIPTOR.
 */
function foreignResponse(
  overrides: Record<string, unknown> = {},
  real?: Response,
): ForeignResponse {
  const value: ForeignResponse = {
    [Symbol.toStringTag]: "Response",
    body: real ? real.body : null,
    bodyUsed: false,
    headers: new Headers({ "content-type": "text/plain" }),
    ok: true,
    redirected: false,
    status: 200,
    statusText: "OK",
    type: "basic",
    url: FOREIGN_URL,
    arrayBuffer: async () => new ArrayBuffer(0),
    blob: async () => new Blob(),
    clone: () => value,
    formData: async () => new FormData(),
    json: async () => ({}),
    text: async () => (real ? await real.text() : ""),
    ...overrides,
  };
  return value;
}

// ── A. The cross-call release, on the arm round 15 did not take ────────────

describe("round 16 / H1 — a later refusal releases a body an earlier call gave away", () => {
  test("the HTTP error an earlier call returned can no longer read its own body", async () => {
    // Round 15 pinned this mechanism for a SUCCESS: the caller's stream ends
    // silently, with none of the bytes the server sent. The HTTP-error arm is
    // the same mechanism with a different owner and a LOUDER outcome, and it is
    // the arm a consumer is most likely to be in — an error body is the one this
    // library tells a caller they must read or cancel.
    //
    // The path is the same one ADR 0003 puts out of scope as item 3, "anything
    // after the handoff": the value answers a structural read differently once
    // the first call has already returned it. Reaching it needs no changing
    // getter at all here — one removed method between the two calls is enough,
    // which is why the sentence ADR 0003 still owes this behavior has to name
    // BOTH arms rather than the success arm alone.
    const wire = new Response("payload");
    const value = foreignResponse({ status: 404, statusText: "Not Found", ok: false }, wire);
    const fetch = resolving(value);

    const first = await typedFetch(FOREIGN_URL, { fetch });
    if (!isHttpError(first.error)) throw new Error("expected an HTTP error");
    expect(first.error.status).toBe(404);

    // The second call refuses the same object at a STRUCTURAL check, so phase 3
    // reaches its catch and releases the body — the body the error above owns.
    value.json = undefined;
    const second = await typedFetch(FOREIGN_URL, { fetch });
    expect(second.response).toBe(null);
    expect(isNetworkError(second.error)).toBe(true);

    // What the FIRST caller observes. Not an empty body: a read that rejects,
    // on an error whose identity is intact and whose obligation it has not yet
    // discharged.
    await expect(first.error.text()).rejects.toThrow(/Body is unusable/u);
    expect(wire.bodyUsed).toBe(true);

    // The obligation is still dischargeable, which is the one thing that keeps
    // this out of the "stranded stream" class: `cancel()` settles rather than
    // hanging, because the body is already consumed and step 4 of the decision
    // order has nothing left to release.
    await expect(first.error.cancel()).resolves.toBeUndefined();
  });

  test("a value no earlier call handed out is still released on refusal", async () => {
    // The other side of the same conditional, and the reason a custody guard is
    // not free: the release exists so that a body no caller will ever hold is
    // closed rather than left open. A refusal on the FIRST presentation must
    // keep releasing.
    const wire = new Response("payload");
    const value = foreignResponse({ json: undefined }, wire);

    const refused = await typedFetch(FOREIGN_URL, { fetch: resolving(value) });

    expect(refused.response).toBe(null);
    expect(isNetworkError(refused.error)).toBe(true);
    expect(wire.bodyUsed).toBe(true);
  });
});

// ── B. What a refused acceptance leaves in the WeakSet ─────────────────────

describe("round 16 / H1 — a refusal downstream of the structural acceptance", () => {
  test("the next call re-reads every structural member instead of trusting the set", async () => {
    // `validatedResponseStructures.add(value)` runs at the END of `isResponse`,
    // and nothing removes it. A value can therefore enter the set and STILL be
    // refused by the same call, one layer further down — the success-surface
    // check, or the HTTP-error constructor. Round 15 pinned the set is not a
    // cache for a value it ACCEPTED; the entry a REFUSED call leaves behind is
    // the case that was left open, because a helper reading membership as
    // "already validated" would inherit a stale acceptance on its first day.
    //
    // Read counts are the measurement, not the verdict alone: a shortcut would
    // show up as a member the second call never asks for.
    const reads: Record<string, number> = {};
    let typeReads = 0;
    const template = foreignResponse();
    const value: Record<string | symbol, unknown> = {};
    Object.defineProperty(value, Symbol.toStringTag, { value: "Response" });
    for (const member of STRUCTURAL_MEMBERS) {
      const held = template[member];
      Object.defineProperty(value, member, {
        get(): unknown {
          reads[member] = (reads[member] ?? 0) + 1;
          if (member !== "type") return held;
          // The FIRST call refuses at the success surface, after `isResponse`
          // has already added the value to the set. The second answers honestly.
          typeReads += 1;
          return typeReads === 1 ? "bogus" : "basic";
        },
        enumerable: true,
        configurable: true,
      });
    }
    const fetch = resolving(value);

    const refused = await typedFetch(FOREIGN_URL, { fetch });
    expect(isNetworkError(refused.error)).toBe(true);
    const afterRefusal = { ...reads };

    const accepted = await typedFetch(FOREIGN_URL, { fetch });
    expect(accepted.error).toBe(null);
    expect(accepted.response).toBe(value as unknown as typeof accepted.response);

    // Every member the refused call read, the accepted call read again. The
    // body is read twice on the accepted path: once to establish custody and
    // once at the handoff to ensure a mutable response did not replace it while
    // the other structural getters ran. The four identity fields are in that
    // list because the refusal rolled their records back; the other structural
    // members are in it because membership of the set decides nothing.
    const secondCall = Object.fromEntries(
      STRUCTURAL_MEMBERS.map((member) => [
        member,
        (reads[member] ?? 0) - (afterRefusal[member] ?? 0),
      ]),
    );
    expect(secondCall).toEqual(
      Object.fromEntries(STRUCTURAL_MEMBERS.map((m) => [m, m === "body" ? 2 : 1])),
    );

    // Non-vacuity for the refused call itself: it read every member too. The
    // first body observation is now handed to cleanup through the internal
    // custody snapshot, so release must not invoke a mutable body getter again.
    for (const member of STRUCTURAL_MEMBERS) {
      expect(afterRefusal[member]).toBeGreaterThanOrEqual(1);
    }
    expect(afterRefusal["body"]).toBe(1);
  });
});

// ── C. Which transport a re-entering transport re-enters on ────────────────

describe("round 16 / H1 — a transport that calls typedFetch from inside itself", () => {
  test("the inner call runs on the AMBIENT transport, because the init carries no fetch", async () => {
    // Round 15 pinned that re-entering does not recurse. It did not pin what the
    // inner call runs on INSTEAD, and "it did not recurse" is also what a call
    // that failed outright would look like. The positive form: the inner request
    // is served by the platform's own transport, proved by a `data:` URL that
    // only a real `fetch` resolves — the injected transport never sees it.
    let outerCalls = 0;
    let innerBody = "";
    let initSawFetch: unknown;
    const transport = (async (_input: unknown, init: RequestInit) => {
      outerCalls += 1;
      initSawFetch = {
        own: Object.hasOwn(init, "fetch"),
        inOperator: "fetch" in init,
        read: (init as { fetch?: unknown }).fetch,
      };
      const inner = await typedFetch("data:text/plain,inner", init as never);
      expect(inner.error).toBe(null);
      innerBody = (await inner.response?.text()) ?? "";
      return new Response("outer", { status: 200 });
    }) as unknown as typeof fetch;

    const result = await typedFetch("data:text/plain,outer", {
      fetch: transport,
      method: "GET",
    });

    // The override reached the OUTER call once, and could not reach the inner
    // one: the snapshot strips this library's own extension from the init, and
    // it strips it from all three reads a re-entering transport can make.
    expect(outerCalls).toBe(1);
    expect(initSawFetch).toEqual({
      own: false,
      inOperator: false,
      read: undefined,
    });

    // Both calls answered, each from its own transport.
    expect(innerBody).toBe("inner");
    expect(result.error).toBe(null);
    expect(await result.response?.text()).toBe("outer");
  });
});

// ── D. What the setup phase parses ─────────────────────────────────────────

describe("round 16 / H1 — the parses the setup phase performs", () => {
  test("a URL subclass installed for one synchronous call counts zero parses", async () => {
    // The seam round 15 found for the redactor, pointed at the request path:
    // `URL` is resolved as a GLOBAL on every use, so a subclass installed for
    // the length of one synchronous call observes every parse. The setup phase
    // is synchronous from the call expression through the transport invocation,
    // so the window closes before the first `await`.
    //
    // The count is ZERO, and that is the claim worth pinning. `planRequest`
    // SERIALIZES its input and never parses it: no origin is computed, no path
    // is normalized, and no relative reference is resolved. A change that added
    // one parse would also add a second read of a caller-controlled `toString`
    // — the split ADR 0003 row H-26 forbids — and this is what would report it.
    const NativeUrl = globalThis.URL;
    let parses = 0;
    class CountingUrl extends NativeUrl {
      constructor(...args: ConstructorParameters<typeof NativeUrl>) {
        super(...args);
        parses += 1;
      }
    }

    let serializations = 0;
    const input = {
      toString(): string {
        serializations += 1;
        return FOREIGN_URL;
      },
    };

    let pending: Promise<unknown>;
    const globals = globalThis as { URL: typeof NativeUrl };
    globals.URL = CountingUrl as unknown as typeof NativeUrl;
    let nonVacuous = 0;
    try {
      pending = typedFetch(input as unknown as string, {
        fetch: resolving(foreignResponse()),
      });
      // Non-vacuity: the counter really does see a parse made through the global
      // while the subclass is installed.
      new globals.URL("https://non-vacuous.test/");
      nonVacuous = parses;
    } finally {
      globals.URL = NativeUrl;
    }
    const result = await pending;

    expect(nonVacuous).toBe(1);
    expect(parses).toBe(1);
    expect(serializations).toBe(1);
    expect(result).toHaveProperty("error", null);
  });
});
