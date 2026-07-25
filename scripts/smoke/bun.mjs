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

  // Bun reports `Response.bodyUsed` as soon as `getReader()` locks the stream,
  // while Node, Deno, and workerd keep it false. Pin that divergence here so a
  // Bun change is noticed: it is the reason `cancel()` cannot reject on a
  // locked body without also rejecting on a CONSUMED one, which measures
  // identically (locked AND bodyUsed) on every runtime.
  const locked = new Response("payload", { status: 404 });
  locked.body.getReader();
  if (locked.bodyUsed !== true) {
    throw new Error(
      "expected Bun to report bodyUsed for a bare getReader(); the cancel() decision order " +
        "documents this divergence and should be revisited if it changed",
    );
  }

  // So on Bun this resolves, by the documented rule "believe the runtime".
  const lockedError = new NotFoundError(locked);
  await lockedError.cancel();

  // A body the consumer read themselves must resolve on every runtime — the
  // common case whenever an injected fetch hands back its own Response.
  const consumed = new Response("payload", { status: 404 });
  const consumedError = new NotFoundError(consumed);
  await consumed.text();
  await consumedError.cancel();

  console.log(`bun smoke: OK (NotFoundError, status 404; cancel on locked + consumed bodies)`);
} finally {
  server.stop(true);
}
