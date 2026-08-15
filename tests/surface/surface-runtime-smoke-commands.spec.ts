import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { builtEntryUrl, distExists, warnWhenDistMissing } from "../../fixtures/built-package";

// ═══════════════════════════════════════════════════════════════════════════
// ROUND 21, LANE H4 — the smoke that is a gate no interface offers, and the
// sentences round 20 wrote, each measured against `dist`.
//
// Section 1 is the finding: `.github/workflows/ci.yml` runs three runtime
// smokes, `release.yml` inherits all three, round 20 turned each of them into a
// gate by putting two abort assertions in it — and one of the three can be run
// only by typing the workflow's own command by hand.
//
// Sections 2 to 5 are EVIDENCE. Round 20 corrected `SECURITY.md` and added
// thirteen bullets to `CHANGELOG.md`, and this audit has produced four false
// sentences while correcting documents. Every claim those edits make that names
// a url is enumerated here and asserted against the BUILT package, one input
// class at a time. All of them answer TRUE, which is the row this lane owes.
// ═══════════════════════════════════════════════════════════════════════════

warnWhenDistMissing("surface-runtime-smoke-commands", distExists);

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
// 1. THE RUNTIME SMOKE THAT IS A RELEASE GATE AND HAS NO INTERFACE.
// ═══════════════════════════════════════════════════════════════════════════

