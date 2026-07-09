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
// file is absent, a forbidden path leaked in, or LICENSE/README.md is missing.
// Zero dependencies on purpose: the package ships no runtime deps and must not
// grow a dev dep for a release guard.

import { execFileSync } from "node:child_process";

// Compiled entry points that MUST be in every published tarball. These back the
// `main`, `module`, `types` and `exports` fields in package.json — if any is
// missing, the package is broken for some consumer (CJS, ESM, or types).
const REQUIRED_DIST_FILES = [
  "dist/index.js", // main (CJS)
  "dist/index.mjs", // module (ESM)
  "dist/index.d.ts", // types
  "dist/errors/index.js", // ./errors (CJS)
  "dist/errors/index.mjs", // ./errors (ESM)
];

// Metadata files consumers rely on. npm always includes package.json; LICENSE
// and README.md must be present for the package page and license to be intact.
const REQUIRED_META_FILES = ["LICENSE", "README.md"];

// Nothing outside dist/ (plus the metadata files above) belongs in the tarball.
// A leak here means source, tests, or config would ship to consumers. Matched
// as path prefixes / exact paths against the packed file list.
const FORBIDDEN_PREFIXES = ["src/", "scripts/", "__snapshots__/"];
const FORBIDDEN_EXACT = [
  "test.spec.ts",
  "PLAN.md",
  "tsconfig.json",
  "tsconfig.test.json",
  "tsup.config.ts",
];
// Any file matching these patterns is a leak regardless of directory.
const FORBIDDEN_PATTERNS = [
  /\.spec\.ts$/, // test files
  /\.test\.ts$/, // test files
  /(^|\/)tsconfig[^/]*\.json$/, // tsconfig.json, tsconfig.test.json, etc.
  /(^|\/)__snapshots__\//, // snapshot dirs at any depth
];

// Full build currently emits 13 files. A count below this means dist is
// partially built or something silently dropped out of the tarball.
const MIN_FILE_COUNT = 13;

function fail(message) {
  console.error(`\n✖ verify-pack: ${message}\n`);
  console.error(
    "The published tarball manifest is wrong. Refusing to publish.\n" +
      "Run `pnpm build` and check the `files` allow-list in package.json.\n",
  );
  process.exit(1);
}

let raw;
try {
  raw = execFileSync("npm", ["pack", "--dry-run", "--json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
} catch (err) {
  fail(`\`npm pack --dry-run --json\` failed to run: ${err.message}`);
}

let parsed;
try {
  parsed = JSON.parse(raw);
} catch (err) {
  fail(`could not parse \`npm pack\` JSON output: ${err.message}`);
}

const pkg = Array.isArray(parsed) ? parsed[0] : parsed;
if (!pkg || !Array.isArray(pkg.files)) {
  fail("`npm pack` output had no file list to inspect.");
}

const packedFiles = pkg.files.map((f) => f.path);
const packedSet = new Set(packedFiles);

// 1. Required compiled entry points present.
const missingDist = REQUIRED_DIST_FILES.filter((f) => !packedSet.has(f));
if (missingDist.length > 0) {
  fail(`tarball is missing required compiled file(s):\n    - ${missingDist.join("\n    - ")}`);
}

// 2. Required metadata files present.
const missingMeta = REQUIRED_META_FILES.filter((f) => !packedSet.has(f));
if (missingMeta.length > 0) {
  fail(`tarball is missing required metadata file(s):\n    - ${missingMeta.join("\n    - ")}`);
}

// 3. No forbidden source/test/config files leaked in.
const leaked = packedFiles.filter(
  (f) =>
    FORBIDDEN_PREFIXES.some((p) => f.startsWith(p)) ||
    FORBIDDEN_EXACT.includes(f) ||
    FORBIDDEN_PATTERNS.some((re) => re.test(f)),
);
if (leaked.length > 0) {
  fail(
    "tarball would ship source/internal file(s) that must never be published:\n" +
      `    - ${leaked.join("\n    - ")}\n` +
      "Tighten the `files` allow-list in package.json (it should be `dist` only).",
  );
}

// 4. Sanity-check the overall file count.
const fileCount = typeof pkg.entryCount === "number" ? pkg.entryCount : packedFiles.length;
if (fileCount < MIN_FILE_COUNT) {
  fail(
    `tarball has ${fileCount} file(s), expected at least ${MIN_FILE_COUNT}. ` +
      "Build output looks incomplete.",
  );
}

console.log(
  `✔ verify-pack: manifest OK — ${fileCount} files; ` +
    `all ${REQUIRED_DIST_FILES.length} required entry points + LICENSE/README present, no leaks.`,
);
for (const f of [...REQUIRED_DIST_FILES, ...REQUIRED_META_FILES]) {
  console.log(`    ✓ ${f}`);
}
