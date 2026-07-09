#!/usr/bin/env node
// @ts-check

// ---------------------------------------------------------------------------
// check-docs.mjs — typecheck every fenced TypeScript block in the docs against
// the BUILT package (dist/), not against src/.
//
// WHY THIS EXISTS
//   Three rounds of "verify the examples" review never ran `tsc`, and the
//   README's headline example shipped broken from v0.8.1: it read `error.status`
//   on the raw `TypedFetchError` union (which includes `NetworkError`, a class
//   with no `.status`), a TS2339 that no human reader caught. This guard makes
//   that class of bug impossible to miss: it compiles each doc block against the
//   real published type surface (`dist/`) and fails CI listing every bad block
//   by file + fence line.
//
// WHAT IT DOES / DOES NOT CATCH
//   Compilation is NECESSARY, not SUFFICIENT. A block can typecheck and still be
//   semantically wrong. The clearest live example: the maintainer skill's error
//   -class template (see .claude/skills/typed-fetch-maintainer/SKILL.md) omits
//   `override readonly name = "..."`. That compiles fine, but at runtime a
//   minifier can rename the class and the error's `.name` becomes garbage — a
//   real bug this guard will NEVER see. Do not treat a green run here as proof
//   the docs are correct; it only proves they still TYPECHECK against dist/.
//
// RUN ORDER
//   MUST run AFTER `pnpm build`. dist/ is the compile target. If dist/ is
//   missing the guard FAILS LOUDLY (it does NOT skip — a silent skip is exactly
//   how the API-surface snapshot test lets stale-dist bugs through).
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");

// Fixed roster of docs that carry public, copy-pasteable TypeScript.
const DOC_FILES = [
  "README.md",
  "CONTRIBUTING.md",
  "skills/typed-fetch/SKILL.md",
  ".claude/skills/typed-fetch-maintainer/SKILL.md",
];

// The package's public entry points, as written in the docs.
const PKG_ROOT = "@pbpeterson/typed-fetch";
const PKG_ERRORS = "@pbpeterson/typed-fetch/errors";

// Skip convention: a block is skipped ONLY if its opening fence info-string
// carries the `no-check` marker, i.e. ```ts no-check  or  ```typescript no-check
// Every skip is counted and printed so a broken block can never be silenced
// invisibly (see the skip summary + ratio guard at the bottom).
const SKIP_MARKER = "no-check";

// If more than this fraction of TypeScript blocks are skipped, the guard fails:
// the whole point is that examples compile, and a marker that everyone reaches
// for is a marker that rots. Tune deliberately, not to make a red run go green.
const MAX_SKIP_RATIO = 0.5;

/**
 * Extract fenced ts/typescript blocks from markdown.
 * @param {string} md
 * @returns {{ line: number, info: string, code: string, skip: boolean }[]}
 */
function extractBlocks(md) {
  const lines = md.split("\n");
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    // CommonMark fences are runs of >= 3 backticks. Capture the EXACT run so a
    // ````markdown ... ```` wrapper (which legitimately contains a nested
    // ```ts block, e.g. in CONTRIBUTING's own docs) is treated as one opaque
    // block and its inner fences are NOT mis-parsed. The closing fence must be
    // a backtick run of AT LEAST the opening length with no info string.
    const open = lines[i].match(/^(\s*)(`{3,})([^\n`]*)$/);
    if (open) {
      const indent = open[1];
      const fence = open[2];
      const info = open[3].trim();
      const lang = info.split(/\s+/)[0]?.toLowerCase();
      const fenceLine = i + 1; // 1-based line of the opening fence
      const closeRe = new RegExp(`^${indent}\`{${fence.length},}\\s*$`);
      // Find the matching closing fence (>= same length, same indent).
      let j = i + 1;
      const body = [];
      while (j < lines.length && !closeRe.test(lines[j])) {
        body.push(lines[j]);
        j += 1;
      }
      if (lang === "ts" || lang === "typescript") {
        const skip = info.split(/\s+/).slice(1).includes(SKIP_MARKER);
        blocks.push({ line: fenceLine, info, code: body.join("\n"), skip });
      }
      i = j + 1;
    } else {
      i += 1;
    }
  }
  return blocks;
}

/**
 * Rewrite the package specifier to point at the built dist/ so a block is
 * typechecked against the SHIPPED types, not src/.
 * @param {string} code
 * @param {string} distDir absolute path to dist/
 */
