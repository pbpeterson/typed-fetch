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

export type StrictHeaders = {
  "Content-Type"?: ContentType;
  Authorization?: `${string} ${string}`;
  Accept?: ContentType | "*/*";
  "Accept-Encoding"?:
    | "gzip"
    | "deflate"
    | "br"
    | "identity"
    | "*"
    | (string & {});
  "Accept-Language"?:
    | "en"
    | "en-US"
    | "en-GB"
    | "fr"
    | "de"
    | "es"
    | "*"
    | (string & {});
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
  "WWW-Authenticate"?:
    | `Bearer realm="${string}"`
    | `Basic realm="${string}"`
    | (string & {});
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

export type TypedHeaders =
  | {
      [K in keyof StrictHeaders as Canonical<K & string>]?: StrictHeaders[K];
    }
  | HeadersInit;
