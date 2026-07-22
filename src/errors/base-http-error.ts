import { brand, httpErrorBrand } from "./brand";

/**
 * Abstract base class for all HTTP error classes (4xx and 5xx).
 *
 * Provides access to the response body via {@link json}, {@link text},
 * {@link blob}, and {@link arrayBuffer}, as well as response {@link headers}.
 *
 * Carries a cross-copy brand (see `./brand`) so `isHttpError` recognizes
 * instances even when they were created by a different copy of this class
 * (different entry point or module format). Raw `instanceof BaseHttpError`
 * still uses the normal prototype chain and is only reliable within a single
 * copy — prefer `isHttpError` across package boundaries.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status
 */
export abstract class BaseHttpError extends Error {
  /** Response headers from the failed request. */
  public readonly headers: Headers;

  /** HTTP status code (literal type, e.g. `404`). */
  public abstract readonly status: number;

  /**
   * The library's canonical protocol label for {@link status} (normally the
   * current IANA phrase; literal-typed, e.g. `"Not Found"`) - not the server's
   * wire value. The server's wire phrase, when present, is in
   * {@link Error.message | message}.
   */
  public abstract readonly statusText: string;

  /** The URL of the failed request (from `response.url`). */
  public readonly url: string;

  /**
   * The underlying response. A native private field (not a parameter property)
   * so it is NOT an own enumerable instance property — it never leaks into
   * `JSON.stringify(err)`, `{...err}`, `Object.keys(err)`, or a structured
   * logger, keeping the serialized error clean.
   */
  readonly #response: Response;

  constructor(response: Response) {
    const line = response.statusText
      ? `HTTP ${response.status} ${response.statusText}`
      : `HTTP ${response.status}`;
    super(response.url ? `${line} (${response.url})` : line);
    this.url = response.url;
    this.headers = response.headers;
    this.#response = response;
  }

  /**
   * Guard the single-use body readers with a clear message, mirroring
   * {@link clone}. A `Response` body is a one-shot stream; the second read
   * otherwise throws the platform's opaque `TypeError: Body is unusable`.
   */
  #assertBodyUnread(method: string): void {
    if (this.#response.bodyUsed) {
      throw new TypeError(
        `Cannot read this error's body with ${method}(): its response body has already been read. ` +
          "Response bodies are single-use — call clone() BEFORE the first read to read it more than once.",
      );
    }
  }

  /**
   * Parse the error response body as JSON with an optional type parameter.
   *
   * Note: an empty or non-JSON body — common for 4xx/5xx responses, where many
   * servers send an empty body or an HTML page — still rejects with the
   * platform's `SyntaxError`. Use {@link text} when the body may not be JSON.
   */
  async json<T = unknown>(): Promise<T> {
    this.#assertBodyUnread("json");
    return this.#response.json();
  }

  /** Parse the error response body as text. */
  async text(): Promise<string> {
    this.#assertBodyUnread("text");
    return this.#response.text();
  }

  /** Parse the error response body as a Blob. */
  async blob(): Promise<Blob> {
    this.#assertBodyUnread("blob");
    return this.#response.blob();
  }

  /** Parse the error response body as an ArrayBuffer. */
  async arrayBuffer(): Promise<ArrayBuffer> {
    this.#assertBodyUnread("arrayBuffer");
    return this.#response.arrayBuffer();
  }

  /**
   * Clone the error so the response body can be read multiple times.
   *
   * Must be called BEFORE the body is read or its stream is locked — cloning
   * duplicates the response body stream, which is impossible once it has been
   * consumed or a reader has been acquired. Calling it after
   * `json()`/`text()`/`blob()`/`arrayBuffer()`, or while a reader holds the
   * stream, throws a `TypeError` with a clear message (instead of the
   * platform's opaque "Body is unusable").
   *
   * Built-in errors need no callback. Consumer subclasses can pass a
   * recreation callback to preserve custom constructor or private state.
   * Without a callback, cloning uses the compatible response-only constructor
   * behavior from version 1.0.0 and cannot preserve additional state.
   *
   * @example
   * ```ts
   * const copy = error.clone(
   *   (response) => new CustomHttpError(response, error.context),
   * );
   * ```
   */
  clone(recreate?: (response: Response) => this): this {
    if (this.#response.bodyUsed || this.#response.body?.locked) {
      throw new TypeError(
        "Cannot clone this error: its response body has already been read or its stream is locked. " +
          "Call clone() before json()/text()/blob()/arrayBuffer().",
      );
    }
    const clonedResponse = this.#response.clone();
    if (!recreate) {
      const Ctor = this.constructor as new (response: Response) => this;
      return new Ctor(clonedResponse);
    }
    try {
      return recreate(clonedResponse);
    } catch (cause) {
      throw new TypeError(`Cannot clone ${this.name}: the recreate callback failed.`, { cause });
    }
  }
}

// Stamp the cross-copy brand on the prototype so every subclass (all 40 status
// classes + UnknownHttpError) inherits it. Keyed by a `Symbol.for`, it is
// identical across module copies, which is what makes the guards copy-proof.
brand(BaseHttpError.prototype, httpErrorBrand);
