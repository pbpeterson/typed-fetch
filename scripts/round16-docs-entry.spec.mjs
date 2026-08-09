import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test, vi } from "vitest";
import {
  attributeDiagnostics,
  defaultIo as checkDocsDefaultIo,
  DOC_MARKDOWN_SOURCES,
  findRelativeExampleUrls,
  gatherDocSources,
  jsdocToMarkdown,
  judgeDocs,
  main as checkDocsMain,
  planDocBlocks,
  REQUIRED_DIST_ENTRIES,
} from "./check-docs.mjs";
import {
  defaultIo as checkDocStyleDefaultIo,
  diffTermsTables,
  findNodeFloorViolations,
  findRelativeLinks,
  findVocabularyViolations,
  FROZEN_ADR_FILES,
  gatherStyleDocs,
  main as checkDocStyleMain,
  NODE_FLOOR_FILES,
  parseTermsTable,
  README_FILE,
  STYLE_MARKDOWN_SOURCES,
  termsAgree,
  toProseLines,
  VOCABULARY_EXEMPT_FILES,
  WRITING_STANDARD_FILE,
} from "./check-doc-style.mjs";
import { createScratchDir } from "./lib/scratch-dir.mjs";

// ---------------------------------------------------------------------------
// ROUND 16 — coverage sub-lane C2: scripts/check-docs.mjs and
// scripts/check-doc-style.mjs.
//
// WHAT IS REACHABLE FROM HERE, AND WHAT IS NOT. Section 8.5 says apply the
// first option that works, and record which option each file used. Read
// against the two gates, the answer splits cleanly:
//
//  - `check-doc-style.mjs` has SIX exported decisions whose arms no spec had
//    reached: a type alias and an enum in `toProseLines`'s public-shape walk, a
//    Term header with no separator row, a frozen ADR with no `## Amendments`
//    heading, a single-quoted `href`, and the two ways a floor-context version
//    is NOT a violation. Every one of them is option (a) — the decision is
//    already exported, and this file drives it. What is left in that file after
//    this spec is `main`, `gatherStyleDocs`, `collectFiles`, and the printer.
//  - `check-docs.mjs` has NO uncovered exported decision. Its whole gap —
//    statements 81-90 and 519-790 — is `collectFiles`, `gatherDocSources`,
//    `main`, and the printers, and none of the four is exported. Option (b) is
//    the only route, and a hunter does not perform a source edit. The COVERAGE
//    row names the symbols and the `io` members.
//
// SO THE LAST TEST IN THIS FILE IS NOT A COVERAGE TEST. Section 8.7's last
// item is the one that finds defects: the one behavior each gate exists for,
// driven from a fixture that breaks it. `check-docs` exists so that an example
// in a document which does not COMPILE fails the gate, and no spec had ever
// run that path end to end — the pieces were each tested against a
// hand-written tsc transcript. It is driven here through the real `tsc`.
// ---------------------------------------------------------------------------

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");

/** Markdown fixtures are line arrays: a template literal cannot hold a fence. */
const md = (...lines) => lines.join("\n");
const FENCE = "```";

/** A markdown StyleDoc from lines. */
const doc = (file, ...lines) => ({ file, format: "markdown", source: md(...lines) });

// ── check-doc-style: the public-shape walk over the two declarations it
//    descends into but no spec had written down ─────────────────────────────
//
// `publicJSDocProseLines` keeps the JSDoc attached to an exported declaration
// AND to that declaration's public members. Two shapes reach a member through a
// recursion of their own, and the vocabulary gate is only as wide as that walk:
// prose the walk does not keep is prose the controlled vocabulary never scans.

describe("toProseLines — the exported declarations whose MEMBERS also carry prose", () => {
  test("a type alias of a type literal has its member JSDoc scanned", () => {
    const source = md(
      "/** The plan a request runs on. */",
      "export type Plan = {",
      "  /** The request has to carry an id. */",
      "  id: string;",
      "};",
    );

    // One output line per input line, so line 3 is still line 3.
    expect(toProseLines(source, "jsdoc")).toEqual([
      " The plan a request runs on. ",
      "",
      " The request has to carry an id. ",
      "",
      "",
    ]);
    // And the consequence: the member's prose is subject to the vocabulary.
    expect(findVocabularyViolations([{ file: "src/plan.ts", format: "jsdoc", source }])).toEqual([
      { file: "src/plan.ts", line: 3, rule: "normative-synonym", match: "has to" },
    ]);
  });

  test("an enum has its member JSDoc scanned", () => {
    const source = md(
      "/** The phases of a call. */",
      "export enum Phase {",
      "  /** A caller needs to name the transport. */",
      "  Setup = 1,",
      "}",
    );

    expect(toProseLines(source, "jsdoc")[2]).toBe(" A caller needs to name the transport. ");
    expect(
      findVocabularyViolations([{ file: "src/phase.ts", format: "jsdoc", source }]).map(
        (hit) => hit.line,
      ),
    ).toEqual([3]);
  });
});

// ── check-doc-style: the three "no violation" outcomes ──────────────────────

describe("parseTermsTable — a Term header that opens no table", () => {
  test("a header row with no separator under it is an EMPTY table, never null", () => {
    // The two answers mean different things to `diffTermsTables`: `null` is
    // "this document has no Terms table at all" and is reported as unparsed,
    // while `[]` is "the table is here and holds nothing", which is a drift the
    // README can be measured against. A header followed by prose is the second.
    expect(
      parseTermsTable(md("| Term | Meaning |", "not a table row", "| Copy | One instance |")),
    ).toEqual([]);
    // The control: the same header WITH a separator parses its rows.
    expect(
      parseTermsTable(md("| Term | Meaning |", "| --- | --- |", "| Copy | One instance |")),
    ).toEqual([{ term: "Copy", meaning: "One instance" }]);
  });
});

describe("findVocabularyViolations — a frozen ADR with no amendments section", () => {
  test("the whole document is immutable argument, so nothing is scanned", () => {
    const frozen = FROZEN_ADR_FILES[1];
    const lines = ["The original argument has to stay.", "", "A cancellation was recorded."];

    // The ADR policy forbids rewriting an accepted argument. With no
    // `## Amendments` heading there is no mutable region, so the scan starts
    // past the end of the file rather than at line 1.
    expect(findVocabularyViolations([doc(frozen, ...lines)])).toEqual([]);
    // NON-VACUITY: the identical text in any other document is two violations.
    expect(findVocabularyViolations([doc("OTHER.md", ...lines)]).map((hit) => hit.rule)).toEqual([
      "normative-synonym",
      "cancellation-noun",
    ]);
  });
});

describe("findRelativeLinks — the single-quoted attribute form", () => {
  test("a single-quoted href and src are flagged with their 1-based lines", () => {
    expect(
      findRelativeLinks(md("<a href='./LICENSE'>the licence</a>", "<img src='docs/x.png'>")),
    ).toEqual([
      { line: 1, target: "./LICENSE" },
      { line: 2, target: "docs/x.png" },
    ]);
    // The rule is relative-versus-absolute, not quote style.
    expect(findRelativeLinks("<a href='https://example.test/x'>x</a>")).toEqual([]);
  });
});

