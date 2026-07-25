import { execFileSync } from "node:child_process";
import { existsSync, symlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, test } from "vitest";
import { createScratchDir } from "./lib/scratch-dir.mjs";
import {
  attributeDiagnostics,
  extractBlocks,
  judgeDocs,
  jsdocToMarkdown,
  MAX_SKIP_RATIO,
  planDocBlocks,
  REQUIRED_DIST_ENTRIES,
  rewriteImports,
  SKIP_MARKER,
  wrapBlock,
} from "./check-docs.mjs";

// Markdown fixtures are line arrays: a template literal cannot hold a fence
// without escaping every backtick, and the line NUMBERS are what this parser is
// judged on.
const md = (...lines) => lines.join("\n");
const FENCE = "```";
const FENCE4 = "````";

describe("extractBlocks — which fences count", () => {
  test("extracts ts and typescript fences and ignores every other language", () => {
    const doc = md(
      "# Title",
      "",
      FENCE + "ts",
      "const a = 1;",
      FENCE,
      "",
      FENCE + "typescript",
      "const b = 2;",
      FENCE,
      "",
      FENCE + "js",
      "const c = 3;",
      FENCE,
      "",
      FENCE + "bash",
      "pnpm build",
      FENCE,
      "",
      FENCE,
      "plain",
      FENCE,
      "",
    );
    expect(extractBlocks(doc).map((b) => b.code)).toEqual(["const a = 1;", "const b = 2;"]);
  });

  test("matches the language case-insensitively", () => {
    expect(extractBlocks(md(FENCE + "TS", "const a = 1;", FENCE))).toHaveLength(1);
  });

  test("reports the 1-based line of the OPENING fence", () => {
    const doc = md(
      "intro",
      "",
      FENCE + "ts",
      "const a = 1;",
      FENCE,
      "",
      FENCE + "ts",
      "const b = 2;",
      FENCE,
    );
    expect(extractBlocks(doc).map((b) => b.line)).toEqual([3, 7]);
  });

  test("a fence whose info string contains a backtick is not a fence", () => {
    expect(extractBlocks(md(FENCE + "ts `x`", "const a = 1;", FENCE))).toHaveLength(0);
  });
});

describe("extractBlocks — the skip marker", () => {
  test(`marks a block skipped only for the exact \`${SKIP_MARKER}\` marker`, () => {
    const doc = md(
      FENCE + `ts ${SKIP_MARKER}`,
      "fragment",
      FENCE,
      "",
      FENCE + "ts twoslash",
      "const a = 1;",
      FENCE,
      "",
      FENCE + "ts",
      "const b = 2;",
      FENCE,
    );
    expect(extractBlocks(doc).map((b) => b.skip)).toEqual([true, false, false]);
  });

  test("the marker must be an info-string word, not part of the language", () => {
    expect(extractBlocks(md(FENCE + `ts${SKIP_MARKER}`, "x", FENCE))).toHaveLength(0);
  });
});

describe("extractBlocks — fence lengths and indentation", () => {
  test("treats a ````markdown wrapper as one opaque block, not two", () => {
    // CONTRIBUTING.md documents the fence convention by showing a nested ```ts
    // block. That inner block is documentation ABOUT fences and must not be
    // compiled.
    const doc = md(FENCE4 + "markdown", FENCE + "ts", "const broken: string = 1;", FENCE, FENCE4);
    expect(extractBlocks(doc)).toHaveLength(0);
  });

  test("a longer closing fence closes a shorter opening fence", () => {
    expect(extractBlocks(md(FENCE + "ts", "const a = 1;", FENCE4))).toHaveLength(1);
  });

  test("an indented block closed at the same indent is extracted", () => {
    const doc = md("- item:", "", "  " + FENCE + "ts", "  const a = 1;", "  " + FENCE, "");
    expect(extractBlocks(doc)).toHaveLength(1);
  });

  test("a deeply indented fence closes at its own indent (list-item case)", () => {
    // CONTRIBUTING.md has a ```typescript fence five spaces deep inside a list
    // item, closed at the same five spaces. A flat "close may be 0-3 spaces"
    // rule reports that as unterminated — the bound is relative to the opening
    // indent, not absolute.
    const doc = md(
      "   - step:",
      "",
      "     " + FENCE + "ts",
      "     const a = 1;",
      "     " + FENCE,
      "",
    );
    const blocks = extractBlocks(doc);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].unterminated).toBe(false);
  });

  test("a closing fence at a different indent still closes the block", () => {
    // CommonMark lets the closing fence carry 0-3 spaces of indentation
    // INDEPENDENTLY of the opening fence. Building the closing regex from the
    // opening indent meant a mismatched close consumed every later block —
    // including ones that would have failed to compile. That is this gate's
    // worst failure mode: silent under-checking, reported as a lower block
    // count that nothing compares against.
    const doc = md(
      "  " + FENCE + "ts",
      "  const a: number = 1;",
      FENCE,
      "",
      FENCE + "ts",
      "const b: string = 2;",
      FENCE,
      "",
    );
    const blocks = extractBlocks(doc);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].code).toContain("const a: number = 1;");
    expect(blocks[1].code).toContain("const b: string = 2;");
    expect(blocks.some((b) => b.unterminated)).toBe(false);
  });

  test("an unclosed fence runs to end of file", () => {
    const blocks = extractBlocks(md(FENCE + "ts", "const a = 1;", "still inside"));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].code).toBe("const a = 1;\nstill inside");
  });
});

