import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, afterEach, describe, expect, test } from "vitest";
import { createScratchDir } from "./scratch-dir.mjs";

const MODULE_URL = pathToFileURL(
  join(dirname(fileURLToPath(import.meta.url)), "scratch-dir.mjs"),
).href;

// This spec owns its own temp dirs with plain mkdtemp, deliberately NOT with the
// module under test — a bug in createScratchDir must not also break the harness
// that is supposed to detect it.
const owned = [];
function ownTempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  owned.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of owned.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// In-process behaviour: path shape and dispose().
// ---------------------------------------------------------------------------

describe("createScratchDir — the directory", () => {
  const made = [];
  afterEach(() => {
    for (const scratch of made.splice(0)) scratch.dispose();
  });

  test("creates a real directory under the OS temp dir", () => {
    const scratch = createScratchDir("tf-spec-scratch-");
    made.push(scratch);
    expect(existsSync(scratch.path)).toBe(true);
    expect(scratch.path.startsWith(tmpdir())).toBe(true);
  });

  test("honours the requested prefix", () => {
    const scratch = createScratchDir("tf-spec-prefixed-");
    made.push(scratch);
    expect(scratch.path).toContain("tf-spec-prefixed-");
  });

  test("hands out a distinct directory per call", () => {
    const a = createScratchDir("tf-spec-scratch-");
    const b = createScratchDir("tf-spec-scratch-");
    made.push(a, b);
    expect(a.path).not.toBe(b.path);
    expect(existsSync(a.path)).toBe(true);
    expect(existsSync(b.path)).toBe(true);
  });
});

describe("dispose", () => {
  test("removes the directory and everything in it", () => {
    const scratch = createScratchDir("tf-spec-scratch-");
    writeFileSync(join(scratch.path, "file.txt"), "content");
    scratch.dispose();
    expect(existsSync(scratch.path)).toBe(false);
  });

  test("is idempotent", () => {
    const scratch = createScratchDir("tf-spec-scratch-");
    scratch.dispose();
    expect(() => scratch.dispose()).not.toThrow();
    expect(existsSync(scratch.path)).toBe(false);
  });

  test("is best-effort: an already-removed directory is not an error", () => {
    // A gate must be able to call dispose() in a finally block without the
    // cleanup masking the failure that got it there.
    const scratch = createScratchDir("tf-spec-scratch-");
    rmSync(scratch.path, { recursive: true, force: true });
    expect(() => scratch.dispose()).not.toThrow();
  });

  test("disposing one directory leaves the others alone", () => {
    const keep = createScratchDir("tf-spec-scratch-");
    const drop = createScratchDir("tf-spec-scratch-");
    drop.dispose();
    expect(existsSync(drop.path)).toBe(false);
    expect(existsSync(keep.path)).toBe(true);
    keep.dispose();
  });
});

// ---------------------------------------------------------------------------
// The exit/signal contract. This is ONLY observable in a real process: vitest
// runs in a worker whose `exit` handlers never fire during a test, and sending
// it a signal would kill the run. So each of these spawns a child.
// ---------------------------------------------------------------------------

/**
 * Write a child script that imports the module under test by absolute URL, then
 * run it. Resolves with its exit code, signal and captured stdout.
 *
 * @param {string} body child source; `createScratchDir` is already in scope
 * @param {{ signal?: NodeJS.Signals }} [options] signal to send once the child
 *   has printed its scratch path
 */
function runChild(body, options = {}) {
  const dir = ownTempDir("tf-spec-child-");
  const script = join(dir, "child.mjs");
  writeFileSync(
    script,
    // The baseline is captured BEFORE the import so a test can assert the
    // DELTA. Node itself registers an `exit` listener on some versions, so an
    // absolute count of 0 is a claim about the runtime, not about this module.
    `const __before = {\n` +
      `  exit: process.listenerCount("exit"),\n` +
      `  sigint: process.listenerCount("SIGINT"),\n` +
      `  sigterm: process.listenerCount("SIGTERM"),\n` +
      `};\n` +
      `const __added = () => ({\n` +
      `  exit: process.listenerCount("exit") - __before.exit,\n` +
      `  sigint: process.listenerCount("SIGINT") - __before.sigint,\n` +
      `  sigterm: process.listenerCount("SIGTERM") - __before.sigterm,\n` +
      `});\n` +
      `const { createScratchDir } = await import(${JSON.stringify(MODULE_URL)});\n${body}\n`,
  );

  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [script], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let signalled = false;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      // Signal only once the child has told us which directory it made, so the
      // race is decided: mkdtemp has definitely already happened.
      if (options.signal && !signalled && stdout.includes("\n")) {
        signalled = true;
        child.kill(options.signal);
      }
    });
    child.on("error", reject);
    child.on("close", (code, signal) => resolvePromise({ code, signal, stdout }));
  });
}

