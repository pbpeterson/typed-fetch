import http from "node:http";
import { describe, expect, test, vi } from "vitest";
import { warnWhenDistMissing } from "../../fixtures/built-package";
import { everyChannel, leakingChannels, PASSWORD } from "../../fixtures/channels";
import { useTestServer } from "../../fixtures/http-server";
import { HOSTILE_SCENARIOS, URL_UNDER_TEST } from "../../fixtures/hostile-fetch";
import { foreignResponses } from "../../fixtures/responses";
import type { TypedFetchOptions } from "../../src/index";

// ═══════════════════════════════════════════════════════════════════════════
// ROUND 16, COVERAGE SUB-LANE C4, BLOCK 1 — `fixtures/**`.
//
// A fixture is TEST CODE, and section 8.7 says what its coverage test must
// assert: the fixture's own contract — the hostile behavior it promises and the
// shape it returns — never "the line ran".
//
// Everything reached here is a fixture's REFUSAL half. `hostile-fetch.ts` has
// eight `verify` hooks and one `after` hook, and every one of them was written
// as "throw when the envelope answered wrong". The throwing arm is the half
// that decides whether the conformance suite can fail at all: a `verify` whose
// throw is unreachable is a scenario that passes for any answer. That is
// section 8.7's last item, restated for test code — a check that has never
// failed is a check nobody has seen work.
//
// The unused method stubs are the other half. A body double whose `tee` returns
// something other than `undefined`, or a foreign `json()` that answers with a
// populated object, changes what the suite that uses it is testing. Each one is
// pinned to the shape it promises.
//
// This file does not touch `fixtures/http-server.ts`'s existing contract test.
// `tests/fixtures/http-server.spec.ts` owns the `?header=` rule; the one branch
// added here is `?echoHeader=`, which that file does not reach.
// ═══════════════════════════════════════════════════════════════════════════

const scenario = (id: string) => {
  const found = HOSTILE_SCENARIOS.find((entry) => entry.id === id);
  if (!found) throw new Error(`no hostile scenario ${id}`);
  return found;
};

/** The `verify` hook of a scenario that declares one. */
const verifierOf = (id: string): ((error: unknown) => void) => {
  const { verify } = scenario(id);
  if (!verify) throw new Error(`scenario ${id} declares no verify hook`);
  return verify;
};

// ═══════════════════════════════════════════════════════════════════════════
// hostile-fetch.ts — every refusal a scenario can make.
// ═══════════════════════════════════════════════════════════════════════════

describe("the conformance scenarios refuse the answer they were written to catch", () => {
  test("H-11 refuses a coerced Symbol where the normalized empty string is owed", () => {
    // The row's whole point: `String(Symbol("x"))` must never be what reaches
    // `statusText`. A verify that accepted "Symbol(x)" would pass the row while
    // the coercion it names had come back.
    expect(() => verifierOf("H-11")({ statusText: "Symbol(x)" })).toThrow(
      "expected the normalized empty string, not a coerced Symbol",
    );
    expect(() => verifierOf("H-11")({ statusText: "" })).not.toThrow();
  });

  test("H-12 refuses a url that was coerced instead of normalized", () => {
    expect(() => verifierOf("H-12")({ url: "42" })).toThrow("expected an empty url");
    expect(() => verifierOf("H-12")({ url: "" })).not.toThrow();
  });

  test("H-23 refuses a Request-shaped input whose non-string url survived", () => {
    expect(() => verifierOf("H-23")({ url: "42" })).toThrow("expected an empty url");
    expect(() => verifierOf("H-23")({ url: "" })).not.toThrow();
  });

  test("H-24 refuses a copied platform message, and refuses a lost cause", () => {
    // Two independent refusals in one hook, so both are asked. The first is the
    // library constant; the second is that the diagnostic stayed REACHABLE —
    // a redaction that deleted the platform error would pass the first check.
    expect(() =>
      verifierOf("H-24")({
        message: "Failed to construct 'Request': sk_live_CONFORMANCE",
        cause: new Error("sk_live_CONFORMANCE"),
      }),
    ).toThrow("unexpected message: Failed to construct 'Request': sk_live_CONFORMANCE");

    expect(() =>
      verifierOf("H-24")({ message: "Network error", cause: new Error("gone") }),
    ).toThrow("the platform error is not reachable through the cause");

    expect(() =>
      verifierOf("H-24")({
        message: "Network error",
        cause: new Error("sk_live_CONFORMANCE"),
      }),
    ).not.toThrow();
  });

  test("H-25 refuses each echoed slot and each raw line break on its own", () => {
    // One assertion per sentinel, because the hook loops: a hook that reported
    // only the first would leave the rest of the loop untested.
    for (const sentinel of ["CONFORMANCE_METHOD", "CONFORMANCE_REFERRER", "\r", "\n"]) {
      expect(() => verifierOf("H-25")({ message: `Network error ${sentinel}` })).toThrow(
        `the message carries ${sentinel}`,
      );
    }
    expect(() => verifierOf("H-25")({ message: "Network error" })).not.toThrow();
  });

  test("H-26 refuses an error filed against the SECOND serialization", () => {
    expect(() => verifierOf("H-26")({ url: "https://conformance.invalid/second" })).toThrow(
      "the error was filed against https://conformance.invalid/second",
    );
    expect(() => verifierOf("H-26")({ url: "https://conformance.invalid/first" })).not.toThrow();
  });
});

