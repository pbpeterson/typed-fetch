import http from "node:http";
import { afterAll, beforeAll } from "vitest";

// ── Test HTTP server ─────────────────────────────────────────────────
// Spins up a real server on a random port. Query params control the response:
//   ?status=404          → respond with that status code
//   ?body={"err":"..."}  → respond with that body (sets Content-Type: application/json)
//   ?header=Key:Value    → set a response header (repeatable)
// The server also always echoes the received request method back via an
// X-Echo-Method response header, so tests can assert an arbitrary method
// (e.g. "REPORT") actually reached the server unchanged.
//   ?echoHeader=Name     → echo request header `Name` back as X-Echo-Header
//                           (proves an arbitrary request header reached the server)
//   ?delay=<ms>          → wait this many milliseconds before responding
//                           (used to reliably trigger AbortSignal.timeout())
// The received request body is always echoed back via an X-Echo-Body
// response header, so tests can assert the body actually reached the server.
//
// Each importing spec file calls `useTestServer()` once at module scope. The
// helper registers its OWN beforeAll/afterAll and binds its OWN server on port
// 0, so spec files never share a port or a lifecycle — vitest runs files in
// separate workers, and a shared module-level server would be torn down by
// whichever file finished first.
export function useTestServer(): {
  url: (params?: Record<string, string | number>) => string;
} {
  let baseURL: string;
  let server: http.Server;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const requestUrl = new URL(req.url!, `http://${req.headers.host}`);
      const status = Number(requestUrl.searchParams.get("status") ?? 200);
      const body = requestUrl.searchParams.get("body");
      const headerEntries = requestUrl.searchParams.getAll("header");
      const delay = Number(requestUrl.searchParams.get("delay") ?? 0);
      const echoHeader = requestUrl.searchParams.get("echoHeader");

      for (const entry of headerEntries) {
        const [key = "", value = ""] = entry.split(":");
        res.setHeader(key.trim(), value.trim());
      }

      res.setHeader("X-Echo-Method", req.method ?? "");

      if (echoHeader) {
        const received = req.headers[echoHeader.toLowerCase()];
        res.setHeader("X-Echo-Header", typeof received === "string" ? received : "");
      }

      if (!res.getHeader("content-type") && body) {
        res.setHeader("Content-Type", "application/json");
      }

      // Buffer the request body so tests can assert it reached the server. The
      // body is echoed back via a response header (URL-encoded to stay a valid
      // header value regardless of the payload's bytes).
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const received = Buffer.concat(chunks).toString("utf8");
        res.setHeader("X-Echo-Body", encodeURIComponent(received));

        const respond = () => {
          res.writeHead(status);
          res.end(body ?? null);
        };

        if (delay > 0) {
          setTimeout(respond, delay);
        } else {
          respond();
        }
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, () => resolve());
    });

    const address = server.address() as { port: number };
    baseURL = `http://localhost:${address.port}`;
  });

  afterAll(() => {
    server.close();
  });

  function url(params: Record<string, string | number> = {}): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      search.append(key, String(value));
    }
    return `${baseURL}?${search}`;
  }

  return { url };
}
