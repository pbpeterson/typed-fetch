#!/usr/bin/env node
// @ts-check

// Pack and install the library into a throwaway package.json project, then ask
// Deno to typecheck a real bare-package import. The runtime smoke imports the
// built .mjs directly and therefore cannot prove that Deno follows the
// package's exports map to its published .d.mts declarations.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { installTarball, packTarball } from "./lib/npm-pack.mjs";
import { createScratchDir } from "./lib/scratch-dir.mjs";
import { isMainModule } from "./lib/is-main-module.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const DENO_CONSUMER_SOURCE = `
import { isKnownHttpError, typedFetch } from "@pbpeterson/typed-fetch";

type IsAny<T> = 0 extends 1 & T ? true : false;
type ExpectFalse<T extends false> = T;
type TypedFetchMustNotBeAny = ExpectFalse<IsAny<typeof typedFetch>>;

type User = { id: number };

async function checkTypedResponse(): Promise<void> {
  const result = await typedFetch<User>("data:application/json,%7B%22id%22%3A1%7D");
  if (result.error === null) {
    const body: Promise<User> = result.response.json();
    await body;
  }
}

declare const candidate: unknown;
if (isKnownHttpError(candidate)) {
  const status: number = candidate.status;
  void status;
}

void (null as unknown as TypedFetchMustNotBeAny);
void checkTypedResponse;
`;

/**
 * Decide whether the installed Deno can exercise the package contract.
 *
 * @param {string} output
 * @returns {{ major: number }}
 */
export function judgeDenoVersion(output) {
  const match = /(?:^|\n)deno (\d+)(?:\.|\s|$)/.exec(output);
  const major = Number.parseInt(match?.[1] ?? "", 10);
  if (!Number.isInteger(major)) {
    throw new Error("could not read the Deno major version from `deno --version`.");
  }
  if (major < 2) {
    throw new Error(
      "check-deno-consumer requires Deno 2 or later so it can resolve the unpublished local tarball from node_modules.",
    );
  }
  return { major };
}

/**
 * Pack, install, and typecheck one Deno consumer.
 *
 * The subprocess exit is an I/O fact. A nonzero exit throws from this adapter;
 * the version policy lives in {@link judgeDenoVersion}.
 *
 * @param {number} denoMajor
 */
function gatherDenoConsumerFacts(denoMajor) {
  // A `finally` is not enough when the process dies from SIGINT. The two slow
  // subprocesses are exactly where a human interrupts it. This helper also
  // cleans up on signals.
  const scratch = createScratchDir("typed-fetch-deno-consumer-");
  const workDir = scratch.path;
  try {
    // packTarball resolves the tarball by reading workDir back rather than by
    // trusting npm's reported filename — npm 8 reported the scope-prefixed name
    // while writing the scope-stripped one, and this gate used to trust it.
    const { path: tarball } = packTarball(repoRoot, workDir);

    writeFileSync(
      join(workDir, "package.json"),
      JSON.stringify({ private: true, type: "module" }, null, 2),
    );
    installTarball(workDir, tarball, {
      flags: ["--ignore-scripts", "--no-audit", "--no-fund", "--no-package-lock"],
      stdio: ["ignore", "pipe", "pipe"],
    });
    writeFileSync(join(workDir, "consumer.ts"), DENO_CONSUMER_SOURCE);

    const installedPackage = JSON.parse(
      readFileSync(
        join(workDir, "node_modules", "@pbpeterson", "typed-fetch", "package.json"),
        "utf8",
      ),
    );
    // npm records a tarball install as `file:...`; Deno's package.json resolver
    // expects a registry version in manual node_modules mode. Rewrite only the
    // scratch manifest. The installed package remains the packed local artifact.
    writeFileSync(
      join(workDir, "package.json"),
      JSON.stringify(
        {
          private: true,
          type: "module",
          dependencies: { [installedPackage.name]: installedPackage.version },
        },
        null,
        2,
      ),
    );

    execFileSync("deno", ["check", "--node-modules-dir=manual", "consumer.ts"], {
      cwd: workDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

    return {
      denoMajor,
      packageName: installedPackage.name,
      packageVersion: installedPackage.version,
    };
  } finally {
    scratch.dispose();
  }
}

function main() {
  const denoVersion = execFileSync("deno", ["--version"], { encoding: "utf8" });
  const { major } = judgeDenoVersion(denoVersion);
  const facts = gatherDenoConsumerFacts(major);
  console.log(
    `deno consumer: OK with Deno ${facts.denoMajor} ` +
      `(${facts.packageName}@${facts.packageVersion}, published types loaded)`,
  );
}

if (isMainModule(import.meta.url)) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`deno consumer: FAILED — ${message}`);
    process.exitCode = 1;
  }
}
