import { execFileSync } from "node:child_process";
import { existsSync, symlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, test } from "vitest";
import { createScratchDir } from "./lib/scratch-dir.mjs";
import { DENO_CONSUMER_SOURCE, judgeDenoVersion } from "./check-deno-consumer.mjs";

describe("judgeDenoVersion", () => {
  test("accepts Deno 2 and returns its major version", () => {
    expect(judgeDenoVersion("deno 2.4.1\nv8 13.7\ntypescript 5.8.3\n")).toEqual({ major: 2 });
  });

  test("accepts a later major", () => {
    expect(judgeDenoVersion("deno 3.0.0")).toEqual({ major: 3 });
  });

  test("rejects Deno 1 with the actionable requirement", () => {
    expect(() => judgeDenoVersion("deno 1.46.3")).toThrow(/requires Deno 2 or later/);
  });

  test("rejects output that does not identify Deno", () => {
    expect(() => judgeDenoVersion("not deno")).toThrow(/could not read the Deno major version/);
  });
});

test("the consumer source exercises typed JSON and the public guard", () => {
  expect(DENO_CONSUMER_SOURCE).toContain('from "@pbpeterson/typed-fetch"');
  expect(DENO_CONSUMER_SOURCE).toContain("Promise<User>");
  expect(DENO_CONSUMER_SOURCE).toContain("isKnownHttpError");
});

test("the consumer source resolves the ./errors subpath as well as the main entry", () => {
  expect(DENO_CONSUMER_SOURCE).toContain('from "@pbpeterson/typed-fetch/errors"');
  expect(DENO_CONSUMER_SOURCE).toContain("ClientErrors");
});

test("importing the gate performs no pack, install, typecheck, or output", () => {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const gate = pathToFileURL(join(scriptDir, "check-deno-consumer.mjs")).href;
  const output = execFileSync(
    process.execPath,
    ["--input-type=module", "--eval", `await import(${JSON.stringify(gate)});`],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  expect(output).toBe("");
});

// ---------------------------------------------------------------------------
// The gate must RUN. The test above is the negative half — "importing the gate
// does nothing" — and a guard that NEVER fires satisfies it just as well as a
// correct one. Four of this repository's six gates carry the positive half too;
// this gate and `check-consumer` did not, which is the same asymmetry the
// silent-no-op fix (CHANGELOG.md:286-296) was supposed to close everywhere.
//
// Reaching main() is proved WITHOUT a Deno toolchain and without the expensive
// pack/install: main()'s first act is `deno --version`, so a PATH that cannot
// resolve `deno` makes it throw immediately, and the gate's own catch reports
// `deno consumer: FAILED — …` on stderr and exits 1. A guard that never fires
// prints nothing and exits 0 — which is exactly what CI reads as a pass.
// ---------------------------------------------------------------------------
const denoGateScriptDir = dirname(fileURLToPath(import.meta.url));
const denoGateRepoRoot = resolve(denoGateScriptDir, "..");
const CHECK_DENO_CONSUMER = join(denoGateScriptDir, "check-deno-consumer.mjs");

const denoGateLinks = createScratchDir("tf-check-deno-consumer-link-");
afterAll(() => denoGateLinks.dispose());

/**
 * Run the gate with a PATH that resolves nothing, and report what it said.
 *
 * @param {string} entry
 * @returns {{ code: number, output: string }}
 */
function runWithoutDeno(entry) {
  const emptyBin = join(denoGateLinks.path, "empty-bin");
  try {
    return {
      code: 0,
      output: execFileSync(process.execPath, [entry], {
        cwd: denoGateRepoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, PATH: emptyBin, Path: emptyBin },
      }),
    };
  } catch (err) {
    return { code: err.status ?? 1, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

describe.skipIf(process.platform === "win32")("check-deno-consumer — the gate runs", () => {
  test.each([
    ["its real path", () => CHECK_DENO_CONSUMER],
    [
      "a symlinked checkout directory",
      () => {
        const linked = join(denoGateLinks.path, "checkout");
        if (!existsSync(linked)) symlinkSync(denoGateRepoRoot, linked);
        return join(linked, "scripts", "check-deno-consumer.mjs");
      },
    ],
    [
      "a symlinked script file",
      () => {
        const linked = join(denoGateLinks.path, "check-deno-consumer.mjs");
        if (!existsSync(linked)) symlinkSync(CHECK_DENO_CONSUMER, linked);
        return linked;
      },
    ],
  ])(
    "reaches main() when started through %s",
    (_name, entry) => {
      const { code, output } = runWithoutDeno(entry());

      expect(output).toMatch(/^deno consumer: /m);
      expect(code).toBe(1);
    },
    30000,
  );
});
