#!/usr/bin/env node
// Consumer contract gate: pack the tarball and consume it the way a real
// downstream user would.
//
// WHY THIS EXISTS
// ---------------
// Every other test in this repo runs against `src/` or against a single built
// entry point:
//   - the root *.spec.ts suites import `./src/index` — never the packed artifact.
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
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isMainModule } from "./lib/is-main-module.mjs";
import { installTarball, NPM_ENV, packTarball } from "./lib/npm-pack.mjs";
import { createScratchDir } from "./lib/scratch-dir.mjs";

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

// ===========================================================================
// A. MODULE DATA. Inert strings and constants — importing this file runs
//    nothing, touches no disk and spawns no npm.
// ===========================================================================

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

// --- ESM probe: main entry, full behaviour surface ------------------------
const PROBE_ESM = `
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
`;

// --- CJS probe: same surface via require() --------------------------------
const PROBE_CJS = `
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
`;

// --- Subpath probe: NotFoundError from ./errors, typedFetch from main ------
// Bug 1 (cross-ENTRY axis). An error produced via the main entry's error map
// must be `instanceof` the NotFoundError re-exported from the ./errors subpath.
// The dual-bundle build once made them different classes (→ false); the two
// entries must now share one class identity within a format.
const PROBE_SUBPATH = `
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
`;

// --- Cross-format probe: require(...).isHttpError on an ESM-import error ----
// Bug 1 on the format axis. The CJS-provided guard must accept an error minted
// by the ESM graph even though the two graphs are separate module copies. The
// brand fix makes `isHttpError` do exactly that (asserted). Raw cross-FORMAT
// `instanceof` on a distinct class copy is inherently impossible across the
// dual-package boundary and is NOT a contract — it is recorded informationally
// so the report documents the limitation without failing.
const PROBE_CROSSFORMAT = `
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
`;

// --- Cross-copy clone probe: the ownership query across the format seam -----
// `clone()` tees the error body and hands the branch to a `recreate` callback.
// The body table is per package COPY, so a copy built by a different one is
// invisible to it — and that invisibility used to be read as consent: a callback
// returning an instance from another copy, built from a DIFFERENT response, was
// accepted, the branch became an orphan, and `cancel()` on the original error
// never settled. Every copy now stamps a
// `Symbol.for("@pbpeterson/typed-fetch.ownsResponse")` method on
// `BaseHttpError.prototype`, and `clone()` asks it.
//
// This probe proves the one thing nothing else proves: that the stamp survives
// `npm pack`, `npm install`, and the `exports` map, in BOTH formats, as a real
// consumer resolves them. `Symbol.for` is process-global, so the ESM copy's
// `clone()` can ask a CJS copy's instance — but only if each format actually ran
// its own stamping side effect, which a downstream bundler could tree-shake away.
const PROBE_CROSSCOPY = `
import { typedFetch } from "${PKG_NAME}";          // ESM graph mints and clones
import { createRequire } from "node:module";
import { start404 } from "./server.mjs";
const require = createRequire(import.meta.url);
const cjs = require("${PKG_NAME}");                  // CJS graph supplies the copy

// A stranded branch makes cancel() wait forever, so race it: this probe must
// report a verdict rather than hang the gate.
const settlesWithin = (promise, ms = 500) =>
  Promise.race([
    promise.then(() => "settled", () => "settled"),
    new Promise((resolve) => setTimeout(() => resolve("pending"), ms)),
  ]);

const out = {};
const srv = await start404();
try {
  // 1. A copy from another package copy, built CORRECTLY from the handed
  //    branch, is accepted and both bodies release.
  const accepted = await typedFetch(srv.url);
  let copy;
  const cloned = accepted.error.clone((response) => {
    copy = new cjs.NotFoundError(response);
    return copy;
  });
  out.acceptsCorrectBranch = cloned === copy;
  out.bothCancelsSettle =
    (await settlesWithin(Promise.all([accepted.error.cancel(), copy.cancel()]))) === "settled";

  // 2. The same across formats, from a DIFFERENT response: refused, and the
  //    branch is released BEFORE the throw, so the original stays usable.
  const refused = await typedFetch(srv.url);
  const elsewhere = new Response("elsewhere", { status: 404 });
  let branch;
  let thrown;
  try {
    refused.error.clone((response) => {
      branch = response;
      return new cjs.NotFoundError(elsewhere);
    });
  } catch (err) {
    thrown = err;
  }
  out.refusesDifferentResponse =
    thrown instanceof TypeError && /built from a different response/.test(thrown.message);
  out.branchReleased = Boolean(branch) && branch.bodyUsed === true;
  out.originalCancelSettles = (await settlesWithin(refused.error.cancel())) === "settled";
  if (elsewhere.body) elsewhere.body.cancel().catch(() => {});
} finally {
  srv.close();
}
console.log(JSON.stringify(out));
`;