describe("jsdocToMarkdown", () => {
  test("strips the leading ` * ` decoration", () => {
    expect(jsdocToMarkdown(" * hello")).toBe("hello");
    expect(jsdocToMarkdown(" *")).toBe("");
  });

  test("preserves one output line per input line so fence lines stay source lines", () => {
    const src = md(
      "/**",
      " * Example:",
      " * " + FENCE + "ts",
      " * const a = 1;",
      " * " + FENCE,
      " */",
    );
    expect(jsdocToMarkdown(src).split("\n")).toHaveLength(src.split("\n").length);
    expect(extractBlocks(jsdocToMarkdown(src))[0].line).toBe(3);
  });
});

describe("rewriteImports", () => {
  const DIST = "/repo/dist";

  test("rewrites the /errors subpath before the root specifier", () => {
    // Order matters: rewriting the root first would leave "/repo/dist/index.js/errors".
    const code = md(
      `import { typedFetch } from "@pbpeterson/typed-fetch";`,
      `import { NotFoundError } from "@pbpeterson/typed-fetch/errors";`,
    );
    const out = rewriteImports(code, DIST);
    expect(out).toContain(`"/repo/dist/index.js"`);
    expect(out).toContain(`"/repo/dist/errors/index.js"`);
    expect(out).not.toContain("index.js/errors");
    expect(out).not.toContain("@pbpeterson/typed-fetch");
  });

  test("handles single-quoted specifiers", () => {
    expect(rewriteImports(`import x from '@pbpeterson/typed-fetch';`, DIST)).toContain(
      `"/repo/dist/index.js"`,
    );
  });

  test("points at the implementation, not the declaration file", () => {
    // Importing the .d.ts directly trips TS2846 and would force every value
    // import in the docs to become a type import.
    expect(rewriteImports(`import x from "@pbpeterson/typed-fetch";`, DIST)).not.toContain(".d.ts");
  });

  test("leaves unrelated specifiers alone", () => {
    const code = `import { z } from "zod";`;
    expect(rewriteImports(code, DIST)).toBe(code);
  });
});

describe("wrapBlock", () => {
  test("forces module semantics so an import-less block is not a script", () => {
    expect(wrapBlock("const a = 1;")).toBe("const a = 1;\nexport {};\n");
  });
});

