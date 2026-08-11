import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { builtEntryUrl, distExists, warnWhenDistMissing } from "../../fixtures/built-package";

// ═══════════════════════════════════════════════════════════════════════════
// ROUND 22, LANE H4 — the sentences round 21 wrote, each measured rather than
// believed, and the two `[Unreleased]` claims about the PUBLISHED tree that no
// round has asserted.
//
// Round 21 corrected three claims and added six sentences: two to SECURITY.md,
// three to CONTRIBUTING.md, one to RELEASING.md. Round 21's own lesson was that
// measuring first caught four false sentences before they were written, so
// every configuration those six quantify over is enumerated here and asserted
// against the BUILT package or against the repository's own files.
//
// Section 1 is the finding: one of the three sentences CONTRIBUTING.md gained
// is false, and the test that falsifies it landed in the same round.
//
// Sections 2 to 5 are EVIDENCE. All of them answer TRUE, which is the row this
// lane owes.
// ═══════════════════════════════════════════════════════════════════════════

warnWhenDistMissing("round22-h4-surface", distExists);

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const repoText = (path: string): string => readFileSync(join(REPO_ROOT, path), "utf8");
const unwrapped = (text: string): string => text.replaceAll(/\s+/g, " ");

interface ErrorBag {
  NetworkError: new (
    message?: string,
    options?: { url?: string },
  ) => Error & { toJSON(): { url: string } };
}

/** The REDACTED url the BUILT package records for `url`. */
async function recorder(): Promise<(url: string) => string> {
  const bag = (await import(
    /* @vite-ignore */ builtEntryUrl("dist/errors/index.mjs").href
  )) as ErrorBag;
  return (url) => new bag.NetworkError("x", { url }).toJSON().url;
}

