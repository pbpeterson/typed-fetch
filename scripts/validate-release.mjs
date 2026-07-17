#!/usr/bin/env node
// @ts-check

import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

/** @param {string} value */
function escapeRegex(value) {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

  if (!SEMVER.test(candidate.version)) {
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
    `^## \\[${escapeRegex(candidate.version)}\\] - \\d{4}-\\d{2}-\\d{2}$`,
    "m",
  );
  if (!releaseHeading.test(candidate.changelog)) {
    throw new Error(`Version ${candidate.version} needs a dated CHANGELOG release heading.`);
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

  return { distTag: candidate.version.includes("-") ? "next" : "latest" };
}

/** @param {string} ref */
function gitCommit(ref) {
  return execFileSync("git", ["rev-parse", "--verify", ref], { encoding: "utf8" }).trim();
}

function main() {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const tag = process.env.GITHUB_REF_NAME ?? "";
  const result = validateRelease({
    tag,
    refType: process.env.GITHUB_REF_TYPE ?? "",
    packageName: packageJson.name,
    version: packageJson.version,
    repositoryUrl: packageJson.repository?.url,
    publishAccess: packageJson.publishConfig?.access,
    provenance: packageJson.publishConfig?.provenance,
    changelog: readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8"),
    headCommit: gitCommit("HEAD"),
    tagCommit: gitCommit(`refs/tags/${tag}^{commit}`),
    mainCommit: gitCommit("origin/main"),
  });

  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) appendFileSync(outputFile, `dist_tag=${result.distTag}\n`);
  console.log(
    `✔ validate-release: ${tag} matches package.json and CHANGELOG.md at the origin/main tip; npm dist-tag=${result.distTag}`,
  );
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`✖ validate-release: ${message}`);
    process.exitCode = 1;
  }
}
