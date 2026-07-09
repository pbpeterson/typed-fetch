/**
 * Generates the 40 concrete HTTP error classes, `src/errors/helpers.ts`, and
 * `src/http-status-codes.ts` from a single source-of-truth table below.
 *
 * This eliminates the "5-place sync problem": previously a new status code
 * had to be added by hand to (1) its own file, (2) the `helpers.ts` import
 * list, (3) the `httpErrors` array, (4) the `ClientErrors`/`ServerErrors`
 * union, and (5) the `http-status-codes.ts` import + map entry. Now it is
 * one row in `ERROR_TABLE`.
 *
 * Run with `pnpm generate`. `pnpm generate:check` regenerates and fails the
 * build if the tree drifts from the table (e.g. a hand-edited file).
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(scriptDir, "..");
const ERRORS_DIR = path.join(ROOT, "src", "errors");

type Kind = "client" | "server";

interface ErrorRow {
  code: number;
  statusText: string;
  className: string;
  kind: Kind;
}

/**
 * Source of truth: one row per HTTP status code with a dedicated error
 * class. Sorted by status code — all other generated orderings (alphabetical
 * unions, per-kind arrays, etc.) are derived from this table, not from file
 * order.
 */
const ERROR_TABLE: ErrorRow[] = [
  { code: 400, statusText: "Bad Request", className: "BadRequestError", kind: "client" },
  { code: 401, statusText: "Unauthorized", className: "UnauthorizedError", kind: "client" },
  { code: 402, statusText: "Payment Required", className: "PaymentRequiredError", kind: "client" },
  { code: 403, statusText: "Forbidden", className: "ForbiddenError", kind: "client" },
  { code: 404, statusText: "Not Found", className: "NotFoundError", kind: "client" },
  {
    code: 405,
    statusText: "Method Not Allowed",
    className: "MethodNotAllowedError",
    kind: "client",
  },
  { code: 406, statusText: "Not Acceptable", className: "NotAcceptableError", kind: "client" },
  {
    code: 407,
    statusText: "Proxy Authentication Required",
    className: "ProxyAuthenticationRequiredError",
    kind: "client",
  },
  { code: 408, statusText: "Request Timeout", className: "RequestTimeoutError", kind: "client" },
  { code: 409, statusText: "Conflict", className: "ConflictError", kind: "client" },
  { code: 410, statusText: "Gone", className: "GoneError", kind: "client" },
  { code: 411, statusText: "Length Required", className: "LengthRequiredError", kind: "client" },
  {
    code: 412,
    statusText: "Precondition Failed",
    className: "PreconditionFailedError",
    kind: "client",
  },
  { code: 413, statusText: "Payload Too Large", className: "RequestTooLongError", kind: "client" },
  { code: 414, statusText: "URI Too Long", className: "RequestUriTooLongError", kind: "client" },
  {
    code: 415,
    statusText: "Unsupported Media Type",
    className: "UnsupportedMediaTypeError",
    kind: "client",
  },
  {
    code: 416,
    statusText: "Range Not Satisfiable",
    className: "RequestedRangeNotSatisfiableError",
    kind: "client",
  },
  {
    code: 417,
    statusText: "Expectation Failed",
    className: "ExpectationFailedError",
    kind: "client",
  },
  { code: 418, statusText: "I'm a teapot", className: "ImATeapotError", kind: "client" },
  {
    code: 421,
    statusText: "Misdirected Request",
    className: "MisdirectedRequestError",
    kind: "client",
  },
  {
    code: 422,
    statusText: "Unprocessable Entity",
    className: "UnprocessableEntityError",
    kind: "client",
  },
  { code: 423, statusText: "Locked", className: "LockedError", kind: "client" },
  {
    code: 424,
    statusText: "Failed Dependency",
    className: "FailedDependencyError",
    kind: "client",
  },
  { code: 425, statusText: "Too Early", className: "TooEarlyError", kind: "client" },
  { code: 426, statusText: "Upgrade Required", className: "UpgradeRequiredError", kind: "client" },
  {
    code: 428,
    statusText: "Precondition Required",
    className: "PreconditionRequiredError",
    kind: "client",
  },
  {
    code: 429,
    statusText: "Too Many Requests",
    className: "TooManyRequestsError",
    kind: "client",
  },
  {
    code: 431,
    statusText: "Request Header Fields Too Large",
    className: "RequestHeaderFieldsTooLargeError",
    kind: "client",
  },
  {
    code: 451,
    statusText: "Unavailable For Legal Reasons",
    className: "UnavailableForLegalReasonsError",
    kind: "client",
  },
  {
    code: 500,
    statusText: "Internal Server Error",
    className: "InternalServerError",
    kind: "server",
  },
  { code: 501, statusText: "Not Implemented", className: "NotImplementedError", kind: "server" },
  { code: 502, statusText: "Bad Gateway", className: "BadGatewayError", kind: "server" },
  {
    code: 503,
    statusText: "Service Unavailable",
    className: "ServiceUnavailableError",
    kind: "server",
  },
  { code: 504, statusText: "Gateway Timeout", className: "GatewayTimeoutError", kind: "server" },
  {
    code: 505,
    statusText: "HTTP Version Not Supported",
    className: "HttpVersionNotSupportedError",
    kind: "server",
  },
  {
    code: 506,
    statusText: "Variant Also Negotiates",
    className: "VariantAlsoNegotiatesError",
    kind: "server",
  },
  {
    code: 507,
    statusText: "Insufficient Storage",
    className: "InsufficientStorageError",
    kind: "server",
  },
  { code: 508, statusText: "Loop Detected", className: "LoopDetectedError", kind: "server" },
  { code: 510, statusText: "Not Extended", className: "NotExtendedError", kind: "server" },
  {
    code: 511,
    statusText: "Network Authentication Required",
    className: "NetworkAuthenticationRequiredError",
    kind: "server",
  },
];