describe("findNodeFloorViolations — the versions a floor statement may carry", () => {
  const readme = (...lines) => [doc(README_FILE, ...lines)];

  test("the exact floor and a different major in floor context are both accepted", () => {
    // `20.13.0` IS the floor, so it is the sentence the gate wants. `18.0.0` is
    // a different major line, so it is a historical fact rather than a claim
    // about this package's floor, and the rule that fires on a WRONG patch of
    // the declared major must not fire on it.
    expect(
      findNodeFloorViolations(
        readme("The Node.js floor is 20.13.0; 18.0.0 reached end of life."),
        ">=20.13.0",
      ),
    ).toEqual([]);
  });

  test("a wrong patch of the declared major in the same context is still a violation", () => {
    expect(
      findNodeFloorViolations(
        readme("The Node.js floor is 20.13.0.", "The minimum version is 20.9.0."),
        ">=20.13.0",
      ),
    ).toEqual([
      { file: README_FILE, line: 2, rule: "wrong-version", match: "20.9.0", expected: "20.13.0" },
    ]);
  });
});

// ── The entry point, as a process ───────────────────────────────────────────
//
// This does NOT move the coverage number — section 8.5 option (c) is rejected,
// because `NODE_V8_COVERAGE` writes a profile the vitest v8 provider does not
// merge. It is here for the other half of section 8.7: the exit code for a
// passing gate, the substring a reader looks for, and the disk side effects and
// their absence. `check-doc-style` reads the repository and must write nothing
// into it.

describe("check-doc-style as a process — the passing gate's whole observable", () => {
  test("exit 0, the OK line, and not one byte written into the repository", () => {
    const before = new Map(
      ["README.md", "package.json", "docs/writing-standard.md"].map((file) => [
        file,
        readFileSync(join(repoRoot, file), "utf8"),
      ]),
    );
    const rootBefore = readdirSync(repoRoot).toSorted();

    const stdout = execFileSync(process.execPath, [join(scriptDir, "check-doc-style.mjs")], {
      cwd: repoRoot,
      encoding: "utf8",
    });

    // The substring a reader looks for, never the whole rendered block: the
    // wording of a gate's report is program output and moves without a
    // behaviour change.
    expect(stdout).toContain("check-doc-style: OK");
    expect(stdout).toContain("documentation sources");
    for (const [file, source] of before) {
      expect(readFileSync(join(repoRoot, file), "utf8")).toBe(source);
    }
    expect(readdirSync(repoRoot).toSorted()).toEqual(rootBefore);
  });
});

// ── check-docs: the behaviour the gate exists for, through the real tsc ─────
//
// Every piece of this path has a unit test and the path itself had none:
// `planDocBlocks` was measured against its own return value, and
// `attributeDiagnostics` against a hand-written transcript. A transcript is the
// one input that cannot go stale in the same direction as the compiler, so the
// two were free to disagree about the file name a diagnostic carries — which is
// the only thing that maps a compiler error back to a line in a document.
//
// The block imports nothing, so this needs no `dist/`.

describe("check-docs end to end — a documented example that does not compile", () => {
  test("the gate reports block-failures naming the document and its fence line", () => {
    const tsc = join(
      repoRoot,
      "node_modules",
      ".bin",
      process.platform === "win32" ? "tsc.cmd" : "tsc",
    );
    expect(existsSync(tsc)).toBe(true);

    const source = md(
      "# Guide",
      "",
      `${FENCE}ts`,
      'const port: number = "8080";',
      FENCE,
      "",
      `${FENCE}ts no-check`,
      "this is not typescript at all",
      FENCE,
    );
    const plan = planDocBlocks([{ file: "README.md", format: "markdown", source }], "/nowhere");

    // The plan is what the adapter writes: one compiled block, one recorded
    // skip, and both counted.
    expect(plan.blocks).toHaveLength(1);
    expect(plan.skipped).toEqual([{ file: "README.md", line: 7 }]);
    expect(plan.totalTsBlocks).toBe(2);

    const scratch = createScratchDir("tf-round16-docs-");
    let tscOutput = "";
    try {
      mkdirSync(join(scratch.path, "blocks"));
      for (const block of plan.blocks) {
        writeFileSync(join(scratch.path, "blocks", `${block.name}.ts`), block.content, "utf8");
      }
      try {
        execFileSync(
          tsc,
          [
            "--noEmit",
            "--strict",
            "--target",
            "es2022",
            "--module",
            "esnext",
            "--moduleResolution",
            "bundler",
            ...plan.blocks.map((block) => join("blocks", `${block.name}.ts`)),
          ],
          { cwd: scratch.path, encoding: "utf8" },
        );
      } catch (err) {
        tscOutput = `${err.stdout ?? ""}${err.stderr ?? ""}`;
      }

      // The compiler refused it, and the refusal names the block file the plan
      // chose. That agreement is the whole point of this test.
      expect(tscOutput).toContain("error TS2322");
      expect(tscOutput).toContain(`blocks/${plan.blocks[0].name}.ts`);

      const failures = attributeDiagnostics(tscOutput, plan.blocks);
      expect(failures).toHaveLength(1);
      expect(failures[0].file).toBe("README.md");
      // The FENCE line, not a line inside the generated block: line 3 opens the
      // fence and line 4 holds the offending statement.
      expect(failures[0].line).toBe(3);
      expect(failures[0].msg).toContain("is not assignable to type 'number'");

      const verdict = judgeDocs({ plan, tscOutput });
      expect(verdict.kind).toBe("block-failures");
      expect(verdict.failures).toEqual(failures);
    } finally {
      scratch.dispose();
    }

    // The disk side effect and its absence: the scratch directory is gone, and
    // nothing was written next to the sources.
    expect(existsSync(scratch.path)).toBe(false);
    expect(existsSync(join(repoRoot, "blocks"))).toBe(false);
  }, 60_000);
});

// ─────────────────────────────────────────────────────────────────────────
// ROUND 16 — closing the gap to 100%: the pure-function branches the tests
// above do not reach, and `main()` itself for both gates.
//
// Every test here asserts an OUTCOME per section 8.7: an exit code, the
// substring a reader looks for on a failure, a disk side effect or its
// absence, or the one behavior a rule exists to catch. `main()` is driven
// through a real temp directory and a controllable fake `tsc`, never the real
// compiler over the real repository, so this file stays fast.
// ─────────────────────────────────────────────────────────────────────────

/** Write `content` to `root/rel`, creating parent directories as needed. */
function put(root, rel, content) {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
}

/** A throwaway directory, removed after the test regardless of outcome. */
function tempRepo(prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  return { root, dispose: () => rmSync(root, { recursive: true, force: true }) };
}

