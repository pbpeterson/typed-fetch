import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const VERIFY_PACK = join(scriptDir, "verify-pack.mjs");

// The exact manifest a clean `pnpm build` produces: 8 entry points + one chunk
// per format. Synthesised rather than copied from dist/ so these tests do not
// depend on the build state of the working tree.
const CLEAN_DIST = [
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

const created = [];

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * A throwaway package whose manifest verify-pack can inspect: the real
 * package.json (so `files` and the exports map are the ones that ship), a
 * synthetic dist, and any extra files a test wants to plant.
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

  for (const relative of [...CLEAN_DIST, ...Object.keys(extraFiles)]) {
    const target = join(dir, relative);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, extraFiles[relative] ?? "// stub\n");
  }
  return dir;
}

function runVerifyPack(dir) {
  try {
    const stdout = execFileSync(process.execPath, [VERIFY_PACK], {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, output: stdout };
  } catch (err) {
    return { code: err.status ?? 1, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

describe("verify-pack — allow-list", () => {
  test("a clean build passes", () => {
    const { code, output } = runVerifyPack(makePackage());
    expect(output).toContain("manifest OK");
    expect(code).toBe(0);
  });

  // The five leaks below all packed CLEANLY under the previous denylist, which
  // only listed paths (src/, scripts/, __snapshots__/, *.spec.ts, tsconfig*)
  // that `files: ["dist"]` already excluded — and nothing inside dist/.
  test.each([
    {
      leak: "dist/.env",
      contents: "NPM_TOKEN=super-secret\n",
      label: "dotfile / secret",
    },
    {
      leak: "dist/index.mjs.map",
      contents: JSON.stringify({ version: 3, sources: ["../src/index.ts"] }),
      label: "sourcemap",
    },
    {
      leak: "dist/errors/index.mjs.map",
      // sourcesContent re-ships the full source of every file it lists — the
      // exact leak the denylist existed to prevent.
      contents: JSON.stringify({
        version: 3,
        sources: ["../../src/errors/base-http-error.ts"],
        sourcesContent: ["export abstract class BaseHttpError extends Error {}"],
      }),
      label: "sourcemap",
    },
    {
      leak: "dist/src/index.ts",
      contents: "export const secret = 1;\n",
      label: "source directory inside dist",
    },
    {
      leak: "dist/helper.ts",
      contents: "export const helper = 1;\n",
      label: "TypeScript source (not a declaration)",
    },
  ])("rejects $leak ($label)", ({ leak, contents, label }) => {
    const { code, output } = runVerifyPack(makePackage({ [leak]: contents }));

    expect(code).not.toBe(0);
    expect(output).toContain(leak);
    expect(output).toContain(label);
    expect(output).not.toContain("manifest OK");
  });

  test("rejects an unexpected chunk name", () => {
    const { code, output } = runVerifyPack(makePackage({ "dist/vendor-bundle.mjs": "//\n" }));

    expect(code).not.toBe(0);
    expect(output).toContain("dist/vendor-bundle.mjs");
    expect(output).toContain("not on the allow-list");
  });

  test("accepts a differently hashed build chunk", () => {
    // The chunk hash changes every build, so the pattern must stay permissive
    // about the hash while staying exact about everything else.
    const dir = mkdtempSync(join(tmpdir(), "tf-verify-pack-"));
    created.push(dir);
    rmSync(dir, { recursive: true, force: true });
    const renamed = makePackage();
    rmSync(join(renamed, "dist/chunk-Q3VCRU7W.mjs"));
    writeFileSync(join(renamed, "dist/chunk-AAAA1111.mjs"), "// stub\n");

    const { code, output } = runVerifyPack(renamed);
    expect(output).toContain("manifest OK");
    expect(code).toBe(0);
  });

  test("rejects a build with a missing entry point", () => {
    const dir = makePackage();
    rmSync(join(dir, "dist/errors/index.d.mts"));

    const { code, output } = runVerifyPack(dir);
    expect(code).not.toBe(0);
    expect(output).toContain("dist/errors/index.d.mts");
  });

  test("rejects more files than the artifact should ever contain", () => {
    // Extra files that are individually allow-listed must still trip the
    // ceiling, so a future build change is looked at rather than absorbed.
    const { code, output } = runVerifyPack(
      makePackage({ "dist/chunk-BBBB2222.mjs": "//\n", "dist/chunk-CCCC3333.js": "//\n" }),
    );

    expect(code).not.toBe(0);
    expect(output).toMatch(/expected at most 13/);
  });
});