// --- Resolution probe: the two packaging promises a resolver has to keep -----
// (1) `<pkg>/package.json` must be reachable THROUGH the resolver. Tooling that
//     reads a dependency's manifest (bundler plugins, monorepo linters, version
//     gates) does `require.resolve("<pkg>/package.json")` rather than guessing a
//     path on disk; without a `./package.json` entry in the exports map Node
//     answers ERR_PACKAGE_PATH_NOT_EXPORTED.
// (2) `<pkg>/errors` must ALSO resolve the pre-`exports` way. Jest <=27,
//     webpack 4 and Metro <0.72 never read `exports`; they walk node10's
//     LOAD_AS_DIRECTORY. That path is emulated here by hand — deliberately NOT
//     via require.resolve, which honors `exports` and would prove nothing —
//     and it must land on the very same file the exports map serves, or the
//     package would hand those consumers a second copy of every error class.
const PROBE_RESOLUTION = `
const { existsSync, readFileSync } = require("node:fs");
const { join, resolve: resolvePath } = require("node:path");

const out = {};

// (1) the manifest, through the resolver.
try {
  const p = require.resolve("${PKG_NAME}/package.json");
  out.pkgJsonResolves = true;
  out.pkgJsonName = JSON.parse(readFileSync(p, "utf8")).name;
} catch (err) {
  out.pkgJsonResolves = false;
  out.pkgJsonError = err.code || err.message;
}

// (2) node10 LOAD_AS_DIRECTORY on <pkg>/errors, by hand.
const pkgDir = join(process.cwd(), "node_modules", ...${JSON.stringify(PKG_NAME)}.split("/"));
const stubPath = join(pkgDir, "errors", "package.json");
out.stubExists = existsSync(stubPath);
if (out.stubExists) {
  const stub = JSON.parse(readFileSync(stubPath, "utf8"));
  out.stubFields = ["main", "module", "types"].filter((f) => typeof stub[f] === "string");
  const targets = {};
  for (const field of out.stubFields) {
    targets[field] = resolvePath(join(pkgDir, "errors"), stub[field]);
  }
  out.stubTargetsExist = out.stubFields.every((f) => existsSync(targets[f]));
  // A node10 runtime loads the \`main\` target. It must be real code.
  try {
    out.node10Loads = typeof require(targets.main).NotFoundError === "function";
  } catch (err) {
    out.node10Loads = false;
    out.node10Error = err.code || err.message;
  }
  // …and it must be the SAME file \`exports\` serves, not a second copy.
  out.node10SameFileAsExports = targets.main === require.resolve("${PKG_NAME}/errors");
}
console.log(JSON.stringify(out));
`;

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

// A Node consumer WITHOUT DOM is the case the published declarations must not
// assume. `HeadersInit` lives only in lib.dom.d.ts and `@types/node` does not
// declare it, so naming it directly made this pass fail outright with
// `TS2304: Cannot find name 'HeadersInit'` — or, with skipLibCheck on, silently
// collapse `TypedHeaders` to `any`. The `IsAny` probe below is what catches the
// silent variant: an `any` would satisfy every assignment and look green.
const CONSUMER_NO_DOM_TS = `
import { typedFetch, type TypedFetchOptions } from "${PKG_NAME}";

export async function demo(): Promise<void> {
  await typedFetch("https://example.test/x", {
    headers: { "Content-Type": "application/json", "X-Custom": "1" },
  });
}

type HeadersOf = NonNullable<TypedFetchOptions["headers"]>;
type IsAny<T> = 0 extends 1 & T ? true : false;
export const headersIsNotAny: IsAny<HeadersOf> extends true ? never : true = true;

// A header value must be a string. \`undefined\` reaches the platform as the
// literal "undefined". Without \`lib.dom\` the platform type alone does NOT
// reject it (undici's HeaderRecord is an all-optional mapped type), so this
// directive is unused — and \`tsc\` fails with TS2578 — unless the package's
// own \`headers\` type rejects it. That is the whole point of this line.
declare const token: string | undefined;
export async function optionalHeader(): Promise<void> {
  // @ts-expect-error - Authorization must be a string, never string | undefined
  await typedFetch("https://example.test/x", { headers: { Authorization: token } });
}
`;

