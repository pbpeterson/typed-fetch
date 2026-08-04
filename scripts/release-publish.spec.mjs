import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createScratchDir } from "./lib/scratch-dir.mjs";
import { NPM_ENV, packTarball } from "./lib/npm-pack.mjs";

// ---------------------------------------------------------------------------
// The publish step's ARGUMENT SHAPE.
//
// `npm publish <arg>` reads its argument as a package SPEC, not as a path. npm
// treats a spec as a file only when it starts with `.`, `/`, `~/`, or a drive
// letter. `package/<name>.tgz` starts with none of them, so npm read it as the
// GitHub shorthand `owner/repo` and ran
// `git ls-remote ssh://git@github.com/package/<name>.tgz.git`.
//
// The publish job has no checkout and no git credentials, so that failed — in
// the one job that runs after every gate has passed, holds the OIDC token, and
// cannot be retried without a new tag.
//
// Two tests, and they answer different questions. The workflow tests assert the
// release file still spells the fix. The end-to-end test asserts what npm
// ACTUALLY does with each form, so the reasoning above stays a fact rather than
// a comment.
// ---------------------------------------------------------------------------

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const releaseWorkflow = readFileSync(join(repoRoot, ".github/workflows/release.yml"), "utf8");

describe("release.yml — the publish step", () => {
  test("resolves the staged tarball to an absolute path", () => {
    expect(releaseWorkflow).toContain('package_tarball="$(realpath "${package_tarballs[0]}")"');
  });

  test("passes that absolute path to npm publish", () => {
    expect(releaseWorkflow).toContain('npm-cli.js publish "$package_tarball"');
    // The relative form is what failed. It must not come back.
    expect(releaseWorkflow).not.toContain('publish "${package_tarballs[0]}"');
  });

  test("keeps the publish flags", () => {
    for (const flag of [
      "--ignore-scripts",
      "--provenance",
      "--access public",
      '--tag "$DIST_TAG"',
    ]) {
      expect(releaseWorkflow).toContain(flag);
    }
  });
});

describe("release.yml — the staging step", () => {
  test("validates the staged tarball itself, not another dry run", () => {
    expect(releaseWorkflow).toContain('node scripts/verify-pack.mjs "$(realpath "${staged[0]}")"');
  });

  test("refuses to continue unless exactly one package tarball was staged", () => {
    expect(releaseWorkflow).toContain('[ "${#staged[@]}" -eq 1 ]');
  });
});

// ---------------------------------------------------------------------------
// END TO END. Runs the real npm CLI against both argument forms.
//
// Hermetic: `--dry-run` uploads nothing, the registry points at a closed port,
// the cache is a scratch directory, and a fake `git` first on PATH records
// every invocation instead of reaching the network. A run that resolves the
// argument as a file never calls git at all.
//
// It packs this repository, so it needs `dist/`. The release workflow builds
// before it tests, and it installs the pinned npm 11.18.0 before that, so this
// runs against the exact CLI the publish job extracts.
// ---------------------------------------------------------------------------

const canRunEndToEnd = process.platform !== "win32" && existsSync(join(repoRoot, "dist/index.js"));

/** A `git` that answers nothing and records that it was asked. */
function installGitRecorder(binDir, logPath) {
  mkdirSync(binDir, { recursive: true });
  const shim = join(binDir, "git");
  writeFileSync(shim, `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(logPath)}\nexit 1\n`);
  chmodSync(shim, 0o755);
}

describe.skipIf(!canRunEndToEnd)("npm publish — how it reads the tarball argument", () => {
  /** @type {{ path: string, dispose: () => void }} */
  let scratch;
  let stagingDir;
  let binDir;
  let gitLog;
  let cacheDir;
  let tarballPath;
  let relativeArgument;

  // In a hook, not in the suite body: a skipped suite still evaluates its body,
  // and packing a tarball is not something a skipped suite may do.
  beforeAll(() => {
    scratch = createScratchDir("tf-publish-");
    stagingDir = join(scratch.path, "release-artifact");
    binDir = join(scratch.path, "bin");
    gitLog = join(scratch.path, "git.log");
    cacheDir = join(scratch.path, "npm-cache");

    const packageDir = join(stagingDir, "package");
    mkdirSync(packageDir, { recursive: true });
    installGitRecorder(binDir, gitLog);
    tarballPath = packTarball(repoRoot, packageDir).path;
    relativeArgument = `package/${basename(tarballPath)}`;
  }, 120_000);

  afterAll(() => scratch?.dispose());

  /**
   * Run the publish command the workflow runs, from the staging directory.
   * Returns the exit status, the combined output, and every git invocation.
   */
  function publish(argument) {
    writeFileSync(gitLog, "");
    let status = 0;
    let output = "";
    try {
      output = execFileSync(
        "npm",
        [
          "publish",
          argument,
          "--dry-run",
          "--ignore-scripts",
          "--access",
          "public",
          "--tag",
          "latest",
          "--registry",
          "http://127.0.0.1:1/",
          "--cache",
          cacheDir,
        ],
        {
          cwd: stagingDir,
          encoding: "utf8",
          env: { ...NPM_ENV, PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}` },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
    } catch (err) {
      status = typeof err.status === "number" ? err.status : 1;
      output = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    }
    return { status, output, gitCalls: readFileSync(gitLog, "utf8").trim() };
  }

  test("a relative path is read as a GitHub spec and reaches git", () => {
    const result = publish(relativeArgument);

    expect(result.status).not.toBe(0);
    expect(result.gitCalls).toContain("ls-remote");
    expect(result.gitCalls).toContain(relativeArgument);
  });

  test("an absolute path is read as the file, and git is never consulted", () => {
    const result = publish(tarballPath);

    expect(result.gitCalls).toBe("");
    expect(result.status).toBe(0);
    expect(result.output).toContain("@pbpeterson/typed-fetch");
  }, 60_000);
});
