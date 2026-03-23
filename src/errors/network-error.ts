/**
 * Represents a network-level failure (DNS, connection refused, timeout, etc.).
 *
 * Unlike HTTP errors, a `NetworkError` has no status code or response body
 * because the request never reached the server.
 */
export class NetworkError extends Error {
  override readonly name = "NetworkError";

  constructor(message: string = "Network error") {
    super(message);
  }
}
