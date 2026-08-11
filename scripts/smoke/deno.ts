// Deno runtime smoke: proves the built JavaScript imports and runs under Deno
// (a distinct runtime with its own TypeScript and Web API implementation).
// Spins a tiny local HTTP server that always 404s, calls `typedFetch`
// against it, and asserts the returned error is a `NotFoundError`.
//
// Run with: deno run --allow-net scripts/smoke/deno.ts
// Type-check with: deno check scripts/smoke/deno.ts
// Requires: pnpm build (dist/index.mjs must exist)
//
// This direct `.mjs` import deliberately tests runtime only. Published Deno
// type-consumability is covered separately by `pnpm check-deno-consumer`, which
// installs the tarball and imports it through its package name and exports map.

import {
  isAbortError,
  isKnownHttpError,
  isNetworkError,
  NotFoundError,
  typedFetch,
} from "../../dist/index.mjs";

const server = Deno.serve(
  { port: 0, onListen: () => {} },
  () => new Response("not found", { status: 404 }),
);

try {
  const { port } = server.addr as Deno.NetAddr;
  const url = `http://localhost:${port}/missing`;
  const { response, error } = await typedFetch(url);

  if (response !== null) {
    throw new Error(`expected response to be null, got ${JSON.stringify(response)}`);
  }
  if (error === null) {
    throw new Error("expected error to be non-null");
  }
  if (!isKnownHttpError(error)) {
    throw new Error(`expected a known HTTP error, got ${JSON.stringify(error)}`);
  }
  // The direct .mjs import carries inferred JavaScript types rather than the
  // package's .d.mts predicates. `instanceof` gives Deno's checker the same
  // concrete class that the runtime smoke expects.
  if (!(error instanceof NotFoundError)) {
    throw new Error(`expected a NotFoundError, got ${JSON.stringify(error)}`);
  }
  if (error.name !== "NotFoundError") {
    throw new Error(`expected error.name to be "NotFoundError", got ${JSON.stringify(error.name)}`);
  }
  if (error.status !== 404) {
    throw new Error(`expected error.status to be 404, got ${JSON.stringify(error.status)}`);
  }

  // Releasing an unread error body must work here too.
  // An explicit reason: `deno check` reads the parameter list from the
  // emitted .mjs, where the optionality lives in the .d.mts only.
  await error.cancel("smoke");

  // The mirror of the Bun case. Deno keeps `bodyUsed` false while a reader
  // holds the stream, so here the lock IS distinguishable from a consumed body
  // and cancel() must reject rather than silently report success.
  const locked = new Response("payload", { status: 404 });
  locked.body!.getReader();
  if (locked.bodyUsed !== false) {
    throw new Error("expected Deno to keep bodyUsed false for a bare getReader()");
  }
  const lockedError = new NotFoundError(locked);

  let cancelFailure: unknown = null;
  try {
    await lockedError.cancel("smoke");
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

  // Cancellation classifies under Deno's own ambient fetch. A signal that was
  // already aborted when `typedFetch` was entered comes back as an
  // `AbortedError`; `scripts/smoke/node-min.mjs` step 4 asks Node the same
  // question, and neither answer stands in for the other.
  const controller = new AbortController();
  controller.abort(new Error("smoke abort"));
  const aborted = await typedFetch(url, { signal: controller.signal });
  if (aborted.error === null || aborted.error.name !== "AbortedError") {
    throw new Error(
      `expected an AbortedError for an already-aborted signal, got ${JSON.stringify(aborted.error)}`,
    );
  }

  // And an abort that lands while the PROLOGUE is still running is NOT an
  // abort of the call: no request left the process, so the signal governed
  // nothing. ADR 0003's 2026-08-08 amendment scopes the abort window to the
  // transport phase of each runtime's own ambient fetch, so this has to be
  // asked of Deno here rather than inherited from the Node measurement. The
  // reader aborts and then throws, so the signal reports `aborted` while the
  // rejection has nothing to do with it.
  const racer = new AbortController();
  const prologue = await typedFetch(url, {
    signal: racer.signal,
    get method(): string {
      racer.abort();
      throw new Error("x");
    },
  });
  if (!isNetworkError(prologue.error)) {
    throw new Error(
      `expected a NetworkError from a prologue abort, got ${JSON.stringify(prologue.error)}`,
    );
  }
  if (isAbortError(prologue.error)) {
    throw new Error("a prologue abort must not classify as an abort under Deno");
  }

  console.log(
    "deno smoke: OK (NotFoundError, status 404; locked-body cancel rejects; " +
      "AbortedError before the call, NetworkError from a prologue abort)",
  );
} finally {
  await server.shutdown();
}