// The PRICE of the `undefined` rejection above, pinned rather than left
// accidental — and compiled ONLY on the no-DOM profile, because `lib.dom`'s own
// `HeadersInit` has no optional-valued arm and the assignment succeeds there.
//
// Rejecting `undefined` means undici's all-optional `HeaderRecord` is not
// assignable either, so a value typed `RequestInit` is not assignable to
// `TypedFetchOptions` on the profile this package targets first. A wrapper
// types its own parameter as `TypedFetchOptions`, which is what the README
// examples do. This file is where the trade is visible: restoring `RequestInit`
// assignability means deleting the directive in `CONSUMER_NO_DOM_TS`, and this
// directive would go unused in the same edit.
const CONSUMER_REQUEST_INIT_TS = `
import { typedFetch, type TypedFetchOptions } from "${PKG_NAME}";

declare const nativeInit: RequestInit;
export async function fromNativeInit(): Promise<void> {
  // @ts-expect-error - RequestInit["headers"] admits string | undefined values
  await typedFetch("https://example.test/x", nativeInit);
}

// The documented workaround, which must keep compiling.
export async function fromTypedOptions(init: TypedFetchOptions = {}): Promise<void> {
  await typedFetch("https://example.test/x", init);
}
`;

// The DI seam under `exactOptionalPropertyTypes`. The README presents `fetch`
// as the way to inject a test double, and the value a project actually holds is
// often `typeof fetch | undefined` (a config field, an optional constructor
// argument). Under EOPT an optional property whose type does not NAME
// `undefined` rejects that value with TS2379, so the documented pattern did not
// compile for the whole class of projects that enable the flag.
const CONSUMER_EOPT_TS = `
import { typedFetch } from "${PKG_NAME}";

declare const maybeFetch: typeof fetch | undefined;

export async function di(): Promise<void> {
  await typedFetch("https://example.test/x", { fetch: maybeFetch });
}
`;

// Cross-format assignability. A CJS-typed middle package hands an error to an
// ESM app: with a `#private` field in the declarations these are two nominal
// types and the assignment needs a cast (`TS2741: Property '#private' is
// missing`). The library keeps its per-instance state in a module-scoped
// WeakMap precisely so this compiles.
const CONSUMER_CJS_CTS = `
import { NotFoundError } from "${PKG_NAME}";

export function makeError(): NotFoundError {
  return new NotFoundError(new Response(null, { status: 404 }));
}
`;
const CONSUMER_ESM_MTS = `
import type { NotFoundError, TypedFetchError } from "${PKG_NAME}";
import { makeError } from "./cross-format.cjs";

export const fromCjs: NotFoundError = makeError();
export const asUnion: TypedFetchError = makeError();
`;

// The repo's own @types, so the Node passes need no network install.
const REPO_TYPE_ROOTS = [join(REPO_ROOT, "node_modules", "@types")];

// ---------------------------------------------------------------------------
// 4. Typecheck a consumer .ts file against the installed package under BOTH
//    moduleResolution: "bundler" and "nodenext". Uses the repo's own tsc, not
//    npx (no network, deterministic version).
//
//    The nodenext pass doubles as an attw-style types-wiring check: it forces
//    per-condition ESM resolution, which surfaces the single-`types`/`.d.mts`
//    masquerade that `attw` would flag as FalseCJS/FalseESM.
// ---------------------------------------------------------------------------
export const TYPECHECK_PASSES = [
  // The two original resolution modes.
  {
    id: "bundler",
    moduleResolution: "bundler",
    lib: ["ES2022", "DOM"],
    types: [],
    files: ["consumer.api.ts"],
  },
  {
    id: "nodenext",
    moduleResolution: "nodenext",
    lib: ["ES2022", "DOM"],
    types: [],
    files: ["consumer.api.ts"],
  },
  // A backend service: Node types, no DOM lib.
  {
    id: "node-without-dom",
    moduleResolution: "nodenext",
    lib: ["ES2023"],
    types: ["node"],
    files: ["consumer.nodom.ts", "consumer.reqinit.ts"],
  },
  // The same consumer with DOM also present.
  {
    id: "node-with-dom",
    moduleResolution: "nodenext",
    lib: ["ES2023", "DOM"],
    types: ["node"],
    files: ["consumer.nodom.ts"],
  },
  // The documented DI seam, compiled with exactOptionalPropertyTypes on.
  {
    id: "node-eopt",
    moduleResolution: "nodenext",
    lib: ["ES2023"],
    types: ["node"],
    exactOptionalPropertyTypes: true,
    files: ["consumer.eopt.ts"],
  },
  // CJS -> ESM assignability across the two declaration files.
  {
    id: "cross-format-cjs-esm",
    moduleResolution: "nodenext",
    lib: ["ES2022", "DOM"],
    types: [],
    files: ["cross-format.mts", "cross-format.cts"],
  },
];

