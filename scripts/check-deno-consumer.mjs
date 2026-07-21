#!/usr/bin/env node
// @ts-check

// Pack and install the library into a throwaway package.json project, then ask
// Deno to typecheck a real bare-package import. The runtime smoke imports the
// built .mjs directly and therefore cannot prove that Deno follows the
// package's exports map to its published .d.mts declarations.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workDir = mkdtempSync(join(tmpdir(), "typed-fetch-deno-consumer-"));
const npmEnvironment = { ...process.env };

for (const key of Object.keys(npmEnvironment)) {
  if (key.toLowerCase().startsWith("npm_config_")) delete npmEnvironment[key];
}

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
  const rawPack = execFileSync("npm", ["pack", "--json", "--pack-destination", workDir], {
    cwd: repoRoot,
    encoding: "utf8",
    env: npmEnvironment,
    stdio: ["ignore", "pipe", "inherit"],
  });
  const packResult = JSON.parse(rawPack);
  const packed = Array.isArray(packResult) ? packResult[0] : packResult;
  if (!packed?.filename) throw new Error("npm pack did not report a tarball filename");

  writeFileSync(
    join(workDir, "package.json"),
    JSON.stringify({ private: true, type: "module" }, null, 2),
  );
  execFileSync(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--no-package-lock",
      join(workDir, packed.filename),
    ],
    { cwd: workDir, env: npmEnvironment, stdio: "inherit" },
  );
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
  const nodeModulesMode = denoMajor >= 2 ? "--node-modules-dir=manual" : "--node-modules-dir=true";
  execFileSync("deno", ["check", nodeModulesMode, "consumer.ts"], {
    cwd: workDir,
    stdio: "inherit",
  });

  console.log(
    `deno consumer: OK (${installedPackage.name}@${installedPackage.version}, published types loaded)`,
  );
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