/** An `io` that records everything instead of touching the real process. */
function recordingIo(overrides = {}) {
  const out = [];
  const err = [];
  let exitCode;
  const io = {
    argv: overrides.argv ?? [],
    cwd: overrides.cwd,
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    exit: (code) => {
      exitCode = code;
    },
  };
  return { io, out, err, exitCode: () => exitCode };
}

/**
 * An executable fake `tsc` under `root/node_modules/.bin`, so a scenario
 * controls the compiler's verdict completely and a coverage test never
 * depends on the real compiler or the real repository.
 */
function installFakeTsc(root, { exitCode = 0, stdout = "" } = {}) {
  const bin = join(root, "node_modules", ".bin", "tsc");
  mkdirSync(dirname(bin), { recursive: true });
  writeFileSync(
    bin,
    `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(stdout)});\nprocess.exit(${exitCode});\n`,
    "utf8",
  );
  chmodSync(bin, 0o755);
}

// ── check-doc-style: prose extraction branches no earlier test reaches ─────

describe("toProseLines (jsdoc) — @internal stripping and private/protected members", () => {
  test("an @internal-tagged export's JSDoc is never scanned", () => {
    const internal = [
      "/**",
      " * This has to stay hidden.",
      " * @internal",
      " */",
      "export function secret() {}",
    ].join("\n");
    expect(
      findVocabularyViolations([{ file: "src/x.ts", format: "jsdoc", source: internal }]),
    ).toEqual([]);
    // Non-vacuity: the identical prose on a NON-internal export is flagged.
    const unmarked = internal.replace(" * @internal\n", "");
    expect(
      findVocabularyViolations([{ file: "src/x.ts", format: "jsdoc", source: unmarked }]),
    ).toEqual([{ file: "src/x.ts", line: 2, rule: "normative-synonym", match: "has to" }]);
  });

  test("a private or protected class member's JSDoc is skipped; a public member's is kept", () => {
    const source = [
      "export class Widget {",
      "  /** This has to stay hidden. */",
      "  private secret() {}",
      "  /** This also has to stay hidden. */",
      "  protected guarded() {}",
      "  /** This has to stay hidden too. */",
      "  #alsoHidden() {}",
      "  /** This has to be public. */",
      "  visible() {}",
      "}",
    ].join("\n");
    const violations = findVocabularyViolations([
      { file: "src/widget.ts", format: "jsdoc", source },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0].match).toBe("has to");
    // Line 8 is the JSDoc line above the one PUBLIC member, `visible()`.
    expect(violations[0].line).toBe(8);
  });
});

describe("findVocabularyViolations — the writing standard's own exemption", () => {
  test("docs/writing-standard.md is never scanned, by construction", () => {
    expect(VOCABULARY_EXEMPT_FILES).toEqual([WRITING_STANDARD_FILE]);
    const source = "The request was canceled without warning.";
    expect(
      findVocabularyViolations([{ file: WRITING_STANDARD_FILE, format: "markdown", source }]),
    ).toEqual([]);
    // Non-vacuity: the identical text anywhere else is flagged.
    expect(
      findVocabularyViolations([{ file: "OTHER.md", format: "markdown", source }]).map(
        (v) => v.rule,
      ),
    ).toEqual(["request-canceled"]);
  });
});

// ── check-doc-style: findRelativeLinks' remaining target shapes ────────────

describe("findRelativeLinks — inline, reference, and fragment link forms", () => {
  test("an inline link, a reference definition, a fragment, and an empty target", () => {
    const source = [
      "See [the license](./LICENSE) and [the site](https://example.test/x).",
      "A [same-page link](#usage) is never flagged.",
      '<a href="">empty target</a>',
      "",
      "[ref]: ./docs/guide.md",
    ].join("\n");
    expect(findRelativeLinks(source)).toEqual([
      { line: 1, target: "./LICENSE" },
      { line: 5, target: "./docs/guide.md" },
    ]);
  });
});

// ── check-doc-style: the Terms-table relation, driven directly ─────────────

describe("diffTermsTables and termsAgree — the relation main() renders", () => {
  test("a null table on either side reports unparsed, and nothing else", () => {
    const rows = [{ term: "Copy", meaning: "One instance of a message." }];
    expect(diffTermsTables(null, rows)).toEqual({
      missing: [],
      extra: [],
      misordered: false,
      meaningDrift: [],
      unparsed: [README_FILE],
    });
    expect(diffTermsTables(rows, null)).toEqual({
      missing: [],
      extra: [],
      misordered: false,
      meaningDrift: [],
      unparsed: [WRITING_STANDARD_FILE],
    });
    expect(termsAgree(diffTermsTables(null, null))).toBe(false);
  });

  test("a missing term, an extra term, and a drifted meaning are reported together", () => {
    const standard = [
      { term: "Copy", meaning: "One instance of a message." },
      { term: "Abort", meaning: "Stop a request before it completes." },
    ];
    const readme = [
      { term: "Copy", meaning: "A totally different sentence." },
      { term: "Extra", meaning: "Not part of the standard." },
    ];
    const diff = diffTermsTables(readme, standard);
    expect(diff.missing).toEqual(["Abort"]);
    expect(diff.extra).toEqual(["Extra"]);
    expect(diff.meaningDrift).toEqual(["Copy"]);
    expect(diff.misordered).toBe(false);
    expect(termsAgree(diff)).toBe(false);
  });

  test("the same terms in a different order are misordered, with nothing missing or extra", () => {
    const standard = [
      { term: "Copy", meaning: "One instance." },
      { term: "Abort", meaning: "Stop a request." },
    ];
    const readme = [
      { term: "Abort", meaning: "Stop a request." },
      { term: "Copy", meaning: "One instance." },
    ];
    const diff = diffTermsTables(readme, standard);
    expect(diff.misordered).toBe(true);
    expect(diff.missing).toEqual([]);
    expect(diff.extra).toEqual([]);
    expect(termsAgree(diff)).toBe(false);
  });

  test("identical tables agree", () => {
    const rows = [{ term: "Copy", meaning: "One instance." }];
    expect(termsAgree(diffTermsTables(rows, rows))).toBe(true);
  });
});

// ── check-doc-style: findNodeFloorViolations' remaining branches ───────────

