#!/usr/bin/env node
// @ts-check

import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isMainModule } from "./lib/is-main-module.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * @typedef {{
 *   argv: string[],
 *   cwd: string,
 *   env: NodeJS.ProcessEnv,
 *   out: (msg: string) => void,
 *   err: (msg: string) => void,
 *   exit: (code: number) => void,
 *   git: (args: string[]) => string,
 * }} MainIo
 */

/**
 * The real world this gate runs against. `exit` matches production exactly:
 * the gate never hard-exits, it sets `process.exitCode` and lets Node shut
 * down on its own. `git` is the one shell-out this gate makes, named so a test
 * can answer for it without a real repository.
 *
 * @internal Exported for the entry-point spec. Not a public interface.
 * @type {MainIo}
 */
export const defaultIo = {
  argv: process.argv,
  cwd: REPO_ROOT,
  env: process.env,
  out: (msg) => console.log(msg),
  err: (msg) => console.error(msg),
  exit: (code) => {
    process.exitCode = code;
  },
  git: (args) => execFileSync("git", args, { encoding: "utf8" }).trim(),
};

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

/** @param {string} value */
function escapeRegex(value) {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** @param {string} value */
function isCalendarDate(value) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Validate everything that must be true before the workflow may publish.
 * Keeping this pure makes the release policy executable and unit-testable.
 *
 * @param {{
 *   tag: string;
 *   refType: string;
 *   packageName: string;
 *   version: string;
 *   repositoryUrl: string;
 *   publishAccess: string;
 *   provenance: boolean;
 *   changelog: string;
 *   headCommit: string;
 *   tagCommit: string;
 *   mainCommit: string;
 * }} candidate
 * @returns {{ distTag: "latest" | "next" }}
 */
export function validateRelease(candidate) {
  if (candidate.refType !== "tag") {
    throw new Error("Release validation must run from a tag ref.");
  }

  const semverMatch = SEMVER.exec(candidate.version);
  if (!semverMatch) {
    throw new Error(
      `package.json version ${JSON.stringify(candidate.version)} is not valid SemVer.`,
    );
  }

  if (candidate.packageName !== "@pbpeterson/typed-fetch") {
    throw new Error("The package name must remain @pbpeterson/typed-fetch.");
  }
  if (candidate.repositoryUrl !== "git+https://github.com/pbpeterson/typed-fetch.git") {
    throw new Error("The repository URL must remain the exact public GitHub provenance source.");
  }
  if (candidate.publishAccess !== "public") {
    throw new Error("publishConfig.access must be public.");
  }
  if (candidate.provenance !== true) {
    throw new Error("publishConfig.provenance must be true.");
  }

  const expectedTag = `v${candidate.version}`;
  if (candidate.tag !== expectedTag) {
    throw new Error(
      `Git tag ${JSON.stringify(candidate.tag)} must exactly match package version (${expectedTag}).`,
    );
  }

  if (candidate.tagCommit !== candidate.headCommit) {
    throw new Error(`Tag ${candidate.tag} does not point at HEAD.`);
  }

  if (candidate.mainCommit !== candidate.headCommit) {
    throw new Error("The tagged commit must be the current origin/main tip.");
  }

  const releaseHeading = new RegExp(
    `^## \\[${escapeRegex(candidate.version)}\\] - (\\d{4}-\\d{2}-\\d{2})$`,
    "m",
  ).exec(candidate.changelog);
  if (!releaseHeading) {
    throw new Error(`Version ${candidate.version} needs a dated CHANGELOG release heading.`);
  }
  if (!isCalendarDate(releaseHeading[1])) {
    throw new Error(`Version ${candidate.version} needs a valid calendar date in CHANGELOG.md.`);
  }

  const unreleasedHeading = /^## \[Unreleased\]\s*$/m.exec(candidate.changelog);
  if (!unreleasedHeading) {
    throw new Error("CHANGELOG.md must retain an [Unreleased] heading.");
  }
  const unreleasedStart = unreleasedHeading.index + unreleasedHeading[0].length;
  const nextHeadingOffset = candidate.changelog.slice(unreleasedStart).search(/^## /m);
  const unreleasedEnd =
    nextHeadingOffset === -1 ? candidate.changelog.length : unreleasedStart + nextHeadingOffset;
  if (candidate.changelog.slice(unreleasedStart, unreleasedEnd).trim() !== "") {
    throw new Error("The CHANGELOG [Unreleased] section must be empty before publishing.");
  }

  // The footer reference definitions, for THIS version only.
  //
  // The dated heading above proves the section exists; it proves nothing about
  // the link the heading resolves through. A release that moved the entries and
  // left the footer alone shipped `[1.1.0]` and
  // `compare/v1.1.0...HEAD` against a tag that was never pushed, so both links
  // 404 and the changelog claims a publication that never happened. No other
  // gate reads the footer: `check-doc-style` scans README links only, and
  // `check-docs` compiles fenced TypeScript.
  //
  // This is inside the SAME scope the rest of this function has, which is why
  // it belongs here and the `Symbol.for` rule (RELEASING.md, semver rule 7)
  // does not. Both rules are policy, but that one needs a diff against the
  // previously released `src/`, and these two facts are decided from the
  // version string, the repository URL, and the changelog text — every one of
  // them already in `candidate`.
  //
  // The base of each range is deliberately NOT checked. This function cannot
  // see the previous version, and inventing one from the changelog would make
  // it a second source of truth for release history.
  const compareBase = `${candidate.repositoryUrl.replace(/^git\+/, "").replace(/\.git$/, "")}/compare`;

  const versionLink = new RegExp(
    `^\\[${escapeRegex(candidate.version)}\\]:[ \\t]*(\\S+)[ \\t]*$`,
    "m",
  ).exec(candidate.changelog);
  if (!versionLink) {
    throw new Error(`CHANGELOG.md needs a [${candidate.version}] link definition in the footer.`);
  }
  if (
    !versionLink[1].startsWith(`${compareBase}/`) ||
    !versionLink[1].endsWith(`...v${candidate.version}`)
  ) {
    throw new Error(
      `The CHANGELOG [${candidate.version}] link must be a ${compareBase}/ range ending at v${candidate.version}.`,
    );
  }

  const expectedUnreleasedLink = `${compareBase}/v${candidate.version}...HEAD`;
  const unreleasedLink = /^\[Unreleased\]:[ \t]*(\S+)[ \t]*$/m.exec(candidate.changelog);
  if (!unreleasedLink || unreleasedLink[1] !== expectedUnreleasedLink) {
    throw new Error(`The CHANGELOG [Unreleased] link must be ${expectedUnreleasedLink}.`);
  }

  return { distTag: semverMatch[4] === undefined ? "latest" : "next" };
}

/**
 * @param {string} ref
 * @param {MainIo} io
 */
function gitCommit(ref, io) {
  return io.git(["rev-parse", "--verify", ref]);
}

/**
 * @internal Exported for the entry-point spec. Not a public interface.
 * @param {MainIo} [io]
 */
export function main(io = defaultIo) {
  try {
    const packageJson = JSON.parse(readFileSync(join(io.cwd, "package.json"), "utf8"));
    const tag = io.env.GITHUB_REF_NAME ?? "";
    const result = validateRelease({
      tag,
      refType: io.env.GITHUB_REF_TYPE ?? "",
      packageName: packageJson.name,
      version: packageJson.version,
      repositoryUrl: packageJson.repository?.url,
      publishAccess: packageJson.publishConfig?.access,
      provenance: packageJson.publishConfig?.provenance,
      changelog: readFileSync(join(io.cwd, "CHANGELOG.md"), "utf8"),
      headCommit: gitCommit("HEAD", io),
      tagCommit: gitCommit(`refs/tags/${tag}^{commit}`, io),
      mainCommit: gitCommit("origin/main", io),
    });

    const outputFile = io.env.GITHUB_OUTPUT;
    if (outputFile) appendFileSync(outputFile, `dist_tag=${result.distTag}\n`);
    io.out(
      `✔ validate-release: ${tag} matches package.json and CHANGELOG.md at the origin/main tip; npm dist-tag=${result.distTag}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.err(`✖ validate-release: ${message}`);
    io.exit(1);
  }
}

// Importing this module must do nothing at all; only
// `node scripts/validate-release.mjs` runs the gate. isMainModule resolves
// symlinks on both sides — a lexical comparison makes this gate exit 0 in
// silence whenever a symlink sits in the invocation path, and this gate is the
// only check between a tag and `npm publish`.
if (isMainModule(import.meta.url)) main();
