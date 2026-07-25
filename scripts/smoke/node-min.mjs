// Minimum-runtime smoke test: proves the BUILT package works on the oldest
// Node this package supports.
//
// WHY THIS EXISTS
//   `engines.node` is `>=20`, but CI's `node-version: 20` resolves to the
//   LATEST 20.x, so the declared floor was never actually executed. That gap
//   already hid one real problem: the README's `AbortSignal.any()` deadline
//   recipe needs Node 20.3.0, while the floor is 20.0.0. This smoke pins the
//   floor exactly.
//
// The toolchain (vitest, tsup, oxlint) does NOT run here — only the shipped
// artifact does. Build and pack on a current Node, then switch to the floor
// and run this file against the installed tarball or dist/.
//
// Run with:  <node-20.0.0>/bin/node scripts/smoke/node-min.mjs
// Requires:  pnpm build (dist/index.mjs must exist)

import http from "node:http";
import process from "node:process";
import { typedFetch, isHttpError, isKnownHttpError, isNetworkError } from "../../dist/index.mjs";

const MINIMUM = [20, 0, 0];

const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
if (major < MINIMUM[0]) {
  console.error(
    `node-min smoke: refusing to run on Node ${process.versions.node}; ` +
      `the declared floor is ${MINIMUM.join(".")}.`,
  );
  process.exit(1);
}
if (major > MINIMUM[0] || minor > MINIMUM[1]) {
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

  console.log(`node-min smoke: OK on Node ${process.versions.node}`);
} finally {
  server.close();
}
