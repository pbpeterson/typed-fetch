import { inspect } from "node:util";
import { describe, expect, test } from "vitest";
import { everyChannel } from "../../fixtures/channels";
import { UnknownHttpError } from "../../src/errors";
import { classifyResolvedValue, type ResponseVerdict } from "../../src/response-verdict";

function responseWithStatusText(statusText: string, body: BodyInit | null = null): Response {
  const response = new Response(body, { status: 599 });
  Object.defineProperty(response, "statusText", {
    configurable: true,
    enumerable: false,
    value: statusText,
    writable: true,
  });
  return response;
}

function publicStrings(error: UnknownHttpError): Record<string, string> {
  return {
    statusText: error.statusText,
    message: error.message,
    json: JSON.stringify(error),
    toString: error.toString(),
    string: String(error),
    inspect: inspect(error, { depth: null }),
    ...everyChannel(error),
  };
}

function leaks(error: UnknownHttpError, character: string): string[] {
  return Object.entries(publicStrings(error))
    .filter(([, value]) => value.includes(character))
    .map(([channel]) => channel);
}

describe("round 3 / agent 3 — reason-phrase controls and public channels", () => {
  // README.md:1012 promises that UnknownHttpError.statusText carries the
  // server phrase in a filtered, bounded form. The implementation's
  // response-identity contract names invisible formatting controls as the
  // reason for the filter; these assigned Cf controls are not covered by the
  // current denylist.
  test.each([0x180e, 0xfff9, 0xfffa, 0xfffb] as const)(
    "filters invisible formatting control U+%s from every public channel",
    (code) => {
      const character = String.fromCodePoint(code);
      const error = new UnknownHttpError(responseWithStatusText(`pre${character}post`));

      expect(leaks(error, character)).toEqual([]);
    },
  );

  test("preserves ZWJ and ZWNJ in the reason phrase across every channel", () => {
    const zwnj = "\u200c";
    const zwj = "\u200d";
    const error = new UnknownHttpError(responseWithStatusText(`pre${zwnj}mid${zwj}post`));

    for (const [channel, value] of Object.entries(publicStrings(error))) {
      // Object.keys intentionally carries only names, not the values it names.
      // It is a channel-presence control, not a rendering of the reason phrase.
      if (channel === "5 Object.keys") continue;
      expect(value, `${channel} lost ZWNJ`).toContain(zwnj);
      expect(value, `${channel} lost ZWJ`).toContain(zwj);
    }
  });
});

describe("round 3 / agent 3 — response identity hostile getters", () => {
  // README.md's response-identity guarantee says each successful identity
  // field read is recorded immediately and the first successful read fixes a
  // Response's identity. Re-entry must not create a second read/identity.
  test.each(["statusText", "url", "headers"] as const)(
    "%s is read once even when its getter re-enters classification",
    (field) => {
      const response = new Response(null, { status: 599 });
      let reads = 0;
      let nested: ResponseVerdict | undefined;

      if (field === "statusText") {
        Object.defineProperty(response, field, {
          configurable: true,
          get() {
            const first = reads === 0;
            reads += 1;
            if (first) nested = classifyResolvedValue(response);
            return first ? "outer" : "inner";
          },
        });
      } else if (field === "url") {
        Object.defineProperty(response, field, {
          configurable: true,
          get() {
            const first = reads === 0;
            reads += 1;
            if (first) nested = classifyResolvedValue(response);
            return first ? "https://outer.test/" : "https://inner.test/";
          },
        });
      } else {
        const outer = new Headers([["x-round3", "outer"]]);
        const inner = new Headers([["x-round3", "inner"]]);
        Object.defineProperty(response, field, {
          configurable: true,
          get() {
            const first = reads === 0;
            reads += 1;
            if (first) nested = classifyResolvedValue(response);
            return first ? outer : inner;
          },
        });
      }

      const verdict = classifyResolvedValue(response);

      // The inner classification is refused while this identity getter is
      // still in progress; reading it again would create a second identity.
      expect(nested?.kind).toBe("refused");
      expect(verdict.kind).toBe("http");
      if (verdict.kind !== "http") return;
      expect(reads).toBe(1);
    },
  );

  test.each(["statusText", "url"] as const)(
    "does not accept a non-string %s from the outer validation read",
    (field) => {
      const response = new Response(null, { status: 200 });
      let reads = 0;
      let nested: ResponseVerdict | undefined;
      Object.defineProperty(response, field, {
        configurable: true,
        get() {
          const first = reads === 0;
          reads += 1;
          if (first) nested = classifyResolvedValue(response);
          return first ? 42 : field === "statusText" ? "OK" : "https://inner.test/";
        },
      });

      const verdict = classifyResolvedValue(response);

      // The nested call is refused while the outer getter is incomplete; the
      // outer call must still refuse the non-scalar identity it receives.
      expect(nested?.kind).toBe("refused");
      expect(verdict.kind).toBe("refused");
    },
  );

  test.each(["statusText", "url", "headers"] as const)(
    "a nested refusal from %s does not invalidate an outer accepted body",
    async (field) => {
      const response = new Response("round3-body", { status: 200 });
      let reads = 0;
      let nested: ResponseVerdict | undefined;

      if (field === "statusText") {
        Object.defineProperty(response, field, {
          configurable: true,
          get() {
            const first = reads === 0;
            reads += 1;
            if (first) nested = classifyResolvedValue(response);
            return first ? "OK" : 42;
          },
        });
      } else if (field === "url") {
        Object.defineProperty(response, field, {
          configurable: true,
          get() {
            const first = reads === 0;
            reads += 1;
            if (first) nested = classifyResolvedValue(response);
            return first ? "https://outer.test/" : 42;
          },
        });
      } else {
        const valid = new Headers([["x-round3", "valid"]]);
        Object.defineProperty(response, field, {
          configurable: true,
          get() {
            const first = reads === 0;
            reads += 1;
            if (first) nested = classifyResolvedValue(response);
            return first ? valid : {};
          },
        });
      }

      const verdict = classifyResolvedValue(response);

      expect(nested?.kind).toBe("refused");
      if (verdict.kind === "success") {
        await expect(verdict.response.text()).resolves.toBe("round3-body");
      } else if (verdict.kind === "http") {
        await expect(verdict.error.text()).resolves.toBe("round3-body");
      }
    },
  );

  test("status re-entry does not cancel the body of the outer HTTP error", async () => {
    // README.md:479-506 makes the returned HTTP error body readable/cancelable;
    // ADR 0003 H-14 says only a refused value is released. A nested refusal
    // must not release a response that the outer call still returns as HTTP.
    const response = new Response("round3-body", { status: 599 });
    let entered = false;
    let nested: ResponseVerdict | undefined;
    Object.defineProperty(response, "status", {
      configurable: true,
      get() {
        if (!entered) {
          entered = true;
          nested = classifyResolvedValue(response);
        }
        return 599;
      },
    });

    const verdict = classifyResolvedValue(response);
    expect(nested?.kind).toBe("refused");
    expect(verdict.kind).toBe("http");
    if (verdict.kind !== "http") return;

    try {
      await expect(verdict.error.text()).resolves.toBe("round3-body");
    } finally {
      await verdict.error.cancel();
    }
  });
});