/** The MESSAGE the BUILT package emits for `text` about `url`. */
async function messenger(): Promise<(url: string, text: string) => string> {
  const bag = (await import(
    /* @vite-ignore */ builtEntryUrl("dist/errors/index.mjs").href
  )) as ErrorBag;
  return (url, text) => new bag.NetworkError(text, { url }).message;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. THE SENTENCE THAT JUSTIFIES THE COVERAGE EXCLUSION IS FALSE.
//
// CONTRIBUTING.md, round 21: "the suite reads `scripts/smoke/bun.mjs` as text
// and never executes it, which is why `vitest.config.ts` drops that file from
// the coverage threshold." The sentence directly above it tells the reader to
// install Bun and run `pnpm smoke:bun`, and on any machine that followed it
// `tests/surface/round21-h4-surface.spec.ts` — written in the SAME round —
// runs `bun run scripts/smoke/bun.mjs` as the control for its mutation.
// ═══════════════════════════════════════════════════════════════════════════

/** Every spec file in the suite, by repository-relative path. */
function specFiles(rel: string, found: string[] = []): string[] {
  for (const name of readdirSync(join(REPO_ROOT, rel), { withFileTypes: true })) {
    const next = `${rel}/${name.name}`;
    if (name.isDirectory()) specFiles(next, found);
    else if (/\.spec\.[cm]?[jt]sx?$/.test(name.name)) found.push(next);
  }
  return found;
}

describe("CONTRIBUTING's reason for dropping the Bun smoke from the threshold", () => {
  // ORCHESTRATOR REPAIR, round 22. This block pinned the FALSE sentence
  // verbatim and asserted that no spec executes the smoke — the negation of
  // what its own sibling row proves — so correcting the document necessarily
  // reddened it and no lane could satisfy it. Sixth instrument this audit that
  // could not survive its own fix. It now states the invariant that must hold
  // AFTER the fix: the reason the document gives agrees with what the suite
  // does. The pre-fix sentence is kept here as history, in prose.
  //
  //   was: "the suite reads `scripts/smoke/bun.mjs` as text and never executes
  //         it, which is why `vitest.config.ts` drops that file from the
  //         coverage threshold"
  const SENTENCE =
    "`tests/surface/round21-h4-surface.spec.ts` runs that file under Bun wherever a Bun " +
    "binary and a built `dist/` both exist, and the v8 instrument measures no child " +
    "process, which is why `vitest.config.ts` drops it from the coverage threshold";

  test("EVIDENCE: the sentence is there, and the exclusion it explains is there too", () => {
    expect(unwrapped(repoText("CONTRIBUTING.md"))).toContain(SENTENCE);
    expect(repoText("vitest.config.ts")).toContain('exclude: ["scripts/smoke/bun.mjs"');
    // The sentence directly above it is what puts a Bun binary on the machine.
    expect(unwrapped(repoText("CONTRIBUTING.md"))).toContain(
      "Run `pnpm smoke:bun` locally when Bun is installed.",
    );
  });

  test("EVIDENCE: a spec that spawns the smoke is guarded only by whether Bun exists", () => {
    const round21 = repoText("tests/surface/round21-h4-surface.spec.ts");
    expect(round21).toContain('spawnSync("bun", ["--version"]');
    expect(round21).toContain('spawnSync("bun", ["run", join(REPO_ROOT, "scripts/smoke/bun.mjs")]');
    expect(round21).toContain("describe.skipIf(!distExists || !bunAvailable)");
  });

  test("the reason CONTRIBUTING gives agrees with what the suite does", () => {
    // This file is not in the scan: it names the path in prose and spawns Bun
    // only for `--version`, so a scan that read it would answer about itself.
    const self = "tests/surface/round22-h4-surface.spec.ts";
    const executors = [...specFiles("tests"), ...specFiles("scripts")].filter((file) => {
      if (file === self) return false;
      const source = repoText(file);
      return source.includes('spawnSync("bun"') && source.includes("scripts/smoke/bun.mjs");
    });
    const contributing = unwrapped(repoText("CONTRIBUTING.md"));

    // The document may not claim the suite never runs it while a spec does,
    // and where a spec DOES run it the document must name that spec.
    expect(
      {
        claimsItNeverRuns: contributing.includes("never executes it"),
        namesEveryExecutor: executors.every((file) => contributing.includes(file)),
      },
      "CONTRIBUTING.md gives a REASON for dropping `scripts/smoke/bun.mjs` from the " +
        "coverage threshold, and a reason a reader can check against the suite is the " +
        "whole point of it. `tests/surface/round21-h4-surface.spec.ts` runs " +
        "`bun run scripts/smoke/bun.mjs` as the control for its own mutation, skipped " +
        "only where no Bun binary and no built `dist/` exist. The exclusion is right — a " +
        "Node worker cannot host the runtime and the v8 instrument sees no child process " +
        "— but a FALSE reason for a TRUE exclusion is what round 5 filed against a " +
        "`v8 ignore` justification",
    ).toEqual({ claimsItNeverRuns: false, namesEveryExecutor: true });

    // Non-vacuity: a spec really does execute it, so the row above is not
    // satisfied by an empty scan.
    expect(executors, "the scan must find the executor this reason is about").not.toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. SECURITY.md'S TWO NEW CLAUSES, AGAINST `dist`.
//
// Clause one: a needle derived from a scan span ends at the span's last `@`,
// never past it. Clause two: the `file:` shape reports no userinfo in ANY
// spelling, and an OPAQUE url yields neither a seam needle nor a head needle
// except where the caller spelled a colon.
// ═══════════════════════════════════════════════════════════════════════════

describe.skipIf(!distExists)("SECURITY.md's needle-at-the-last-`@` clause", () => {
  test("EVIDENCE: both quoted urls lose the credential from the message", async () => {
    const message = await messenger();
    const security = unwrapped(repoText("SECURITY.md"));
    for (const url of [
      "https://api.test/go/https://svc:hunter2@/cdn.test/v1",
      "https://api.test/go/https://svc:hunter2@/./cdn.test/v1",
    ]) {
      expect(security, `SECURITY.md must still name ${url}`).toContain(url);
      expect(message(url, `request to ${url} failed`)).not.toContain("hunter2");
    }
  });

  test("EVIDENCE: every filler the clause quantifies over answers the same way", async () => {
    const message = await messenger();
    const leaks: string[] = [];
    let measured = 0;
    for (const head of ["https://api.test/go/", "https://api.test/relay/", "/go/"])
      for (const scheme of ["https://", "http://", "ftp://", "ws://"])
        for (const filler of ["/", "/./", "/../", "//", "/.//", "\\", "/a/../"])
          for (const tail of ["cdn.test/v1", "cdn.test:8443/v1", "cdn.test/v1?q=1#f"]) {
            const url = `${head}${scheme}svc:hunter2@${filler}${tail}`;
            measured += 1;
            if (message(url, `request to ${url} failed`).includes("hunter2")) leaks.push(url);
          }
    expect(measured).toBe(252);
    expect(leaks).toEqual([]);
  }, 30_000);
});

describe.skipIf(!distExists)("SECURITY.md's `file:` and opaque clauses", () => {
  test("EVIDENCE: no spelling of a `file:` url reports a username or a password", () => {
    // "no spelling of one reports a username or a password, because the `///`
    // and the `\` spellings reach the file host state with an EMPTY host".
    const reported: string[] = [];
    let parsed = 0;
    for (const solidi of ["", "/", "//", "///", "////", "\\", "/\\", "\\/", "\\\\"])
      for (const user of ["svc", "", "a b", "ü", "a%40b", "a:b", "svc:pw"])
        for (const host of ["api.test", "", "localhost", "[::1]", "1.2.3.4"])
          for (const tail of ["/v1", "", "/a@b"]) {
            const url = `file:${solidi}${user === "" ? "" : `${user}@`}${host}${tail}`;
            let candidate: URL;
            try {
              candidate = new URL(url);
            } catch {
              continue;
            }
            parsed += 1;
            if (candidate.username !== "" || candidate.password !== "") reported.push(url);
          }
    expect(parsed).toBeGreaterThan(500);
    expect(reported).toEqual([]);
  });

  test("EVIDENCE: an opaque url yields no needle, and every one reduces to its scheme", async () => {
    const record = await recorder();
    const message = await messenger();
    const security = unwrapped(repoText("SECURITY.md"));
    expect(security).toContain("`mailto:alice@example.com`, and the same address under `sip:`");

    // "a message that names that address without quoting the url keeps every
    // byte of it".
    for (const scheme of ["mailto", "sip", "xmpp", "urn", "im"]) {
      const text = "could not deliver to alice@example.com now";
      expect(message(`${scheme}:alice@example.com`, text)).toBe(text);
    }
    // "An opaque path that spells a colon is a password the caller wrote".
    expect(
      message("git:svc:hunter2@api.test/v1", "request to git:svc:hunter2@api.test/v1 failed"),
    ).not.toContain("svc:hunter2@");
    // "`redactUrl` reduces every opaque url to its scheme".
    for (const url of [
      "mailto:alice@example.com",
      "data:text/plain,hi",
      "urn:isbn:123",
      "blob:https://x.test/abc",
      "javascript:alert(1)",
      "sip:a@b.test",
      "git:svc:pw@api.test/v1",
      "x-y:opaque/path",
    ]) {
      expect(record(url)).toBe(`${new URL(url).protocol}`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. CONTRIBUTING'S IGNORE-SPELLING SENTENCE, AGAINST THE MEASURED TREES.
// ═══════════════════════════════════════════════════════════════════════════

describe("CONTRIBUTING's `only the v8 ignore spelling is permitted here`", () => {
  test("EVIDENCE: the measured trees hold six ranges and no other spelling", () => {
    expect(unwrapped(repoText("CONTRIBUTING.md"))).toContain(
      "Only the `v8 ignore` spelling is permitted here",
    );
    const walk = (rel: string, found: string[] = []): string[] => {
      for (const entry of readdirSync(join(REPO_ROOT, rel), { withFileTypes: true })) {
        const next = `${rel}/${entry.name}`;
        if (entry.isDirectory()) walk(next, found);
        else if (/\.[cm]?[jt]sx?$/.test(entry.name) && !/\.spec\.[cm]?[jt]sx?$/.test(entry.name))
          found.push(next);
      }
      return found;
    };
    const hints: string[] = [];
    for (const file of ["src", "fixtures", "scripts"].flatMap((tree) => walk(tree)))
      for (const line of repoText(file).split("\n")) {
        const hint = /(?:istanbul|[cv]8|node:coverage)\s+ignore\s+([\w-]*)/.exec(line);
        if (hint !== null) hints.push(`${hint[0]}`);
      }
    expect(hints.filter((hint) => !hint.startsWith("v8 ignore"))).toEqual([]);
    expect(hints.filter((hint) => hint === "v8 ignore start")).toHaveLength(6);
    expect(hints.filter((hint) => hint === "v8 ignore stop")).toHaveLength(6);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. THE TWO `[Unreleased]` CLAIMS ABOUT THE PUBLISHED TREE.
//
// Round 21 asserted every present-tense record the block names and said in its
// own header that "a claim about what a PREVIOUS build did is unassertable here
// and is left to round 19's rebuilt-2.0.1 differential". Round 19's
// differential reads directions and pins three `file:` urls. Two urls the block
// names are in neither list: the bullet round 20 added says of them that "the
// published `2.0.1` leaves both unchanged too, so an upgrade from it sees no
// move on this shape". That is a claim about the released package, and this is
// the round that asserts it.
// ═══════════════════════════════════════════════════════════════════════════

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

const ESBUILD = esbuildBinary();

/** `git`, run in this repository, answering stdout. */
function git(...argv: string[]): string {
  const result = spawnSync("git", argv, { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 1 << 28 });
  expect(result.status, `git ${argv[0]} failed: ${result.stderr}`).toBe(0);
  return result.stdout;
}

/** The OLDEST commit whose `package.json` reads `version`. */
function releaseCommitOf(version: string): string {
  const commits = git("log", "--format=%H", "--", "package.json").split("\n").filter(Boolean);
  for (const commit of commits.toReversed()) {
    const manifest = JSON.parse(git("show", `${commit}:package.json`)) as { version: string };
    if (manifest.version === version) return commit;
  }
  throw new Error(`no commit in this history publishes ${version}`);
}

/** The published 2.0.1 error cluster, rebuilt, and what its `toJSON()` wrote. */
async function publishedEmitter(): Promise<{
  emit: (url: string) => string;
  cleanup: () => void;
}> {
  const root = mkdtempSync(join(tmpdir(), "tf-round22-h4-201-"));
  const commit = releaseCommitOf("2.0.1");
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

describe.skipIf(!distExists || ESBUILD === null)("the block's claims about published 2.0.1", () => {
  test("EVIDENCE: the two urls the bare-`//` bullet names are unchanged in both trees", async () => {
    const record = await recorder();
    const { emit: published, cleanup } = await publishedEmitter();
    try {
      const block = unwrapped(repoText("CHANGELOG.md"));
      expect(block).toContain(
        "The published `2.0.1` leaves both unchanged too, so an upgrade from it sees no move on this shape",
      );
      for (const url of [
        "https://api.test/go/https://media.test:8443/img/@alice",
        "https://api.test//media.test:8443/img/@alice",
      ]) {
        expect(block, `the block must still name ${url}`).toContain(url);
        expect(published(url), `published 2.0.1 must leave ${url} unchanged`).toBe(url);
        expect(record(url), `this tree must leave ${url} unchanged`).toBe(url);
      }
    } finally {
      cleanup();
    }
  }, 120_000);

  test("EVIDENCE: this tree's record is never longer than the published one's", async () => {
    // The direction bullet's other claim about the released package: "over that
    // same population, the record this release emits is never longer than the
    // published 2.0.1's, on any row". Asserted over the corpus round 19's
    // differential draws, which is the population this repository can rebuild.
    const record = await recorder();
    const { emit: published, cleanup } = await publishedEmitter();
    try {
      const longer: string[] = [];
      let measured = 0;
      for (const head of ["https://api.test/go/", "https://api.test/", "/go/", ""])
        for (const scheme of ["https:", "http:", "file:", "ftp:", "ws:", "git:", "urn:", ""])
          for (const solidi of ["", "/", "//", "///"])
            for (const body of [
              "Users/alice@corp/report.pdf",
              "svc:pw@host/v1",
              "cdn.test/img/alice@example.com/a.png",
              "cdn.test:8443/users/@alice",
              "c:/Users/alice@corp/x",
              "@../cdn.test/x",
              "alice:pw@h.test/p",
            ])
              for (const tail of ["", "/v1", "?q=1", "#f"]) {
                const url = head + scheme + solidi + body + tail;
                measured += 1;
                if (record(url).length > published(url).length) longer.push(url);
              }
      expect(measured).toBe(3584);
      expect(longer).toEqual([]);
    } finally {
      cleanup();
    }
  }, 180_000);
});
