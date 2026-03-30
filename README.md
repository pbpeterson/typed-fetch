# @pbpeterson/typed-fetch

A type-safe HTTP client for TypeScript that never throws. Inspired by Go's error handling pattern, built on top of the native Fetch API.

## Why typed-fetch?

Traditional fetch libraries throw exceptions on HTTP errors, making error handling cumbersome and error-prone. **typed-fetch** follows Go's philosophy of explicit error handling - errors are values, not exceptions.

```typescript
// ❌ Traditional approach - can throw unexpectedly
try {
  const response = await fetch('/api/users');
  const users = await response.json(); // What if response is 404?
} catch (error) {
  // Handle network errors, parsing errors, HTTP errors... all mixed together
}

// ✅ typed-fetch approach - explicit and type-safe
const { response, error } = await typedFetch<User[]>('/api/users');
if (error) {
  // Handle error with full type information
  console.log(`HTTP ${error.status}: ${error.statusText}`);
  const errorDetails = await error.json(); // Access error response body
} else {
  // TypeScript knows response is not null
  const users = await response.json(); // Type: User[]
}
```

## Features

- **Never throws** - All errors are returned as values
- **Fully typed** - Complete TypeScript support with literal status types
- **Built on Fetch** - Thin wrapper around the native Fetch API, same signature
- **40 HTTP error classes** - Covering all standard HTTP status codes (400-511)
- **Network error handling** - Separate `NetworkError` class for connection issues
- **Type guards** - `isHttpError()` and `isNetworkError()` for runtime checks
- **Generic error bodies** - `error.json<T>()` for typed error response parsing
- **Minimal dependencies** - Only `is-network-error` for reliable network error detection

## Installation

```bash
npm install @pbpeterson/typed-fetch
```

## Basic Usage

### Simple GET Request

```typescript
import { typedFetch } from '@pbpeterson/typed-fetch';

interface User {
  id: number;
  name: string;
  email: string;
}

const { response, error } = await typedFetch<User[]>('/api/users');

if (error) {
  console.error('Failed to fetch users:', error.statusText);
} else {
  const users = await response.json(); // Type: User[]
}
```

### POST Request with Body

```typescript
import { typedFetch, BadRequestError } from '@pbpeterson/typed-fetch';

const { response, error } = await typedFetch<User>('/api/users', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'John', email: 'john@example.com' }),
});

if (error) {
  if (error instanceof BadRequestError) {
    const details = await error.json<{ field: string; message: string }>();
    console.error('Validation failed:', details);
  }
}
```

## Error Handling

### HTTP Status Errors

```typescript
import {
  typedFetch,
  NotFoundError,
  UnauthorizedError,
  NetworkError,
} from '@pbpeterson/typed-fetch';

const { response, error } = await typedFetch<User>('/api/users/123');

if (error) {
  if (error instanceof NotFoundError) {
    console.log('User not found');
  } else if (error instanceof UnauthorizedError) {
    console.log('Please log in');
  } else if (error instanceof NetworkError) {
    console.log('Network error:', error.message);
  }
}
```

### Type Guards

Use `isHttpError()` and `isNetworkError()` instead of `instanceof` for reliable checks across package boundaries:

```typescript
import { typedFetch, isHttpError, isNetworkError } from '@pbpeterson/typed-fetch';

const { response, error } = await typedFetch<User>('/api/users/123');

if (error) {
  if (isHttpError(error)) {
    console.log(`HTTP ${error.status}: ${error.statusText}`);
  } else if (isNetworkError(error)) {
    console.log('Connection failed:', error.message);
  }
}
```

### Typed Error Response Bodies

The `json()` method accepts a generic type parameter:

```typescript
interface ApiError {
  message: string;
  code: string;
  fields?: Record<string, string>;
}

if (error instanceof BadRequestError) {
  const details = await error.json<ApiError>();
  console.log(details.message); // fully typed
}
```

### Narrowing with Specific Client Errors

Constrain expected client errors (4xx) as a second generic parameter. Server errors (5xx) are always included since they can happen regardless:

```typescript
import { typedFetch, BadRequestError, NotFoundError } from '@pbpeterson/typed-fetch';

type ExpectedErrors = BadRequestError | NotFoundError;

const { response, error } = await typedFetch<User, ExpectedErrors>('/api/users/123');
// error: BadRequestError | NotFoundError | ServerErrors | NetworkError | null
```

### Error Response Bodies

All HTTP error classes provide access to the response body:

```typescript
if (error && isHttpError(error)) {
  const json = await error.json();
  const text = await error.clone().text();
  const blob = await error.clone().blob();
  const buffer = await error.clone().arrayBuffer();

  // Access response headers
  const retryAfter = error.headers.get('Retry-After');

  // Status info with literal types
  error.status;     // 404 (literal, not number)
  error.statusText; // "Not Found" (literal, not string)
}
```

### Static Properties

Access status codes without creating instances:

```typescript
import { NotFoundError, BadRequestError } from '@pbpeterson/typed-fetch';

console.log(NotFoundError.status);          // 404
console.log(NotFoundError.statusText);      // "Not Found"
console.log(BadRequestError.status);        // 400
console.log(BadRequestError.statusText);    // "Bad Request"
```

