import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
// @ts-expect-error — a gate script written in checked JavaScript, no declarations.
import { validateRelease } from "../../scripts/validate-release.mjs";

// ═══════════════════════════════════════════════════════════════════════════
// ROUND 23, LANE H4 — the direction obligation at the release boundary, and
// the sentences round 22 wrote.
//
// Round 22 taught `scripts/validate-release.mjs` to refuse a dated section
// that says nothing, and then stated plainly what it still does not prove:
// that the text is true, that it describes THIS release, or that it satisfies
// semver rule 8's direction obligation. The last of the three is not a
// limitation of a text check. It is a hole with a name:
//
//   * Rule 8 obliges `CHANGELOG.md` to state each direction `toJSON().url`
//     moved, and names the dated section as where a reader finds it, because
//     RELEASING.md step 1 copies the pending block there verbatim.
//   * The only reader of that obligation — the `<!-- redaction-directions: … -->`
//     declaration and the 2.0.1 differential behind it — reads `## [Unreleased]`.
//   * `validate-release` requires `## [Unreleased]` to be EMPTY before it lets
//     the workflow publish.
//
// So at the moment the obligation applies, the section that carries it is the
// one section no gate reads, and the section every gate reads is the one step 1
// has just emptied. This file drives that with the repository's own changelog,
// put through step 1 exactly as RELEASING.md describes it.
// ═══════════════════════════════════════════════════════════════════════════

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const repoText = (path: string): string => readFileSync(join(REPO_ROOT, path), "utf8");
/** A document sentence with its line wrapping removed, so a quote can be found. */
const unwrapped = (text: string): string => text.replaceAll(/\s+/g, " ");

const COMPARE = "https://github.com/pbpeterson/typed-fetch/compare";

/** Everything `validateRelease` asks for, with `changelog` and `version` free. */
function candidate(version: string, changelog: string): Record<string, unknown> {
  return {
    tag: `v${version}`,
    refType: "tag",
    packageName: "@pbpeterson/typed-fetch",
    version,
    repositoryUrl: "git+https://github.com/pbpeterson/typed-fetch.git",
    publishAccess: "public",
    provenance: true,
    changelog,
    headCommit: "a".repeat(40),
    tagCommit: "a".repeat(40),
    mainCommit: "a".repeat(40),
  };
}

/** Whether `validateRelease` lets the workflow publish `changelog` as `version`. */
function accepts(version: string, changelog: string): boolean {
  try {
    validateRelease(candidate(version, changelog));
    return true;
  } catch {
    return false;
  }
}

// ── RELEASING.md step 1, performed on the repository's own changelog ───────
//
// "Move all pending changelog entries from `[Unreleased]` into
// `## [X.Y.Z] - YYYY-MM-DD`, and leave `[Unreleased]` empty." Rule 8 forbids a
// patch for this release — the pending block declares the redacted url moved —
// so the version is 2.1.0, the lowest number the rule permits.

const RELEASE_VERSION = "2.1.0";
const RELEASE_DATE = "2026-08-11";

