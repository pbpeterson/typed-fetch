#!/usr/bin/env node
// @ts-check

// ---------------------------------------------------------------------------
// check-doc-style.mjs — read the documentation as TEXT and enforce the four
// rules of `docs/writing-standard.md` that a regular expression can decide.
//
// WHY THIS EXISTS, AND WHY IT IS NOT `check-docs`
//   `check-docs` compiles fenced TypeScript against `dist/`, so it needs a
//   build and it takes seconds. None of the four checks below needs `dist/`
//   and none needs `tsc`. Folding them into `check-docs` would put a
//   relative-link typo behind a full build, which is the wrong feedback loop;
//   splitting them into four gates would give four files that read the same
//   corpus and print four reports. So: one extra gate, running BEFORE
//   `pnpm build`, failing in milliseconds.
//
// WHAT IT DECIDES
//   1. A relative link in `README.md`. `README.md` is the only document in the
//      npm tarball, so a link to any other repository file must be an absolute
//      URL (`docs/writing-standard.md` → README link rule). A `#fragment` is
//      allowed.
//   2. A controlled-vocabulary violation in PROSE. A request is aborted; an
//      error body is canceled.
//   3. A README Terms table that has drifted from the controlled vocabulary in
//      `docs/writing-standard.md`.
//   4. A current Node.js floor that has drifted from `engines.node`.
//
//   Rules 1 and 2 read the same prose. `toProseLines` strips fenced blocks and
//   inline code spans, so `` `cancelled` `` — the variable in
//   `src/errors/error-body.ts` — is never flagged as prose, and a Markdown link
//   printed inside backticks is not read as a link. Rule 1 used to scan the raw
//   line, and the asymmetry was a defect in rule 1: it flagged a document for
//   showing an example of the thing it forbids.
//
//   Rule 4 also strips fenced blocks, but it keeps inline code. Compatibility
//   ranges normally use inline code, and the gate must compare those values.
//
// WHAT IT CANNOT SEE
//   The rules are lexical, and they are also LINE-BY-LINE. Both limits are
//   deliberate, and both have a pinned test in `check-doc-style.spec.mjs` so
//   closing one later is a reviewed diff rather than an accident.
//
//   Lexical: "reissue calls the caller had explicitly canceled" says "calls",
//   not "requests", and no regular expression reaches it. Tense and sentence
//   length are not checked at all.
//
//   Line-by-line: a violation split across a line break is missed. CommonMark
//   allows a line ending between `](` and a link destination, so a wrapped
//   target reads as absolute here; a vocabulary phrase wrapped between two
//   words reads as two clean lines. Closing this means matching across joined
//   lines, and the join is what costs: every function here returns ONE output
//   line per input line, which is the whole reason a violation can be reported
//   as `file:line`. A gate that reports the wrong line, or no line, is worse
//   than one that misses a hand-wrapped link — and `pnpm format` owns the
//   wrapping of every document in the roster. Both misses stay review items.
//   See CONTRIBUTING.md.
//
// RUN ORDER
//   Anywhere. It reads only source text.
// ---------------------------------------------------------------------------

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { isMainModule } from "./lib/is-main-module.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");

/** The document the npm tarball carries, and the only one whose links are scanned. */
export const README_FILE = "README.md";

/** The source of the controlled vocabulary. The README Terms table copies it. */
export const WRITING_STANDARD_FILE = "docs/writing-standard.md";

/** The machine-readable source for the supported Node.js range. */
export const PACKAGE_FILE = "package.json";

// The writing standard's own scope, minus the two globbed parts. Hand-maintained,
// exactly like `check-docs`'s Markdown roster: each entry is a deliberate
// public document.
export const STYLE_MARKDOWN_SOURCES = [
  README_FILE,
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "CONTEXT.md",
  "RELEASING.md",
  "skills/typed-fetch/SKILL.md",
  ".claude/skills/typed-fetch-maintainer/SKILL.md",
];

