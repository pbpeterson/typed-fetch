import { inspect } from "node:util";
import { describe, expect, test } from "vitest";
import { UnknownHttpError } from "../../src/errors";
import { everyChannel } from "../../fixtures/channels";

/**
 * ROUND 2 / AGENT 3 — redaction after the U+206A..U+206F fix.
 *
 * This probe stays on the documented HTTP-error seam: an injected Response can
 * expose a statusText that the platform constructor would reject. The public
 * surfaces are rendered from one error so a leak names its exact channel.
 */

/** Unicode Bidi_Control property, excluding no code point. */
const BIDI_CONTROLS = [
  0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069,
] as const;

function responseWithStatusText(statusText: string, url?: string): Response {
  const response = new Response(null, { status: 599 });
  Object.defineProperty(response, "statusText", {
    value: statusText,
    configurable: true,
    enumerable: false,
    writable: true,
  });
  if (url !== undefined) Object.defineProperty(response, "url", { value: url, configurable: true });
  return response;
}

function publicStrings(error: UnknownHttpError): Record<string, string> {
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

function leakingChannels(error: UnknownHttpError, character: string): string[] {
  return Object.entries(publicStrings(error))
    .filter(([, value]) => value.includes(character))
    .map(([channel]) => channel);
}

describe("round 2 / agent 3: public redaction channels", () => {
  test.each(BIDI_CONTROLS.map((code) => [code] as const))(
    "filters Unicode Bidi_Control U+%s from every public channel",
    (code) => {
      const character = String.fromCodePoint(code);
      const error = new UnknownHttpError(responseWithStatusText(`pre${character}post`));

      expect(leakingChannels(error, character)).toEqual([]);
    },
  );

  test("U+00AD SOFT HYPHEN is not present in any public channel", () => {
    const character = "\u00ad";
    const error = new UnknownHttpError(responseWithStatusText(`pre${character}post`));

    expect(leakingChannels(error, character)).toEqual([]);
  });

  test("removes URL credentials and query/fragment values from automatic channels", () => {
    const credential = "ROUND2_CREDENTIAL";
    const pathValue = "ROUND2_PATH_VALUE";
    const queryValue = "ROUND2_QUERY_VALUE";
    const fragmentValue = "ROUND2_FRAGMENT_VALUE";
    const url =
      `https://alice:${credential}@api.test/v1/${pathValue}` +
      `?token=${queryValue}#${fragmentValue}`;
    const error = new UnknownHttpError(responseWithStatusText("Not Found", url));
    const rendered = publicStrings(error);

    for (const [channel, value] of Object.entries(rendered)) {
      for (const secret of [credential, queryValue, fragmentValue]) {
        expect(value, `${channel} leaked the URL value`).not.toContain(secret);
      }
    }
    // The path is structure, not a value, so keeping it is the documented
    // diagnostic tradeoff. The raw escape hatch keeps every slot by design.
    expect(rendered.message).toContain(pathValue);
    expect(error.toJSON().url).toContain(pathValue);
    expect(error.url).toContain(credential);
    expect(error.url).toContain(queryValue);
    expect(error.url).toContain(fragmentValue);
  });

  test("does not carry raw bidi controls from a retained URL path", () => {
    const control = "\u202e";
    const pathValue = `ROUND2${control}PATH`;
    const queryValue = `ROUND2${control}QUERY`;
    const url = `https://api.test/v1/${pathValue}?token=${queryValue}#ROUND2_FRAGMENT`;
    const error = new UnknownHttpError(responseWithStatusText("Not Found", url));

    for (const [channel, value] of Object.entries(publicStrings(error))) {
      expect(value, `${channel} emitted a raw URL format control`).not.toContain(control);
    }
    expect(error.toJSON().url).toContain("%E2%80%AE");
    expect(error.url).toContain(control);
  });

  test("does not emit header values through automatic channels", () => {
    const value = "ROUND2_HEADER_VALUE";
    const response = new Response(null, {
      status: 599,
      headers: { "x-round2-secret": value },
    });
    Object.defineProperty(response, "statusText", { value: "Not Found", configurable: true });
    const error = new UnknownHttpError(response);
    const rendered = publicStrings(error);

    for (const [channel, text] of Object.entries(rendered)) {
      expect(text, `${channel} leaked the header value`).not.toContain(value);
    }
    expect(error.headers.get("x-round2-secret")).toBe(value);
    expect(JSON.stringify(error)).toContain("x-round2-secret");
  });
});