/** The text of the `## [Unreleased]` section, up to the next released heading. */
function pendingBlock(changelog: string): string {
  const open = "## [Unreleased]\n";
  const start = changelog.indexOf(open);
  expect(start, "CHANGELOG.md must carry an `## [Unreleased]` section").not.toBe(-1);
  const rest = changelog.slice(start + open.length);
  const end = rest.search(/^## \[\d/m);
  expect(end, "CHANGELOG.md must carry a released section under the pending one").not.toBe(-1);
  return rest.slice(0, end);
}

/**
 * The repository's changelog after step 1, with `edit` applied to the block on
 * its way into the dated section. The footer moves with it, exactly as the
 * numbered rules under `## Semver policy` require: `[Unreleased]` compares from
 * the new tag, and the new version compares from the previous one.
 */
function afterStepOne(edit: (block: string) => string = (block) => block): string {
  const changelog = repoText("CHANGELOG.md");
  const block = pendingBlock(changelog);
  return changelog
    .replace(
      `## [Unreleased]\n${block}`,
      `## [Unreleased]\n\n## [${RELEASE_VERSION}] - ${RELEASE_DATE}\n${edit(block)}`,
    )
    .replace(
      `[Unreleased]: ${COMPARE}/v2.0.1...HEAD`,
      `[Unreleased]: ${COMPARE}/v${RELEASE_VERSION}...HEAD\n` +
        `[${RELEASE_VERSION}]: ${COMPARE}/v2.0.1...v${RELEASE_VERSION}`,
    );
}

/** The declaration line the direction obligation is carried by. */
const DECLARATION = /^<!--\s*redaction-directions:[^>]*-->\n/m;

describe("R23-H4-03 — the direction obligation at the release boundary", () => {
  test("EVIDENCE: the pending block carries exactly one direction declaration today", () => {
    const declarations = [
      ...pendingBlock(repoText("CHANGELOG.md")).matchAll(
        /<!--\s*redaction-directions:\s*([^>]*?)\s*-->/g,
      ),
    ];
    expect(declarations.map((match) => match[1])).toEqual(["removes-more"]);
  });

  test("the release gate reads that declaration out of the DATED section", () => {
    // WHAT THIS ROW USED TO ASSERT, and why it could not survive its own fix.
    // It required `scripts/validate-release.mjs` NOT to contain the token —
    // "no gate script may read the declaration, or this finding is already
    // closed" — while the finding's only remedy is to put the token there. The
    // sentence was true of the tree and was the negation of the cure, so the
    // row is written here as the invariant that holds AFTER the repair, and the
    // pre-fix state stays as this prose. Seventh instrument in this audit that
    // could not survive its fix, and the first that forbade it outright.
    //
    // The two PENDING-section readers are unchanged and stay pinned as text, so
    // pointing either of them at the released section is still a reviewable
    // diff rather than a silent widening — the discipline `IGNORE_SITES`
    // imposes. What changed is that a third reader now exists, in the one place
    // that runs between a git tag and `npm publish`.
    const reader = repoText("tests/surface/surface-changelog-direction-witnesses.spec.ts");
    expect(reader).toContain('const start = changelog.indexOf("## [Unreleased]");');
    expect(reader).toContain(
      "const declarations = [...rawBlock.matchAll(/<!--\\s*redaction-directions:\\s*([^>]*?)\\s*-->/g)];",
    );
    expect(repoText("scripts/gate-mutation-disabled-steps.spec.mjs")).toContain(
      "the `[Unreleased]` block now carries two `redaction-directions` declarations",
    );
    expect(
      repoText("scripts/validate-release.mjs"),
      "the only check between a git tag and `npm publish` must read the direction declaration " +
        "out of the section RELEASING.md step 1 moves it into, because every other reader of it " +
        "slices `## [Unreleased]` — the one section this same gate requires to be empty",
    ).toContain("redaction-directions");
  });

  test("EVIDENCE: step 1 empties the section that reader reads, and the gate accepts", () => {
    const released = afterStepOne();
    // The pending section is now empty, which is the source half of step 1 and
    // what `validate-release` requires. The round-19 reader's own slice of it
    // therefore yields nothing, and its `toBe(1)` on the declaration count can
    // never be satisfied again from that section.
    expect(pendingBlock(released).trim()).toBe("");
    expect([
      ...pendingBlock(released).matchAll(/<!--\s*redaction-directions:[^>]*-->/g),
    ]).toHaveLength(0);
    // And the declaration did survive the copy, in the section rule 8 names.
    expect(released).toMatch(
      new RegExp(`## \\[${RELEASE_VERSION}\\][\\s\\S]*redaction-directions: removes-more`),
    );
    expect(accepts(RELEASE_VERSION, released)).toBe(true);
  });

  test("a released section that states no direction is refused", () => {
    // R23-H4-03, the drive that closed it.
    //
    // The same changelog, one line lighter: the direction declaration is
    // dropped on its way into the dated section. Before the repair nothing in
    // this repository objected — `validate-release` proved the section carried
    // text and asked it nothing about direction, and the declaration's only
    // readers sliced `## [Unreleased]`, which this same gate had just required
    // to be empty. So the round that cut the release would have had to rewrite
    // those readers by hand, with no gate saying the obligation moved with the
    // block.
    //
    // Either side could close it: the release gate may require the dated
    // section to carry exactly one declaration from the closed vocabulary, or
    // the round-19 reader may read the released section as well as the pending
    // one. The release gate is what carries it, because it is the one that runs
    // between the tag and the publish.
    const withoutDirection = afterStepOne((block) => block.replace(DECLARATION, ""));
    expect(withoutDirection).not.toContain("redaction-directions");
    expect(
      accepts(RELEASE_VERSION, withoutDirection),
      "RELEASING.md semver rule 8 obliges `CHANGELOG.md` to state each direction " +
        "`toJSON().url` moved, and the released section is where a reader finds it, because " +
        "RELEASING.md step 1 copies the pending block there verbatim. This changelog is the " +
        "repository's own, put through step 1 with the declaration deleted, and the only gate " +
        "between the tag and `npm publish` must refuse it",
    ).toBe(false);
  });

  test.each([
    ["two declarations", (block: string): string => block.replace(DECLARATION, "$&$&")],
    [
      "a direction outside the closed vocabulary",
      (block: string): string =>
        block.replace(DECLARATION, "<!-- redaction-directions: shortens -->\n"),
    ],
    [
      "a declaration that names nothing",
      (block: string): string => block.replace(DECLARATION, "<!-- redaction-directions: -->\n"),
    ],
  ])("a released section carrying %s is refused too", (_name, edit) => {
    // The other two ways the obligation can be unmet with the section full of
    // prose. Two declarations claim two things and are answered for by one —
    // R21-H4-05's shape, at the release boundary this time — and a value the
    // vocabulary does not hold is a direction no reader can act on.
    expect(accepts(RELEASE_VERSION, afterStepOne(edit))).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. THE SENTENCES ROUND 22 WROTE, EACH READ FOR WHAT IT QUANTIFIES OVER.
//
// This audit has produced five false sentences, and rounds 21 and 22 each
// caught more before they were written than after. Round 22 wrote four: three
// in CONTRIBUTING.md and one in RELEASING.md. Each is read here for the SET it
// ranges over, and every member of that set is measured.
//
// The result is three true and one false. The false one is the `needs:`
// sentence, and `scripts/gate-mutation-yaml-spellings.spec.mjs` carries its failing drive;
// the rows below record the exact quantifier so the correction is a sentence
// and not a guess.
// ═══════════════════════════════════════════════════════════════════════════

describe("the four sentences round 22 wrote", () => {
  test("RELEASING: the dated section says something once the footer links are set aside", () => {
    // The sentence ranges over a section's CONTENT against one exception, the
    // link reference definitions. Four members: nothing, whitespace, the
    // definitions alone, and one real entry. The definitions sit UNDER the
    // dated heading whenever the released section is the last one, which is
    // exactly the shape a release produces.
    expect(unwrapped(repoText("RELEASING.md"))).toContain(
      "that dated section says something once the footer link definitions are set aside, so a " +
        "release that deleted the pending entries instead of moving them into it is refused;",
    );
    const section = (body: string): string =>
      `# Changelog\n\n## [Unreleased]\n\n## [1.0.0] - 2026-07-17\n${body}` +
      `[Unreleased]: ${COMPARE}/v1.0.0...HEAD\n[1.0.0]: ${COMPARE}/v0.8.1...v1.0.0\n`;

    expect(accepts("1.0.0", section(""))).toBe(false);
    expect(accepts("1.0.0", section("\n  \n\t\n"))).toBe(false);
    expect(accepts("1.0.0", section(`\n[0.9.0]: ${COMPARE}/v0.8.1...v0.9.0\n\n`))).toBe(false);
    // The accepting member carries the direction declaration as well, because
    // the same gate now reads semver rule 8's obligation out of this section.
    // The sentence above quantifies over CONTENT against the link-definition
    // exception, and all four members answer that question unchanged: three say
    // nothing, and this one says something.
    expect(
      accepts(
        "1.0.0",
        section(
          "\n<!-- redaction-directions: none -->\n\n### Fixed\n\n" +
            "- A real entry a reader can act on.\n\n",
        ),
      ),
    ).toBe(true);
  });

  test("CONTRIBUTING: a spec runs the Bun smoke wherever Bun and a built dist both exist", () => {
    // The sentence ranges over the CONDITION under which that file executes,
    // and over what the v8 instrument sees. Both halves are read out of the
    // file it names, because that file is the claim's subject.
    expect(unwrapped(repoText("CONTRIBUTING.md"))).toContain(
      "`tests/surface/surface-runtime-smoke-commands.spec.ts` runs that file under Bun wherever a Bun " +
        "binary and a built `dist/` both exist, and the v8 instrument measures no child " +
        "process, which is why `vitest.config.ts` drops it from the coverage threshold.",
    );
    const spec = repoText("tests/surface/surface-runtime-smoke-commands.spec.ts");
    // The needle is BUILT, never written out. `surface-bun-smoke-exclusion-reason.spec.ts`
    // reads every spec that holds both the Bun spawn call and the smoke's path
    // and requires CONTRIBUTING.md to name it, so quoting that call verbatim
    // beside the path would make this file read as an executor of a smoke it
    // never runs — and turn a committed test red on a mention.
    const spawnBun = `spawnSync(${JSON.stringify("bun")}`;
    expect(spec).toContain(
      `const bunAvailable = ${spawnBun}, ["--version"], { encoding: "utf8" }).status === 0;`,
    );
    expect(spec).toContain("describe.skipIf(!distExists || !bunAvailable)");
    // A CHILD process, which no in-process v8 instrument reaches — and the
    // path really is the one the exclusion list names.
    expect(spec).toContain(`${spawnBun}, ["run", join(REPO_ROOT, "scripts/smoke/bun.mjs")]`);
    expect(repoText("vitest.config.ts")).toContain('exclude: ["scripts/smoke/bun.mjs"');
  });

  test("CONTRIBUTING: the roster sentence names two spellings and quantifies over all of them", () => {
    // EVIDENCE for R23-H4-01 and R23-H4-02, recorded as the quantifier each
    // sentence carries. Neither sentence limits itself to a spelling:
    //
    //   "an `if: false` under it … fail[s] the roster" — every YAML spelling
    //   of that key, and `"if": false` is one. The reader spells a key
    //   `/^([\w-]+):/`, which is the unquoted spelling alone.
    //
    //   "a `needs:` on a job written `if: false` fails it as well" — every
    //   YAML spelling of `needs:`. `jobNeeds` documents three; YAML accepts a
    //   block sequence at the key's own indentation and a flow sequence broken
    //   across lines as well, and the reader answers "no dependencies" for
    //   both.
    //
    // The drives are in `scripts/gate-mutation-yaml-spellings.spec.mjs`. These rows pin the
    // sentences, so the correction is written and not guessed.
    const contributing = unwrapped(repoText("CONTRIBUTING.md"));
    expect(contributing).toContain(
      "so a `#` in front of that run line, an `if: false` under it, and a " +
        "`continue-on-error: true` under it each fail the roster.",
    );
    expect(contributing).toContain(
      "A job the roster reads out of must also `needs:` only jobs that run: GitHub Actions " +
        "skips a job whose dependency was skipped, and the roster follows that chain, so a " +
        "`needs:` on a job written `if: false` fails it as well.",
    );
    const gate = repoText("scripts/gate-properties.spec.mjs");
    expect(gate).toContain("const key = /^([\\w-]+):/.exec(line.slice(open.indent + 2));");
    expect(gate).toContain("in each of the three spellings YAML");
    expect(gate).toContain("const item = /^ {5,}- *(.+)$/.exec(line);");
  });
});
