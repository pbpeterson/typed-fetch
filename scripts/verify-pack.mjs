#!/usr/bin/env node
// Release gate: verify the published tarball's file MANIFEST.
//
// This checks the tarball's file manifest. It does NOT verify file contents —
// the API-surface snapshot test does that (it imports `dist/index.mjs` and
// asserts the export set against a committed snapshot), and release.yml runs it
// first. This script owns exactly one axis: which files end up in the tarball.
//
// `npm publish` obeys the `files` allow-list in package.json. Two ways that can
// go wrong, both invisible at publish time (npm exits 0 either way):
//   1. `dist/` is missing (build skipped, `prepublishOnly` didn't fire) — npm
//      SILENTLY omits it and ships a code-less tarball. A user's install then
//      resolves to a package with no code.
//   2. Something LEAKS in — `src/`, tests, snapshots, scripts, or tsconfig —
//      bloating the tarball and shipping source/internal files consumers
//      should never receive.
//
// So this runs `npm pack --dry-run --json`, inspects the exact file list that
// WOULD be published, and fails loudly if the manifest is wrong: a required
// file is absent, LICENSE/README.md is missing, or ANY packed path is not on
// the allow-list below.
// Zero dependencies on purpose: the package ships no runtime deps and must not
// grow a dev dep for a release guard.

import { execFileSync } from "node:child_process";
import { isMainModule } from "./lib/is-main-module.mjs";
// The pack manifest must be deterministic and owes nothing to the shell that
// happens to be running it; NPM_ENV drops pnpm's forwarded npm_config_* keys.
// See scripts/lib/npm-pack.mjs for why all three npm-calling gates need this.
import { NPM_ENV } from "./lib/npm-pack.mjs";

// Compiled entry points that MUST be in every published tarball. These back the
// `main`, `module`, `types` and `exports` fields in package.json — if any is
// missing, the package is broken for some consumer (CJS, ESM, or types).
const REQUIRED_DIST_FILES = [
  "dist/index.js", // main (CJS)
  "dist/index.mjs", // module (ESM)
  "dist/index.d.ts", // require types
  "dist/index.d.mts", // import types
  "dist/errors/index.js", // ./errors (CJS)
  "dist/errors/index.mjs", // ./errors (ESM)
  "dist/errors/index.d.ts", // ./errors require types
  "dist/errors/index.d.mts", // ./errors import types
];

// The node10 redirect stub. `exports` is invisible to resolvers that predate it
// (Jest <=27, webpack 4, Metro <0.72), so `<pkg>/errors` has to be resolvable as
// a DIRECTORY too. This one file is what makes that true; without it the
// `./errors` subpath type-checks and then throws "Cannot find module" at
// runtime. It is hand-written and tracked, NOT emitted by tsup.
const REQUIRED_STUB_FILES = ["errors/package.json"];

// Metadata files consumers rely on. npm always includes package.json; LICENSE
// and README.md must be present for the package page and license to be intact.
const REQUIRED_META_FILES = ["LICENSE", "README.md"];

// ALLOWLIST, not a denylist.
//
// A denylist here was structurally unable to do its job. `files: ["dist"]` means
// the ONLY thing that can ship is `dist/` plus metadata — and the old denylist
// (`src/`, `scripts/`, `__snapshots__/`, `*.spec.ts`, `tsconfig*.json`) covered
// exactly the paths that `files` already excluded, while covering nothing inside
// `dist/`. Proven: `dist/.env`, `dist/index.mjs.map` (whose `sourcesContent`
// re-ships every source file the denylist was written to block), and
// `dist/src/index.ts` all packed with a clean "no leaks" report.
//
// So: every packed path must match one of these. Anything else fails.
const ALLOWED_EXACT = new Set([
  "package.json", // npm always includes it
  "LICENSE",
  "README.md",
  ...REQUIRED_DIST_FILES,
  ...REQUIRED_STUB_FILES,
]);

// tsup emits shared code as `chunk-<HASH>.<js|mjs>` next to the entry points.
// The hash changes per build, so this is the one pattern that cannot be exact.
const ALLOWED_PATTERNS = [/^dist\/chunk-[A-Za-z0-9_-]+\.(?:js|mjs)$/];

