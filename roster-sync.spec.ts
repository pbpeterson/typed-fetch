import { describe, test, expect, expectTypeOf } from "vitest";
import { statusCodeErrorMap } from "./src/http-status-codes";
import { httpErrors } from "./src/errors/helpers";
import type { HttpErrors } from "./src/errors/helpers";
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
} from "./src/errors";
import type { ClientErrors, ServerErrors } from "./src/errors";
import { allErrors } from "./fixtures/error-roster";

// ── Exported registries ──────────────────────────────────────────────

describe("httpErrors & statusCodeErrorMap", () => {
  test("httpErrors contains all 40 error classes", () => {
    expect(httpErrors).toHaveLength(allErrors.length);
  });

  test("statusCodeErrorMap contains all 40 status codes", () => {
    expect(statusCodeErrorMap.size).toBe(allErrors.length);
  });

  test("every httpErrors class maps to the correct status code", () => {
    for (const ErrorClass of httpErrors) {
      expect(statusCodeErrorMap.get(ErrorClass.status)).toBe(ErrorClass);
    }
  });
});

// ── Roster sync guardrail ────────────────────────────────────────────
// The error roster is hand-maintained across several files (per-class
// files under src/errors/, the httpErrors array, the ClientErrors/
// ServerErrors unions, and statusCodeErrorMap). Nothing at the language
// level forces those files to stay in agreement: a hand-edit can widen a
// literal or drop a class from a union in one place without the others
// noticing. These tests ARE that enforcement — the independent check that
// every one of those artifacts still agrees with the others. They are the
// safety net that makes adding a status code by hand safe (see
// CONTRIBUTING.md, "Adding a new HTTP status code").
//
// IMPORTANT — what each check actually proves (verified by deliberately
// widening NotFoundError's instance `status` field to `number` and
// confirming which of these checks fails to compile):
//
//   - Check 1 (InstanceType<HttpErrors> vs ClientErrors | ServerErrors)
//     catches ROSTER MEMBERSHIP drift only: a class added to/removed from
//     the `httpErrors` array without a matching change to the
//     ClientErrors/ServerErrors unions. It does NOT catch a single
//     already-listed class's field being widened, because both sides of
//     the comparison reference the SAME class symbol — widen the class
//     once and both the array-derived side and the hand-written union
//     side see the widened type simultaneously, so they still compare
//     equal to each other. Verified empirically: widening
//     NotFoundError.status to `number` left this check green.
//   - Check 3's `test.each` loop asserts against `Class.status` where
//     `Class: HttpErrors` — a union of all 40 constructors — so
//     `Class.status` is already the union of all 40 status literals.
//     `.not.toEqualTypeOf<number>()` on that union only fails to compile
//     if EVERY member is widened (the union collapses to plain `number`);
//     a single widened class is invisible inside the union. This loop is
//     a coarse whole-roster sanity net, not per-class coverage.
//   - The only construct that actually proves per-class literal
//     narrowness is an explicit `expectTypeOf<SpecificClass["status"]>()
//     .toEqualTypeOf<404>()` against that class's own type in isolation.
//     Verified empirically: this DOES fail to compile when
//     NotFoundError.status is widened. So full 40-class coverage below is
//     written as 40 explicit assertions, not derived from the union or
//     from test.each.

