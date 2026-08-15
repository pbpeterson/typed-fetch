import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, test, vi } from "vitest";

// ---------------------------------------------------------------------------
// ROUND 16, COVERAGE SUB-LANE C3 — the release gates, driven rather than read.
//
// Four modules stand between a git tag and `npm publish`, and section 8.2 of
// the round-16 protocol records what the suite did not do with them: it tested
// what each gate DECIDES and never what each gate DOES. This file adds the
// decisions no test had driven, and it adds them as BEHAVIOUR — every test
// below states an outcome a release engineer would recognise, and reaching an
// uncovered line is a side effect of stating it.
//
// WHAT IS STILL UNREACHABLE, and why it is not attempted here. Each gate ends
// with `if (isMainModule(import.meta.url)) main();` and `main` is not exported,
// so no spec can reach it, its printer, or its adapters. That is the section
// 8.5 option (b) edit, it is a SOURCE edit, and a hunter never makes one. The
// COVERAGE row of this lane's return names the symbols and the `io` members.
//
// WHY THE `npm` SHIM IS SET UP BEFORE THE IMPORTS. `scripts/lib/npm-pack.mjs`
// snapshots `NPM_ENV` from `process.env` AT IMPORT TIME, and every nested npm
// call runs with that snapshot — so a PATH written after a static import would
// never be seen by the child. Static imports are evaluated before any module
// body, so the four gate modules are imported dynamically, after the shim
// directory exists and PATH names it. `node:` builtins read no PATH and stay
// static.
// ---------------------------------------------------------------------------

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");

/** Every directory this file made, removed once at the end. */
const owned = [];
function scratch(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  owned.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of owned.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * A directory holding an `npm` that answers with npm's OLDER output shape: a
 * bare object rather than the one-element array npm emits today.
 *
 * It writes a real (empty) `.tgz` into `--pack-destination`, because
 * `packTarball` deliberately ignores what npm SAYS it wrote and reads the
 * directory instead. Both halves have to be present or the test would be
 * grading the shim.
 */
function makeNpmShim() {
  const bin = scratch("tf-r16-npmbin-");
  const shim = join(bin, "npm");
  writeFileSync(
    shim,
    `#!/bin/sh
dest=""
next=0
for arg in "$@"; do
  if [ "$next" = "1" ]; then dest="$arg"; next=0; fi
  if [ "$arg" = "--pack-destination" ]; then next=1; fi
done
: > "$dest/tf-r16-shim-0.0.0.tgz"
printf '{"filename":"tf-r16-shim-0.0.0.tgz"}'
`,
  );
  chmodSync(shim, 0o755);
  return bin;
}

process.env.PATH = `${makeNpmShim()}${delimiter}${process.env.PATH}`;

const {
  validateRelease,
  main: validateReleaseMain,
  defaultIo: validateReleaseDefaultIo,
} = await import("./validate-release.mjs");
const {
  readPackManifest,
  readTarballManifest,
  verifyPackManifest,
  main: verifyPackMain,
  fail: verifyPackFail,
  stagedManifest,
  dryRunManifest,
  defaultIo: verifyPackDefaultIo,
} = await import("./verify-pack.mjs");
const { packTarball } = await import("./lib/npm-pack.mjs");
const { createScratchDir } = await import("./lib/scratch-dir.mjs");

// ---------------------------------------------------------------------------
// validate-release.mjs — the only check between a git tag and `npm publish`.
// ---------------------------------------------------------------------------

/** The metadata the package ACTUALLY ships, read from the file npm publishes. */
const shipped = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));

const COMPARE = "https://github.com/pbpeterson/typed-fetch/compare";

/**
 * A changelog that satisfies every rule for `version`, so a test can break one
 * rule at a time and know which rule it broke.
 */
function changelogFor(version, { unreleasedLast = false } = {}) {
  // The dated section carries the `<!-- redaction-directions: … -->`
  // declaration semver rule 8 obliges it to carry: RELEASING.md step 1 moves it
  // there with the pending block, and the gate requires exactly one there. A
  // release that moved the redacted url in no direction still declares `none`.
  const release =
    `## [${version}] - 2026-07-17\n\n<!-- redaction-directions: none -->\n\n` +
    "### Added\n\n- A release.\n";
  const footer =
    `[Unreleased]: ${COMPARE}/v${version}...HEAD\n` +
    `[${version}]: ${COMPARE}/v0.0.1...v${version}\n`;
  // The [Unreleased] section runs to the NEXT `## ` heading, or to the end of
  // the file when there is none. Both arrangements are legal changelogs, and
  // only the second one exercises the end-of-file case.
  return unreleasedLast
    ? `# Changelog\n\n${release}\n${footer}\n## [Unreleased]\n`
    : `# Changelog\n\n## [Unreleased]\n\n${release}\n${footer}`;
}

/** A candidate built from the SHIPPED package.json, not from a literal. */
function shippedCandidate(overrides = {}) {
  const commit = "a".repeat(40);
  return {
    tag: `v${shipped.version}`,
    refType: "tag",
    packageName: shipped.name,
    version: shipped.version,
    repositoryUrl: shipped.repository.url,
    publishAccess: shipped.publishConfig.access,
    provenance: shipped.publishConfig.provenance,
    changelog: changelogFor(shipped.version),
    headCommit: commit,
    tagCommit: commit,
    mainCommit: commit,
    ...overrides,
  };
}

