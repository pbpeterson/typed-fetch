import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

/**
 * READING THE BUILT PACKAGE.
 *
 * A suite that asserts about `dist/` is asserting about the artifact a consumer
 * installs, which is not the same object as `src/`: the bundler is between
 * them, and a hook that survives `src/` but not the bundle is invisible to a
 * suite that reads `src/`.
 *
 * Reaching `dist/` takes two things that were copied into every such suite —
 * an existence probe, so a clean checkout SKIPS instead of failing, and a
 * loader that builds the specifier at run time so `tsc` does not try to resolve
 * a directory that does not exist until `pnpm build` has run. Both live here
 * now, once.
 *
 * The skip behavior is the part to keep exactly: on a clean checkout with no
 * `dist/` the gated blocks skip with a printed warning; in CI a missing `dist/`
 * is an ERROR, because it would mean the workflow lost its `build`-before-`test`
 * ordering and the built surface silently stopped being checked. See
 * CONTRIBUTING.md, "The public surface is frozen — both axes".
 */

/** Resolves a path stated relative to the repository root. */
function fromRoot(path: string): URL {
  return new URL(`../${path}`, import.meta.url);
}

/**
 * A built entry's `file:` URL, named by its path from the repository root.
 *
 * For the suites that hand a specifier to a SPAWNED runtime — Deno, Bun, a
 * bundler — rather than importing it here.
 */
export function builtEntryUrl(path: string): URL {
  return fromRoot(path);
}

/** The root entry's ESM build is present, so the root-entry suites can run. */
export const distExists = existsSync(fromRoot("dist/index.mjs"));

/** The `./errors` subpath's ESM build is present. */
export const errorsDistExists = existsSync(fromRoot("dist/errors/index.mjs"));

/**
 * Reports a missing `dist/` the way every built-surface suite reports it: a
 * warning locally, an error in CI.
 *
 * `tag` names the suite, so a developer who sees the warning knows which file
 * skipped. Call it at module scope, next to the `describe.skipIf` it explains.
 */
export function warnWhenDistMissing(tag: string, present: boolean = distExists): void {
  if (present) return;
  if (process.env.CI) {
    throw new Error(
      `[${tag}] dist/ not found in CI — .github/workflows/ci.yml must run ` +
        "`pnpm build` before `pnpm test` so the dist-gated suites run for real.",
    );
  }
  // eslint-disable-next-line no-console
  console.warn(
    `\n[${tag}] dist/ not found — skipping the built-surface suites. ` +
      "Run `pnpm build` first (e.g. `pnpm build && pnpm test`) to exercise them.\n",
  );
}

const requireFromRoot = createRequire(import.meta.url);

/**
 * Imports a built ESM entry, named by its path from the repository root.
 *
 * The specifier is built at run time, and marked `@vite-ignore`, so neither
 * `tsc` nor vitest's transform tries to resolve `dist/` before it exists.
 */
export function importBuilt<T>(path: string): Promise<T> {
  return import(/* @vite-ignore */ fromRoot(path).href) as Promise<T>;
}

/** Requires a built CJS entry, named by its path from the repository root. */
export function requireBuilt<T>(path: string): T {
  return requireFromRoot(fileURLToPath(fromRoot(path))) as T;
}

/** The root entry (`.`), as ESM. */
export function loadRootEsm<T>(): Promise<T> {
  return importBuilt<T>("dist/index.mjs");
}

/** The root entry (`.`), as CJS. A SECOND copy of the library, by design. */
export function loadRootCjs<T>(): T {
  return requireBuilt<T>("dist/index.js");
}

/** The `./errors` subpath, as ESM. */
export function loadErrorsEsm<T>(): Promise<T> {
  return importBuilt<T>("dist/errors/index.mjs");
}

/** The `./errors` subpath, as CJS. */
export function loadErrorsCjs<T>(): T {
  return requireBuilt<T>("dist/errors/index.js");
}