describe("findNodeFloorViolations — the branches no main()-driven scenario reaches alone", () => {
  test("a malformed engines.node range is its own violation, at no file line", () => {
    expect(findNodeFloorViolations([], "^20")).toEqual([
      { file: "package.json", line: 0, rule: "invalid-range", match: "^20", expected: ">=X.Y.Z" },
    ]);
  });

  test("a file outside NODE_FLOOR_FILES is never scanned", () => {
    expect(NODE_FLOOR_FILES.includes("docs/random.md")).toBe(false);
    const docs = [{ file: "docs/random.md", source: "Node 18+." }];
    expect(findNodeFloorViolations(docs, ">=20.13.0")).toEqual([]);
  });

  test("a line with no floor claim at all is skipped, not a violation", () => {
    const docs = [
      {
        file: README_FILE,
        source: ["The Node.js floor is 20.13.0.", "Nothing here mentions a version."].join("\n"),
      },
    ];
    expect(findNodeFloorViolations(docs, ">=20.13.0")).toEqual([]);
  });

  test("a missing exact floor is reported once per file, at line 0", () => {
    const docs = [{ file: README_FILE, source: "This package supports current Node." }];
    expect(findNodeFloorViolations(docs, ">=20.13.0")).toEqual([
      { file: README_FILE, line: 0, rule: "missing-exact", match: "", expected: "20.13.0" },
    ]);
  });
});

// ── check-docs: the two pure helpers no earlier test calls ─────────────────

describe("findRelativeExampleUrls and jsdocToMarkdown — the helpers main() composes", () => {
  test("a relative typedFetch URL is found; an absolute one and a computed one are not", () => {
    const blocks = [
      { file: "README.md", line: 3, code: 'typedFetch("/api/users");' },
      { file: "README.md", line: 8, code: 'typedFetch("https://api.example.com/x");' },
      { file: "README.md", line: 13, code: "typedFetch(`${BASE}${path}`);" },
    ];
    expect(findRelativeExampleUrls(blocks)).toEqual([
      { file: "README.md", line: 3, url: "/api/users" },
    ]);
  });

  test("jsdocToMarkdown strips exactly one leading `* ` per line", () => {
    const source = ["/**", " * A fenced example follows.", " */"].join("\n");
    expect(jsdocToMarkdown(source)).toBe(["/**", "A fenced example follows.", "/"].join("\n"));
  });
});

// ── check-docs: attributeDiagnostics' dedup and unknown-block branches ─────

describe("attributeDiagnostics — an unattributable line and a duplicate diagnostic", () => {
  test("a diagnostic naming an unknown block is dropped, and a duplicate counts once", () => {
    const blocks = [{ name: "README_md__L3__b0", file: "README.md", line: 3, content: "" }];
    const tscOutput = [
      "blocks/OTHER_md__L1__b0.ts(1,1): error TS9999: unrelated block",
      "blocks/README_md__L3__b0.ts(4,20): error TS2339: Property 'x' does not exist.",
      "blocks/README_md__L3__b0.ts(4,20): error TS2339: Property 'x' does not exist.",
    ].join("\n");
    const failures = attributeDiagnostics(tscOutput, blocks);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toEqual({
      file: "README.md",
      line: 3,
      msg: "error TS2339: Property 'x' does not exist.",
    });
  });
});

// ── check-docs: planDocBlocks' unterminated and historical-placement rules ─

describe("planDocBlocks — an unterminated fence and the historical marker's placement", () => {
  test("an unterminated fence is counted, and excluded from every other bucket", () => {
    const source = ["# Doc", "", "```ts", "const x = 1;"].join("\n");
    const plan = planDocBlocks([{ file: "README.md", format: "markdown", source }], "/nowhere");
    expect(plan.unterminated).toEqual([{ file: "README.md", line: 3 }]);
    expect(plan.blocks).toEqual([]);
    expect(plan.totalTsBlocks).toBe(1);
  });

  test("a historical block in CHANGELOG.md is historical; the same block elsewhere is misplaced", () => {
    const source = ["# Log", "", "```ts historical", "old();", "```"].join("\n");
    const inChangelog = planDocBlocks(
      [{ file: "CHANGELOG.md", format: "markdown", source }],
      "/nowhere",
    );
    expect(inChangelog.historical).toEqual([{ file: "CHANGELOG.md", line: 3 }]);
    expect(inChangelog.historicalMisplaced).toEqual([]);

    const inReadme = planDocBlocks([{ file: "README.md", format: "markdown", source }], "/nowhere");
    expect(inReadme.historical).toEqual([]);
    expect(inReadme.historicalMisplaced).toEqual([{ file: "README.md", line: 3 }]);
  });
});

// ── check-docs: judgeDocs' every verdict kind, driven directly ─────────────

describe("judgeDocs — every verdict kind and its precedence, driven directly", () => {
  const emptyPlan = () => ({
    blocks: [],
    skipped: [],
    historical: [],
    historicalMisplaced: [],
    unterminated: [],
    exampleBlocks: [],
    totalTsBlocks: 0,
  });

  test("a missing roster document outranks an unterminated fence", () => {
    const plan = emptyPlan();
    plan.unterminated = [{ file: "X.md", line: 1 }];
    expect(judgeDocs({ plan, tscOutput: null, missing: ["README.md"] }).kind).toBe(
      "missing-documents",
    );
  });

  test("an unterminated fence outranks a misplaced historical block", () => {
    const plan = emptyPlan();
    plan.unterminated = [{ file: "X.md", line: 1 }];
    plan.historicalMisplaced = [{ file: "Y.md", line: 2 }];
    expect(judgeDocs({ plan, tscOutput: null }).kind).toBe("unterminated-fence");
  });

  test("a misplaced historical block outranks a tsc failure", () => {
    const plan = emptyPlan();
    plan.historicalMisplaced = [{ file: "Y.md", line: 2 }];
    expect(judgeDocs({ plan, tscOutput: "boom" }).kind).toBe("historical-misplaced");
  });

  test("TS5112 in tsc output outranks an attributed failure", () => {
    const plan = emptyPlan();
    expect(judgeDocs({ plan, tscOutput: "error TS5112: config" }).kind).toBe(
      "tsc-config-regression",
    );
  });

  test("a failing tsc with nothing attributable is unattributable", () => {
    const plan = emptyPlan();
    expect(judgeDocs({ plan, tscOutput: "an internal compiler crash" }).kind).toBe(
      "unattributable",
    );
  });

  test("a relative example URL outranks the skip ratio", () => {
    const plan = emptyPlan();
    plan.exampleBlocks = [{ file: "README.md", line: 3, code: 'typedFetch("/x");' }];
    plan.totalTsBlocks = 3;
    plan.skipped = [
      { file: "README.md", line: 5 },
      { file: "README.md", line: 9 },
    ];
    expect(judgeDocs({ plan, tscOutput: null }).kind).toBe("example-urls");
  });

  test("a skip ratio at the maximum passes; above the maximum it fails", () => {
    const plan = emptyPlan();
    plan.totalTsBlocks = 2;
    plan.skipped = [{ file: "README.md", line: 5 }];
    // 1/2 = 0.5, exactly MAX_SKIP_RATIO: not a violation (a strict `>` check).
    expect(judgeDocs({ plan, tscOutput: null }).kind).toBe("ok");
    plan.totalTsBlocks = 3;
    plan.skipped = [
      { file: "README.md", line: 5 },
      { file: "README.md", line: 9 },
    ];
    const verdict = judgeDocs({ plan, tscOutput: null });
    expect(verdict.kind).toBe("skip-ratio");
    expect(verdict.skipRatio).toBeCloseTo(2 / 3);
  });

  test("a checkable count at or below zero never divides by zero", () => {
    const plan = emptyPlan();
    plan.totalTsBlocks = 1;
    plan.historical = [{ file: "CHANGELOG.md", line: 1 }];
    expect(judgeDocs({ plan, tscOutput: null }).kind).toBe("ok");
  });
});

