import { readFileSync } from "node:fs";
import { describe, test, expect } from "vitest";
import { HOSTILE_SCENARIOS, URL_UNDER_TEST, type HostileScenario } from "./fixtures/hostile-fetch";
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

async function drive(scenario: HostileScenario): Promise<unknown> {
  const input = scenario.input?.() ?? URL_UNDER_TEST;
  const { response, error } = await typedFetch(input, scenario.options());

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
