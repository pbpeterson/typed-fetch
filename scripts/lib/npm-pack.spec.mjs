import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { installTarball, NPM_ENV, packTarball, stripNpmConfig } from "./npm-pack.mjs";

// Anything that shells out to npm gets a generous budget: a cold npm on a busy
// machine is slow, and a flaky release-gate spec is worse than a slow one.
const NPM_TIMEOUT = 120_000;

const owned = [];
function scratch(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  owned.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of owned.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// A tiny SCOPED package: the scope is the point. npm strips it when naming the
// file on disk, which is the exact discrepancy packTarball exists to absorb.
function makeFixturePackage(name = "@tf-spec/fixture", version = "1.2.3") {
  const dir = scratch("tf-spec-pkg-");
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name, version, private: false, files: ["marker.txt"] }, null, 2),
  );
  writeFileSync(join(dir, "marker.txt"), "packed\n");
  return dir;
}

function makeConsumer() {
  const dir = scratch("tf-spec-consumer-");
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "tf-spec-consumer", version: "0.0.0", private: true }, null, 2),
  );
  return dir;
}

// ---------------------------------------------------------------------------
// stripNpmConfig — pure, and the reason three gates carried the same four lines.
// ---------------------------------------------------------------------------

describe("stripNpmConfig", () => {
  test("removes pnpm's forwarded npm_config_* keys", () => {
    expect(stripNpmConfig({ npm_config_registry: "https://x", PATH: "/bin" })).toEqual({
      PATH: "/bin",
    });
  });

  test("matches the prefix case-insensitively", () => {
    // pnpm writes lowercase, npm on Windows upper-cases environment keys.
    const env = {
      npm_config_a: "1",
      NPM_CONFIG_B: "2",
      Npm_Config_C: "3",
      KEEP: "yes",
    };
    expect(stripNpmConfig(env)).toEqual({ KEEP: "yes" });
  });

  test("keeps npm_ variables that are not configuration", () => {
    // npm_lifecycle_event and npm_package_* tell a script how it was invoked;
    // stripping them would change behaviour, not just noise.
    const env = {
      npm_lifecycle_event: "test",
      npm_package_name: "@pbpeterson/typed-fetch",
      npm_execpath: "/x/pnpm",
      npm_config_registry: "https://x",
    };
    expect(stripNpmConfig(env)).toEqual({
      npm_lifecycle_event: "test",
      npm_package_name: "@pbpeterson/typed-fetch",
      npm_execpath: "/x/pnpm",
    });
  });

  test("leaves an environment with nothing to strip untouched", () => {
    const env = { PATH: "/bin", HOME: "/home/me" };
    expect(stripNpmConfig(env)).toEqual(env);
  });

  test("does not mutate the environment it was given", () => {
    const env = { npm_config_registry: "https://x", PATH: "/bin" };
    stripNpmConfig(env);
    expect(env).toEqual({ npm_config_registry: "https://x", PATH: "/bin" });
  });

  test("returns a copy, not the same object", () => {
    const env = { PATH: "/bin" };
    expect(stripNpmConfig(env)).not.toBe(env);
  });

  test("handles an empty environment", () => {
    expect(stripNpmConfig({})).toEqual({});
  });

  test("strips the bare `npm_config_` key too", () => {
    expect(stripNpmConfig({ npm_config_: "weird", PATH: "/bin" })).toEqual({ PATH: "/bin" });
  });
});

describe("NPM_ENV", () => {
  test("carries no npm_config_* key", () => {
    expect(Object.keys(NPM_ENV).filter((k) => k.toLowerCase().startsWith("npm_config_"))).toEqual(
      [],
    );
  });

  test("still carries the rest of the environment", () => {
    // Scrubbing must not amputate PATH — npm has to be findable.
    expect(NPM_ENV.PATH ?? NPM_ENV.Path).toBeTruthy();
  });

  test("is not process.env itself", () => {
    expect(NPM_ENV).not.toBe(process.env);
  });
});

// ---------------------------------------------------------------------------
// packTarball — shells out to npm.
// ---------------------------------------------------------------------------

