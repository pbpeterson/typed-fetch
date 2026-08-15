import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { builtEntryUrl, distExists, warnWhenDistMissing } from "../../fixtures/built-package";

// ═══════════════════════════════════════════════════════════════════════════
// ROUND 17, LANE H4 — everything round 16 changed, and the new surface it
// created.
//
// Round 16 rewrote five documents and added internal exports to seven scripts.
// Rounds 13 and 14 each produced a FALSE security sentence while correcting a
// document, so the sentences round 16 wrote are re-read here against `dist/`,
// one behavior at a time, never against another document.
//
// Three subjects, in this order:
//
//  1. Every sentence round 16 wrote, re-verified against the BUILT package.
//  2. The internal surface the coverage workstream created — seven scripts now
//     export `main`, `defaultIo`, their printers, and one `KNOWN_FAILING`. The
//     round assumed four consequences and pinned none of them.
//  3. The R16-ORCH-01 shape, swept for elsewhere: a gate whose assertion reads
//     a file the command ignores, and a threshold nothing executes.
//
// Every behavior claim is measured through `fixtures/built-package`, the one
// place in this repository that resolves a built path.
// ═══════════════════════════════════════════════════════════════════════════

warnWhenDistMissing("surface-gate-script-exports", distExists);

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** A JSON response, which is what a transport under test answers with. */
const jsonResponse = (): Response =>
  new Response("{}", { headers: { "content-type": "application/json" } });

/** A repository file, by its path from the root. */
const repoText = (path: string): string => readFileSync(join(REPO_ROOT, path), "utf8");

/** A document sentence with its line wrapping removed, so a quote can be found. */
const unwrapped = (text: string): string => text.replaceAll(/\s+/g, " ");

/**
 * The same, for a text whose lines may carry a JSDoc `*` gutter — so one quote
 * can be looked for in a Markdown file and in a source docblock alike.
 */
const flattened = (text: string): string => unwrapped(text.replaceAll(/^\s*\*[ \t]?/gm, ""));

// ── Reading the built package ────────────────────────────────────────────

type PreResponseError = Error & { url: string; toJSON(): { url: string } };
type RootBag = {
  NetworkError: new (message?: string, options?: { url?: string }) => PreResponseError;
  typedFetch: (input: string, options?: unknown) => Promise<unknown>;
};

const loadRoot = async (): Promise<RootBag> =>
  (await import(/* @vite-ignore */ builtEntryUrl("dist/index.mjs").href)) as RootBag;