// Named for the report, so a failure says WHAT kind of leak it is rather than
// only "not allowed". Checked before the allowlist so the message is specific.
const LEAK_RULES = [
  { label: "dotfile / secret", test: (f) => /(^|\/)\.[^/]+$/.test(f) },
  { label: "sourcemap", test: (f) => f.endsWith(".map") },
  { label: "source directory inside dist", test: (f) => f.startsWith("dist/src/") },
  {
    label: "TypeScript source (not a declaration)",
    test: (f) => f.endsWith(".ts") && !f.endsWith(".d.ts") && !f.endsWith(".d.mts"),
  },
  { label: "test file", test: (f) => /\.(?:spec|test)\.[cm]?[jt]s$/.test(f) },
  { label: "tsconfig", test: (f) => /(^|\/)tsconfig[^/]*\.json$/.test(f) },
  { label: "snapshot directory", test: (f) => /(^|\/)__snapshots__\//.test(f) },
];

// Full build emits exactly 14 files: 8 required entry points + 2 chunks (one
// per format) + the errors/package.json node10 stub + LICENSE + README.md +
// package.json. MIN catches a partial build; MAX catches anything extra that
// the allowlist somehow admits, so a future build change has to be looked at
// rather than absorbed silently.
const MIN_FILE_COUNT = 14;
const MAX_FILE_COUNT = 14;

// ---------------------------------------------------------------------------
// THE DECISION. Pure: plain data in, plain data out, or a thrown Error whose
// message is exactly what the report prints. No fs, no child_process, no
// console, no process.exit — so scripts/verify-pack.spec.mjs can call it with a
// manifest ARRAY instead of synthesising a package on disk. Three of the checks
// below are unreachable from an on-disk fixture at any price (see the spec).
//
// Exported for the spec only. scripts/ never ships: package.json
// `files: ["dist"]` excludes it, which this very gate asserts.
// ---------------------------------------------------------------------------

/**
 * Normalise a `tar -tzf` listing of a STAGED tarball into the two facts the
 * policy needs.
 *
 * The dry-run manifest below answers "what would npm pack right now". This one
 * answers "what is in the file that will be published", and only the second is
 * the artifact. They came apart once already: the release workflow validated a
 * dry run and then uploaded a tarball nothing had inspected.
 *
 * @param {string} listing the stdout of `tar -tzf <tarball>`
 * @returns {{ files: string[], fileCount: number }}
 */
export function readTarballManifest(listing) {
  const files = listing
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    // A tar listing can carry directory entries. They are not published files.
    .filter((entry) => !entry.endsWith("/"))
    // npm writes every entry under a `package/` root. Strip it, so the policy
    // above sees the same paths `npm pack --json` reports. An entry WITHOUT the
    // root is left alone and fails the allow-list, which is the correct answer:
    // nothing else belongs in a package tarball.
    .map((entry) => (entry.startsWith("package/") ? entry.slice("package/".length) : entry));
  if (files.length === 0) {
    throw new Error("the staged tarball contains no files to inspect.");
  }
  return { files, fileCount: files.length };
}

/**
 * Normalise the payload of `npm pack --dry-run --json` into the two facts the
 * policy needs. npm reports a one-element array; older shapes reported the
 * object directly.
 *
 * @param {any} parsed
 * @returns {{ files: string[], fileCount: number }}
 */
export function readPackManifest(parsed) {
  const pkg = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!pkg || !Array.isArray(pkg.files)) {
    throw new Error("`npm pack` output had no file list to inspect.");
  }
  const files = pkg.files.map((f) => f.path);
  return {
    files,
    fileCount: typeof pkg.entryCount === "number" ? pkg.entryCount : files.length,
  };
}

/**
 * The entire published-tarball manifest policy, as a pure function.
 *
 * Fail-fast, exactly like the script this was extracted from: it throws on the
 * FIRST violation and the message is verbatim what `fail()` prints. The four
 * checks stay in their original order — the order IS the contract (a partial
 * build must report the missing entry point, not a file count).
 *
 * @param {string[]} packedFiles every path `npm pack` would ship
 * @param {number} [fileCount] npm's own entryCount; defaults to packedFiles.length
 * @returns {{ fileCount: number }}
 */