// ===========================================================================
// B. THE DECISIONS. Pure: a parsed probe record in, ordered assertions out.
//    No fs, no child_process, no console, no process — so a spec can feed each
//    one the exact JSON a green run produces and assert the id roster, or feed
//    it `{}` and prove a truncated probe fails loudly instead of confusingly.
//
//    Note the seam was already there in spirit: each probe computes booleans
//    like `error && error.status === 404` INSIDE its own process, so the
//    verdict data already crossed a process boundary. This just names it.
// ===========================================================================

/** @typedef {{ id: string, ok: boolean, detail: string }} Assertion */
/** @typedef {{ id: string, detail: string }} Note */
/** @typedef {{ results: Assertion[], notes: Note[] }} ProbeVerdict */

/**
 * @param {string} id
 * @param {unknown} ok truthiness is the verdict, exactly as `record()` treated it
 * @param {string} detail
 * @returns {Assertion}
 */
const assert = (id, ok, detail) => ({ id, ok: Boolean(ok), detail });

/**
 * 13 assertions from the main-entry ESM probe, in the order they are printed.
 * @param {any} r parsed JSON line from probe-esm.mjs
 * @returns {ProbeVerdict}
 */
export function esmAssertions(r) {
  return {
    results: [
      assert("esm:response-null", r.responseNull, `responseNull=${r.responseNull}`),
      assert("esm:isHttpError", r.isHttpError, `isHttpError=${r.isHttpError}`),
      assert("esm:isKnownHttpError", r.isKnownHttpError, `isKnownHttpError=${r.isKnownHttpError}`),
      assert("esm:custom-is-http", r.customIsHttp, `customIsHttp=${r.customIsHttp}`),
      assert(
        "esm:custom-is-not-known",
        r.customIsNotKnown,
        `customIsNotKnown=${r.customIsNotKnown}`,
      ),
      assert("esm:instanceof-NotFoundError", r.instanceofNotFound, `got name=${r.name}`),
      assert("esm:status-404", r.status404, `status check=${r.status404}`),
      assert("esm:injected-fetch-called", r.injectedCalled, `injectedCalled=${r.injectedCalled}`),
      assert(
        "esm:injected-fetch-NotFound",
        r.injectedNotFound,
        `injectedNotFound=${r.injectedNotFound}`,
      ),
      assert(
        "esm:abort-reason-AbortedError",
        r.abortIsAborted,
        `abortIsAborted=${r.abortIsAborted}`,
      ),
      assert("esm:abort-reason-preserved", r.abortReason, `reason preserved=${r.abortReason}`),
      assert("esm:timeout-TimeoutError", r.timeoutIsTimeout, `got name=${r.timeoutName}`),
      assert(
        "abort:request-first-arg-preaborted",
        r.requestPreAbortIsAborted,
        `Request-first-arg pre-aborted signal surfaced as ${r.requestPreAbortName}, expected AbortedError`,
      ),
    ],
    notes: [],
  };
}

/**
 * @param {any} r parsed JSON line from probe-cjs.cjs
 * @returns {ProbeVerdict}
 */
export function cjsAssertions(r) {
  return {
    results: [
      assert("cjs:response-null", r.responseNull, `responseNull=${r.responseNull}`),
      assert("cjs:isHttpError", r.isHttpError, `isHttpError=${r.isHttpError}`),
      assert("cjs:isKnownHttpError", r.isKnownHttpError, `isKnownHttpError=${r.isKnownHttpError}`),
      assert("cjs:instanceof-NotFoundError", r.instanceofNotFound, `got name=${r.name}`),
      assert("cjs:status-404", r.status404, `status check=${r.status404}`),
    ],
    notes: [],
  };
}

/**
 * @param {any} r parsed JSON line from probe-subpath.mjs
 * @returns {ProbeVerdict}
 */