function rewriteImports(code, distDir) {
  // Point at the IMPLEMENTATION files (.js), not the .d.ts. With
  // `moduleResolution: bundler`, tsc resolves types from the sibling
  // `index.d.ts` automatically, while value imports (`typedFetch`,
  // `isHttpError`) resolve to real runtime bindings. Importing the `.d.ts`
  // directly trips TS2846 ("a declaration file cannot be imported without
  // import type") and would force us to weaken every value import to a type
  // import — which would stop catching real value-import bugs.
  const rootSpec = JSON.stringify(join(distDir, "index.js").replace(/\\/g, "/"));
  const errorsSpec = JSON.stringify(join(distDir, "errors", "index.js").replace(/\\/g, "/"));
  // Order matters: rewrite the more-specific /errors subpath first.
  return code
    .replaceAll(`"${PKG_ERRORS}"`, errorsSpec)
    .replaceAll(`'${PKG_ERRORS}'`, errorsSpec)
    .replaceAll(`"${PKG_ROOT}"`, rootSpec)
    .replaceAll(`'${PKG_ROOT}'`, rootSpec);
}

function main() {
  const distDir = join(repoRoot, "dist");

  // (c) dist/ may be stale or absent. FAIL LOUDLY — never skip.
  // Require BOTH the implementation (.js) and the types (.d.ts) for each entry
  // point: value imports resolve against the former, type info against the
  // latter. A half-built dist/ must fail, not silently under-check.
  const required = [
    join(distDir, "index.js"),
    join(distDir, "index.d.ts"),
    join(distDir, "errors", "index.js"),
    join(distDir, "errors", "index.d.ts"),
  ];
  const missing = required.filter((p) => !existsSync(p));
  if (missing.length > 0) {
    console.error("check-docs: dist/ is missing or incomplete.");
    for (const p of missing) console.error(`  expected: ${p}`);
    console.error(
      "  Run `pnpm build` first. This guard typechecks docs against the BUILT package.",
    );
    process.exit(1);
  }

  const tscBin = join(
    repoRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "tsc.cmd" : "tsc",
  );
  if (!existsSync(tscBin)) {
    console.error(`check-docs: tsc not found at ${tscBin}. Run \`pnpm install\`.`);
    process.exit(1);
  }

  let totalTsBlocks = 0;
  let checked = 0;
  const skipped = [];
  const failures = [];

  // Scratch tmp dir for the per-block .ts files + a dedicated tsconfig.
  const workDir = mkdtempSync(join(tmpdir(), "typed-fetch-docs-"));

  // (b) TS5112 defence. When you pass files on the command line AND a
  // tsconfig.json exists, tsc refuses to load the config and emits TS5112,
  // masking real errors. We DON'T pass files on the command line: we write a
  // dedicated tsconfig here (its own `include`) and invoke `tsc -p`, which is
  // the config path — no root tsconfig.json is consulted, no TS5112.
  const tsconfig = {
    compilerOptions: {
      // Match the library's public build so blocks see the same lib/types the
      // package ships against.
      target: "ES2022",
      lib: ["ES2022", "DOM", "DOM.Iterable"],
      module: "ESNext",
      moduleResolution: "bundler",
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      types: [],
      // Doc snippets aren't full programs: top-level `await`, unused locals,
      // stray expression statements are all fine and idiomatic in examples.
      // We are checking TYPE CORRECTNESS of the public API usage, not lint.
      noUnusedLocals: false,
      noUnusedParameters: false,
      allowUnreachableCode: true,
    },
    include: ["blocks/**/*.ts"],
  };
  writeFileSync(join(workDir, "tsconfig.json"), JSON.stringify(tsconfig, null, 2));

  // Map "blocks/<name>.ts" -> { file, line } for error attribution.
  const blockIndex = new Map();

  const blocksDir = join(workDir, "blocks");
  mkdirSync(blocksDir, { recursive: true });

  for (const rel of DOC_FILES) {
    const abs = join(repoRoot, rel);
    if (!existsSync(abs)) {
      console.error(`check-docs: doc file not found: ${rel}`);
      process.exit(1);
    }
    const md = readFileSync(abs, "utf8");
    const blocks = extractBlocks(md);
    for (const block of blocks) {
      totalTsBlocks += 1;
      if (block.skip) {
        skipped.push({ file: rel, line: block.line });
        continue;
      }
      const name = `${rel.replace(/[^a-zA-Z0-9]/g, "_")}__L${block.line}`;
      const wrapped = wrapBlock(rewriteImports(block.code, distDir));
      writeFileSync(join(blocksDir, `${name}.ts`), wrapped);
      blockIndex.set(name, { file: rel, line: block.line });
      checked += 1;
    }
  }

  // Run tsc ONCE over all block files via the scratch tsconfig.
  let tscOutput = "";
  let tscFailed = false;
  try {
    execFileSync(tscBin, ["--noEmit", "-p", join(workDir, "tsconfig.json")], {
      cwd: workDir,
      stdio: "pipe",
      encoding: "utf8",
    });
  } catch (err) {
    tscFailed = true;
    tscOutput = `${err.stdout ?? ""}${err.stderr ?? ""}`;
  }

  if (tscFailed) {
    // Attribute each diagnostic line back to its doc file + fence line.
    // tsc prints e.g.  blocks/README_md__L13.ts(4,20): error TS2339: ...
    const seen = new Set();
    for (const rawLine of tscOutput.split("\n")) {
      const m = rawLine.match(/blocks\/([A-Za-z0-9_]+)\.ts\((\d+),(\d+)\): (error TS\d+.*)$/);
      if (!m) continue;
      const info = blockIndex.get(m[1]);
      if (!info) continue;
      const key = `${m[1]}:${m[2]}:${m[3]}:${m[4]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      failures.push({ file: info.file, line: info.line, msg: m[4] });
    }
    // TS5112 must never appear — if it does, our config strategy regressed.
    if (/TS5112/.test(tscOutput)) {
      console.error("check-docs: tsc emitted TS5112 (root tsconfig leaked in). This masks real");
      console.error("  errors and is a bug in this script. Aborting.\n");
      console.error(tscOutput);
      process.exit(1);
    }
    // If tsc failed but we could not attribute a single diagnostic, surface raw
    // output rather than silently "passing".
    if (failures.length === 0) {
      console.error("check-docs: tsc failed but no block diagnostics were parsed. Raw output:\n");
      console.error(tscOutput);
      rmSync(workDir, { recursive: true, force: true });
      process.exit(1);
    }
  }

  rmSync(workDir, { recursive: true, force: true });

  // ----- Report -----------------------------------------------------------
  console.log(`check-docs: scanned ${DOC_FILES.length} doc files`);
  console.log(`  TypeScript blocks found : ${totalTsBlocks}`);
  console.log(`  checked against dist/    : ${checked}`);
  console.log(`  skipped (\`${SKIP_MARKER}\`)      : ${skipped.length}`);

  if (skipped.length > 0) {
    console.log("\n  Skipped blocks (must be fragments/templates that cannot compile standalone):");
    for (const s of skipped) {
      console.log(`    - ${s.file}:${s.line}`);
    }
  }

  const skipRatio = totalTsBlocks === 0 ? 0 : skipped.length / totalTsBlocks;

  if (failures.length > 0) {
    console.error(`\ncheck-docs: ${failures.length} documentation block(s) FAILED to typecheck:\n`);
    for (const f of failures) {
      console.error(`  ${f.file} (fence at line ${f.line}): ${f.msg}`);
    }
    console.error("\nFix the doc example, or — only if it is a genuine non-compilable fragment —");
    console.error(`mark its fence \`\`\`ts ${SKIP_MARKER} (see CONTRIBUTING.md).`);
    process.exit(1);
  }

  if (skipRatio > MAX_SKIP_RATIO) {
    console.error(
      `\ncheck-docs: skip ratio ${(skipRatio * 100).toFixed(0)}% exceeds ` +
        `${(MAX_SKIP_RATIO * 100).toFixed(0)}% — too many blocks are marked \`${SKIP_MARKER}\`.`,
    );
    console.error("  The guard only protects blocks it actually compiles. Reduce the skips.");
    process.exit(1);
  }

  console.log(`\ncheck-docs: OK — all ${checked} checked block(s) typecheck against dist/.`);
}

/**
 * Make each block its own ES module. `module: ESNext` + `target: ES2022` allow
 * TOP-LEVEL await, so idiomatic `const { error } = await typedFetch(...)`
 * snippets typecheck without wrapping (a function wrapper would illegally hoist
 * the block's `import` statements out of module scope → TS1232). The trailing
 * `export {}` forces module (not script) semantics even for import-less blocks.
 * @param {string} code
 */
function wrapBlock(code) {
  return `${code}\nexport {};\n`;
}

main();
