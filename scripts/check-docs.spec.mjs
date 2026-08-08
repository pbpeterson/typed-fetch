import { execFileSync } from "node:child_process";
import { existsSync, symlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, test } from "vitest";
import { createScratchDir } from "./lib/scratch-dir.mjs";
import { STYLE_MARKDOWN_SOURCES } from "./check-doc-style.mjs";
import {
  attributeDiagnostics,
  DOC_MARKDOWN_SOURCES,
  DOC_TYPECHECK_PASSES,
  extractBlocks,
  findRelativeExampleUrls,
  HISTORICAL_MARKER,
  HISTORICAL_SOURCES,
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

describe("extractBlocks — the historical marker", () => {
  test(`marks a block historical only for the exact \`${HISTORICAL_MARKER}\` marker`, () => {
    const doc = md(
      FENCE + `ts ${HISTORICAL_MARKER}`,
      "// 0.x",
      FENCE,
      "",
      FENCE + "ts",
      "const b = 2;",
      FENCE,
    );
    expect(extractBlocks(doc).map((b) => b.historical)).toEqual([true, false]);
  });

  test("`historical` and `no-check` on one fence sets both flags", () => {
    const [block] = extractBlocks(md(FENCE + `ts ${HISTORICAL_MARKER} ${SKIP_MARKER}`, "x", FENCE));
    expect(block.historical).toBe(true);
    expect(block.skip).toBe(true);
  });

  test("the marker must be an info-string word, not part of the language", () => {
    expect(extractBlocks(md(FENCE + `ts${HISTORICAL_MARKER}`, "x", FENCE))).toHaveLength(0);
  });

  test("a plain ts fence is neither skipped nor historical", () => {
    const [block] = extractBlocks(md(FENCE + "ts", "const a = 1;", FENCE));
    expect(block.skip).toBe(false);
    expect(block.historical).toBe(false);
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

  test("points a pass at the entry that pass names", () => {
    // The entry decides which declaration file tsc loads beside it, so this is
    // what makes the `dmts` pass compile the other half of the dual build.
    const code = md(`import { typedFetch } from "@pbpeterson/typed-fetch";`);
    expect(rewriteImports(code, DIST, "index.mjs")).toContain(`"/repo/dist/index.mjs"`);
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

  test("every extracted block reaches exampleBlocks with the code the author wrote", () => {
    // The URL rule reads THIS, not the rewritten content: it must judge what a
    // reader copies, before the dist/ import rewrite.
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
    expect(plan.exampleBlocks).toEqual([
      { file: "README.md", line: 1, code: `import x from "@pbpeterson/typed-fetch";` },
    ]);
  });
});

describe("planDocBlocks — historical blocks", () => {
  const doc = (file, ...lines) => ({ file, format: "markdown", source: md(...lines) });
  const HIST = FENCE + `ts ${HISTORICAL_MARKER}`;

  test("a historical block in CHANGELOG.md is recorded, not compiled, and not in blocks", () => {
    const plan = planDocBlocks([doc("CHANGELOG.md", HIST, "// 0.x", FENCE)], "/d");
    expect(plan.historical).toEqual([{ file: "CHANGELOG.md", line: 1 }]);
    expect(plan.blocks).toEqual([]);
    expect(plan.historicalMisplaced).toEqual([]);
  });

  test("a historical block outside CHANGELOG.md lands in historicalMisplaced", () => {
    const plan = planDocBlocks([doc("README.md", HIST, "// 0.x", FENCE)], "/d");
    expect(plan.historicalMisplaced).toEqual([{ file: "README.md", line: 1 }]);
    expect(plan.historical).toEqual([]);
    expect(plan.blocks).toEqual([]);
  });

  test("a historical block still counts toward totalTsBlocks", () => {
    // The report stays honest about how many examples the corpus holds; only
    // the skip RATIO excludes them.
    const plan = planDocBlocks(
      [doc("CHANGELOG.md", HIST, "// 0.x", FENCE, "", FENCE + "ts", "const a = 1;", FENCE)],
      "/d",
    );
    expect(plan.totalTsBlocks).toBe(2);
    expect(plan.blocks).toHaveLength(1);
  });

  test("historical wins over no-check on one fence: the block is recorded once", () => {
    const plan = planDocBlocks(
      [doc("CHANGELOG.md", FENCE + `ts ${SKIP_MARKER} ${HISTORICAL_MARKER}`, "x", FENCE)],
      "/d",
    );
    expect(plan.historical).toEqual([{ file: "CHANGELOG.md", line: 1 }]);
    expect(plan.skipped).toEqual([]);
  });

  test("a historical block is still handed to the URL rule", () => {
    const plan = planDocBlocks([doc("CHANGELOG.md", HIST, "// 0.x", FENCE)], "/d");
    expect(plan.exampleBlocks).toEqual([{ file: "CHANGELOG.md", line: 1, code: "// 0.x" }]);
  });
});

const scan = (code) => findRelativeExampleUrls([{ file: "D.md", line: 7, code }]);

describe("findRelativeExampleUrls", () => {
  test("flags a relative double-quoted first argument", () => {
    expect(scan(`await typedFetch("/api/users");`)).toEqual([
      { file: "D.md", line: 7, url: "/api/users" },
    ]);
  });

  test("flags the single-quoted form", () => {
    expect(scan(`await typedFetch('/api/users');`)).toHaveLength(1);
  });

  test("flags a generic call", () => {
    expect(scan(`await typedFetch<User>("/api/users");`)).toHaveLength(1);
  });

  test("accepts an absolute https URL", () => {
    expect(scan(`await typedFetch("https://api.example.com/users");`)).toEqual([]);
  });

  test("accepts an http:// URL — the rule is absolute, not https", () => {
    expect(scan(`await typedFetch("http://localhost:3000/users");`)).toEqual([]);
  });

  test("ignores a template literal: a computed URL cannot be judged statically", () => {
    // Regression — skills/typed-fetch/SKILL.md:295 builds its URL from BASE_URL.
    expect(scan("return typedFetch<T>(`${BASE_URL}${path}`, options);")).toEqual([]);
  });

  test("ignores a non-literal first argument", () => {
    expect(scan(`await typedFetch(new Request(url));`)).toEqual([]);
  });

  test("ignores a relative URL that is not typedFetch's first argument", () => {
    // Regression — src/errors/redact-url.ts:25 discusses `fetch("/v1/thing")`
    // in prose about why RELATIVE_BASE exists.
    expect(scan(`fetch("/v1/thing?token=secret");`)).toEqual([]);
    expect(scan(`await typedFetch("https://a.example/x", { body: "/api/users" });`)).toEqual([]);
  });

  test("flags a second violation in the same block and reports the fence line for both", () => {
    expect(scan(md(`typedFetch("/a");`, `typedFetch("/b");`))).toEqual([
      { file: "D.md", line: 7, url: "/a" },
      { file: "D.md", line: 7, url: "/b" },
    ]);
  });

  test("reports the source file and fence line, not an offset inside the block", () => {
    const [hit] = findRelativeExampleUrls([
      { file: "CHANGELOG.md", line: 741, code: md("// preamble", "", `typedFetch("/api/x");`) },
    ]);
    expect(hit).toEqual({ file: "CHANGELOG.md", line: 741, url: "/api/x" });
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
  historical: [],
  historicalMisplaced: [],
  unterminated: [],
  exampleBlocks: [],
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

describe("judgeDocs — the historical marker and the example-URL rule", () => {
  const misplaced = [{ file: "README.md", line: 3 }];
  const relative = [{ file: "README.md", line: 3, code: `typedFetch("/api/users");` }];

  test("reports every misplaced historical block", () => {
    expect(judgeDocs({ plan: plan({ historicalMisplaced: misplaced }), tscOutput: null })).toEqual({
      kind: "historical-misplaced",
      blocks: misplaced,
    });
  });

  test("historical-misplaced outranks block-failures", () => {
    // A misplaced marker EXCLUDED a block from compilation, so a tsc verdict —
    // green or red — under-reports. Same harm as an unterminated fence.
    const verdict = judgeDocs({
      plan: plan({
        historicalMisplaced: misplaced,
        blocks: [block("README_md__L13", "README.md", 13)],
      }),
      tscOutput: "blocks/README_md__L13.ts(4,20): error TS2339: nope.",
    });
    expect(verdict.kind).toBe("historical-misplaced");
  });

  test("historical-misplaced outranks tsc-config-regression", () => {
    const verdict = judgeDocs({
      plan: plan({ historicalMisplaced: misplaced }),
      tscOutput: "error TS5112: tsconfig.json is present but will not be loaded...",
    });
    expect(verdict.kind).toBe("historical-misplaced");
  });

  test("unterminated-fence outranks historical-misplaced", () => {
    const verdict = judgeDocs({
      plan: plan({ historicalMisplaced: misplaced, unterminated: [{ file: "a", line: 1 }] }),
      tscOutput: null,
    });
    expect(verdict.kind).toBe("unterminated-fence");
  });

  test("reports example-urls when tsc succeeded and a relative URL exists", () => {
    expect(judgeDocs({ plan: plan({ exampleBlocks: relative }), tscOutput: null })).toEqual({
      kind: "example-urls",
      urls: [{ file: "README.md", line: 3, url: "/api/users" }],
    });
  });

  test("block-failures outranks example-urls", () => {
    // A block that does not compile is the more fundamental defect; a URL nit
    // ahead of it would bury the compile error.
    const verdict = judgeDocs({
      plan: plan({
        blocks: [block("README_md__L13", "README.md", 13)],
        exampleBlocks: relative,
      }),
      tscOutput: "blocks/README_md__L13.ts(4,20): error TS2339: nope.",
    });
    expect(verdict.kind).toBe("block-failures");
  });

  test("example-urls outranks skip-ratio", () => {
    const skipped = [1, 2, 3].map((line) => ({ file: "a", line }));
    const verdict = judgeDocs({
      plan: plan({ exampleBlocks: relative, skipped, totalTsBlocks: 5 }),
      tscOutput: null,
    });
    expect(verdict.kind).toBe("example-urls");
  });

  test("the skip ratio excludes historical blocks from the denominator", () => {
    const skipped = [1, 2, 3].map((line) => ({ file: "a", line }));
    const historical = [1, 2, 3, 4].map((line) => ({ file: "CHANGELOG.md", line }));
    // 3 skipped of 6 checkable = exactly MAX_SKIP_RATIO, which is allowed.
    expect(
      judgeDocs({ plan: plan({ skipped, historical, totalTsBlocks: 10 }), tscOutput: null }),
    ).toEqual({ kind: "ok" });
  });

  test("one more skip on the same corpus crosses the ratio", () => {
    const skipped = [1, 2, 3, 4].map((line) => ({ file: "a", line }));
    const historical = [1, 2, 3, 4].map((line) => ({ file: "CHANGELOG.md", line }));
    const verdict = judgeDocs({
      plan: plan({ skipped, historical, totalTsBlocks: 10 }),
      tscOutput: null,
    });
    expect(verdict.kind).toBe("skip-ratio");
    expect(verdict.skipRatio).toBeCloseTo(4 / 6, 5);
  });

  test("a corpus that is entirely historical is a zero ratio, not a division by zero", () => {
    const historical = [1, 2].map((line) => ({ file: "CHANGELOG.md", line }));
    expect(judgeDocs({ plan: plan({ historical, totalTsBlocks: 2 }), tscOutput: null })).toEqual({
      kind: "ok",
    });
  });
});

describe("DOC_MARKDOWN_SOURCES", () => {
  test("includes CHANGELOG.md", () => {
    // The whole point of the extension: a hand-maintained roster silently
    // under-reports, which is the failure mode check-docs.mjs:44-50 records for
    // the JSDoc side. CHANGELOG.md's migration examples are the ones a reader
    // copies, and all four of them failed to compile.
    expect(DOC_MARKDOWN_SOURCES).toContain("CHANGELOG.md");
  });
});

describe("HISTORICAL_SOURCES", () => {
  test("is exactly CHANGELOG.md", () => {
    // Pinned so widening it is a reviewed diff, the same way
    // REQUIRED_DIST_ENTRIES is pinned. Anywhere else, `historical` would be a
    // general escape hatch from compilation.
    expect(HISTORICAL_SOURCES).toEqual(["CHANGELOG.md"]);
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

describe("DOC_MARKDOWN_SOURCES", () => {
  test("is exactly check-doc-style's roster", () => {
    // The two gates cover ONE declared documentation scope. They drifted once:
    // check-doc-style globbed `docs/` and listed CONTEXT.md and RELEASING.md
    // while check-docs did neither, so `docs/adr/0002`'s fence was never
    // compiled — and `CONTRIBUTING.md` claimed this gate reads "every
    // documentation source" the whole time.
    //
    // Pinned as EQUALITY, not as a subset: a document added to one gate and
    // forgotten in the other is the failure this reproduces.
    expect(DOC_MARKDOWN_SOURCES).toEqual(STYLE_MARKDOWN_SOURCES);
  });

  test("excludes the files the writing standard leaves out of scope", () => {
    // `docs/writing-standard.md` declares the scope, and PLAN.md (a completed
    // historical plan) and SECURITY.md are outside it in BOTH gates. Pinned so
    // that widening the scope is a reviewed diff rather than a side effect.
    expect(DOC_MARKDOWN_SOURCES).not.toContain("PLAN.md");
    expect(DOC_MARKDOWN_SOURCES).not.toContain("SECURITY.md");
  });
});

// ---------------------------------------------------------------------------
// DOC_TYPECHECK_PASSES — the profile roster.
// ---------------------------------------------------------------------------

describe("DOC_TYPECHECK_PASSES", () => {
  test("covers the baseline, the .d.mts declarations, and a no-DOM consumer", () => {
    expect(DOC_TYPECHECK_PASSES.map((p) => p.id)).toEqual(["baseline", "dmts", "no-dom"]);
  });

  test("one pass resolves the .d.mts declarations", () => {
    // `index.js` resolves the sibling `index.d.ts`; only an `.mjs` entry
    // reaches the declaration an import-condition consumer reads.
    expect(DOC_TYPECHECK_PASSES.some((p) => p.entry.endsWith(".mjs"))).toBe(true);
  });

  test("one pass compiles without the DOM lib", () => {
    // `src/headers.ts` refuses to name `HeadersInit` because that name lives
    // only in lib.dom. An example that needs DOM must fail somewhere.
    const noDom = DOC_TYPECHECK_PASSES.find((p) => !p.lib.some((l) => l.startsWith("DOM")));
    expect(noDom).toBeDefined();
    expect(noDom.types).toContain("node");
  });
});
