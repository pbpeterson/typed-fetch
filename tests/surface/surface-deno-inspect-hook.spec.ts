import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test, expect } from "vitest";
import { NetworkError } from "../../src/errors";
import { inspectRendersOf } from "../../src/errors/inspect";
import {
  builtEntryUrl,
  errorsDistExists as distExists,
  loadErrorsCjs,
  loadErrorsEsm,
  warnWhenDistMissing,
} from "../../fixtures/built-package";

// ═══════════════════════════════════════════════════════════════════════════
// ROUND 9, LANE H4 — the rendering contract round 8 added, read from the
// BUILT package and from every runtime this repository gates.
//
// Round 8 stamped `Symbol.toPrimitive` on the four root prototypes, and three
// documents grew sentences about it. Every assertion here reads `dist/`, or a
// runtime, and never `src/`: `disclosure-channels.spec.ts` and
// `redaction-query-terminator.spec.ts` already drive the source under Node, and a
// hook that survives `src/` but not the bundle, or Node but not Deno, is
// invisible to both.
// ═══════════════════════════════════════════════════════════════════════════

warnWhenDistMissing("round9-h4", distExists);

/** The four ROOT prototypes — the four `installInspect` call sites. */
const ROOT_CLASSES = ["BaseHttpError", "NetworkError", "AbortedError", "TimeoutError"] as const;

type ProtoBag = Record<string, { prototype: object }>;

const loadEsm = (): Promise<ProtoBag> => loadErrorsEsm<ProtoBag>();

const loadCjs = (): ProtoBag => loadErrorsCjs<ProtoBag>();

/** The named class's prototype, or a failure that names the missing export. */
function protoOf(bag: ProtoBag, name: string): object {
  const exported = bag[name];
  if (!exported) throw new Error(`the built package must export ${name}`);
  return exported.prototype;
}

// ── The runtimes this repository gates, and the inspect key each one reads ──
//
// CONTEXT.md's "gate" entry: CI adds `check-deno-consumer`, `smoke:deno`,
// `smoke:node-min`, and a Bun runtime smoke. Three runtimes, and each one
// resolves its OWN custom-inspect key first:
//
//   Node — Symbol.for("nodejs.util.inspect.custom")
//   Bun  — `Bun.inspect.custom`, which IS the Node key (asserted below)
//   Deno — Symbol.for("Deno.customInspect"), documented in the Deno migration
//          guide as the replacement for the removed `Deno.customInspect`
//          property, and read by `Deno.inspect`, which `console.log` uses.
const NODE_INSPECT_KEY = Symbol.for("nodejs.util.inspect.custom");
const DENO_INSPECT_KEY = Symbol.for("Deno.customInspect");

const denoProbe = spawnSync("deno", ["--version"], { encoding: "utf8" });
const denoAvailable = denoProbe.status === 0;

if (!denoAvailable) {
  // eslint-disable-next-line no-console
  console.warn(
    "\n[round9-h4] deno not found — skipping the Deno rendering suite. " +
      "CI runs it in the deno-smoke job.\n",
  );
}

