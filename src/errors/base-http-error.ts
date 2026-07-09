/**
 * Abstract base class for all HTTP error classes (4xx and 5xx).
 *
 * Provides access to the response body via {@link json}, {@link text},
 * {@link blob}, and {@link arrayBuffer}, as well as response {@link headers}.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status
 */
export abstract class BaseHttpError extends Error {
  /** Response headers from the failed request. */
  public readonly headers: Headers;

  /** HTTP status code (literal type, e.g. `404`). */
  public abstract readonly status: number;

  /**
   * The canonical IANA reason phrase for {@link status} (literal type, e.g.
   * `"Not Found"`) - not the server's wire value. The server's wire phrase,
   * when present, is in {@link Error.message | message}.
   */
  public abstract readonly statusText: string;

  /** The URL of the failed request (from `response.url`). */
  public readonly url: string;

  constructor(protected readonly response: Response) {
    const line = response.statusText
      ? `HTTP ${response.status} ${response.statusText}`
      : `HTTP ${response.status}`;
    super(response.url ? `${line} (${response.url})` : line);
    this.url = response.url;
    this.headers = response.headers;
  }

  /** Parse the error response body as JSON with an optional type parameter. */
  async json<T = unknown>(): Promise<T> {
    return this.response.json();
  }

  /** Parse the error response body as text. */
  async text(): Promise<string> {
    return this.response.text();
  }

  /** Parse the error response body as a Blob. */
  async blob(): Promise<Blob> {
    return this.response.blob();
  }

  /** Parse the error response body as an ArrayBuffer. */
  async arrayBuffer(): Promise<ArrayBuffer> {
    return this.response.arrayBuffer();
  }

  /** Clone the error so the response body can be read multiple times. */
  clone(): this {
    const Ctor = this.constructor as new (response: Response) => this;
    return new Ctor(this.response.clone());
  }
}