const REPORT_AND_WAIT = `
const scratch = createScratchDir("tf-spec-child-scratch-");
console.log(scratch.path);
setInterval(() => {}, 1000);
`;

describe("automatic cleanup", () => {
  test("removes the directory when the process exits normally", async () => {
    const { code, stdout } = await runChild(`
      const scratch = createScratchDir("tf-spec-child-scratch-");
      console.log(scratch.path);
    `);
    const path = stdout.trim();
    expect(code).toBe(0);
    expect(path).toContain("tf-spec-child-scratch-");
    expect(existsSync(path)).toBe(false);
  });

  test("removes the directory on an early process.exit(1) failure path", async () => {
    // This is check-docs.mjs's shape: two failure branches used to exit straight
    // out of the script, past the rmSync that only the happy path reached.
    const { code, stdout } = await runChild(`
      const scratch = createScratchDir("tf-spec-child-scratch-");
      console.log(scratch.path);
      console.error("something went wrong");
      process.exit(1);
    `);
    expect(code).toBe(1);
    expect(existsSync(stdout.trim())).toBe(false);
  });

  test("removes the directory when the script throws", async () => {
    const { code, stdout } = await runChild(`
      const scratch = createScratchDir("tf-spec-child-scratch-");
      console.log(scratch.path);
      throw new Error("boom");
    `);
    expect(code).toBe(1);
    expect(existsSync(stdout.trim())).toBe(false);
  });

  test("removes EVERY outstanding directory, not just the last one", async () => {
    const { stdout } = await runChild(`
      const a = createScratchDir("tf-spec-child-scratch-");
      const b = createScratchDir("tf-spec-child-scratch-");
      console.log(a.path);
      console.log(b.path);
    `);
    const paths = stdout.trim().split("\n");
    expect(paths).toHaveLength(2);
    for (const path of paths) expect(existsSync(path)).toBe(false);
  });

  test("a directory disposed by hand is not disposed twice at exit", async () => {
    const { code, stdout } = await runChild(`
      const scratch = createScratchDir("tf-spec-child-scratch-");
      console.log(scratch.path);
      scratch.dispose();
    `);
    expect(code).toBe(0);
    expect(existsSync(stdout.trim())).toBe(false);
  });
});

describe("signal safety", () => {
  test("SIGINT cleans up and exits 1", async () => {
    // The regression this pins: check-deno-consumer.mjs used a bare
    // `try { … } finally { rmSync }`, which does not run under a signal, so
    // Ctrl-C during `npm install` leaked a directory every single time.
    const { code, stdout } = await runChild(REPORT_AND_WAIT, { signal: "SIGINT" });
    expect(code).toBe(1);
    expect(existsSync(stdout.trim())).toBe(false);
  }, 20000);

  test("SIGTERM cleans up and exits 1", async () => {
    const { code, stdout } = await runChild(REPORT_AND_WAIT, { signal: "SIGTERM" });
    expect(code).toBe(1);
    expect(existsSync(stdout.trim())).toBe(false);
  }, 20000);

  test("the process exits rather than being killed by the signal", async () => {
    // `code: 1, signal: null` is the difference between "handled and cleaned up"
    // and "died where it stood".
    const { code, signal } = await runChild(REPORT_AND_WAIT, { signal: "SIGINT" });
    expect(signal).toBeNull();
    expect(code).toBe(1);
  }, 20000);
});

describe("import hygiene", () => {
  test("importing the module creates no directory and registers no handlers", async () => {
    // If this regresses, every vitest worker that touches a release gate starts
    // leaving temp directories behind and intercepting Ctrl-C.
    const { code, stdout } = await runChild(`
      console.log(JSON.stringify(__added()));
      void createScratchDir;
    `);
    expect(code).toBe(0);
    expect(JSON.parse(stdout.trim())).toEqual({ exit: 0, sigint: 0, sigterm: 0 });
  });

  test("handlers are installed once, however many directories are opened", async () => {
    const { code, stdout } = await runChild(`
      for (let i = 0; i < 5; i += 1) createScratchDir("tf-spec-child-scratch-");
      console.log(JSON.stringify(__added()));
    `);
    expect(code).toBe(0);
    expect(JSON.parse(stdout.trim())).toEqual({ exit: 1, sigint: 1, sigterm: 1 });
  });

  test("five directories opened in one process all get cleaned up", async () => {
    const before = readdirSync(tmpdir()).filter((n) => n.startsWith("tf-spec-child-scratch-"));
    await runChild(`for (let i = 0; i < 5; i += 1) createScratchDir("tf-spec-child-scratch-");`);
    const after = readdirSync(tmpdir()).filter((n) => n.startsWith("tf-spec-child-scratch-"));
    expect(after).toEqual(before);
  });
});
