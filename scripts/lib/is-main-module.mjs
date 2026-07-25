// @ts-check

// ---------------------------------------------------------------------------
// is-main-module.mjs — "was this module started, or only imported?"
//
// WHY THIS EXISTS
//   Every release gate ends with the same two lines: run main() when the file is
//   the process entry point, do nothing when a spec imports it. Each gate wrote
//   the check itself, and every copy was wrong the same way:
//
//     resolve(process.argv[1]) === fileURLToPath(import.meta.url)
//
//   Node's ESM loader resolves symlinks in the module URL. Node leaves
//   process.argv[1] exactly as the caller typed it. One symlink anywhere in the
//   invocation path therefore makes the two strings differ, the gate defines
//   everything and runs nothing, and the process exits 0 with no output. A
//   release gate that passes in silence is the worst failure this repository
//   has: validate-release.mjs is the only check between a git tag and
//   `npm publish`.
//
//   Real triggers, all of them ordinary: a macOS or self-hosted runner whose
//   temp directory resolves through /private, a symlinked checkout directory, or
//   a wrapper script that invokes the gate through a symlink.
//
// THE CONTRACT
//   isMainModule(import.meta.url) -> boolean
//     - true only when the process entry point and the calling module are the
//       same file on disk, after both sides resolve their symlinks.
//     - false when the module was imported, including from a vitest worker.
//     - It never throws. A guard that throws replaces a silent gate with a
//       crashed one, and neither publishes a correct package.
//
// Zero dependencies on purpose — node: builtins only, like every release gate.
// ---------------------------------------------------------------------------

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Report whether the calling module is the process entry point.
 *
 * Both sides resolve symlinks, so the answer does not change when the caller
 * reaches the script through a symlinked directory or a symlinked file. It also
 * does not change under `--preserve-symlinks-main`, which keeps `import.meta.url`
 * on the symlink instead of the real file.
 *
 * The comparison is case-sensitive. On a case-insensitive file system, a caller
 * who types a different case than the file on disk gets `false`. That is
 * accepted: case folding a path correctly is not possible in general, and a
 * false positive here would run a release gate that a spec only meant to import.
 *
 * @param {string} metaUrl the caller's `import.meta.url`
 * @param {string | undefined} [entry] the process entry path. Defaults to
 *   `process.argv[1]`. Tests pass it directly so they do not mutate `process`.
 * @returns {boolean}
 */
export function isMainModule(metaUrl, entry = process.argv[1]) {
  // `node --input-type=module -e`, `node` reading stdin, and a REPL all leave
  // process.argv[1] undefined. None of them is this module.
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(metaUrl));
  } catch {
    // realpathSync throws ENOENT for a path that is not on disk, and
    // fileURLToPath throws for a URL that is not a file: URL. Neither case is a
    // module that Node started from disk, so the answer is false.
    return false;
  }
}
