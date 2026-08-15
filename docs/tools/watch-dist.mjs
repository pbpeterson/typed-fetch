#!/usr/bin/env node
// Samples dist/ and reports every change, with a timestamp and the reason.
//
// Usage: node watch-dist.mjs <repoRoot> <outFile> [intervalMs]
//
// A change is any of: a file appearing, disappearing, changing size, or
// changing mtime. `tsup` runs with `clean: true`, so a rebuild shows up as the
// whole directory disappearing and then coming back — which is exactly the
// window a spec reading `dist/index.mjs` can fall into.

import { readdirSync, statSync, existsSync, appendFileSync } from "node:fs";
import { join, relative } from "node:path";

const [, , repoRoot, outFile, intervalRaw] = process.argv;
const interval = Number(intervalRaw ?? "150");
const dist = join(repoRoot, "dist");

function snapshot() {
  const seen = new Map();
  if (!existsSync(dist)) return seen;
  const stack = [dist];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // the directory vanished between the readdir and this line
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      try {
        const stat = statSync(full);
        seen.set(relative(repoRoot, full), `${stat.size}:${stat.mtimeMs}`);
      } catch {
        /* vanished mid-walk; the next sample reports it */
      }
    }
  }
  return seen;
}

function log(line) {
  const stamped = `${new Date().toISOString()} ${line}\n`;
  appendFileSync(outFile, stamped);
  process.stdout.write(stamped);
}

let previous = snapshot();
log(`START watching ${dist} — ${previous.size} files`);

setInterval(() => {
  const next = snapshot();
  const added = [...next.keys()].filter((path) => !previous.has(path));
  const removed = [...previous.keys()].filter((path) => !next.has(path));
  const changed = [...next.keys()].filter(
    (path) => previous.has(path) && previous.get(path) !== next.get(path),
  );
  if (added.length + removed.length + changed.length > 0) {
    log(
      `CHANGE added=${added.length} removed=${removed.length} changed=${changed.length} ` +
        `total=${next.size} :: ${[...added.map((p) => `+${p}`), ...removed.map((p) => `-${p}`), ...changed.map((p) => `~${p}`)].slice(0, 6).join(" ")}`,
    );
  }
  previous = next;
}, interval);