/** Converts an `XxxError` class name to its `xxx-error` kebab-case basename (no extension). */
function classNameToBaseName(className: string): string {
  const withoutSuffix = className.slice(0, -"Error".length);
  const kebab = withoutSuffix
    // Acronym boundary: "ATeapot" -> "A-Teapot" (splits before the last of a run of capitals when followed by a lowercase letter).
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    // Normal boundary: "camelCase" -> "camel-Case".
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase();
  return `${kebab}-error`;
}

/** Import specifier for a generated error class file (no extension), relative to a given directory prefix. */
function classNameToImportSpecifier(className: string, dirPrefix = "."): string {
  return `${dirPrefix}/${classNameToBaseName(className)}`;
}

/** Filesystem filename (with `.ts` extension) for a generated error class file. */
function classNameToFileName(className: string): string {
  return `${classNameToBaseName(className)}.ts`;
}

function generateErrorClassFile(row: ErrorRow): string {
  const { code, statusText, className } = row;
  return `import { BaseHttpError } from "./base-http-error";

/** @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/${code} */
export class ${className} extends BaseHttpError {
  override readonly name = "${className}" as const;
  public readonly status = ${code} as const;
  public readonly statusText = "${statusText}" as const;
  static readonly status = ${code} as const;
  static readonly statusText = "${statusText}" as const;
}
`;
}

