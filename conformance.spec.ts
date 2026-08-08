import { readFileSync } from "node:fs";
import { describe, test, expect } from "vitest";
import { HOSTILE_SCENARIOS, URL_UNDER_TEST, type HostileScenario } from "./fixtures/hostile-fetch";
import type { TypedFetchOptions } from "./src/index";
import { isAbortError, isHttpError, isTimeoutError, typedFetch } from "./src/index";
import { NetworkError, UnknownHttpError } from "./src/errors";

/**
 * THE UNTRUSTED-`fetch` BOUNDARY, AS TESTS.
 *
 * `typedFetch` invites a consumer to inject a `fetch`, which makes the resolved
 * value, the rejection, the signal, and the options object all untrusted input.
 * How far that distrust goes is a DECISION, and an undecided one generates
 * findings forever: every "what if the implementation also did X" is a valid
 * report for every X, and each defense adds surface for the next round to aim
 * at.
 *
 * ADR 0003 draws the line. This file makes it executable, and the last test
 * below binds the two together: the scenarios here and the in-scope rows there
 * must be the same set, with the same titles. Neither can move alone.
 *
 * A new hostile scenario is therefore one of three things, never a silent code
 * change:
 *  - already a row, and covered;
 *  - out of scope, which the ADR states permanently; or
 *  - a proposal to AMEND the ADR, which adds a row here in the same commit.
 */

const ADR = "docs/adr/0003-the-untrusted-fetch-conformance-boundary.md";

/** The options `drive()` used, so a row's second act can reuse them. */
let driven: TypedFetchOptions | undefined;

async function drive(scenario: HostileScenario): Promise<unknown> {
  const input = scenario.input?.() ?? URL_UNDER_TEST;
  // ONE options object, kept, because a row whose claim is about the next call
  // has to present the same value again. See `HostileScenario.after`.
  const options = scenario.options();
  const { response, error } = await typedFetch(input, options);
  driven = options;

  // The structural promise every row shares: a hostile implementation is
  // answered with a VALUE, never a rejection. Which value the row states.
  if (scenario.outcome.kind === "success") {
    expect(error).toBe(null);
    expect(response).not.toBe(null);
    return null;
  }

  expect(response).toBe(null);
  expect(error).not.toBe(null);
  return error;
}

describe("the untrusted-fetch boundary — every in-scope row holds", () => {
  test.each(HOSTILE_SCENARIOS.map((scenario) => [scenario.id, scenario.title, scenario] as const))(
    "%s: %s",
    async (_id, _title, scenario) => {
      const error = await drive(scenario);

      switch (scenario.outcome.kind) {
        case "success": {
          break;
        }
        case "network": {
          expect(error).toBeInstanceOf(NetworkError);
          break;
        }
        case "aborted": {
          expect(isAbortError(error)).toBe(true);
          break;
        }
        case "timeout": {
          expect(isTimeoutError(error)).toBe(true);
          break;
        }
        case "unknownHttp": {
          expect(error).toBeInstanceOf(UnknownHttpError);
          if (!isHttpError(error)) throw new Error("expected an HTTP error");
          expect(error.status).toEqual(scenario.outcome.status);
          await error.cancel();
          break;
        }
        case "http": {
          expect(isHttpError(error)).toBe(true);
          if (!isHttpError(error)) throw new Error("expected an HTTP error");
          expect(error).not.toBeInstanceOf(UnknownHttpError);
          expect(error.status).toBe(scenario.outcome.status);
          await error.cancel();
          break;
        }
      }

      scenario.verify?.(error);
      // The second act, for a row that is about what the NEXT call sees.
      if (scenario.after) await scenario.after(driven as TypedFetchOptions);
    },
  );
});

