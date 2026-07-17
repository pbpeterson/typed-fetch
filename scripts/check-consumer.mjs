#!/usr/bin/env node
// Consumer contract gate: pack the tarball and consume it the way a real
// downstream user would.
//
// WHY THIS EXISTS
// ---------------
// Every other test in this repo runs against `src/` or against a single built
// entry point:
//   - test.spec.ts imports `./src/index` — never the packed artifact.
//   - the bun/deno smokes import `dist/index.mjs` — the MAIN entry only.
//   - the API-surface snapshot asserts export NAMES.
//   - verify-pack asserts the file MANIFEST (which paths ship).
// None of them ever installs the tarball and exercises it across the
// `exports` map (`.` vs `./errors`), across formats (ESM vs CJS), or under a
// consumer's own `tsc` moduleResolution. So a whole class of packaging bugs is
// invisible to a 300+ test suite. This gate closes that hole: it runs
// `npm pack`, installs the result into a throwaway consumer project, and
// exercises the INSTALLED package.
//
// Zero dependencies on purpose — the package ships no runtime deps and this
// guard must not grow a dev dep. Plain Node, uses only node: builtins.
//
// Usage:  node scripts/check-consumer.mjs
// Exits non-zero with a per-assertion report if any consumer contract breaks.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PKG_NAME = "@pbpeterson/typed-fetch";

// ---------------------------------------------------------------------------
// KNOWN_FAILING — assertions that fail against the CURRENT (unfixed) artifact.
//
// Three packaging/behaviour bugs are being fixed by concurrent agents. This
// gate was written to BITE on them: run it today and each id below fails. To
// keep CI green until the fixes land, an assertion whose id is listed here is
// reported but does NOT fail the process (an UNEXPECTED PASS, however, DOES —
// so the list can never silently rot). Empty this list before 1.0; a stale id
// is a hard error.
//
// If this set is empty, the gate is strict: every assertion must pass.
// ---------------------------------------------------------------------------
const KNOWN_FAILING = new Set([
  // Empty: all three shipped-artifact bugs this gate was written to catch are
  // now fixed in src/, and every assertion below passes strictly. History,
  // for the record:
  //
  //   Bug 1 (dual-package hazard) — tsup emitted `dist/index.*` and
  //   `dist/errors/index.*` as separate bundles (splitting:false), each with
  //   its own `BaseHttpError`, so a main-entry error was NOT `instanceof` the
  //   `./errors` NotFoundError, and `require(...).isHttpError(esmError)` was
  //   false. Fixed by branding the root error kinds with `Symbol.for(...)`
  //   (src/errors/brand.ts): `isHttpError` & friends now key off the cross-copy
  //   brand instead of `instanceof`, so the GUARDS work across entries and
  //   formats — which is the actual contract. (Raw cross-FORMAT `instanceof` on
  //   a distinct class copy is inherently impossible and is NOT asserted here —
  //   see the `crossformat` probe, which records it informationally; the
  //   library documents "always prefer isHttpError over instanceof" for exactly
  //   this reason.)
  //
  //   Bug 2 (`Request` as FIRST arg with a pre-aborted signal → NetworkError
  //   instead of AbortedError) — the signal rides on the Request, not on the
  //   empty options `typedFetch` inspected. Fixed: `typedFetch` now falls back
  //   to `url.signal` when `init.signal` is absent.
  //
  //   attw-style types wiring — probed via `typecheck:nodenext` below
  //   (moduleResolution:nodenext, skipLibCheck:false forces per-condition ESM
  //   resolution and would surface a single-`types`/`.d.mts` masquerade).
  //   Passes against the current build.
  //
  // If a future change reintroduces any of these, the matching assertion fails
  // loudly. Do NOT add ids here to paper over a real regression.
]);

// ---------------------------------------------------------------------------
// Assertion harness
// ---------------------------------------------------------------------------
const results = [];
function record(id, ok, detail) {
  results.push({ id, ok, detail });
  const known = KNOWN_FAILING.has(id);
  if (ok) {
    console.log(`  ✔ ${id}`);
  } else if (known) {
    console.log(`  ⚠ ${id} — FAILED (known, tracked in KNOWN_FAILING): ${detail}`);
  } else {
    console.log(`  ✖ ${id} — ${detail}`);
  }
}

