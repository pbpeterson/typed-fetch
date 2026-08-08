import {
  BadGatewayError,
  BadRequestError,
  ConflictError,
  ExpectationFailedError,
  FailedDependencyError,
  ForbiddenError,
  GatewayTimeoutError,
  GoneError,
  HttpVersionNotSupportedError,
  ImATeapotError,
  InsufficientStorageError,
  InternalServerError,
  LengthRequiredError,
  LockedError,
  LoopDetectedError,
  MethodNotAllowedError,
  MisdirectedRequestError,
  NetworkAuthenticationRequiredError,
  NotAcceptableError,
  NotExtendedError,
  NotFoundError,
  NotImplementedError,
  PaymentRequiredError,
  PreconditionFailedError,
  PreconditionRequiredError,
  ProxyAuthenticationRequiredError,
  RequestedRangeNotSatisfiableError,
  RequestHeaderFieldsTooLargeError,
  RequestTimeoutError,
  RequestTooLongError,
  RequestUriTooLongError,
  ServiceUnavailableError,
  TooEarlyError,
  TooManyRequestsError,
  UnauthorizedError,
  UnavailableForLegalReasonsError,
  UnprocessableEntityError,
  UnsupportedMediaTypeError,
  UpgradeRequiredError,
  VariantAlsoNegotiatesError,
} from "../src/errors";

// ╔══════════════════════════════════════════════════════════════════════╗
// ║  DO NOT DERIVE THIS FROM src/ — IT IS A DELIBERATE SECOND SOURCE OF  ║
// ║  TRUTH.                                                              ║
// ║                                                                      ║
// ║  Every row below is hand-authored. Do NOT rewrite this table as a    ║
// ║  map/filter over `httpErrors`, `statusCodeErrorMap`, or anything     ║
// ║  else exported from src/ — doing so makes it agree with the roster   ║
// ║  by construction and silently destroys every test that depends on    ║
// ║  it. The whole point is that a hand-edit to src/ which forgets one   ║
// ║  of the registries disagrees with THIS table and turns a test red.   ║
// ║                                                                      ║
// ║  Adding a status code? Add the class to src/ AND add a row here, by  ║
// ║  hand, from the RFC — not by copying what src/ now says.             ║
// ╚══════════════════════════════════════════════════════════════════════╝
//
// Shared by "error class consistency" (error-classes.spec.ts) and "roster
// sync" (roster-sync.spec.ts) — one row per concrete HTTP error class.
//
// `statusText` is the REASON PHRASE the registering RFC states, and it is here
// because the instruction above asks for a row written from the RFC while the
// row had nowhere to put the thing the RFC actually states. Without it the
// phrase was pinned only by the per-class type assertions in
// `roster-sync.spec.ts`, which `vitest run` cannot see: a wrong-but-plausible
// phrase on a class no document names left the whole suite green and failed
// only under `tsc`. Two are deliberate exceptions to the current registry —
// 418 keeps "I'm a teapot" (RFC 2324, listed as unused by IANA) and 510 keeps
// "Not Extended" without IANA's "(OBSOLETED)" annotation. Three carry the
// CURRENT phrase under a legacy class name: 413, 416, and 422.
export const allErrors = [
  { Class: BadRequestError, status: 400, statusText: "Bad Request" },
  { Class: UnauthorizedError, status: 401, statusText: "Unauthorized" },
  { Class: PaymentRequiredError, status: 402, statusText: "Payment Required" },
  { Class: ForbiddenError, status: 403, statusText: "Forbidden" },
  { Class: NotFoundError, status: 404, statusText: "Not Found" },
  { Class: MethodNotAllowedError, status: 405, statusText: "Method Not Allowed" },
  { Class: NotAcceptableError, status: 406, statusText: "Not Acceptable" },
  {
    Class: ProxyAuthenticationRequiredError,
    status: 407,
    statusText: "Proxy Authentication Required",
  },
  { Class: RequestTimeoutError, status: 408, statusText: "Request Timeout" },
  { Class: ConflictError, status: 409, statusText: "Conflict" },
  { Class: GoneError, status: 410, statusText: "Gone" },
  { Class: LengthRequiredError, status: 411, statusText: "Length Required" },
  { Class: PreconditionFailedError, status: 412, statusText: "Precondition Failed" },
  { Class: RequestTooLongError, status: 413, statusText: "Content Too Large" },
  { Class: RequestUriTooLongError, status: 414, statusText: "URI Too Long" },
  { Class: UnsupportedMediaTypeError, status: 415, statusText: "Unsupported Media Type" },
  { Class: RequestedRangeNotSatisfiableError, status: 416, statusText: "Range Not Satisfiable" },
  { Class: ExpectationFailedError, status: 417, statusText: "Expectation Failed" },
  { Class: ImATeapotError, status: 418, statusText: "I'm a teapot" },
  { Class: MisdirectedRequestError, status: 421, statusText: "Misdirected Request" },
  { Class: UnprocessableEntityError, status: 422, statusText: "Unprocessable Content" },
  { Class: LockedError, status: 423, statusText: "Locked" },
  { Class: FailedDependencyError, status: 424, statusText: "Failed Dependency" },
  { Class: TooEarlyError, status: 425, statusText: "Too Early" },
  { Class: UpgradeRequiredError, status: 426, statusText: "Upgrade Required" },
  { Class: PreconditionRequiredError, status: 428, statusText: "Precondition Required" },
  { Class: TooManyRequestsError, status: 429, statusText: "Too Many Requests" },
  {
    Class: RequestHeaderFieldsTooLargeError,
    status: 431,
    statusText: "Request Header Fields Too Large",
  },
  {
    Class: UnavailableForLegalReasonsError,
    status: 451,
    statusText: "Unavailable For Legal Reasons",
  },
  { Class: InternalServerError, status: 500, statusText: "Internal Server Error" },
  { Class: NotImplementedError, status: 501, statusText: "Not Implemented" },
  { Class: BadGatewayError, status: 502, statusText: "Bad Gateway" },
  { Class: ServiceUnavailableError, status: 503, statusText: "Service Unavailable" },
  { Class: GatewayTimeoutError, status: 504, statusText: "Gateway Timeout" },
  { Class: HttpVersionNotSupportedError, status: 505, statusText: "HTTP Version Not Supported" },
  { Class: VariantAlsoNegotiatesError, status: 506, statusText: "Variant Also Negotiates" },
  { Class: InsufficientStorageError, status: 507, statusText: "Insufficient Storage" },
  { Class: LoopDetectedError, status: 508, statusText: "Loop Detected" },
  { Class: NotExtendedError, status: 510, statusText: "Not Extended" },
  {
    Class: NetworkAuthenticationRequiredError,
    status: 511,
    statusText: "Network Authentication Required",
  },
] as const;
