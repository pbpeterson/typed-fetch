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

- 🚫 **Never throws** - All errors are returned as values
- 🎯 **Fully typed** - Complete TypeScript support for responses and errors
- 🔧 **Built on Fetch** - Thin wrapper around the native Fetch API
- 📝 **Comprehensive HTTP Error Classes** - 40+ specific error types covering all standard HTTP status codes
- 🌐 **Network Error Handling** - Separate handling for network vs HTTP errors
- 🎨 **Customizable Error Types** - Bring your own error interfaces
- 📦 **Minimal Dependencies** - Only uses is-network-error for reliable network error detection
- 🔍 **Static Properties** - Access status codes without instantiation via TypedFetchErrors.NotFound.status

## Installation

```bash
npm install @pbpeterson/typed-fetch
# or
pnpm add @pbpeterson/typed-fetch
# or
yarn add @pbpeterson/typed-fetch
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
  console.log('Users:', users);
}
```

### POST Request with Body

```typescript
import { typedFetch, BadRequestError } from '@pbpeterson/typed-fetch';

const newUser = { name: 'John Doe', email: 'john@example.com' };

const { response, error } = await typedFetch<User>('/api/users', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(newUser),
});

if (error) {
  // Handle different error types
  if (error instanceof BadRequestError) {
    const validationErrors = await error.json();
    console.error('Validation failed:', validationErrors);
  } else {
    console.error('Request failed:', error.statusText);
  }
} else {
  const user = await response.json(); // Type: User
  console.log('Created user:', user);
}
```

## Error Handling

### HTTP Status Errors

typed-fetch provides specific error classes as individual exports for optimal tree-shaking:

```typescript
import { typedFetch, NotFoundError, UnauthorizedError, BadRequestError, NetworkError } from '@pbpeterson/typed-fetch';

const { response, error } = await typedFetch<User>('/api/users/123');

if (error) {
  if (error instanceof NotFoundError) {
    console.log('User not found');
  } else if (error instanceof UnauthorizedError) {
    console.log('Please log in');
  } else if (error instanceof BadRequestError) {
    const details = await error.json();
    console.log('Invalid request:', details);
  } else if (error instanceof NetworkError) {
    console.log('Network error:', error.message);
  } else {
    console.log('Server error:', error.statusText);
  }
}
```

### Available Error Classes

All errors are available as individual exports for optimal tree-shaking:

- **4xx Client Errors:**
  - `BadRequestError` (400)
  - `UnauthorizedError` (401)
  - `PaymentRequiredError` (402)
  - `ForbiddenError` (403)
  - `NotFoundError` (404)
  - `MethodNotAllowedError` (405)
  - `NotAcceptableError` (406)
  - `ProxyAuthenticationRequiredError` (407)
  - `RequestTimeoutError` (408)
  - `ConflictError` (409)
  - `GoneError` (410)
  - `LengthRequiredError` (411)
  - `PreconditionFailedError` (412)
  - `RequestTooLongError` (413)
  - `RequestUriTooLongError` (414)
  - `UnsupportedMediaTypeError` (415)
  - `RequestedRangeNotSatisfiableError` (416)
  - `ExpectationFailedError` (417)
  - `ImATeapotError` (418)
  - `MisdirectedRequestError` (421)
  - `UnprocessableEntityError` (422)
  - `LockedError` (423)
  - `FailedDependencyError` (424)
  - `TooEarlyError` (425)
  - `UpgradeRequiredError` (426)
  - `PreconditionRequiredError` (428)
  - `TooManyRequestsError` (429)
  - `RequestHeaderFieldsTooLargeError` (431)
  - `UnavailableForLegalReasonsError` (451)

- **5xx Server Errors:**
  - `InternalServerError` (500)
  - `NotImplementedError` (501)
  - `BadGatewayError` (502)
  - `ServiceUnavailableError` (503)
  - `GatewayTimeoutError` (504)
  - `HttpVersionNotSupportedError` (505)
  - `VariantAlsoNegotiatesError` (506)
  - `InsufficientStorageError` (507)
  - `LoopDetectedError` (508)
  - `NotExtendedError` (510)
  - `NetworkAuthenticationRequiredError` (511)

- **Network Errors:**
  - `NetworkError` - For connection issues, timeouts, etc.

### Specific Client Error Types

You can constrain the expected client errors (4xx) as a second generic parameter. Server errors (5xx) are always included since they can happen regardless of your input:

```typescript
import { typedFetch, BadRequestError } from '@pbpeterson/typed-fetch';

// Specify expected client errors - server errors are automatically included
const { response, error } = await typedFetch<User, BadRequestError>('/api/users');

if (error) {
  // error is typed as: BadRequestError | ServerErrors | NetworkError
  // Server errors (5xx) are always included since you can't control them
  if (error instanceof BadRequestError) {
    const validationErrors = await error.json();
    console.log('Validation failed:', validationErrors);
  } else if (error.status >= 500) {
    console.log('Server error occurred:', error.statusText);
  }
}

// You can combine multiple client error types:
import { NotFoundError } from '@pbpeterson/typed-fetch';
type ExpectedErrors = NotFoundError | BadRequestError;
const { response, error } = await typedFetch<User, ExpectedErrors>('/api/users/123');
// error: NotFoundError | BadRequestError | ServerErrors | NetworkError
```