/**
 * Current operational documents that state the Node.js floor.
 *
 * Historical release records are not here. Their old compatibility statements
 * remain correct for the releases that they describe.
 */
export const NODE_FLOOR_FILES = [
  README_FILE,
  "CONTRIBUTING.md",
  "RELEASING.md",
  "skills/typed-fetch/SKILL.md",
  ".claude/skills/typed-fetch-maintainer/SKILL.md",
  "docs/audit-ledger.md",
];

// `docs/writing-standard.md` is the ONE document that must write a forbidden
// phrase down in order to forbid it, so it is exempt from the vocabulary rules.
// An inline allow-marker was considered and rejected: machinery for one file.
export const VOCABULARY_EXEMPT_FILES = [WRITING_STANDARD_FILE];

/**
 * Accepted ADRs whose original argument predates the current vocabulary gate.
 *
 * The ADR policy forbids rewriting that argument. The scan starts at
 * `## Amendments`, whose later prose follows the current writing standard.
 */
export const FROZEN_ADR_FILES = [
  "docs/adr/0001-keep-the-http-error-roster-hand-written.md",
  "docs/adr/0002-refuse-a-clone-copy-that-cannot-confirm-the-branch.md",
];

// ---------------------------------------------------------------------------
// THE DECISION, part 1 of 5: prose extraction.
// Pure. One output line per input line, so every index is a source location.
// ---------------------------------------------------------------------------

/**
 * @typedef {{ file: string, format: "markdown" | "jsdoc", source: string }} StyleDoc
 */

/**
 * Replace an inline code span with a single space. A code span holds code
 * identifiers, which the writing standard exempts from the vocabulary:
 * `` `cancelled` `` names a variable and must not be flagged.
 *
 * An UNMATCHED backtick is left alone. Treating it as an opener would swallow
 * the rest of the line and silently stop scanning real prose.
 * @param {string} line
 */