/** The REDACTED url the BUILT package emits for `url` — the record's copy. */
async function emittedUrl(url: string): Promise<string> {
  const { NetworkError } = await loadRoot();
  return new NetworkError("Network error", { url }).toJSON().url;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. THE SENTENCES ROUND 16 WROTE, RE-READ AGAINST DIST.
// ═══════════════════════════════════════════════════════════════════════════

describe.skipIf(!distExists)("README — the rule round 16 wrote for an opaque url", () => {
  // "Every other scheme is opaque … For an opaque URL the record holds the
  // scheme and the colon, and nothing after them. The rule reads the scheme
  // rather than a list, so do not build a log allow-list from a set of example
  // schemes."
  //
  // R16-H4-05 replaced an ENUMERATION with a rule, because a reader had built
  // an allow-list of two from it. A rule is only worth the enumeration it
  // replaced if it holds for schemes nobody wrote down, so the set below is
  // deliberately outside every example either document names.
  test("the record holds the scheme and the colon, and nothing after them", async () => {
    expect({
      tel: await emittedUrl("tel:+15551234567"),
      news: await emittedUrl("news:comp.lang.javascript"),
      javascript: await emittedUrl("javascript:alert(1)"),
      myapp: await emittedUrl("myapp://svc:pw@host.test/x?tok=1"),
      data: await emittedUrl("data:text/plain;base64,SGVsbG8="),
      blob: await emittedUrl("blob:https://example.com/1-2-3"),
    }).toEqual({
      tel: "tel:",
      news: "news:",
      javascript: "javascript:",
      myapp: "myapp:",
      data: "data:",
      blob: "blob:",
    });
  });

  // The other half of the same sentence: "That holds for `http:`, `https:`,
  // `ws:`, `wss:`, `ftp:`, and `file:`." Six schemes, and the list is the one
  // `HIERARCHICAL_SCHEMES` holds — so the document is right or the module is.
  test("the path is kept, and only the value slots are dropped, for the six it names", async () => {
    expect({
      http: await emittedUrl("http://host.test/a/b?q=1#f"),
      https: await emittedUrl("https://host.test/a/b?q=1#f"),
      ws: await emittedUrl("ws://host.test/a/b?q=1#f"),
      wss: await emittedUrl("wss://host.test/a/b?q=1#f"),
      ftp: await emittedUrl("ftp://host.test/a/b?q=1#f"),
      file: await emittedUrl("file:///a/b/c.txt"),
    }).toEqual({
      http: "http://host.test/a/b",
      https: "https://host.test/a/b",
      ws: "ws://host.test/a/b",
      wss: "wss://host.test/a/b",
      ftp: "ftp://host.test/a/b",
      file: "file:///a/b/c.txt",
    });
  });

  test("the README states the rule it links, and no enumeration of two", () => {
    const readme = unwrapped(repoText("README.md"));

    expect({
      statesTheRule: readme.includes(
        "For an opaque URL the record holds the scheme and the colon, and nothing after them.",
      ),
      keepsTheOldEnumeration: readme.includes(
        "The redactor therefore keeps only `data:` or `blob:`",
      ),
      linksTheResidualList: readme.includes("SECURITY.md#known-residuals"),
    }).toEqual({
      statesTheRule: true,
      keepsTheOldEnumeration: false,
      linksTheResidualList: true,
    });
  });
});

describe.skipIf(!distExists)("README — the CAUTION round 16 wrote, and its one url", () => {
  // R16-H4-04 deleted the README's second copy of the redaction rule and left
  // ONE concrete consequence behind: a url, and the record dist emits for it.
  // A quoted output is the shape that rots silently, so it is read from dist.
  test("the quoted record is the record dist emits", async () => {
    const serialize = unwrapped(repoText("README.md"));

    expect(serialize).toContain("https://api.test/go/https://svc:hunter2@i.test/v1");
    expect(await emittedUrl("https://api.test/go/https://svc:hunter2@i.test/v1")).toBe(
      "https://api.test/go/https://i.test/v1",
    );
    expect(serialize).toContain("https://api.test/go/https://i.test/v1");
  });
});

describe.skipIf(!distExists)("SECURITY.md — the RES-6 entry round 16 wrote", () => {
  // Both urls the new bullet names, both answers it claims. The bullet is the
  // record of a REFUSAL — F3 built the fix and it was rejected — so the two
  // urls together are the whole argument: they spell the same characters in
  // the same order and the suite requires opposite outcomes.
  test("both urls emit exactly what the entry says they emit", async () => {
    expect({
      losesTheAuthority: await emittedUrl(
        "https://api.test/proxy/https://cdn.test/img/alice@example.com/avatar.png",
      ),
      dropsTheBase64Credential: await emittedUrl(
        "https://api.test/go/https://YWxpY2U/cGFzc3dvcmQ@internal.test/v1",
      ),
    }).toEqual({
      // NAMES a host the request never contacted, and drops the one it did.
      losesTheAuthority: "https://api.test/proxy/https://example.com/avatar.png",
      // The twin the suite requires this library to redact.
      dropsTheBase64Credential: "https://api.test/go/https://internal.test/v1",
    });
  });

  test("the entry quotes both of them", () => {
    const residuals = unwrapped(repoText("SECURITY.md"));

    for (const quoted of [
      "https://api.test/proxy/https://cdn.test/img/alice@example.com/avatar.png",
      "https://api.test/proxy/https://example.com/avatar.png",
      "https://api.test/go/https://YWxpY2U/cGFzc3dvcmQ@internal.test/v1",
    ]) {
      expect(residuals, `SECURITY.md must still quote ${quoted}`).toContain(quoted);
    }
  });
});

describe.skipIf(!distExists)("SECURITY.md — the corrected region-end sentence, both ways", () => {
  // Round 16 replaced "A region ends where the parser ends an authority it can
  // read" — which was false — with three claims. Each one is a different
  // observable answer, so each gets its own input.
  test("all three directions of the rule hold in dist", async () => {
    expect({
      // "A region ends at the next `://` … where the parser reads a complete
      // authority at the region's START." `YWxpY2U` is a host the parser
      // accepts, so the `://` after it BOUNDS the region and the base64
      // credential in front of that `://` survives.
      boundedAtTheNextMark: await emittedUrl(
        "https://api.test/go/https://YWxpY2U/cGFzc3dvcmQ://x@host.test/v1",
      ),
      // "Where the parser cannot read an authority at the start, no `://` ends
      // the region." `alice:s3cret` is not an authority — `s3cret` is not a
      // port — so the `://` inside the password does not end anything and the
      // whole credential goes.
      unboundedWhenTheStartIsNotAnAuthority: await emittedUrl(
        "https://api.test/go/https://alice:s3cret://x@internal.test/v1",
      ),
      // "A region with no `://` after it ends at the end of the text", which
      // is the mechanism RES-6 records: the region runs PAST the embedded host.
      runsToTheEndWithNoMarkAfterIt: await emittedUrl(
        "https://api.test/proxy/https://cdn.test/img/alice@example.com/avatar.png",
      ),
    }).toEqual({
      boundedAtTheNextMark: "https://api.test/go/https://YWxpY2U/cGFzc3dvcmQ://host.test/v1",
      unboundedWhenTheStartIsNotAnAuthority: "https://api.test/go/https://internal.test/v1",
      runsToTheEndWithNoMarkAfterIt: "https://api.test/proxy/https://example.com/avatar.png",
    });
  });
});

describe.skipIf(!distExists)("RELEASING.md — semver rule 8, against the built surface", () => {
  // Rule 8 is the rule round 16 added, and it rests on one factual claim about
  // the package: "`redactUrl` is not exported, so no consumer can call it."
  // That is what makes the rule bind the OUTPUT rather than the function, and
  // it is the half a refactor can quietly break.
  test("`redactUrl` is reachable through neither entry, in neither format", async () => {
    const require = createRequire(import.meta.url);
    const surfaces = {
      rootEsm: Object.keys(await import(/* @vite-ignore */ builtEntryUrl("dist/index.mjs").href)),
      errorsEsm: Object.keys(
        await import(/* @vite-ignore */ builtEntryUrl("dist/errors/index.mjs").href),
      ),
      rootCjs: Object.keys(require(fileURLToPath(builtEntryUrl("dist/index.js"))) as object),
      errorsCjs: Object.keys(
        require(fileURLToPath(builtEntryUrl("dist/errors/index.js"))) as object,
      ),
    };

    const reachable = Object.entries(surfaces)
      .filter(([, names]) => names.includes("redactUrl") || names.includes("redactUrlInMessage"))
      .map(([surface]) => surface);

    expect(reachable).toEqual([]);
  });

  test("the policy carries the rule that binds the redacted field", () => {
    const policy = unwrapped(repoText("RELEASING.md"));

    expect(policy).toContain("A change in what `toJSON().url` emits is a `minor` at least.");
    expect(policy).toContain("`redactUrl` is not exported, so no consumer can call it.");
  });

  test("the release checklist publishes the advisory after the step that confirms the publish", () => {
    const checklist = unwrapped(repoText("RELEASING.md"));

    // R16-H4-02's step. Its own sentence orders it after step 8, and step 8 is
    // the one that verifies the version is live on npm — so the two have to
    // stay in that order and step 8 has to stay the npm check.
    expect(checklist).toContain("**Publish the security advisory.**");
    expect(checklist).toContain(
      "Publish the draft after step 8 confirms the version is live on npm.",
    );
    expect(checklist).toMatch(/8\. \*\*Verify the publication:\*\*/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// R17-H4-01 — the init a transport receives CAN carry a `fetch` extension.
//
// Round 16 wrote the same sentence into two places, `CONTEXT.md`'s new
// "Transport re-entry" term and `src/request-plan.ts`'s module docblock:
//
//   "The init a transport receives carries no `fetch` extension under any of
//    the three reads: a property get answers `undefined`, an `in` check answers
//    `false`, and the own-key list omits the name."
//
// Two of the three are false. `snapshotRequestInit` installs the stripping
// proxy only when `Object.hasOwn(options, "fetch")` is true, and the SAME
// docblock says so twenty lines lower: "an inherited `fetch` is neither used
// NOR stripped: it stays on the object". So an options object that inherits
// `fetch` — from a caller's own base object, or from a polluted
// `Object.prototype` — reaches the transport with the extension readable.
//
// This is not the transport-selection claim, which holds: the inherited value
// never selects a transport, and `Object.hasOwn` on the init still answers
// `false`, so the re-entry consequence the sentence draws is intact. What is
// wrong is the invariant a transport is told it may rely on.
// ═══════════════════════════════════════════════════════════════════════════

describe.skipIf(!distExists)(
  "the init handed to a transport, against the sentence round 16 wrote",
  () => {
    test("both documents state the three reads", () => {
      for (const path of ["CONTEXT.md", "src/request-plan.ts"]) {
        expect(
          flattened(repoText(path)),
          `${path} must still carry the claim under test`,
        ).toContain(
          "The init a transport receives carries no `fetch` extension under any of the three reads",
        );
      }
    });

    test("a transport reads no `fetch` extension off the init it is handed", async () => {
      const { typedFetch } = await loadRoot();

      // An INHERITED `fetch`. The ordinary way to write one is a caller's own
      // base object of shared defaults; `Object.prototype.fetch = …` is the
      // hostile way, and the docblock names it. Neither is an own key, so
      // neither selects a transport — which is the guarantee that HOLDS.
      const options = Object.create({ fetch: async () => jsonResponse() }) as Record<
        string,
        unknown
      >;
      options.method = "GET";

      let reads: Record<string, unknown> | null = null;
      const ambient = globalThis.fetch;
      globalThis.fetch = ((_input: unknown, init: Record<string, unknown>) => {
        reads = {
          propertyGet: typeof init.fetch,
          inCheck: "fetch" in init,
          ownKeys: Reflect.ownKeys(init).filter((key) => key === "fetch"),
        };
        return Promise.resolve(jsonResponse());
      }) as unknown as typeof fetch;
      try {
        await typedFetch("https://api.test/x", options);
      } finally {
        globalThis.fetch = ambient;
      }

      // ADJUDICATED IN ROUND 17, together with its twin in
      // tests/request/request-built-package-differential.spec.ts, which two lanes wrote
      // independently against the same sentence. The finding was real and the
      // remedy was the SENTENCE: `tests/request/request-plan.spec.ts:96` pins
      // that an inherited `fetch` is neither used nor stripped, so demanding
      // absence here would demand a runtime change the audit decided against.
      //
      // The corrected sentence separates the reads that inspect the init's own
      // shape from the two that walk the prototype chain. This pins the split.
      expect(
        reads,
        "the corrected sentence: the own-key list omits the name, and a plain property get " +
          "and an `in` check read the prototype chain, so an inherited `fetch` answers both",
      ).toEqual({ propertyGet: "function", inCheck: true, ownKeys: [] });
    });
  },
);

// ═══════════════════════════════════════════════════════════════════════════
// 2. THE NEW INTERNAL SURFACE.
//
// Six gate scripts and their lib now export `main`, `defaultIo`, their
// printers, and one `KNOWN_FAILING`, each marked `@internal`. The commit
// message states four consequences — "The scripts are not in the published
// tarball, so the public surface does not move" — and pins none of them. An
// `@internal` tag is a comment; the tarball and the entry points are the
// enforcement, and neither had a test.
// ═══════════════════════════════════════════════════════════════════════════

describe.skipIf(!distExists)("the internal script surface reaches no consumer", () => {
  /** Every non-spec module under `scripts/`, by path from the root. */
  function gateModules(): string[] {
    const modules: string[] = [];
    for (const dir of ["scripts", "scripts/lib"]) {
      for (const entry of readdirSync(join(REPO_ROOT, dir))) {
        if (!entry.endsWith(".mjs") || entry.endsWith(".spec.mjs")) continue;
        modules.push(`${dir}/${entry}`);
      }
    }
    return modules.toSorted();
  }

  test("the manifest npm would publish holds no `scripts/` path at all", () => {
    // The gate's own question, asked of the real `npm pack`. `files` is the
    // mechanism, and reading `files` would be reading the intent instead of
    // the artifact — which is the distinction verify-pack.mjs's own header
    // draws about a denylist.
    const raw = execFileSync("npm", ["pack", "--dry-run", "--json"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const packed: string[] = (JSON.parse(raw) as { files: { path: string }[] }[])[0]!.files.map(
      (file) => file.path,
    );

    expect(packed.filter((path) => path.startsWith("scripts/"))).toEqual([]);
    expect(packed.filter((path) => /\.spec\.[cm]?[jt]s$/.test(path))).toEqual([]);
  });

  test("`pnpm verify-pack` refuses a manifest that carries one of the new spec files", async () => {
    // Section 8.7's own example, run against the gate rather than described:
    // "A verify-pack test builds a manifest with a stray root spec file and
    // asserts the gate reports it." The stray file is one round 16 created.
    const gate = (await import(
      /* @vite-ignore */ new URL("../../scripts/verify-pack.mjs", import.meta.url).href
    )) as { verifyPackManifest: (files: string[], count?: number) => unknown };

    const shipped = [
      "package.json",
      "LICENSE",
      "README.md",
      "dist/index.js",
      "dist/index.mjs",
      "dist/index.d.ts",
      "dist/index.d.mts",
      "dist/errors/index.js",
      "dist/errors/index.mjs",
      "dist/errors/index.d.ts",
      "dist/errors/index.d.mts",
      "dist/chunk-AAAA1111.mjs",
      "dist/chunk-BBBB2222.js",
      "errors/package.json",
    ];

    expect(() =>
      gate.verifyPackManifest([...shipped, "scripts/check-docs-entry.spec.mjs"], 15),
    ).toThrow(/scripts\/check-docs-entry\.spec\.mjs {2}\(test file\)/);
  });

  test("no name a gate script exports is reachable through either entry point", async () => {
    const require = createRequire(import.meta.url);
    const internal = new Set<string>();
    for (const path of gateModules()) {
      const module = (await import(
        /* @vite-ignore */ new URL(`../../${path}`, import.meta.url).href
      )) as Record<string, unknown>;
      for (const name of Object.keys(module)) internal.add(name);
    }
    // The round created these; if the glob ever stops seeing the scripts, the
    // test would pass by finding nothing.
    expect([...internal]).toEqual(expect.arrayContaining(["main", "defaultIo", "KNOWN_FAILING"]));

    const published = new Set<string>([
      ...Object.keys(await import(/* @vite-ignore */ builtEntryUrl("dist/index.mjs").href)),
      ...Object.keys(await import(/* @vite-ignore */ builtEntryUrl("dist/errors/index.mjs").href)),
      ...Object.keys(require(fileURLToPath(builtEntryUrl("dist/index.js"))) as object),
      ...Object.keys(require(fileURLToPath(builtEntryUrl("dist/errors/index.js"))) as object),
    ]);

    expect([...internal].filter((name) => published.has(name))).toEqual([]);
  });

  test("the frozen public surface did not move under the round", async () => {
    // Read from the COMMITTED snapshot rather than from a list written here, so
    // this asserts "unchanged" rather than "equal to whatever I typed today".
    const snapshot = repoText("tests/surface/__snapshots__/public-surface.spec.ts.snap");
    const namesUnder = (key: string): string[] => {
      const block = snapshot.split(`exports[\`${key}\`] = \``)[1];
      if (block === undefined) throw new Error(`no snapshot named ${key}`);
      return [...block.split("\n`;")[0]!.matchAll(/"([^"]+)"/g)].map((match) => match[1]!);
    };

    expect({
      root: Object.keys(
        await import(/* @vite-ignore */ builtEntryUrl("dist/index.mjs").href),
      ).toSorted(),
      errors: Object.keys(
        await import(/* @vite-ignore */ builtEntryUrl("dist/errors/index.mjs").href),
      ).toSorted(),
    }).toEqual({
      root: namesUnder("public API surface is frozen > main entry named exports 1"),
      errors: namesUnder("public API surface is frozen > ./errors subpath named exports 1"),
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. THE R16-ORCH-01 SHAPE, SWEPT FOR ELSEWHERE.
//
// R16-ORCH-01: the coverage gate carried a command-line include that beat the
// config file, so the gate measured `src/` alone while two pin tests read the
// config file and stayed green. The exit code said PASS.
//
// The two findings below are the same shape one step over. The first is the
// surviving half of R16-ORCH-01 itself: the pin still reads the config's TEXT
// rather than the exclusion list, so it can only see an exclusion spelled the
// way the two it already knows are spelled. The second is the gate's reach: no
// workflow runs it at all.
// ═══════════════════════════════════════════════════════════════════════════

// ── R17-H4-02 ────────────────────────────────────────────────────────────
//
// `vitest.config.ts` states the guarantee in its own comment: "An exclusion
// list that can grow in silence turns a 100 percent threshold into decoration,
// so tests/surface/surface-coverage-config-pins.spec.ts pins this list to these two
// paths AND FAILS WHEN A THIRD ONE IS ADDED." Section 8.6 acceptance item 3 is
// the same sentence, and the round closed with it recorded as holding.
//
// The pin reads the file with `/"(scripts\/smoke\/[^"]+)"/g`. Every path it can
// see is a path under `scripts/smoke/`, so the sentence is true for a third
// smoke and false for every other file in the two trees the round just brought
// under measurement. The proof is differential and drives the REAL pin: the
// same repository, the same spec file, one line of `vitest.config.ts` changed.

describe("the coverage exclusion pin, driven against a grown exclusion list", () => {
  const PIN = "the exclusion list holds exactly the two cross-runtime smokes";
  const ANCHOR = 'exclude: ["scripts/smoke/bun.mjs", "scripts/smoke/deno.ts"],';

  /**
   * The round-16 pin, run over a repository whose `vitest.config.ts` excludes
   * `extra` beside the two smokes. Answers the pin's exit status.
   *
   * A COPY OF THE SPEC IN A ROOT OF SYMLINKS, because the pin resolves every
   * document it reads from its own `import.meta.url`. Copying the one file and
   * linking the rest is what lets the config under it be a different file
   * while everything else stays the repository's own.
   */
  function pinExitCode(extra: string): number {
    const root = mkdtempSync(join(tmpdir(), "tf-round17-h4-"));
    try {
      mkdirSync(join(root, "tests", "surface"), { recursive: true });
      copyFileSync(
        join(REPO_ROOT, "tests/surface/surface-coverage-config-pins.spec.ts"),
        join(root, "tests/surface/surface-coverage-config-pins.spec.ts"),
      );
      for (const entry of [
        "CHANGELOG.md",
        "README.md",
        "RELEASING.md",
        "SECURITY.md",
        "package.json",
        "dist",
        "fixtures",
        "node_modules",
        "src",
      ]) {
        // `dist` is the one entry a clean checkout can be missing, and the
        // pin under test does not read it — its dist-gated neighbours skip.
        if (existsSync(join(REPO_ROOT, entry)))
          symlinkSync(join(REPO_ROOT, entry), join(root, entry));
      }

      const config = repoText("vitest.config.ts");
      expect(config, "vitest.config.ts must still spell its exclusion list this way").toContain(
        ANCHOR,
      );
      writeFileSync(
        join(root, "vitest.config.ts"),
        config.replace(ANCHOR, ANCHOR.replace("],", `, ${JSON.stringify(extra)}],`)),
      );

      // A clean environment: this runs inside a vitest worker, and the child
      // must not inherit the parent run's pool bookkeeping. `NO_COLOR` too,
      // because the read below is a read of the child's summary line as TEXT:
      // vitest turns its colors off only where `std-env` reports an AI agent,
      // and leaves them on in a developer's terminal, where the escape codes
      // then sit between the words this regex spells.
      const env = {
        ...Object.fromEntries(
          Object.entries(process.env).filter(([key]) => !key.startsWith("VITEST")),
        ),
        NO_COLOR: "1",
      };
      const child = spawnSync(
        process.execPath,
        [
          join(REPO_ROOT, "node_modules/vitest/vitest.mjs"),
          "run",
          "--root",
          root,
          "-t",
          PIN,
          // ONE worker, no file parallelism. This runs inside a vitest worker
          // of the parent suite, and the parent holds cost tests with a five
          // second budget: a child that opens a pool per core takes the budget
          // away from them and turns a green suite red for no reason.
          "--pool=threads",
          "--maxWorkers=1",
          "--fileParallelism=false",
        ],
        { cwd: root, encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] },
      );
      expect(
        child.stdout,
        `the pin did not run in the copied root:\n${child.stdout}\n${child.stderr}`,
      ).toMatch(/Test Files {2}1 (?:passed|failed)/);
      return child.status ?? 1;
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }

  test("EVIDENCE: a third path under `scripts/smoke/` does fail it", () => {
    // The half that works, and the reason the sentence reads as true. Without
    // this the test below could be failing because the harness is broken.
    expect(pinExitCode("scripts/smoke/node-min.mjs")).not.toBe(0);
  });

  test("a third path anywhere else fails it too", () => {
    // `fixtures/http-server.ts` is a file the round 16 workstream brought under
    // measurement for the first time, and excluding it is exactly the edit the
    // config's comment says cannot pass unnoticed.
    expect(
      pinExitCode("fixtures/http-server.ts"),
      "vitest.config.ts states that the round-16 pin 'fails when a third one is added', and " +
        "section 8.6 acceptance item 3 requires it; the pin matches the config's TEXT with a " +
        "regular expression anchored on `scripts/smoke/`, so an exclusion naming any other " +
        "file leaves it green and the exclusion list grows in silence",
    ).not.toBe(0);
  });
});

// ── R17-H4-03 ────────────────────────────────────────────────────────────
//
// The other half of "the exit code said PASS": nothing reads this exit code.
// `pnpm coverage` carries the four thresholds round 16's largest workstream
// earned, and it appears in no workflow, in no job, and on no gate list. A
// commit that drops `scripts/**` back to 49 percent passes every check CI runs
// and every check the RELEASE workflow runs.

describe("the coverage gate's reach", () => {
  const RUNS_COVERAGE = /- run: pnpm (?:run )?coverage\b/;

  test("EVIDENCE: `coverage` is a real script, and its thresholds are the four at 100", () => {
    // R18-H4-04. This test's name promised the four at 100 and its whole
    // reading of them was `toContain("thresholds: {")`. The numbers behind that
    // brace were read by no test in the repository, so changing
    // `branches: 100` to `branches: 0` left this pin green, left
    // `pnpm coverage` green — a zero floor is met by any tree — and left both
    // workflow steps round 17 added green, while their own comments and
    // CONTRIBUTING's roster line promised the four at 100.
    //
    // That is R16-ORCH-01's shape for the third time: a check whose assertion
    // reads something other than what it guards. It appeared here in a pin
    // written by the round that found the first two, which is the reason the
    // ledger now says every gate this audit adds must be tested by BREAKING
    // what it guards.
    //
    // The values are read as VALUES now. All four, by name, each equal to 100.
    const manifest = JSON.parse(repoText("package.json")) as { scripts: Record<string, string> };

    expect(manifest.scripts.coverage).toMatch(/^vitest run /);

    const block = /thresholds:\s*\{([^}]*)\}/.exec(repoText("vitest.config.ts"));
    expect(block, "vitest.config.ts declares no thresholds block").not.toBeNull();

    const declared = Object.fromEntries(
      [...(block?.[1] ?? "").matchAll(/(\w+)\s*:\s*(\d+)/g)].map((match) => [
        match[1] ?? "",
        Number(match[2]),
      ]),
    );

    expect(declared).toEqual({ branches: 100, functions: 100, lines: 100, statements: 100 });
  });

  test("a workflow runs the coverage gate", () => {
    const workflows = {
      ci: RUNS_COVERAGE.test(repoText(".github/workflows/ci.yml")),
      release: RUNS_COVERAGE.test(repoText(".github/workflows/release.yml")),
    };

    expect(
      Object.values(workflows).some(Boolean),
      "neither .github/workflows/ci.yml nor release.yml runs `pnpm coverage`, and " +
        "CONTRIBUTING.md's gate roster — pinned to eleven entries by " +
        "scripts/gate-properties.spec.mjs — does not list it, so the 100 percent threshold on " +
        "src, scripts and fixtures is enforced by no automated check and a commit that lowers " +
        "it publishes",
    ).toBe(true);
  });

  test("PIN: the `coverage` script overrides no coverage key that could weaken the gate", () => {
    // R16-ORCH-01's own lesson, widened from the one flag it was found under.
    // `--coverage.include` is already forbidden; every flag below beats the
    // config file the same way and none of them is.
    const manifest = JSON.parse(repoText("package.json")) as { scripts: Record<string, string> };
    const script = manifest.scripts.coverage ?? "";

    const overrides = [
      "--coverage.include",
      "--coverage.exclude",
      "--coverage.thresholds",
      "--coverage.all",
      "--config",
    ].filter((flag) => script.includes(flag));

    expect(overrides).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. RELEASE READINESS — what the tree says about itself.
//
// A statement of fact rather than a defect: the release is still pending, and
// round 16's semver rule 8 decides what number it may carry.
// ═══════════════════════════════════════════════════════════════════════════

describe("the pending release", () => {
  test("the tree carries an uncut `[Unreleased]` block over the never-published 2.0.1", () => {
    const changelog = repoText("CHANGELOG.md");
    const unreleased = changelog.split("## [Unreleased]")[1]?.split("\n## [")[0] ?? "";

    expect({
      version: (JSON.parse(repoText("package.json")) as { version: string }).version,
      unreleasedHasSecurityFixes: unreleased.includes("### Security"),
      unreleasedHasChanged: unreleased.includes("### Changed"),
    }).toEqual({
      // Unmoved since the 2.0.1 cut — which itself never published, so the
      // consumer baseline is 2.0.0. No version has been cut for the block
      // below it, and rule 8 forbids a patch number for it.
      version: "2.0.1",
      unreleasedHasSecurityFixes: true,
      unreleasedHasChanged: true,
    });
  });
});
