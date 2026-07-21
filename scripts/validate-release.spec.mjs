import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
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
});