describe("planDocBlocks", () => {
  const doc = (file, format, ...lines) => ({ file, format, source: md(...lines) });

  test("counts every ts block, compiles the unskipped ones, records the skipped ones", () => {
    const plan = planDocBlocks(
      [
        doc(
          "README.md",
          "markdown",
          FENCE + "ts",
          "const a = 1;",
          FENCE,
          "",
          FENCE + `ts ${SKIP_MARKER}`,
          "fragment",
          FENCE,
        ),
        doc(
          "src/index.ts",
          "jsdoc",
          "/**",
          " * " + FENCE + "ts",
          " * const b = 2;",
          " * " + FENCE,
          " */",
        ),
      ],
      "/repo/dist",
    );
    expect(plan.totalTsBlocks).toBe(3);
    expect(plan.blocks).toHaveLength(2);
    expect(plan.skipped).toEqual([{ file: "README.md", line: 5 }]);
  });

  test("names each block file after its source path and fence line", () => {
    const plan = planDocBlocks(
      [
        doc(
          ".claude/skills/typed-fetch-maintainer/SKILL.md",
          "markdown",
          FENCE + "ts",
          "const a = 1;",
          FENCE,
        ),
      ],
      "/repo/dist",
    );
    expect(plan.blocks[0].name).toBe("_claude_skills_typed_fetch_maintainer_SKILL_md__L1__b0");
  });

  test("the block name matches what attributeDiagnostics parses back out", () => {
    // These two must agree; the diagnostic regex only accepts [A-Za-z0-9_].
    const plan = planDocBlocks(
      [doc("skills/typed-fetch/SKILL.md", "markdown", FENCE + "ts", "x", FENCE)],
      "/d",
    );
    expect(plan.blocks[0].name).toMatch(/^[A-Za-z0-9_]+$/);
  });

  test("applies the import rewrite and the module wrapper to the block content", () => {
    const plan = planDocBlocks(
      [
        doc(
          "README.md",
          "markdown",
          FENCE + "ts",
          `import x from "@pbpeterson/typed-fetch";`,
          FENCE,
        ),
      ],
      "/repo/dist",
    );
    expect(plan.blocks[0].content).toBe(`import x from "/repo/dist/index.js";\nexport {};\n`);
  });

  test("paths that differ only by punctuation get distinct block names", () => {
    // Both sanitize to src_foo_bar_ts. main() writes each block to
    // blocks/<name>.ts, so a collision meant one file overwrote the other and
    // one block was silently never compiled.
    const plan = planDocBlocks(
      [
        doc(
          "src/foo-bar.ts",
          "jsdoc",
          "/**",
          " * " + FENCE + "ts",
          " * const a = 1;",
          " * " + FENCE,
          " */",
        ),
        doc(
          "src/foo_bar.ts",
          "jsdoc",
          "/**",
          " * " + FENCE + "ts",
          " * const b = 2;",
          " * " + FENCE,
          " */",
        ),
      ],
      "/repo/dist",
    );
    expect(plan.blocks[0].name).not.toBe(plan.blocks[1].name);
    // Still parseable by attributeDiagnostics, which only accepts [A-Za-z0-9_].
    expect(plan.blocks[0].name).toMatch(/^[A-Za-z0-9_]+$/);
    expect(plan.blocks[1].name).toMatch(/^[A-Za-z0-9_]+$/);
  });

  test("reports an unterminated fence instead of swallowing the rest of the file", () => {
    // A fence that is never closed used to run to EOF and emit one giant
    // block, so every later example vanished from the count in silence.
    const plan = planDocBlocks(
      [doc("README.md", "markdown", FENCE + "ts", "const a = 1;", "", "no closing fence here")],
      "/d",
    );
    expect(plan.unterminated).toEqual([{ file: "README.md", line: 1 }]);
  });

  test("a well-formed document reports no unterminated fences", () => {
    const plan = planDocBlocks(
      [doc("README.md", "markdown", FENCE + "ts", "const a = 1;", FENCE)],
      "/d",
    );
    expect(plan.unterminated).toEqual([]);
  });
});

describe("attributeDiagnostics", () => {
  const blocks = [
    { name: "README_md__L13", file: "README.md", line: 13, content: "" },
    { name: "src_index_ts__L40", file: "src/index.ts", line: 40, content: "" },
  ];

  test("maps a diagnostic back to its doc file and fence line", () => {
    const out = attributeDiagnostics(
      "blocks/README_md__L13.ts(4,20): error TS2339: Property 'status' does not exist.",
      blocks,
    );
    expect(out).toEqual([
      { file: "README.md", line: 13, msg: "error TS2339: Property 'status' does not exist." },
    ]);
  });

  test("de-duplicates identical diagnostics", () => {
    const line = "blocks/README_md__L13.ts(4,20): error TS2339: nope.";
    expect(attributeDiagnostics(md(line, line), blocks)).toHaveLength(1);
  });

  test("keeps two diagnostics that differ only by column", () => {
    expect(
      attributeDiagnostics(
        md(
          "blocks/README_md__L13.ts(4,20): error TS2339: nope.",
          "blocks/README_md__L13.ts(4,31): error TS2339: nope.",
        ),
        blocks,
      ),
    ).toHaveLength(2);
  });

  test("ignores non-diagnostic noise and unknown block names", () => {
    expect(
      attributeDiagnostics(
        md("Found 1 error.", "blocks/GHOST_md__L1.ts(1,1): error TS2304: Cannot find name 'x'."),
        blocks,
      ),
    ).toEqual([]);
  });
});

const plan = (over = {}) => ({
  blocks: [],
  skipped: [],
  unterminated: [],
  totalTsBlocks: 0,
  ...over,
});
const block = (name, file, line) => ({ name, file, line, content: "" });

