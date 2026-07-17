import { KnownHttpError } from "./known-http-error";

/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/424 */
export class FailedDependencyError extends KnownHttpError {
  override readonly name = "FailedDependencyError" as const;
  public readonly status = 424 as const;
  public readonly statusText = "Failed Dependency" as const;
  static readonly status = 424 as const;
  static readonly statusText = "Failed Dependency" as const;
}
