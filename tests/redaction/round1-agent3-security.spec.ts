import { describe, expect, test } from "vitest";
import { inspect } from "node:util";
import { UnknownHttpError } from "../../src/errors";
import { redactUrlInMessage } from "../../src/errors/redact-url";

describe("round 1 / agent 3: security probes", () => {
  test("filters deprecated invisible formatting controls from public HTTP identity", () => {
    const statusText = `pre\u206A${"visible"}\u206Fpost`;
    const response = new Response(null, { status: 599 });
    // ResponseInit statusText is a ByteString in this runtime and rejects the
    // Unicode controls before the library sees them. An injected fetch can
    // still return a Response-shaped object with an own statusText slot; this
    // is the same hostile-response seam covered by the ADRs.
    Object.defineProperty(response, "statusText", {
      value: statusText,
      configurable: true,
      enumerable: false,
      writable: true,
    });
    const error = new UnknownHttpError(response);

    const publicStrings = {
      statusText: error.statusText,
      message: error.message,
      json: JSON.stringify(error),
      toString: error.toString(),
      inspect: inspect(error),
    };
    const leaks = Object.entries(publicStrings).filter(([, value]) =>
      /[\u206A-\u206F]/u.test(value),
    );

    // Expected fix in production: classify 0x206A..0x206F as the same
    // invisible formatting controls already removed by safeReasonPhrase.
    expect(leaks).toEqual([]);
  });

  test("removes parser-recognized credentials from platform URL spellings", () => {
    const schemes = ["http", "https", "ws", "wss", "ftp", "file", "git", "custom+1"];
    const authorityForms = ["//", "///", "\\\\", "\\//", "/\\", "/", ""];
    const controls = ["", " ", "\u0000", "\u0009", "\u000B", "\u000C"];
    const tails = ["/a?next=1#tail", "/@later?next=1#tail", "\\a?next=1#tail"];
    const failures: Array<{ url: string; parsed: string; output: string }> = [];

    for (const scheme of schemes) {
      for (const authority of authorityForms) {
        for (const control of controls) {
          for (const tail of tails) {
            const url = `${control}${scheme}:${authority}svc:hunter2@example.test${tail}`;
            let parsed: URL;
            try {
              parsed = new URL(url);
            } catch {
              continue;
            }
            if (!parsed.password.includes("hunter2")) continue;

            // A platform error commonly serializes the normalized URL and may
            // omit a fragment. This deliberately avoids the exact whole-URL
            // replacement path and exercises userinfo removal itself.
            const platformSpelling = parsed.href.replace(/#tail$/u, "");
            const output = redactUrlInMessage(`platform rejected ${platformSpelling}`, url);
            if (output.includes("hunter2")) {
              failures.push({ url, parsed: parsed.href, output });
            }
          }
        }
      }
    }

    expect(failures).toEqual([]);
  });
});