describe("validateRelease, driven from the package.json this repository ships", () => {
  test("the shipped metadata satisfies the release policy", () => {
    // Not a tautology: `name`, `repository.url`, `publishConfig.access` and
    // `publishConfig.provenance` are compared against literals inside the gate,
    // so this fails the day one of them is edited in package.json. Every other
    // test in this file rests on it.
    expect(validateRelease(shippedCandidate())).toEqual({
      distTag: shipped.version.includes("-") ? "next" : "latest",
    });
  });

  test("refuses a tag that disagrees with the shipped version", () => {
    expect(() => validateRelease(shippedCandidate({ tag: `v${shipped.version}-typo` }))).toThrow(
      `must exactly match package version (v${shipped.version})`,
    );
  });

  test("refuses a tag that names a DIFFERENT real version of this package", () => {
    // The shape that actually happens: the version bump landed, the tag was cut
    // from the previous release name, and both strings are plausible SemVer.
    expect(() => validateRelease(shippedCandidate({ tag: "v1.0.0" }))).toThrow(
      'Git tag "v1.0.0" must exactly match',
    );
  });
});

describe("validateRelease — the [Unreleased] section", () => {
  test("refuses a changelog with no [Unreleased] heading at all", () => {
    // The refusal class no test had driven. Deleting the heading is how a
    // release script that rewrites the file in place loses it, and without the
    // heading the emptiness rule below can never run again — every subsequent
    // release would publish whatever the top of the file happened to say.
    const changelog = changelogFor(shipped.version).replace("## [Unreleased]\n", "");
    expect(() => validateRelease(shippedCandidate({ changelog }))).toThrow(
      "CHANGELOG.md must retain an [Unreleased] heading.",
    );
  });

  test("a heading that is not on a line of its own is not the [Unreleased] heading", () => {
    const changelog = changelogFor(shipped.version).replace(
      "## [Unreleased]\n",
      "## [Unreleased] (pending)\n",
    );
    expect(() => validateRelease(shippedCandidate({ changelog }))).toThrow(
      "must retain an [Unreleased] heading",
    );
  });

  test("accepts an [Unreleased] section that is the LAST heading in the file", () => {
    // The section ends at the next `## ` heading, or at the end of the file. A
    // changelog whose footer sits above an empty trailing [Unreleased] heading
    // is the second arrangement, and it must be accepted: nothing follows the
    // heading, so there is nothing pending to publish.
    expect(
      validateRelease(
        shippedCandidate({ changelog: changelogFor(shipped.version, { unreleasedLast: true }) }),
      ),
    ).toEqual({ distTag: shipped.version.includes("-") ? "next" : "latest" });
  });

  test("and still refuses one that is last AND carries a pending entry", () => {
    const changelog = `${changelogFor(shipped.version, { unreleasedLast: true })}\n- Pending.\n`;
    expect(() => validateRelease(shippedCandidate({ changelog }))).toThrow(
      "must be empty before publishing",
    );
  });
});

