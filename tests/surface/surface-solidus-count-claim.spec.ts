import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test, expect } from "vitest";
import {
  builtEntryUrl,
  errorsDistExists as distExists,
  loadErrorsCjs,
  loadErrorsEsm,
  warnWhenDistMissing,
} from "../../fixtures/built-package";

// ═══════════════════════════════════════════════════════════════════════════
// ROUND 10, LANE H4 — the sentences rounds 8 and 9 wrote, read back from the
// BUILT package and from every runtime this repository gates.
//
// Rounds 8 and 9 fixed security-relevant behavior and then described it, in
// `SECURITY.md`, `CONTEXT.md`, ADR 0003, and the ledger. Round 9's own finding
// was a described rule the code did not honor on one gated runtime. Every
// assertion here reads `dist/`, or runs a gated runtime, and never `src/`.
// ═══════════════════════════════════════════════════════════════════════════

warnWhenDistMissing("round10-h4", distExists);

type ErrorClass = new (response: Response) => Error & {
  url: string;
  cancel(): Promise<void>;
  toJSON(): { url?: string };
};
type Bag = Record<string, { prototype: object }> & { NotFoundError: ErrorClass };

const loadEsm = (): Promise<Bag> => loadErrorsEsm<Bag>();

const loadCjs = (): Bag => loadErrorsCjs<Bag>();

/** The four ROOT prototypes — the four `installInspect` call sites. */
const ROOT_CLASSES = ["BaseHttpError", "NetworkError", "AbortedError", "TimeoutError"] as const;

const NODE_INSPECT_KEY = Symbol.for("nodejs.util.inspect.custom");
const DENO_INSPECT_KEY = Symbol.for("Deno.customInspect");

function protoOf(bag: Bag, name: string): object {
  const exported = bag[name];
  if (!exported) throw new Error(`the built package must export ${name}`);
  return exported.prototype;
}

/** An HTTP error from the BUILT package, over a response reporting `url`. */
async function builtErrorFor(
  url: string,
): Promise<Error & { url: string; toJSON(): { url?: string } }> {
  const { NotFoundError } = await loadEsm();
  const response = new Response(null, { status: 404, statusText: "Not Found" });
  Object.defineProperty(response, "url", { value: url, configurable: true });
  const error = new NotFoundError(response);
  await error.cancel();
  return error;
}

// ═══════════════════════════════════════════════════════════════════════════
// R10-H4-01 — SECURITY.md states a redaction rule the built package does not
// keep for the spelling that carries NO solidus.
//
// Round 9 added this sentence to SECURITY.md, under the residual that says a
// secret in a path SEGMENT survives:
//
//   "An embedded url inside that path is not a path segment. The redactor
//    reads a scheme colon and every solidus after it as an authority, so
//    `/go/https:/svc:pw@host` loses its credential however many solidi
//    spelled it."
//
// `src/errors/redact-url.ts` states the same rule twice more — "A region
// STARTS at a scheme colon and every solidus after it" and "A special scheme
// reaches its authority over ANY number of solidi" — and the round-9 ledger
// entry repeats it a third time.
//
// Zero is a number of solidi, and the URL Standard agrees it reaches the
// authority. The special authority slashes state says: "Otherwise,
// special-scheme-missing-following-solidus validation error, set state to
// special authority ignore slashes state and decrease pointer by 1", and the
// special authority ignore slashes state says: "If c is neither U+002F (/)
// nor U+005C (\), then set state to authority state and decrease pointer by
// 1." So `https:svc:pw@host` names the host `host` with the username `svc`
// and the password `pw` — the first assertion below makes the platform say
// so, rather than taking the standard's word for it.
//
// `nextAuthority` requires at least one solidus (`start > colon + 1`), so the
// zero-solidus spelling opens no region, `looksLikeUserinfo` is never asked,
// and the credential rides out through `error.url`, `error.message`,
// `toJSON()`, and every channel that renders them.
// ═══════════════════════════════════════════════════════════════════════════

