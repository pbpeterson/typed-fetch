// Minimum-runtime smoke test: proves the BUILT package works on the oldest
// Node this package supports.
//
// WHY THIS EXISTS
//   `engines.node` is `>=20.13.0`, but CI's `node-version: 20` resolves to the
//   LATEST 20.x, so the declared floor was never actually executed. That gap
//   already hid two real problems: the README's `AbortSignal.any()` deadline
//   recipe needs Node 20.3.0, and `clone()` + `cancel()` DEADLOCKS below
//   20.13.0, because undici 5.x gives `Response.clone()` the opposite tee
//   polarity — cancelling the branch never settles. That second one is what set
//   the floor where it is, and step 6 below is what would have caught it: this
//   smoke ran the floor for months without ever calling `clone()`.
//
// The toolchain (vitest, tsup, oxlint) does NOT run here — only the shipped
// artifact does. Build and pack on a current Node, then switch to the floor
// and run this file against the installed tarball or dist/.
//
// Run with:  <node-20.13.0>/bin/node scripts/smoke/node-min.mjs
// Requires:  pnpm build (dist/index.mjs must exist)

import http from "node:http";
import process from "node:process";
import { typedFetch, isHttpError, isKnownHttpError, isNetworkError } from "../../dist/index.mjs";

const MINIMUM = [20, 13, 0];

// Compare the running Node version against MINIMUM component by component and
// return -1 (below the floor), 0 (exactly the floor), or 1 (above the floor).
//
// The earlier check compared only major and minor. That had two consequences,
// both of which let this file report a pass it had not earned. Node 20.0.5 is
// not the floor, but neither `major > 20` nor `minor > 0` held, so the script
// treated it as the floor. And had MINIMUM ever gained a non-zero minor or
// patch, a runtime BELOW the floor would have passed both guards: the refusal
// test read only the major, and the notice test read only major and minor. One
// three-component comparison closes both.
//
// A non-numeric component counts as 0. `process.versions.node` carries one on a
// nightly build (for example "20.0.0-nightly"), and NaN comparisons are always
// false, which would silently take the "this is the floor" branch.
function compareToMinimum(version) {
  const parts = version.split(".").map(Number);
  for (let index = 0; index < MINIMUM.length; index += 1) {
    const part = Number.isFinite(parts[index]) ? parts[index] : 0;
    if (part !== MINIMUM[index]) return part < MINIMUM[index] ? -1 : 1;
  }
  return 0;
}

const order = compareToMinimum(process.versions.node);
if (order < 0) {
  console.error(
    `node-min smoke: refusing to run on Node ${process.versions.node}; ` +
      `the declared floor is ${MINIMUM.join(".")}.`,
  );
  process.exit(1);
}
if (order > 0) {
  const notice =
    `node-min smoke: running on Node ${process.versions.node}, not the ` +
    `${MINIMUM.join(".")} floor. This run does NOT prove floor support.`;
  if (process.env.CI) {
    // In CI the whole point of this job is the floor. If the runtime is not
    // 20.0.0, the setup-node step is misconfigured and a green run would be a
    // lie — fail rather than warn.
    console.error(`${notice} Refusing to report a pass in CI.`);
    process.exit(1);
  }
  // Locally, a developer may not have a 20.0.0 binary. Say so loudly instead
  // of failing, so the smoke stays runnable during development.
  console.warn(`${notice}`);
}

const server = http.createServer((req, res) => {
  if (req.url === "/ok") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: 1 }));
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const base = `http://127.0.0.1:${port}`;

try {
  // 1. The entry point imports and a basic request works.
  const ok = await typedFetch(`${base}/ok`);
  assert(ok.error === null, `expected no error, got ${ok.error && ok.error.name}`);
  const body = await ok.response.json();
  assert(body.id === 1, `expected { id: 1 }, got ${JSON.stringify(body)}`);

  // 2. HTTP errors classify, and the brand guards work.
  const missing = await typedFetch(`${base}/missing`);
  assert(missing.response === null, "expected a null response for 404");
  assert(missing.error.name === "NotFoundError", `got ${missing.error.name}`);
  assert(missing.error.status === 404, `got ${missing.error.status}`);
  assert(isHttpError(missing.error), "isHttpError should hold");
  assert(isKnownHttpError(missing.error), "isKnownHttpError should hold");

  // 3. The error body can be released without buffering it. `cancel()` calls
  //    ReadableStream.cancel(), which is the newest platform API this package
  //    depends on — the one worth pinning at the floor.
  await missing.error.cancel();
  let readAfterCancel = null;
  try {
    await missing.error.text();
  } catch (err) {
    readAfterCancel = err;
  }
  assert(readAfterCancel instanceof TypeError, "a read after cancel() must throw a TypeError");

  // 4. Cancellation classifies. AbortSignal.timeout() exists from Node 20.0.0;
  //    AbortSignal.any() does NOT (it landed in 20.3.0), so this smoke must
  //    never use it.
  const controller = new AbortController();
  controller.abort(new Error("smoke abort"));
  const aborted = await typedFetch(`${base}/ok`, { signal: controller.signal });
  assert(aborted.error.name === "AbortedError", `got ${aborted.error.name}`);

  // 5. A transport failure is a value, not a rejection.
  const refused = await typedFetch("http://127.0.0.1:1/nope");
  assert(isNetworkError(refused.error), `expected a NetworkError, got ${refused.error.name}`);

  // 6. The documented two-branch cleanup SETTLES. This is the step that pins
  //    the floor: `clone()` tees the body, and on undici 5.x (Node 20.0-20.12)
  //    cancelling the branch never settles, so the README's own
  //    `Promise.all([error.cancel(), copy.cancel()])` hangs forever. A timeout
  //    rather than a bare await, because the failure mode is a hang and a hung
  //    smoke reports nothing.
  const teed = await typedFetch(`${base}/missing`);
  const copy = teed.error.clone();
  const settled = await Promise.race([
    Promise.all([teed.error.cancel(), copy.cancel()]).then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 5000)),
  ]);
  assert(settled, "clone() + Promise.all(cancel, cancel) must settle at the floor");

  console.log(`node-min smoke: OK on Node ${process.versions.node}`);
} finally {
  server.close();
}
