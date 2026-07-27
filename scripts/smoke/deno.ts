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

import { isKnownHttpError, NotFoundError, typedFetch } from "../../dist/index.mjs";

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

  console.log("deno smoke: OK (NotFoundError, status 404; locked-body cancel rejects)");
} finally {
  await server.shutdown();
}