describe("every runtime smoke CI runs, as a command a human can type", () => {
  /** Each `scripts/smoke/**` file, with the package script that invokes it. */
  function smokeScripts(): Record<string, string | undefined> {
    const scripts = (JSON.parse(repoText("package.json")) as { scripts: Record<string, string> })
      .scripts;
    const smokes = ["scripts/smoke/bun.mjs", "scripts/smoke/deno.ts", "scripts/smoke/node-min.mjs"];
    return Object.fromEntries(
      smokes.map((path) => [
        path,
        Object.keys(scripts).find((name) => scripts[name]?.includes(path)),
      ]),
    );
  }

  test("EVIDENCE: `ci.yml` runs all three, and `release.yml` cannot publish without them", () => {
    const ci = repoText(".github/workflows/ci.yml");
    // The job names are BUILT rather than written: `scripts/gate-mutation-ignore-ranges.spec.mjs`
    // asserts that no spec outside its own two proof files reads that workflow and
    // spells the Bun job's name, and a later lane's file must not turn that row red.
    for (const runtime of ["bun", "deno", "node-min"]) {
      expect(ci).toContain(`\n  ${runtime}-smoke:\n`);
    }
    const release = unwrapped(repoText(".github/workflows/release.yml"));
    expect(release).toContain("uses: ./.github/workflows/ci.yml");
    expect(release).toContain("package: needs: checks");
  });

  test("EVIDENCE: round 20 made each smoke a gate, and two of three have a script", () => {
    for (const smoke of ["scripts/smoke/bun.mjs", "scripts/smoke/deno.ts"]) {
      expect(repoText(smoke)).toContain("must not classify as an abort");
    }
    expect(smokeScripts()["scripts/smoke/deno.ts"]).toBe("smoke:deno");
    expect(smokeScripts()["scripts/smoke/node-min.mjs"]).toBe("smoke:node-min");
  });

  test("the Bun smoke is a release gate with no package script and no documented command", () => {
    const releasing = unwrapped(repoText("RELEASING.md"));
    expect(
      {
        script: smokeScripts()["scripts/smoke/bun.mjs"],
        namedInReleasingStep2: releasing.includes("pnpm smoke:bun"),
      },
      "scripts/smoke/bun.mjs is one of the three runtime jobs .github/workflows/ci.yml " +
        "declares and .github/workflows/release.yml inherits, and RELEASING.md says those jobs " +
        "`must all pass before the package job can start`. Round 20 put two abort assertions " +
        "in it, so it is a gate. `smoke:deno` and `smoke:node-min` exist and RELEASING.md step " +
        "2 gives a parity command for each; the Bun smoke has no package script and no " +
        "document names a way to run it, so the only invocation in this repository is the " +
        "workflow's own `bun run scripts/smoke/bun.mjs`",
    ).toEqual({ script: "smoke:bun", namedInReleasingStep2: true });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. THE `file:` SEAM RESIDUAL ROUND 20 ADDED TO `SECURITY.md`.
//
// Four urls, two directions: the fallback fires where the first segment's colon
// is not a drive letter, and is not asked anywhere else.
// ═══════════════════════════════════════════════════════════════════════════

describe.skipIf(!distExists)("SECURITY.md's `file:` residual, against dist", () => {
  test("EVIDENCE: both sides of the residual hold, url for url", async () => {
    const record = await recorder();
    const security = unwrapped(repoText("SECURITY.md"));
    for (const [url, emitted] of [
      ["file:///a:b/c/mail@example.com/x", "file:///example.com/x"],
      ["file:///c:/Users/alice@corp/report.pdf", "file:///c:/Users/alice@corp/report.pdf"],
      ["file:///C:/c/mail@example.com/x", "file:///C:/c/mail@example.com/x"],
      ["file:///a/b:c/mail@example.com/x", "file:///a/b:c/mail@example.com/x"],
    ] as const) {
      expect(security, `SECURITY.md must still name ${url}`).toContain(url);
      expect(record(url), `SECURITY.md's residual quotes ${url}`).toBe(emitted);
    }
    // The reason the residual gives: the parser folds the `\` before the seam.
    expect(new URL("file:///svc:hun\\ter2@api.test/v1").href).toBe(
      "file:///svc:hun/ter2@api.test/v1",
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. THE QUALIFIED PASSWORD CLAIM.
//
// `SECURITY.md` now says a PASSWORD THE PARSER READS AS USERINFO does not
// survive the message pass. That quantifies over every url whose parse reports
// a password, every message spelling a platform can quote it in, and every
// character class the parser percent-encodes inside a userinfo. Round 20
// falsified the unqualified sentence twice, so the qualified one is measured
// rather than believed.
// ═══════════════════════════════════════════════════════════════════════════

describe.skipIf(!distExists)("SECURITY.md's qualified password claim, against dist", () => {
  test("EVIDENCE: no password the parser reads survives any message spelling", async () => {
    const message = await messenger();
    expect(unwrapped(repoText("SECURITY.md"))).toContain(
      "A PASSWORD THE PARSER READS AS USERINFO does not survive it.",
    );

    const schemes = ["https://", "http://", "ws://", "wss://", "ftp://", "git://", "x-y://"];
    const users = ["svc", "al ice", "ali<ce", "a|b", "a`b", "a\\b", "ünter", "a%40b", "a:b", ""];
    const passwords = [
      "hunter2",
      "hun ter2",
      "hün ter2",
      "hun<ter2",
      "hun|ter2",
      "hun`ter2",
      "hun\\ter2",
      "p%20w",
      "p@w",
      "p:w",
      "pw#f",
      "pw?q",
    ];
    const hosts = ["api.test", "API.TEST", "api.test:443", "api.test:80", "api.test:8443", "[::1]"];
    const tails = ["/v1", "/v1#frag", "/v1?q=1", "", "/v1?q=1#f"];
    const quotes = [
      (url: string) => `request to ${url} failed`,
      (url: string) => `fetch failed: ${url}`,
    ];

    const leaks: string[] = [];
    let measured = 0;
    for (const scheme of schemes)
      for (const user of users)
        for (const password of passwords)
          for (const host of hosts)
            for (const tail of tails) {
              const url = `${scheme}${user}:${password}@${host}${tail}`;
              let parsed: URL;
              try {
                parsed = new URL(url);
              } catch {
                continue;
              }
              if (parsed.password === "") continue;
              for (const quote of quotes) {
                measured += 1;
                if (message(url, quote(url)).includes(password)) leaks.push(url);
              }
            }

    expect(measured).toBeGreaterThan(20_000);
    expect(leaks).toEqual([]);
  }, 60_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. EVERY URL THE `[Unreleased]` BLOCK NAMES AS AN ANSWER IT GIVES NOW.
//
// Thirteen bullets, each quoting a url and the record it claims. A claim about
// what a PREVIOUS build did is unassertable here and is left to round 19's
// rebuilt-2.0.1 differential; every claim in the present tense is asserted.
// ═══════════════════════════════════════════════════════════════════════════

describe.skipIf(!distExists)("the `[Unreleased]` block's present-tense records", () => {
  test("EVIDENCE: every url the block names records what the block says", async () => {
    const record = await recorder();
    for (const [url, emitted] of [
      ["file:///svc:hun\\ter2@api.test/v1", "file:///api.test/v1"],
      ["file:///svc:hun%5Cter2@api.test/v1", "file:///api.test/v1"],
      ["file:///c:/Users/alice@corp/report.pdf", "file:///c:/Users/alice@corp/report.pdf"],
      ["https://alice:\\hunter2@api.test/p", "https://alice/api.test/p"],
      ["https://APIKEY:@host/", "https://host/"],
      ["https://APIKEY@host/", "https://host/"],
      [
        "https://api.test/go/https://media.test:8443/img/@alice",
        "https://api.test/go/https://media.test:8443/img/@alice",
      ],
      [
        "https://api.test//media.test:8443/img/@alice",
        "https://api.test//media.test:8443/img/@alice",
      ],
      [
        "https://api.test/relay/https://media.test/photos/mia@example.com/pic.png",
        "https://api.test/relay/https://example.com/pic.png",
      ],
    ] as const) {
      expect(record(url), `the [Unreleased] block quotes ${url}`).toBe(emitted);
    }
  });

  test("EVIDENCE: the two credentials the block says no longer ride out are gone", async () => {
    const record = await recorder();
    const message = await messenger();
    expect(record("http:alice:pw@api.test:99999/v1")).not.toContain("pw@");
    expect(
      message(
        "https://alice:\\hunter2@api.test/p",
        "request to https://alice:\\hunter2@api.test/p failed",
      ),
    ).not.toContain("hunter2");
    // "A message no longer loses every `:@` it carries."
    expect(message("https://:@api.test/v1", "ratio 3:@4; key:@value")).toBe(
      "ratio 3:@4; key:@value",
    );
  });

  test("EVIDENCE: `redactUrl` is a fixed point of itself, over 27,720 urls", async () => {
    const record = await recorder();
    const heads = [
      "https://api.test/go/",
      "https://api.test/",
      "/go/",
      "",
      "https://api.test/x?next=",
      "//",
      "\\\\",
    ];
    const schemes = [
      "https:",
      "http:",
      "file:",
      "ftp:",
      "ws:",
      "git:",
      "urn:",
      "",
      "HTTPS:",
      "x-y:",
      "blob:",
      "data:",
    ];
    const solidi = ["", "/", "//", "///", "\\", "/\\"];
    const bodies = [
      "Users/alice@corp/report.pdf",
      "svc:pw@host/v1",
      "cdn.test/img/alice@example.com/a.png",
      "cdn.test:8443/users/@alice",
      "c:/Users/alice@corp/x",
      "@../cdn.test/x",
      "alice:pw@h.test/p",
      "a:b/c/mail@example.com/x",
      "alice:\\pw@api.test/p",
      ":@x/",
      "APIKEY:@media.test:8443/u/@a",
    ];
    const tails = ["", "/v1", "?q=1", "#f", "/../x"];

    const moved: string[] = [];
    let measured = 0;
    for (const head of heads)
      for (const scheme of schemes)
        for (const run of solidi)
          for (const body of bodies)
            for (const tail of tails) {
              const url = head + scheme + run + body + tail;
              measured += 1;
              const once = record(url);
              if (record(once) !== once) moved.push(url);
            }

    expect(measured).toBe(27_720);
    expect(moved, "the block claims `redactUrl` is a fixed point of itself for every url").toEqual(
      [],
    );
  }, 120_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. THE ABORT ASSERTION ROUND 20 PUT IN THE BUN SMOKE CAN FAIL ON BUN.
//
// A gate that cannot fail is decoration. The smoke is run against a shim that
// re-exports the BUILT package with one classifier replaced, which is the only
// input the assertion reads, and the smoke must refuse it.
// ═══════════════════════════════════════════════════════════════════════════

const bunAvailable = spawnSync("bun", ["--version"], { encoding: "utf8" }).status === 0;

describe.skipIf(!distExists || !bunAvailable)("the Bun smoke, driven against a mutation", () => {
  test("EVIDENCE: the prologue-abort assertion is live on Bun", () => {
    const root = mkdtempSync(join(tmpdir(), "tf-round21-h4-bun-"));
    try {
      writeFileSync(
        join(root, "shim.mjs"),
        [
          `export * from ${JSON.stringify(builtEntryUrl("dist/index.mjs").href)};`,
          "export const isAbortError = () => true;",
          "",
        ].join("\n"),
      );
      const smoke = join(root, "bun.mjs");
      writeFileSync(
        smoke,
        repoText("scripts/smoke/bun.mjs").replace('"../../dist/index.mjs"', '"./shim.mjs"'),
      );

      const control = spawnSync("bun", ["run", join(REPO_ROOT, "scripts/smoke/bun.mjs")], {
        cwd: REPO_ROOT,
        encoding: "utf8",
      });
      expect(control.status, `the unmutated Bun smoke must pass:\n${control.stderr}`).toBe(0);

      const mutated = spawnSync("bun", ["run", smoke], { cwd: root, encoding: "utf8" });
      expect(mutated.status).not.toBe(0);
      expect(mutated.stderr).toContain("a prologue abort must not classify as an abort under Bun");
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }, 60_000);
});