describe("roster sync", () => {
  // 1. Union <-> array exhaustiveness (compile-time). Catches a class
  // added to (or removed from) the `httpErrors` array without a matching
  // update to `ClientErrors`/`ServerErrors` (see caveat above: this does
  // NOT catch field-level widening on an already-listed class).
  test("HttpErrors instance union matches ClientErrors | ServerErrors", () => {
    expectTypeOf<InstanceType<HttpErrors>>().toEqualTypeOf<ClientErrors | ServerErrors>();
  });

  // 2. Cardinality + map<->array agreement (runtime). Guards against a
  // class present in one artifact but not the other, or a status code
  // whose map entry disagrees with the class's own static `status`.
  test("roster cardinality is exactly 40 and map <-> array agree", () => {
    expect(httpErrors.length).toBe(allErrors.length);
    expect(statusCodeErrorMap.size).toBe(allErrors.length);

    const arrayStatuses = new Set(httpErrors.map((C) => C.status));
    const mapStatuses = new Set(statusCodeErrorMap.keys());
    expect(arrayStatuses).toEqual(mapStatuses);

    for (const [code, C] of statusCodeErrorMap) {
      expect(C.status).toBe(code);
    }
  });

  // 3. Coarse whole-roster literal sanity net (compile-time + runtime).
  // See the block comment above: this only fails if EVERY class's status
  // (or statusText) is widened at once, since `Class` is typed as the
  // union `HttpErrors` inside test.each. Kept as a cheap net plus a
  // runtime cross-check against the independently hand-authored
  // `allErrors` table, but it is NOT the primary guardrail — see check 4.
  test.each(allErrors)(
    "$Class.name ($status): static status/statusText are not fully-widened and match the table",
    ({ Class, status }) => {
      expectTypeOf(Class.status).not.toEqualTypeOf<number>();
      expectTypeOf(Class.statusText).not.toEqualTypeOf<string>();
      expect(Number.isInteger(Class.status)).toBe(true);
      expect(Class.status).toBe(status);
    },
  );

  // 4. Per-class literal status/statusText for ALL 40 classes
  // (compile-time). This is the actual guardrail against a single class's
  // literal being widened: each assertion below instantiates
  // `expectTypeOf` against ONE specific, non-union class's own type, so
  // widening exactly that class's `status`/`statusText` field to
  // `number`/`string` fails to compile right here, independent of the
  // other 39 classes and independent of checks 1-3 above.
  test("every class's status and statusText are their own literal type, not number/string", () => {
    expectTypeOf<BadRequestError["status"]>().toEqualTypeOf<400>();
    expectTypeOf<BadRequestError["statusText"]>().toEqualTypeOf<"Bad Request">();
    expectTypeOf<UnauthorizedError["status"]>().toEqualTypeOf<401>();
    expectTypeOf<UnauthorizedError["statusText"]>().toEqualTypeOf<"Unauthorized">();
    expectTypeOf<PaymentRequiredError["status"]>().toEqualTypeOf<402>();
    expectTypeOf<PaymentRequiredError["statusText"]>().toEqualTypeOf<"Payment Required">();
    expectTypeOf<ForbiddenError["status"]>().toEqualTypeOf<403>();
    expectTypeOf<ForbiddenError["statusText"]>().toEqualTypeOf<"Forbidden">();
    expectTypeOf<NotFoundError["status"]>().toEqualTypeOf<404>();
    expectTypeOf<NotFoundError["statusText"]>().toEqualTypeOf<"Not Found">();
    expectTypeOf<MethodNotAllowedError["status"]>().toEqualTypeOf<405>();
    expectTypeOf<MethodNotAllowedError["statusText"]>().toEqualTypeOf<"Method Not Allowed">();
    expectTypeOf<NotAcceptableError["status"]>().toEqualTypeOf<406>();
    expectTypeOf<NotAcceptableError["statusText"]>().toEqualTypeOf<"Not Acceptable">();
    expectTypeOf<ProxyAuthenticationRequiredError["status"]>().toEqualTypeOf<407>();
    expectTypeOf<
      ProxyAuthenticationRequiredError["statusText"]
    >().toEqualTypeOf<"Proxy Authentication Required">();
    expectTypeOf<RequestTimeoutError["status"]>().toEqualTypeOf<408>();
    expectTypeOf<RequestTimeoutError["statusText"]>().toEqualTypeOf<"Request Timeout">();
    expectTypeOf<ConflictError["status"]>().toEqualTypeOf<409>();
    expectTypeOf<ConflictError["statusText"]>().toEqualTypeOf<"Conflict">();
    expectTypeOf<GoneError["status"]>().toEqualTypeOf<410>();
    expectTypeOf<GoneError["statusText"]>().toEqualTypeOf<"Gone">();
    expectTypeOf<LengthRequiredError["status"]>().toEqualTypeOf<411>();
    expectTypeOf<LengthRequiredError["statusText"]>().toEqualTypeOf<"Length Required">();
    expectTypeOf<PreconditionFailedError["status"]>().toEqualTypeOf<412>();
    expectTypeOf<PreconditionFailedError["statusText"]>().toEqualTypeOf<"Precondition Failed">();
    expectTypeOf<RequestTooLongError["status"]>().toEqualTypeOf<413>();
    expectTypeOf<RequestTooLongError["statusText"]>().toEqualTypeOf<"Content Too Large">();
    expectTypeOf<RequestUriTooLongError["status"]>().toEqualTypeOf<414>();
    expectTypeOf<RequestUriTooLongError["statusText"]>().toEqualTypeOf<"URI Too Long">();
    expectTypeOf<UnsupportedMediaTypeError["status"]>().toEqualTypeOf<415>();
    expectTypeOf<
      UnsupportedMediaTypeError["statusText"]
    >().toEqualTypeOf<"Unsupported Media Type">();
    expectTypeOf<RequestedRangeNotSatisfiableError["status"]>().toEqualTypeOf<416>();
    expectTypeOf<
      RequestedRangeNotSatisfiableError["statusText"]
    >().toEqualTypeOf<"Range Not Satisfiable">();
    expectTypeOf<ExpectationFailedError["status"]>().toEqualTypeOf<417>();
    expectTypeOf<ExpectationFailedError["statusText"]>().toEqualTypeOf<"Expectation Failed">();
    expectTypeOf<ImATeapotError["status"]>().toEqualTypeOf<418>();
    expectTypeOf<ImATeapotError["statusText"]>().toEqualTypeOf<"I'm a teapot">();
    expectTypeOf<MisdirectedRequestError["status"]>().toEqualTypeOf<421>();
    expectTypeOf<MisdirectedRequestError["statusText"]>().toEqualTypeOf<"Misdirected Request">();
    expectTypeOf<UnprocessableEntityError["status"]>().toEqualTypeOf<422>();
    expectTypeOf<UnprocessableEntityError["statusText"]>().toEqualTypeOf<"Unprocessable Content">();
    expectTypeOf<LockedError["status"]>().toEqualTypeOf<423>();
    expectTypeOf<LockedError["statusText"]>().toEqualTypeOf<"Locked">();
    expectTypeOf<FailedDependencyError["status"]>().toEqualTypeOf<424>();
    expectTypeOf<FailedDependencyError["statusText"]>().toEqualTypeOf<"Failed Dependency">();
    expectTypeOf<TooEarlyError["status"]>().toEqualTypeOf<425>();
    expectTypeOf<TooEarlyError["statusText"]>().toEqualTypeOf<"Too Early">();
    expectTypeOf<UpgradeRequiredError["status"]>().toEqualTypeOf<426>();
    expectTypeOf<UpgradeRequiredError["statusText"]>().toEqualTypeOf<"Upgrade Required">();
    expectTypeOf<PreconditionRequiredError["status"]>().toEqualTypeOf<428>();
    expectTypeOf<
      PreconditionRequiredError["statusText"]
    >().toEqualTypeOf<"Precondition Required">();
    expectTypeOf<TooManyRequestsError["status"]>().toEqualTypeOf<429>();
    expectTypeOf<TooManyRequestsError["statusText"]>().toEqualTypeOf<"Too Many Requests">();
    expectTypeOf<RequestHeaderFieldsTooLargeError["status"]>().toEqualTypeOf<431>();
    expectTypeOf<
      RequestHeaderFieldsTooLargeError["statusText"]
    >().toEqualTypeOf<"Request Header Fields Too Large">();
    expectTypeOf<UnavailableForLegalReasonsError["status"]>().toEqualTypeOf<451>();
    expectTypeOf<
      UnavailableForLegalReasonsError["statusText"]
    >().toEqualTypeOf<"Unavailable For Legal Reasons">();
    expectTypeOf<InternalServerError["status"]>().toEqualTypeOf<500>();
    expectTypeOf<InternalServerError["statusText"]>().toEqualTypeOf<"Internal Server Error">();
    expectTypeOf<NotImplementedError["status"]>().toEqualTypeOf<501>();
    expectTypeOf<NotImplementedError["statusText"]>().toEqualTypeOf<"Not Implemented">();
    expectTypeOf<BadGatewayError["status"]>().toEqualTypeOf<502>();
    expectTypeOf<BadGatewayError["statusText"]>().toEqualTypeOf<"Bad Gateway">();
    expectTypeOf<ServiceUnavailableError["status"]>().toEqualTypeOf<503>();
    expectTypeOf<ServiceUnavailableError["statusText"]>().toEqualTypeOf<"Service Unavailable">();
    expectTypeOf<GatewayTimeoutError["status"]>().toEqualTypeOf<504>();
    expectTypeOf<GatewayTimeoutError["statusText"]>().toEqualTypeOf<"Gateway Timeout">();
    expectTypeOf<HttpVersionNotSupportedError["status"]>().toEqualTypeOf<505>();
    expectTypeOf<
      HttpVersionNotSupportedError["statusText"]
    >().toEqualTypeOf<"HTTP Version Not Supported">();
    expectTypeOf<VariantAlsoNegotiatesError["status"]>().toEqualTypeOf<506>();
    expectTypeOf<
      VariantAlsoNegotiatesError["statusText"]
    >().toEqualTypeOf<"Variant Also Negotiates">();
    expectTypeOf<InsufficientStorageError["status"]>().toEqualTypeOf<507>();
    expectTypeOf<InsufficientStorageError["statusText"]>().toEqualTypeOf<"Insufficient Storage">();
    expectTypeOf<LoopDetectedError["status"]>().toEqualTypeOf<508>();
    expectTypeOf<LoopDetectedError["statusText"]>().toEqualTypeOf<"Loop Detected">();
    expectTypeOf<NotExtendedError["status"]>().toEqualTypeOf<510>();
    expectTypeOf<NotExtendedError["statusText"]>().toEqualTypeOf<"Not Extended">();
    expectTypeOf<NetworkAuthenticationRequiredError["status"]>().toEqualTypeOf<511>();
    expectTypeOf<
      NetworkAuthenticationRequiredError["statusText"]
    >().toEqualTypeOf<"Network Authentication Required">();
  });
});
