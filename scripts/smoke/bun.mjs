// Bun smoke test: proves the built package works under Bun.
// Spins a tiny local HTTP server that always 404s, calls `typedFetch`
// against it, and asserts the returned error is a `NotFoundError`.
//
// Run with: bun run scripts/smoke/bun.mjs
// Requires: pnpm build (dist/index.mjs must exist)

import { typedFetch } from "../../dist/index.mjs";

const server = Bun.serve({
  port: 0,
  fetch() {
    return new Response("not found", { status: 404 });
  },
});

try {
  const url = `http://localhost:${server.port}/missing`;
  const { response, error } = await typedFetch(url);

  if (response !== null) {
    throw new Error(`expected response to be null, got ${JSON.stringify(response)}`);
  }
  if (error === null) {
    throw new Error("expected error to be non-null");
  }
  if (error.name !== "NotFoundError") {
    throw new Error(`expected error.name to be "NotFoundError", got ${JSON.stringify(error.name)}`);
  }
  if (error.status !== 404) {
    throw new Error(`expected error.status to be 404, got ${JSON.stringify(error.status)}`);
  }

  console.log("bun smoke: OK (NotFoundError, status 404)");
} finally {
  server.stop(true);
}
