import { InternalServerError } from "./internal-server-error";
import { NetworkError } from "./network-error";
import { BadRequestError } from "./bad-request-error";
import { PaymentRequiredError } from "./payment-required-error";
import { UnauthorizedError } from "./unauthorized-error";
import { ForbiddenError } from "./forbidden-error";
import { NotFoundError } from "./not-found-error";
import { MethodNotAllowedError } from "./method-not-allowed-error";
import { NotAcceptableError } from "./not-acceptable-error";
import { ProxyAuthenticationRequiredError } from "./proxy-authentication-required-error";
import { RequestTimeoutError } from "./request-timeout-error";
import { ConflictError } from "./conflict-error";
import { GoneError } from "./gone-error";
import { LengthRequiredError } from "./length-required-error";
import { PreconditionFailedError } from "./precondition-failed-error";
import { RequestTooLongError } from "./request-too-long-error";
import { RequestUriTooLongError } from "./request-uri-too-long-error";
import { UnsupportedMediaTypeError } from "./unsupported-media-type-error";
import { RequestedRangeNotSatisfiableError } from "./requested-range-not-satisfiable-error";
import { ExpectationFailedError } from "./expectation-failed-error";
import { ImATeapotError } from "./im-a-teapot-error";
import { MisdirectedRequestError } from "./misdirected-request-error";
import { UnprocessableEntityError } from "./unprocessable-entity-error";
import { LockedError } from "./locked-error";
import { FailedDependencyError } from "./failed-dependency-error";
import { TooEarlyError } from "./too-early-error";
import { UpgradeRequiredError } from "./upgrade-required-error";
import { PreconditionRequiredError } from "./precondition-required-error";
import { TooManyRequestsError } from "./too-many-requests-error";
import { RequestHeaderFieldsTooLargeError } from "./request-header-fields-too-large-error";
import { UnavailableForLegalReasonsError } from "./unavailable-for-legal-reasons-error";
import { NotImplementedError } from "./not-implemented-error";
import { BadGatewayError } from "./bad-gateway-error";
import { ServiceUnavailableError } from "./service-unavailable-error";
import { GatewayTimeoutError } from "./gateway-timeout-error";
import { HttpVersionNotSupportedError } from "./http-version-not-supported-error";
import { VariantAlsoNegotiatesError } from "./variant-also-negotiates-error";
import { InsufficientStorageError } from "./insufficient-storage-error";
import { LoopDetectedError } from "./loop-detected-error";
import { NotExtendedError } from "./not-extended-error";
import { NetworkAuthenticationRequiredError } from "./network-authentication-required-error";

export type HttpErrors = (typeof httpErrors)[number];

export type ClientErrors =
  | BadRequestError
  | ConflictError
  | ExpectationFailedError
  | FailedDependencyError
  | ForbiddenError
  | GoneError
  | ImATeapotError
  | LengthRequiredError
  | LockedError
  | MethodNotAllowedError
  | MisdirectedRequestError
  | NotAcceptableError
  | NotFoundError
  | PaymentRequiredError
  | PreconditionFailedError
  | PreconditionRequiredError
  | ProxyAuthenticationRequiredError
  | RequestedRangeNotSatisfiableError
  | RequestHeaderFieldsTooLargeError
  | RequestTimeoutError
  | RequestTooLongError
  | RequestUriTooLongError
  | TooEarlyError
  | TooManyRequestsError
  | UnauthorizedError
  | UnavailableForLegalReasonsError
  | UnprocessableEntityError
  | UnsupportedMediaTypeError
  | UpgradeRequiredError;

export type ServerErrors =
  | BadGatewayError
  | GatewayTimeoutError
  | HttpVersionNotSupportedError
  | InsufficientStorageError
  | InternalServerError
  | LoopDetectedError
  | NetworkAuthenticationRequiredError
  | NotExtendedError
  | NotImplementedError
  | ServiceUnavailableError
  | VariantAlsoNegotiatesError;

export type TypedFetchError = HttpErrors | NetworkError;

export const httpErrors = [
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
] as const;