export function verifyPackManifest(packedFiles, fileCount = packedFiles.length) {
  const packedSet = new Set(packedFiles);

  // 1. Required compiled entry points present.
  const missingDist = REQUIRED_DIST_FILES.filter((f) => !packedSet.has(f));
  if (missingDist.length > 0) {
    throw new Error(
      `tarball is missing required compiled file(s):\n    - ${missingDist.join("\n    - ")}`,
    );
  }

  // 2a. The node10 redirect stub must ship. It is tracked, not built, so the
  //     way it goes missing is an edit to `files` — exactly what this catches.
  const missingStub = REQUIRED_STUB_FILES.filter((f) => !packedSet.has(f));
  if (missingStub.length > 0) {
    throw new Error(
      "tarball is missing the node10 redirect stub(s):\n" +
        `    - ${missingStub.join("\n    - ")}\n` +
        "Without it the `./errors` subpath is unresolvable for any consumer whose " +
        "resolver ignores `exports` (Jest <=27, webpack 4, Metro <0.72). Check the " +
        "`files` allow-list in package.json.",
    );
  }

  // 2. Required metadata files present.
  const missingMeta = REQUIRED_META_FILES.filter((f) => !packedSet.has(f));
  if (missingMeta.length > 0) {
    throw new Error(
      `tarball is missing required metadata file(s):\n    - ${missingMeta.join("\n    - ")}`,
    );
  }

  // 3. Every packed path must be on the allowlist. Known leak shapes are named
  //    explicitly so the failure explains itself.
  const leaked = [];
  for (const f of packedFiles) {
    const rule = LEAK_RULES.find((r) => r.test(f));
    if (rule) {
      leaked.push(`${f}  (${rule.label})`);
      continue;
    }
    if (ALLOWED_EXACT.has(f)) continue;
    if (ALLOWED_PATTERNS.some((re) => re.test(f))) continue;
    leaked.push(`${f}  (not on the allow-list)`);
  }
  if (leaked.length > 0) {
    throw new Error(
      "tarball would ship file(s) that are not part of the published artifact:\n" +
        `    - ${leaked.join("\n    - ")}\n` +
        "Clean dist/ and rebuild (`pnpm build` runs tsup with clean:true). If a new " +
        "file genuinely belongs in the artifact, add it to ALLOWED_EXACT/ALLOWED_PATTERNS " +
        "here and bump MAX_FILE_COUNT deliberately.",
    );
  }

  // 4. Sanity-check the overall file count. A sourcemap or a stray dotfile is
  //    caught above; this catches a partial build (too few) and anything the
  //    allow-list admits that nobody looked at (too many).
  if (fileCount < MIN_FILE_COUNT) {
    throw new Error(
      `tarball has ${fileCount} file(s), expected at least ${MIN_FILE_COUNT}. ` +
        "Build output looks incomplete.",
    );
  }
  if (fileCount > MAX_FILE_COUNT) {
    throw new Error(
      `tarball has ${fileCount} file(s), expected at most ${MAX_FILE_COUNT}:\n` +
        `    - ${packedFiles.join("\n    - ")}\n` +
        "Something new is shipping. Confirm it belongs, then bump MAX_FILE_COUNT.",
    );
  }

  return { fileCount };
}

// ---------------------------------------------------------------------------
// Adapter + thin main. Everything below this line touches the world.
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   argv: string[],
 *   cwd: string,
 *   out: (msg: string) => void,
 *   err: (msg: string) => void,
 *   exit: (code: number) => void,
 *   execFileSync: typeof execFileSync,
 * }} MainIo
 */

/**
 * The real world this gate runs against. `execFileSync` is the one shell-out
 * this gate makes (`tar`, `npm pack`), named so a test can answer for it
 * without a real tarball or a real npm.
 *
 * @internal Exported for the entry-point spec. Not a public interface.
 * @type {MainIo}
 */
