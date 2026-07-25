import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import { readPackManifest, verifyPackManifest } from "./verify-pack.mjs";

// The exact manifest a clean `pnpm build` + `npm pack` produces: package.json +
// LICENSE + README + 8 entry points + one chunk per format = 13.
const CLEAN = [
  "package.json",
  "LICENSE",
  "README.md",
  "dist/index.js",
  "dist/index.mjs",
  "dist/index.d.ts",
  "dist/index.d.mts",
  "dist/errors/index.js",
  "dist/errors/index.mjs",
  "dist/errors/index.d.ts",
  "dist/errors/index.d.mts",
  "dist/chunk-Q3VCRU7W.mjs",
  "dist/chunk-VT2QTF3N.js",
];

const without = (f) => CLEAN.filter((p) => p !== f);
const plus = (...f) => [...CLEAN, ...f];

describe("verifyPackManifest — a clean build", () => {
  test("accepts the exact manifest tsup + npm pack produce", () => {
    expect(verifyPackManifest(CLEAN)).toEqual({ fileCount: 13 });
  });

  test("accepts differently hashed build chunks", () => {
    // The chunk hash changes every build, so the pattern must stay permissive
    // about the hash while staying exact about everything else.
    const rehashed = without("dist/chunk-Q3VCRU7W.mjs").concat("dist/chunk-AAAA1111.mjs");
    expect(verifyPackManifest(rehashed)).toEqual({ fileCount: 13 });
  });

  test("defaults the file count to the manifest length", () => {
    expect(verifyPackManifest(CLEAN).fileCount).toBe(CLEAN.length);
  });

  test("prefers npm's own entryCount over the manifest length", () => {
    // npm reports entryCount separately; the two can disagree, and the count
    // guard must trust npm. Unreachable through an on-disk fixture.
    expect(() => verifyPackManifest(CLEAN, 14)).toThrow("expected at most 13");
  });
});

describe("verifyPackManifest — required files", () => {
  test.each([
    "dist/index.js",
    "dist/index.mjs",
    "dist/index.d.ts",
    "dist/index.d.mts",
    "dist/errors/index.js",
    "dist/errors/index.mjs",
    "dist/errors/index.d.ts",
    "dist/errors/index.d.mts",
  ])("rejects a build missing %s", (entry) => {
    expect(() => verifyPackManifest(without(entry))).toThrow(
      `tarball is missing required compiled file(s):\n    - ${entry}`,
    );
  });

  test.each(["LICENSE", "README.md"])("rejects a tarball missing %s", (meta) => {
    expect(() => verifyPackManifest(without(meta))).toThrow(
      `tarball is missing required metadata file(s):\n    - ${meta}`,
    );
  });

  test("lists every missing entry point in one message", () => {
    const broken = without("dist/index.js").filter((p) => p !== "dist/index.mjs");
    expect(() => verifyPackManifest(broken)).toThrow("- dist/index.js\n    - dist/index.mjs");
  });

  test("reports a missing entry point before a missing LICENSE", () => {
    // Order is the contract: a partial build must say what is missing from the
    // build, not complain about metadata.
    const broken = without("dist/index.js").filter((p) => p !== "LICENSE");
    expect(() => verifyPackManifest(broken)).toThrow("missing required compiled file(s)");
  });
});

describe("verifyPackManifest — leak rules", () => {
  // Every one of these packed CLEANLY under the previous denylist, which only
  // listed paths that `files: ["dist"]` already excluded and nothing inside
  // dist/. Naming the rule in the message is what makes the failure explain
  // itself instead of just saying "not allowed".
  test.each([
    ["dist/.env", "dotfile / secret"],
    ["dist/index.mjs.map", "sourcemap"],
    ["dist/errors/index.mjs.map", "sourcemap"],
    ["dist/src/index.ts", "source directory inside dist"],
    ["dist/helper.ts", "TypeScript source (not a declaration)"],
    ["dist/helper.spec.js", "test file"],
    ["dist/tsconfig.build.json", "tsconfig"],
    ["dist/__snapshots__/api.snap", "snapshot directory"],
  ])("rejects %s and names it a %s", (leak, label) => {
    expect(() => verifyPackManifest(plus(leak))).toThrow(`${leak}  (${label})`);
  });

  test("names a leak by its FIRST matching rule", () => {
    // dist/src/.env matches both the dotfile rule and the dist/src/ rule; the
    // dotfile label wins because it is the more alarming diagnosis.
    expect(() => verifyPackManifest(plus("dist/src/.env"))).toThrow("(dotfile / secret)");
  });

  test("rejects an unexpected chunk name", () => {
    expect(() => verifyPackManifest(plus("dist/vendor-bundle.mjs"))).toThrow(
      "dist/vendor-bundle.mjs  (not on the allow-list)",
    );
  });

  test.each(["dist/chunk-.mjs", "dist/chunk-Q3VCRU7W.cjs", "dist/chunk-Q3.VC.mjs"])(
    "does not mistake %s for a build chunk",
    (near) => {
      expect(() => verifyPackManifest(plus(near))).toThrow(near);
    },
  );

  test("reports every leak in one message", () => {
    const leaky = plus("dist/.env", "dist/index.mjs.map");
    expect(() => verifyPackManifest(leaky)).toThrow("dist/.env");
    expect(() => verifyPackManifest(leaky)).toThrow("dist/index.mjs.map");
  });

  test("declares a leak before counting files", () => {
    expect(() => verifyPackManifest(plus("dist/.env"))).toThrow("dotfile / secret");
  });
});

