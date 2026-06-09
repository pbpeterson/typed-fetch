/**
 * Union of HTTP method strings usable with `fetch`.
 *
 * `CONNECT` and `TRACE` are deliberately excluded — the Fetch spec forbids
 * them and `fetch` throws a `TypeError` if they are used.
 */
export type HttpMethods = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
