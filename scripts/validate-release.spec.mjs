import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, symlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, test } from "vitest";
import { createScratchDir } from "./lib/scratch-dir.mjs";
import { validateRelease } from "./validate-release.mjs";

const release = {
  tag: "v1.0.0",
  refType: "tag",
  packageName: "@pbpeterson/typed-fetch",
  version: "1.0.0",
  repositoryUrl: "git+https://github.com/pbpeterson/typed-fetch.git",
  publishAccess: "public",
  provenance: true,
  changelog:
    "# Changelog\n\n## [Unreleased]\n\n## [1.0.0] - 2026-07-17\n\n### Added\n\n- First release.\n",
  headCommit: "a".repeat(40),
  tagCommit: "a".repeat(40),
  mainCommit: "a".repeat(40),
};

describe("validateRelease", () => {
  test("accepts an exact stable tag on the current main commit", () => {
    expect(validateRelease(release)).toEqual({ distTag: "latest" });
  });

  test("routes a valid prerelease to the next dist-tag", () => {
    expect(
      validateRelease({
        ...release,
        tag: "v1.0.0-rc.1",
        version: "1.0.0-rc.1",
        changelog: release.changelog.replaceAll("1.0.0", "1.0.0-rc.1"),
      }),
    ).toEqual({ distTag: "next" });
  });

  test("rejects an impossible changelog calendar date", () => {
    expect(() =>
      validateRelease({
        ...release,
        changelog: release.changelog.replace("2026-07-17", "2026-02-30"),
      }),
    ).toThrow("valid calendar date");
  });

  test.each([
    ["numeric-prefix prerelease", "1.0.0-1a", "next"],
    ["hyphenated build metadata", "1.0.0+build-1", "latest"],
  ])("accepts valid %s SemVer", (_name, version, distTag) => {
    expect(
      validateRelease({
        ...release,
        tag: `v${version}`,
        version,
        changelog: release.changelog.replaceAll("1.0.0", version),
      }),
    ).toEqual({ distTag });
  });

  test.each([
    ["tag ref", { refType: "branch" }, "must run from a tag ref"],
    ["strict SemVer", { tag: "v01.0.0", version: "01.0.0" }, "valid SemVer"],
    ["exact version", { tag: "v1.0.1" }, "must exactly match"],
    ["package name", { packageName: "typed-fetch" }, "package name must remain"],
    ["repository", { repositoryUrl: "https://example.test/repo" }, "repository URL must remain"],
    ["public access", { publishAccess: "restricted" }, "publishConfig.access must be public"],
    ["provenance", { provenance: false }, "publishConfig.provenance must be true"],
    ["tag commit", { tagCommit: "b".repeat(40) }, "does not point at HEAD"],
    ["main tip", { mainCommit: "b".repeat(40) }, "current origin/main tip"],
    [
      "dated changelog",
      { changelog: release.changelog.replace("## [1.0.0] - 2026-07-17", "## [1.0.0]") },
      "dated CHANGELOG",
    ],
    [
      "empty unreleased section",
      {
        changelog: release.changelog.replace(
          "## [Unreleased]\n",
          "## [Unreleased]\n\n- Pending.\n",
        ),
      },
      "must be empty before publishing",
    ],
  ])("rejects a release with an invalid %s", (_name, change, expectedMessage) => {
    expect(() => validateRelease({ ...release, ...change })).toThrow(expectedMessage);
  });
});

