#!/usr/bin/env node
// @ts-check

// ---------------------------------------------------------------------------
// check-docs.mjs — typecheck every fenced TypeScript block in Markdown and
// public JSDoc against the BUILT package (dist/), not against src/.
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
//   semantically wrong. An error-class template could omit an explicit literal
//   `name` and still compile, even though a minifier could then change runtime
//   behavior. This guard will NEVER see that class of bug. Do not treat a green
//   run here as proof the docs are correct; it only proves they still TYPECHECK
//   against dist/.
//
// RUN ORDER
//   MUST run AFTER `pnpm build`. dist/ is the compile target. If dist/ is
//   missing the guard FAILS LOUDLY (it does NOT skip — a silent skip is exactly
//   how the API-surface snapshot test lets stale-dist bugs through).
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createScratchDir } from "./lib/scratch-dir.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");

// Sources that carry public, copy-pasteable TypeScript. JSDoc is converted to
// Markdown without changing line counts, so diagnostics still point at the
// original source line.
//
// The Markdown roster is hand-maintained (each entry is a deliberate public
// document). The JSDoc side is NOT: it globs every file under src/, because a
// hand-maintained list silently under-reports. It listed only `src/index.ts`,
// so the published `clone()` example in `src/errors/base-http-error.ts` shipped
// with four TS errors (undefined `CustomHttpError`, undefined `error`, an
// implicit `any`) that this guard exists to catch and never looked at.
export const DOC_MARKDOWN_SOURCES = [
  "README.md",
  "CONTRIBUTING.md",
  "skills/typed-fetch/SKILL.md",
  ".claude/skills/typed-fetch-maintainer/SKILL.md",
];

/**
 * Every `.ts` file under src/, relative to the repo root, sorted for stable
 * reporting.
 * @param {string} dir
 * @param {string} prefix
 * @returns {string[]}
 */
function collectSourceFiles(dir, prefix) {
  /** @type {string[]} */
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      found.push(...collectSourceFiles(join(dir, entry.name), rel));
    } else if (entry.name.endsWith(".ts")) {
      found.push(rel);
    }
  }
  return found.toSorted();
}

// The roster of doc sources used to be built HERE, at module scope, which meant
// importing this file hit the disk. It is now assembled by gatherDocSources()
// inside main(), so a spec can import the decisions below for free.

// The package's public entry points, as written in the docs.
export const PKG_ROOT = "@pbpeterson/typed-fetch";
export const PKG_ERRORS = "@pbpeterson/typed-fetch/errors";

// Skip convention: a block is skipped ONLY if its opening fence info-string
// carries the `no-check` marker, i.e. ```ts no-check  or  ```typescript no-check
// Every skip is counted and printed so a broken block can never be silenced
// invisibly (see the skip summary + ratio guard at the bottom).
export const SKIP_MARKER = "no-check";

// If more than this fraction of TypeScript blocks are skipped, the guard fails:
// the whole point is that examples compile, and a marker that everyone reaches
// for is a marker that rots. Tune deliberately, not to make a red run go green.
export const MAX_SKIP_RATIO = 0.5;

/**
 * Extract fenced ts/typescript blocks from markdown.
 * @param {string} md
 * @returns {{ line: number, info: string, code: string, skip: boolean }[]}
 */
