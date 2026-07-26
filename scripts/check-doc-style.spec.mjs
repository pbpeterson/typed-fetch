import { execFileSync } from "node:child_process";
import { existsSync, symlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, test } from "vitest";
import {
  diffTermsTables,
  findRelativeLinks,
  findVocabularyViolations,
  judgeDocStyle,
  parseTermsTable,
  README_FILE,
  toProseLines,
  VOCABULARY_EXEMPT_FILES,
  WRITING_STANDARD_FILE,
} from "./check-doc-style.mjs";
import { createScratchDir } from "./lib/scratch-dir.mjs";

// Markdown fixtures are line arrays: a template literal cannot hold a fence
// without escaping every backtick, and the line NUMBERS are what this gate
// reports.
const md = (...lines) => lines.join("\n");
const FENCE = "```";
const FENCE4 = "````";
const TICK = "`";

/** A markdown StyleDoc from lines. */
const doc = (file, ...lines) => ({ file, format: "markdown", source: md(...lines) });

describe("toProseLines", () => {
  test("preserves one output line per input line so line numbers stay source locations", () => {
    const source = md("one", "two", "three", "four");
    expect(toProseLines(source, "markdown")).toHaveLength(4);
  });

  test("blanks a fenced block's body, including its fences", () => {
    const source = md("before", FENCE + "ts", "const canceled = 1;", FENCE, "after");
    expect(toProseLines(source, "markdown")).toEqual(["before", "", "", "", "after"]);
  });

  test("a ```` wrapper is opaque: an inner ``` fence does not reopen prose", () => {
    const source = md("before", FENCE4 + "markdown", FENCE + "ts", "x", FENCE, FENCE4, "after");
    expect(toProseLines(source, "markdown")).toEqual(["before", "", "", "", "", "", "after"]);
  });

  test("strips an inline code span, leaving the surrounding prose", () => {
    const [line] = toProseLines(`the ${TICK}cancelled${TICK} flag is internal`, "markdown");
    expect(line).not.toContain("cancelled");
    expect(line).toContain("the");
    expect(line).toContain("flag is internal");
  });

  test("leaves an unmatched backtick alone rather than swallowing the rest of the line", () => {
    const source = `an unmatched ${TICK} then the request was canceled`;
    expect(toProseLines(source, "markdown")[0]).toContain("the request was canceled");
  });

  test("jsdoc format keeps /** … */ bodies and drops the ` * ` decoration", () => {
    const source = md("/**", " * the canceled request", " */", "export const x = 1;");
    expect(toProseLines(source, "jsdoc")).toEqual(["", "the canceled request", " ", ""]);
  });

  test("jsdoc format ignores a block attached to a non-exported declaration", () => {
    const source = md("/**", " * the canceled request", " */", "const x = 1;");
    expect(toProseLines(source, "jsdoc")).toEqual(["", "", "", ""]);
  });

  test("jsdoc format scans public members and ignores private members", () => {
    const source = md(
      "export class Example {",
      "  /** the canceled request */",
      "  public run(): void {}",
      "  /** the canceled request */",
      "  private stop(): void {}",
      "}",
    );
    const lines = toProseLines(source, "jsdoc");
    expect(lines[1]).toContain("the canceled request");
    expect(lines[3]).toBe("");
  });

  test("jsdoc format ignores an exported declaration marked @internal", () => {
    const source = md(
      "/**",
      " * the canceled request",
      " * @internal",
      " */",
      "export const x = 1;",
    );
    expect(toProseLines(source, "jsdoc")).toEqual(["", "", "", "", ""]);
  });

  test("jsdoc format drops a // line comment entirely", () => {
    // Regression: src/errors/error-body.ts:223 is an internal line comment that
    // explains two code identifiers. The standard's scope is PUBLIC JSDoc.
    const source = md("// `cancelling` names the in-flight cancellation", "const a = 1;");
    expect(toProseLines(source, "jsdoc")).toEqual(["", ""]);
  });

  test("jsdoc format drops ordinary code lines", () => {
    const source = md("const requestCancellation = 1;", "function cancelTheRequest() {}");
    expect(toProseLines(source, "jsdoc")).toEqual(["", ""]);
  });
});