function generateHelpersFile(rows: ErrorRow[]): string {
  // Import order: NOT alphabetical, matches historical file order (each
  // kind's rows in the order they were first added, interleaved by
  // discovery order). We reproduce it by using the exact historical order.
  const importOrder = [
    "InternalServerError",
    "NetworkError",
    "AbortedError",
    "TimeoutError",
    "UnknownHttpError",
    "BadRequestError",
    "PaymentRequiredError",
    "UnauthorizedError",
    "ForbiddenError",
    "NotFoundError",
    "MethodNotAllowedError",
    "NotAcceptableError",
    "ProxyAuthenticationRequiredError",
    "RequestTimeoutError",
    "ConflictError",
    "GoneError",
    "LengthRequiredError",
    "PreconditionFailedError",
    "RequestTooLongError",
    "RequestUriTooLongError",
    "UnsupportedMediaTypeError",
    "RequestedRangeNotSatisfiableError",
    "ExpectationFailedError",
    "ImATeapotError",
    "MisdirectedRequestError",
    "UnprocessableEntityError",
    "LockedError",
    "FailedDependencyError",
    "TooEarlyError",
    "UpgradeRequiredError",
    "PreconditionRequiredError",
    "TooManyRequestsError",
    "RequestHeaderFieldsTooLargeError",
    "UnavailableForLegalReasonsError",
    "NotImplementedError",
    "BadGatewayError",
    "ServiceUnavailableError",
    "GatewayTimeoutError",
    "HttpVersionNotSupportedError",
    "VariantAlsoNegotiatesError",
    "InsufficientStorageError",
    "LoopDetectedError",
    "NotExtendedError",
    "NetworkAuthenticationRequiredError",
  ];

  const byName = new Map(rows.map((r) => [r.className, r]));

  const importLines = importOrder
    .map((name) => {
      if (name === "InternalServerError")
        return `import { InternalServerError } from "./internal-server-error";`;
      if (name === "NetworkError") return `import { NetworkError } from "./network-error";`;
      if (name === "AbortedError") return `import { AbortedError } from "./aborted-error";`;
      if (name === "TimeoutError") return `import { TimeoutError } from "./timeout-error";`;
      if (name === "UnknownHttpError")
        return `import { UnknownHttpError } from "./unknown-http-error";`;
      const row = byName.get(name);
      if (!row) throw new Error(`Unknown class in import order: ${name}`);
      return `import { ${row.className} } from "${classNameToImportSpecifier(row.className)}";`;
    })
    .join("\n");

  const clientErrors = rows
    .filter((r) => r.kind === "client")
    .map((r) => r.className)
    .toSorted((a, b) => a.localeCompare(b));
  const serverErrors = rows
    .filter((r) => r.kind === "server")
    .map((r) => r.className)
    .toSorted((a, b) => a.localeCompare(b));

  const httpErrorsSorted = rows.toSorted((a, b) => a.className.localeCompare(b.className));

  return `${importLines}

/** Constructor type for any HTTP error class in the library. */
export type HttpErrors = (typeof httpErrors)[number];

/** Union of all 4xx client error instances. */
export type ClientErrors =
${clientErrors.map((name) => `  | ${name}`).join("\n")};

/** Union of all 5xx server error instances. */
export type ServerErrors =
${serverErrors.map((name) => `  | ${name}`).join("\n")};

/** Union of all possible error types returned by \`typedFetch\`. */
export type TypedFetchError =
  | ClientErrors
  | ServerErrors
  | UnknownHttpError
  | NetworkError
  | AbortedError
  | TimeoutError;

/** Array of all ${rows.length} HTTP error class constructors. */
export const httpErrors = [
${httpErrorsSorted.map((r) => `  ${r.className},`).join("\n")}
] as const;
`;
}

function generateHttpStatusCodesFile(rows: ErrorRow[]): string {
  const sortedByCode = rows.toSorted((a, b) => a.code - b.code);

  const importLines = sortedByCode
    .map(
      (r) =>
        `import { ${r.className} } from "${classNameToImportSpecifier(r.className, "./errors")}";`,
    )
    .join("\n");

  const mapEntries = sortedByCode.map((r) => `  [${r.code}, ${r.className}],`).join("\n");

  return `import { HttpErrors } from "./errors/helpers";
${importLines}

/**
 * Maps HTTP status codes (400-511) to their corresponding error class constructors.
 *
 * Exposed as a \`ReadonlyMap\` — the mapping is part of the library contract
 * and must not be mutated at runtime.
 */
export const statusCodeErrorMap: ReadonlyMap<number, HttpErrors> = new Map<number, HttpErrors>([
${mapEntries}
]);
`;
}