function stripInlineCode(line) {
  return line.replace(/(`+)[\s\S]*?\1/g, " ");
}

/**
 * Blank every fenced block, including its own fences, keeping the line count.
 *
 * The fence RUN LENGTH does the real work: a ````markdown wrapper (which
 * legitimately contains a nested ```ts block, e.g. in CONTRIBUTING's own docs)
 * needs >= 4 backticks to close, so the inner fences stay body. The closing
 * fence may sit at its own indentation, bounded by the opening indent plus 3,
 * because CONTRIBUTING.md has a fence five spaces deep inside a list item.
 * @param {string[]} lines
 * @returns {string[]}
 */
function maskFencedBlocks(lines) {
  const out = [];
  /** @type {RegExp | null} */
  let closeRe = null;
  for (const line of lines) {
    if (closeRe === null) {
      const open = line.match(/^(\s*)(`{3,})([^\n`]*)$/);
      if (open) {
        closeRe = new RegExp(`^ {0,${open[1].length + 3}}\`{${open[2].length},}\\s*$`);
        out.push("");
        continue;
      }
      out.push(line);
      continue;
    }
    if (closeRe.test(line)) closeRe = null;
    out.push("");
  }
  return out;
}

/**
 * Does a node carry the named modifier?
 *
 * @param {ts.Node} node
 * @param {ts.SyntaxKind} kind
 */
function hasModifier(node, kind) {
  return ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((m) => m.kind === kind) === true;
}

/**
 * Keep only JSDoc attached to exported declarations and their public members.
 *
 * The last attached block is the declaration's JSDoc. An earlier block is a
 * file or module note separated from the declaration by another JSDoc block.
 * @param {string} source
 * @returns {string[]}
 */
function publicJSDocProseLines(source) {
  const file = ts.createSourceFile(
    "style-source.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const kept = source.split("").map((char) => (char === "\n" ? "\n" : " "));

  /**
   * @param {ts.Node} node
   * @returns {boolean}
   */
  function keepJSDoc(node) {
    const docs = /** @type {readonly ts.JSDoc[] | undefined} */ (node.jsDoc);
    const doc = docs?.at(-1);
    if (!doc) return true;
    if (doc.tags?.some((tag) => tag.tagName.text === "internal")) return false;
    for (let index = doc.pos; index < doc.end; index += 1) kept[index] = source[index];
    return true;
  }

  /** @param {ts.Node} node */
  function keepPublicShape(node) {
    if (!keepJSDoc(node)) return;

    if (
      ts.isClassDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeLiteralNode(node)
    ) {
      for (const member of node.members) {
        if (
          hasModifier(member, ts.SyntaxKind.PrivateKeyword) ||
          hasModifier(member, ts.SyntaxKind.ProtectedKeyword) ||
          (member.name && ts.isPrivateIdentifier(member.name))
        ) {
          continue;
        }
        keepPublicShape(member);
      }
      return;
    }

    if (ts.isTypeAliasDeclaration(node) && ts.isTypeLiteralNode(node.type)) {
      keepPublicShape(node.type);
      return;
    }

    if (ts.isEnumDeclaration(node)) {
      for (const member of node.members) keepPublicShape(member);
    }
  }

  for (const statement of file.statements) {
    if (
      hasModifier(statement, ts.SyntaxKind.ExportKeyword) ||
      ts.isExportDeclaration(statement) ||
      ts.isExportAssignment(statement)
    ) {
      keepPublicShape(statement);
    }
  }

  const lines = kept.join("").split("\n");
  return lines.map((line) => {
    const closingLine = line.trim() === "*/";
    const prose = line
      .replace(/^.*?\/\*\*/, "")
      .replace(/\*\/.*$/, "")
      .replace(/^\s*\*\s?/, "");
    if (prose.trim() !== "") return prose;
    return closingLine ? " " : "";
  });
}

/**
 * The prose of a document, one output line per input line so a 0-based index
 * plus one is the source line.
 * @param {string} source
 * @param {"markdown" | "jsdoc"} format
 * @returns {string[]}
 */
export function toProseLines(source, format) {
  const raw = source.split("\n");
  const lines = format === "jsdoc" ? publicJSDocProseLines(source) : raw;
  return maskFencedBlocks(lines).map(stripInlineCode);
}

// ---------------------------------------------------------------------------
// THE DECISION, part 2 of 5: the controlled vocabulary.
// ---------------------------------------------------------------------------

/** @typedef {{ id: string, pattern: RegExp, message: string }} VocabularyRule */

const V = "cancel(?:s|ed|led|ing|ling)?";

/**
 * The rules that a text match can decide, as validated over the whole corpus:
 * every hit is a real violation and there is no false positive.
 *
 * `stop-the-request` matches only `the`. It began as
 * `stop (the|a|an|this|that|every) request` and flagged `README.md:41` and
 * the writing standard — "An `AbortSignal` stops a request", which is the
 * canonical DEFINITION of the term in both Terms tables. The standard
 * forbids the phrase "stop the request" specifically, so the rule does too.
 * @type {VocabularyRule[]}
 */
export const VOCABULARY_RULES = [
  {
    id: "cancel-request",
    pattern: new RegExp(`\\b${V}\\b(?:\\s+\\w+){0,2}\\s+requests?\\b`, "i"),
    message: "A request is aborted, not canceled.",
  },
  {
    id: "request-canceled",
    pattern: new RegExp(`\\brequests?\\b(?:\\s+\\w+){0,3}\\s+cancel(?:ed|led)\\b`, "i"),
    message: "A request is aborted, not canceled.",
  },
  {
    id: "stop-the-request",
    pattern: /\bstops?(?:ped|ping)?\s+the\s+requests?\b/i,
    message: 'Do not write "stop the request". A signal aborts a request.',
  },
  {
    id: "cancellation-noun",
    pattern: /\bcancell?ation\b/i,
    message: "Write abort, or name the error body that is canceled.",
  },
  {
    id: "abort-body",
    pattern: /\baborts?(?:ed|ing)?\b(?:\s+\w+){0,2}\s+bod(?:y|ies)\b/i,
    message: "An error body is canceled, not aborted.",
  },
  {
    id: "body-aborted",
    pattern: /\bbod(?:y|ies)\b(?:\s+\w+){0,3}\s+aborted\b/i,
    message: "An error body is canceled, not aborted.",
  },
  {
    id: "normative-synonym",
    pattern: /\b(?:needs?|has|have|had)\s+to\b|\bit\s+is\s+recommended\b/i,
    message: 'Use "must", "must not", "should", "can", or "may" for normative prose.',
  },
];

/**
 * @param {StyleDoc[]} docs
 * @returns {{ file: string, line: number, rule: string, match: string }[]}
 */
export function findVocabularyViolations(docs) {
  const violations = [];
  for (const { file, format, source } of docs) {
    if (VOCABULARY_EXEMPT_FILES.includes(file)) continue;
    const lines = toProseLines(source, format);
    const firstMutableLine = FROZEN_ADR_FILES.includes(file)
      ? lines.findIndex((line) => /^## Amendments\s*$/.test(line))
      : 0;
    const scanFrom = firstMutableLine === -1 ? lines.length : firstMutableLine;
    for (const [index, text] of lines.entries()) {
      if (index < scanFrom) continue;
      for (const rule of VOCABULARY_RULES) {
        const hit = text.match(rule.pattern);
        if (hit) violations.push({ file, line: index + 1, rule: rule.id, match: hit[0] });
      }
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// THE DECISION, part 3 of 5: links in README.md.
// ---------------------------------------------------------------------------

/** A link target that carries a scheme, e.g. `https:`, `http:`, `mailto:`. */
const ABSOLUTE_TARGET_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

// `](target` rather than the whole `[text](target)`. A badge link nests one
// inline link inside another — `[![license](https://…)](./LICENSE)` — and a
// pattern anchored on the opening `[` consumes the inner link and never sees
// the outer target, which is exactly the defect this rule exists to catch.
const INLINE_TARGET_RE = /\]\(\s*<?([^)\s>]+)/g;
const REFERENCE_TARGET_RE = /^ {0,3}\[[^\]]+\]:\s*<?([^\s>]+)/;
const ATTRIBUTE_TARGET_RE = /\b(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/**
 * Markdown link/image targets, reference definitions, and href/src attributes
 * that are neither an absolute URL nor an in-page `#fragment`.
 *
 * A fragment resolves inside the file itself, so it survives the trip into
 * `node_modules` that every other relative target does not.
 *
 * Reads {@link toProseLines}, exactly as the vocabulary scan does, so a code
 * span is stripped and not only a fenced block. This rule is about a link a
 * READER can follow, and nobody follows `` `[a](./LICENSE)` `` — inside
 * backticks that is a printed example of Markdown, which is how this repository
 * documents the rule in the first place. Scanning the raw line flagged it and
 * demanded that the documentation stop showing what it forbids.
 * @param {string} source
 * @returns {{ line: number, target: string }[]}
 */
export function findRelativeLinks(source) {
  const found = [];
  const lines = toProseLines(source, "markdown");
  for (const [index, line] of lines.entries()) {
    /** @type {string[]} */
    const targets = [];
    for (const m of line.matchAll(INLINE_TARGET_RE)) targets.push(m[1]);
    for (const m of line.matchAll(ATTRIBUTE_TARGET_RE)) targets.push(m[1] ?? m[2]);
    const ref = line.match(REFERENCE_TARGET_RE);
    if (ref) targets.push(ref[1]);
    for (const target of targets) {
      if (target === "" || target.startsWith("#")) continue;
      if (ABSOLUTE_TARGET_RE.test(target)) continue;
      found.push({ line: index + 1, target });
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// THE DECISION, part 4 of 5: the README Terms table against the standard.
// ---------------------------------------------------------------------------

/** @typedef {{ term: string, meaning: string }} TermRow */

/**
 * @param {string} line
 * @returns {string[] | null}
 */
function splitTableRow(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|") || trimmed.length < 2) return null;
  return trimmed
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}

/**
 * The rows of the single `| Term | Meaning |` table in a document.
 *
 * Selected by its HEADER, not by position: `docs/writing-standard.md` holds
 * three tables and only one of them names a Term.
 * @param {string} source
 * @returns {TermRow[] | null} null when the document has no Term table
 */
export function parseTermsTable(source) {
  const lines = source.split("\n");
  for (const [index, line] of lines.entries()) {
    const header = splitTableRow(line);
    if (!header || header.length < 2) continue;
    if (header[0].toLowerCase() !== "term" || header[1].toLowerCase() !== "meaning") continue;
    if (splitTableRow(lines[index + 1] ?? "") === null) return [];
    /** @type {TermRow[]} */
    const rows = [];
    for (let j = index + 2; j < lines.length; j += 1) {
      const cells = splitTableRow(lines[j]);
      if (!cells || cells.length < 2) break;
      rows.push({ term: cells[0], meaning: cells[1] });
    }
    return rows;
  }
  return null;
}

/**
 * @typedef {{
 *   missing: string[],
 *   extra: string[],
 *   misordered: boolean,
 *   meaningDrift: string[],
 *   unparsed: string[],
 * }} TermsDiff
 */

/**
 * The relation `CONTRIBUTING.md` requires and never defined: the two tables
 * carry THE SAME TERMS IN THE SAME ORDER, and each README meaning BEGINS WITH
 * the standard's meaning, character for character. A README meaning can append
 * one package-specific sentence — that is how the `unknown HTTP error` row
 * already works, and that extra sentence belongs in the consumer document.
 *
 * The standard is the source; the README is the copy.
 * @param {TermRow[] | null} readmeTerms
 * @param {TermRow[] | null} standardTerms
 * @returns {TermsDiff}
 */
export function diffTermsTables(readmeTerms, standardTerms) {
  /** @type {TermsDiff} */
  const diff = { missing: [], extra: [], misordered: false, meaningDrift: [], unparsed: [] };
  if (readmeTerms === null) diff.unparsed.push(README_FILE);
  if (standardTerms === null) diff.unparsed.push(WRITING_STANDARD_FILE);
  if (readmeTerms === null || standardTerms === null) return diff;

  const readme = readmeTerms.map((r) => ({ term: r.term.trim(), meaning: r.meaning.trim() }));
  const standard = standardTerms.map((r) => ({ term: r.term.trim(), meaning: r.meaning.trim() }));
  const readmeByTerm = new Map(readme.map((r) => [r.term, r.meaning]));
  const standardByTerm = new Map(standard.map((r) => [r.term, r.meaning]));

  for (const { term } of standard) if (!readmeByTerm.has(term)) diff.missing.push(term);
  for (const { term } of readme) if (!standardByTerm.has(term)) diff.extra.push(term);
  if (diff.missing.length === 0 && diff.extra.length === 0) {
    diff.misordered = readme.some((row, i) => row.term !== standard[i].term);
  }
  for (const { term, meaning } of standard) {
    const copy = readmeByTerm.get(term);
    if (copy !== undefined && !copy.startsWith(meaning)) diff.meaningDrift.push(term);
  }
  return diff;
}

/** @param {TermsDiff} diff */
export function termsAgree(diff) {
  return (
    diff.missing.length === 0 &&
    diff.extra.length === 0 &&
    diff.meaningDrift.length === 0 &&
    diff.unparsed.length === 0 &&
    !diff.misordered
  );
}

// ---------------------------------------------------------------------------
// THE DECISION, part 5 of 5: current Node.js floor against package.json.
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   file: string,
 *   line: number,
 *   rule: "invalid-range" | "missing-exact" | "major-only" | "wrong-version",
 *   match: string,
 *   expected: string,
 * }} NodeFloorViolation
 */

/**
 * Find current compatibility prose that disagrees with `engines.node`.
 *
 * This check is deliberately narrower than a SemVer parser. The package policy
 * uses one range shape: `>=X.Y.Z`. A different shape needs a policy decision
 * before the documents can describe it.
 *
 * @param {StyleDoc[]} docs
 * @param {string} nodeRange
 * @returns {NodeFloorViolation[]}
 */
export function findNodeFloorViolations(docs, nodeRange) {
  const range = nodeRange.match(/^>=\s*(\d+)\.(\d+)\.(\d+)$/);
  if (!range) {
    return [
      {
        file: PACKAGE_FILE,
        line: 0,
        rule: "invalid-range",
        match: nodeRange,
        expected: ">=X.Y.Z",
      },
    ];
  }

  const floor = `${range[1]}.${range[2]}.${range[3]}`;
  const major = range[1];
  const majorOnlyPatterns = [
    new RegExp(`\\bNode(?:\\.js)?\\s+${major}\\+`, "i"),
    new RegExp(
      `\\bNode(?:\\.js)?\\s+${major}\\s+(?:or\\s+(?:a\\s+)?later(?:\\s+version)?|is\\s+the\\s+minimum\\s+version)\\b`,
      "i",
    ),
    new RegExp(`\\bNode(?:\\.js)?[^\\n]{0,16}>=\\s*${major}(?!\\.)`, "i"),
    new RegExp(`\\bNode-floor\\s*\\(\\s*${major}(?!\\.)`, "i"),
  ];
  const floorContext =
    /\b(?:Node(?:\.js)?[- ]floor|minimum version|pinned to|real Node|baseline supported by|Node engines stay)\b/i;
  const exactVersion = /\b(\d+)\.(\d+)\.(\d+)\b/g;
  /** @type {NodeFloorViolation[]} */
  const violations = [];

  for (const { file, source } of docs) {
    if (!NODE_FLOOR_FILES.includes(file)) continue;
    const lines = maskFencedBlocks(source.split("\n"));

    if (!lines.some((line) => line.includes(floor))) {
      violations.push({
        file,
        line: 0,
        rule: "missing-exact",
        match: "",
        expected: floor,
      });
    }

    for (const [index, line] of lines.entries()) {
      const majorOnly = majorOnlyPatterns.map((pattern) => line.match(pattern)).find(Boolean);
      if (majorOnly) {
        violations.push({
          file,
          line: index + 1,
          rule: "major-only",
          match: majorOnly[0],
          expected: floor,
        });
      }

      if (!floorContext.test(line)) continue;
      for (const match of line.matchAll(exactVersion)) {
        if (match[1] !== major || match[0] === floor) continue;
        violations.push({
          file,
          line: index + 1,
          rule: "wrong-version",
          match: match[0],
          expected: floor,
        });
      }
    }
  }

  return violations;
}

/**
 * THE verdict. This gate ACCUMULATES, so it returns a record and never throws:
 * an exception carries one message, and the report must print every failure
 * (`CONTRIBUTING.md` → "How a release gate is shaped").
 *
 * `readmeSource` and `standardSource` are passed explicitly rather than looked
 * up inside `docs` by filename. Lookup-by-name turns a renamed or missing file
 * into a silent pass, which is the failure mode this repository already names
 * in `check-docs.mjs:44-50`.
 * @param {{
 *   docs: StyleDoc[],
 *   readmeSource: string,
 *   standardSource: string,
 *   nodeRange: string,
 *   missingFiles?: string[],
 * }} input
 * @returns {{
 *   missingFiles: string[],
 *   relativeLinks: { line: number, target: string }[],
 *   vocabulary: { file: string, line: number, rule: string, match: string }[],
 *   terms: TermsDiff,
 *   nodeFloor: NodeFloorViolation[],
 *   ok: boolean,
 * }}
 */
export function judgeDocStyle({
  docs,
  readmeSource,
  standardSource,
  nodeRange,
  missingFiles = [],
}) {
  const relativeLinks = findRelativeLinks(readmeSource);
  const vocabulary = findVocabularyViolations(docs);
  const terms = diffTermsTables(parseTermsTable(readmeSource), parseTermsTable(standardSource));
  const nodeFloor = findNodeFloorViolations(docs, nodeRange);
  return {
    missingFiles,
    relativeLinks,
    vocabulary,
    terms,
    nodeFloor,
    ok:
      missingFiles.length === 0 &&
      relativeLinks.length === 0 &&
      vocabulary.length === 0 &&
      termsAgree(terms) &&
      nodeFloor.length === 0,
  };
}

// ---------------------------------------------------------------------------
// Adapter. All fs access. It records missing files as facts for the decision.
// ---------------------------------------------------------------------------

/**
 * Every file under `dir` with `ext`, relative to the repo root, sorted for
 * stable reporting. Globbed rather than hand-listed, for the reason
 * `check-docs.mjs` globs `src/`: a hand-maintained list silently under-reports.
 * @param {string} dir
 * @param {string} prefix
 * @param {string} ext
 * @returns {string[]}
 */
function collectFiles(dir, prefix, ext) {
  /** @type {string[]} */
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    // Every caller passes a non-empty prefix ("docs" or "src"), and every
    // recursive call inherits a non-empty prefix built from one, so the
    // string is never empty here. No branch on an empty prefix: nothing can
    // take it.
    const rel = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      found.push(...collectFiles(join(dir, entry.name), rel, ext));
    } else if (entry.name.endsWith(ext)) {
      found.push(rel);
    }
  }
  return found.toSorted();
}

/**
 * The parts of the process a test must control to drive `main` without
 * killing the vitest worker: the argv the entry point would read, the
 * directory it resolves `docs/`, `src/`, and `package.json` against, a writer
 * for each of standard out and standard error, and the exit function. A gate
 * that calls `process.exit` directly makes `io.exit` load-bearing — the
 * production call site's default keeps behavior unchanged.
 * @typedef {{
 *   argv: string[],
 *   cwd: string,
 *   out: (line: string) => void,
 *   err: (line: string) => void,
 *   exit: (code: number) => void,
 * }} Io
 */

/**
 * @internal Exported for the entry-point spec. Not a public interface.
 * @type {Io}
 */
export const defaultIo = {
  argv: process.argv,
  cwd: repoRoot,
  out: (line) => console.log(line),
  err: (line) => console.error(line),
  exit: (code) => process.exit(code),
};

/**
 * @internal Exported for the entry-point spec. Not a public interface.
 * @param {string} repoRoot
 * @returns {{ docs: StyleDoc[], missingFiles: string[] }}
 */
export function gatherStyleDocs(repoRoot) {
  const roster = [
    ...STYLE_MARKDOWN_SOURCES.map((file) => ({
      file,
      format: /** @type {const} */ ("markdown"),
    })),
    ...collectFiles(join(repoRoot, "docs"), "docs", ".md").map((file) => ({
      file,
      format: /** @type {const} */ ("markdown"),
    })),
    ...collectFiles(join(repoRoot, "src"), "src", ".ts").map((file) => ({
      file,
      format: /** @type {const} */ ("jsdoc"),
    })),
  ];
  /** @type {StyleDoc[]} */
  const docs = [];
  /** @type {string[]} */
  const missingFiles = [];
  for (const { file, format } of roster) {
    const abs = join(repoRoot, file);
    if (!existsSync(abs)) {
      missingFiles.push(file);
      continue;
    }
    docs.push({ file, format, source: readFileSync(abs, "utf8") });
  }
  return { docs, missingFiles };
}

/** @internal Exported for the entry-point spec. Not a public interface. */
export function main(io = defaultIo) {
  const repoRoot = io.cwd;
  const { docs, missingFiles } = gatherStyleDocs(repoRoot);
  const byFile = new Map(docs.map((d) => [d.file, d.source]));
  const readmeSource = byFile.get(README_FILE) ?? "";
  const standardSource = byFile.get(WRITING_STANDARD_FILE) ?? "";
  const packageJson = JSON.parse(readFileSync(join(repoRoot, PACKAGE_FILE), "utf8"));
  const nodeRange = packageJson.engines?.node ?? "";
  const verdict = judgeDocStyle({
    docs,
    readmeSource,
    standardSource,
    nodeRange,
    missingFiles,
  });

  io.out(`check-doc-style: scanned ${docs.length} documentation sources`);

  if (verdict.missingFiles.length > 0) {
    io.err(`\ncheck-doc-style: ${verdict.missingFiles.length} documentation file(s) missing`);
    for (const file of verdict.missingFiles) io.err(`  ${file}`);
  }

  if (verdict.relativeLinks.length > 0) {
    io.err(`\ncheck-doc-style: ${verdict.relativeLinks.length} relative link(s) in ${README_FILE}`);
    for (const link of verdict.relativeLinks) {
      io.err(`  ${README_FILE}:${link.line}  ${link.target}`);
    }
    io.err(`  ${README_FILE} is the only document in the npm tarball. Use an absolute URL.`);
  }

  if (verdict.vocabulary.length > 0) {
    io.err(`\ncheck-doc-style: ${verdict.vocabulary.length} controlled-vocabulary violation(s)`);
    const messages = new Map(VOCABULARY_RULES.map((rule) => [rule.id, rule.message]));
    for (const hit of verdict.vocabulary) {
      io.err(`  ${hit.file}:${hit.line} [${hit.rule}] "${hit.match}"`);
      io.err(`      ${messages.get(hit.rule)}`);
    }
  }

  if (!termsAgree(verdict.terms)) {
    io.err(
      `\ncheck-doc-style: the ${README_FILE} Terms table does not match ${WRITING_STANDARD_FILE}`,
    );
    const { missing, extra, misordered, meaningDrift, unparsed } = verdict.terms;
    if (unparsed.length > 0) io.err(`  no Terms table found in : ${unparsed.join(", ")}`);
    if (missing.length > 0) io.err(`  missing from README    : ${missing.join(", ")}`);
    if (extra.length > 0) io.err(`  not in the standard    : ${extra.join(", ")}`);
    if (misordered) io.err("  the two tables carry the same terms in a different order");
    if (meaningDrift.length > 0) {
      io.err(`  meaning has drifted    : ${meaningDrift.join(", ")}`);
      io.err("  A README meaning must BEGIN WITH the standard's meaning.");
    }
  }

  if (verdict.nodeFloor.length > 0) {
    io.err(`\ncheck-doc-style: ${verdict.nodeFloor.length} Node.js floor violation(s)`);
    for (const hit of verdict.nodeFloor) {
      const location = hit.line === 0 ? hit.file : `${hit.file}:${hit.line}`;
      if (hit.rule === "missing-exact") {
        io.err(`  ${location} [${hit.rule}] expected ${hit.expected}`);
        continue;
      }
      io.err(`  ${location} [${hit.rule}] "${hit.match}" (expected ${hit.expected})`);
    }
  }

  if (!verdict.ok) {
    io.err("\nRead docs/writing-standard.md, then fix the documents.");
    io.exit(1);
    return;
  }

  io.out("check-doc-style: OK — links, controlled vocabulary, Terms table, and Node floor agree.");
}

// Importing this module must do nothing at all. isMainModule resolves symlinks
// on both sides; a lexical comparison once made every gate in this repository
// print nothing and exit 0 through a symlink, which CI read as a pass.
if (isMainModule(import.meta.url)) main();