// ── check-docs: gatherDocSources — the docs/src globs and a missing file ───

describe("gatherDocSources — nested directories, a non-matching extension, and a missing file", () => {
  test("docs/ and src/ recurse into subdirectories, skipping a non-matching extension", () => {
    const { root, dispose } = tempRepo("tf-round16-gather-docs-");
    try {
      for (const file of DOC_MARKDOWN_SOURCES) put(root, file, `# ${file}\n`);
      put(root, "docs/guide.md", "# Guide\n");
      put(root, "docs/nested/inner.md", "# Inner\n");
      put(root, "docs/notes.txt", "not markdown\n");
      put(root, "src/example.ts", "// example\n");
      put(root, "src/nested/deep.ts", "// deep\n");
      put(root, "src/notes.txt", "not typescript\n");
      const { docs, missing } = gatherDocSources(root);
      expect(missing).toEqual([]);
      const files = docs.map((d) => d.file).toSorted();
      expect(files).toContain("docs/guide.md");
      expect(files).toContain("docs/nested/inner.md");
      expect(files).toContain("src/example.ts");
      expect(files).toContain("src/nested/deep.ts");
      expect(files).not.toContain("docs/notes.txt");
      expect(files).not.toContain("src/notes.txt");
    } finally {
      dispose();
    }
  });

  test("a roster file absent from disk is reported missing, and never read", () => {
    const { root, dispose } = tempRepo("tf-round16-gather-docs-missing-");
    try {
      for (const file of DOC_MARKDOWN_SOURCES.slice(1)) put(root, file, `# ${file}\n`);
      mkdirSync(join(root, "docs"), { recursive: true });
      mkdirSync(join(root, "src"), { recursive: true });
      const { docs, missing } = gatherDocSources(root);
      expect(missing).toEqual(["README.md"]);
      expect(docs.map((d) => d.file)).not.toContain("README.md");
    } finally {
      dispose();
    }
  });
});

// ── check-doc-style: gatherStyleDocs — the same adapter shape ──────────────

describe("gatherStyleDocs — nested directories, a non-matching extension, and a missing file", () => {
  test("docs/ and src/ recurse into subdirectories, skipping a non-matching extension", () => {
    const { root, dispose } = tempRepo("tf-round16-gather-style-");
    try {
      for (const file of STYLE_MARKDOWN_SOURCES) put(root, file, `# ${file}\n`);
      put(root, "docs/guide.md", "# Guide\n");
      put(root, "docs/nested/inner.md", "# Inner\n");
      put(root, "docs/notes.txt", "not markdown\n");
      put(root, "src/example.ts", "// example\n");
      put(root, "src/nested/deep.ts", "// deep\n");
      put(root, "src/notes.txt", "not typescript\n");
      const { docs, missingFiles } = gatherStyleDocs(root);
      expect(missingFiles).toEqual([]);
      const files = docs.map((d) => d.file).toSorted();
      expect(files).toContain("docs/guide.md");
      expect(files).toContain("docs/nested/inner.md");
      expect(files).toContain("src/example.ts");
      expect(files).toContain("src/nested/deep.ts");
      expect(files).not.toContain("docs/notes.txt");
      expect(files).not.toContain("src/notes.txt");
    } finally {
      dispose();
    }
  });

  test("a roster file absent from disk is reported missing, and never read", () => {
    const { root, dispose } = tempRepo("tf-round16-gather-style-missing-");
    try {
      for (const file of STYLE_MARKDOWN_SOURCES.slice(1)) put(root, file, `# ${file}\n`);
      mkdirSync(join(root, "docs"), { recursive: true });
      mkdirSync(join(root, "src"), { recursive: true });
      const { docs, missingFiles } = gatherStyleDocs(root);
      expect(missingFiles).toEqual(["README.md"]);
      expect(docs.map((d) => d.file)).not.toContain("README.md");
    } finally {
      dispose();
    }
  });
});

// ── check-docs: main(), driven end to end through a fake tsc ───────────────

function scaffoldDocsRepo(root) {
  for (const file of DOC_MARKDOWN_SOURCES) put(root, file, `# ${file}\n`);
  put(root, "docs/guide.md", "# Guide\n");
  put(root, "src/example.ts", "// example\n");
  for (const rel of REQUIRED_DIST_ENTRIES) put(root, join("dist", rel), "export {};\n");
}

function makeDocsRepo({ tsc = { exitCode: 0, stdout: "" }, files = {}, omit = [] } = {}) {
  const { root, dispose } = tempRepo("tf-round16-check-docs-");
  scaffoldDocsRepo(root);
  for (const rel of omit) rmSync(join(root, rel), { force: true });
  for (const [rel, content] of Object.entries(files)) put(root, rel, content);
  installFakeTsc(root, tsc);
  return { root, dispose };
}