// Informational only — printed in the report, never affects the exit code.
// Use for facts that document a limitation (e.g. cross-format `instanceof`)
// rather than a contract the artifact must satisfy.
const notes = [];
function note(id, detail) {
  notes.push({ id, detail });
  console.log(`  · ${id} — ${detail}`);
}

// ---------------------------------------------------------------------------
// Temp dirs + cleanup. Everything lives under one mkdtemp root so a single rm
// cleans it all, even on early exit.
// ---------------------------------------------------------------------------
const WORK = mkdtempSync(join(tmpdir(), "tf-consumer-"));
let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  try {
    rmSync(WORK, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}
process.on("exit", cleanup);
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    cleanup();
    process.exit(1);
  });
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: "utf8", ...opts });
}

// ---------------------------------------------------------------------------
// 1. Pack the tarball.
// ---------------------------------------------------------------------------
console.log(`\n▸ Packing ${PKG_NAME} …`);
const packDir = join(WORK, "pack");
mkdirSync(packDir, { recursive: true });
let tarball;
try {
  const out = run("npm", ["pack", "--pack-destination", packDir, "--json"], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "inherit"],
  });
  const meta = JSON.parse(out);
  const filename = (Array.isArray(meta) ? meta[0] : meta).filename;
  // npm reports the logical filename; the real file on disk uses the sanitized
  // (scope-stripped) name. Resolve against what actually landed in packDir.
  const packed = readdirSync(packDir).filter((f) => f.endsWith(".tgz"));
  if (packed.length !== 1) {
    throw new Error(`expected exactly one .tgz in ${packDir}, found ${packed.join(", ")}`);
  }
  tarball = join(packDir, packed[0]);
  console.log(`  packed: ${packed[0]} (reported ${filename})`);
} catch (err) {
  console.error(`\n✖ npm pack failed: ${err.message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 2. Scratch consumer project, install the tarball as a file: dependency.
// ---------------------------------------------------------------------------
console.log("\n▸ Installing tarball into a scratch consumer project …");
const consumer = join(WORK, "consumer");
mkdirSync(consumer, { recursive: true });
writeFileSync(
  join(consumer, "package.json"),
  JSON.stringify(
    {
      name: "tf-consumer-scratch",
      version: "0.0.0",
      private: true,
      // no "type" — we drive ESM via .mjs and CJS via .cjs explicitly so the
      // module system of each probe is unambiguous.
    },
    null,
    2,
  ),
);
try {
  run("npm", ["install", "--no-audit", "--no-fund", "--save", tarball], {
    cwd: consumer,
    stdio: ["ignore", "pipe", "inherit"],
  });
  console.log("  install OK");
} catch (err) {
  console.error(`\n✖ npm install of tarball failed: ${err.message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Runtime probes. Each probe is written to the consumer dir and executed with
// the consumer as cwd, so `@pbpeterson/typed-fetch` resolves through its
// installed node_modules exactly as a real user's would. Each probe prints a
// single JSON line of booleans/values that we assert on here.
// ---------------------------------------------------------------------------
function runProbe(filename, source) {
  const p = join(consumer, filename);
  writeFileSync(p, source);
  const out = run(process.execPath, [p], { cwd: consumer, stdio: ["ignore", "pipe", "pipe"] });
  const line = out.trim().split("\n").filter(Boolean).pop();
  return JSON.parse(line);
}

// A local 404 server helper, inlined into each probe (probes are separate
// processes and cannot share scope).
const SERVER_HELPER = `
import http from "node:http";
export function start404() {
  const server = http.createServer((req, res) => {
    // /hang never responds — used to exercise AbortSignal.timeout deterministically
    // (a real connection that stays open, so the timeout — not a connection
    // refusal — is what aborts the request).
    if (req.url === "/hang") return;
    res.statusCode = 404;
    res.end("nope");
  });
  return new Promise((res) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      const base = \`http://127.0.0.1:\${port}\`;
      res({ url: \`\${base}/missing\`, hangUrl: \`\${base}/hang\`, close: () => server.close() });
    });
  });
}
`;
writeFileSync(join(consumer, "server.mjs"), SERVER_HELPER);

// --- ESM probe: main entry, full behaviour surface ------------------------
console.log("\n▸ ESM (main entry) probes …");
try {
  const r = runProbe(
    "probe-esm.mjs",
    `
import {
  typedFetch,
  isHttpError,
  isKnownHttpError,
  BaseHttpError,
  NotFoundError,
  AbortedError,
  TimeoutError,
} from "${PKG_NAME}";
import { start404 } from "./server.mjs";

class CustomHttpError extends BaseHttpError {
  name = "CustomHttpError";
  status = 599;
  statusText = "Custom Error";
}

const out = {};
const srv = await start404();
try {
  // 404 → NotFoundError
  const { response, error } = await typedFetch(srv.url);
  out.responseNull = response === null;
  out.isHttpError = isHttpError(error);
  out.isKnownHttpError = isKnownHttpError(error);
  out.instanceofNotFound = error instanceof NotFoundError;
  out.status404 = error && error.status === 404;
  out.name = error && error.name;

  const custom = new CustomHttpError(new Response(null, { status: 599 }));
  out.customIsHttp = isHttpError(custom);
  out.customIsNotKnown = !isKnownHttpError(custom);

  // injected fetch implementation
  let injectedCalled = false;
  const injected = async (u, i) => { injectedCalled = true; return fetch(u, i); };
  const inj = await typedFetch(srv.url, { fetch: injected });
  out.injectedCalled = injectedCalled;
  out.injectedNotFound = inj.error instanceof NotFoundError;

  // abort with a custom reason (options.signal path)
  const ac = new AbortController();
  const REASON = { why: "user-cancel" };
  ac.abort(REASON);
  const ab = await typedFetch(srv.url, { signal: ac.signal });
  out.abortIsAborted = ab.error instanceof AbortedError;
  out.abortReason = ab.error && ab.error.reason === REASON;

  // timeout via AbortSignal.timeout — /hang holds the connection open so the
  // timeout, not a connection refusal, is what aborts the request.
  const to = await typedFetch(srv.hangUrl, { signal: AbortSignal.timeout(50) });
  out.timeoutIsTimeout = to.error instanceof TimeoutError;
  out.timeoutName = to.error && to.error.name;

  // Request as FIRST arg with a PRE-ABORTED signal → should be AbortedError.
  const ac2 = new AbortController();
  ac2.abort(new Error("pre-aborted"));
  const req = new Request(srv.url, { signal: ac2.signal });
  const pre = await typedFetch(req);
  out.requestPreAbortName = pre.error && pre.error.name;
  out.requestPreAbortIsAborted = pre.error instanceof AbortedError;
} finally {
  srv.close();
}
console.log(JSON.stringify(out));
`,
  );
  record("esm:response-null", r.responseNull, `responseNull=${r.responseNull}`);
  record("esm:isHttpError", r.isHttpError, `isHttpError=${r.isHttpError}`);
  record("esm:isKnownHttpError", r.isKnownHttpError, `isKnownHttpError=${r.isKnownHttpError}`);
  record("esm:custom-is-http", r.customIsHttp, `customIsHttp=${r.customIsHttp}`);
  record("esm:custom-is-not-known", r.customIsNotKnown, `customIsNotKnown=${r.customIsNotKnown}`);
  record("esm:instanceof-NotFoundError", r.instanceofNotFound, `got name=${r.name}`);
  record("esm:status-404", r.status404, `status check=${r.status404}`);
  record("esm:injected-fetch-called", r.injectedCalled, `injectedCalled=${r.injectedCalled}`);
  record(
    "esm:injected-fetch-NotFound",
    r.injectedNotFound,
    `injectedNotFound=${r.injectedNotFound}`,
  );
  record("esm:abort-reason-AbortedError", r.abortIsAborted, `abortIsAborted=${r.abortIsAborted}`);
  record("esm:abort-reason-preserved", r.abortReason, `reason preserved=${r.abortReason}`);
  record("esm:timeout-TimeoutError", r.timeoutIsTimeout, `got name=${r.timeoutName}`);
  record(
    "abort:request-first-arg-preaborted",
    r.requestPreAbortIsAborted,
    `Request-first-arg pre-aborted signal surfaced as ${r.requestPreAbortName}, expected AbortedError`,
  );
} catch (err) {
  record("esm:probe", false, `ESM probe crashed: ${err.message}`);
}

// --- CJS probe: same surface via require() --------------------------------
console.log("\n▸ CJS (require) probes …");
try {
  const r = runProbe(
    "probe-cjs.cjs",
    `
const { typedFetch, isHttpError, isKnownHttpError, NotFoundError } = require("${PKG_NAME}");
const http = require("node:http");

function start404() {
  const server = http.createServer((req, res) => { res.statusCode = 404; res.end("nope"); });
  return new Promise((res) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      res({ url: \`http://127.0.0.1:\${port}/missing\`, close: () => server.close() });
    });
  });
}

(async () => {
  const out = {};
  const srv = await start404();
  try {
    const { response, error } = await typedFetch(srv.url);
    out.responseNull = response === null;
    out.isHttpError = isHttpError(error);
    out.isKnownHttpError = isKnownHttpError(error);
    out.instanceofNotFound = error instanceof NotFoundError;
    out.status404 = error && error.status === 404;
    out.name = error && error.name;
  } finally {
    srv.close();
  }
  console.log(JSON.stringify(out));
})();
`,
  );
  record("cjs:response-null", r.responseNull, `responseNull=${r.responseNull}`);
  record("cjs:isHttpError", r.isHttpError, `isHttpError=${r.isHttpError}`);
  record("cjs:isKnownHttpError", r.isKnownHttpError, `isKnownHttpError=${r.isKnownHttpError}`);
  record("cjs:instanceof-NotFoundError", r.instanceofNotFound, `got name=${r.name}`);
  record("cjs:status-404", r.status404, `status check=${r.status404}`);
} catch (err) {
  record("cjs:probe", false, `CJS probe crashed: ${err.message}`);
}

// --- Subpath probe: NotFoundError from ./errors, typedFetch from main ------
// Bug 1 (cross-ENTRY axis). An error produced via the main entry's error map
// must be `instanceof` the NotFoundError re-exported from the ./errors subpath.
// The dual-bundle build once made them different classes (→ false); the two
// entries must now share one class identity within a format.
console.log("\n▸ Subpath (./errors) cross-entry instanceof probe …");
try {
  const r = runProbe(
    "probe-subpath.mjs",
    `
import { typedFetch, isHttpError } from "${PKG_NAME}";
import { NotFoundError, BaseHttpError } from "${PKG_NAME}/errors";
import { start404 } from "./server.mjs";

const out = {};
const srv = await start404();
try {
  const { error } = await typedFetch(srv.url);
  out.name = error && error.name;
  out.instanceofSubpathNotFound = error instanceof NotFoundError;
  out.instanceofSubpathBase = error instanceof BaseHttpError;
  out.mainGuardStillTrue = isHttpError(error);
} finally {
  srv.close();
}
console.log(JSON.stringify(out));
`,
  );
  // Sanity: the main-entry guard must still recognise its own error.
  record("subpath:main-guard-true", r.mainGuardStillTrue, `isHttpError=${r.mainGuardStillTrue}`);
  record(
    "subpath:instanceof-across-entries",
    r.instanceofSubpathNotFound,
    `error(name=${r.name}) instanceof (import "${PKG_NAME}/errors").NotFoundError = ${r.instanceofSubpathNotFound} (must be true — the main entry and ./errors must share one class identity within a format)`,
  );
  record(
    "subpath:instanceof-base-across-entries",
    r.instanceofSubpathBase,
    `error instanceof (subpath) BaseHttpError = ${r.instanceofSubpathBase}`,
  );
} catch (err) {
  record("subpath:probe", false, `subpath probe crashed: ${err.message}`);
}

// --- Cross-format probe: require(...).isHttpError on an ESM-import error ----
// Bug 1 on the format axis. The CJS-provided guard must accept an error minted
// by the ESM graph even though the two graphs are separate module copies. The
// brand fix makes `isHttpError` do exactly that (asserted). Raw cross-FORMAT
// `instanceof` on a distinct class copy is inherently impossible across the
// dual-package boundary and is NOT a contract — it is recorded informationally
// so the report documents the limitation without failing.
console.log("\n▸ Cross-format (CJS guard on ESM-minted error) probe …");
try {
  const r = runProbe(
    "probe-crossformat.mjs",
    `
import { typedFetch } from "${PKG_NAME}";          // ESM graph mints the error
import { createRequire } from "node:module";
import { start404 } from "./server.mjs";
const require = createRequire(import.meta.url);
const cjs = require("${PKG_NAME}");                  // CJS graph provides the guard

const out = {};
const srv = await start404();
try {
  const { error } = await typedFetch(srv.url);
  out.name = error && error.name;
  out.cjsGuardOnEsmError = cjs.isHttpError(error);
  out.cjsKnownGuardOnEsmError = cjs.isKnownHttpError(error);
  out.cjsInstanceofOnEsmError = error instanceof cjs.NotFoundError;
} finally {
  srv.close();
}
console.log(JSON.stringify(out));
`,
  );
  record(
    "crossformat:require-guard-on-esm-error",
    r.cjsGuardOnEsmError,
    `require("${PKG_NAME}").isHttpError(esmError name=${r.name}) = ${r.cjsGuardOnEsmError} (must be true — the brand-based guard works across CJS/ESM)`,
  );
  record(
    "crossformat:require-known-guard-on-esm-error",
    r.cjsKnownGuardOnEsmError,
    `require("${PKG_NAME}").isKnownHttpError(esmError name=${r.name}) = ${r.cjsKnownGuardOnEsmError}`,
  );
  // Informational, NOT an assertion: cross-FORMAT `instanceof` on a distinct
  // class copy cannot work across the dual-package boundary — this is exactly
  // why the library brands its guards and tells consumers to prefer them.
  note(
    "crossformat:require-instanceof-on-esm-error",
    `esmError instanceof require(...).NotFoundError = ${r.cjsInstanceofOnEsmError} (expected false across formats — use isHttpError, not instanceof)`,
  );
} catch (err) {
  record("crossformat:probe", false, `cross-format probe crashed: ${err.message}`);
}

// ---------------------------------------------------------------------------
// 4. Typecheck a consumer .ts file against the installed package under BOTH
//    moduleResolution: "bundler" and "nodenext". Uses the repo's own tsc, not
//    npx (no network, deterministic version).
//
//    The nodenext pass doubles as an attw-style types-wiring check: it forces
//    per-condition ESM resolution, which surfaces the single-`types`/`.d.mts`
//    masquerade that `attw` would flag as FalseCJS/FalseESM.
// ---------------------------------------------------------------------------
console.log("\n▸ Consumer typecheck (bundler + nodenext) …");
const tscBin = join(REPO_ROOT, "node_modules", ".bin", "tsc");
const CONSUMER_TS = `
import { typedFetch, isHttpError, isKnownHttpError, NotFoundError } from "${PKG_NAME}";
import { NotFoundError as SubpathNotFound } from "${PKG_NAME}/errors";

export async function demo(): Promise<string> {
  const { response, error } = await typedFetch<{ id: number }>("https://example.test/x");
  if (error) {
    if (isKnownHttpError(error) && error.status === 404) {
      return error.name;
    }
    if (isHttpError(error)) {
      // status is present on HTTP errors after the guard
      return \`http \${error.status}\`;
    }
    return error.name;
  }
  const body = await response.json();
  return String(body.id);
}

export function isNF(e: unknown): e is NotFoundError | SubpathNotFound {
  return e instanceof NotFoundError || e instanceof SubpathNotFound;
}
`;

// Run both typechecks with the consumer project as cwd so the bare specifier
// `@pbpeterson/typed-fetch` resolves through the real install. We place the
// tsconfig+source inside the consumer dir to make resolution consumer-relative.
function typecheckInConsumer(moduleResolution) {
  const fname = `consumer.${moduleResolution}.ts`;
  const cfgname = `tsconfig.${moduleResolution}.json`;
  writeFileSync(join(consumer, fname), CONSUMER_TS);
  const moduleKind = moduleResolution === "nodenext" ? "nodenext" : "esnext";
  writeFileSync(
    join(consumer, cfgname),
    JSON.stringify(
      {
        compilerOptions: {
          target: "es2022",
          module: moduleKind,
          moduleResolution,
          lib: ["ES2022", "DOM"],
          strict: true,
          noEmit: true,
          // skipLibCheck:false so a broken .d.ts in the package surfaces.
          skipLibCheck: false,
          types: [],
        },
        files: [fname],
      },
      null,
      2,
    ),
  );
  try {
    run(tscBin, ["--noEmit", "-p", join(consumer, cfgname)], {
      cwd: consumer,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, output: "" };
  } catch (err) {
    const output = `${err.stdout || ""}${err.stderr || ""}`.trim();
    return { ok: false, output };
  }
}

for (const mr of ["bundler", "nodenext"]) {
  const { ok, output } = typecheckInConsumer(mr);
  const id = `typecheck:${mr}`;
  record(id, ok, ok ? "" : `tsc(${mr}) errors:\n${indent(output)}`);
}

function indent(s) {
  return s
    .split("\n")
    .map((l) => `      ${l}`)
    .join("\n");
}

// ---------------------------------------------------------------------------
// 5. Report + exit.
// ---------------------------------------------------------------------------
console.log("\n" + "─".repeat(70));
console.log("Consumer contract report");
console.log("─".repeat(70));

const failures = results.filter((r) => !r.ok);
const unexpectedFailures = failures.filter((r) => !KNOWN_FAILING.has(r.id));
const knownFailures = failures.filter((r) => KNOWN_FAILING.has(r.id));
const unexpectedPasses = results.filter((r) => r.ok && KNOWN_FAILING.has(r.id));

console.log(`  total assertions : ${results.length}`);
console.log(`  passed           : ${results.filter((r) => r.ok).length}`);
console.log(`  known-failing    : ${knownFailures.length}`);
console.log(`  informational    : ${notes.length}`);
console.log(`  UNEXPECTED fail  : ${unexpectedFailures.length}`);
console.log(`  UNEXPECTED pass  : ${unexpectedPasses.length}`);

if (notes.length) {
  console.log("\n  Informational (documented limitations, not contracts):");
  for (const n of notes) console.log(`    · ${n.id}: ${n.detail}`);
}

if (knownFailures.length) {
  console.log("\n  Known failures (tracked, will turn green when bugs are fixed):");
  for (const f of knownFailures) console.log(`    ⚠ ${f.id}\n        ${f.detail}`);
}

if (unexpectedPasses.length) {
  console.log("\n  ✖ KNOWN_FAILING is stale — these now PASS and must be removed from the list:");
  for (const f of unexpectedPasses) console.log(`    - ${f.id}`);
}

if (unexpectedFailures.length) {
  console.log("\n  ✖ Unexpected failures:");
  for (const f of unexpectedFailures) console.log(`    - ${f.id}: ${f.detail}`);
}

if (unexpectedFailures.length || unexpectedPasses.length) {
  console.log("\n✖ check-consumer: FAILED\n");
  process.exit(1);
}

console.log(
  `\n✔ check-consumer: OK — ${results.filter((r) => r.ok).length} passed` +
    (knownFailures.length ? `, ${knownFailures.length} known-failing (tracked)` : "") +
    ". Tarball behaves as a real consumer expects.\n",
);
process.exit(0);
