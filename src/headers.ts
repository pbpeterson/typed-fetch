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

type CacheControlDirective =
  | "no-cache"
  | "no-store"
  | "max-age=0"
  | "public"
  | "private"
  | "must-revalidate";

/** HTTP headers with IntelliSense for common header names and typed values. */
export type StrictHeaders = {
  "Content-Type"?: ContentType;
  Authorization?: `${string} ${string}`;
  Accept?: ContentType | "*/*";
  "Accept-Encoding"?: "gzip" | "deflate" | "br" | "identity" | "*" | (string & {});
  "Accept-Language"?: "en" | "en-US" | "en-GB" | "fr" | "de" | "es" | "*" | (string & {});
  "Cache-Control"?:
    | CacheControlDirective
    | `${CacheControlDirective}, ${CacheControlDirective}`
    | (string & {});
  Connection?: "keep-alive" | "close" | "upgrade";
  "Content-Encoding"?: "gzip" | "deflate" | "br" | "identity";
  "Content-Length"?: `${number}` | (string & {});
  Cookie?: string;
  "Set-Cookie"?: string;
  ETag?: `"${string}"` | `W/"${string}"` | (string & {});
  Host?: string;
  "If-Modified-Since"?: string;
  "If-None-Match"?: `"${string}"` | `W/"${string}"` | "*" | (string & {});
  "Last-Modified"?: string;
  Location?: string;
  Origin?: string;
  Range?: `bytes=${string}` | (string & {});
  Referer?: string;
  "User-Agent"?: string;
  "WWW-Authenticate"?: `Bearer realm="${string}"` | `Basic realm="${string}"` | (string & {});
  "X-Requested-With"?: "XMLHttpRequest";
  "Access-Control-Allow-Origin"?: "*" | (string & {});
  "Access-Control-Allow-Methods"?:
    | "GET"
    | "POST"
    | "PUT"
    | "DELETE"
    | "OPTIONS"
    | "PATCH"
    | "HEAD"
    | (string & {});
  "Access-Control-Allow-Headers"?:
    | "Content-Type"
    | "Authorization"
    | "X-Requested-With"
    | "*"
    | (string & {});
  "Access-Control-Allow-Credentials"?: "true" | "false";
  "Content-Security-Policy"?: string;
  "X-Frame-Options"?: "DENY" | "SAMEORIGIN" | `ALLOW-FROM ${string}`;
  "X-Content-Type-Options"?: "nosniff";
  "Strict-Transport-Security"?:
    | `max-age=${number}`
    | `max-age=${number}; includeSubDomains`
    | (string & {});
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
