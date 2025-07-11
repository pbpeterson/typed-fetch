import { HttpErrors } from "./errors/helpers";
import { BadRequestError } from "./errors/bad-request-error";
import { UnauthorizedError } from "./errors/unauthorized-error";
import { PaymentRequiredError } from "./errors/payment-required-error";
import { ForbiddenError } from "./errors/forbidden-error";
import { NotFoundError } from "./errors/not-found-error";
import { MethodNotAllowedError } from "./errors/method-not-allowed-error";
import { NotAcceptableError } from "./errors/not-acceptable-error";
import { ProxyAuthenticationRequiredError } from "./errors/proxy-authentication-required-error";
import { RequestTimeoutError } from "./errors/request-timeout-error";
import { ConflictError } from "./errors/conflict-error";
import { GoneError } from "./errors/gone-error";
import { LengthRequiredError } from "./errors/length-required-error";
import { PreconditionFailedError } from "./errors/precondition-failed-error";
import { RequestTooLongError } from "./errors/request-too-long-error";
import { RequestUriTooLongError } from "./errors/request-uri-too-long-error";
import { UnsupportedMediaTypeError } from "./errors/unsupported-media-type-error";
import { RequestedRangeNotSatisfiableError } from "./errors/requested-range-not-satisfiable-error";
import { ExpectationFailedError } from "./errors/expectation-failed-error";
import { ImATeapotError } from "./errors/im-a-teapot-error";
import { MisdirectedRequestError } from "./errors/misdirected-request-error";
import { UnprocessableEntityError } from "./errors/unprocessable-entity-error";
import { LockedError } from "./errors/locked-error";
import { FailedDependencyError } from "./errors/failed-dependency-error";
import { TooEarlyError } from "./errors/too-early-error";
import { UpgradeRequiredError } from "./errors/upgrade-required-error";
import { PreconditionRequiredError } from "./errors/precondition-required-error";
import { TooManyRequestsError } from "./errors/too-many-requests-error";
import { RequestHeaderFieldsTooLargeError } from "./errors/request-header-fields-too-large-error";
import { UnavailableForLegalReasonsError } from "./errors/unavailable-for-legal-reasons-error";
import { InternalServerError } from "./errors/internal-server-error";
import { NotImplementedError } from "./errors/not-implemented-error";
import { BadGatewayError } from "./errors/bad-gateway-error";
import { ServiceUnavailableError } from "./errors/service-unavailable-error";
import { GatewayTimeoutError } from "./errors/gateway-timeout-error";
import { HttpVersionNotSupportedError } from "./errors/http-version-not-supported-error";
import { VariantAlsoNegotiatesError } from "./errors/variant-also-negotiates-error";
import { InsufficientStorageError } from "./errors/insufficient-storage-error";
import { LoopDetectedError } from "./errors/loop-detected-error";
import { NotExtendedError } from "./errors/not-extended-error";
import { NetworkAuthenticationRequiredError } from "./errors/network-authentication-required-error";

export const statusCodeErrorMap = new Map<number, HttpErrors>([
  [400, BadRequestError],
  [401, UnauthorizedError],
  [402, PaymentRequiredError],
  [403, ForbiddenError],
  [404, NotFoundError],
  [405, MethodNotAllowedError],
  [406, NotAcceptableError],
  [407, ProxyAuthenticationRequiredError],
  [408, RequestTimeoutError],
  [409, ConflictError],
  [410, GoneError],
  [411, LengthRequiredError],
  [412, PreconditionFailedError],
  [413, RequestTooLongError],
  [414, RequestUriTooLongError],
  [415, UnsupportedMediaTypeError],
  [416, RequestedRangeNotSatisfiableError],
  [417, ExpectationFailedError],
  [418, ImATeapotError],
  [421, MisdirectedRequestError],
  [422, UnprocessableEntityError],
  [423, LockedError],
  [424, FailedDependencyError],
  [425, TooEarlyError],
  [426, UpgradeRequiredError],
  [428, PreconditionRequiredError],
  [429, TooManyRequestsError],
  [431, RequestHeaderFieldsTooLargeError],
  [451, UnavailableForLegalReasonsError],
  [500, InternalServerError],
  [501, NotImplementedError],
  [502, BadGatewayError],
  [503, ServiceUnavailableError],
  [504, GatewayTimeoutError],
  [505, HttpVersionNotSupportedError],
  [506, VariantAlsoNegotiatesError],
  [507, InsufficientStorageError],
  [508, LoopDetectedError],
  [510, NotExtendedError],
  [511, NetworkAuthenticationRequiredError],
]);
