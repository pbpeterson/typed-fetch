/**
 * The URL, reduced to the part that is structure rather than a value.
 *
 * `toJSON()` emits header NAMES and never their values, because a logger calls
 * it on whatever it is handed and cannot judge a value nobody looked at. A URL
 * is the same problem wearing different syntax: `?access_token=…`, a signed
 * `?X-Amz-Signature=…`, and `https://user:password@host/` all carry a
 * credential in a slot the URL grammar marks as a VALUE.
 *
 * A deny list of sensitive query keys fails here for the reason it failed for
 * headers: the dangerous key is the one this library has never heard of.
 * {@link redactUrl} is structural instead — it keeps origin and path and drops
 * every value slot: userinfo, the whole query, and the fragment.
 *
 * RESIDUAL, stated rather than hidden: a secret placed in a PATH SEGMENT
 * (`/reset/RESET_TOKEN`) survives. Dropping the path too would leave `url` at
 * the origin, which destroys the only thing the field is for — telling
 * concurrent failures apart. Path is treated as structure, query as value.
 *
 * The full href is never lost: `error.url` still holds it, exactly as
 * `error.headers` still holds every header value.
 */

/**
 * Base for a RELATIVE request URL. `fetch("/v1/thing?token=…")` is ordinary in
 * a browser or a worker, and it resolves against a document base this library
 * never sees. `.invalid` is reserved by RFC 2606 and can never be a real host.
 */
const RELATIVE_BASE = "http://url.invalid";

/** Clears every value slot in place and returns the same `URL`. */
function stripValues(parsed: URL): URL {
  parsed.username = "";
  parsed.password = "";
  parsed.search = "";
  parsed.hash = "";
  return parsed;
}

/**
 * The href with every value slot removed: no userinfo, no query, no fragment.
 *
 * Total by construction. An empty string stays empty (the documented "no URL
 * could be resolved" value), a relative URL keeps its path, and an input that
 * parses as neither is emitted as a percent-encoded PATH — never as the raw
 * string, so a query or fragment hidden in it is still dropped.
 */
export function redactUrl(url: string): string {
  if (!url) return "";
  try {
    return stripValues(new URL(url)).href;
  } catch {
    // Not absolute. Fall through rather than nest: the relative case is
    // ordinary, not exceptional.
  }
  try {
    return stripValues(new URL(url, RELATIVE_BASE)).pathname;
  } catch {
    return "";
  }
}

/** `"user:password@"`, `"user@"`, or `""` when the URL carries no userinfo. */
function userinfoOf(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "";
  }
  const { username, password } = parsed;
  if (!username && !password) return "";
  return password ? `${username}:${password}@` : `${username}@`;
}

/**
 * Replace a URL this error already holds wherever it appears in a message.
 *
 * `message` is not always ours. `classifyRequestFailure` copies the platform's
 * rejection message into `NetworkError`, and undici rejects a credentialed URL
 * with `TypeError: Request cannot be constructed from a URL that includes
 * credentials: http://alice:hunter2@host/x` — a password, verbatim, in the one
 * string every log line carries.
 *
 * This is NOT a search for secrets in free text; that would be the deny list
 * again. It replaces a value we ALREADY HOLD (`url`) with its redacted form,
 * which is deterministic and needs no knowledge of the message's wording, so it
 * works on every runtime.
 *
 * BEST EFFORT, and deliberately so: a platform that re-serializes the URL
 * before putting it in its message defeats the exact-string replacement. The
 * userinfo pass is the second line — userinfo is unconditionally a credential,
 * so it is removed wherever it survives — and `toJSON()` redacts `url`
 * independently, so a miss here never reaches the record.
 */
export function redactUrlInMessage(message: string, url: string): string {
  if (!url) return message;
  const redacted = redactUrl(url);
  // The replacer is a FUNCTION, not a string: a string replacement interprets
  // `$&`, `$'` and friends, and a path may legitimately contain `$`.
  let out = url === redacted ? message : message.replaceAll(url, () => redacted);
  const userinfo = userinfoOf(url);
  if (userinfo) out = out.replaceAll(userinfo, () => "");
  return out;
}
