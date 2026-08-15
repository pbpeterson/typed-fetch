import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { builtEntryUrl, distExists, warnWhenDistMissing } from "../../fixtures/built-package";

// ═══════════════════════════════════════════════════════════════════════════
// ROUND 19, LANE H4 — the release the audit could not cut, and the documents
// it has written since round 16.
//
// The release IS cut now: 2.1.0, dated, with the block moved under it. The
// three readiness rows below were written as pins on the BLOCKED state so that
// cutting turned them red; they now read the same three facts from the other
// side of release-checklist step 1, and every block reader in this file reads
// the DATED section rather than `[Unreleased]`, which step 1 emptied.
//
// Three subjects, in this order:
//
//  1. RELEASE READINESS, false from round 15 until this cut, with each recorded
//     reason turned into an assertion against the files — and one reason the
//     audit has never asserted: semver rule 8 requires `CHANGELOG.md` to state
//     EACH DIRECTION the output moved, and the block names a direction no input
//     took. That is measured against a REBUILT 2.0.1 tree, because "used to be
//     deleted" is a claim about the released package and no document can answer
//     it.
//  2. The CI job roster CONTRIBUTING.md gives a contributor, against the jobs
//     `.github/workflows/ci.yml` actually declares.
//  3. The three sentences `.audit-state.json` still lists as OWED, each one
//     measured against the BUILT package rather than read from a document.
//
// Every behavior claim resolves through `fixtures/built-package`, the one place
// in this repository that names a built path.
// ═══════════════════════════════════════════════════════════════════════════

warnWhenDistMissing("surface-changelog-direction-witnesses", distExists);

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const repoText = (path: string): string => readFileSync(join(REPO_ROOT, path), "utf8");
/** A document sentence with its line wrapping removed, so a quote can be found. */
const unwrapped = (text: string): string => text.replaceAll(/\s+/g, " ");

interface ErrorBag {
  NetworkError: new (
    message?: string,
    options?: { url?: string },
  ) => Error & {
    toJSON(): { url: string };
  };
}

