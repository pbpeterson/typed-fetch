import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { typedFetch } from "./src/index";
import {
  BadGatewayError,
  BadRequestError,
  ConflictError,
  ForbiddenError,
  GatewayTimeoutError,
  GoneError,
  HttpVersionNotSupportedError,
  ImATeapotError,
  InsufficientStorageError,
  InternalServerError,
  MethodNotAllowedError,
  NetworkAuthenticationRequiredError,
  NotAcceptableError,
  NotFoundError,
  NotImplementedError,
  PaymentRequiredError,
  RequestTimeoutError,
  ServiceUnavailableError,
  TooManyRequestsError,
  UnauthorizedError,
  UnavailableForLegalReasonsError,
  UnprocessableEntityError,
  UnsupportedMediaTypeError,
  UpgradeRequiredError,
} from "./src/errors";

// Mock fetch for testing
const mockFetch = vi.fn();

// Status code constants
const StatusCodes = {
  OK: 200,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  PAYMENT_REQUIRED: 402,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  NOT_ACCEPTABLE: 406,
  REQUEST_TIMEOUT: 408,
  CONFLICT: 409,
  GONE: 410,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  NOT_IMPLEMENTED: 501,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
  HTTP_VERSION_NOT_SUPPORTED: 505,
  INSUFFICIENT_STORAGE: 507,
  NETWORK_AUTHENTICATION_REQUIRED: 511,
  UNSUPPORTED_MEDIA_TYPE: 415,
  IM_A_TEAPOT: 418,
  UPGRADE_REQUIRED: 426,
  UNAVAILABLE_FOR_LEGAL_REASONS: 451,
};

function getStatusText(status: number): string {
  const statusMap: Record<number, string> = {
    200: "OK",
    400: "Bad Request",
    401: "Unauthorized",
    402: "Payment Required",
    403: "Forbidden",
    404: "Not Found",
    405: "Method Not Allowed",
    406: "Not Acceptable",
    408: "Request Timeout",
    409: "Conflict",
    410: "Gone",
    415: "Unsupported Media Type",
    418: "I'm a teapot",
    422: "Unprocessable Entity",
    426: "Upgrade Required",
    429: "Too Many Requests",
    451: "Unavailable For Legal Reasons",
    500: "Internal Server Error",
    501: "Not Implemented",
    502: "Bad Gateway",
    503: "Service Unavailable",
    504: "Gateway Timeout",
    505: "HTTP Version Not Supported",
    507: "Insufficient Storage",
    511: "Network Authentication Required",
  };
  return statusMap[status] || "Unknown";
}

function createMockResponse(
  status: number,
  ok: boolean = false,
  headers: Record<string, string> = {},
  jsonData: any = { success: true }
): Response {
  return {
    ok,
    status,
    statusText: getStatusText(status),
    headers: new Headers(headers),
    json: vi.fn().mockResolvedValue(jsonData),
    text: vi.fn().mockResolvedValue("response text"),
    blob: vi.fn().mockResolvedValue(new Blob()),
    arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
    formData: vi.fn().mockResolvedValue(new FormData()),
    clone: vi.fn().mockReturnThis(),
    body: null,
    bodyUsed: false,
    redirected: false,
    type: "basic",
    url: "https://api.example.com/users",
    bytes: vi.fn().mockResolvedValue(new Uint8Array()),
  } as unknown as Response;
}