describe.skipIf(!distExists)(
  "R10-H4-01: SECURITY.md's solidus rule against the built package",
  () => {
    const CREDENTIAL = "svc:hunter2";

    test.each([
      ["no solidus at all", ""],
      ["a single solidus", "/"],
      ["the ordinary two", "//"],
      ["three", "///"],
      ["four", "////"],
    ])("an embedded url spelled with %s loses its credential", async (_label, solidi) => {
      const embedded = `https:${solidi}${CREDENTIAL}@internal.test/v1`;

      // The platform is the oracle for "this text is an authority with
      // userinfo", so the assertion below is about the redactor and nothing
      // else. Every spelling names the same host and the same credential.
      const parsed = new URL(embedded);
      expect(parsed.host).toBe("internal.test");
      expect(parsed.username).toBe("svc");
      expect(parsed.password).toBe("hunter2");

      const error = await builtErrorFor(`https://api.test/go/${embedded}`);

      expect(error.toJSON().url).not.toContain(CREDENTIAL);
      expect(error.message).not.toContain(CREDENTIAL);
      expect(String(error)).not.toContain(CREDENTIAL);
    });
  },
);

// ═══════════════════════════════════════════════════════════════════════════
// CONTEXT.md's count, and the descriptor flags it states, read from `dist/`.
//
// "Five members are stamped this way: the brands, the inspect hook under
// Node's key, the same hook under Deno's key, the ownership query, and the
// string-conversion hook. … The brands and the query are stamped
// `writable: false, configurable: false` … The inspect hook stays replaceable
// under both keys."
//
// Round 9 pinned the brand flags and the Deno key on one class. The count
// itself, and the Node key's own flags, were never asserted: a sixth stamp, or
// a Node hook frozen where the sentence promises it is replaceable, passes
// every existing suite.
// ═══════════════════════════════════════════════════════════════════════════

