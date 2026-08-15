import { inspect } from "node:util";
import { describe, expect, test } from "vitest";
import { everyChannel } from "../../fixtures/channels";
import { UnknownHttpError } from "../../src/errors";
import { classifyResolvedValue, type ResponseVerdict } from "../../src/response-verdict";

function responseWithStatusText(statusText: string): Response {
  const response = new Response(null, { status: 599 });
  Object.defineProperty(response, "statusText", {
    configurable: true,
    enumerable: false,
    value: statusText,
    writable: true,
  });
  return response;
}

function publicChannels(error: UnknownHttpError): Record<string, string> {
  return {
    statusText: error.statusText,
    message: error.message,
    toJSON: JSON.stringify(error),
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

describe("round 4 / agent 3 — Unicode format controls and legitimate joiners", () => {
  test.each([
    [0x034f, "COMBINING GRAPHEME JOINER"],
    [0x1bca0, "SHORTHAND FORMAT LETTER OVERLAP"],
    [0xe0001, "LANGUAGE TAG"],
  ] as const)("filters %s (%s) from every public error channel", (code, _label) => {
    const character = String.fromCodePoint(code);
    const error = new UnknownHttpError(responseWithStatusText(`before${character}after`));

    expect(channelsContaining(error, character)).toEqual([]);
  });

  test("preserves legitimate joiners and variation selectors in every public channel", () => {
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

type ForeignBody = {
  readonly id: string;
  locked: boolean;
  cancelCalls: number;
  cancel(): Promise<void>;
  getReader(): Record<string, never>;
  pipeThrough(): ForeignBody;
  pipeTo(): Promise<void>;
  tee(): [];
};

function body(id: string): ForeignBody {
  return {
    id,
    locked: false,
    cancelCalls: 0,
    cancel() {
      this.cancelCalls += 1;
      return Promise.resolve();
    },
    getReader: () => ({}),
    pipeThrough() {
      return this;
    },
    pipeTo: () => Promise.resolve(),
    tee: () => [],
  };
}

function foreignResponse(responseBody: ForeignBody): Response {
  const response: Record<PropertyKey, unknown> = {
    [Symbol.toStringTag]: "Response",
    body: responseBody,
    bodyUsed: false,
    headers: new Headers(),
    ok: false,
    redirected: false,
    status: 599,
    statusText: "Foreign response",
    type: "basic",
    url: "https://round4-agent3.invalid/resource",
    arrayBuffer: async () => new ArrayBuffer(0),
    blob: async () => new Blob(),
    clone: () => response,
    formData: async () => new FormData(),
    json: async () => null,
    text: async () => "payload",
  };
  return response as unknown as Response;
}

describe("round 4 / agent 3 — foreign identity and body custody", () => {
  test("reuses the first body validated before a foreign getter changes its answer", async () => {
    const validatedBody = body("validated");
    const laterBody = body("later");
    const response = foreignResponse(validatedBody) as unknown as Record<PropertyKey, unknown>;
    let reads = 0;
    Object.defineProperty(response, "body", {
      configurable: true,
      get() {
        reads += 1;
        return reads === 1 ? validatedBody : laterBody;
      },
    });

    const verdict = classifyResolvedValue(response as unknown as Response);
    expect(verdict.kind).toBe("http");
    if (verdict.kind !== "http") return;

    await verdict.error.cancel();

    expect(reads).toBe(1);
    expect({ validated: validatedBody.cancelCalls, later: laterBody.cancelCalls }).toEqual({
      validated: 1,
      later: 0,
    });
  });

  test("a refusal through a wrapper sharing the outer response body does not cancel the outer body", async () => {
    const outer = new Response("round4-body", { status: 599 });
    let nested: ResponseVerdict | undefined;
    let entered = false;

    const wrapper = new Proxy(outer, {
      get(target, property) {
        if (property === "formData") return undefined;
        if (property === "statusText") return Reflect.get(target, property, target);
        const value = Reflect.get(target, property, target);
        if (typeof value === "function") return value.bind(target);
        return value;
      },
    });

    Object.defineProperty(outer, "status", {
      configurable: true,
      get() {
        if (!entered) {
          entered = true;
          nested = classifyResolvedValue(wrapper);
        }
        return 599;
      },
    });

    const verdict = classifyResolvedValue(outer);

    expect(nested?.kind).toBe("refused");
    expect(verdict.kind).toBe("http");
    if (verdict.kind !== "http") return;

    await expect(verdict.error.text()).resolves.toBe("round4-body");
    await verdict.error.cancel();
  });
});