describe("check-docs main() — every verdict kind, through a temp repo and a controllable fake tsc", () => {
  test("a missing dist/ entry exits 1 before tsc is ever needed", () => {
    const { root, dispose } = tempRepo("tf-round16-docs-nodist-");
    try {
      mkdirSync(join(root, "dist"), { recursive: true });
      writeFileSync(join(root, "dist", "index.js"), "export {};\n");
      const { io, err, exitCode } = recordingIo({ cwd: root });
      checkDocsMain(io);
      expect(exitCode()).toBe(1);
      const text = err.join("\n");
      expect(text).toContain("check-docs: dist/ is missing or incomplete.");
      expect(text).toContain(join(root, "dist", "index.d.ts"));
    } finally {
      dispose();
    }
  });

  test("tsc missing from node_modules/.bin exits 1 naming the expected path", () => {
    const { root, dispose } = tempRepo("tf-round16-docs-notsc-");
    try {
      scaffoldDocsRepo(root); // dist/ complete; installFakeTsc is never called
      const { io, err, exitCode } = recordingIo({ cwd: root });
      checkDocsMain(io);
      expect(exitCode()).toBe(1);
      expect(err.join("\n")).toContain("tsc not found at");
    } finally {
      dispose();
    }
  });

  test("a roster document absent from disk exits 1 naming it", () => {
    const repo = makeDocsRepo({ omit: ["README.md"] });
    try {
      const { io, err, exitCode } = recordingIo({ cwd: repo.root });
      checkDocsMain(io);
      expect(exitCode()).toBe(1);
      const text = err.join("\n");
      expect(text).toContain("documentation file(s) named in the roster are not on disk");
      expect(text).toContain("README.md");
    } finally {
      repo.dispose();
    }
  }, 20_000);

  test("an unclosed fence exits 1 naming the file and the fence line", () => {
    const repo = makeDocsRepo({ files: { "CONTEXT.md": "# Doc\n\n```ts\nconst x = 1;\n" } });
    try {
      const { io, err, exitCode } = recordingIo({ cwd: repo.root });
      checkDocsMain(io);
      expect(exitCode()).toBe(1);
      const text = err.join("\n");
      expect(text).toContain("a fenced block is never closed");
      expect(text).toContain("CONTEXT.md:3");
    } finally {
      repo.dispose();
    }
  }, 20_000);

  test("a historical marker outside CHANGELOG.md exits 1 naming the block", () => {
    const repo = makeDocsRepo({
      files: { "CONTEXT.md": "# Doc\n\n```ts historical\nconst x = 1;\n```\n" },
    });
    try {
      const { io, err, exitCode } = recordingIo({ cwd: repo.root });
      checkDocsMain(io);
      expect(exitCode()).toBe(1);
      const text = err.join("\n");
      expect(text).toContain("is valid only in");
      expect(text).toContain("CONTEXT.md:3");
    } finally {
      repo.dispose();
    }
  }, 20_000);

  test("TS5112 in tsc output aborts as a config regression, never as a parsed failure", () => {
    const repo = makeDocsRepo({
      tsc: { exitCode: 1, stdout: "error TS5112: root tsconfig leaked\n" },
    });
    try {
      const { io, err, exitCode } = recordingIo({ cwd: repo.root });
      checkDocsMain(io);
      expect(exitCode()).toBe(1);
      expect(err.join("\n")).toContain("tsc emitted TS5112");
    } finally {
      repo.dispose();
    }
  }, 20_000);

  test("a failing tsc with no attributable diagnostic prints the raw output", () => {
    const repo = makeDocsRepo({ tsc: { exitCode: 1, stdout: "an internal compiler crash\n" } });
    try {
      const { io, err, exitCode } = recordingIo({ cwd: repo.root });
      checkDocsMain(io);
      expect(exitCode()).toBe(1);
      const text = err.join("\n");
      expect(text).toContain("tsc failed but no block diagnostics were parsed");
      expect(text).toContain("an internal compiler crash");
    } finally {
      repo.dispose();
    }
  }, 20_000);

  test("a documented block that fails to typecheck exits 1 naming the fence", () => {
    const repo = makeDocsRepo({
      files: { "CONTEXT.md": '# Doc\n\n```ts\nconst x: number = "nope";\n```\n' },
      tsc: { exitCode: 1, stdout: "blocks/CONTEXT_md__L3__b0.ts(1,7): error TS2322: bad type\n" },
    });
    try {
      const { io, err, exitCode } = recordingIo({ cwd: repo.root });
      checkDocsMain(io);
      expect(exitCode()).toBe(1);
      const text = err.join("\n");
      expect(text).toContain("documentation block(s) FAILED to typecheck");
      expect(text).toContain("CONTEXT.md (fence at line 3): error TS2322: bad type");
    } finally {
      repo.dispose();
    }
  }, 20_000);

  test("a relative example URL exits 1, only after tsc succeeds", () => {
    const repo = makeDocsRepo({
      files: { "CONTEXT.md": '# Doc\n\n```ts\ntypedFetch("/api/users");\n```\n' },
    });
    try {
      const { io, err, exitCode } = recordingIo({ cwd: repo.root });
      checkDocsMain(io);
      expect(exitCode()).toBe(1);
      const text = err.join("\n");
      expect(text).toContain("example request URL(s) are not absolute");
      expect(text).toContain('typedFetch("/api/users")');
    } finally {
      repo.dispose();
    }
  }, 20_000);

  test("a skip ratio above the maximum exits 1", () => {
    const repo = makeDocsRepo({
      files: {
        "CONTEXT.md": [
          "# Doc",
          "",
          "```ts",
          "const a = 1;",
          "```",
          "",
          "```ts no-check",
          "not valid ts;",
          "```",
          "",
          "```ts no-check",
          "also not valid;",
          "```",
        ].join("\n"),
      },
    });
    try {
      const { io, err, exitCode } = recordingIo({ cwd: repo.root });
      checkDocsMain(io);
      expect(exitCode()).toBe(1);
      const text = err.join("\n");
      expect(text).toContain("skip ratio");
      expect(text).toContain("exceeds");
    } finally {
      repo.dispose();
    }
  }, 20_000);

  test("a passing gate prints the summary — including skipped and historical blocks — and returns", () => {
    const repo = makeDocsRepo({
      files: {
        "CONTEXT.md": [
          "# Doc",
          "",
          "```ts",
          "const a = 1;",
          "```",
          "",
          "```ts no-check",
          "not valid ts;",
          "```",
        ].join("\n"),
        "CHANGELOG.md": ["# Log", "", "```ts historical", "old();", "```"].join("\n"),
      },
    });
    try {
      const before = readdirSync(repo.root).toSorted();
      const { io, out, exitCode } = recordingIo({ cwd: repo.root });
      checkDocsMain(io);
      expect(exitCode()).toBeUndefined();
      const text = out.join("\n");
      expect(text).toContain("check-docs: OK");
      expect(text).toContain("Skipped blocks");
      expect(text).toContain("Historical blocks");
      // The scratch directory is gone, and nothing new appeared next to the repo.
      expect(readdirSync(repo.root).toSorted()).toEqual(before);
    } finally {
      repo.dispose();
    }
  }, 20_000);
});

// ── check-doc-style: main(), driven end to end ──────────────────────────────

const FLOOR = "20.13.0";
const FLOOR_SENTENCE = `The Node.js floor is ${FLOOR}.`;

function termsBlock(rows) {
  return [
    "| Term | Meaning |",
    "| --- | --- |",
    ...rows.map((r) => `| ${r.term} | ${r.meaning} |`),
  ].join("\n");
}

function styleBaseFiles({ readmeTerms, standardTerms } = {}) {
  const standard = standardTerms ?? [{ term: "Copy", meaning: "One instance of a message." }];
  const readme = readmeTerms ?? standard;
  return {
    "README.md": ["# typed-fetch", "", termsBlock(readme), "", FLOOR_SENTENCE, ""].join("\n"),
    "CHANGELOG.md": "# Changelog\n",
    "CONTRIBUTING.md": `# Contributing\n\n${FLOOR_SENTENCE}\n`,
    "CONTEXT.md": "# Context\n",
    "RELEASING.md": `# Releasing\n\n${FLOOR_SENTENCE}\n`,
    "skills/typed-fetch/SKILL.md": `# Skill\n\n${FLOOR_SENTENCE}\n`,
    ".claude/skills/typed-fetch-maintainer/SKILL.md": `# Maintainer skill\n\n${FLOOR_SENTENCE}\n`,
    "docs/writing-standard.md": ["# Writing standard", "", termsBlock(standard), ""].join("\n"),
    "docs/audit-ledger.md": `# Ledger\n\n${FLOOR_SENTENCE}\n`,
  };
}