/** Run one TypeScript source under `deno run`, and hand back what it printed. */
function runUnderDeno(source: string): string {
  const dir = mkdtempSync(join(tmpdir(), "round9-h4-deno-"));
  try {
    const file = join(dir, "probe.ts");
    writeFileSync(file, source, "utf8");
    const result = spawnSync("deno", ["run", "--allow-read", file], { encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(`deno exited ${result.status}\n${result.stdout}\n${result.stderr}`);
    }
    return `${result.stdout}${result.stderr}`;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// R9-H4-01 — the inspect channel is owned on Node and Bun, and UNOWNED on Deno
//
// Round 8's finding was that channel three resolved no member this library
// owns, so one write to `Object.prototype` rendered the error and put the full
// href in the log line. ADR 0003 now records the general rule: "A channel in
// that set resolves a member this library owns, so a polluted
// `Object.prototype` cannot supply it."
//
// That sentence is false on Deno. `installInspect` stamps the NODE key only,
// and Deno reads its own key FIRST — an object owning both keys renders
// through `Symbol.for("Deno.customInspect")`. So on Deno the inspect channel
// (channel 2 of the seven, `console.log` / `console.error` / `Deno.inspect`)
// still resolves a member nothing on the prototype chain supplies, and one
// write to `Object.prototype` takes it over. It renders the error's own
// property names, which is where the NON-ENUMERABLE `url` lives: the full
// href, userinfo password and query token included.
// ═══════════════════════════════════════════════════════════════════════════

describe.skipIf(!distExists)("R9-H4-01: the inspect channel every gated runtime reads", () => {
  test("Bun reads the Node key, so the stamp already covers it", () => {
    // Not a claim about the library: a claim about the runtime, pinned so that
    // a future Bun that grows its own key is a red test and not a silent hole.
    const bun = spawnSync("bun", ["--version"], { encoding: "utf8" });
    if (bun.status !== 0) return;
    const probe = spawnSync(
      "bun",
      [
        "--eval",
        "console.log(String(Bun.inspect.custom === Symbol.for('nodejs.util.inspect.custom')))",
      ],
      { encoding: "utf8" },
    );
    expect(probe.stdout.trim()).toBe("true");
  });

  test.each(ROOT_CLASSES)(
    "%s.prototype owns the custom-inspect key of EVERY gated runtime (ESM)",
    async (name) => {
      const proto = protoOf(await loadEsm(), name);

      // Node and Bun. This one passes: `installInspect` stamps it.
      expect(Object.getOwnPropertyDescriptor(proto, NODE_INSPECT_KEY)).toBeDefined();

      // Deno. Nothing stamps it, so `Object.prototype` is the first — and only
      // — place the lookup can land.
      expect(Object.getOwnPropertyDescriptor(proto, DENO_INSPECT_KEY)).toBeDefined();
    },
  );

  test.each(ROOT_CLASSES)(
    "%s.prototype owns the custom-inspect key of EVERY gated runtime (CJS)",
    (name) => {
      const proto = protoOf(loadCjs(), name);
      expect(Object.getOwnPropertyDescriptor(proto, NODE_INSPECT_KEY)).toBeDefined();
      expect(Object.getOwnPropertyDescriptor(proto, DENO_INSPECT_KEY)).toBeDefined();
    },
  );

  test.runIf(denoAvailable)(
    "under Deno, a polluted Object.prototype cannot render the error",
    () => {
      const distUrl = builtEntryUrl("dist/errors/index.mjs").href;
      const printed = runUnderDeno(`
import { NotFoundError } from ${JSON.stringify(distUrl)};

const SECRET = "hunter2SECRET";
const response = new Response(null, { status: 404, statusText: "Not Found" });
Object.defineProperty(response, "url", {
  value: \`https://alice:\${SECRET}@api.example.com/v1/x?token=\${SECRET}\`,
  configurable: true,
});
const error = new NotFoundError(response as Response);
await error.cancel();

// The gadget ADR 0003 says cannot reach a channel: one write, to
// Object.prototype and nowhere else.
Object.defineProperty(Object.prototype, Symbol.for("Deno.customInspect"), {
  value: function (this: object) {
    return Object.getOwnPropertyNames(this)
      .map((n) => \`\${n}=\${String((this as Record<string, unknown>)[n])}\`)
      .join(" | ");
  },
  writable: true,
  configurable: true,
});

console.log(error);
console.log(Deno.inspect(error));
`);

      // `structure and value`: the origin and path may appear. The userinfo
      // password and the query token never may.
      expect(printed).not.toContain("alice:hunter2SECRET@");
      expect(printed).not.toContain("token=hunter2SECRET");
    },
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// The round-8 string-conversion hook, verified against the BUILT package.
//
// CONTEXT.md now says four members are stamped with `defineProperty`, that the
// brands and the ownership query are `writable: false, configurable: false`,
// that the string-conversion hook stays replaceable, and that it delegates to
// `toString` so a subclass override still decides the channel. Every sentence
// is asserted below against `dist/`, in both formats. These PASS.
// ═══════════════════════════════════════════════════════════════════════════

describe.skipIf(!distExists)("the string-conversion hook survives the bundle", () => {
  test.each(ROOT_CLASSES)("%s.prototype carries the hook in both formats", async (name) => {
    for (const proto of [protoOf(await loadEsm(), name), protoOf(loadCjs(), name)]) {
      const descriptor = Object.getOwnPropertyDescriptor(proto, Symbol.toPrimitive);
      expect(descriptor).toBeDefined();
      // Non-enumerable, so it never reaches Object.keys, a spread, or for...in.
      // Writable and configurable, so a consumer can still replace it.
      expect(descriptor?.enumerable).toBe(false);
      expect(descriptor?.writable).toBe(true);
      expect(descriptor?.configurable).toBe(true);
      expect(typeof descriptor?.value).toBe("function");
    }
  });

  test.each(ROOT_CLASSES)(
    "%s.prototype keeps the brand unwritable in both formats",
    async (name) => {
      for (const proto of [protoOf(await loadEsm(), name), protoOf(loadCjs(), name)]) {
        const brand = Object.getOwnPropertySymbols(proto).find((symbol) =>
          String(symbol).includes("@pbpeterson/typed-fetch."),
        );
        expect(brand, `${name} must carry a package-keyed brand`).toBeDefined();
        const descriptor = Object.getOwnPropertyDescriptor(proto, brand as symbol);
        expect(descriptor?.writable).toBe(false);
        expect(descriptor?.configurable).toBe(false);
      }
    },
  );

  test("the built hook delegates to toString, so a subclass override decides it", async () => {
    const { BaseHttpError } = (await loadEsm()) as unknown as {
      BaseHttpError: new (response: Response) => Error & { cancel(): Promise<void> };
    };
    class Quiet extends BaseHttpError {
      override toString(): string {
        return "[redacted by the subclass]";
      }
    }
    const response = new Response(null, { status: 404, statusText: "Not Found" });
    Object.defineProperty(response, "url", {
      value: "https://alice:hunter2@api.example.com/x?token=hunter2",
      configurable: true,
    });
    const error = new Quiet(response);
    await error.cancel();

    expect(`${error}`).toBe("[redacted by the subclass]");
    expect(String(error)).toBe("[redacted by the subclass]");
  });

  test("the built Deno hook is replaceable, so a subclass still decides the channel", async () => {
    const { BaseHttpError } = (await loadEsm()) as unknown as {
      BaseHttpError: new (response: Response) => Error & { cancel(): Promise<void> };
    };
    const descriptor = Object.getOwnPropertyDescriptor(BaseHttpError.prototype, DENO_INSPECT_KEY);
    expect(descriptor?.enumerable).toBe(false);
    expect(descriptor?.writable).toBe(true);
    expect(descriptor?.configurable).toBe(true);

    // The extension point the round-8 reasoning keeps open for the
    // string-conversion hook, kept open here for the same reason: a consumer
    // may legitimately install their own renderer.
    class Quiet extends BaseHttpError {}
    Object.defineProperty(Quiet.prototype, DENO_INSPECT_KEY, {
      value: () => "[rendered by the subclass]",
      configurable: true,
      writable: true,
    });
    const response = new Response(null, { status: 404, statusText: "Not Found" });
    const error = new Quiet(response);
    await error.cancel();

    const hook = (error as unknown as Record<symbol, unknown>)[DENO_INSPECT_KEY] as (
      this: unknown,
    ) => string;
    expect(hook.call(error)).toBe("[rendered by the subclass]");
  });

  test("the stamp adds nothing to either declaration file", () => {
    for (const file of ["./dist/errors/index.d.mts", "./dist/errors/index.d.ts"]) {
      const declaration = readFileSync(builtEntryUrl(file), "utf8");
      // A computed class member would emit a `unique symbol` and reintroduce
      // the cross-format assignability hazard CONTEXT.md names. `defineProperty`
      // emits nothing, and the published TYPE surface is unchanged.
      expect(declaration).not.toContain("unique symbol");
      expect(declaration).not.toContain("toPrimitive");
      expect(declaration).not.toContain("#private");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The Deno hook, under Node — because the CALLING CONVENTION differs.
//
// Deno calls `error[Symbol.for("Deno.customInspect")](inspect, options)`: the
// `inspect` reference FIRST, and no depth argument. Node calls
// `error[util.inspect.custom](depth, options, inspect)`. Only the Deno suite
// above proves the key is resolved; these prove the member behind it renders
// the same record, and keeps the same never-throws invariant, when the
// arguments arrive in Deno's order. They run on every runtime the suite runs
// on, so a change to the shared renderer cannot pass Node and fail Deno.
//
// `inspectRendersOf` owns both conventions, and answers both renders from one
// call. So a case here CANNOT ask one runtime and leave the other unasked,
// which is the drift CONTEXT.md's channel-set rule forbids.
// ═══════════════════════════════════════════════════════════════════════════

describe("the Deno hook renders through the same record", () => {
  const SECRET = "hunter2SECRET";
  const withSecret = (): NetworkError =>
    new NetworkError("boom", {
      url: `https://alice:${SECRET}@api.example.com/v1/x?token=${SECRET}`,
    });

  test("Deno's (inspect, options) order produces the same line as Node's", () => {
    const { node, deno } = inspectRendersOf(withSecret(), (value) => JSON.stringify(value));

    expect(deno).toBe(node);
    // `structure and value`: the redacted origin and path may appear, and the
    // userinfo password and query token never may.
    expect(deno).toContain("api.example.com/v1/x");
    expect(deno).not.toContain(SECRET);
  });

  test("called with no renderer both hooks still answer, and still withhold", () => {
    // A runtime is not obliged to pass anything. The record then renders
    // through `JSON.stringify`, which is the documented no-callback path.
    const { node, deno } = inspectRendersOf(withSecret());

    expect(typeof deno).toBe("string");
    expect(deno).toContain("NetworkError");
    expect(deno).not.toContain(SECRET);
    expect(node).toBe(deno);
  });

  test("a throwing renderer does not take either hook down", () => {
    // Deno propagates a throwing custom inspect straight out of `Deno.inspect`,
    // exactly as Node does out of `util.inspect`.
    const hostile = (): string => {
      throw new TypeError("no");
    };

    expect(() => inspectRendersOf(withSecret(), hostile)).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The refusal, and why it is one lookup per KEY before either hook runs.
//
// `inspectRendersOf` takes the value and resolves both keys on it, so the pair
// of lookups is the only place a caller could come away holding one runtime's
// render and not the other's. That asymmetry is the drift CONTEXT.md's
// channel-set rule forbids, and round 8 shipped it: Node's key stamped, Deno's
// resolving `Object.prototype`. So a value that answers under one key and not
// the other is REFUSED rather than half-rendered, and the message names the
// RUNTIME whose hook is missing — a caller reads "Deno", never a symbol.
// ═══════════════════════════════════════════════════════════════════════════

/** A bare object carrying `member` under `key`, and carrying nothing else. */
function valueUnder(key: symbol, member: unknown): object {
  const value: Record<symbol, unknown> = {};
  value[key] = member;
  return value;
}

describe("a value that resolves no hook is refused, and the refusal names the runtime", () => {
  test("a value owning neither key is refused for Node, which is asked first", () => {
    expect(() => inspectRendersOf({})).toThrow(TypeError);
    expect(() => inspectRendersOf({})).toThrow("this value resolves no Node inspect hook");
  });

  test("the key alone is not the channel — a member that is not callable is no hook", () => {
    // Nothing typechecks what comes off an object of unknown shape, and a
    // polluting write can leave any value under the key. Only a callable one
    // renders, which is what makes `hookAt`'s cast true.
    const value = valueUnder(NODE_INSPECT_KEY, "not a function");

    expect(() => inspectRendersOf(value)).toThrow("this value resolves no Node inspect hook");
  });

  test("owning Node's key alone is refused for Deno, and renders nothing at all", () => {
    let calls = 0;
    const value = valueUnder(NODE_INSPECT_KEY, (): string => {
      calls += 1;
      return "[node]";
    });

    expect(() => inspectRendersOf(value)).toThrow("this value resolves no Deno inspect hook");
    // Both renders come back, or neither does. BOTH keys are resolved before
    // either hook is called, so asking for one never leaves the other unasked
    // and no caller ever holds Node's answer by itself.
    expect(calls).toBe(0);
  });

  test("owning Deno's key alone is refused for Node, and renders nothing at all", () => {
    let calls = 0;
    const value = valueUnder(DENO_INSPECT_KEY, (): string => {
      calls += 1;
      return "[deno]";
    });

    expect(() => inspectRendersOf(value)).toThrow("this value resolves no Node inspect hook");
    expect(calls).toBe(0);
  });
});
