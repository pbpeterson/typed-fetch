import { inspect } from "node:util";
import { describe, expect, test } from "vitest";
import { everyChannel } from "../../fixtures/channels";
import { UnknownHttpError } from "../../src/errors";
import { classifyResolvedValue, type ResponseVerdict } from "../../src/response-verdict";

type ForeignBody = {
  locked: boolean;
  cancelCalls: number;
  cancel(): Promise<void>;
  getReader(): Record<string, never>;
  pipeThrough(): ForeignBody;
  pipeTo(): Promise<void>;
  tee(): [];
};

function makeForeignBody(): ForeignBody {
  const result: ForeignBody = {
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
  return result;
}

function foreignResponse(overrides: Record<PropertyKey, unknown> = {}): Response {
  const response: Record<PropertyKey, unknown> = {
    [Symbol.toStringTag]: "Response",
    body: null,
    bodyUsed: false,
    headers: new Headers(),
    ok: true,
    redirected: false,
    status: 200,
    statusText: "OK",
    type: "basic",
    url: "https://round5-agent3.invalid/resource",
    arrayBuffer: async () => new ArrayBuffer(0),
    blob: async () => new Blob(),
    clone: () => response,
    formData: async () => new FormData(),
    json: async () => ({}),
    text: async () => "",
  };

  for (const key of Reflect.ownKeys(overrides)) {
    const descriptor = Object.getOwnPropertyDescriptor(overrides, key);
    if (!descriptor) continue;
    Object.defineProperty(response, key, { ...descriptor, configurable: true });
  }
  return response as unknown as Response;
}

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

function leakingChannels(error: UnknownHttpError, character: string): string[] {
  return Object.entries(publicChannels(error))
    .filter(([, rendered]) => rendered.includes(character))
    .map(([channel]) => channel);
}

function unknownErrorOf(verdict: ResponseVerdict): UnknownHttpError {
  if (verdict.kind !== "http") throw new Error(`expected HTTP verdict, got ${verdict.kind}`);
  if (!(verdict.error instanceof UnknownHttpError)) {
    throw new Error(`expected UnknownHttpError, got ${verdict.error.constructor.name}`);
  }
  return verdict.error;
}

describe("round 5 / agent 3 — Unicode redaction", () => {
  test("filters the uncovered default-ignorable U+2065 INVISIBLE PLUS from every channel", () => {
    const character = "\u2065";
    const response = new Response(null, { status: 599 });
    Object.defineProperty(response, "statusText", {
      configurable: true,
      value: `before${character}after`,
    });

    const error = new UnknownHttpError(response);

    expect(leakingChannels(error, character)).toEqual([]);
  });

  test("preserves ZWNJ, ZWJ, and variation selectors across public channels", () => {
    const zwnj = "\u200c";
    const zwj = "\u200d";
    const variationSelector = "\ufe0f";
    const response = new Response(null, { status: 599 });
    Object.defineProperty(response, "statusText", {
      configurable: true,
      value: `before${zwnj}mid${zwj}👩${variationSelector}after`,
    });

    const error = new UnknownHttpError(response);

    for (const [channel, rendered] of Object.entries(publicChannels(error))) {
      if (channel === "5 Object.keys") continue;
      expect(rendered, `${channel} lost ZWNJ`).toContain(zwnj);
      expect(rendered, `${channel} lost ZWJ`).toContain(zwj);
      expect(rendered, `${channel} lost variation selector`).toContain(variationSelector);
    }
  });
});

describe("round 5 / agent 3 — identity caches and retries", () => {
  test("control: a stable foreign HTTP response keeps one identity and one body owner", async () => {
    const body = makeForeignBody();
    const response = foreignResponse({
      body,
      ok: false,
      status: 599,
      statusText: "stable",
    });

    const verdict = classifyResolvedValue(response);
    const error = unknownErrorOf(verdict);

    expect(error.status).toBe(599);
    expect(error.statusText).toBe("stable");
    await error.cancel();
    expect(body.cancelCalls).toBe(1);
  });

  test("control: a throwing identity getter refuses and does not return an error", () => {
    const cause = new Error("statusText refused");
    const response = foreignResponse({
      status: 599,
      get statusText(): never {
        throw cause;
      },
    });

    const verdict = classifyResolvedValue(response);

    expect(verdict.kind).toBe("refused");
    if (verdict.kind === "refused") expect(verdict.cause).toBe(cause);
  });

  test("control: status, statusText, url, and headers stay cached through a proxy re-entry", async () => {
    const reads = { status: 0, statusText: 0, url: 0, headers: 0 };
    let nested: ResponseVerdict | undefined;
    let wrapped: Response;
    const response = foreignResponse({
      get status() {
        reads.status += 1;
        if (reads.status === 1) nested = classifyResolvedValue(wrapped);
        return 599;
      },
      get statusText() {
        reads.statusText += 1;
        return "cached";
      },
      get url() {
        reads.url += 1;
        return "https://round5-agent3.invalid/cached";
      },
      get headers() {
        reads.headers += 1;
        return new Headers([["x-round5", String(reads.headers)]]);
      },
      ok: false,
    });
    wrapped = new Proxy(response, {
      get(target, property) {
        return Reflect.get(target, property, target);
      },
    });

    const verdict = classifyResolvedValue(wrapped);
    const error = unknownErrorOf(verdict);

    expect(nested?.kind).toBe("refused");
    expect(reads).toEqual({ status: 1, statusText: 1, url: 1, headers: 1 });
    expect(error.status).toBe(599);
    expect(error.statusText).toBe("cached");
    expect(error.url).toBe("https://round5-agent3.invalid/cached");
    await error.cancel();
  });

  test("a body remembered during a refused presentation is not reused on a retry", async () => {
    const firstBody = makeForeignBody();
    const secondBody = makeForeignBody();
    let bodyReads = 0;
    let formDataReads = 0;
    const response = foreignResponse({
      get body() {
        bodyReads += 1;
        return bodyReads === 1 ? firstBody : secondBody;
      },
      bodyUsed: false,
      ok: false,
      status: 599,
      statusText: "retry",
      get formData() {
        formDataReads += 1;
        return formDataReads === 1 ? undefined : async () => new FormData();
      },
    });

    const refused = classifyResolvedValue(response);
    expect(refused.kind).toBe("refused");
    expect(firstBody.cancelCalls).toBe(1);

    const retried = classifyResolvedValue(response);
    const error = unknownErrorOf(retried);
    await error.cancel();

    // The first response was refused because its public surface was incomplete.
    // The retry's body is the one the accepted HTTP error now owns; the first
    // body was already released by the refused presentation.
    expect({ bodyReads, formDataReads }).toEqual({ bodyReads: 2, formDataReads: 2 });
    expect({ first: firstBody.cancelCalls, second: secondBody.cancelCalls }).toEqual({
      first: 1,
      second: 1,
    });
  });
});

describe("round 5 / agent 3 — success surface and active wrappers", () => {
  test("control: a stable foreign success is returned unchanged", () => {
    const response = foreignResponse({ status: 200, ok: true });

    const verdict = classifyResolvedValue(response);

    expect(verdict.kind).toBe("success");
    if (verdict.kind === "success") expect(verdict.response).toBe(response);
  });

  test("a body that becomes incompatible during validation cannot escape as success", () => {
    const validBody = makeForeignBody();
    let invalid = false;
    const response = foreignResponse({
      get body() {
        return invalid ? null : validBody;
      },
      get status() {
        // `isResponse` has already validated body at this point. The response
        // is still in the same classification call, so the returned success
        // must not carry an incompatible body at the handoff.
        invalid = true;
        return 200;
      },
      ok: true,
      statusText: "OK",
    });

    const verdict = classifyResolvedValue(response);

    if (verdict.kind === "success") {
      expect(verdict.response.body).toBe(validBody);
    } else {
      expect(verdict.kind).toBe("refused");
    }
  });

  test("an outer refusal does not cancel a nested wrapper's accepted body", async () => {
    const outer = new Response("round5-body", { status: 200 });
    let nestedError: UnknownHttpError | undefined;
    let entered = false;

    const wrapper = new Proxy(outer, {
      get(target, property) {
        if (property === "status") return 599;
        if (property === "ok") return false;
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    Object.defineProperty(outer, "status", {
      configurable: true,
      get() {
        if (!entered) {
          entered = true;
          const nested = classifyResolvedValue(wrapper);
          if (nested.kind === "http") nestedError = unknownErrorOf(nested);
        }
        return 200;
      },
    });
    Object.defineProperty(outer, "type", {
      configurable: true,
      get() {
        return "not-a-response-type";
      },
    });

    const outerVerdict = classifyResolvedValue(outer);

    expect(outerVerdict.kind).toBe("refused");
    expect(nestedError).toBeDefined();
    if (!nestedError) return;

    try {
      await expect(nestedError.text()).resolves.toBe("round5-body");
    } finally {
      await nestedError.cancel();
    }
  });
});
