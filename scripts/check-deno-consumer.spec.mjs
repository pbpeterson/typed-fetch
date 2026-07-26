import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, test } from "vitest";
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