describe("findVocabularyViolations", () => {
  const hits = (...lines) => findVocabularyViolations([doc("D.md", ...lines)]);
  const ids = (...lines) => hits(...lines).map((h) => h.rule);

  test("flags 'the canceled request'", () => {
    expect(ids("It produced a NetworkError for the canceled request.")).toContain("cancel-request");
  });

  test("flags 'cancel the request'", () => {
    expect(ids("Call abort() to cancel the request.")).toContain("cancel-request");
  });

  test("flags 'the request was canceled'", () => {
    expect(ids("The request was canceled by the caller.")).toContain("request-canceled");
  });

  test("flags 'canceling a request'", () => {
    expect(ids("Canceling a request leaves the body open.")).toContain("cancel-request");
  });

  test("flags 'cancellation' and 'cancelation'", () => {
    expect(ids("The cancellation reason is unknown.")).toContain("cancellation-noun");
    expect(ids("The cancelation reason is unknown.")).toContain("cancellation-noun");
  });

  test("flags 'abort the body' and 'aborted error body'", () => {
    expect(ids("Never abort the body.")).toContain("abort-body");
    expect(ids("An aborted error body keeps its stream open.")).toContain("abort-body");
  });

  test("flags 'the body was aborted'", () => {
    expect(ids("The body was aborted before the read.")).toContain("body-aborted");
  });

  test("accepts 'abort the request'", () => {
    expect(hits("An AbortSignal can abort the request.")).toEqual([]);
  });

  test("accepts 'cancel the error body'", () => {
    expect(hits("Call error.cancel() to cancel the error body.")).toEqual([]);
  });

  test("accepts 'read or cancel the body'", () => {
    expect(hits("Read or cancel the body of every HTTP error.")).toEqual([]);
  });

  test("accepts the Terms-table definition 'An AbortSignal stops a request'", () => {
    // The rule was narrowed to `stop THE request` for exactly this line, which
    // is the canonical definition of the term in both Terms tables.
    expect(hits("| abort the request | An AbortSignal stops a request. |")).toEqual([]);
  });

  test("flags synonyms for the normative vocabulary", () => {
    expect(ids("The caller has to release the body.")).toContain("normative-synonym");
    expect(ids("It is recommended to retry.")).toContain("normative-synonym");
  });

  test("never flags text inside a fenced block", () => {
    expect(hits(FENCE + "ts", 'console.log("the request was canceled");', FENCE)).toEqual([]);
  });

  test("never flags text inside an inline code span", () => {
    expect(hits(`The ${TICK}cancelled${TICK} variable is internal.`)).toEqual([]);
  });

  test("skips every file in VOCABULARY_EXEMPT_FILES", () => {
    const line = "Do not write 'cancel the request'. A cancellation is an abort.";
    expect(findVocabularyViolations([doc(VOCABULARY_EXEMPT_FILES[0], line)])).toEqual([]);
    expect(findVocabularyViolations([doc("OTHER.md", line)]).length).toBeGreaterThan(0);
  });

  test("reports file, 1-based line, rule id, and the matched text", () => {
    expect(
      findVocabularyViolations([doc("D.md", "intro", "", "The cancellation is late.")]),
    ).toEqual([{ file: "D.md", line: 3, rule: "cancellation-noun", match: "cancellation" }]);
  });

  test("reports two different rules matching on one line as two violations", () => {
    const found = hits("A cancellation happened because we cancel the request.");
    expect(found.map((h) => h.rule).toSorted()).toEqual(["cancel-request", "cancellation-noun"]);
  });

  test("matches case-insensitively", () => {
    expect(ids("Cancellation and timeouts are not network failures.")).toContain(
      "cancellation-noun",
    );
  });
});