describe.skipIf(!distExists)("the stamped members are exactly the five CONTEXT.md names", () => {
  test.each(["esm", "cjs"] as const)(
    "BaseHttpError.prototype carries five, and no sixth (%s)",
    async (format) => {
      const bag = format === "esm" ? await loadEsm() : loadCjs();
      const stamped = Object.getOwnPropertySymbols(protoOf(bag, "BaseHttpError")).map(String);

      expect(stamped.toSorted()).toEqual(
        [
          "Symbol(@pbpeterson/typed-fetch.BaseHttpError)",
          "Symbol(@pbpeterson/typed-fetch.ownsResponse)",
          "Symbol(Deno.customInspect)",
          "Symbol(Symbol.toPrimitive)",
          "Symbol(nodejs.util.inspect.custom)",
        ].toSorted(),
      );
    },
  );

  test.each(ROOT_CLASSES)("%s keeps the inspect hook replaceable under BOTH keys", async (name) => {
    for (const bag of [await loadEsm(), loadCjs()]) {
      const proto = protoOf(bag, name);
      for (const key of [NODE_INSPECT_KEY, DENO_INSPECT_KEY]) {
        const descriptor = Object.getOwnPropertyDescriptor(proto, key);
        expect(descriptor, `${name} must own ${String(key)}`).toBeDefined();
        expect(descriptor?.enumerable).toBe(false);
        // "a consumer may legitimately install their own" — the sentence is
        // only true while both flags hold.
        expect(descriptor?.writable).toBe(true);
        expect(descriptor?.configurable).toBe(true);
      }
    }
  });

  test("the ownership query is the unwritable one CONTEXT.md says it is", async () => {
    for (const bag of [await loadEsm(), loadCjs()]) {
      const proto = protoOf(bag, "BaseHttpError");
      const query = Object.getOwnPropertySymbols(proto).find((symbol) =>
        String(symbol).includes("ownsResponse"),
      );
      const descriptor = Object.getOwnPropertyDescriptor(proto, query as symbol);
      expect(typeof descriptor?.value).toBe("function");
      expect(descriptor?.writable).toBe(false);
      expect(descriptor?.configurable).toBe(false);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The gated runtimes, end to end.
//
// ADR 0003 now says: "A channel in that set resolves a member this library
// owns on every runtime this package gates". Three runtimes are gated — the
// CI matrix and `smoke:node-min` for Node, `bun-smoke` for Bun, `deno-smoke`
// for Deno. Round 9 proved the Deno inspect key by rendering under Deno, and
// proved Bun only by comparing its key to Node's. Nothing renders an error
// under Bun, and nothing measures the FATAL-EXCEPTION printer — channel 7,
// the one channel that disables every hook — on any runtime but Node.
// ═══════════════════════════════════════════════════════════════════════════

const SECRET = "hunter2SECRET";
const SECRET_URL = `https://alice:${SECRET}@api.example.com/v1/x?token=${SECRET}`;

/**
 * Write `source` into a scratch directory and run it under `command`.
 *
 * The secret arrives through the ENVIRONMENT, never through the probe's text.
 * Bun's fatal-exception printer echoes the source lines around the throw, so a
 * url written into the file is reported by the runtime whatever the library
 * does — a false positive that says nothing about a channel.
 */
function runUnder(command: string, args: string[], source: string, extension: string): string {
  const dir = mkdtempSync(join(tmpdir(), "round10-h4-"));
  try {
    const file = join(dir, `probe.${extension}`);
    writeFileSync(file, source, "utf8");
    const result = spawnSync(command, [...args, file], {
      encoding: "utf8",
      env: { ...process.env, ROUND10_URL: SECRET_URL },
    });
    return `${result.stdout}${result.stderr}`;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const available = (command: string): boolean =>
  spawnSync(command, ["--version"], { encoding: "utf8" }).status === 0;

const bunAvailable = available("bun");
const denoAvailable = available("deno");

/** A probe that builds one error over a secret-bearing url and renders it. */
function renderProbe(distUrl: string, tail: string): string {
  return `
import { NotFoundError } from ${JSON.stringify(distUrl)};
const env = globalThis.Deno ? globalThis.Deno.env.get("ROUND10_URL") : process.env.ROUND10_URL;
const response = new Response(null, { status: 404, statusText: "Not Found" });
Object.defineProperty(response, "url", { value: env, configurable: true });
const error = new NotFoundError(response);
await error.cancel();
${tail}
`;
}

describe.skipIf(!distExists)("every gated runtime renders without the secret", () => {
  const distUrl = builtEntryUrl("dist/errors/index.mjs").href;

  test.runIf(bunAvailable)("Bun renders the record through the hook it resolves", () => {
    const printed = runUnder(
      "bun",
      ["run"],
      renderProbe(
        distUrl,
        `console.log(error);
console.log(JSON.stringify(error));
console.log(\`\${error}\`);
console.log(Bun.inspect(error));`,
      ),
      "mjs",
    );

    // `structure and value`: the redacted origin and path may appear; the
    // userinfo password and the query token never may.
    expect(printed).toContain("api.example.com/v1/x");
    expect(printed).not.toContain(SECRET);
  });

  test.runIf(bunAvailable)("Bun's fatal-exception printer withholds it too", () => {
    // Channel 7. It disables every formatting hook, so property ENUMERABILITY
    // is the only control — and `url` and `headers` are non-enumerable
    // precisely for this printer. Measured here on the runtime, not inferred
    // from Node's behavior.
    const printed = runUnder("bun", ["run"], renderProbe(distUrl, "throw error;"), "mjs");

    expect(printed).toContain("NotFoundError");
    expect(printed).not.toContain(SECRET);
  });

  test.runIf(denoAvailable)("Deno's fatal-exception printer withholds it too", () => {
    const printed = runUnder(
      "deno",
      ["run", "--allow-read", "--allow-env"],
      renderProbe(distUrl, "throw error;"),
      "ts",
    );

    expect(printed).toContain("NotFoundError");
    expect(printed).not.toContain(SECRET);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// `sideEffects: false` against a module that STAMPS prototypes on import.
//
// The ledger settled this for the brands, measured with Rollup. Rounds 8 and 9
// added two stamps the measurement predates — the string-conversion hook and
// the Deno inspect key — and both are exactly the shape a bundler is entitled
// to drop: a top-level call whose result nobody reads, in a package that
// declares itself free of side effects. A dropped stamp is invisible to every
// other suite, because every other suite imports the module directly.
// ═══════════════════════════════════════════════════════════════════════════

const esbuildBinary = new URL("../../node_modules/.bin/esbuild", import.meta.url).pathname;
const esbuildAvailable = existsSync(esbuildBinary);

describe.skipIf(!distExists || !esbuildAvailable)(
  "a tree-shaking bundler keeps every stamp",
  () => {
    test("a consumer that imports one class still gets all five members", () => {
      const dir = mkdtempSync(join(tmpdir(), "round10-h4-shake-"));
      try {
        const entry = join(dir, "entry.mjs");
        const bundle = join(dir, "bundle.mjs");
        const distPath = fileURLToPath(builtEntryUrl("dist/errors/index.mjs"));

        // The import is resolved through the package's own `package.json`, which
        // says `"sideEffects": false`, so the bundler is free to drop every
        // top-level statement it reads as pure.
        writeFileSync(
          entry,
          `import { NotFoundError } from ${JSON.stringify(distPath)};
const response = new Response(null, { status: 404, statusText: "Not Found" });
const error = new NotFoundError(response);
await error.cancel();
let proto = Object.getPrototypeOf(error);
const found = [];
while (proto && proto !== Object.prototype) {
  for (const symbol of Object.getOwnPropertySymbols(proto)) found.push(String(symbol));
  proto = Object.getPrototypeOf(proto);
}
console.log(JSON.stringify(found));
`,
          "utf8",
        );

        const built = spawnSync(
          esbuildBinary,
          [entry, "--bundle", "--format=esm", "--platform=node", "--minify", `--outfile=${bundle}`],
          { encoding: "utf8" },
        );
        expect(built.status, built.stderr).toBe(0);

        const run = spawnSync(process.execPath, [bundle], { encoding: "utf8" });
        expect(run.status, run.stderr).toBe(0);
        const found = JSON.parse(run.stdout.trim()) as string[];

        for (const expected of [
          "Symbol(@pbpeterson/typed-fetch.BaseHttpError)",
          "Symbol(@pbpeterson/typed-fetch.KnownHttpError)",
          "Symbol(@pbpeterson/typed-fetch.ownsResponse)",
          "Symbol(Deno.customInspect)",
          "Symbol(Symbol.toPrimitive)",
          "Symbol(nodejs.util.inspect.custom)",
        ]) {
          expect(found, `the bundle dropped ${expected}`).toContain(expected);
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  },
);

// ═══════════════════════════════════════════════════════════════════════════
// The node-floor smoke's own honesty.
//
// `pnpm smoke:node-min` is a gate in the verification list, and the developer
// running it almost never holds a 20.13.0 binary. The script must therefore
// say what it did NOT prove, and it must refuse outright where a green row is
// read as evidence. Nothing pinned either behavior.
// ═══════════════════════════════════════════════════════════════════════════

describe("smoke:node-min reports only the floor it actually ran", () => {
  const script = new URL("../../scripts/smoke/node-min.mjs", import.meta.url).pathname;
  const onTheFloor = process.versions.node === "20.13.0";

  test.skipIf(onTheFloor)("off the floor it refuses to report a pass in CI", () => {
    const result = spawnSync(process.execPath, [script], {
      encoding: "utf8",
      env: { ...process.env, CI: "1" },
    });

    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain("does NOT prove floor support");
  });
});