describe("judgeDocs", () => {
  test("passes when tsc succeeded and the skip ratio is in budget", () => {
    expect(
      judgeDocs({
        plan: plan({ totalTsBlocks: 4, skipped: [{ file: "a", line: 1 }] }),
        tscOutput: null,
      }),
    ).toEqual({ kind: "ok" });
  });

  test(`allows a skip ratio of exactly ${MAX_SKIP_RATIO}`, () => {
    const skipped = [
      { file: "a", line: 1 },
      { file: "b", line: 2 },
    ];
    expect(judgeDocs({ plan: plan({ totalTsBlocks: 4, skipped }), tscOutput: null })).toEqual({
      kind: "ok",
    });
  });

  test("fails just above the skip ratio", () => {
    const skipped = [1, 2, 3].map((line) => ({ file: "a", line }));
    expect(judgeDocs({ plan: plan({ totalTsBlocks: 5, skipped }), tscOutput: null })).toEqual({
      kind: "skip-ratio",
      skipRatio: 0.6,
    });
  });

  test("treats a docs set with no ts blocks as a zero ratio, not a division by zero", () => {
    expect(judgeDocs({ plan: plan(), tscOutput: null })).toEqual({ kind: "ok" });
  });

  test("reports every attributable block failure", () => {
    const verdict = judgeDocs({
      plan: plan({ blocks: [block("README_md__L13", "README.md", 13)] }),
      tscOutput: "blocks/README_md__L13.ts(4,20): error TS2339: nope.",
    });
    expect(verdict).toEqual({
      kind: "block-failures",
      failures: [{ file: "README.md", line: 13, msg: "error TS2339: nope." }],
    });
  });

  test("a TS5112 leak outranks attributable failures", () => {
    // TS5112 means the root tsconfig leaked in, which MASKS real errors — the
    // parsed diagnostics cannot be trusted, so the script must abort loudly.
    const verdict = judgeDocs({
      plan: plan({ blocks: [block("README_md__L13", "README.md", 13)] }),
      tscOutput: md(
        "error TS5112: tsconfig.json is present but will not be loaded...",
        "blocks/README_md__L13.ts(4,20): error TS2339: nope.",
      ),
    });
    expect(verdict).toEqual({ kind: "tsc-config-regression" });
  });

  test("a tsc failure with nothing attributable is surfaced, never swallowed", () => {
    expect(judgeDocs({ plan: plan(), tscOutput: "FATAL ERROR: heap out of memory" })).toEqual({
      kind: "unattributable",
    });
  });

  test("the skip ratio is not consulted when blocks failed to compile", () => {
    const skipped = [1, 2, 3].map((line) => ({ file: "a", line }));
    const verdict = judgeDocs({
      plan: plan({
        blocks: [block("README_md__L13", "README.md", 13)],
        skipped,
        totalTsBlocks: 4,
      }),
      tscOutput: "blocks/README_md__L13.ts(4,20): error TS2339: nope.",
    });
    expect(verdict.kind).toBe("block-failures");
  });
});

describe("REQUIRED_DIST_ENTRIES", () => {
  test("requires implementation AND declarations for both entry points", () => {
    // Value imports resolve against the .js, type info against the .d.ts. A
    // half-built dist/ must fail rather than silently under-check.
    expect(REQUIRED_DIST_ENTRIES).toEqual([
      "index.js",
      "index.d.ts",
      "errors/index.js",
      "errors/index.d.ts",
    ]);
  });
});

// ---------------------------------------------------------------------------
// The gate must RUN. Everything above is pure and covers the decisions; none of
// it proves that `node scripts/check-docs.mjs` still reaches main(). A lexical
// isMain guard made this gate print nothing and exit 0 through any symlink in
// the invocation path, and CI reads that as a pass.
// ---------------------------------------------------------------------------
const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const CHECK_DOCS = join(scriptDir, "check-docs.mjs");

// The gate compiles every documented block with tsc. That is fast on a warm
// machine and slow on a cold CI runner, so the budget is generous: a flaky
// release-gate spec is worse than a slow one.
const CHECK_DOCS_TIMEOUT = 120_000;

const links = createScratchDir("tf-check-docs-link-");
afterAll(() => links.dispose());

/** @param {string} entry */
function runCheckDocs(entry) {
  try {
    return {
      code: 0,
      output: execFileSync(process.execPath, [entry], {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    };
  } catch (err) {
    return { code: err.status ?? 1, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

describe.skipIf(process.platform === "win32")("check-docs — the gate runs", () => {
  test.each([
    ["its real path", () => CHECK_DOCS],
    [
      "a symlinked checkout directory",
      () => {
        const linked = join(links.path, "checkout");
        if (!existsSync(linked)) symlinkSync(repoRoot, linked);
        return join(linked, "scripts", "check-docs.mjs");
      },
    ],
    [
      "a symlinked script file",
      () => {
        const linked = join(links.path, "check-docs.mjs");
        if (!existsSync(linked)) symlinkSync(CHECK_DOCS, linked);
        return linked;
      },
    ],
  ])(
    "reports a verdict when started through %s",
    (_name, entry) => {
      // Every branch of main() — the OK line, a missing dist/, a failed block —
      // starts a line with `check-docs: `. Only a guard that never reached
      // main() prints nothing at all, and that is the failure under test.
      const { output } = runCheckDocs(entry());
      expect(output).toMatch(/^check-docs: /m);
    },
    CHECK_DOCS_TIMEOUT,
  );
});