export function subpathAssertions(r) {
  return {
    results: [
      // Sanity: the main-entry guard must still recognise its own error.
      assert(
        "subpath:main-guard-true",
        r.mainGuardStillTrue,
        `isHttpError=${r.mainGuardStillTrue}`,
      ),
      assert(
        "subpath:instanceof-across-entries",
        r.instanceofSubpathNotFound,
        `error(name=${r.name}) instanceof (import "${PKG_NAME}/errors").NotFoundError = ${r.instanceofSubpathNotFound} (must be true — the main entry and ./errors must share one class identity within a format)`,
      ),
      assert(
        "subpath:instanceof-base-across-entries",
        r.instanceofSubpathBase,
        `error instanceof (subpath) BaseHttpError = ${r.instanceofSubpathBase}`,
      ),
    ],
    notes: [],
  };
}

/**
 * Two assertions and ONE NOTE. The note must never become an assertion: raw
 * cross-FORMAT `instanceof` on a distinct class copy is inherently impossible
 * across the dual-package boundary, which is precisely why the library brands
 * its guards and documents "prefer isHttpError over instanceof". Promoting it
 * would turn a documented non-contract into a permanently red gate.
 * @param {any} r parsed JSON line from probe-crossformat.mjs
 * @returns {ProbeVerdict}
 */
export function crossformatAssertions(r) {
  return {
    results: [
      assert(
        "crossformat:require-guard-on-esm-error",
        r.cjsGuardOnEsmError,
        `require("${PKG_NAME}").isHttpError(esmError name=${r.name}) = ${r.cjsGuardOnEsmError} (must be true — the brand-based guard works across CJS/ESM)`,
      ),
      assert(
        "crossformat:require-known-guard-on-esm-error",
        r.cjsKnownGuardOnEsmError,
        `require("${PKG_NAME}").isKnownHttpError(esmError name=${r.name}) = ${r.cjsKnownGuardOnEsmError}`,
      ),
    ],
    notes: [
      {
        id: "crossformat:require-instanceof-on-esm-error",
        detail: `esmError instanceof require(...).NotFoundError = ${r.cjsInstanceofOnEsmError} (expected false across formats — use isHttpError, not instanceof)`,
      },
    ],
  };
}

/**
 * Three assertions from the cross-copy clone probe.
 *
 * The gate is ACCUMULATING, so this returns a verdict record rather than
 * throwing: a refusal that fails to release the branch and a refusal that never
 * happens are two separate findings, and truncating the report to the first one
 * would hide the second.
 * @param {any} r parsed JSON line from probe-crosscopy.mjs
 * @returns {ProbeVerdict}
 */
export function crossCopyAssertions(r) {
  return {
    results: [
      assert(
        "crosscopy:accepts-correct-branch",
        r.acceptsCorrectBranch && r.bothCancelsSettle,
        `accepted=${r.acceptsCorrectBranch} bothCancelsSettle=${r.bothCancelsSettle} (an instance from a different package copy that took the handed branch must be accepted, and both bodies must release — a stamp missing from either format breaks this)`,
      ),
      assert(
        "crosscopy:refuses-different-response",
        r.refusesDifferentResponse,
        `refusesDifferentResponse=${r.refusesDifferentResponse} (a copy built from a DIFFERENT response leaves the teed branch an orphan; accepting it pins one connection and one unreleased stream per cloned error, with no recovery path)`,
      ),
      assert(
        "crosscopy:branch-released",
        r.branchReleased && r.originalCancelSettles,
        `branchReleased=${r.branchReleased} originalCancelSettles=${r.originalCancelSettles} (the refusal must release the branch BEFORE it throws, or cancel() on the original error never settles)`,
      ),
    ],
    notes: [],
  };
}

/**
 * Six assertions from the resolution probe: two for the `./package.json`
 * subpath, four for the node10 directory redirect. These are MANIFEST
 * promises, not behavior — but they are only observable against a real
 * install, which is why they live here and not in verify-pack.
 * @param {any} r parsed JSON line from probe-resolution.cjs
 * @returns {ProbeVerdict}
 */
export function resolutionAssertions(r) {
  return {
    results: [
      assert(
        "resolve:package-json-subpath",
        r.pkgJsonResolves,
        `require.resolve("${PKG_NAME}/package.json") failed with ${r.pkgJsonError} — add "./package.json" to the exports map`,
      ),
      assert(
        "resolve:package-json-is-the-manifest",
        r.pkgJsonName === PKG_NAME,
        `resolved manifest declares name=${r.pkgJsonName}, expected ${PKG_NAME}`,
      ),
      assert(
        "resolve:node10-errors-stub-present",
        r.stubExists,
        `errors/package.json is missing — the ./errors subpath is unresolvable for any consumer whose resolver ignores "exports" (Jest <=27, webpack 4, Metro <0.72)`,
      ),
      assert(
        "resolve:node10-errors-targets-exist",
        r.stubExists && r.stubTargetsExist,
        `errors/package.json declares ${JSON.stringify(r.stubFields ?? [])} but not every target exists in the tarball`,
      ),
      assert(
        "resolve:node10-errors-loads",
        r.node10Loads,
        `loading the stub's main target the node10 way failed: ${r.node10Error} (must expose NotFoundError)`,
      ),
      assert(
        "resolve:node10-errors-same-file-as-exports",
        r.node10SameFileAsExports,
        `the node10 path and the "exports" path must land on ONE file, or a node10 consumer gets a second copy of every error class`,
      ),
    ],
    notes: [],
  };
}

