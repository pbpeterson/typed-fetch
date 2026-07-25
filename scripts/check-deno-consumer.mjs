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

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// The `finally` below is not enough on its own: it does NOT run when the process
// dies from SIGINT, so Ctrl-C during `npm install` or `deno check` — the two
// slow steps a human actually interrupts — used to leak this directory every
// time. createScratchDir also cleans up on signals.
const scratch = createScratchDir("typed-fetch-deno-consumer-");
const workDir = scratch.path;

const consumer = `
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
    stdio: "inherit",
  });
  writeFileSync(join(workDir, "consumer.ts"), consumer);

  const installedPackage = JSON.parse(
    readFileSync(
      join(workDir, "node_modules", "@pbpeterson", "typed-fetch", "package.json"),
      "utf8",
    ),
  );
  // npm records a tarball install as `file:...`; Deno's package.json resolver
  // expects a registry-style version even in manual node_modules mode. Rewrite
  // only the scratch manifest after installation—the package in node_modules
  // remains the just-packed local artifact.
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

  const denoVersion = execFileSync("deno", ["--version"], { encoding: "utf8" });
  const denoMajor = Number.parseInt(/deno (\d+)/.exec(denoVersion)?.[1] ?? "0", 10);
  if (denoMajor < 2) {
    throw new Error(
      "check-deno-consumer requires Deno 2 or later so it can resolve the unpublished local tarball from node_modules.",
    );
  }
  execFileSync("deno", ["check", "--node-modules-dir=manual", "consumer.ts"], {
    cwd: workDir,
    stdio: "inherit",
  });

  console.log(
    `deno consumer: OK (${installedPackage.name}@${installedPackage.version}, published types loaded)`,
  );
} finally {
  scratch.dispose();
}
