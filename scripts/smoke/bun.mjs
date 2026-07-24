// Bun smoke test: proves the built package works under Bun.
// Spins a tiny local HTTP server that always 404s, calls `typedFetch`
// against it, and asserts the returned error is a `NotFoundError`.
//
// Run with: bun run scripts/smoke/bun.mjs
// Requires: pnpm build (dist/index.mjs must exist)

import { NotFoundError, typedFetch } from "../../dist/index.mjs";

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

  // Releasing an unread error body must work here too.
  await error.cancel();

  // Bun-specific, and the reason this case is smoked on the real runtime:
  // Bun reports `Response.bodyUsed` as soon as `getReader()` locks the stream,
  // while Node, Deno, and workerd keep it false. A `cancel()` that read
  // `bodyUsed` to mean "already released" therefore returned SUCCESS here
  // without ever releasing the stream, and then blocked every reader.
  const locked = new Response("payload", { status: 404 });
  locked.body.getReader();
  const lockedError = new NotFoundError(locked);

  let cancelFailure = null;
  try {
    await lockedError.cancel();
  } catch (err) {
    cancelFailure = err;
  }
  if (!(cancelFailure instanceof TypeError)) {
    throw new Error(
      `expected cancel() on an externally locked body to reject with a TypeError, got ${cancelFailure}`,
    );
  }
  if (!/locked/.test(cancelFailure.message)) {
    throw new Error(`expected the lock to be named in the message, got ${cancelFailure.message}`);
  }

  console.log(`bun smoke: OK (NotFoundError, status 404; locked-body cancel rejects)`);
} finally {
  server.stop(true);
}