function makeStyleRepo({ omit = [], files = {}, terms } = {}) {
  const { root, dispose } = tempRepo("tf-round16-check-doc-style-");
  const base = styleBaseFiles(terms);
  for (const [rel, content] of Object.entries({ ...base, ...files })) put(root, rel, content);
  mkdirSync(join(root, "src"), { recursive: true });
  put(root, "package.json", JSON.stringify({ engines: { node: `>=${FLOOR}` } }));
  for (const rel of omit) rmSync(join(root, rel), { force: true });
  return { root, dispose };
}

describe("check-doc-style main() — every printer branch, through a temp repo", () => {
  test("a missing file, a relative link, a vocabulary hit, unparsed terms, and both node-floor rules", () => {
    const repo = makeStyleRepo({
      omit: [".claude/skills/typed-fetch-maintainer/SKILL.md"],
      files: {
        "README.md": [
          "# typed-fetch",
          "",
          "See [the license](./LICENSE) for details.",
          "",
          "This canceled the request unexpectedly.",
          "",
          FLOOR_SENTENCE,
          "",
        ].join("\n"),
        "CONTRIBUTING.md": "# Contributing\n\nRequires Node 20+.\n",
      },
    });
    try {
      const { io, err, out, exitCode } = recordingIo({ cwd: repo.root });
      checkDocStyleMain(io);
      const text = err.join("\n");
      expect(exitCode()).toBe(1);
      expect(text).toContain("1 documentation file(s) missing");
      expect(text).toContain(".claude/skills/typed-fetch-maintainer/SKILL.md");
      expect(text).toContain("relative link(s) in README.md");
      expect(text).toContain("./LICENSE");
      expect(text).toContain("controlled-vocabulary violation(s)");
      expect(text).toContain("[cancel-request]");
      expect(text).toContain("no Terms table found in : README.md");
      expect(text).toContain("Node.js floor violation(s)");
      expect(text).toContain("[missing-exact] expected 20.13.0");
      expect(text).toContain('[major-only] "Node 20+"');
      expect(out.join("\n")).toContain("check-doc-style: scanned");
    } finally {
      repo.dispose();
    }
  });

  test("Terms drift: a missing term, an extra term, and a drifted meaning", () => {
    const repo = makeStyleRepo({
      terms: {
        standardTerms: [
          { term: "Copy", meaning: "One instance of a message." },
          { term: "Abort", meaning: "Stop a request before it completes." },
        ],
        readmeTerms: [
          { term: "Copy", meaning: "A totally different sentence." },
          { term: "Extra", meaning: "Not part of the standard." },
        ],
      },
    });
    try {
      const { io, err, exitCode } = recordingIo({ cwd: repo.root });
      checkDocStyleMain(io);
      const text = err.join("\n");
      expect(exitCode()).toBe(1);
      expect(text).toContain("missing from README    : Abort");
      expect(text).toContain("not in the standard    : Extra");
      expect(text).toContain("meaning has drifted    : Copy");
      expect(text).not.toContain("documentation file(s) missing");
      expect(text).not.toContain("relative link(s)");
      expect(text).not.toContain("controlled-vocabulary violation(s)");
      expect(text).not.toContain("Node.js floor violation(s)");
    } finally {
      repo.dispose();
    }
  });

  test("Terms drift: the same terms, reordered", () => {
    const repo = makeStyleRepo({
      terms: {
        standardTerms: [
          { term: "Copy", meaning: "One instance of a message." },
          { term: "Abort", meaning: "Stop a request before it completes." },
        ],
        readmeTerms: [
          { term: "Abort", meaning: "Stop a request before it completes." },
          { term: "Copy", meaning: "One instance of a message." },
        ],
      },
    });
    try {
      const { io, err, exitCode } = recordingIo({ cwd: repo.root });
      checkDocStyleMain(io);
      const text = err.join("\n");
      expect(exitCode()).toBe(1);
      expect(text).toContain("the two tables carry the same terms in a different order");
      expect(text).not.toContain("missing from README");
      expect(text).not.toContain("not in the standard");
      expect(text).not.toContain("meaning has drifted");
    } finally {
      repo.dispose();
    }
  });

  test("a passing gate prints OK, writes nothing to disk, and returns without exiting", () => {
    const repo = makeStyleRepo();
    try {
      const before = readdirSync(repo.root).toSorted();
      const { io, out, err, exitCode } = recordingIo({ cwd: repo.root });
      checkDocStyleMain(io);
      expect(exitCode()).toBeUndefined();
      expect(err).toEqual([]);
      expect(out.join("\n")).toContain("check-doc-style: OK");
      expect(readdirSync(repo.root).toSorted()).toEqual(before);
    } finally {
      repo.dispose();
    }
  });
});

// ── defaultIo — tested as VALUES, not through main()'s control flow ────────
//
// `defaultIo` is exported for exactly this: its three members are ordinary
// functions, and asserting what each one does needs no repository, no
// temp directory, and no run of `main` at all.

describe("defaultIo (check-docs.mjs) — each member, tested directly", () => {
  test("out writes the given line to standard output", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      checkDocsDefaultIo.out("a line");
      expect(logSpy).toHaveBeenCalledWith("a line");
    } finally {
      logSpy.mockRestore();
    }
  });

  test("err writes the given line to standard error", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      checkDocsDefaultIo.err("a line");
      expect(errSpy).toHaveBeenCalledWith("a line");
    } finally {
      errSpy.mockRestore();
    }
  });

  test("exit calls process.exit with the code it names", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined);
    try {
      checkDocsDefaultIo.exit(1);
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      exitSpy.mockRestore();
    }
  });
});

describe("defaultIo (check-doc-style.mjs) — each member, tested directly", () => {
  test("out writes the given line to standard output", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      checkDocStyleDefaultIo.out("a line");
      expect(logSpy).toHaveBeenCalledWith("a line");
    } finally {
      logSpy.mockRestore();
    }
  });

  test("err writes the given line to standard error", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      checkDocStyleDefaultIo.err("a line");
      expect(errSpy).toHaveBeenCalledWith("a line");
    } finally {
      errSpy.mockRestore();
    }
  });

  test("exit calls process.exit with the code it names", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined);
    try {
      checkDocStyleDefaultIo.exit(1);
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      exitSpy.mockRestore();
    }
  });
});

// ── The guard, when each module really is the entry point ──────────────────
//
// `if (isMainModule(import.meta.url)) main();` has only ever been evaluated
// as FALSE in this file: every other test drives `main` directly, so the
// module is always imported, never started. `isMainModule` compares
// `process.argv[1]` against its own `import.meta.url`, and only the first of
// those is mutable from a spec. Pointing `argv[1]` at the file's own real
// path and re-importing it under a cache-busting query makes the guard true
// FOR REAL, in this same process — no subprocess, so this run counts toward
// the file's own coverage (the technique `scripts/round16-smoke-entry.spec.mjs`
// already uses for `scripts/smoke/node-min.mjs`). The re-import drives the
// production call site's `defaultIo`, so the real repository is read (its own
// gates already pass, verified independently by `pnpm check-docs` and
// `pnpm check-doc-style`), and console/exit are mocked first so nothing is
// printed and nothing kills the worker.

