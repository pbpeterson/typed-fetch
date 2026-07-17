import { describe, expect, test } from "vitest";
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
