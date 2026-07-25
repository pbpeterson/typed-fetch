// @ts-check

// ---------------------------------------------------------------------------
// scratch-dir.mjs — throwaway directories that survive Ctrl-C.
//
// WHY THIS EXISTS
//   Three release gates pack a tarball into a temp directory. Each hand-rolled
//   its own cleanup, and two of them got it wrong in a way that only shows up
//   under a signal or an early exit:
//
//     - check-deno-consumer.mjs wrapped its work in `try { … } finally { rm }`.
//       A bare `finally` does NOT run when the process dies from SIGINT, so
//       Ctrl-C during `npm install` or `deno check` — the two slow steps a human
//       is most likely to interrupt — left the directory behind every time.
//     - check-docs.mjs cleaned up on its happy path but exited straight out of
//       two failure branches (a missing doc file, and the TS5112 abort), so the
//       runs that leaked were exactly the runs someone was already debugging.
//
//   Getting this right is fiddly (`exit` fires for normal termination, signals
//   do not; the handler must be idempotent; a failed `rm` must not mask the real
//   failure) and it is the same fiddly in every gate. So it is written once,
//   here, and the gates just say what prefix they want.
//
// THE CONTRACT
//   createScratchDir(prefix) -> { path, dispose }
//     - `path` is a fresh `mkdtemp` directory under the OS temp dir.
//     - `dispose()` removes it. Idempotent, and best-effort: a failed removal is
//       swallowed, because a gate that fails for a real reason must report THAT
//       reason and not an EBUSY from its own cleanup.
//     - The directory is removed automatically on normal exit AND on
//       SIGINT/SIGTERM, whether or not the caller ever calls `dispose()`.
//
//   Signal handling is a deliberate BEHAVIOUR CHANGE for the gates that had
//   none: a SIGINT that used to kill the process outright now cleans up and
//   exits 1. check-consumer.mjs already did exactly this; the others now match.
//
//   Handlers are installed on the FIRST createScratchDir() call, never at import
//   time, so importing this module (or anything that imports it) from a test
//   worker registers nothing and creates nothing.
//
// Zero dependencies on purpose — node: builtins only, like every release gate.
// ---------------------------------------------------------------------------

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Dispose callbacks for every scratch directory that has not been removed yet.
 * Module-scoped so one set of process handlers covers all of them, no matter
 * how many directories a gate opens.
 * @type {Set<() => void>}
 */
const pending = new Set();

let handlersInstalled = false;

function disposeAll() {
  // Snapshot first: each dispose() removes itself from `pending`, and a handler
  // that mutates the collection it is walking is exactly the kind of subtlety
  // this module exists to keep out of the gates.
  for (const dispose of Array.from(pending)) dispose();
}

/**
 * Install the process handlers once, lazily. Doing this at import time would
 * make merely importing a gate register handlers in every vitest worker.
 */
function installHandlers() {
  if (handlersInstalled) return;
  handlersInstalled = true;
  // Fires for normal termination and for process.exit() from any branch — this
  // is what covers a gate that exits early out of a failure path.
  process.on("exit", disposeAll);
  // Signals do NOT trigger `exit` handlers on their own. Clean up, then exit
  // non-zero: an interrupted release gate has not passed.
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      disposeAll();
      process.exit(1);
    });
  }
}

/**
 * Create a throwaway directory that is cleaned up on exit, on SIGINT/SIGTERM,
 * or on demand.
 *
 * @param {string} prefix mkdtemp prefix, e.g. `"tf-consumer-"`
 * @returns {{ path: string, dispose: () => void }}
 */
export function createScratchDir(prefix) {
  installHandlers();
  const path = mkdtempSync(join(tmpdir(), prefix));
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    pending.delete(dispose);
    try {
      rmSync(path, { recursive: true, force: true });
    } catch {
      // Best effort. A cleanup failure must never become the reported failure:
      // the gate's own verdict is the interesting one.
    }
  };
  pending.add(dispose);
  return { path, dispose };
}
