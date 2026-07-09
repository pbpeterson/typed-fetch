#!/usr/bin/env node
// Defense in depth for the release pipeline.
//
// `npm publish` obeys the `files` allow-list in package.json. If `dist/` is
// missing (e.g. the build step was skipped or `prepublishOnly` stopped firing),
// npm SILENTLY omits the entry and publishes a code-less tarball — LICENSE,
// README.md and package.json only — while exiting 0. That is worse than a
// failed publish because it is invisible until a user's install resolves to a
// package with no code.
//
// This script runs `npm pack --dry-run --json`, inspects the exact file list
// that WOULD be published, and fails loudly if the compiled entry points are
// absent. Zero dependencies on purpose: the package ships no runtime deps and
// must not grow a dev dep for a release guard.

import { execFileSync } from "node:child_process";

// Compiled entry points that MUST be in every published tarball. These back the
// `main`, `module`, `types` and `exports` fields in package.json — if any is
// missing, the package is broken for some consumer (CJS, ESM, or types).
const REQUIRED_FILES = [
  "dist/index.js", // main (CJS)
  "dist/index.mjs", // module (ESM)
  "dist/index.d.ts", // types
  "dist/errors/index.js", // ./errors (CJS)
  "dist/errors/index.mjs", // ./errors (ESM)
];

// Full build currently emits 13 files. A count below this means dist is
// partially built or something silently dropped out of the tarball.
const MIN_FILE_COUNT = 13;

function fail(message) {
  console.error(`\n✖ verify-pack: ${message}\n`);
  console.error(
    "The published tarball would be missing compiled code. Refusing to publish.\n" +
      "Run `pnpm build` and ensure `dist/` is populated before releasing.\n",
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

const missing = REQUIRED_FILES.filter((f) => !packedSet.has(f));
if (missing.length > 0) {
  fail(`tarball is missing required compiled file(s):\n    - ${missing.join("\n    - ")}`);
}

// `entryCount` is npm's own count; fall back to the file list length.
const fileCount = typeof pkg.entryCount === "number" ? pkg.entryCount : packedFiles.length;
if (fileCount < MIN_FILE_COUNT) {
  fail(
    `tarball has ${fileCount} file(s), expected at least ${MIN_FILE_COUNT}. ` +
      "Build output looks incomplete.",
  );
}

console.log(
  `✔ verify-pack: tarball OK — ${fileCount} files, all ${REQUIRED_FILES.length} required entry points present.`,
);
for (const f of REQUIRED_FILES) {
  console.log(`    ✓ ${f}`);
}