export function extractBlocks(md) {
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
 * Remove the leading ` * ` decoration from JSDoc lines while preserving one
 * output line per input line. Fenced examples then look exactly like Markdown
 * to {@link extractBlocks}, and its 1-based fence locations remain source
 * locations.
 * @param {string} source
 */
export function jsdocToMarkdown(source) {
  return source
    .split("\n")
    .map((line) => line.replace(/^\s*\* ?/, ""))
    .join("\n");
}

/**
 * Rewrite the package specifier to point at the built dist/ so a block is
 * typechecked against the SHIPPED types, not src/.
 * @param {string} code
 * @param {string} distDir absolute path to dist/
 */
export function rewriteImports(code, distDir) {
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

// ---------------------------------------------------------------------------
// THE DECISION, part 1 of 2: what gets compiled.
// Pure. The caller reads the sources off disk and writes the plan to disk;
// nothing here touches fs, so a spec can hand it string literals and check the
// block roster, the names, and the line attribution exactly.
// ---------------------------------------------------------------------------

/**
 * @typedef {{ file: string, format: "markdown" | "jsdoc", source: string }} DocSource
 * @typedef {{ name: string, file: string, line: number, content: string }} PlannedBlock
 * @typedef {{
 *   blocks: PlannedBlock[],
 *   skipped: { file: string, line: number }[],
 *   totalTsBlocks: number,
 * }} DocPlan
 */

/**
 * @param {DocSource[]} docs
 * @param {string} distDir absolute path to dist/, for the import rewrite
 * @returns {DocPlan}
 */
export function planDocBlocks(docs, distDir) {
  /** @type {PlannedBlock[]} */
  const blocks = [];
  /** @type {{ file: string, line: number }[]} */
  const skipped = [];
  let totalTsBlocks = 0;

  for (const { file, format, source } of docs) {
    const md = format === "jsdoc" ? jsdocToMarkdown(source) : source;
    for (const block of extractBlocks(md)) {
      totalTsBlocks += 1;
      if (block.skip) {
        skipped.push({ file, line: block.line });
        continue;
      }
      blocks.push({
        name: `${file.replace(/[^a-zA-Z0-9]/g, "_")}__L${block.line}`,
        file,
        line: block.line,
        content: wrapBlock(rewriteImports(block.code, distDir)),
      });
    }
  }
  return { blocks, skipped, totalTsBlocks };
}

/**
 * Attribute raw tsc diagnostics back to the doc file + fence line that produced
 * them, dropping duplicates. tsc prints e.g.
 *   blocks/README_md__L13.ts(4,20): error TS2339: ...
 * @param {string} tscOutput
 * @param {PlannedBlock[]} blocks
 * @returns {{ file: string, line: number, msg: string }[]}
 */
export function attributeDiagnostics(tscOutput, blocks) {
  const index = new Map(blocks.map((b) => [b.name, b]));
  const seen = new Set();
  const failures = [];
  for (const rawLine of tscOutput.split("\n")) {
    const m = rawLine.match(/blocks\/([A-Za-z0-9_]+)\.ts\((\d+),(\d+)\): (error TS\d+.*)$/);
    if (!m) continue;
    const info = index.get(m[1]);
    if (!info) continue;
    const key = `${m[1]}:${m[2]}:${m[3]}:${m[4]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    failures.push({ file: info.file, line: info.line, msg: m[4] });
  }
  return failures;
}

// ---------------------------------------------------------------------------
// THE DECISION, part 2 of 2: the verdict.
// This gate ACCUMULATES failures, so the verdict is a returned record, not a
// thrown Error: an exception can carry one message and this report must print
// every failing block. Precedence is exactly the old control flow —
// TS5112 > unattributable > block failures > skip ratio > ok.
// ---------------------------------------------------------------------------

/**
 * @typedef {
 *   | { kind: "tsc-config-regression" }
 *   | { kind: "unattributable" }
 *   | { kind: "block-failures", failures: { file: string, line: number, msg: string }[] }
 *   | { kind: "skip-ratio", skipRatio: number }
 *   | { kind: "ok" }
 * } DocsVerdict
 */

/**
 * @param {{ plan: DocPlan, tscOutput: string | null }} run
 *   tscOutput is null when tsc exited 0.
 * @returns {DocsVerdict}
 */
export function judgeDocs({ plan, tscOutput }) {
  if (tscOutput !== null) {
    const failures = attributeDiagnostics(tscOutput, plan.blocks);
    // TS5112 must never appear — if it does, our config strategy regressed. It
    // masks real errors, so it outranks any diagnostic we did manage to parse.
    if (/TS5112/.test(tscOutput)) return { kind: "tsc-config-regression" };
    // tsc failed but we could not attribute a single diagnostic: surface raw
    // output rather than silently "passing".
    if (failures.length === 0) return { kind: "unattributable" };
    return { kind: "block-failures", failures };
  }

  const skipRatio = plan.totalTsBlocks === 0 ? 0 : plan.skipped.length / plan.totalTsBlocks;
  if (skipRatio > MAX_SKIP_RATIO) return { kind: "skip-ratio", skipRatio };
  return { kind: "ok" };
}

// The entry points a usable dist/ must contain, relative to dist/. Both the
// implementation (.js) and the types (.d.ts) for both entry points: value
// imports resolve against the former, type info against the latter. A
// half-built dist/ must fail, not silently under-check.
export const REQUIRED_DIST_ENTRIES = [
  "index.js",
  "index.d.ts",
  "errors/index.js",
  "errors/index.d.ts",
];

// ---------------------------------------------------------------------------
// Adapter. All fs/subprocess access. No pass/fail branch lives here except the
// two I/O preconditions (dist/ and tsc must exist) whose messages are fixed.
// ---------------------------------------------------------------------------

/** @returns {DocSource[]} */
function gatherDocSources() {
  /** @type {DocSource[]} */
  const docs = [];
  const roster = [
    ...DOC_MARKDOWN_SOURCES.map((file) => ({ file, format: /** @type {const} */ ("markdown") })),
    ...collectSourceFiles(join(repoRoot, "src"), "src").map((file) => ({
      file,
      format: /** @type {const} */ ("jsdoc"),
    })),
  ];
  for (const { file, format } of roster) {
    const abs = join(repoRoot, file);
    if (!existsSync(abs)) {
      console.error(`check-docs: doc file not found: ${file}`);
      process.exit(1);
    }
    docs.push({ file, format, source: readFileSync(abs, "utf8") });
  }
  return docs;
}

function main() {
  const distDir = join(repoRoot, "dist");

  // (c) dist/ may be stale or absent. FAIL LOUDLY — never skip.
  const missing = REQUIRED_DIST_ENTRIES.map((rel) => join(distDir, rel)).filter(
    (p) => !existsSync(p),
  );
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

  // Scratch tmp dir for the per-block .ts files + a dedicated tsconfig.
  // createScratchDir removes it on exit as well as on demand: this script has
  // failure branches (a missing doc file below, the TS5112 abort further down)
  // that used to exit straight past the rmSync and leak a directory on exactly
  // the runs someone was already debugging.
  const scratch = createScratchDir("typed-fetch-docs-");
  const workDir = scratch.path;

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

  const blocksDir = join(workDir, "blocks");
  mkdirSync(blocksDir, { recursive: true });

  const docs = gatherDocSources();
  const plan = planDocBlocks(docs, distDir);
  for (const block of plan.blocks) {
    writeFileSync(join(blocksDir, `${block.name}.ts`), block.content);
  }

  // Run tsc ONCE over all block files via the scratch tsconfig.
  /** @type {string | null} */
  let tscOutput = null;
  try {
    execFileSync(tscBin, ["--noEmit", "-p", join(workDir, "tsconfig.json")], {
      cwd: workDir,
      stdio: "pipe",
      encoding: "utf8",
    });
  } catch (err) {
    tscOutput = `${err.stdout ?? ""}${err.stderr ?? ""}`;
  }

  const verdict = judgeDocs({ plan, tscOutput });

  if (verdict.kind === "tsc-config-regression") {
    console.error("check-docs: tsc emitted TS5112 (root tsconfig leaked in). This masks real");
    console.error("  errors and is a bug in this script. Aborting.\n");
    console.error(tscOutput);
    process.exit(1);
  }
  if (verdict.kind === "unattributable") {
    console.error("check-docs: tsc failed but no block diagnostics were parsed. Raw output:\n");
    console.error(tscOutput);
    scratch.dispose();
    process.exit(1);
  }

  scratch.dispose();

  // ----- Report -----------------------------------------------------------
  console.log(`check-docs: scanned ${docs.length} documentation sources`);
  console.log(`  TypeScript blocks found : ${plan.totalTsBlocks}`);
  console.log(`  checked against dist/    : ${plan.blocks.length}`);
  console.log(`  skipped (\`${SKIP_MARKER}\`)      : ${plan.skipped.length}`);

  if (plan.skipped.length > 0) {
    console.log("\n  Skipped blocks (must be fragments/templates that cannot compile standalone):");
    for (const s of plan.skipped) {
      console.log(`    - ${s.file}:${s.line}`);
    }
  }

  if (verdict.kind === "block-failures") {
    console.error(
      `\ncheck-docs: ${verdict.failures.length} documentation block(s) FAILED to typecheck:\n`,
    );
    for (const f of verdict.failures) {
      console.error(`  ${f.file} (fence at line ${f.line}): ${f.msg}`);
    }
    console.error("\nFix the doc example, or — only if it is a genuine non-compilable fragment —");
    console.error(`mark its fence \`\`\`ts ${SKIP_MARKER} (see CONTRIBUTING.md).`);
    process.exit(1);
  }

  if (verdict.kind === "skip-ratio") {
    console.error(
      `\ncheck-docs: skip ratio ${(verdict.skipRatio * 100).toFixed(0)}% exceeds ` +
        `${(MAX_SKIP_RATIO * 100).toFixed(0)}% — too many blocks are marked \`${SKIP_MARKER}\`.`,
    );
    console.error("  The guard only protects blocks it actually compiles. Reduce the skips.");
    process.exit(1);
  }

  console.log(
    `\ncheck-docs: OK — all ${plan.blocks.length} checked block(s) typecheck against dist/.`,
  );
}

/**
 * Make each block its own ES module. `module: ESNext` + `target: ES2022` allow
 * TOP-LEVEL await, so idiomatic `const { error } = await typedFetch(...)`
 * snippets typecheck without wrapping (a function wrapper would illegally hoist
 * the block's `import` statements out of module scope → TS1232). The trailing
 * `export {}` forces module (not script) semantics even for import-less blocks.
 * @param {string} code
 */
export function wrapBlock(code) {
  return `${code}\nexport {};\n`;
}

// Importing this module must do nothing at all; only `node scripts/check-docs.mjs`
// runs the gate. Note the guard is lexical — it does not resolve symlinks, while
// Node's ESM loader realpaths import.meta.url — so a symlinked checkout would
// make it false and this gate would print nothing and exit 0.
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