## Advanced Usage

### Error Response Bodies

All HTTP error classes provide access to the response body in multiple formats:

```typescript
const { response, error } = await typedFetch<User>('/api/users', {
  method: 'POST',
  body: JSON.stringify(invalidData)
});

if (error) {
  // Access the error response body in different formats
  const errorJson = await error.json();        // Parse as JSON
  const errorText = await error.clone().text(); // Parse as text
  const errorBlob = await error.clone().blob(); // Parse as blob
  const errorBuffer = await error.clone().arrayBuffer(); // Parse as ArrayBuffer
  
  console.log('Server error details:', errorJson);
  
  // Access response headers
  const contentType = error.headers.get('content-type');
  
  // Access status information
  console.log(`Error ${error.status}: ${error.statusText}`);
}
```

### Static Properties

Access status codes and text without creating instances:

```typescript
import { NotFoundError, BadRequestError, InternalServerError } from '@pbpeterson/typed-fetch';

// Check status codes statically
if (response.status === NotFoundError.status) {
  console.log('Resource not found');
}

// All error classes have static properties
console.log(BadRequestError.status);     // 400
console.log(BadRequestError.statusText); // "Bad Request"
console.log(InternalServerError.status); // 500
console.log(InternalServerError.statusText); // "Internal Server Error"
```

### Network vs HTTP Errors

```typescript
import { typedFetch, NetworkError } from '@pbpeterson/typed-fetch';

const { response, error } = await typedFetch<User>('/api/users');

if (error) {
  if (error instanceof NetworkError) {
    console.log('Network issue - check connection');
  } else {
    // All other errors are HTTP errors with status property
    console.log(`HTTP error: ${error.status}`);
  }
}
```

### Optional RequestInit

The second parameter is optional and defaults to an empty object:

```typescript
// These are equivalent
await typedFetch<User[]>('/api/users');
await typedFetch<User[]>('/api/users', {});
```

## API Reference

### Exports

This library exports the main fetch function and individual error classes for optimal tree-shaking:

- `typedFetch` - The main fetch function
- Individual error classes: `BadRequestError`, `NotFoundError`, `InternalServerError`, etc.

```typescript
// Import only what you need for optimal bundle size
import { typedFetch, NotFoundError, BadRequestError } from '@pbpeterson/typed-fetch';

// Or import all errors if needed
import * as Errors from '@pbpeterson/typed-fetch';
```

### `typedFetch<T, E>(url, options?)`

**Type Parameters:**
- `T` - The expected response body type
- `E extends ClientErrors` - Specific client error class(es) to expect (optional, defaults to all client errors)

**Parameters:**
- `url: string` - The URL to fetch
- `options: RequestInit` - Fetch options (optional, defaults to `{}`)

**Returns:**
```typescript
Promise<{
  response: TypedResponse<T>;
  error: null;
} | {
  response: null;
  error: E | ServerErrors | NetworkError;
}>
```

**Example with specific error types:**
```typescript
import { BadRequestError, NotFoundError } from '@pbpeterson/typed-fetch';

// Expect specific client errors - server errors always included
type ExpectedErrors = BadRequestError | NotFoundError;
const { response, error } = await typedFetch<User, ExpectedErrors>('/api/users/123');

// error will be: BadRequestError | NotFoundError | ServerErrors | NetworkError | null
```

**Note:** Server errors (5xx) are always included in the error union because they can occur regardless of your input validation or client-side logic.

### Error Classes

All HTTP error classes extend `BaseHttpError` and include:

**Instance Properties:**
- `status: number` - HTTP status code
- `statusText: string` - HTTP status text  
- `headers: Headers` - Response headers

**Instance Methods:**
- `json(): Promise<any>` - Parse error response body as JSON
- `text(): Promise<string>` - Parse error response body as text
- `blob(): Promise<Blob>` - Parse error response body as blob
- `arrayBuffer(): Promise<ArrayBuffer>` - Parse error response body as ArrayBuffer
- `clone(): ErrorClass` - Clone the error for multiple response body reads

**Static Properties:**
- `static status: number` - HTTP status code (accessible without instantiation)
- `static statusText: string` - HTTP status text (accessible without instantiation)

## Inspiration

This library is inspired by Go's error handling philosophy where "errors are values." Instead of using exceptions for control flow, typed-fetch returns errors as regular values that you can inspect, handle, and pass around like any other data.

```go
// Go pattern that inspired this library
result, err := http.Get("https://api.example.com/users")
if err != nil {
    // handle error
    return err
}
// use result
```

```typescript
// typed-fetch equivalent
const { response, error } = await typedFetch<User[]>('/api/users');
if (error) {
    // handle error
    return error;
}
// use response
```

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.