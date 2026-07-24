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
 * Headers type that accepts both {@link StrictHeaders} (with IntelliSense) and
 * whatever raw headers input the platform's `fetch` accepts.
 */
export type TypedHeaders =
  | {
      [K in keyof StrictHeaders as Canonical<K & string>]?: StrictHeaders[K];
    }
  | NativeFetchHeaders;