export const defaultIo = {
  argv: process.argv,
  cwd: process.cwd(),
  out: (msg) => console.log(msg),
  err: (msg) => console.error(msg),
  exit: (code) => process.exit(code),
  execFileSync,
};

/**
 * @internal Exported for the entry-point spec. Not a public interface.
 * @param {string} message
 * @param {MainIo} io
 */
export function fail(message, io) {
  io.err(`\n✖ verify-pack: ${message}\n`);
  io.err(
    "The published tarball manifest is wrong. Refusing to publish.\n" +
      "Run `pnpm build` and check the `files` allow-list in package.json.\n",
  );
  io.exit(1);
}

/**
 * The manifest of the staged tarball at `tarballPath`.
 * @internal Exported for the entry-point spec. Not a public interface.
 * @param {string} tarballPath
 * @param {MainIo} io
 * @returns {{ files: string[], fileCount: number } | null} `null` when
 *   `fail` already reported the problem and asked to exit.
 */
export function stagedManifest(tarballPath, io) {
  let listing;
  try {
    listing = io.execFileSync("tar", ["-tzf", tarballPath], {
      encoding: "utf8",
      cwd: io.cwd,
      stdio: ["ignore", "pipe", "inherit"],
    });
  } catch (err) {
    fail(`\`tar -tzf ${tarballPath}\` failed to run: ${err.message}`, io);
    return null;
  }
  return readTarballManifest(listing);
}

/**
 * The manifest `npm pack` would produce from the working tree right now.
 * @internal Exported for the entry-point spec. Not a public interface.
 * @param {MainIo} io
 * @returns {{ files: string[], fileCount: number } | null} `null` when
 *   `fail` already reported the problem and asked to exit.
 */
export function dryRunManifest(io) {
  let raw;
  try {
    raw = io.execFileSync("npm", ["pack", "--dry-run", "--json"], {
      encoding: "utf8",
      cwd: io.cwd,
      env: NPM_ENV,
      stdio: ["ignore", "pipe", "inherit"],
    });
  } catch (err) {
    fail(`\`npm pack --dry-run --json\` failed to run: ${err.message}`, io);
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    fail(`could not parse \`npm pack\` JSON output: ${err.message}`, io);
    return null;
  }
  return readPackManifest(parsed);
}

/**
 * @internal Exported for the entry-point spec. Not a public interface.
 * @param {MainIo} [io]
 */
export function main(io = defaultIo) {
  // With a path, inspect THAT file. Without one, inspect what a pack would
  // produce now. The release workflow uses both: the dry run as an early gate,
  // and the staged file as the last word before it is uploaded.
  const tarballPath = io.argv[2];
  const source = tarballPath ? `staged tarball ${tarballPath}` : "dry-run manifest";

  let fileCount;
  try {
    const manifest = tarballPath ? stagedManifest(tarballPath, io) : dryRunManifest(io);
    if (manifest === null) return; // fail() already reported the problem and exited.
    ({ fileCount } = verifyPackManifest(manifest.files, manifest.fileCount));
  } catch (err) {
    // Note: a genuine bug in the decision (say a TypeError) is also reported as
    // a manifest failure rather than as a stack trace. Both exit 1, so no
    // release is corrupted, but an incident gets a misleading first line.
    // validate-release.mjs has the identical wart; fixing both together with a
    // marker Error subclass is a separate, deliberate change.
    fail(err.message, io);
    return;
  }

  io.out(
    `✔ verify-pack: ${source} OK — ${fileCount} files; ` +
      `all ${REQUIRED_DIST_FILES.length} required entry points + LICENSE/README present, ` +
      "every packed path on the allow-list.",
  );
  for (const f of [...REQUIRED_DIST_FILES, ...REQUIRED_META_FILES, ...REQUIRED_STUB_FILES]) {
    io.out(`    ✓ ${f}`);
  }
}

// Importing this module must do nothing at all; only `node scripts/verify-pack.mjs`
// runs the gate. The end-to-end tests in the spec exist to prove this guard has
// not come undone — a disconnected main() would make the gate exit 0 in silence.
if (isMainModule(import.meta.url)) main();