describe("packTarball", () => {
  test(
    "returns a tarball path that EXISTS, whatever npm reports",
    () => {
      // The regression: npm 8 reported the scope-prefixed filename
      // (`@tf-spec/fixture-1.2.3.tgz`) while writing the scope-stripped one.
      // Trusting `reported` gives an ENOENT on a path npm itself supplied, so
      // the only assertion that matters is that the returned path is real.
      const dest = scratch("tf-spec-dest-");
      const { path, reported } = packTarball(makeFixturePackage(), dest);
      expect(existsSync(path)).toBe(true);
      expect(dirname(path)).toBe(dest);
      expect(basename(path)).toMatch(/\.tgz$/);
      expect(reported).toBeTruthy();
    },
    NPM_TIMEOUT,
  );

  test(
    "resolves the name from disk rather than from npm's report",
    () => {
      const dest = scratch("tf-spec-dest-");
      const { path } = packTarball(makeFixturePackage(), dest);
      expect(basename(path)).toBe(readdirSync(dest).find((f) => f.endsWith(".tgz")));
    },
    NPM_TIMEOUT,
  );

  test(
    "packs the directory it was given, not the process cwd",
    () => {
      const dest = scratch("tf-spec-dest-");
      const { path } = packTarball(makeFixturePackage("@tf-spec/elsewhere", "9.9.9"), dest);
      expect(basename(path)).toContain("elsewhere");
      expect(basename(path)).toContain("9.9.9");
    },
    NPM_TIMEOUT,
  );

  test(
    "refuses a destination that already holds a tarball",
    () => {
      // A leftover .tgz from an earlier run would otherwise be installed instead
      // of the artifact under test, and the gate would pass against stale code.
      const dest = scratch("tf-spec-dest-");
      writeFileSync(join(dest, "stale-0.0.1.tgz"), "not really a tarball");
      expect(() => packTarball(makeFixturePackage(), dest)).toThrow(
        /expected exactly one \.tgz in .*, found /,
      );
    },
    NPM_TIMEOUT,
  );

  test(
    "names both tarballs when it refuses",
    () => {
      const dest = scratch("tf-spec-dest-");
      writeFileSync(join(dest, "stale-0.0.1.tgz"), "x");
      expect(() => packTarball(makeFixturePackage(), dest)).toThrow(/stale-0\.0\.1\.tgz/);
    },
    NPM_TIMEOUT,
  );
});

// ---------------------------------------------------------------------------
// installTarball — shells out to npm.
// ---------------------------------------------------------------------------

describe("installTarball", () => {
  test(
    "installs the packed artifact into the consumer's node_modules",
    () => {
      const dest = scratch("tf-spec-dest-");
      const { path } = packTarball(makeFixturePackage(), dest);
      const consumer = makeConsumer();
      installTarball(consumer, path);

      const installed = join(consumer, "node_modules", "@tf-spec", "fixture");
      expect(existsSync(join(installed, "package.json"))).toBe(true);
      // The packed CONTENT, not just the manifest: proves the tarball itself was
      // installed rather than something resolved from a registry.
      expect(existsSync(join(installed, "marker.txt"))).toBe(true);
    },
    NPM_TIMEOUT,
  );

  test(
    "records the dependency by default",
    () => {
      const dest = scratch("tf-spec-dest-");
      const { path } = packTarball(makeFixturePackage(), dest);
      const consumer = makeConsumer();
      installTarball(consumer, path);
      expect(existsSync(join(consumer, "package-lock.json"))).toBe(true);
    },
    NPM_TIMEOUT,
  );

  test(
    "honours caller-supplied flags",
    () => {
      // The Deno gate passes --no-package-lock; the Node gate does not. If the
      // flags parameter stopped being forwarded, both gates would silently get
      // the default install and one of them would be wrong.
      const dest = scratch("tf-spec-dest-");
      const { path } = packTarball(makeFixturePackage(), dest);
      const consumer = makeConsumer();
      installTarball(consumer, path, {
        flags: ["--ignore-scripts", "--no-audit", "--no-fund", "--no-package-lock"],
      });
      expect(existsSync(join(consumer, "node_modules", "@tf-spec", "fixture"))).toBe(true);
      expect(existsSync(join(consumer, "package-lock.json"))).toBe(false);
    },
    NPM_TIMEOUT,
  );

  test(
    "throws when the tarball does not exist",
    () => {
      // stdio:"ignore" only so npm's ENOENT novella stays out of the test
      // transcript; a noisy green suite is a suite nobody reads.
      const consumer = makeConsumer();
      expect(() =>
        installTarball(consumer, join(consumer, "nope-1.0.0.tgz"), { stdio: "ignore" }),
      ).toThrow();
    },
    NPM_TIMEOUT,
  );
});
