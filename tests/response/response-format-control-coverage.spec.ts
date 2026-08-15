import { inspect } from "node:util";
import { describe, expect, test } from "vitest";
import { everyChannel } from "../../fixtures/channels";
import { UnknownHttpError } from "../../src/errors";
import { classifyResolvedValue } from "../../src/response-verdict";

function publicChannels(error: UnknownHttpError): Record<string, string> {
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

function channelsContaining(error: UnknownHttpError, character: string): string[] {
  return Object.entries(publicChannels(error))
    .filter(([, rendered]) => rendered.includes(character))
    .map(([channel]) => channel);
}

function unknownErrorOf(value: ReturnType<typeof classifyResolvedValue>): UnknownHttpError {
  if (value.kind !== "http" || !(value.error instanceof UnknownHttpError)) {
    throw new Error(`expected UnknownHttpError, got ${value.kind}`);
  }
  return value.error;
}

function responseWithStatusText(statusText: string): Response {
  const response = new Response(null, { status: 599 });
  Object.defineProperty(response, "statusText", {
    configurable: true,
    value: statusText,
  });
  return response;
}

describe("uncovered format controls", () => {
  test.each([
    [0x0600, "ARABIC NUMBER SIGN"],
    [0x0605, "ARABIC NUMBER MARK ABOVE"],
    [0x06dd, "ARABIC END OF AYAH"],
    [0x070f, "SYRIAC ABBREVIATION MARK"],
    [0x0890, "ARABIC POUND MARK ABOVE"],
    [0x08e2, "ARABIC DISPUTED END OF AYAH"],
    [0x110bd, "KAITHI NUMBER SIGN"],
    [0x110cd, "KAITHI NUMBER SIGN"],
    [0x13430, "EGYPTIAN HIEROGLYPH FORMAT CONTROL"],
    [0x1d173, "MUSICAL SYMBOL BEGIN BEAM"],
  ] as const)("does not leak U+%s (%s) through public channels", (code, _label) => {
    const character = String.fromCodePoint(code);
    const error = new UnknownHttpError(responseWithStatusText(`before${character}after`));

    expect(channelsContaining(error, character)).toEqual([]);
  });

  test("control: preserves joiners and variation selectors", () => {
    const zwnj = "\u200c";
    const zwj = "\u200d";
    const variationSelector = "\ufe0f";
    const error = new UnknownHttpError(
      responseWithStatusText(`before${zwnj}mid${zwj}👩${variationSelector}after`),
    );

    for (const [channel, rendered] of Object.entries(publicChannels(error))) {
      if (channel === "5 Object.keys") continue;
      expect(rendered, `${channel} lost ZWNJ`).toContain(zwnj);
      expect(rendered, `${channel} lost ZWJ`).toContain(zwj);
      expect(rendered, `${channel} lost variation selector`).toContain(variationSelector);
    }
  });
});

describe("acceptance, retries, and wrapper custody", () => {
  test("control: a stable accepted response remains readable", async () => {
    const response = new Response("round6-body", { status: 200 });
    const verdict = classifyResolvedValue(response);

    expect(verdict.kind).toBe("success");
    if (verdict.kind !== "success") return;

    await expect(verdict.response.text()).resolves.toBe("round6-body");
  });

  test("a refusal of a distinct wrapper does not cancel an already accepted response body", async () => {
    const response = new Response("round6-body", { status: 200 });
    const accepted = classifyResolvedValue(response);

    expect(accepted.kind).toBe("success");

    const wrapper = new Proxy(response, {
      get(target, property) {
        if (property === "formData") return undefined;
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const refused = classifyResolvedValue(wrapper);

    expect(refused.kind).toBe("refused");
    if (accepted.kind !== "success") return;

    await expect(accepted.response.text()).resolves.toBe("round6-body");
  });

  test("a refused mutation on the same response releases its accepted body", async () => {
    const response = new Response("round6-body", { status: 200 });
    const accepted = classifyResolvedValue(response);

    expect(accepted.kind).toBe("success");
    Object.defineProperty(response, "formData", {
      configurable: true,
      value: undefined,
    });

    const retried = classifyResolvedValue(response);
    expect(retried.kind).toBe("refused");
    if (accepted.kind !== "success") return;

    await expect(accepted.response.text()).rejects.toThrow(/Body is unusable/u);
  });

  test("control: a failed identity read rolls back before a valid retry", () => {
    const response = new Response(null, { status: 599 });
    let throwStatusText = true;
    Object.defineProperty(response, "statusText", {
      configurable: true,
      get() {
        if (throwStatusText) throw new Error("round6 statusText refusal");
        return "retry succeeds";
      },
    });

    const refused = classifyResolvedValue(response);
    expect(refused.kind).toBe("refused");

    throwStatusText = false;
    const retried = classifyResolvedValue(response);
    const error = unknownErrorOf(retried);
    expect(error.statusText).toBe("retry succeeds");
  });
});
