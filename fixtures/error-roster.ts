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
export const allErrors = [
  { Class: BadRequestError, status: 400 },
  { Class: UnauthorizedError, status: 401 },
  { Class: PaymentRequiredError, status: 402 },
  { Class: ForbiddenError, status: 403 },
  { Class: NotFoundError, status: 404 },
  { Class: MethodNotAllowedError, status: 405 },
  { Class: NotAcceptableError, status: 406 },
  { Class: ProxyAuthenticationRequiredError, status: 407 },
  { Class: RequestTimeoutError, status: 408 },
  { Class: ConflictError, status: 409 },
  { Class: GoneError, status: 410 },
  { Class: LengthRequiredError, status: 411 },
  { Class: PreconditionFailedError, status: 412 },
  { Class: RequestTooLongError, status: 413 },
  { Class: RequestUriTooLongError, status: 414 },
  { Class: UnsupportedMediaTypeError, status: 415 },
  { Class: RequestedRangeNotSatisfiableError, status: 416 },
  { Class: ExpectationFailedError, status: 417 },
  { Class: ImATeapotError, status: 418 },
  { Class: MisdirectedRequestError, status: 421 },
  { Class: UnprocessableEntityError, status: 422 },
  { Class: LockedError, status: 423 },
  { Class: FailedDependencyError, status: 424 },
  { Class: TooEarlyError, status: 425 },
  { Class: UpgradeRequiredError, status: 426 },
  { Class: PreconditionRequiredError, status: 428 },
  { Class: TooManyRequestsError, status: 429 },
  { Class: RequestHeaderFieldsTooLargeError, status: 431 },
  { Class: UnavailableForLegalReasonsError, status: 451 },
  { Class: InternalServerError, status: 500 },
  { Class: NotImplementedError, status: 501 },
  { Class: BadGatewayError, status: 502 },
  { Class: ServiceUnavailableError, status: 503 },
  { Class: GatewayTimeoutError, status: 504 },
  { Class: HttpVersionNotSupportedError, status: 505 },
  { Class: VariantAlsoNegotiatesError, status: 506 },
  { Class: InsufficientStorageError, status: 507 },
  { Class: LoopDetectedError, status: 508 },
  { Class: NotExtendedError, status: 510 },
  { Class: NetworkAuthenticationRequiredError, status: 511 },
] as const;