describe("validateRelease — every remaining refusal class the function reports", () => {
  test("rejects a version that is not valid SemVer", () => {
    expect(() => validateRelease(shippedCandidate({ version: "01.0.0" }))).toThrow(
      "not valid SemVer",
    );
  });

  test.each([
    ["ref type", { refType: "branch" }, "must run from a tag ref"],
    ["package name", { packageName: "typed-fetch" }, "package name must remain"],
    ["repository", { repositoryUrl: "https://example.test/repo" }, "repository URL must remain"],
    ["public access", { publishAccess: "restricted" }, "publishConfig.access must be public"],
    ["provenance", { provenance: false }, "publishConfig.provenance must be true"],
    ["tag commit", { tagCommit: "b".repeat(40) }, "does not point at HEAD"],
    ["main tip", { mainCommit: "b".repeat(40) }, "current origin/main tip"],
  ])("rejects an invalid %s", (_name, change, expectedMessage) => {
    expect(() => validateRelease(shippedCandidate(change))).toThrow(expectedMessage);
  });

  test("routes a prerelease version to the next dist-tag", () => {
    const version = `${shipped.version}-rc.1`;
    expect(
      validateRelease(
        shippedCandidate({ version, tag: `v${version}`, changelog: changelogFor(version) }),
      ),
    ).toEqual({ distTag: "next" });
  });

  test("rejects a changelog with no dated release heading for this version", () => {
    const changelog = changelogFor(shipped.version).replace(
      `## [${shipped.version}] - 2026-07-17`,
      `## [${shipped.version}]`,
    );
    expect(() => validateRelease(shippedCandidate({ changelog }))).toThrow(
      "needs a dated CHANGELOG release heading",
    );
  });

  test("rejects an impossible changelog calendar date", () => {
    const changelog = changelogFor(shipped.version).replace("2026-07-17", "2026-02-30");
    expect(() => validateRelease(shippedCandidate({ changelog }))).toThrow("valid calendar date");
  });

  // Semver rule 8's direction obligation. This describe claims to hold every
  // remaining refusal class the function reports, so a new class belongs here
  // by the describe's own title. Each row breaks the declaration in one way.
  const DECLARATION = "<!-- redaction-directions: none -->";

  test.each([
    ["deleted", `${DECLARATION}\n\n`, "", "section carries 0 <!-- redaction-directions: … -->"],
    [
      "written twice",
      DECLARATION,
      `${DECLARATION}\n\n<!-- redaction-directions: keeps-more -->`,
      "section carries 2 <!-- redaction-directions: … -->",
    ],
    [
      "left empty",
      DECLARATION,
      "<!-- redaction-directions: -->",
      "redaction-directions declaration names no direction",
    ],
    [
      "outside the closed vocabulary",
      DECLARATION,
      "<!-- redaction-directions: shorter -->",
      "declaration names shorter; every value must be one of removes-more, keeps-more, none",
    ],
  ])("rejects a dated section whose direction declaration is %s", (_name, find, put, message) => {
    const changelog = changelogFor(shipped.version).replace(find, put);
    expect(() => validateRelease(shippedCandidate({ changelog }))).toThrow(message);
  });

  test("rejects a changelog missing the version's footer link entirely", () => {
    const changelog = changelogFor(shipped.version).replace(
      `[${shipped.version}]: ${COMPARE}/v0.0.1...v${shipped.version}\n`,
      "",
    );
    expect(() => validateRelease(shippedCandidate({ changelog }))).toThrow(
      `needs a [${shipped.version}] link definition`,
    );
  });

  test("rejects a footer version link that does not START from the compare base", () => {
    const changelog = changelogFor(shipped.version).replace(
      `${COMPARE}/v0.0.1...v${shipped.version}`,
      `https://example.test/compare/v0.0.1...v${shipped.version}`,
    );
    expect(() => validateRelease(shippedCandidate({ changelog }))).toThrow(
      `range ending at v${shipped.version}`,
    );
  });

  test("rejects a footer version link that does not END at this version", () => {
    const changelog = changelogFor(shipped.version).replace(
      `...v${shipped.version}\n`,
      "...v0.0.2\n",
    );
    expect(() => validateRelease(shippedCandidate({ changelog }))).toThrow(
      `range ending at v${shipped.version}`,
    );
  });

  test("rejects a changelog missing the [Unreleased] footer link entirely", () => {
    const changelog = changelogFor(shipped.version).replace(
      `[Unreleased]: ${COMPARE}/v${shipped.version}...HEAD\n`,
      "",
    );
    expect(() => validateRelease(shippedCandidate({ changelog }))).toThrow(
      "[Unreleased] link must be",
    );
  });

  test("rejects an [Unreleased] footer link that does not match the expected range", () => {
    const changelog = changelogFor(shipped.version).replace(
      `${COMPARE}/v${shipped.version}...HEAD`,
      `${COMPARE}/v0.0.1...HEAD`,
    );
    expect(() => validateRelease(shippedCandidate({ changelog }))).toThrow(
      "[Unreleased] link must be",
    );
  });
});

// ---------------------------------------------------------------------------
// verify-pack.mjs — the manifest gate, driven from a manifest that breaks it.
// ---------------------------------------------------------------------------

/** The 14 paths a clean `pnpm build` + `npm pack` produces, as a tar listing. */
const CLEAN_TAR_LISTING = [
  "package/package.json",
  "package/LICENSE",
  "package/README.md",
  "package/dist/index.js",
  "package/dist/index.mjs",
  "package/dist/index.d.ts",
  "package/dist/index.d.mts",
  "package/dist/errors/index.js",
  "package/dist/errors/index.mjs",
  "package/dist/errors/index.d.ts",
  "package/dist/errors/index.d.mts",
  "package/dist/chunk-Q3VCRU7W.mjs",
  "package/dist/chunk-VT2QTF3N.js",
  "package/errors/package.json",
].join("\n");

describe("verify-pack — a stray root spec file never reaches a consumer", () => {
  test("the clean listing passes through both readers to the same verdict", () => {
    const staged = readTarballManifest(`${CLEAN_TAR_LISTING}\n`);
    expect(verifyPackManifest(staged.files, staged.fileCount)).toEqual({ fileCount: 14 });
  });

  test.each([
    ["release-gate-entry.spec.mjs", "test file"],
    ["verify-pack.spec.mjs", "test file"],
    ["index.spec.ts", "TypeScript source (not a declaration)"],
    ["dist/errors/index.spec.mjs", "test file"],
  ])("a staged tarball carrying %s is refused as a %s", (stray, label) => {
    // Driven the way the release workflow drives it: the `tar -tzf` listing of
    // the file that would be uploaded, read by the same function the gate uses.
    const staged = readTarballManifest(`${CLEAN_TAR_LISTING}\npackage/${stray}\n`);
    expect(staged.files).toContain(stray);
    expect(() => verifyPackManifest(staged.files, staged.fileCount)).toThrow(
      `${stray}  (${label})`,
    );
  });

  test("the dry-run manifest refuses the same stray file", () => {
    // The workflow gates twice — once on what npm WOULD pack, once on the
    // staged file — and both readings must reach the same refusal, or the early
    // gate is decoration.
    const parsed = [
      {
        files: [...CLEAN_TAR_LISTING.split("\n"), "package/release-gate-entry.spec.mjs"].map(
          (path) => ({ path: path.slice("package/".length) }),
        ),
        entryCount: 15,
      },
    ];
    const manifest = readPackManifest(parsed);
    expect(() => verifyPackManifest(manifest.files, manifest.fileCount)).toThrow(
      "release-gate-entry.spec.mjs  (test file)",
    );
  });
});