/**
 * Indent captured compiler output so it reads as a block under its assertion.
 * @param {string} s
 */
export function indent(s) {
  return s
    .split("\n")
    .map((l) => `      ${l}`)
    .join("\n");
}

/**
 * @param {{ id: string }} pass
 * @param {{ ok: boolean, output: string }} outcome
 * @returns {Assertion}
 */
export function typecheckAssertion(pass, outcome) {
  return assert(
    `typecheck:${pass.id}`,
    outcome.ok,
    outcome.ok ? "" : `tsc(${pass.id}) errors:\n${indent(outcome.output)}`,
  );
}

/**
 * The tsconfig a consumer typecheck pass runs under. Pure config building,
 * lifted out of the adapter so the policy in it is assertable.
 *
 * @param {{ moduleResolution: string, lib: string[], types: string[], files: string[], exactOptionalPropertyTypes?: boolean }} pass
 * @param {string[]} typeRoots
 */
export function consumerTsconfig(
  { moduleResolution, lib, types, files, exactOptionalPropertyTypes },
  typeRoots,
) {
  const moduleKind = moduleResolution === "nodenext" ? "nodenext" : "esnext";
  return {
    compilerOptions: {
      target: "es2022",
      module: moduleKind,
      moduleResolution,
      lib,
      strict: true,
      noEmit: true,
      // skipLibCheck:false so a broken .d.ts in the package surfaces.
      skipLibCheck: false,
      types,
      ...(exactOptionalPropertyTypes ? { exactOptionalPropertyTypes: true } : {}),
      ...(types.length > 0 ? { typeRoots } : {}),
    },
    files,
  };
}

/**
 * The KNOWN_FAILING bookkeeping and the exit rule, as one pure function.
 *
 * The unexpected-PASS branch is the reason this is worth extracting: it has not
 * executed since KNOWN_FAILING was emptied, and the only time it ever will is
 * during a future incident, when it has to be right.
 *
 * @param {{ results: Assertion[], notes: Note[], knownFailing: Set<string> }} run
 */
export function judgeConsumer({ results, notes, knownFailing }) {
  const failures = results.filter((r) => !r.ok);
  const unexpectedFailures = failures.filter((r) => !knownFailing.has(r.id));
  const knownFailures = failures.filter((r) => knownFailing.has(r.id));
  const unexpectedPasses = results.filter((r) => r.ok && knownFailing.has(r.id));
  return {
    counts: {
      total: results.length,
      passed: results.filter((r) => r.ok).length,
      known: knownFailures.length,
      informational: notes.length,
      unexpectedFail: unexpectedFailures.length,
      unexpectedPass: unexpectedPasses.length,
    },
    knownFailures,
    unexpectedFailures,
    unexpectedPasses,
    ok: unexpectedFailures.length === 0 && unexpectedPasses.length === 0,
  };
}

// ===========================================================================
// C. THE ADAPTER. All I/O, no pass/fail judgement.
// ===========================================================================

function run(cmd, args, opts = {}) {
  const env = cmd === "npm" ? NPM_ENV : process.env;
  return execFileSync(cmd, args, { encoding: "utf8", env, ...opts });
}

// ---------------------------------------------------------------------------
// Runtime probes. Each probe is written to the consumer dir and executed with
// the consumer as cwd, so `@pbpeterson/typed-fetch` resolves through its
// installed node_modules exactly as a real user's would. Each probe prints a
// single JSON line of booleans/values that we assert on here.
// ---------------------------------------------------------------------------
function runProbe(consumer, filename, source) {
  const p = join(consumer, filename);
  writeFileSync(p, source);
  const out = run(process.execPath, [p], { cwd: consumer, stdio: ["ignore", "pipe", "pipe"] });
  const line = out.trim().split("\n").filter(Boolean).pop();
  return JSON.parse(line);
}

