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

  /** HTTP status text (literal type, e.g. `"Not Found"`). */
  public abstract readonly statusText: string;

  constructor(protected readonly response: Response) {
    super();
    this.name = this.constructor.name;
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
  abstract clone(): BaseHttpError;
}