describe("readTarballManifest / readPackManifest / verifyPackManifest — remaining refusal classes", () => {
  const withoutClean = (file) =>
    CLEAN_TAR_LISTING.split("\n")
      .filter((p) => p !== `package/${file}`)
      .join("\n");

  test("readTarballManifest refuses a listing with no files at all", () => {
    expect(() => readTarballManifest("\n \n")).toThrow("no files to inspect");
  });

  test("readTarballManifest drops directory entries", () => {
    expect(readTarballManifest("package/\npackage/dist/\npackage/LICENSE\n")).toEqual({
      files: ["LICENSE"],
      fileCount: 1,
    });
  });

  test("readTarballManifest keeps an entry outside the package/ root as-is", () => {
    // Nothing but `package/...` belongs in a tarball; leaving a stray entry
    // whole is what lets the allow-list refuse it below.
    expect(readTarballManifest("../escape\n").files).toEqual(["../escape"]);
  });

  test("readPackManifest refuses a payload with no file list", () => {
    expect(() => readPackManifest({})).toThrow("had no file list to inspect");
  });

  test("readPackManifest accepts a bare object and falls back to files.length", () => {
    // npm's --json payload was a bare object before it became a one-element
    // array; entryCount is also absent on this shape.
    expect(readPackManifest({ files: [{ path: "a" }, { path: "b" }] })).toEqual({
      files: ["a", "b"],
      fileCount: 2,
    });
  });

  test.each(["dist/index.js", "dist/errors/index.d.mts"])(
    "verifyPackManifest refuses a build missing %s",
    (entry) => {
      const staged = readTarballManifest(`${withoutClean(entry)}\n`);
      expect(() => verifyPackManifest(staged.files, staged.fileCount)).toThrow(
        "missing required compiled file(s)",
      );
    },
  );

  test("verifyPackManifest refuses a tarball missing the node10 redirect stub", () => {
    const staged = readTarballManifest(`${withoutClean("errors/package.json")}\n`);
    expect(() => verifyPackManifest(staged.files, staged.fileCount)).toThrow(
      "missing the node10 redirect stub",
    );
  });

  test.each(["LICENSE", "README.md"])("verifyPackManifest refuses a tarball missing %s", (meta) => {
    const staged = readTarballManifest(`${withoutClean(meta)}\n`);
    expect(() => verifyPackManifest(staged.files, staged.fileCount)).toThrow(
      "missing required metadata file(s)",
    );
  });

  test("verifyPackManifest refuses an unrecognised extra file that matches no leak rule", () => {
    const staged = readTarballManifest(`${CLEAN_TAR_LISTING}\npackage/dist/vendor-bundle.mjs\n`);
    expect(() => verifyPackManifest(staged.files, staged.fileCount)).toThrow(
      "dist/vendor-bundle.mjs  (not on the allow-list)",
    );
  });

  test("verifyPackManifest refuses a build below the minimum file count", () => {
    // package.json is not itself a REQUIRED_* entry, so dropping it clears the
    // earlier guards and reaches the count floor directly.
    const staged = readTarballManifest(`${withoutClean("package.json")}\n`);
    expect(() => verifyPackManifest(staged.files, staged.fileCount)).toThrow(
      "Build output looks incomplete",
    );
  });

  test("verifyPackManifest refuses a file count npm itself reports as too high", () => {
    // Unreachable through an on-disk fixture: every allow-listed file counted
    // above the ceiling is individually legitimate, so only npm's own
    // entryCount can disagree with the file list's own length.
    const staged = readTarballManifest(`${CLEAN_TAR_LISTING}\n`);
    expect(() => verifyPackManifest(staged.files, staged.fileCount + 1)).toThrow(
      "expected at most 14",
    );
  });
});

// ---------------------------------------------------------------------------
// validate-release.mjs — main(), driven end to end through io.
//
// Section 8.5 option (b) gave main() an `io` (argv, cwd, env, out, err, exit,
// git), so the entry point that used to be reachable only by spawning a real
// process is now driven in-process, with no real git checkout and no real
// process.exit to kill this worker.
// ---------------------------------------------------------------------------

/** A package.json + CHANGELOG.md pair that main() reads from `io.cwd`. */
function releaseCandidateDir(version = shipped.version) {
  const dir = scratch("tf-r16-release-cwd-");
  writeFileSync(join(dir, "package.json"), JSON.stringify({ ...shipped, version }, null, 2));
  writeFileSync(join(dir, "CHANGELOG.md"), changelogFor(version));
  return dir;
}

/** An `io.git` that answers every ref with the SAME fake commit: a tag on HEAD, on main. */
const agreeingGit =
  (sha = "c".repeat(40)) =>
  () =>
    sha;

function releaseIo(overrides = {}) {
  const out = [];
  const err = [];
  let exitCode;
  const io = {
    argv: [],
    cwd: overrides.cwd ?? releaseCandidateDir(),
    env: overrides.env ?? {},
    out: (m) => out.push(m),
    err: (m) => err.push(m),
    exit: (code) => {
      exitCode = code;
    },
    git: overrides.git ?? agreeingGit(),
  };
  return { io, out, err, exitCode: () => exitCode };
}