describe("the untrusted-fetch boundary — the ADR and the corpus agree", () => {
  /** The in-scope table rows, as `[id, title]`. */
  function adrRows(): [string, string][] {
    const source = readFileSync(new URL(ADR, import.meta.url), "utf8");
    const inScope = source.slice(
      source.indexOf("### In scope"),
      source.indexOf("### Out of scope, permanently"),
    );

    // A slice that found neither heading would be the whole document, and a
    // slice that found only the first would run to the end. Both would still
    // parse rows, so the boundaries are checked rather than assumed.
    expect(source).toContain("### In scope");
    expect(source).toContain("### Out of scope, permanently");

    return [...inScope.matchAll(/^\|\s*(H-\d+)\s*\|\s*(.+?)\s*\|/gm)].map((match) => [
      match[1] as string,
      match[2] as string,
    ]);
  }

  test("every in-scope row is driven by a scenario, and every scenario is a row", () => {
    const rows = adrRows();

    // The guard against a vacuous guard: a regex that stopped matching, or a
    // heading that was renamed, would otherwise report perfect agreement
    // between two empty lists.
    expect(rows.length).toBeGreaterThan(15);
    expect(HOSTILE_SCENARIOS.length).toBe(rows.length);

    expect(HOSTILE_SCENARIOS.map((scenario) => [scenario.id, scenario.title])).toEqual(rows);
  });

  test("row numbers are dense, so a retired row is a visible edit", () => {
    // Numbers are never reused, exactly as ADR numbers are not. A gap means a
    // row was deleted rather than superseded, and the reader cannot tell which
    // defense went away.
    const numbers = HOSTILE_SCENARIOS.map((scenario) => Number(scenario.id.slice(2)));

    expect(numbers).toEqual(numbers.map((_value, index) => index + 1));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ROUND 4 — the prose that COUNTS the rows.
//
// The suite already binds the ADR's rows to the fixture's scenarios. Nothing
// bound the two documents a hostile-input reporter is told to read FIRST —
// `CONTRIBUTING.md` and the maintainer skill — to that same number, and both
// still said 26 after the phase split added H-27 and H-28. An under-count
// invites a report about a row that already exists, which is the cost this
// whole boundary was written to avoid.
// ═══════════════════════════════════════════════════════════════════════════

describe("the prose row count", () => {
  /** The number a document states, read out of the sentence that states it. */
  function statedCount(file: string, prefix: string, suffix: string): number {
    const line = readFileSync(new URL(file, import.meta.url), "utf8")
      .split("\n")
      .find((candidate) => candidate.includes(prefix) && candidate.includes(suffix));
    if (line === undefined) throw new Error(`${file} no longer states the row count`);
    return Number(line.slice(line.indexOf(prefix) + prefix.length, line.indexOf(suffix)).trim());
  }

  test("every document that counts the in-scope rows counts the same rows", () => {
    const adr = readFileSync(
      new URL("./docs/adr/0003-the-untrusted-fetch-conformance-boundary.md", import.meta.url),
      "utf8",
    );
    const rows = adr.split("\n").filter((line) => line.startsWith("| H-")).length;

    expect(rows).toBe(HOSTILE_SCENARIOS.length);
    expect({
      CONTRIBUTING: statedCount("./CONTRIBUTING.md", "in-scope table names", "behaviors"),
      maintainerSkill: statedCount(
        "./.claude/skills/typed-fetch-maintainer/SKILL.md",
        "boundary.md`:",
        "in-scope rows",
      ),
    }).toEqual({ CONTRIBUTING: rows, maintainerSkill: rows });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ROUND 6 — each row's own defence, isolated from the gate that answered for it.
//
// H-14's case is gone from here because the SCENARIO drives it now: the row
// presents the refused value a second time through its own `after` hook.
// ═══════════════════════════════════════════════════════════════════════════

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
  return Object.assign(base, overrides) as unknown as Response;
}

function scenarioOf(id: string) {
  const scenario = HOSTILE_SCENARIOS.find((candidate) => candidate.id === id);
  if (!scenario) throw new Error(`${id} is no longer a scenario`);
  return scenario;
}

describe("H-11 — a statusText that is not a string is normalized, never coerced", () => {
  /**
   * The published scenario uses status 404, and a dedicated class's
   * `statusText` is its own class field, initialized AFTER `super()`. It can
   * never carry a wire value, whatever the normalizer does, so the scenario's
   * `verify` cannot fail. Verified: coercing the recorded phrase with
   * `String(raw)` leaves conformance at 31/31 green.
   *
   * The value only becomes observable on a status with no dedicated class,
   * where `UnknownHttpError` publishes it.
   */
  test("an unmapped status publishes the empty string, not a coerced Symbol", async () => {
    const response = new Response(null, { status: 599 });
    Object.defineProperty(response, "statusText", {
      configurable: true,
      get() {
        return Symbol("hostile phrase");
      },
    });

    const { error } = await typedFetch(URL_UNDER_TEST, {
      fetch: (async () => response) as unknown as typeof fetch,
    });

    expect(error).toBeInstanceOf(UnknownHttpError);
    const unknown = error as UnknownHttpError;
    expect(unknown.statusText).toBe("");
    expect(unknown.toJSON().statusText).toBe("");
    await unknown.cancel();
  });
});

describe("H-04 — a Response whose body is not a stream", () => {
  /**
   * The published scenario's body is `{ locked: "no" }`, which carries none of
   * the five stream methods either — so it is the method gate that refuses it.
   * Verified: deleting the `typeof locked === "boolean"` conjunct leaves
   * conformance at 31/31 green.
   */
  test("a body carrying every stream method but a non-boolean `locked` is refused", async () => {
    const body = {
      locked: "no",
      cancel: async () => undefined,
      getReader: () => ({}),
      pipeThrough: () => undefined,
      pipeTo: async () => undefined,
      tee: () => [],
    };

    const { response, error } = await typedFetch(URL_UNDER_TEST, {
      fetch: (async () => foreignResponse({ body, status: 404 })) as unknown as typeof fetch,
    });

    expect(response).toBe(null);
    expect(error).toBeInstanceOf(NetworkError);
  });
});

describe("H-02 — an object that only spoofs the Response tag", () => {
  /**
   * The published scenario is `{ [Symbol.toStringTag]: "Response", status: 200 }`,
   * which carries no body reader either — so the method gate refuses it.
   * Verified: deleting the field-presence gate leaves conformance at 31/31
   * green.
   */
  test("a value missing one declared field is refused before class selection", async () => {
    const partial = foreignResponse({ status: 404 }) as unknown as Record<string, unknown>;
    delete partial.redirected;

    const { response, error } = await typedFetch(URL_UNDER_TEST, {
      fetch: (async () => partial) as unknown as typeof fetch,
    });

    expect(response).toBe(null);
    expect(error, "the field gate no longer refuses before class selection").toBeInstanceOf(
      NetworkError,
    );
  });
});