describe("findRelativeLinks", () => {
  const targets = (...lines) => findRelativeLinks(md(...lines)).map((l) => l.target);

  test("flags [LICENSE](./LICENSE)", () => {
    expect(targets("Read [LICENSE](./LICENSE).")).toEqual(["./LICENSE"]);
  });

  test("flags a badge target whose link text is itself a link", () => {
    // The outer target is the one that breaks from node_modules, and a pattern
    // anchored on the opening `[` never sees it.
    expect(targets("[![license](https://img.shields.io/npm/l/x)](./LICENSE)")).toEqual([
      "./LICENSE",
    ]);
  });

  test("flags ../docs/x.md and a bare LICENSE", () => {
    expect(targets("[a](../docs/x.md) and [b](LICENSE)")).toEqual(["../docs/x.md", "LICENSE"]);
  });

  test("flags a reference definition", () => {
    expect(targets("[l]: ./LICENSE")).toEqual(["./LICENSE"]);
  });

  test("flags an <a href> attribute", () => {
    expect(targets('<a href="./LICENSE">license</a>')).toEqual(["./LICENSE"]);
  });

  test("accepts an https:// target", () => {
    expect(targets("[a](https://github.com/pbpeterson/typed-fetch/blob/main/LICENSE)")).toEqual([]);
  });

  test("accepts an http:// and a mailto: target", () => {
    expect(targets("[a](http://example.com) [b](mailto:x@example.com)")).toEqual([]);
  });

  test("accepts a pure #fragment — it resolves inside the file itself", () => {
    expect(targets("[a](#semver-policy)")).toEqual([]);
  });

  test("does not flag a link target inside a fenced code block", () => {
    expect(targets(FENCE + "markdown", "[a](./LICENSE)", FENCE)).toEqual([]);
  });

  test("does not flag a link inside an inline code span", () => {
    // Regression: the link scan used to read the RAW line while the vocabulary
    // scan read the prose, so a Markdown link PRINTED as an example — which is
    // how this repository documents the rule — was reported as a violation.
    // Nobody follows a link inside backticks.
    expect(targets(`Do not write ${TICK}[LICENSE](./LICENSE)${TICK} in the README.`)).toEqual([]);
  });

  test("still flags a real link on a line that also carries a code span", () => {
    // The other half of the same regression: stripping code spans must not
    // become a way to hide a real violation on the same line.
    expect(targets(`The ${TICK}[a](./HIDDEN)${TICK} example, then [b](./LICENSE).`)).toEqual([
      "./LICENSE",
    ]);
  });

  test("does not flag an href attribute inside an inline code span", () => {
    expect(targets(`Write ${TICK}<a href="./LICENSE">x</a>${TICK} nowhere.`)).toEqual([]);
  });

  test("reports the 1-based line", () => {
    expect(findRelativeLinks(md("intro", "", "[a](./LICENSE)"))).toEqual([
      { line: 3, target: "./LICENSE" },
    ]);
  });
});

describe("the documented limits — pinned so closing one is a reviewed diff", () => {
  // The gate is lexical AND line-by-line. Both limits are stated in the header
  // of `check-doc-style.mjs` and in CONTRIBUTING.md. These cases assert the
  // limits rather than the behavior a reader might assume, so the documents and
  // the code cannot drift apart, and so a future change that closes one arrives
  // as a deliberate edit to this block.

  test("a link target wrapped onto the next line is missed", () => {
    // CommonMark allows a line ending between `](` and the destination, so this
    // is a real relative link. Catching it means matching across joined lines,
    // and the join destroys the one-output-line-per-input-line invariant that
    // makes every violation reportable as `file:line`.
    expect(findRelativeLinks(md("Read [the license](", "./LICENSE)."))).toEqual([]);
  });

  test("a vocabulary violation wrapped across two lines is missed", () => {
    // Same limit, same reason. `pnpm format` owns the wrapping of every
    // document in the roster, so neither miss is reachable by accident.
    expect(
      findVocabularyViolations([doc("D.md", "The request was", "canceled by the caller.")]),
    ).toEqual([]);
  });

  test("each half of a wrapped violation is still scanned on its own", () => {
    // The limit is the JOIN, not the scan: a violation that fits on one line is
    // found whether or not its neighbours wrap.
    const found = findVocabularyViolations([
      doc("D.md", "The request was", "canceled by the caller, and the cancellation was late."),
    ]);
    expect(found).toEqual([
      { file: "D.md", line: 2, rule: "cancellation-noun", match: "cancellation" },
    ]);
  });
});

