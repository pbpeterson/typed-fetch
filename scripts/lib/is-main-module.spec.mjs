import { execFileSync } from "node:child_process";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, test } from "vitest";
import { isMainModule } from "./is-main-module.mjs";
import { createScratchDir } from "./scratch-dir.mjs";

// symlinkSync needs a privilege on Windows that a contributor's shell may not
// have, and CI runs ubuntu-latest. Assert the symlink behavior where symlinks
// cost nothing; the rest of the file runs everywhere.
const posixOnly = describe.skipIf(process.platform === "win32");

const scratch = createScratchDir("tf-is-main-");
afterAll(() => scratch.dispose());

// One real directory holding two real files, each reachable three ways: by its
// real path, through a symlinked directory, and through a symlinked file. Every
// path below names the same inode.
const realDir = join(scratch.path, "real");
mkdirSync(realDir, { recursive: true });
const gate = join(realDir, "gate.mjs");
const probe = join(realDir, "probe.mjs");
writeFileSync(gate, "export const marker = 1;\n");
// The probe reports the guard's verdict for its OWN module, so a child process
// can be started through each path shape.
writeFileSync(
  probe,
  `import { isMainModule } from ${JSON.stringify(new URL("./is-main-module.mjs", import.meta.url).href)};\n` +
    "console.log(isMainModule(import.meta.url));\n",
);
const linkedDir = join(scratch.path, "linked-dir");
const linkedGate = join(scratch.path, "linked-gate.mjs");
const linkedProbe = join(scratch.path, "linked-probe.mjs");
symlinkSync(realDir, linkedDir);
symlinkSync(gate, linkedGate);
symlinkSync(probe, linkedProbe);

// What Node's ESM loader hands a module: the URL of the REAL file, because the
// loader resolves symlinks. process.argv[1] keeps whatever the caller typed.
const gateUrl = pathToFileURL(gate).href;

const node = (...args) => execFileSync(process.execPath, args, { encoding: "utf8" }).trim();

posixOnly("isMainModule — the entry reached through a symlink", () => {
  test.each([
    ["its real path", () => gate],
    ["a symlinked directory", () => join(linkedDir, "gate.mjs")],
    ["a symlinked file", () => linkedGate],
  ])("is true when the entry is %s", (_name, entry) => {
    expect(isMainModule(gateUrl, entry())).toBe(true);
  });
});

describe("isMainModule — anything that is not the entry", () => {
  test("is false for a different file", () => {
    expect(isMainModule(gateUrl, probe)).toBe(false);
  });

  test("is false when there is no entry at all", () => {
    // `node --input-type=module -e`, piped stdin, and the REPL all leave
    // process.argv[1] undefined. A vitest worker sets it to the worker entry.
    expect(isMainModule(gateUrl, undefined)).toBe(false);
    expect(isMainModule(gateUrl, "")).toBe(false);
  });
});

describe("isMainModule — never throws", () => {
  // A guard that throws replaces a silent gate with a crashed one, and neither
  // publishes a correct package. realpathSync coerces its argument to a string
  // instead of validating it, so a missing path arrives as ENOENT, not as a
  // TypeError; fileURLToPath throws for a scheme that is not `file:`.
  test.each([
    ["an entry that is not on disk", join(scratch.path, "gone.mjs"), gateUrl],
    ["a module URL that is not on disk", gate, pathToFileURL(join(scratch.path, "gone.mjs")).href],
    ["a module URL with a non-file scheme", gate, "data:text/javascript,0"],
  ])("returns false for %s", (_name, entry, url) => {
    expect(() => isMainModule(url, entry)).not.toThrow();
    expect(isMainModule(url, entry)).toBe(false);
  });
});

posixOnly("isMainModule — in a real process", () => {
  // The tests above inject `entry`. These prove the default read of
  // process.argv[1] agrees with them once Node starts the file for real.
  test.each([
    ["started from its real path", () => node(probe)],
    ["started through a symlinked directory", () => node(join(linkedDir, "probe.mjs"))],
    ["started through a symlinked file", () => node(linkedProbe)],
  ])("reports true when %s", (_name, invoke) => {
    expect(invoke()).toBe("true");
  });

  test("reports false when the module is only imported", () => {
    const url = JSON.stringify(pathToFileURL(probe).href);
    expect(node("--input-type=module", "-e", `await import(${url});`)).toBe("false");
  });
});