/**
 * Replace each `[object, key]` target for the duration of `fn`, recording
 * every call, then restore the original.
 *
 * `vi.spyOn` does not reliably see a call made from a module that is
 * dynamically re-imported under a cache-busting query: proven empirically —
 * a plain property reassignment observes the call and a `vi.spyOn` wrapper
 * installed the same way, on the same object, at the same point, does not.
 * A manual reassignment is the one technique confirmed to cross that
 * boundary, so the guard tests below use it instead of `vi.spyOn`.
 * @param {[Record<string, unknown>, string][]} targets
 * @param {() => Promise<unknown>} fn
 * @returns {Promise<unknown[][]>} one call-args array per target, in order
 */
async function withPatched(targets, fn) {
  const originals = targets.map(([obj, key]) => [obj, key, obj[key]]);
  const calls = originals.map(() => []);
  originals.forEach(([obj, key], i) => {
    obj[key] = (...args) => {
      calls[i].push(args);
    };
  });
  try {
    await fn();
  } finally {
    for (const [obj, key, original] of originals) obj[key] = original;
  }
  return calls;
}

describe("the guard, run as the real entry point", () => {
  test("check-docs.mjs: isMainModule reports true and the default io runs the real gate", async () => {
    const entryPath = fileURLToPath(new URL("./check-docs.mjs", import.meta.url));
    const previousArgv1 = process.argv[1];
    process.argv[1] = entryPath;
    let logCalls;
    let exitCalls;
    try {
      [logCalls, , exitCalls] = await withPatched(
        [
          [console, "log"],
          [console, "error"],
          [process, "exit"],
        ],
        () => import("./check-docs.mjs?round16-guard-check"),
      );
    } finally {
      process.argv[1] = previousArgv1;
    }
    expect(logCalls.length).toBeGreaterThan(0);
    expect(exitCalls).toEqual([]);
  }, 30_000);

  test("check-doc-style.mjs: isMainModule reports true and the default io runs the real gate", async () => {
    const entryPath = fileURLToPath(new URL("./check-doc-style.mjs", import.meta.url));
    const previousArgv1 = process.argv[1];
    process.argv[1] = entryPath;
    let logCalls;
    let exitCalls;
    try {
      [logCalls, , exitCalls] = await withPatched(
        [
          [console, "log"],
          [console, "error"],
          [process, "exit"],
        ],
        () => import("./check-doc-style.mjs?round16-guard-check"),
      );
    } finally {
      process.argv[1] = previousArgv1;
    }
    expect(logCalls.length).toBeGreaterThan(0);
    expect(exitCalls).toEqual([]);
  }, 30_000);
});

// ── check-doc-style: maskFencedBlocks' own fence-matching branch ───────────

describe("toProseLines — a real fenced block, not only a code span", () => {
  test("a fenced block is masked, so a vocabulary phrase inside it is not scanned", () => {
    const source = [
      "Text before.",
      "```ts",
      "// This has to be inside a fence.",
      "```",
      "This has to be outside.",
    ].join("\n");
    const violations = findVocabularyViolations([{ file: "OTHER.md", format: "markdown", source }]);
    expect(violations.map((v) => v.line)).toEqual([5]);
  });
});

// ── check-doc-style: parseTermsTable's remaining branches ──────────────────

describe("parseTermsTable — a non-Term table first, and a header with no next line", () => {
  test("a differently-headed table is skipped; scanning continues to the real Term table", () => {
    const source = [
      "| Name | Value |",
      "| --- | --- |",
      "| x | 1 |",
      "",
      "| Term | Meaning |",
      "| --- | --- |",
      "| Copy | One instance. |",
    ].join("\n");
    expect(parseTermsTable(source)).toEqual([{ term: "Copy", meaning: "One instance." }]);
  });

  test("a Term header as the last line has no next row, and is an empty table", () => {
    expect(parseTermsTable("| Term | Meaning |")).toEqual([]);
  });
});

// ── check-docs main(): the win32 tsc binary name, and a spawn that fails ───

describe("check-docs main() — the platform-specific binary name and a spawn failure", () => {
  test("on win32, the gate looks for tsc.cmd instead of tsc", () => {
    const original = process.platform;
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    try {
      const repo = makeDocsRepo();
      try {
        rmSync(join(repo.root, "node_modules", ".bin", "tsc"), { force: true });
        const { io, err, exitCode } = recordingIo({ cwd: repo.root });
        checkDocsMain(io);
        expect(exitCode()).toBe(1);
        expect(err.join("\n")).toContain(join("node_modules", ".bin", "tsc.cmd"));
      } finally {
        repo.dispose();
      }
    } finally {
      Object.defineProperty(process, "platform", { value: original, configurable: true });
    }
  });

  test("a tsc binary that cannot even spawn folds into 'no diagnostics parsed'", () => {
    const repo = makeDocsRepo();
    const bin = join(repo.root, "node_modules", ".bin", "tsc");
    // Unlike a real compile failure, a spawn failure (EACCES: no execute
    // permission) leaves the thrown error with no stdout/stderr at all, so
    // `${err.stdout ?? ""}${err.stderr ?? ""}` falls back on both sides.
    writeFileSync(bin, "#!/usr/bin/env node\n", "utf8");
    chmodSync(bin, 0o000);
    try {
      const { io, err, exitCode } = recordingIo({ cwd: repo.root });
      checkDocsMain(io);
      expect(exitCode()).toBe(1);
      expect(err.join("\n")).toContain("tsc failed but no block diagnostics were parsed");
    } finally {
      chmodSync(bin, 0o755);
      repo.dispose();
    }
  }, 20_000);
});

// ── check-doc-style main(): README.md, the standard, and engines.node absent ─

describe("check-doc-style main() — README, the standard, and engines.node all absent", () => {
  test("main() falls back to empty sources and an invalid range without crashing", () => {
    const repo = makeStyleRepo({ omit: ["README.md", "docs/writing-standard.md"] });
    put(repo.root, "package.json", JSON.stringify({}));
    try {
      const { io, err, exitCode } = recordingIo({ cwd: repo.root });
      checkDocStyleMain(io);
      expect(exitCode()).toBe(1);
      const text = err.join("\n");
      expect(text).toContain("documentation file(s) missing");
      expect(text).toContain("README.md");
      expect(text).toContain("docs/writing-standard.md");
      expect(text).toContain("no Terms table found in");
      expect(text).toContain("invalid-range");
    } finally {
      repo.dispose();
    }
  });
});
