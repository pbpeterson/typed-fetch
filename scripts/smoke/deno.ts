// Deno smoke test: proves the built package works under Deno, including
// type-checking against the built .d.ts (`deno check`).
// Spins a tiny local HTTP server that always 404s, calls `typedFetch`
// against it, and asserts the returned error is a `NotFoundError`.
//
// Run with: deno run --allow-net scripts/smoke/deno.ts
// Type-check with: deno check scripts/smoke/deno.ts
// Requires: pnpm build (dist/index.mjs + dist/index.d.mts must exist)

import { isHttpError, typedFetch } from "../../dist/index.mjs";

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
  if (!isHttpError(error)) {
    throw new Error(`expected an HTTP error, got ${JSON.stringify(error)}`);
  }
  if (error.name !== "NotFoundError") {
    throw new Error(`expected error.name to be "NotFoundError", got ${JSON.stringify(error.name)}`);
  }
  if (error.status !== 404) {
    throw new Error(`expected error.status to be 404, got ${JSON.stringify(error.status)}`);
  }

  console.log("deno smoke: OK (NotFoundError, status 404)");
} finally {
  await server.shutdown();
}