describe("parseTermsTable", () => {
  const TABLE = [
    "| Term    | Meaning              |",
    "| ------- | -------------------- |",
    "| rejects | A promise fails.     |",
    "| throws  | An exception raises. |",
  ];

  test("parses the table into rows, trimming cell padding", () => {
    expect(parseTermsTable(md(...TABLE))).toEqual([
      { term: "rejects", meaning: "A promise fails." },
      { term: "throws", meaning: "An exception raises." },
    ]);
  });

  test("selects the Term/Meaning table and ignores other tables in the document", () => {
    const source = md(
      "| Word | Meaning |",
      "| ---- | ------- |",
      "| must | needed. |",
      "",
      ...TABLE,
    );
    expect(parseTermsTable(source)?.map((r) => r.term)).toEqual(["rejects", "throws"]);
  });

  test("stops at the blank line after the table", () => {
    expect(parseTermsTable(md(...TABLE, "", "| not | a row |"))).toHaveLength(2);
  });

  test("returns null when no Term table exists", () => {
    expect(parseTermsTable(md("# Title", "", "prose only"))).toBeNull();
  });

  test("preserves row order", () => {
    expect(parseTermsTable(md(...TABLE))?.map((r) => r.term)).toEqual(["rejects", "throws"]);
  });
});

const row = (term, meaning) => ({ term, meaning });

describe("diffTermsTables", () => {
  const STANDARD = [row("rejects", "A promise finishes with an error."), row("throws", "Raises.")];

  test("identical tables produce every field empty and misordered false", () => {
    expect(diffTermsTables([...STANDARD], STANDARD)).toEqual({
      missing: [],
      extra: [],
      misordered: false,
      meaningDrift: [],
      unparsed: [],
    });
  });

  test("a term in the standard and not in the README is missing", () => {
    expect(diffTermsTables([STANDARD[0]], STANDARD).missing).toEqual(["throws"]);
  });

  test("a term in the README and not in the standard is extra", () => {
    const readme = [...STANDARD, row("error record", "The toJSON record.")];
    expect(diffTermsTables(readme, STANDARD).extra).toEqual(["error record"]);
  });

  test("the same terms in a different order are misordered", () => {
    expect(diffTermsTables([STANDARD[1], STANDARD[0]], STANDARD).misordered).toBe(true);
  });

  test("a README meaning that begins with the standard's and adds a sentence does not drift", () => {
    // Regression for the `unknown HTTP error` row, which is how the prefix
    // allowance already works today.
    const readme = [row("rejects", "A promise finishes with an error. Narrow it."), STANDARD[1]];
    expect(diffTermsTables(readme, STANDARD).meaningDrift).toEqual([]);
  });

  test("a README meaning that does not begin with the standard's drifts", () => {
    const readme = [row("rejects", "A promise blows up."), STANDARD[1]];
    expect(diffTermsTables(readme, STANDARD).meaningDrift).toEqual(["rejects"]);
  });

  test("a README meaning shorter than the standard's drifts", () => {
    const readme = [row("rejects", "A promise finishes"), STANDARD[1]];
    expect(diffTermsTables(readme, STANDARD).meaningDrift).toEqual(["rejects"]);
  });

  test("leading and trailing whitespace in a cell does not create drift", () => {
    const readme = [row("  rejects ", " A promise finishes with an error.  "), STANDARD[1]];
    const diff = diffTermsTables(readme, STANDARD);
    expect(diff.meaningDrift).toEqual([]);
    expect(diff.missing).toEqual([]);
    expect(diff.extra).toEqual([]);
  });

  test("a null table on either side is recorded in unparsed, not a crash", () => {
    expect(diffTermsTables(null, STANDARD).unparsed).toEqual([README_FILE]);
    expect(diffTermsTables(STANDARD, null).unparsed).toEqual([WRITING_STANDARD_FILE]);
    expect(diffTermsTables(null, null).unparsed).toEqual([README_FILE, WRITING_STANDARD_FILE]);
  });
});

