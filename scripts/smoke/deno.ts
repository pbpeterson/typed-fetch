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

import { isKnownHttpError, typedFetch } from "../../dist/index.mjs";

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
  // isKnownHttpError proved the shape at runtime; read the documented fields.
  const knownError = error as { readonly name: string; readonly status: number };
  if (knownError.name !== "NotFoundError") {
    throw new Error(
      `expected error.name to be "NotFoundError", got ${JSON.stringify(knownError.name)}`,
    );
  }
  if (knownError.status !== 404) {
    throw new Error(`expected error.status to be 404, got ${JSON.stringify(knownError.status)}`);
  }

  console.log("deno smoke: OK (NotFoundError, status 404)");
} finally {
  await server.shutdown();
}