beforeEach(() => {
  global.fetch = mockFetch;
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("typedFetch", () => {
  test("should return data for successful response", async () => {
    const mockResponse = createMockResponse(StatusCodes.OK, true);
    mockFetch.mockResolvedValue(mockResponse);

    const result = await typedFetch("https://api.example.com/users", {});

    expect(result.error).toBe(null);
    expect(result.response).not.toBe(null);
    expect(result.response?.status).toBe(StatusCodes.OK);
  });

  test("should handle BadRequestError (400)", async () => {
    const mockResponse = createMockResponse(StatusCodes.BAD_REQUEST, false);
    mockFetch.mockResolvedValue(mockResponse);

    const result = await typedFetch<unknown, BadRequestError>(
      "https://api.example.com/users",
      {}
    );

    expect(result.response).toBe(null);
    expect(result.error).not.toBe(null);

    if (result.error && result.error instanceof BadRequestError) {
      expect(result.error.status).toBe(BadRequestError.status);
      expect(result.error.statusText).toBe(BadRequestError.statusText);
      expect(result.error.constructor.name).toBe("BadRequestError");
    }
  });

  test("should handle UnauthorizedError (401)", async () => {
    const mockResponse = createMockResponse(StatusCodes.UNAUTHORIZED, false);
    mockFetch.mockResolvedValue(mockResponse);

    const result = await typedFetch<unknown, UnauthorizedError>(
      "https://api.example.com/users",
      {}
    );

    expect(result.response).toBe(null);
    expect(result.error).not.toBe(null);

    if (result.error && result.error instanceof UnauthorizedError) {
      expect(result.error.status).toBe(UnauthorizedError.status);
      expect(result.error.statusText).toBe(UnauthorizedError.statusText);
      expect(result.error.constructor.name).toBe("UnauthorizedError");
    }
  });

  test("should handle ForbiddenError (403)", async () => {
    const mockResponse = createMockResponse(StatusCodes.FORBIDDEN, false);
    mockFetch.mockResolvedValue(mockResponse);

    const result = await typedFetch<unknown, ForbiddenError>(
      "https://api.example.com/users",
      {}
    );

    expect(result.response).toBe(null);
    expect(result.error).not.toBe(null);

    if (result.error && result.error instanceof ForbiddenError) {
      expect(result.error.status).toBe(ForbiddenError.status);
      expect(result.error.statusText).toBe(ForbiddenError.statusText);
      expect(result.error.constructor.name).toBe("ForbiddenError");
    }
  });

  test("should handle NotFoundError (404)", async () => {
    const mockResponse = createMockResponse(StatusCodes.NOT_FOUND, false);
    mockFetch.mockResolvedValue(mockResponse);

    const result = await typedFetch<unknown, NotFoundError>(
      "https://api.example.com/users",
      {}
    );

    expect(result.response).toBe(null);
    expect(result.error).not.toBe(null);

    if (result.error && result.error instanceof NotFoundError) {
      expect(result.error.status).toBe(NotFoundError.status);
      expect(result.error.statusText).toBe(NotFoundError.statusText);
      expect(result.error.constructor.name).toBe("NotFoundError");
    }
  });

  test("should handle MethodNotAllowedError (405)", async () => {
    const mockResponse = createMockResponse(
      StatusCodes.METHOD_NOT_ALLOWED,
      false
    );
    mockFetch.mockResolvedValue(mockResponse);

    const result = await typedFetch<unknown, MethodNotAllowedError>(
      "https://api.example.com/users",
      {}
    );

    expect(result.response).toBe(null);
    expect(result.error).not.toBe(null);

    if (result.error && result.error instanceof MethodNotAllowedError) {
      expect(result.error.status).toBe(MethodNotAllowedError.status);
      expect(result.error.statusText).toBe(MethodNotAllowedError.statusText);
      expect(result.error.constructor.name).toBe("MethodNotAllowedError");
    }
  });

  test("should handle ConflictError (409)", async () => {
    const mockResponse = createMockResponse(StatusCodes.CONFLICT, false);
    mockFetch.mockResolvedValue(mockResponse);

    const result = await typedFetch<unknown, ConflictError>(
      "https://api.example.com/users",
      {}
    );

    expect(result.response).toBe(null);
    expect(result.error).not.toBe(null);

    if (result.error && result.error instanceof ConflictError) {
      expect(result.error.status).toBe(ConflictError.status);
      expect(result.error.statusText).toBe(ConflictError.statusText);
      expect(result.error.constructor.name).toBe("ConflictError");
    }
  });

  test("should handle UnprocessableEntityError (422)", async () => {
    const mockResponse = createMockResponse(
      StatusCodes.UNPROCESSABLE_ENTITY,
      false
    );
    mockFetch.mockResolvedValue(mockResponse);

    const result = await typedFetch<unknown, UnprocessableEntityError>(
      "https://api.example.com/users",
      {}
    );

    expect(result.response).toBe(null);
    expect(result.error).not.toBe(null);

    if (result.error && result.error instanceof UnprocessableEntityError) {
      expect(result.error.status).toBe(UnprocessableEntityError.status);
      expect(result.error.statusText).toBe(UnprocessableEntityError.statusText);
      expect(result.error.constructor.name).toBe("UnprocessableEntityError");
    }
  });

  test("should handle TooManyRequestsError (429)", async () => {
    const mockResponse = createMockResponse(
      StatusCodes.TOO_MANY_REQUESTS,
      false
    );
    mockFetch.mockResolvedValue(mockResponse);

    const result = await typedFetch<unknown, TooManyRequestsError>(
      "https://api.example.com/users",
      {}
    );

    expect(result.response).toBe(null);
    expect(result.error).not.toBe(null);

    if (result.error && result.error instanceof TooManyRequestsError) {
      expect(result.error.status).toBe(TooManyRequestsError.status);
      expect(result.error.statusText).toBe(TooManyRequestsError.statusText);
      expect(result.error.constructor.name).toBe("TooManyRequestsError");
    }
  });

  test("should handle InternalServerError (500)", async () => {
    const mockResponse = createMockResponse(
      StatusCodes.INTERNAL_SERVER_ERROR,
      false
    );
    mockFetch.mockResolvedValue(mockResponse);

    const result = await typedFetch<unknown, InternalServerError>(
      "https://api.example.com/users",
      {}
    );

    expect(result.response).toBe(null);
    expect(result.error).not.toBe(null);

    if (result.error && result.error instanceof InternalServerError) {
      expect(result.error.status).toBe(InternalServerError.status);
      expect(result.error.statusText).toBe(InternalServerError.statusText);
      expect(result.error.constructor.name).toBe("InternalServerError");
    }
  });

  test("should handle NotImplementedError (501)", async () => {
    const mockResponse = createMockResponse(StatusCodes.NOT_IMPLEMENTED, false);
    mockFetch.mockResolvedValue(mockResponse);

    const result = await typedFetch<unknown, NotImplementedError>(
      "https://api.example.com/users",
      {}
    );

    expect(result.response).toBe(null);
    expect(result.error).not.toBe(null);

    if (result.error && result.error instanceof NotImplementedError) {
      expect(result.error.status).toBe(NotImplementedError.status);
      expect(result.error.statusText).toBe(NotImplementedError.statusText);
      expect(result.error.constructor.name).toBe("NotImplementedError");
    }
  });

  test("should handle BadGatewayError (502)", async () => {
    const mockResponse = createMockResponse(StatusCodes.BAD_GATEWAY, false);
    mockFetch.mockResolvedValue(mockResponse);

    const result = await typedFetch<unknown, BadGatewayError>(
      "https://api.example.com/users",
      {}
    );

    expect(result.response).toBe(null);
    expect(result.error).not.toBe(null);

    if (result.error && result.error instanceof BadGatewayError) {
      expect(result.error.status).toBe(BadGatewayError.status);
      expect(result.error.statusText).toBe(BadGatewayError.statusText);
      expect(result.error.constructor.name).toBe("BadGatewayError");
    }
  });

  test("should handle ServiceUnavailableError (503)", async () => {
    const mockResponse = createMockResponse(
      StatusCodes.SERVICE_UNAVAILABLE,
      false
    );
    mockFetch.mockResolvedValue(mockResponse);

    const result = await typedFetch<unknown, ServiceUnavailableError>(
      "https://api.example.com/users",
      {}
    );

    expect(result.response).toBe(null);
    expect(result.error).not.toBe(null);

    if (result.error && result.error instanceof ServiceUnavailableError) {
      expect(result.error.status).toBe(ServiceUnavailableError.status);
      expect(result.error.statusText).toBe(ServiceUnavailableError.statusText);
      expect(result.error.constructor.name).toBe("ServiceUnavailableError");
    }
  });

  test("should handle GatewayTimeoutError (504)", async () => {
    const mockResponse = createMockResponse(StatusCodes.GATEWAY_TIMEOUT, false);
    mockFetch.mockResolvedValue(mockResponse);

    const result = await typedFetch<unknown, GatewayTimeoutError>(
      "https://api.example.com/users",
      {}
    );

    expect(result.response).toBe(null);
    expect(result.error).not.toBe(null);

    if (result.error && result.error instanceof GatewayTimeoutError) {
      expect(result.error.status).toBe(GatewayTimeoutError.status);
      expect(result.error.statusText).toBe(GatewayTimeoutError.statusText);
      expect(result.error.constructor.name).toBe("GatewayTimeoutError");
    }
  });

  test("should handle network errors", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));

    const result = await typedFetch("https://api.example.com/users", {});

    expect(result.response).toBe(null);
    expect(result.error).not.toBe(null);

    if (result.error) {
      expect(result.error.constructor.name).toBe("NetworkError");
      expect(result.error.message).toBe("Network error");
    }
  });

  test("should handle TypeError network errors", async () => {
    mockFetch.mockRejectedValue(new TypeError("Failed to fetch"));

    const result = await typedFetch("https://api.example.com/users", {});

    expect(result.response).toBe(null);
    expect(result.error).not.toBe(null);

    if (result.error) {
      expect(result.error.constructor.name).toBe("NetworkError");
      expect(result.error.message).toBe("Failed to fetch");
    }
  });

  test("should handle unknown errors as NetworkError", async () => {
    mockFetch.mockRejectedValue("Unknown error");

    const result = await typedFetch("https://api.example.com/users", {});

    expect(result.response).toBe(null);
    expect(result.error).not.toBe(null);

    if (result.error) {
      expect(result.error.constructor.name).toBe("NetworkError");
      expect(result.error.message).toBe("Unknown error");
    }
  });

  test("should allow calling json() on HTTP error responses", async () => {
    const errorData = { message: "Validation failed", field: "email" };
    const mockResponse = createMockResponse(
      StatusCodes.BAD_REQUEST,
      false,
      {},
      errorData
    );
    mockFetch.mockResolvedValue(mockResponse);

    const result = await typedFetch("https://api.example.com/users", {});

    expect(result.response).toBe(null);
    expect(result.error).not.toBe(null);

    if (result.error && "json" in result.error) {
      const jsonResult = await result.error.json();
      expect(jsonResult).toEqual(errorData);
    }
  });

  test("should allow calling json() on server error responses", async () => {
    const errorData = { error: "Internal server error", code: "E500" };
    const mockResponse = createMockResponse(
      StatusCodes.INTERNAL_SERVER_ERROR,
      false,
      {},
      errorData
    );
    mockFetch.mockResolvedValue(mockResponse);

    const result = await typedFetch("https://api.example.com/users", {});

    expect(result.response).toBe(null);
    expect(result.error).not.toBe(null);

    if (result.error && "json" in result.error) {
      const jsonResult = await result.error.json();
      expect(jsonResult).toEqual(errorData);
    }
  });

  test("should support specific HTTP error types", async () => {
    const mockResponse = createMockResponse(StatusCodes.BAD_REQUEST, false);
    mockFetch.mockResolvedValue(mockResponse);

    // When using a specific HTTP error type, the error should be constrained to that type
    const result = await typedFetch<any, BadRequestError>(
      "https://api.example.com/users",
      {}
    );

    expect(result.response).toBe(null);
    expect(result.error).not.toBe(null);

    if (result.error && result.error instanceof BadRequestError) {
      expect(result.error.status).toBe(BadRequestError.status);
      expect(result.error.constructor.name).toBe("BadRequestError");
      // TypeScript now knows the error is specifically a BadRequestError or NetworkError
    }
  });

  test("should default to TypedFetchError when no error type provided", async () => {
    const mockResponse = createMockResponse(StatusCodes.BAD_REQUEST, false);
    mockFetch.mockResolvedValue(mockResponse);

    // When no second generic is provided, error should be IntelligentFetchError
    const result = await typedFetch<any>("https://api.example.com/users", {});

    expect(result.response).toBe(null);
    expect(result.error).not.toBe(null);

    if (result.error && result.error instanceof BadRequestError) {
      expect(result.error.status).toBe(BadRequestError.status);
      expect(result.error.constructor.name).toBe("BadRequestError");
    }
  });

  test("should work with optional RequestInit parameter", async () => {
    const mockResponse = createMockResponse(StatusCodes.OK, true);
    mockFetch.mockResolvedValue(mockResponse);

    // Should work without passing the second parameter
    const result = await typedFetch<any>("https://api.example.com/users");

    expect(result.error).toBe(null);
    expect(result.response).not.toBe(null);
    expect(result.response?.status).toBe(StatusCodes.OK);

    // Verify that fetch was called with an empty object as options
    expect(mockFetch).toHaveBeenCalledWith("https://api.example.com/users", {});
  });

  // Tests for new HTTP status codes
  test("should handle PaymentRequiredError (402)", async () => {
    const mockResponse = createMockResponse(
      StatusCodes.PAYMENT_REQUIRED,
      false
    );
    mockFetch.mockResolvedValue(mockResponse);

    const result = await typedFetch<unknown, PaymentRequiredError>(
      "https://api.example.com/users",
      {}
    );

    expect(result.response).toBe(null);
    expect(result.error).not.toBe(null);

    if (result.error && result.error instanceof PaymentRequiredError) {
      expect(result.error.status).toBe(PaymentRequiredError.status);
      expect(result.error.statusText).toBe(PaymentRequiredError.statusText);
      expect(result.error.constructor.name).toBe("PaymentRequiredError");
    }
  });

  test("should handle NotAcceptableError (406)", async () => {
    const mockResponse = createMockResponse(StatusCodes.NOT_ACCEPTABLE, false);
    mockFetch.mockResolvedValue(mockResponse);

    const result = await typedFetch<unknown, NotAcceptableError>(
      "https://api.example.com/users",
      {}
    );

    expect(result.response).toBe(null);
    expect(result.error).not.toBe(null);

    if (result.error && result.error instanceof NotAcceptableError) {
      expect(result.error.status).toBe(NotAcceptableError.status);
      expect(result.error.statusText).toBe(NotAcceptableError.statusText);
      expect(result.error.constructor.name).toBe("NotAcceptableError");
    }
  });

  test("should handle RequestTimeoutError (408)", async () => {
    const mockResponse = createMockResponse(StatusCodes.REQUEST_TIMEOUT, false);
    mockFetch.mockResolvedValue(mockResponse);

    const result = await typedFetch<unknown, RequestTimeoutError>(
      "https://api.example.com/users",
      {}
    );

    expect(result.response).toBe(null);
    expect(result.error).not.toBe(null);

    if (result.error && result.error instanceof RequestTimeoutError) {
      expect(result.error.status).toBe(RequestTimeoutError.status);
      expect(result.error.statusText).toBe(RequestTimeoutError.statusText);
      expect(result.error.constructor.name).toBe("RequestTimeoutError");
    }
  });

  test("should handle GoneError (410)", async () => {
    const mockResponse = createMockResponse(StatusCodes.GONE, false);
    mockFetch.mockResolvedValue(mockResponse);

    const result = await typedFetch<unknown, GoneError>(
      "https://api.example.com/users",
      {}
    );

    expect(result.response).toBe(null);
    expect(result.error).not.toBe(null);

    if (result.error && result.error instanceof GoneError) {
      expect(result.error.status).toBe(GoneError.status);
      expect(result.error.statusText).toBe(GoneError.statusText);
      expect(result.error.constructor.name).toBe("GoneError");
    }
  });

  test("should handle UnsupportedMediaTypeError (415)", async () => {
    const mockResponse = createMockResponse(
      StatusCodes.UNSUPPORTED_MEDIA_TYPE,
      false
    );
    mockFetch.mockResolvedValue(mockResponse);

    const result = await typedFetch<unknown, UnsupportedMediaTypeError>(
      "https://api.example.com/users",
      {}
    );

    expect(result.response).toBe(null);
    expect(result.error).not.toBe(null);

    if (result.error && result.error instanceof UnsupportedMediaTypeError) {
      expect(result.error.status).toBe(UnsupportedMediaTypeError.status);
      expect(result.error.statusText).toBe(
        UnsupportedMediaTypeError.statusText
      );
      expect(result.error.constructor.name).toBe("UnsupportedMediaTypeError");
    }
  });

  test("should handle ImATeapotError (418)", async () => {
    const mockResponse = createMockResponse(StatusCodes.IM_A_TEAPOT, false);
    mockFetch.mockResolvedValue(mockResponse);

    const result = await typedFetch<unknown, ImATeapotError>(
      "https://api.example.com/users",
      {}
    );

    expect(result.response).toBe(null);
    expect(result.error).not.toBe(null);

    if (result.error && result.error instanceof ImATeapotError) {
      expect(result.error.status).toBe(ImATeapotError.status);
      expect(result.error.statusText).toBe(ImATeapotError.statusText);
      expect(result.error.constructor.name).toBe("ImATeapotError");
    }
  });

  test("should handle UpgradeRequiredError (426)", async () => {
    const mockResponse = createMockResponse(
      StatusCodes.UPGRADE_REQUIRED,
      false
    );
    mockFetch.mockResolvedValue(mockResponse);

    const result = await typedFetch<unknown, UpgradeRequiredError>(
      "https://api.example.com/users",
      {}
    );

    expect(result.response).toBe(null);
    expect(result.error).not.toBe(null);

    if (result.error && result.error instanceof UpgradeRequiredError) {
      expect(result.error.status).toBe(UpgradeRequiredError.status);
      expect(result.error.statusText).toBe(UpgradeRequiredError.statusText);
      expect(result.error.constructor.name).toBe("UpgradeRequiredError");
    }
  });

  test("should handle UnavailableForLegalReasonsError (451)", async () => {
    const mockResponse = createMockResponse(
      StatusCodes.UNAVAILABLE_FOR_LEGAL_REASONS,
      false
    );
    mockFetch.mockResolvedValue(mockResponse);

    const result = await typedFetch<unknown, UnavailableForLegalReasonsError>(
      "https://api.example.com/users",
      {}
    );

    expect(result.response).toBe(null);
    expect(result.error).not.toBe(null);

    if (
      result.error &&
      result.error instanceof UnavailableForLegalReasonsError
    ) {
      expect(result.error.status).toBe(UnavailableForLegalReasonsError.status);
      expect(result.error.constructor.name).toBe(
        "UnavailableForLegalReasonsError"
      );
    }
  });

  test("should handle HttpVersionNotSupportedError (505)", async () => {
    const mockResponse = createMockResponse(
      StatusCodes.HTTP_VERSION_NOT_SUPPORTED,
      false
    );
    mockFetch.mockResolvedValue(mockResponse);

    const result = await typedFetch<unknown, HttpVersionNotSupportedError>(
      "https://api.example.com/users",
      {}
    );

    expect(result.response).toBe(null);
    expect(result.error).not.toBe(null);

    if (result.error && result.error instanceof HttpVersionNotSupportedError) {
      expect(result.error.status).toBe(HttpVersionNotSupportedError.status);
      expect(result.error.statusText).toBe(
        HttpVersionNotSupportedError.statusText
      );
      expect(result.error.constructor.name).toBe(
        "HttpVersionNotSupportedError"
      );
    }
  });

  test("should handle InsufficientStorageError (507)", async () => {
    const mockResponse = createMockResponse(
      StatusCodes.INSUFFICIENT_STORAGE,
      false
    );
    mockFetch.mockResolvedValue(mockResponse);

    const result = await typedFetch<unknown, InsufficientStorageError>(
      "https://api.example.com/users",
      {}
    );

    expect(result.response).toBe(null);
    expect(result.error).not.toBe(null);

    if (result.error && result.error instanceof InsufficientStorageError) {
      expect(result.error.status).toBe(InsufficientStorageError.status);
      expect(result.error.statusText).toBe(InsufficientStorageError.statusText);
      expect(result.error.constructor.name).toBe("InsufficientStorageError");
    }
  });

  test("should handle NetworkAuthenticationRequiredError (511)", async () => {
    const mockResponse = createMockResponse(
      StatusCodes.NETWORK_AUTHENTICATION_REQUIRED,
      false
    );
    mockFetch.mockResolvedValue(mockResponse);

    const result = await typedFetch<
      unknown,
      NetworkAuthenticationRequiredError
    >("https://api.example.com/users", {});

    expect(result.response).toBe(null);
    expect(result.error).not.toBe(null);

    if (
      result.error &&
      result.error instanceof NetworkAuthenticationRequiredError
    ) {
      expect(result.error.status).toBe(
        NetworkAuthenticationRequiredError.status
      );
      expect(result.error.statusText).toBe(
        NetworkAuthenticationRequiredError.statusText
      );
      expect(result.error.constructor.name).toBe(
        "NetworkAuthenticationRequiredError"
      );
    }
  });

  // Tests for clone() method
  test("should be able to clone HTTP error responses", async () => {
    const errorData = { message: "Bad request", field: "email" };
    const mockResponse = createMockResponse(
      StatusCodes.BAD_REQUEST,
      false,
      {},
      errorData
    );
    mockFetch.mockResolvedValue(mockResponse);

    const result = await typedFetch<unknown, InternalServerError>(
      "https://api.example.com/users",
      {}
    );

    expect(result.response).toBe(null);
    expect(result.error).not.toBe(null);

    if (result.error && "clone" in result.error) {
      const clonedError = result.error.clone();

      // Original and cloned error should have the same properties
      expect(clonedError.status).toBe(result.error.status);
      expect(clonedError.statusText).toBe(result.error.statusText);
      expect(clonedError.constructor.name).toBe(result.error.constructor.name);

      // Both should be able to parse JSON independently
      const originalJson = await result.error.json();
      const clonedJson = await clonedError.json();

      expect(originalJson).toEqual(errorData);
      expect(clonedJson).toEqual(errorData);
    }
  });

  test("should be able to clone different HTTP error types", async () => {
    const mockResponse = createMockResponse(
      StatusCodes.INTERNAL_SERVER_ERROR,
      false
    );
    mockFetch.mockResolvedValue(mockResponse);

    const result = await typedFetch<unknown, InternalServerError>(
      "https://api.example.com/users",
      {}
    );

    expect(result.response).toBe(null);
    expect(result.error).not.toBe(null);

    if (
      result.error &&
      result.error instanceof InternalServerError &&
      "clone" in result.error
    ) {
      const clonedError = result.error.clone();

      expect(clonedError).toBeInstanceOf(InternalServerError);
      expect(clonedError.status).toBe(InternalServerError.status);
      expect(clonedError.statusText).toBe(InternalServerError.statusText);
    }
  });
});