describe("release workflow policy", () => {
  test("publish depends on the reusable full CI workflow", () => {
    const ci = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
    const releaseWorkflow = readFileSync(
      new URL("../.github/workflows/release.yml", import.meta.url),
      "utf8",
    );

    expect(ci).toMatch(/^on:\n\s+workflow_call:/m);
    expect(ci).toContain("pnpm check-deno-consumer");
    expect(releaseWorkflow).toMatch(/checks:\n(?:.|\n)*?uses: \.\/\.github\/workflows\/ci\.yml/);
    expect(releaseWorkflow).toMatch(/publish:\n\s+needs: checks/);
    expect(releaseWorkflow.match(/id-token: write/g)).toHaveLength(1);
  });

  test("the publish step refuses an empty dist_tag", () => {
    const releaseWorkflow = readFileSync(
      new URL("../.github/workflows/release.yml", import.meta.url),
      "utf8",
    );

    // The dist-tag reaches npm through the environment. A raw `${{ }}` on the
    // command line vanishes when validate-release never wrote the output, and
    // `npm publish ... --tag` with nothing after it is a different command.
    expect(releaseWorkflow).toContain("DIST_TAG: ${{ steps.release.outputs.dist_tag }}");
    expect(releaseWorkflow).toMatch(/npm publish [^\n]*--tag "\$DIST_TAG"/);
    expect(releaseWorkflow).not.toMatch(/npm publish [^\n]*\$\{\{/);

    // An empty value stops the job before npm sees it.
    expect(releaseWorkflow).toMatch(/\[ -n "\$DIST_TAG" \]/);
  });
});

// ---------------------------------------------------------------------------
// The gate must RUN. validateRelease above is pure and fully covered, but a
// broken isMain guard makes `node scripts/validate-release.mjs` define
// everything, print nothing, and exit 0 — and this gate is the only check
// between a git tag and `npm publish`. The lexical guard this replaced did
// exactly that through any symlink in the invocation path.
// ---------------------------------------------------------------------------
const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const VALIDATE_RELEASE = join(scriptDir, "validate-release.mjs");

const links = createScratchDir("tf-validate-release-link-");
afterAll(() => links.dispose());

/**
 * Run the gate against a release that cannot validate, and report what came out.
 * The environment is scrubbed: CI sets GITHUB_REF_TYPE and GITHUB_REF_NAME, and
 * on a tag build those describe a REAL release. GITHUB_OUTPUT is cleared so the
 * run cannot append to a job output file.
 * @param {string} entry
 */
function runValidateRelease(entry) {
  const env = {
    ...process.env,
    GITHUB_REF_TYPE: "branch",
    GITHUB_REF_NAME: "v0.0.0-not-a-tag-in-this-repository",
    GITHUB_OUTPUT: "",
  };
  try {
    execFileSync(process.execPath, [entry], {
      cwd: repoRoot,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, output: "" };
  } catch (err) {
    return { code: err.status ?? 1, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

describe.skipIf(process.platform === "win32")("validate-release — the gate runs", () => {
  test.each([
    ["its real path", () => VALIDATE_RELEASE],
    [
      "a symlinked checkout directory",
      () => {
        const linked = join(links.path, "checkout");
        if (!existsSync(linked)) symlinkSync(repoRoot, linked);
        return join(linked, "scripts", "validate-release.mjs");
      },
    ],
    [
      "a symlinked script file",
      () => {
        const linked = join(links.path, "validate-release.mjs");
        if (!existsSync(linked)) symlinkSync(VALIDATE_RELEASE, linked);
        return linked;
      },
    ],
  ])("refuses the release and says so when started through %s", (_name, entry) => {
    const { code, output } = runValidateRelease(entry());
    // Silence plus exit 0 is the failure this test exists to catch.
    expect(output).toContain("✖ validate-release:");
    expect(code).toBe(1);
  });
});

const readRepoFile = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// Matches ">=20", ">=20.3" and ">=20.3.0". A range this file cannot parse is
// a failure, not a skip: an unparsable floor is an unverifiable floor.
const parseFloor = (range) => /^>=\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(range);

describe("engines floor policy", () => {
  // `engines.node` is the package's only machine-readable statement about the
  // runtimes it supports, and nothing verified it. Dropping `20` from the CI
  // matrix broke no test, which would have turned the floor into a claim no job
  // exercises. These two tests make the three places that must agree — the
  // manifest, the CI matrix, and the smoke script — fail loudly when they drift.
  test("the CI test matrix runs the Node major that engines.node declares", () => {
    const engines = JSON.parse(readRepoFile("package.json")).engines.node;
    const ci = readRepoFile(".github/workflows/ci.yml");

    const floor = parseFloor(engines);
    expect(floor, `engines.node must be a ">=X[.Y[.Z]]" range, got "${engines}"`).not.toBe(null);

    // Anchor on `matrix:` so this reads the job matrix and not one of the
    // scalar `node-version:` values elsewhere in the workflow.
    const matrix = /matrix:\s*\n\s*node-version:\s*\[([^\]]+)\]/.exec(ci);
    expect(matrix, "ci.yml must declare a node-version matrix array").not.toBe(null);

    // Compare majors only. The matrix may gain entries, reorder them, quote
    // them, or pin a minor; none of that should fail this test.
    const majors = matrix[1]
      .split(",")
      .map((entry) => Number.parseInt(entry.trim().replace(/^["']|["']$/g, ""), 10));

    expect(majors).toContain(Number(floor[1]));
  });

  test("the node-min smoke pins the exact version engines.node declares", () => {
    const engines = JSON.parse(readRepoFile("package.json")).engines.node;
    const ci = readRepoFile(".github/workflows/ci.yml");
    const smoke = readRepoFile("scripts/smoke/node-min.mjs");

    const floor = parseFloor(engines);
    expect(floor, `engines.node must be a ">=X[.Y[.Z]]" range, got "${engines}"`).not.toBe(null);
    const exact = `${floor[1]}.${floor[2] ?? "0"}.${floor[3] ?? "0"}`;

    // The matrix job's `20` resolves to the latest 20.x, so only this pinned
    // job ever executes the floor. If the pin drifts from engines.node, the
    // floor is again untested.
    expect(ci).toMatch(new RegExp(`node-version:\\s*["']?${exact}["']?\\s*$`, "m"));

    // MINIMUM must carry all three components. A two-component floor is what
    // let the smoke report Node 20.0.5 as the floor.
    const minimum = /const MINIMUM = \[\s*(\d+),\s*(\d+),\s*(\d+)\s*\]/.exec(smoke);
    expect(minimum, "node-min.mjs must declare a three-component MINIMUM").not.toBe(null);
    expect(minimum.slice(1, 4).join(".")).toBe(exact);
  });
});