describe("judgeDocStyle", () => {
  const TERMS = md(
    "| Term    | Meaning          |",
    "| ------- | ---------------- |",
    "| rejects | A promise fails. |",
  );
  const clean = () => ({
    docs: [doc("CONTRIBUTING.md", "A signal can abort the request.")],
    readmeSource: TERMS,
    standardSource: TERMS,
  });

  test("a clean corpus is ok with three empty results", () => {
    const verdict = judgeDocStyle(clean());
    expect(verdict.ok).toBe(true);
    expect(verdict.relativeLinks).toEqual([]);
    expect(verdict.vocabulary).toEqual([]);
    expect(verdict.terms.missing).toEqual([]);
  });

  test("ok is false when only the links fail", () => {
    const verdict = judgeDocStyle({ ...clean(), readmeSource: md("[a](./LICENSE)", "", TERMS) });
    expect(verdict.ok).toBe(false);
    expect(verdict.vocabulary).toEqual([]);
  });

  test("ok is false when only the vocabulary fails", () => {
    const verdict = judgeDocStyle({
      ...clean(),
      docs: [doc("CONTRIBUTING.md", "The cancellation is late.")],
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.vocabulary).toHaveLength(1);
  });

  test("ok is false when only the terms table fails", () => {
    const verdict = judgeDocStyle({ ...clean(), readmeSource: md("# README", "no table") });
    expect(verdict.ok).toBe(false);
    expect(verdict.terms.unparsed).toEqual([README_FILE]);
  });

  test("all three failing are reported in ONE verdict", () => {
    // The accumulating contract: a thrown error would truncate the report to
    // the first failure (CONTRIBUTING.md:255-259).
    const verdict = judgeDocStyle({
      docs: [doc("CONTRIBUTING.md", "The cancellation is late.")],
      readmeSource: md("[a](./LICENSE)"),
      standardSource: TERMS,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.relativeLinks).toHaveLength(1);
    expect(verdict.vocabulary).toHaveLength(1);
    expect(verdict.terms.unparsed).toEqual([README_FILE]);
  });

  test("missing files are policy facts in the accumulating verdict", () => {
    const verdict = judgeDocStyle({ ...clean(), missingFiles: ["README.md", "src/index.ts"] });
    expect(verdict.ok).toBe(false);
    expect(verdict.missingFiles).toEqual(["README.md", "src/index.ts"]);
  });

  test("link scanning is scoped to README.md", () => {
    // CONTRIBUTING.md never enters the tarball, so a relative link in it is
    // correct, not a violation.
    const verdict = judgeDocStyle({
      ...clean(),
      docs: [doc("CONTRIBUTING.md", "Read [the standard](./docs/writing-standard.md).")],
    });
    expect(verdict.ok).toBe(true);
  });
});

describe("VOCABULARY_EXEMPT_FILES", () => {
  test("is exactly the writing standard", () => {
    // Pinned so widening it is a reviewed diff. The standard is the one
    // document that must write a forbidden phrase down in order to forbid it.
    expect(VOCABULARY_EXEMPT_FILES).toEqual([WRITING_STANDARD_FILE]);
  });
});

// ---------------------------------------------------------------------------
// The gate must RUN. Everything above is pure; none of it proves that
// `node scripts/check-doc-style.mjs` still reaches main(). A lexical isMain
// guard once made every gate in this repository print nothing and exit 0
// through a symlink, and CI reads that as a pass (CHANGELOG.md:286-296).
// ---------------------------------------------------------------------------
const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const CHECK_DOC_STYLE = join(scriptDir, "check-doc-style.mjs");

const links = createScratchDir("tf-check-doc-style-link-");
afterAll(() => links.dispose());

/** @param {string} entry */
function runCheckDocStyle(entry) {
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

describe.skipIf(process.platform === "win32")("check-doc-style — the gate runs", () => {
  test.each([
    ["its real path", () => CHECK_DOC_STYLE],
    [
      "a symlinked checkout directory",
      () => {
        const linked = join(links.path, "checkout");
        if (!existsSync(linked)) symlinkSync(repoRoot, linked);
        return join(linked, "scripts", "check-doc-style.mjs");
      },
    ],
    [
      "a symlinked script file",
      () => {
        const linked = join(links.path, "check-doc-style.mjs");
        if (!existsSync(linked)) symlinkSync(CHECK_DOC_STYLE, linked);
        return linked;
      },
    ],
  ])("reports a verdict when started through %s", (_name, entry) => {
    // Every branch of main() starts a line with `check-doc-style: `. Only a
    // guard that never reached main() prints nothing at all.
    const { output } = runCheckDocStyle(entry());
    expect(output).toMatch(/^check-doc-style: /m);
  });
});