/** The REDACTED url the BUILT package emits for `url` — the record's copy. */
async function headEmitter(): Promise<(url: string) => string> {
  const bag = (await import(
    /* @vite-ignore */ builtEntryUrl("dist/errors/index.mjs").href
  )) as ErrorBag & Record<string, unknown>;
  return (url) => new bag.NetworkError("Network error", { url }).toJSON().url;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. RELEASE READINESS, AND THE DIRECTION RULE 8 ASKS FOR.
// ═══════════════════════════════════════════════════════════════════════════

/** The version this tree cut, read from the manifest rather than pinned here. */
const RELEASE_VERSION = (JSON.parse(repoText("package.json")) as { version: string }).version;

/**
 * The text of the DATED release section, up to the next `## [` heading.
 *
 * Until the release was cut this read `## [Unreleased]`, because that is where
 * the entries were. Release-checklist step 1 moved them into
 * `## [<RELEASE_VERSION>] - <date>` and left `[Unreleased]` empty, and
 * `scripts/validate-release.mjs` requires it to STAY empty — so a reader still
 * anchored on the pending heading slices the empty string and every assertion
 * over it passes for the wrong reason. The gate reads the dated section for
 * exactly this reason, and so does this file.
 */
function releasedBlock(): string {
  const changelog = repoText("CHANGELOG.md");
  // The WHOLE heading line, date included. Slicing at `## [2.1.0]` alone leaves
  // the ` - <date>` remainder inside the block, so an EMPTIED section still
  // answers `"- 2026-08-15"` and every non-vacuity guard over it passes on a
  // section with nothing in it.
  const open = new RegExp(`^## \\[${RELEASE_VERSION}\\] - \\d{4}-\\d{2}-\\d{2}$`, "m").exec(
    changelog,
  );
  expect(
    open,
    `CHANGELOG.md must carry a dated \`## [${RELEASE_VERSION}]\` section`,
  ).not.toBeNull();
  const rest = changelog.slice((open?.index ?? 0) + (open?.[0].length ?? 0));
  const end = rest.search(/\n## \[/);
  return (end === -1 ? rest : rest.slice(0, end)).trim();
}

describe("release readiness, as assertions against the files", () => {
  // These three rows used to be PINS on the BLOCKED state: `package.json` at
  // 2.0.1, a non-empty `[Unreleased]`, and rule 8 forbidding the patch that
  // version implied. They were written to turn red the moment the release was
  // cut, so that the round doing the cutting had to answer all three in one
  // commit. This is that commit, and they now assert the CUT state instead:
  // same three facts, read from the other side of step 1.
  test("the manifest carries the cut version, and the changelog dates it", () => {
    const manifest = JSON.parse(repoText("package.json")) as { version: string };
    expect(manifest.version).toBe("2.1.0");
    expect(repoText("CHANGELOG.md")).toMatch(
      new RegExp(`^## \\[${manifest.version}\\] - \\d{4}-\\d{2}-\\d{2}$`, "m"),
    );
  });

  test("the `[Unreleased]` block is empty, which is what validate-release requires", () => {
    const changelog = repoText("CHANGELOG.md");
    const pending = "## [Unreleased]";
    const at = changelog.indexOf(pending);
    const tail = changelog.slice(at + pending.length);
    const stop = tail.search(/\n## \[/);
    expect((stop === -1 ? tail : tail.slice(0, stop)).trim()).toBe("");
    expect(unwrapped(repoText("RELEASING.md"))).toContain(
      "the `[Unreleased]` changelog section is empty;",
    );
    // The entries did not vanish: step 1 MOVED them, and the gate refuses a
    // dated section that describes nothing.
    expect(releasedBlock()).not.toBe("");
  });

  test("rule 8's minor was taken, not the patch it forbids", () => {
    // 2.0.1 was cut in this repository and never published, and the block
    // declares the redacted url moved, so 2.1.0 is the lowest number rule 8
    // permits. RELEASING.md states the rule and no gate enforces it, which is
    // why it is written down here as well.
    const rule8 = unwrapped(repoText("RELEASING.md"));
    expect(rule8).toContain("A change in what `toJSON().url` emits is a `minor` at least.");
    expect(rule8).toContain(
      "`CHANGELOG.md` states each direction the output moved, and names one ordinary input per direction.",
    );
    expect(RELEASE_VERSION).toBe("2.1.0");
    // The quote is the block's declaration that the output moved, which is what
    // forced the minor. R19-H4-01 requalified the sentence, so the pin reads the
    // requalified wording; it must never read a direction the block only claims.
    expect(unwrapped(releasedBlock())).toContain(
      "`redactUrl`'s output moved for an ordinary input, not only for an attack shape.",
    );
  });
});

// ── The 2.0.1 tree, rebuilt ──────────────────────────────────────────────
//
// Rule 8's obligation is a claim about a DIFF against the released package, and
// the audit has stated its answer twice from a scratch sweep that nothing
// committed reproduces. The ledger already carries the correction for exactly
// that: "a verification population that does not survive the round cannot be
// cited by a later one." So the comparison tree is built here, from the
// repository's own history, with the bundler the repository already ships.

/** The esbuild binary pnpm installed for `tsup`, or null when it is absent. */
function esbuildBinary(): string | null {
  const store = join(REPO_ROOT, "node_modules/.pnpm");
  if (!existsSync(store)) return null;
  for (const entry of readdirSync(store)) {
    if (!entry.startsWith("esbuild@")) continue;
    const binary = join(store, entry, "node_modules/esbuild/bin/esbuild");
    if (existsSync(binary)) return binary;
  }
  return null;
}

/** `git`, run in this repository, answering stdout. */
function git(...argv: string[]): string {
  const result = spawnSync("git", argv, { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 1 << 28 });
  expect(result.status, `git ${argv[0]} failed: ${result.stderr}`).toBe(0);
  return result.stdout;
}

/**
 * The commit that CUT 2.0.1: the OLDEST commit touching `package.json` whose
 * manifest reads `2.0.1`. `2.0.1` was never published, so this commit is the
 * only record of that tree, and rebuilding it is the only way to measure it.
 *
 * The newest such commit is not it — `src/` moved several times afterwards
 * while the version stayed put — and that is the trap this helper exists to
 * avoid.
 */
function releaseCommitOf(version: string): string {
  const commits = git("log", "--format=%H", "--", "package.json").split("\n").filter(Boolean);
  for (const commit of commits.toReversed()) {
    const manifest = JSON.parse(git("show", `${commit}:package.json`)) as { version: string };
    if (manifest.version === version) return commit;
  }
  throw new Error(`no commit in this history publishes ${version}`);
}

const ESBUILD = esbuildBinary();

/**
 * The 2.0.1 error cluster, bundled into one module, plus the emitter that
 * answers what its `toJSON()` wrote.
 */
async function publishedEmitter(): Promise<{ emit: (url: string) => string; cleanup: () => void }> {
  const root = mkdtempSync(join(tmpdir(), "tf-round19-h4-201-"));
  const commit = releaseCommitOf("2.0.1");
  // The changelog of that commit must carry an EMPTY `[Unreleased]`, which is
  // what a cut release means and what makes the tree the right comparison.
  const changelog = git("show", `${commit}:CHANGELOG.md`);
  const unreleased = /## \[Unreleased\]\n([\s\S]*?)\n## \[\d/.exec(changelog);
  expect((unreleased?.[1] ?? "").trim()).toBe("");

  const archive = spawnSync("git", ["archive", commit, "src", "index.ts"], {
    cwd: REPO_ROOT,
    encoding: "buffer",
    maxBuffer: 1 << 28,
  });
  expect(archive.status, "git archive must produce the 2.0.1 tree").toBe(0);
  const tarball = join(root, "tree.tar");
  writeFileSync(tarball, archive.stdout);
  expect(spawnSync("tar", ["-xf", tarball, "-C", root], { encoding: "utf8" }).status).toBe(0);

  const bundle = join(root, "errors-2.0.1.mjs");
  const built = spawnSync(
    ESBUILD as string,
    [
      "--bundle",
      "--format=esm",
      "--platform=node",
      `--outfile=${bundle}`,
      join(root, "src/errors/index.ts"),
    ],
    { encoding: "utf8" },
  );
  expect(built.status, `esbuild failed on the 2.0.1 tree: ${built.stderr}`).toBe(0);

  const bag = (await import(/* @vite-ignore */ `file://${bundle}`)) as ErrorBag;
  return {
    emit: (url) => new bag.NetworkError("Network error", { url }).toJSON().url,
    cleanup: () => rmSync(root, { force: true, recursive: true }),
  };
}

/** A structured corpus over the shapes the released block talks about. */
function redactionCorpus(): string[] {
  const heads = [
    "https://api.test/go/",
    "https://api.test/",
    "/go/",
    "",
    "https://api.test/x?next=",
  ];
  const schemes = ["https:", "http:", "file:", "ftp:", "ws:", "git:", "urn:", "", "HTTPS:", "x-y:"];
  const solidi = ["", "/", "//", "///"];
  const bodies = [
    "Users/alice@corp/report.pdf",
    "svc:pw@host/v1",
    "cdn.test/img/alice@example.com/a.png",
    "cdn.test:8443/users/@alice",
    "c:/Users/alice@corp/x",
    "@../cdn.test/x",
    "alice:pw@h.test/p",
  ];
  const tails = ["", "/v1", "?q=1", "#f"];

  const urls: string[] = [];
  for (const head of heads)
    for (const scheme of schemes)
      for (const run of solidi)
        for (const body of bodies)
          for (const tail of tails) urls.push(head + scheme + run + body + tail);
  return urls;
}

describe.skipIf(!distExists || ESBUILD === null)(
  "the released block against the tree it claims to move away from",
  () => {
    /** Every url whose record differs between the 2.0.1 tree and HEAD. */
    async function differential(): Promise<{
      removesMore: string[];
      keepsMore: string[];
      published: (url: string) => string;
      head: (url: string) => string;
      cleanup: () => void;
    }> {
      const head = await headEmitter();
      const { emit: published, cleanup } = await publishedEmitter();
      const removesMore: string[] = [];
      const keepsMore: string[] = [];
      for (const url of redactionCorpus()) {
        const before = published(url);
        const after = head(url);
        if (before === after) continue;
        // "Removes more" and "keeps more" in the block's own terms: which of
        // the two answers gives the reader more of the url back.
        if (after.length < before.length) removesMore.push(url);
        else keepsMore.push(url);
      }
      return { removesMore, keepsMore, published, head, cleanup };
    }

    test("EVIDENCE: the removes-more direction the block names has witnesses", async () => {
      const { removesMore, cleanup } = await differential();
      try {
        expect(removesMore.length).toBeGreaterThan(1000);
      } finally {
        cleanup();
      }
    }, 60_000);

    test("EVIDENCE: both `file:` urls the block names are byte-identical in both trees", async () => {
      const { published, head, cleanup } = await differential();
      try {
        for (const url of [
          "https://api.test/go/file:/Users/alice@corp/report.pdf",
          "/go/file:/Users/alice@corp/report.pdf",
          "file:///c:/Users/alice@corp/x",
        ]) {
          expect(unwrapped(releasedBlock())).toContain(url.replace("https://api.test", ""));
          expect(published(url)).toBe(url);
          expect(head(url)).toBe(url);
        }
      } finally {
        cleanup();
      }
    }, 60_000);

    test("every direction the block names is a direction some input actually took", async () => {
      // R19-H4-01.
      //
      // Semver rule 8: "`CHANGELOG.md` states each direction the output moved."
      // The rule runs one way only. It obliges the block to name every
      // direction that moved; it does not permit the block to name one that
      // did not. `RELEASING.md` step 1 copies this block verbatim into the
      // published `## [X.Y.Z]` section, so a direction with no witness becomes
      // a permanent sentence about a release nobody can reproduce.
      //
      // The test reads the block, collects the directions it CLAIMS, and asks
      // the differential for a witness of each. It is written this way, and
      // not as an assertion about one direction, so that it answers for the
      // block the repository carries rather than for the block one round wrote.
      // R18-H4-02 measured the same asymmetry over 23,040 urls, and its fix
      // supplied the missing direction without removing the one that never
      // happened.
      // R20-H4-06 rewrote the reading. The first version collected claims by
      // matching four fixed phrases, so the SAME claim in other words read as no
      // claim at all and passed — the defect this test exists to catch, inside
      // the test written to catch it. Two readings replace the phrase list:
      //
      //  1. A machine-readable declaration, `<!-- redaction-directions: … -->`,
      //     with a closed vocabulary. An HTML comment because RELEASING.md step
      //     1 copies the block verbatim into the published section, so the
      //     declaration survives the copy without rendering. It is REQUIRED: a
      //     block with no declaration fails here rather than passing silently.
      //  2. The direction bullet, pinned VERBATIM. Free prose is what defeated
      //     the phrase list, and only a verbatim pin refuses free prose. Editing
      //     the bullet is therefore a deliberate edit of this test, the same
      //     discipline `IGNORE_SITES` imposes on a `v8 ignore` range.
      //
      // The check runs BOTH ways: a declared direction needs a witness, and a
      // witnessed direction needs a declaration. Rule 8 obliges the block to
      // name every direction that moved, and forbids naming one that did not.
      //
      // What this still does not read: a direction sentence written into some
      // OTHER bullet of the block. Closing that means pinning the whole block.
      const DIRECTION_VOCABULARY = ["removes-more", "keeps-more", "none"] as const;
      const DIRECTION_BULLET =
        "- **`redactUrl`'s output moved for an ordinary input, not only for an attack shape.** " +
        "An embedded credential in an ordinary path segment is now removed where it used to " +
        "survive — see the region rules above. A `file:` path segment that a build inside this " +
        "unreleased window deleted is kept again, because `file:` opens no region under fewer " +
        "than two solidi; the `2.0.1` tree keeps it too, so only a build inside this window " +
        "deleted it. See the `file:` bullet above. A path segment behind a bare `//` authority " +
        "is kept again for the same kind of reason: the region there ends at the authority the " +
        "parser reads, so the segment behind it was never a credential to remove. Over the " +
        "140,640-url population the disclosure suite draws, 1,266 rows keep such a segment that " +
        "a build inside this window removed, and on none of them does the platform report a " +
        "credential. The `2.0.1` tree did not remove them either: over that same population, the " +
        "record this release emits is never longer than the `2.0.1` tree's, on any row. A " +
        "credential-free proxy url shows the direction an ordinary input actually took: " +
        "`redactUrl` turns " +
        "`https://api.test/relay/https://media.test/photos/mia@example.com/pic.png` into " +
        "`https://api.test/relay/https://example.com/pic.png`. The record drops `media.test`, " +
        "the host the request contacted, and names `example.com`, a host it never reached. See " +
        "`SECURITY.md` for the residual this shape leaves open. Anything that greps or alerts on " +
        "`error.message` or `toJSON().url` sees a different string after this upgrade. That is " +
        "true even for a url that carried no credential at all before this release.";

      const rawBlock = releasedBlock();
      const block = unwrapped(rawBlock);

      // R21-H4-05. `matchAll`, and EXACTLY ONE declaration. The first reading
      // used `exec`, which answers the first match and stops, so a block
      // carrying two declarations claimed two things and was read for one — the
      // second could name a direction no input took with this test green. A
      // second declaration is not a second claim to union in: the block answers
      // for itself once, and two answers are the failure.
      const declarations = [...rawBlock.matchAll(/<!--\s*redaction-directions:\s*([^>]*?)\s*-->/g)];
      expect(
        declarations.length,
        "the released block must declare which directions it claims EXACTLY ONCE, as " +
          "`<!-- redaction-directions: … -->`, so this test reads a closed vocabulary " +
          "rather than guessing at prose. No declaration leaves the block unread; a second " +
          "one states a claim the first answers for, and RELEASING.md step 1 copies every " +
          "declaration in the block verbatim into the published section",
      ).toBe(1);
      const declared = (declarations[0]?.[1] ?? "")
        .split(",")
        .map((word) => word.trim())
        .filter(Boolean);
      expect(
        declared.filter((word) => !DIRECTION_VOCABULARY.includes(word as never)),
        `the declaration takes only ${DIRECTION_VOCABULARY.join(", ")}`,
      ).toEqual([]);
      expect(declared, "the declaration must name at least one value").not.toEqual([]);

      const bulletStart = block.indexOf("- **`redactUrl`'s output moved");
      expect(bulletStart, "the block must carry the direction bullet").not.toBe(-1);
      expect(
        block.slice(bulletStart, bulletStart + DIRECTION_BULLET.length),
        "the direction bullet is pinned verbatim: free prose is how a witnessless " +
          "direction re-entered the block under R20-H4-06, and only a verbatim pin " +
          "refuses it. Editing the bullet is a deliberate edit of this test",
      ).toBe(DIRECTION_BULLET);

      const { removesMore, keepsMore, cleanup } = await differential();
      try {
        const witnesses = {
          "removes-more": removesMore,
          "keeps-more": keepsMore,
        };
        const claimedWithNoWitness = declared
          .filter((word) => word !== "none")
          .filter((word) => witnesses[word as keyof typeof witnesses].length === 0);
        const witnessedWithNoClaim = (Object.keys(witnesses) as (keyof typeof witnesses)[])
          .filter((word) => witnesses[word].length > 0)
          .filter((word) => !declared.includes(word));
        expect(
          { claimedWithNoWitness, witnessedWithNoClaim },
          `The \`[Unreleased]\` block may name a direction only when some input took it, ` +
            `and must name every direction that moved. Over ${redactionCorpus().length} ` +
            `urls spanning every shape the block discusses, ${removesMore.length} records ` +
            `removed MORE than the rebuilt 2.0.1 tree did and ${keepsMore.length} kept ` +
            `more. RELEASING.md step 1 copies this block verbatim into the published ` +
            `section, so a direction with no witness outlives the round that wrote it`,
        ).toEqual({ claimedWithNoWitness: [], witnessedWithNoClaim: [] });
      } finally {
        cleanup();
      }
    }, 60_000);
  },
);

// ═══════════════════════════════════════════════════════════════════════════
// 2. THE CI JOB ROSTER A CONTRIBUTOR IS GIVEN.
//
// R18-H4-01 found a roster no gate read, and it was the release procedure.
// There is a second roster of the same kind: the RUNTIME jobs. CI declares
// three of them, RELEASING.md names all three in its step-2 parity block, and
// CONTRIBUTING.md names two.
// ═══════════════════════════════════════════════════════════════════════════

/** The job names declared under `jobs:` of a workflow, in order. */
function jobNames(workflow: string): string[] {
  const start = workflow.indexOf("\njobs:\n");
  expect(start, "the workflow must declare a jobs block").not.toBe(-1);
  return [...workflow.slice(start).matchAll(/\n {2}([A-Za-z][\w-]*):\n/g)].map(
    (match) => match[1] ?? "",
  );
}

describe("the runtime-smoke roster, in the three documents that carry one", () => {
  const RUNTIME_JOBS = ["bun-smoke", "node-min-smoke", "deno-smoke"];

  test("EVIDENCE: CI declares three runtime jobs beside the toolchain jobs", () => {
    const names = jobNames(repoText(".github/workflows/ci.yml"));
    for (const job of RUNTIME_JOBS) expect(names).toContain(job);
  });

  test("EVIDENCE: RELEASING.md's parity block names all three", () => {
    const releasing = unwrapped(repoText("RELEASING.md"));
    expect(releasing).toContain("pnpm check-deno-consumer");
    expect(releasing).toContain("pnpm smoke:deno");
    expect(releasing).toContain("For parity with the `node-min-smoke` job");
    expect(releasing).toContain("Bun, Deno, and Node-floor (20.13.0) jobs");
  });

  test("CONTRIBUTING names every runtime CI additionally exercises", () => {
    // R19-H4-02.
    //
    // CONTRIBUTING.md's gate block is followed by one sentence about what CI
    // adds: "CI additionally runs Bun and Deno runtime smokes." It runs three.
    // The one missing is `node-min-smoke`, which executes the shipped artifact
    // on a real Node 20.13.0 — the `engines.node` floor, and the gate the
    // ledger calls the largest assumed item this audit closed. A contributor
    // who runs everything CONTRIBUTING lists still cannot run the floor, and
    // the document never tells them it exists, while RELEASING.md warns a
    // maintainer that running it on any other Node "proves nothing about the
    // `engines` floor". Same class as R18-H4-01: a roster read by no gate,
    // already a job short.
    const contributing = unwrapped(repoText("CONTRIBUTING.md"));
    const missing = RUNTIME_JOBS.filter((job) => {
      const runtime = { "bun-smoke": "Bun", "node-min-smoke": "node-min", "deno-smoke": "Deno" }[
        job
      ] as string;
      return !contributing.includes(runtime);
    });

    expect(
      missing,
      "CONTRIBUTING.md tells a contributor that `CI additionally runs Bun and Deno runtime " +
        "smokes`, and .github/workflows/ci.yml declares a third — node-min-smoke, which runs " +
        "the shipped artifact on the exact engines.node floor. RELEASING.md carries all three; " +
        "CONTRIBUTING.md never mentions the floor smoke, and no gate reads either roster",
    ).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. THE THREE SENTENCES `.audit-state.json` STILL LISTS AS OWED.
//
// Each is measured against `dist`, not read from a document. Two of the three
// answer TRUE, and one of those was written a round ago and the ledger did not
// notice.
// ═══════════════════════════════════════════════════════════════════════════

describe("docSentencesNeeded, measured", () => {
  test("EVIDENCE: the ADR 0003 release sentence is already written, word for word", () => {
    // `.audit-state.json` still lists it as OWED to F4. It landed with round
    // 16's document commit, and the claim is unchanged since.
    const adr = unwrapped(repoText("docs/adr/0003-the-untrusted-fetch-conformance-boundary.md"));
    expect(adr).toContain(
      "Phase 3's release cancels the body of a `Response` an earlier call already handed to a caller, on BOTH arms.",
    );
    expect(adr).toContain("The success arm ends the caller's stream.");
    expect(adr).toContain(
      "The HTTP-error arm makes `error.text()` reject with `Body is unusable`, while `error.cancel()` still settles.",
    );
    expect(adr).toContain(
      "The release stays unconditional, because a skipped release strands a stream.",
    );
  });

  test("EVIDENCE: the transport re-entry sentence holds in every configuration it quantifies over", async () => {
    const bag = (await import(/* @vite-ignore */ builtEntryUrl("dist/index.mjs").href)) as {
      typedFetch: (input: string, options?: unknown) => Promise<unknown>;
    };

    type Reads = {
      ownDescriptor: "absent" | "present";
      ownKeyList: boolean;
      objectKeys: boolean;
      spreadCopy: boolean;
      propertyGet: "undefined" | "the caller's value" | "some other value";
      inCheck: boolean;
    };

    let seen: Reads | null = null;
    let callersValue: unknown = null;
    const read = (init: RequestInit): Reads => {
      const got = (init as { readonly fetch?: unknown }).fetch;
      return {
        ownDescriptor:
          Object.getOwnPropertyDescriptor(init, "fetch") === undefined ? "absent" : "present",
        ownKeyList: Reflect.ownKeys(init).includes("fetch"),
        objectKeys: Object.keys(init).includes("fetch"),
        spreadCopy: Object.hasOwn({ ...init }, "fetch"),
        propertyGet:
          got === undefined
            ? "undefined"
            : got === callersValue
              ? "the caller's value"
              : "some other value",
        inCheck: "fetch" in init,
      };
    };
    const transport = async (_input: unknown, init: RequestInit): Promise<Response> => {
      seen = read(init);
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    };

    /** Run one configuration and answer what the transport read. */
    async function measure(
      build: (probe: typeof transport) => { options?: unknown; polluteWith?: unknown },
    ): Promise<Reads> {
      seen = null;
      callersValue = null;
      const plan = build(transport);
      const nativeFetch = globalThis.fetch;
      const polluted = plan.polluteWith !== undefined;
      if (polluted) {
        callersValue = plan.polluteWith;
        Object.defineProperty(Object.prototype, "fetch", {
          configurable: true,
          value: plan.polluteWith,
          writable: true,
        });
        globalThis.fetch = transport as unknown as typeof fetch;
      }
      try {
        await bag.typedFetch("https://api.test/x", plan.options);
      } finally {
        if (polluted) {
          globalThis.fetch = nativeFetch;
          Reflect.deleteProperty(Object.prototype, "fetch");
        }
      }
      expect(seen, "the transport must have run").not.toBeNull();
      return seen as unknown as Reads;
    }

    const OWN_SHAPE_CARRIES_NOTHING = {
      ownDescriptor: "absent",
      ownKeyList: false,
      objectKeys: false,
      spreadCopy: false,
    } as const;

    // (a) an OWN `fetch` — the branch the caller's own transport selects.
    const own = await measure((probe) => {
      callersValue = probe;
      return { options: { fetch: probe } };
    });
    expect(own).toMatchObject({
      ...OWN_SHAPE_CARRIES_NOTHING,
      propertyGet: "undefined",
      inCheck: false,
    });

    // (b) an own `fetch` beside an own `signal`, which takes the same branch
    //     with one more descriptor rewritten.
    const ownWithSignal = await measure((probe) => {
      callersValue = probe;
      return { options: { fetch: probe, signal: new AbortController().signal } };
    });
    expect(ownWithSignal).toMatchObject({
      ...OWN_SHAPE_CARRIES_NOTHING,
      propertyGet: "undefined",
      inCheck: false,
    });

    // (c) an own `fetch` on a FROZEN options object. Every descriptor the
    //     sanitized target copies is then non-configurable and non-writable,
    //     which is the shape a proxy invariant can refuse. It does not.
    const frozen = await measure((probe) => {
      callersValue = probe;
      return { options: Object.freeze({ fetch: probe, method: "GET" }) };
    });
    expect(frozen).toMatchObject({
      ...OWN_SHAPE_CARRIES_NOTHING,
      propertyGet: "undefined",
      inCheck: false,
    });

    // (d) an own `fetch` with an INHERITED one still on the chain — the
    //     configuration R18-H4-05 added to the sentence.
    const ownOverInherited = await measure((probe) => {
      callersValue = probe;
      const inherited = async (): Promise<Response> => new Response("{}");
      return { options: Object.create({ fetch: inherited }, { fetch: { value: probe } }) };
    });
    expect(ownOverInherited).toMatchObject({
      ...OWN_SHAPE_CARRIES_NOTHING,
      propertyGet: "undefined",
      inCheck: false,
    });

    // (e) an INHERITED `fetch` and no own one, with no options object at all.
    //     The three own-shape reads still answer absent; the two chain reads
    //     answer the caller's value, which is what the sentence now says.
    const inheritedOnly = await measure((probe) => ({ polluteWith: probe }));
    expect(inheritedOnly).toMatchObject({
      ...OWN_SHAPE_CARRIES_NOTHING,
      propertyGet: "the caller's value",
      inCheck: true,
    });
  });

  test("EVIDENCE: the runtime-smoke sentence is TRUE on this Node, so it is a doc row", async () => {
    // The third owed sentence, and the only one that names a runtime this suite
    // cannot host. Measured here on Node against `dist`; the Bun and Deno
    // measurements run below when the binary is installed.
    expect(await abortInPrologue(process.execPath, [])).toEqual({
      isNetworkError: true,
      isAbortError: false,
    });
  }, 30_000);

  const RUNTIMES: ReadonlyArray<readonly [string, readonly string[]]> = [
    ["bun", ["run"]],
    ["deno", ["run", "--allow-net", "--allow-read"]],
  ];
  for (const [binary, argv] of RUNTIMES) {
    const available = spawnSync(binary, ["--version"], { encoding: "utf8" }).status === 0;
    test.runIf(available)(
      `EVIDENCE: the same sentence holds on ${binary}`,
      async () => {
        expect(await abortInPrologue(binary, argv)).toEqual({
          isNetworkError: true,
          isAbortError: false,
        });
      },
      60_000,
    );
  }
});

/**
 * The owed runtime-smoke assertion, run under one runtime against the BUILT
 * package: an init whose `method` getter aborts the caller's controller and
 * then throws must answer `isNetworkError` and never `isAbortError`.
 */
async function abortInPrologue(
  binary: string,
  argv: readonly string[],
): Promise<{ isNetworkError: boolean; isAbortError: boolean }> {
  const root = mkdtempSync(join(tmpdir(), "tf-round19-h4-smoke-"));
  try {
    const probe = join(root, "probe.mjs");
    writeFileSync(
      probe,
      [
        'import { createServer } from "node:http";',
        `const bag = await import(${JSON.stringify(builtEntryUrl("dist/index.mjs").href)});`,
        "const server = createServer((_request, response) => {",
        '  response.writeHead(200, { "content-type": "application/json" });',
        '  response.end("{}");',
        "});",
        'await new Promise((done) => server.listen(0, "127.0.0.1", done));',
        'const url = "http://127.0.0.1:" + server.address().port + "/x";',
        "const controller = new AbortController();",
        "const { error } = await bag.typedFetch(url, {",
        "  signal: controller.signal,",
        "  get method() {",
        "    controller.abort();",
        '    throw new Error("x");',
        "  },",
        "});",
        "console.log(",
        "  JSON.stringify({",
        "    isNetworkError: bag.isNetworkError(error),",
        "    isAbortError: bag.isAbortError(error),",
        "  }),",
        ");",
        "server.close();",
        "",
      ].join("\n"),
    );
    const child = spawnSync(binary, [...argv, probe], { encoding: "utf8" });
    expect(child.status, `${binary} failed to run the probe:\n${child.stderr}`).toBe(0);
    const line = child.stdout.trim().split("\n").at(-1) ?? "";
    return JSON.parse(line) as { isNetworkError: boolean; isAbortError: boolean };
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}