describe("verifyPackManifest — file count", () => {
  test("rejects a partial build below the floor", () => {
    // Unreachable through an on-disk fixture: every file you could remove to
    // get under 13 is itself required, so the earlier guards fire first. The
    // floor guard is dead code as far as any shell-out test can tell.
    expect(() => verifyPackManifest(CLEAN, 12)).toThrow(
      "tarball has 12 file(s), expected at least 13. Build output looks incomplete.",
    );
  });

  test("rejects extra allow-listed files above the ceiling", () => {
    // Extra files that are individually allow-listed must still trip the
    // ceiling, so a future build change is looked at rather than absorbed.
    const extra = plus("dist/chunk-BBBB2222.mjs", "dist/chunk-CCCC3333.js");
    expect(() => verifyPackManifest(extra)).toThrow("expected at most 13");
    expect(() => verifyPackManifest(extra)).toThrow("dist/chunk-BBBB2222.mjs");
  });
});

describe("readPackManifest", () => {
  test("unwraps npm's one-element array", () => {
    expect(readPackManifest([{ files: [{ path: "LICENSE" }], entryCount: 1 }])).toEqual({
      files: ["LICENSE"],
      fileCount: 1,
    });
  });

  test("accepts a bare object", () => {
    expect(readPackManifest({ files: [{ path: "LICENSE" }], entryCount: 1 }).files).toEqual([
      "LICENSE",
    ]);
  });

  test("falls back to the file list length when entryCount is absent", () => {
    expect(readPackManifest({ files: [{ path: "a" }, { path: "b" }] }).fileCount).toBe(2);
  });

  test.each([[null], [undefined], [[]], [{}], [{ files: "dist" }], [42]])(
    "rejects malformed npm output %o",
    (parsed) => {
      // Reaching this through the script would mean shimming a fake npm onto
      // PATH.
      expect(() => readPackManifest(parsed)).toThrow("had no file list to inspect");
    },
  );
});

// ---------------------------------------------------------------------------
// ONE end-to-end test pair. Its job is NOT to re-cover the policy — the unit
// tests above do that. Its job is to prove the WIRING: that `npm pack` still
// emits the shape readPackManifest expects, and that main() still runs at all
// (a broken isMain guard would make the gate exit 0 silently).
// ---------------------------------------------------------------------------
const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const VERIFY_PACK = join(scriptDir, "verify-pack.mjs");
const created = [];

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * A throwaway package whose manifest verify-pack can inspect: the real
 * package.json (so `files` and the exports map are the ones that ship), a
 * synthetic dist, and any extra files a test wants to plant. Synthesised rather
 * than copied from dist/ so these tests do not depend on the build state of the
 * working tree.
 */
function makePackage(extraFiles = {}) {
  const dir = mkdtempSync(join(tmpdir(), "tf-verify-pack-"));
  created.push(dir);
  const pkg = JSON.parse(
    execFileSync(process.execPath, ["-p", "JSON.stringify(require('./package.json'))"], {
      cwd: repoRoot,
      encoding: "utf8",
    }),
  );
  // Lifecycle scripts would try to build; the manifest is all that matters here.
  delete pkg.scripts;
  delete pkg.devDependencies;
  writeFileSync(join(dir, "package.json"), JSON.stringify(pkg, null, 2));
  writeFileSync(join(dir, "LICENSE"), "MIT\n");
  writeFileSync(join(dir, "README.md"), "# stub\n");
  for (const rel of [...CLEAN.slice(3), ...Object.keys(extraFiles)]) {
    const target = join(dir, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, extraFiles[rel] ?? "// stub\n");
  }
  return dir;
}

function runVerifyPack(dir) {
  try {
    return {
      code: 0,
      output: execFileSync(process.execPath, [VERIFY_PACK], {
        cwd: dir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    };
  } catch (err) {
    return { code: err.status ?? 1, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

describe("verify-pack — end to end", () => {
  test("the script runs, packs the real `files` allow-list, and exits 0", () => {
    const { code, output } = runVerifyPack(makePackage());
    expect(output).toContain("manifest OK");
    expect(code).toBe(0);
  });

  test("a leak exits 1 with the refusing-to-publish epilogue", () => {
    const { code, output } = runVerifyPack(makePackage({ "dist/.env": "NPM_TOKEN=x\n" }));
    expect(code).toBe(1);
    expect(output).toContain("dist/.env");
    expect(output).toContain("Refusing to publish");
    expect(output).not.toContain("manifest OK");
  });
});
