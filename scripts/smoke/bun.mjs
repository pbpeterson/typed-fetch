// Bun smoke test: proves the built package works under Bun.
// Spins a tiny local HTTP server that always 404s, calls `typedFetch`
// against it, and asserts the returned error is a `NotFoundError`.
//
// Run with: bun run scripts/smoke/bun.mjs
// Requires: pnpm build (dist/index.mjs must exist)

import { isAbortError, isNetworkError, NotFoundError, typedFetch } from "../../dist/index.mjs";

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

  // Cancellation classifies under Bun's own ambient fetch. A signal that was
  // already aborted when `typedFetch` was entered comes back as an
  // `AbortedError`; `scripts/smoke/node-min.mjs` step 4 asks Node the same
  // question, and neither answer stands in for the other.
  const controller = new AbortController();
  controller.abort(new Error("smoke abort"));
  const aborted = await typedFetch(url, { signal: controller.signal });
  if (aborted.error === null || aborted.error.name !== "AbortedError") {
    throw new Error(
      `expected an AbortedError for an already-aborted signal, got ${JSON.stringify(aborted.error && aborted.error.name)}`,
    );
  }

  // And an abort that lands while the PROLOGUE is still running is NOT an
  // abort of the call: no request left the process, so the signal governed
  // nothing. ADR 0003's 2026-08-08 amendment scopes the abort window to the
  // transport phase of each runtime's own ambient fetch, so this has to be
  // asked of Bun here rather than inherited from the Node measurement. The
  // reader aborts and then throws, so the signal reports `aborted` while the
  // rejection has nothing to do with it.
  const racer = new AbortController();
  const prologue = await typedFetch(url, {
    signal: racer.signal,
    get method() {
      racer.abort();
      throw new Error("x");
    },
  });
  if (!isNetworkError(prologue.error)) {
    throw new Error(
      `expected a NetworkError from a prologue abort, got ${JSON.stringify(prologue.error && prologue.error.name)}`,
    );
  }
  if (isAbortError(prologue.error)) {
    throw new Error("a prologue abort must not classify as an abort under Bun");
  }

  console.log(
    `bun smoke: OK (NotFoundError, status 404; cancel on locked + consumed bodies; ` +
      `AbortedError before the call, NetworkError from a prologue abort)`,
  );
} finally {
  server.stop(true);
}