function generateErrorsIndexFile(rows: ErrorRow[]): string {
  // Historical index.ts order: same interleaved order as helpers.ts imports,
  // then BaseHttpError, then UnknownHttpError, then the type re-export.
  const exportOrder = [
    "InternalServerError",
    "NetworkError",
    "AbortedError",
    "TimeoutError",
    "BadRequestError",
    "PaymentRequiredError",
    "UnauthorizedError",
    "ForbiddenError",
    "NotFoundError",
    "MethodNotAllowedError",
    "NotAcceptableError",
    "ProxyAuthenticationRequiredError",
    "RequestTimeoutError",
    "ConflictError",
    "GoneError",
    "LengthRequiredError",
    "PreconditionFailedError",
    "RequestTooLongError",
    "RequestUriTooLongError",
    "UnsupportedMediaTypeError",
    "RequestedRangeNotSatisfiableError",
    "ExpectationFailedError",
    "ImATeapotError",
    "MisdirectedRequestError",
    "UnprocessableEntityError",
    "LockedError",
    "FailedDependencyError",
    "TooEarlyError",
    "UpgradeRequiredError",
    "PreconditionRequiredError",
    "TooManyRequestsError",
    "RequestHeaderFieldsTooLargeError",
    "UnavailableForLegalReasonsError",
    "NotImplementedError",
    "BadGatewayError",
    "ServiceUnavailableError",
    "GatewayTimeoutError",
    "HttpVersionNotSupportedError",
    "VariantAlsoNegotiatesError",
    "InsufficientStorageError",
    "LoopDetectedError",
    "NotExtendedError",
    "NetworkAuthenticationRequiredError",
  ];

  const byName = new Map(rows.map((r) => [r.className, r]));

  const exportLines = exportOrder
    .map((name) => {
      if (name === "InternalServerError")
        return `export { InternalServerError } from "./internal-server-error";`;
      if (name === "NetworkError") return `export { NetworkError } from "./network-error";`;
      if (name === "AbortedError") return `export { AbortedError } from "./aborted-error";`;
      if (name === "TimeoutError") return `export { TimeoutError } from "./timeout-error";`;
      const row = byName.get(name);
      if (!row) throw new Error(`Unknown class in export order: ${name}`);
      return `export { ${row.className} } from "${classNameToImportSpecifier(row.className)}";`;
    })
    .join("\n");

  return `${exportLines}
export { BaseHttpError } from "./base-http-error";
export { UnknownHttpError } from "./unknown-http-error";
export type { ClientErrors, ServerErrors, HttpErrors, TypedFetchError } from "./helpers";
`;
}

function main(): void {
  const codes = new Set(ERROR_TABLE.map((r) => r.code));
  if (codes.size !== ERROR_TABLE.length) {
    throw new Error("Duplicate status code in ERROR_TABLE");
  }
  if (ERROR_TABLE.length !== 40) {
    throw new Error(`Expected 40 rows in ERROR_TABLE, found ${ERROR_TABLE.length}`);
  }

  for (const row of ERROR_TABLE) {
    const fileName = classNameToFileName(row.className);
    const filePath = path.join(ERRORS_DIR, fileName);
    writeFileSync(filePath, generateErrorClassFile(row));
  }

  writeFileSync(path.join(ERRORS_DIR, "helpers.ts"), generateHelpersFile(ERROR_TABLE));
  writeFileSync(
    path.join(ROOT, "src", "http-status-codes.ts"),
    generateHttpStatusCodesFile(ERROR_TABLE),
  );
  writeFileSync(path.join(ERRORS_DIR, "index.ts"), generateErrorsIndexFile(ERROR_TABLE));

  console.log(
    `Generated ${ERROR_TABLE.length} error classes + helpers.ts + http-status-codes.ts + errors/index.ts`,
  );
}

main();
