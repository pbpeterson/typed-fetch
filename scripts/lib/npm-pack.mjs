// @ts-check

// ---------------------------------------------------------------------------
// npm-pack.mjs — pack the repo into a tarball and install it somewhere.
//
// WHY THIS EXISTS
//   Three release gates shell out to npm, and each one had independently
//   rediscovered the same two traps:
//
//   1. THE ENVIRONMENT MUST BE SCRUBBED. pnpm forwards its own configuration to
//      lifecycle scripts as `npm_config_*` variables, and newer npm versions
//      warn about the pnpm-only keys. The scrub loop was copied verbatim into
//      verify-pack.mjs, check-consumer.mjs and check-deno-consumer.mjs. A pack
//      manifest has to be deterministic and owes nothing to whoever's shell
//      happens to be running it.
//
//   2. NPM'S REPORTED FILENAME IS NOT THE FILE IT WROTE. `npm pack --json`
//      reports a `filename` field, and npm 8 reported the scope-PREFIXED name
//      (`@pbpeterson/typed-fetch-1.0.0.tgz`) while writing the scope-STRIPPED
//      one (`pbpeterson-typed-fetch-1.0.0.tgz`). Trusting the report gives an
//      ENOENT on a path that npm itself told you about. check-consumer.mjs had
//      already learned this and read the directory back; check-deno-consumer.mjs
//      had not, and was one npm upgrade away from breaking.
//
//   So: pack by READING THE DESTINATION BACK, and require exactly one .tgz
//   there. "Exactly one" is the check that matters — a leftover tarball from an
//   earlier run would otherwise be silently installed instead of the artifact
//   under test, and the gate would happily pass against last week's build.
//
// Zero dependencies on purpose — node: builtins only, like every release gate.
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Copy an environment without pnpm's `npm_config_*` forwarding.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {NodeJS.ProcessEnv}
 */
export function stripNpmConfig(env) {
  const scrubbed = { ...env };
  for (const key of Object.keys(scrubbed)) {
    if (key.toLowerCase().startsWith("npm_config_")) delete scrubbed[key];
  }
  return scrubbed;
}

/**
 * The scrubbed environment every nested npm call in this repo should use.
 * Snapshotted at import time, exactly as each gate used to do for itself.
 * @type {NodeJS.ProcessEnv}
 */
export const NPM_ENV = stripNpmConfig(process.env);

/**
 * Pack `packageDir` into `destDir` and return the tarball that actually landed
 * there — never the name npm claims it wrote.
 *
 * @param {string} packageDir the package to pack (the repo root)
 * @param {string} destDir an EMPTY directory to pack into
 * @returns {{ path: string, reported: string | undefined }}
 *   `path` is the tarball on disk; `reported` is npm's own `filename` field,
 *   kept only so a gate can print both and make a future divergence visible.
 */
export function packTarball(packageDir, destDir) {
  const raw = execFileSync("npm", ["pack", "--pack-destination", destDir, "--json"], {
    cwd: packageDir,
    encoding: "utf8",
    env: NPM_ENV,
    stdio: ["ignore", "pipe", "inherit"],
  });
  const meta = JSON.parse(raw);
  const reported = (Array.isArray(meta) ? meta[0] : meta)?.filename;

  // The authoritative answer: what is on disk. See trap 2 above.
  const packed = readdirSync(destDir).filter((f) => f.endsWith(".tgz"));
  if (packed.length !== 1) {
    throw new Error(`expected exactly one .tgz in ${destDir}, found ${packed.join(", ")}`);
  }
  return { path: join(destDir, packed[0]), reported };
}

/**
 * Install a packed tarball into a scratch consumer project.
 *
 * `flags` and `stdio` are parameters because the two consumer gates genuinely
 * differ: the Node gate saves the dependency and swallows npm's chatter, while
 * the Deno gate skips scripts and the lockfile and lets npm's output through to
 * the transcript. Both are deliberate, so both stay callable.
 *
 * @param {string} consumerDir directory holding the consumer's package.json
 * @param {string} tarball absolute path to the .tgz
 * @param {{ flags?: string[], stdio?: any }} [options]
 */
export function installTarball(consumerDir, tarball, options = {}) {
  const { flags = ["--no-audit", "--no-fund"], stdio = ["ignore", "pipe", "inherit"] } = options;
  return execFileSync("npm", ["install", ...flags, tarball], {
    cwd: consumerDir,
    encoding: "utf8",
    env: NPM_ENV,
    stdio,
  });
}