describe("validate-release main() — driven end to end through io", () => {
  test("a matching tag validates, writes the dist-tag output, and prints the OK line", () => {
    const outputFile = join(scratch("tf-r16-release-output-"), "github-output");
    const { io, out, exitCode } = releaseIo({
      env: {
        GITHUB_REF_NAME: `v${shipped.version}`,
        GITHUB_REF_TYPE: "tag",
        GITHUB_OUTPUT: outputFile,
      },
    });

    validateReleaseMain(io);

    expect(exitCode()).toBeUndefined();
    expect(out.some((line) => line.includes("✔ validate-release:"))).toBe(true);
    expect(readFileSync(outputFile, "utf8")).toBe("dist_tag=latest\n");
  });

  test("a matching tag with no GITHUB_OUTPUT still validates and writes nothing to disk", () => {
    // The other arm of `if (outputFile) …`: no output path means no append.
    const { io, out, exitCode } = releaseIo({
      env: { GITHUB_REF_NAME: `v${shipped.version}`, GITHUB_REF_TYPE: "tag" },
    });

    validateReleaseMain(io);

    expect(exitCode()).toBeUndefined();
    expect(out.some((line) => line.includes("✔ validate-release:"))).toBe(true);
  });

  test("a tag that disagrees with package.json is refused, reported, and exits 1", () => {
    // Section 8.7's central example, driven through main() rather than through
    // validateRelease() directly — this is the io wiring no test had exercised.
    const { io, err, out, exitCode } = releaseIo({
      env: { GITHUB_REF_NAME: `v${shipped.version}-typo`, GITHUB_REF_TYPE: "tag" },
    });

    validateReleaseMain(io);

    expect(exitCode()).toBe(1);
    expect(err.some((line) => line.includes("✖ validate-release:"))).toBe(true);
    expect(err.some((line) => line.includes("must exactly match package version"))).toBe(true);
    expect(out).toEqual([]);
  });

  test("a CI environment with neither GITHUB_REF_NAME nor GITHUB_REF_TYPE set is refused", () => {
    // The `?? ""` fallback on both env reads: an untagged CI run (a push to a
    // branch, not a release tag) leaves both variables unset.
    const { io, err, exitCode } = releaseIo({ env: {} });

    validateReleaseMain(io);

    expect(exitCode()).toBe(1);
    expect(err.some((line) => line.includes("must run from a tag ref"))).toBe(true);
  });

  test("a non-Error thrown while reporting success is still stringified and refused", () => {
    // `error instanceof Error ? error.message : String(error)`, false arm: a
    // writer that misbehaves after validation already succeeded.
    const { io, err, exitCode } = releaseIo({
      env: { GITHUB_REF_NAME: `v${shipped.version}`, GITHUB_REF_TYPE: "tag" },
    });
    io.out = () => {
      throw "not an Error instance";
    };

    validateReleaseMain(io);

    expect(exitCode()).toBe(1);
    expect(err.some((line) => line === "✖ validate-release: not an Error instance")).toBe(true);
  });

  test("a cwd with no package.json or CHANGELOG.md is refused the same way, nothing written", () => {
    const outputFile = join(scratch("tf-r16-release-noout-"), "github-output");
    const { io, err, exitCode } = releaseIo({
      cwd: scratch("tf-r16-release-empty-"),
      env: { GITHUB_REF_NAME: "v9.9.9", GITHUB_REF_TYPE: "tag", GITHUB_OUTPUT: outputFile },
    });

    validateReleaseMain(io);

    expect(exitCode()).toBe(1);
    expect(err.some((line) => line.includes("✖ validate-release:"))).toBe(true);
    expect(existsSync(outputFile)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// verify-pack.mjs — fail(), stagedManifest(), dryRunManifest(), and main(),
// driven end to end through io. No test here shells out to a real npm or a
// real tar; `io.execFileSync` answers for both.
// ---------------------------------------------------------------------------

function verifyPackIo(overrides = {}) {
  const out = [];
  const err = [];
  let exitCode;
  const io = {
    argv: overrides.argv ?? [],
    cwd: overrides.cwd ?? repoRoot,
    out: (m) => out.push(m),
    err: (m) => err.push(m),
    exit: (code) => {
      exitCode = code;
    },
    execFileSync:
      overrides.execFileSync ??
      (() => {
        throw new Error("execFileSync not stubbed for this test");
      }),
  };
  return { io, out, err, exitCode: () => exitCode };
}

/** `npm pack --dry-run --json`'s payload for the clean manifest, as a string. */
const CLEAN_DRY_RUN_JSON = JSON.stringify([
  {
    files: CLEAN_TAR_LISTING.split("\n").map((p) => ({
      path: p.startsWith("package/") ? p.slice("package/".length) : p,
    })),
    entryCount: 14,
  },
]);

describe("verify-pack — fail()", () => {
  test("prints the message and the refusing-to-publish epilogue, then asks to exit 1", () => {
    const { io, err, exitCode } = verifyPackIo();

    verifyPackFail("a manifest problem", io);

    expect(exitCode()).toBe(1);
    expect(err[0]).toContain("a manifest problem");
    expect(err.some((l) => l.includes("Refusing to publish"))).toBe(true);
  });
});

describe("verify-pack — stagedManifest()", () => {
  test("reads a clean tarball listing through `tar -tzf`", () => {
    const { io } = verifyPackIo({
      execFileSync: (cmd, args) => {
        expect(cmd).toBe("tar");
        expect(args).toEqual(["-tzf", "/tmp/fake.tgz"]);
        return `${CLEAN_TAR_LISTING}\n`;
      },
    });

    expect(stagedManifest("/tmp/fake.tgz", io)).toEqual({
      files: CLEAN_TAR_LISTING.split("\n").map((p) => p.slice("package/".length)),
      fileCount: 14,
    });
  });

  test("a `tar` that fails to run is reported and refused, never a manifest", () => {
    const { io, err, exitCode } = verifyPackIo({
      execFileSync: () => {
        throw new Error("spawn tar ENOENT");
      },
    });

    expect(stagedManifest("/tmp/missing.tgz", io)).toBe(null);
    expect(exitCode()).toBe(1);
    expect(err.some((l) => l.includes("tar -tzf /tmp/missing.tgz"))).toBe(true);
  });
});

describe("verify-pack — dryRunManifest()", () => {
  test("reads the manifest npm pack --dry-run --json would produce", () => {
    const { io } = verifyPackIo({
      execFileSync: (cmd, args) => {
        expect(cmd).toBe("npm");
        expect(args).toEqual(["pack", "--dry-run", "--json"]);
        return CLEAN_DRY_RUN_JSON;
      },
    });

    expect(dryRunManifest(io)).toEqual({
      files: CLEAN_TAR_LISTING.split("\n").map((p) => p.slice("package/".length)),
      fileCount: 14,
    });
  });

  test("an `npm pack` that fails to run is reported and refused", () => {
    const { io, err, exitCode } = verifyPackIo({
      execFileSync: () => {
        throw new Error("spawn npm ENOENT");
      },
    });

    expect(dryRunManifest(io)).toBe(null);
    expect(exitCode()).toBe(1);
    expect(err.some((l) => l.includes("npm pack --dry-run --json"))).toBe(true);
  });

  test("unparsable JSON from npm is reported and refused, not thrown", () => {
    const { io, err, exitCode } = verifyPackIo({ execFileSync: () => "not json" });

    expect(dryRunManifest(io)).toBe(null);
    expect(exitCode()).toBe(1);
    expect(err.some((l) => l.includes("could not parse"))).toBe(true);
  });
});

describe("verify-pack main() — driven end to end through io", () => {
  test("no argv path inspects the dry-run manifest and prints every required file", () => {
    const { io, out, exitCode } = verifyPackIo({
      argv: [],
      execFileSync: () => CLEAN_DRY_RUN_JSON,
    });

    verifyPackMain(io);

    expect(exitCode()).toBeUndefined();
    expect(out[0]).toContain("dry-run manifest OK — 14 files");
    expect(out.some((l) => l.includes("dist/index.js"))).toBe(true);
    expect(out.some((l) => l.includes("errors/package.json"))).toBe(true);
  });

  test("an argv path inspects the STAGED tarball instead", () => {
    const { io, out, exitCode } = verifyPackIo({
      argv: [process.execPath, "verify-pack.mjs", "/tmp/staged.tgz"],
      execFileSync: () => `${CLEAN_TAR_LISTING}\n`,
    });

    verifyPackMain(io);

    expect(exitCode()).toBeUndefined();
    expect(out[0]).toContain("staged tarball /tmp/staged.tgz OK — 14 files");
  });

  test("a manifest that fails the policy is refused with the reason, never with a stack trace", () => {
    // Section 8.7's verify-pack example: a manifest carrying a stray root spec
    // file, driven all the way through main() rather than through
    // verifyPackManifest() directly.
    const { io, err, out, exitCode } = verifyPackIo({
      argv: [],
      execFileSync: () =>
        JSON.stringify([
          {
            files: [...CLEAN_TAR_LISTING.split("\n"), "package/release-gate-entry.spec.mjs"].map(
              (p) => ({ path: p.slice("package/".length) }),
            ),
            entryCount: 15,
          },
        ]),
    });

    verifyPackMain(io);

    expect(exitCode()).toBe(1);
    expect(err.some((l) => l.includes("release-gate-entry.spec.mjs  (test file)"))).toBe(true);
    expect(out).toEqual([]);
  });

  test("a tar/npm run that fails never reaches the policy check or prints OK", () => {
    const { io, out, exitCode } = verifyPackIo({
      argv: [],
      execFileSync: () => {
        throw new Error("boom");
      },
    });

    verifyPackMain(io);

    expect(exitCode()).toBe(1);
    expect(out).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// scratch-dir.mjs — the handlers, invoked instead of described.
// ---------------------------------------------------------------------------

/**
 * The handlers `createScratchDir` installs on `process`, captured on the FIRST
 * call this file makes.
 *
 * Installed lazily and exactly once per process, so they can only be captured
 * by differencing the listener lists around the call that installs them. The
 * sibling spec drives the same behaviour through real child processes, which is
 * the right test for a real signal and reaches none of these lines from a
 * vitest worker; this one holds the handlers themselves and calls them.
 */
const HANDLERS = (() => {
  const before = {
    exit: new Set(process.listeners("exit")),
    SIGINT: new Set(process.listeners("SIGINT")),
    SIGTERM: new Set(process.listeners("SIGTERM")),
  };
  const probe = createScratchDir("tf-r16-probe-");
  probe.dispose();
  const added = (event) => process.listeners(event).filter((one) => !before[event].has(one));
  return { exit: added("exit"), SIGINT: added("SIGINT"), SIGTERM: added("SIGTERM") };
})();

/** Call `handler` with `process.exit` replaced, and report the code it asked for. */
function exitCodeFrom(handler) {
  const real = process.exit;
  let requested;
  process.exit = (code) => {
    requested = code;
  };
  try {
    handler();
  } finally {
    process.exit = real;
  }
  return requested;
}

describe("scratch-dir — the process handlers it installs", () => {
  test("installs exactly one handler per event, however many directories are opened", () => {
    const opened = [createScratchDir("tf-r16-a-"), createScratchDir("tf-r16-b-")];
    expect({
      exit: HANDLERS.exit.length,
      SIGINT: HANDLERS.SIGINT.length,
      SIGTERM: HANDLERS.SIGTERM.length,
    }).toEqual({ exit: 1, SIGINT: 1, SIGTERM: 1 });
    for (const one of opened) one.dispose();
  });

  test("the exit handler removes every outstanding directory, not just the last", () => {
    const opened = [createScratchDir("tf-r16-c-"), createScratchDir("tf-r16-d-")];
    expect(opened.map((one) => existsSync(one.path))).toEqual([true, true]);

    HANDLERS.exit[0]();

    expect(opened.map((one) => existsSync(one.path))).toEqual([false, false]);
  });

  test("the exit handler is safe to run again with nothing outstanding", () => {
    // It walks a SNAPSHOT of the pending set, and each dispose removes itself
    // from that set, so a second run has nothing to do and must not throw.
    expect(() => HANDLERS.exit[0]()).not.toThrow();
  });

  test.each(["SIGINT", "SIGTERM"])("the %s handler cleans up and exits 1", (signal) => {
    const one = createScratchDir(`tf-r16-${signal.toLowerCase()}-`);
    writeFileSync(join(one.path, "leftover.txt"), "x");

    const code = exitCodeFrom(HANDLERS[signal][0]);

    expect({ code, survived: existsSync(one.path) }).toEqual({ code: 1, survived: false });
  });

  test("a directory disposed by hand is not disposed a second time by the handler", () => {
    const one = createScratchDir("tf-r16-e-");
    one.dispose();
    // Re-create the path by hand: if the handler still held the dispose, this
    // directory would be removed by a cleanup that has no business with it.
    writeFileSync(join(scratch("tf-r16-witness-"), "keep.txt"), "x");
    const witness = owned.at(-1);

    HANDLERS.exit[0]();

    expect(existsSync(join(witness, "keep.txt"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// npm-pack.mjs — npm's older output shape.
// ---------------------------------------------------------------------------

describe("packTarball reads npm's report whatever shape npm sends", () => {
  test("accepts a bare object where npm sends a one-element array today", () => {
    // npm's `--json` payload for `pack` was an object before it became an
    // array, and `packTarball` reads both. The array arm is what every other
    // test in the repository exercises, because it is what the real npm sends;
    // this one pins the fallback, so a "simplification" that deletes it fails
    // here instead of on a runner with an older npm.
    const packageDir = scratch("tf-r16-pkg-");
    writeFileSync(
      join(packageDir, "package.json"),
      JSON.stringify({ name: "@tf-r16/fixture", version: "0.0.0", private: false }),
    );
    const dest = scratch("tf-r16-dest-");

    const { path, reported } = packTarball(packageDir, dest);

    expect({ reported, onDisk: existsSync(path) }).toEqual({
      reported: "tf-r16-shim-0.0.0.tgz",
      onDisk: true,
    });
  });

  test("still answers with the tarball on DISK, never with the reported name", () => {
    const packageDir = scratch("tf-r16-pkg2-");
    writeFileSync(
      join(packageDir, "package.json"),
      JSON.stringify({ name: "@tf-r16/fixture", version: "0.0.0", private: false }),
    );
    const dest = scratch("tf-r16-dest2-");

    const { path } = packTarball(packageDir, dest);

    expect(path).toBe(join(dest, "tf-r16-shim-0.0.0.tgz"));
  });
});

// ---------------------------------------------------------------------------
// defaultIo — the real-world sinks, driven directly rather than through
// main(). Each member is a VALUE, not something main() alone can reach. Every
// real sink is swapped for a spy for the duration of one call, asserted, and
// restored in a `finally` — the same shape F4a used for node-min.mjs's
// default io in scripts/smoke-entry.spec.mjs. `git` and
// `execFileSync` are called once each, offline and read-only, and the
// assertion is on the SHAPE of the answer (a commit hash, a version string),
// never on its exact value — this gate must never be driven against real
// repository state.
// ---------------------------------------------------------------------------

describe("validate-release.mjs — defaultIo, the real-world sinks", () => {
  test("out and err write through console.log/console.error", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      validateReleaseDefaultIo.out("round16-defaultio-out");
      validateReleaseDefaultIo.err("round16-defaultio-err");
      expect(logSpy).toHaveBeenCalledWith("round16-defaultio-out");
      expect(errorSpy).toHaveBeenCalledWith("round16-defaultio-err");
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  test("exit sets the real process.exitCode without terminating the worker", () => {
    const previous = process.exitCode;
    try {
      validateReleaseDefaultIo.exit(3);
      expect(process.exitCode).toBe(3);
    } finally {
      process.exitCode = previous;
    }
  });

  test("git shells out to the real git binary and answers a commit-shaped string", () => {
    // Offline and read-only: `rev-parse HEAD` never touches the network or the
    // working tree. The SHAPE is asserted — a 40-character hex commit id —
    // never the value, so this test does not depend on which commit is
    // checked out.
    const sha = validateReleaseDefaultIo.git(["rev-parse", "HEAD"]);
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe("verify-pack.mjs — defaultIo, the real-world sinks", () => {
  test("out and err write through console.log/console.error", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      verifyPackDefaultIo.out("round16-defaultio-out");
      verifyPackDefaultIo.err("round16-defaultio-err");
      expect(logSpy).toHaveBeenCalledWith("round16-defaultio-out");
      expect(errorSpy).toHaveBeenCalledWith("round16-defaultio-err");
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  test("exit calls the real process.exit", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined);
    try {
      verifyPackDefaultIo.exit(0);
      expect(exitSpy).toHaveBeenCalledWith(0);
    } finally {
      exitSpy.mockRestore();
    }
  });

  test("execFileSync shells out to a real binary and answers a version-shaped string", () => {
    // A version query, never a pack: offline, harmless, and the assertion is
    // on the shape of the answer, not its exact value. `node`, not `npm` —
    // the fake npm this file installed on PATH for the shim tests above would
    // answer instead of the real binary, and defaultIo.execFileSync is the
    // bare execFileSync with no env override to route around it.
    const output = verifyPackDefaultIo.execFileSync("node", ["--version"], { encoding: "utf8" });
    expect(output.trim()).toMatch(/^v\d+\.\d+\.\d+/);
  });
});

// ---------------------------------------------------------------------------
// The isMainModule guard's true arm — run as the real entry point, in
// process. `isMainModule` compares `process.argv[1]` against the module's own
// `import.meta.url`. Spoofing `argv[1]` to the file's real path and
// re-importing it under a cache-busting query makes a FRESH module instance
// evaluate the guard as true for real, in this process — no subprocess, so it
// counts toward this file's own coverage. Same technique as
// scripts/smoke-entry.spec.mjs's "the guard, run as the real entry
// point" describe. Neither test lets the gate run against real repository
// state: validate-release's env is forced to a non-tag ref before the
// reimport, and verify-pack's argv is forced to a tarball path that cannot
// exist, so both refuse deterministically without packing anything or
// answering for the actual state of this checkout.
// ---------------------------------------------------------------------------

describe("validate-release.mjs — the guard, run as the real entry point", () => {
  test("isMainModule reports true and the default io refuses a tag that cannot exist", async () => {
    // main() builds its candidate EAGERLY — all three `git rev-parse` calls
    // run before validateRelease() reads a single field of it — so the
    // fastest deterministic refusal is a tag name git itself can never
    // resolve, not `validateRelease`'s own refType check. The outcome does
    // not depend on this checkout being a tagged release, or on any tag
    // that happens to exist in it: this exact string can never be a real
    // tag.
    // Manual property reassignment, not vi.spyOn: the module below is
    // re-imported under a cache-busting query, and a fresh module instance
    // resolves its OWN reference to console.error at call time — a
    // vi.spyOn mock does not reliably observe that call. Reassigning the
    // property directly does, because every module instance still reads
    // the SAME global object.
    const bogusTag = "v0.0.0-round16-guard-check-does-not-exist";
    const entryPath = fileURLToPath(new URL("./validate-release.mjs", import.meta.url));
    const previousArgv1 = process.argv[1];
    const previousRefType = process.env.GITHUB_REF_TYPE;
    const previousRefName = process.env.GITHUB_REF_NAME;
    const previousExitCode = process.exitCode;
    process.argv[1] = entryPath;
    process.env.GITHUB_REF_TYPE = "tag";
    process.env.GITHUB_REF_NAME = bogusTag;
    const realError = console.error;
    const printed = [];
    console.error = (...args) => {
      printed.push(String(args[0]));
    };
    try {
      await import("./validate-release.mjs?round16-guard-check");
    } finally {
      console.error = realError;
      process.argv[1] = previousArgv1;
      if (previousRefType === undefined) delete process.env.GITHUB_REF_TYPE;
      else process.env.GITHUB_REF_TYPE = previousRefType;
      if (previousRefName === undefined) delete process.env.GITHUB_REF_NAME;
      else process.env.GITHUB_REF_NAME = previousRefName;
      process.exitCode = previousExitCode;
    }

    expect(printed.some((l) => l.includes("✖ validate-release:"))).toBe(true);
    expect(printed.some((l) => l.includes(bogusTag))).toBe(true);
  }, 30000);
});

describe("verify-pack.mjs — the guard, run as the real entry point", () => {
  test("isMainModule reports true and the default io refuses a nonexistent staged path, never packing", async () => {
    // Manual property reassignment — see the comment on the
    // validate-release guard test above for why vi.spyOn cannot be
    // trusted here.
    const entryPath = fileURLToPath(new URL("./verify-pack.mjs", import.meta.url));
    const previousArgv = process.argv;
    process.argv = [previousArgv[0], entryPath, "/round16-guard-check-nonexistent.tgz"];
    const realExit = process.exit;
    const realError = console.error;
    let exitCode;
    const printed = [];
    process.exit = (code) => {
      exitCode = code;
      throw new Error(`stubbed process.exit(${code})`);
    };
    console.error = (...args) => {
      printed.push(String(args[0]));
    };
    let caught = null;
    try {
      await import("./verify-pack.mjs?round16-guard-check");
    } catch (error) {
      caught = error;
    } finally {
      console.error = realError;
      process.exit = realExit;
      process.argv = previousArgv;
    }

    expect(exitCode).toBe(1);
    expect(String(caught?.message)).toBe("stubbed process.exit(1)");
    expect(printed.some((l) => l.includes("tar -tzf /round16-guard-check-nonexistent.tgz"))).toBe(
      true,
    );
    expect(printed.some((l) => l.includes("npm pack"))).toBe(false);
  }, 30000);
});
