type ContentType =
  | "application/json"
  | "application/xml"
  | "application/x-www-form-urlencoded"
  | "text/plain"
  | "text/html"
  | "text/css"
  | "text/javascript"
  | "multipart/form-data"
  | "application/octet-stream"
  | "image/jpeg"
  | "image/png"
  | "image/gif"
  | "image/svg+xml"
  | (string & {});

type Canonical<T extends string> = T | Lowercase<T>;

/**
 * The `Cache-Control` directives a request can carry (RFC 9111, section
 * 5.2.1).
 *
 * `public`, `private`, and `must-revalidate` are response directives (RFC 9111,
 * section 5.2.2). No specification defines a response directive on a request,
 * so this union omits them.
 */
type CacheControlRequestDirective =
  | "no-cache"
  | "no-store"
  | "no-transform"
  | "only-if-cached"
  | "max-age=0";

/**
 * The header names this type suggests on a request, and a value union for each
 * name that has a small set of meaningful values.
 *
 * Every name here is a name a client sends. A response-only name is absent. A
 * server sends `Set-Cookie`, `ETag`, `Last-Modified`, `Location`,
 * `WWW-Authenticate`, `Content-Security-Policy`, `Access-Control-Allow-*`,
 * `X-Frame-Options`, `X-Content-Type-Options`, and `Strict-Transport-Security`.
 * No specification defines any of them on a request, so this type must not
 * suggest one.
 *
 * Three request-side names are also absent, because the platform owns them:
 *
 * - `Content-Length`. `fetch` computes the value from the body. On Node a
 *   value that does not match the body makes the request throw
 *   (`Request body length does not match content-length header`).
 * - `Host`. Undici replaces the value with the real authority of the URL.
 * - `Connection`. The Fetch Standard forbids it, and the connection pool owns
 *   the lifetime it describes.
 *
 * NOTE: The Fetch Standard calls `Accept-Encoding`, `Cookie`, `Origin`, and
 * `Referer` a forbidden request-header name. A browser drops the value the
 * caller sets and supplies its own. Node sends the value as written. These
 * four names stay listed because the no-DOM profile is this library's primary
 * target.
 *
 * The value unions suggest a value. They validate no value. {@link Named}
 * adds an open `(string & {})` arm to every name, so any string type-checks
 * (README, "Limitations").
 *
 * The `[key: string]` index signature keeps a custom name assignable.
 * {@link Named} drops it, and {@link TypedHeaders} restores custom names
 * through a `Record<string, string>` intersection that rejects `undefined`.
 */
export type StrictHeaders = {
  "Content-Type"?: ContentType;
  Authorization?: `${string} ${string}`;
  Accept?: ContentType | "*/*";
  "Accept-Encoding"?: "gzip" | "deflate" | "br" | "identity" | "*" | (string & {});
  "Accept-Language"?: "en" | "en-US" | "en-GB" | "fr" | "de" | "es" | "*" | (string & {});
  "Cache-Control"?: CacheControlRequestDirective | (string & {});
  "Content-Encoding"?: "gzip" | "deflate" | "br" | "identity";
  Cookie?: string;
  "If-Match"?: `"${string}"` | `W/"${string}"` | "*" | (string & {});
  "If-Modified-Since"?: string;
  "If-None-Match"?: `"${string}"` | `W/"${string}"` | "*" | (string & {});
  Origin?: string;
  Range?: `bytes=${string}` | (string & {});
  Referer?: string;
  "User-Agent"?: string;
  "X-Requested-With"?: "XMLHttpRequest";
  [key: string]: string | undefined;
};

/**
 * The `headers` type the ambient `fetch` accepts, derived from its own
 * signature.
 *
 * NOT the global `HeadersInit`: that name lives only in `lib.dom.d.ts`, and
 * `@types/node` does not declare it. Naming it directly made the published
 * declarations fail to compile for a Node consumer without DOM
 * (`TS2304: Cannot find name 'HeadersInit'`), or — with `skipLibCheck` on —
 * silently collapse {@link TypedHeaders} to `any`, which drops the whole
 * {@link StrictHeaders} layer. Deriving it from `fetch` resolves to the same
 * type under DOM and to the Node equivalent without it.
 */
type NativeFetchHeaders = NonNullable<NonNullable<Parameters<typeof fetch>[1]>["headers"]>;

/**
 * The constituents of {@link NativeFetchHeaders} that are not a plain string
 * record: a `Headers` instance, and an array of name/value pairs.
 *
 * The record constituent is dropped here and re-supplied by
 * {@link TypedHeaders}, because neither platform's record type rejects an
 * `undefined` value on its own. Under `lib.dom` it happens to
 * (`Record<string, string>`); under `@types/node` without DOM it does not —
 * undici's `HeaderRecord` is an all-optional mapped type, so
 * `{ Authorization: undefined }` type-checks and `fetch` then sends the
 * literal string `"undefined"`. The no-DOM profile is this library's primary
 * target, so the record shape has to be ours.
 */
type HeaderContainers = Exclude<NativeFetchHeaders, Record<string, string | undefined>>;

/**
 * The declared header names, in both their canonical and lowercase spellings.
 *
 * The `string extends K ? never` arm drops {@link StrictHeaders}'s
 * `[key: string]: string | undefined` index signature. This mapped type is
 * homomorphic and would otherwise inherit it, which reintroduces exactly the
 * `undefined` this type exists to reject. Custom names come back through the
 * `Record<string, string>` intersection in {@link TypedHeaders}.
 *
 * Each value keeps its literal union — that is the value IntelliSense — and
 * adds `(string & {})` so the union stays open. The open arm is required, not
 * cosmetic: intersecting a closed union with `Record<string, string>` would
 * start REJECTING a value that misses the union, and these types autocomplete
 * without validating (README, "Limitations"). It also keeps a plain
 * `string`-typed variable assignable to a declared name.
 */
type Named = {
  [K in keyof StrictHeaders as string extends K ? never : Canonical<K & string>]?:
    | StrictHeaders[K]
    | (string & {});
};

/**
 * Headers type that accepts {@link StrictHeaders}'s names (with IntelliSense)
 * and the container shapes the platform's `fetch` accepts.
 *
 * A header value is always a `string`. `undefined` is rejected on every name,
 * declared or custom, under every lib profile.
 */
export type TypedHeaders = (Named & Record<string, string>) | HeaderContainers;