## Available Error Classes

### 4xx Client Errors

| Class | Status | Status Text |
|-------|--------|-------------|
| `BadRequestError` | 400 | Bad Request |
| `UnauthorizedError` | 401 | Unauthorized |
| `PaymentRequiredError` | 402 | Payment Required |
| `ForbiddenError` | 403 | Forbidden |
| `NotFoundError` | 404 | Not Found |
| `MethodNotAllowedError` | 405 | Method Not Allowed |
| `NotAcceptableError` | 406 | Not Acceptable |
| `ProxyAuthenticationRequiredError` | 407 | Proxy Authentication Required |
| `RequestTimeoutError` | 408 | Request Timeout |
| `ConflictError` | 409 | Conflict |
| `GoneError` | 410 | Gone |
| `LengthRequiredError` | 411 | Length Required |
| `PreconditionFailedError` | 412 | Precondition Failed |
| `RequestTooLongError` | 413 | Payload Too Large |
| `RequestUriTooLongError` | 414 | URI Too Long |
| `UnsupportedMediaTypeError` | 415 | Unsupported Media Type |
| `RequestedRangeNotSatisfiableError` | 416 | Range Not Satisfiable |
| `ExpectationFailedError` | 417 | Expectation Failed |
| `ImATeapotError` | 418 | I'm a teapot |
| `MisdirectedRequestError` | 421 | Misdirected Request |
| `UnprocessableEntityError` | 422 | Unprocessable Entity |
| `LockedError` | 423 | Locked |
| `FailedDependencyError` | 424 | Failed Dependency |
| `TooEarlyError` | 425 | Too Early |
| `UpgradeRequiredError` | 426 | Upgrade Required |
| `PreconditionRequiredError` | 428 | Precondition Required |
| `TooManyRequestsError` | 429 | Too Many Requests |
| `RequestHeaderFieldsTooLargeError` | 431 | Request Header Fields Too Large |
| `UnavailableForLegalReasonsError` | 451 | Unavailable For Legal Reasons |

### 5xx Server Errors

| Class | Status | Status Text |
|-------|--------|-------------|
| `InternalServerError` | 500 | Internal Server Error |
| `NotImplementedError` | 501 | Not Implemented |
| `BadGatewayError` | 502 | Bad Gateway |
| `ServiceUnavailableError` | 503 | Service Unavailable |
| `GatewayTimeoutError` | 504 | Gateway Timeout |
| `HttpVersionNotSupportedError` | 505 | HTTP Version Not Supported |
| `VariantAlsoNegotiatesError` | 506 | Variant Also Negotiates |
| `InsufficientStorageError` | 507 | Insufficient Storage |
| `LoopDetectedError` | 508 | Loop Detected |
| `NotExtendedError` | 510 | Not Extended |
| `NetworkAuthenticationRequiredError` | 511 | Network Authentication Required |

### Other

| Class | Description |
|-------|-------------|
| `NetworkError` | Connection issues, DNS failures, timeouts |
| `BaseHttpError` | Abstract base class for all HTTP errors |

## API Reference

### `typedFetch<T, E>(url, options?)`

**Type Parameters:**
- `T` - The expected response body type
- `E extends ClientErrors` - Specific client error type(s) (defaults to all)

**Parameters:**
- `url` - The URL to fetch (same as `fetch()`)
- `options` - Fetch options with typed `headers` and `method` (optional)

**Returns:**
```typescript
Promise<
  | { response: TypedResponse<T>; error: null }
  | { response: null; error: E | ServerErrors | NetworkError }
>
```

### `isHttpError(error): error is BaseHttpError`

Type guard that checks if an error is an HTTP error (any status code).

### `isNetworkError(error): error is NetworkError`

Type guard that checks if an error is a network-level error.

### `statusCodeErrorMap`

A `Map<number, ErrorClass>` mapping HTTP status codes to their error classes. Useful for custom error handling logic.

### `httpErrors`

Array of all 40 HTTP error classes. Useful for iteration and custom registries.

### Error Class API

All HTTP error classes extend `BaseHttpError`:

**Instance Properties:**
- `status` - HTTP status code (literal type, e.g. `404`)
- `statusText` - HTTP status text (literal type, e.g. `"Not Found"`)
- `headers` - Response `Headers` object
- `name` - Error class name (e.g. `"NotFoundError"`)

**Instance Methods:**
- `json<T = unknown>()` - Parse error response body as JSON
- `text()` - Parse as text
- `blob()` - Parse as Blob
- `arrayBuffer()` - Parse as ArrayBuffer
- `clone()` - Clone the error for multiple body reads

**Static Properties:**
- `status` - HTTP status code
- `statusText` - HTTP status text

## Inspiration

Inspired by Go's error handling philosophy where errors are values:

```go
result, err := http.Get("https://api.example.com/users")
if err != nil {
    return err
}
```

```typescript
const { response, error } = await typedFetch<User[]>('/api/users');
if (error) {
    return error;
}
```

## License

MIT