// Run each typecheck with the consumer project as cwd so the bare specifier
// `@pbpeterson/typed-fetch` resolves through the real install. We place the
// tsconfig+sources inside the consumer dir to make resolution consumer-relative.
function typecheckInConsumer(consumer, tscBin, pass) {
  const cfgname = `tsconfig.${pass.id}.json`;
  writeFileSync(
    join(consumer, cfgname),
    JSON.stringify(consumerTsconfig(pass, REPO_TYPE_ROOTS), null, 2),
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

// ===========================================================================
// D. THE THIN MAIN. Composition, rendering, exit code — and nothing else.
// ===========================================================================

function main() {
  // Everything lives under one mkdtemp root so a single rm cleans it all, even
  // on early exit or a Ctrl-C mid-install. Created HERE, not at module scope:
  // importing this file must not make a temp dir in every vitest worker.
  const { path: WORK } = createScratchDir("tf-consumer-");

  /** @type {Assertion[]} */
  const results = [];
  /** @type {Note[]} */
  const notes = [];

  // `record` is the RENDERER: it prints as it accumulates, interleaved with the
  // section headers below, which is why the mappers must preserve source order.
  const record = (a) => {
    results.push(a);
    if (a.ok) {
      console.log(`  ✔ ${a.id}`);
    } else if (KNOWN_FAILING.has(a.id)) {
      console.log(`  ⚠ ${a.id} — FAILED (known, tracked in KNOWN_FAILING): ${a.detail}`);
    } else {
      console.log(`  ✖ ${a.id} — ${a.detail}`);
    }
  };
  // Informational only — printed in the report, never affects the exit code.
  // Use for facts that document a limitation (e.g. cross-format `instanceof`)
  // rather than a contract the artifact must satisfy.
  const note = (n) => {
    notes.push(n);
    console.log(`  · ${n.id} — ${n.detail}`);
  };
  const emit = (verdict) => {
    for (const a of verdict.results) record(a);
    for (const n of verdict.notes) note(n);
  };

  // -------------------------------------------------------------------------
  // 1. Pack the tarball.
  // -------------------------------------------------------------------------
  console.log(`\n▸ Packing ${PKG_NAME} …`);
  const packDir = join(WORK, "pack");
  mkdirSync(packDir, { recursive: true });
  let tarball;
  try {
    // npm reports the logical filename; the real file on disk uses the
    // sanitized (scope-stripped) name. packTarball resolves against what
    // actually landed in packDir and hands back npm's claim only so the report
    // can show both.
    const packed = packTarball(REPO_ROOT, packDir);
    tarball = packed.path;
    console.log(`  packed: ${basename(tarball)} (reported ${packed.reported})`);
  } catch (err) {
    console.error(`\n✖ npm pack failed: ${err.message}`);
    process.exit(1);
  }

  // -------------------------------------------------------------------------
  // 2. Scratch consumer project, install the tarball as a file: dependency.
  // -------------------------------------------------------------------------
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
    installTarball(consumer, tarball, { flags: ["--no-audit", "--no-fund", "--save"] });
    console.log("  install OK");
  } catch (err) {
    console.error(`\n✖ npm install of tarball failed: ${err.message}`);
    process.exit(1);
  }

  writeFileSync(join(consumer, "server.mjs"), SERVER_HELPER);

  // -------------------------------------------------------------------------
  // 3. Runtime probes.
  // -------------------------------------------------------------------------
  console.log("\n▸ ESM (main entry) probes …");
  try {
    emit(esmAssertions(runProbe(consumer, "probe-esm.mjs", PROBE_ESM)));
  } catch (err) {
    record(assert("esm:probe", false, `ESM probe crashed: ${err.message}`));
  }

  console.log("\n▸ CJS (require) probes …");
  try {
    emit(cjsAssertions(runProbe(consumer, "probe-cjs.cjs", PROBE_CJS)));
  } catch (err) {
    record(assert("cjs:probe", false, `CJS probe crashed: ${err.message}`));
  }

  console.log("\n▸ Subpath (./errors) cross-entry instanceof probe …");
  try {
    emit(subpathAssertions(runProbe(consumer, "probe-subpath.mjs", PROBE_SUBPATH)));
  } catch (err) {
    record(assert("subpath:probe", false, `subpath probe crashed: ${err.message}`));
  }

  console.log("\n▸ Cross-format (CJS guard on ESM-minted error) probe …");
  try {
    emit(crossformatAssertions(runProbe(consumer, "probe-crossformat.mjs", PROBE_CROSSFORMAT)));
  } catch (err) {
    record(assert("crossformat:probe", false, `cross-format probe crashed: ${err.message}`));
  }

  console.log("\n▸ Cross-copy clone (ESM clones, CJS supplies the new error) probe …");
  try {
    emit(crossCopyAssertions(runProbe(consumer, "probe-crosscopy.mjs", PROBE_CROSSCOPY)));
  } catch (err) {
    record(assert("crosscopy:probe", false, `cross-copy probe crashed: ${err.message}`));
  }

  console.log("\n▸ Resolution (./package.json subpath, node10 ./errors redirect) probes …");
  try {
    emit(resolutionAssertions(runProbe(consumer, "probe-resolution.cjs", PROBE_RESOLUTION)));
  } catch (err) {
    record(assert("resolve:probe", false, `resolution probe crashed: ${err.message}`));
  }

  // -------------------------------------------------------------------------
  // 4. Consumer typechecks.
  // -------------------------------------------------------------------------
  console.log("\n▸ Consumer typecheck (resolution modes, lib matrix, cross-format) …");
  // On Windows the shim is `tsc.cmd`; execFileSync does not resolve the
  // extension for you, so a bare "tsc" is an ENOENT there.
  const tscBin = join(
    REPO_ROOT,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "tsc.cmd" : "tsc",
  );
  if (!existsSync(tscBin)) {
    console.error(`check-consumer: tsc not found at ${tscBin}. Run \`pnpm install\`.`);
    process.exit(1);
  }

  writeFileSync(join(consumer, "consumer.api.ts"), CONSUMER_TS);
  writeFileSync(join(consumer, "consumer.nodom.ts"), CONSUMER_NO_DOM_TS);
  writeFileSync(join(consumer, "consumer.reqinit.ts"), CONSUMER_REQUEST_INIT_TS);
  writeFileSync(join(consumer, "consumer.eopt.ts"), CONSUMER_EOPT_TS);
  writeFileSync(join(consumer, "cross-format.cts"), CONSUMER_CJS_CTS);
  writeFileSync(join(consumer, "cross-format.mts"), CONSUMER_ESM_MTS);

  for (const pass of TYPECHECK_PASSES) {
    record(typecheckAssertion(pass, typecheckInConsumer(consumer, tscBin, pass)));
  }

  // -------------------------------------------------------------------------
  // 5. Report + exit.
  // -------------------------------------------------------------------------
  console.log("\n" + "─".repeat(70));
  console.log("Consumer contract report");
  console.log("─".repeat(70));

  const verdict = judgeConsumer({ results, notes, knownFailing: KNOWN_FAILING });

  console.log(`  total assertions : ${verdict.counts.total}`);
  console.log(`  passed           : ${verdict.counts.passed}`);
  console.log(`  known-failing    : ${verdict.counts.known}`);
  console.log(`  informational    : ${verdict.counts.informational}`);
  console.log(`  UNEXPECTED fail  : ${verdict.counts.unexpectedFail}`);
  console.log(`  UNEXPECTED pass  : ${verdict.counts.unexpectedPass}`);

  if (notes.length) {
    console.log("\n  Informational (documented limitations, not contracts):");
    for (const n of notes) console.log(`    · ${n.id}: ${n.detail}`);
  }

  if (verdict.knownFailures.length) {
    console.log("\n  Known failures (tracked, will turn green when bugs are fixed):");
    for (const f of verdict.knownFailures) console.log(`    ⚠ ${f.id}\n        ${f.detail}`);
  }

  if (verdict.unexpectedPasses.length) {
    console.log("\n  ✖ KNOWN_FAILING is stale — these now PASS and must be removed from the list:");
    for (const f of verdict.unexpectedPasses) console.log(`    - ${f.id}`);
  }

  if (verdict.unexpectedFailures.length) {
    console.log("\n  ✖ Unexpected failures:");
    for (const f of verdict.unexpectedFailures) console.log(`    - ${f.id}: ${f.detail}`);
  }

  if (!verdict.ok) {
    console.log("\n✖ check-consumer: FAILED\n");
    process.exit(1);
  }

  console.log(
    `\n✔ check-consumer: OK — ${verdict.counts.passed} passed` +
      (verdict.counts.known ? `, ${verdict.counts.known} known-failing (tracked)` : "") +
      ". Tarball behaves as a real consumer expects.\n",
  );
  process.exit(0);
}

// Importing this module must do nothing at all; only
// `node scripts/check-consumer.mjs` runs the gate.
if (isMainModule(import.meta.url)) main();