describe("H-14's second act refuses a stale identity and a stale status", () => {
  const after = (): ((options: TypedFetchOptions) => Promise<void>) => {
    const hook = scenario("H-14").after;
    if (!hook) throw new Error("H-14 declares no after hook");
    return hook;
  };

  test("it refuses a success, which is what a filed identity would produce", async () => {
    // A FRESH value per call, so the hook's own mutation cannot reach the value
    // `typedFetch` is handed. That is what a filed-and-reused identity looks
    // like from outside: the refused call's 200 comes back.
    const healthy = foreignResponses(URL_UNDER_TEST);

    await expect(after()({ fetch: async () => healthy() } as TypedFetchOptions)).rejects.toThrow(
      "the refused value's identity was filed and reused",
    );
  });

  test("it refuses an error carrying a status this presentation never reported", async () => {
    const failing = foreignResponses(URL_UNDER_TEST);

    await expect(
      after()({
        fetch: async () => failing({ status: 500, ok: false }),
      } as TypedFetchOptions),
    ).rejects.toThrow("expected the status this presentation reported");
  });
});

describe("the hostile scenarios' own doubles have the shape they promise", () => {
  test("H-06's status getter really does answer differently on a second read", async () => {
    // The row's whole premise. `typedFetch` reads `status` exactly once, so the
    // envelope can never show the second answer — which also means no suite has
    // ever checked that a second answer exists. A getter stuck on 404 would
    // make H-06 assert nothing at all.
    const options = scenario("H-06").options();
    const response = (await (options.fetch as typeof fetch)(URL_UNDER_TEST)) as Response;

    expect([response.status, response.status, response.status]).toEqual([404, 500, 500]);
  });

  test("H-26's input really does serialize to a second url on a second read", () => {
    // Same shape, on the request side. The row proves the error is filed
    // against the FIRST serialization, so the second one is never observed
    // through the envelope.
    const input = scenario("H-26").input?.();
    if (input === undefined) throw new Error("H-26 declares no input");

    expect([String(input), String(input)]).toEqual([
      "https://conformance.invalid/first",
      "https://conformance.invalid/second",
    ]);
  });

  test("H-04's body double answers every stream method with undefined", async () => {
    // The row exists to reach the `locked` typecheck, which needs every stream
    // METHOD present and none of them meaningful. A stub that answered with a
    // value would move the row onto a different gate.
    const options = scenario("H-04").options();
    const response = (await (options.fetch as typeof fetch)(URL_UNDER_TEST)) as unknown as {
      body: {
        locked: unknown;
        cancel: () => unknown;
        getReader: () => unknown;
        pipeThrough: () => unknown;
        pipeTo: () => unknown;
        tee: () => unknown;
      };
    };

    expect({
      locked: response.body.locked,
      cancel: response.body.cancel(),
      getReader: response.body.getReader(),
      pipeThrough: response.body.pipeThrough(),
      pipeTo: response.body.pipeTo(),
      tee: response.body.tee(),
    }).toEqual({
      locked: "no",
      cancel: undefined,
      getReader: undefined,
      pipeThrough: undefined,
      pipeTo: undefined,
      tee: undefined,
    });
  });

  test("H-21's options proxy answers `fetch` and throws for every other read", () => {
    // Both arms of the trap. The scenario's outcome proves the throwing arm
    // through the envelope; nothing proved the `fetch` arm answers at all, and
    // a trap that threw for `fetch` too would make the row a different test.
    const options = scenario("H-21").options();

    expect(typeof options.fetch).toBe("function");
    expect(() => options.signal).toThrow("hostile options getter");
  });

  test("H-27's response reads as an empty body, so the getter is the only hostile part", async () => {
    // Every read below is safe to make: the scenario's hostility is on `status`
    // alone, and reading `status` here would abort the controller the scenario
    // owns. The row's claim is that reading a resolved value is not the
    // transport, so the rest of the value has to be an ordinary empty body.
    const options = scenario("H-27").options();
    const response = (await (options.fetch as typeof fetch)(URL_UNDER_TEST)) as unknown as Response;

    expect({
      arrayBuffer: (await response.arrayBuffer()).byteLength,
      blob: (await response.blob()).size,
      cloneIsTheSameValue: response.clone() === response,
      formData: [...(await response.formData()).keys()],
      json: await response.json(),
      text: await response.text(),
    }).toEqual({
      arrayBuffer: 0,
      blob: 0,
      cloneIsTheSameValue: true,
      formData: [],
      json: {},
      text: "",
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// responses.ts — the foreign response's baseline.
// ═══════════════════════════════════════════════════════════════════════════

describe("`foreignResponses` returns a value that satisfies the baseline and reads empty", () => {
  test("every reader answers the empty form of its own type", async () => {
    const foreignResponse = foreignResponses("https://fixture.test/x");
    const response = foreignResponse() as unknown as Response;

    expect({
      arrayBuffer: (await response.arrayBuffer()).byteLength,
      blob: (await response.blob()).size,
      formData: [...(await response.formData()).keys()],
      json: await response.json(),
      text: await response.text(),
    }).toEqual({
      arrayBuffer: 0,
      blob: 0,
      formData: [],
      json: {},
      text: "",
    });
  });

  test("`clone()` answers with a fresh value carrying the same overrides", () => {
    const foreignResponse = foreignResponses("https://fixture.test/x");
    const response = foreignResponse({ status: 503 }) as unknown as Response;
    const copy = response.clone();

    // A FRESH value, not the same one: a clone that returned `this` would let a
    // suite read a body twice through one object and never notice.
    expect(copy).not.toBe(response);
    expect({ status: copy.status, url: copy.url }).toEqual({
      status: 503,
      url: "https://fixture.test/x",
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// built-package.ts — the missing-`dist` report.
//
// Its contract is asymmetric on purpose, and the asymmetry is the whole point:
// a missing `dist/` locally is a developer who has not built yet, and the same
// state in CI means the workflow lost its build-before-test ordering and the
// built surface silently stopped being checked.
// ═══════════════════════════════════════════════════════════════════════════

describe("`warnWhenDistMissing` reports a missing dist by where it is running", () => {
  test("in CI a missing dist is an error naming the workflow that must build", () => {
    const previous = process.env.CI;
    process.env.CI = "1";
    try {
      expect(() => warnWhenDistMissing("round16-probe", false)).toThrow(
        /\[round16-probe\] dist\/ not found in CI/,
      );
      expect(() => warnWhenDistMissing("round16-probe", false)).toThrow(".github/workflows/ci.yml");
    } finally {
      if (previous === undefined) delete process.env.CI;
      else process.env.CI = previous;
    }
  });

  test("locally a missing dist warns and names the suite that skipped", () => {
    const previous = process.env.CI;
    delete process.env.CI;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      warnWhenDistMissing("round16-probe", false);

      expect(warn).toHaveBeenCalledTimes(1);
      const printed = String(warn.mock.calls[0]?.[0] ?? "");
      expect(printed).toContain("[round16-probe] dist/ not found");
      expect(printed).toContain("pnpm build");
    } finally {
      warn.mockRestore();
      if (previous !== undefined) process.env.CI = previous;
    }
  });

  test("a present dist reports nothing at all", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(() => warnWhenDistMissing("round16-probe", true)).not.toThrow();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// channels.ts — the harness that decides whether a disclosure hunt can fail.
// ═══════════════════════════════════════════════════════════════════════════

describe("`leakingChannels` names every channel that emitted a secret", () => {
  test("an error carrying the secret in its message leaks through the message channels", () => {
    // Every suite that uses this harness asserts the EMPTY list. Nothing asked
    // whether the non-empty list is ever produced, or whether it names the
    // channel a reader has to go and fix.
    const leaked = leakingChannels(everyChannel(new Error(`token ${PASSWORD}`)), [PASSWORD]);

    expect(leaked).toContain("4 error.message");
    expect(leaked).toContain("3 String(error)");
    // The label is the channel number a reader looks up in the inventory.
    expect(leaked.every((label) => /^\d /.test(label))).toBe(true);
  });

  test("a secret nobody planted leaves the empty list, which is the pass", () => {
    expect(leakingChannels(everyChannel(new Error("nothing here")), [PASSWORD])).toEqual([]);
  });

  test("an error whose `toJSON` answers nothing renders as the empty string, not `undefined`", () => {
    // `JSON.stringify` answers `undefined` for a value whose `toJSON` does, and
    // an `undefined` in the rendered set would make `text.includes` throw and
    // take the whole hunt down instead of reporting a channel.
    // NON-ENUMERABLE, exactly as this library defines every hook it stamps. An
    // enumerable one would also be copied by the spread channel, which renders
    // without a fallback, and the test would be about a different line.
    const error = new Error("silent");
    Object.defineProperty(error, "toJSON", { value: () => undefined, configurable: true });

    const rendered = everyChannel(error);

    expect(rendered["1 JSON.stringify"]).toBe("");
    expect(leakingChannels(rendered, [PASSWORD])).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// http-server.ts — the `?echoHeader=` arm.
//
// `tests/fixtures/http-server.spec.ts` owns `?header=`. This is the other
// query the server answers, and its non-string arm is the one a test needs:
// `set-cookie` arrives at a Node server as an ARRAY, whatever the client sent,
// so a suite echoing it back would otherwise read `a=1,b=2` or a stringified
// array and blame the library.
// ═══════════════════════════════════════════════════════════════════════════

const server = useTestServer();

/** One request through `node:http`, which can send a header `fetch` reserves. */
function request(
  url: string,
  headers: http.OutgoingHttpHeaders,
): Promise<http.IncomingHttpHeaders> {
  return new Promise((resolve, reject) => {
    const call = http.request(url, { headers }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.headers));
    });
    call.on("error", reject);
    call.end();
  });
}

describe("the test server's `?echoHeader=` arm", () => {
  test("it echoes a request header the caller sent as a string", async () => {
    const headers = await request(server.url({ echoHeader: "X-Probe" }), { "X-Probe": "sent" });

    expect(headers["x-echo-header"]).toBe("sent");
  });

  test("it echoes an empty value for a header the platform delivers as a list", async () => {
    // `set-cookie` is the one request header Node always hands over as an
    // array. The server answers "" rather than the array's `toString`, so a
    // suite reading `X-Echo-Header` never sees a value the client did not send.
    const headers = await request(server.url({ echoHeader: "set-cookie" }), {
      "set-cookie": "a=1",
    });

    expect(headers["x-echo-header"]).toBe("");
  });

  test("no `?echoHeader=` means no echo header at all", async () => {
    const headers = await request(server.url(), {});

    expect(headers["x-echo-header"]).toBeUndefined();
    // The method echo is unconditional, which is what the other arm of line 52
    // promises every suite that asserts a method reached the server.
    expect(headers["x-echo-method"]).toBe("GET");
  });
});
