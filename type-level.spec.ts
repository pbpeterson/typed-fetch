import { describe, test, expect, expectTypeOf } from "vitest";
import { useTestServer } from "./fixtures/http-server";
import {
  typedFetch,
  isHttpError,
  isNetworkError,
  isKnownHttpError,
  isAbortError,
  isTimeoutError,
} from "./src/index";
import {
  AbortedError,
  BaseHttpError,
  ForbiddenError,
  NetworkError,
  NotFoundError,
  TimeoutError,
  UnknownHttpError,
} from "./src/errors";
import type { ClientErrors, ServerErrors, TypedFetchError } from "./src/errors";
import type { StrictHeaders, TypedHeaders } from "./src/headers";
import type { HttpMethods } from "./src/methods";
import type { TypedFetchOptions, TypedFetchReturnType, TypedResponse } from "./index";

const { url } = useTestServer();

// ── Compile-time type checks ─────────────────────────────────────────

describe("type-level", () => {
  test("HttpMethods accepts all standard methods", () => {
    expectTypeOf<"GET">().toExtend<HttpMethods>();
    expectTypeOf<"POST">().toExtend<HttpMethods>();
    expectTypeOf<"PUT">().toExtend<HttpMethods>();
    expectTypeOf<"PATCH">().toExtend<HttpMethods>();
    expectTypeOf<"DELETE">().toExtend<HttpMethods>();
    expectTypeOf<"HEAD">().toExtend<HttpMethods>();
    expectTypeOf<"OPTIONS">().toExtend<HttpMethods>();
  });

  test("HttpMethods rejects invalid and fetch-forbidden methods", () => {
    expectTypeOf<"INVALID">().not.toExtend<HttpMethods>();
    expectTypeOf<"get">().not.toExtend<HttpMethods>();
    expectTypeOf<string>().not.toExtend<HttpMethods>();
    // the Fetch spec forbids these — fetch() throws TypeError on them
    expectTypeOf<"CONNECT">().not.toExtend<HttpMethods>();
    expectTypeOf<"TRACE">().not.toExtend<HttpMethods>();
  });

  test("StrictHeaders accepts known and custom headers", () => {
    expectTypeOf<{ "Content-Type": "application/json" }>().toExtend<StrictHeaders>();
    expectTypeOf<{ Authorization: "Bearer token" }>().toExtend<StrictHeaders>();
    expectTypeOf<{ "X-Custom": "value" }>().toExtend<StrictHeaders>();
  });

  test("typedFetch return is a discriminated union", async () => {
    const result = await typedFetch<{ id: number }>(
      url({ status: 200, body: JSON.stringify({ id: 1 }) }),
    );

    if (result.error === null) {
      expectTypeOf(result.response).not.toEqualTypeOf<null>();
      expectTypeOf(result.response.status).toBeNumber();
    } else {
      expectTypeOf(result.response).toEqualTypeOf<null>();
      expectTypeOf(result.error).toExtend<
        ClientErrors | ServerErrors | UnknownHttpError | NetworkError | AbortedError | TimeoutError
      >();
    }
  });

  test("isKnownHttpError narrows error.status to a single class", async () => {
    const { error } = await typedFetch<{ id: number }>(url());
    if (error && isKnownHttpError(error)) {
      if (error.status === 403) expectTypeOf(error).toEqualTypeOf<ForbiddenError>();
    }
  });

  test("the removed second type argument no longer compiles", async () => {
    // @ts-expect-error — ErrorType generic was removed from typedFetch (P3-01);
    // typedFetch<T, E> is no longer a valid instantiation.
    await typedFetch<{ id: number }, NotFoundError>(url());
  });

  // The envelope carries the DISCRIMINANT, so a write falsifies the evidence
  // the narrowing rests on. Normalizing a 404 into an empty result is the
  // plausible shape of that write, and it used to typecheck clean and then
  // throw: `r.error = null` re-opened the success branch while `r.response` was
  // still null.
  test("the result envelope cannot be rewritten in place", async () => {
    const result = await typedFetch<{ id: number }>(url({ status: 404 }));
    if (isHttpError(result.error)) await result.error.cancel();

    // @ts-expect-error — TypedFetchReturnType.error is readonly.
    result.error = null;
    // @ts-expect-error — TypedFetchReturnType.response is readonly.
    result.response = null;
  });

  test("response.clone() keeps the typed json()", async () => {
    const result = await typedFetch<{ id: number }>(
      url({ status: 200, body: JSON.stringify({ id: 1 }) }),
    );

    if (result.error === null) {
      const cloned = result.response.clone();
      expectTypeOf(cloned.json).returns.toEqualTypeOf<Promise<{ id: number }>>();
      expect(await cloned.json()).toEqual({ id: 1 });
    }
  });

  test("public types are exported from the main entry", () => {
    expectTypeOf<TypedFetchOptions>().toExtend<RequestInit>();
    expectTypeOf<TypedResponse<{ a: 1 }>["json"]>().returns.toEqualTypeOf<Promise<{ a: 1 }>>();
    expectTypeOf<TypedFetchReturnType<{ a: 1 }>>().toExtend<{
      response: TypedResponse<{ a: 1 }> | null;
    }>();
  });

  test("TypedResponse exposes the stable Fetch baseline, not newer ambient additions", () => {
    type ResponseHasBytes = "bytes" extends keyof TypedResponse<unknown> ? true : false;
    type HeadersHaveGetSetCookie = "getSetCookie" extends keyof TypedResponse<unknown>["headers"]
      ? true
      : false;
    type BodyHasValues = "values" extends keyof NonNullable<TypedResponse<unknown>["body"]>
      ? true
      : false;

    expectTypeOf<ResponseHasBytes>().toEqualTypeOf<false>();
    expectTypeOf<HeadersHaveGetSetCookie>().toEqualTypeOf<false>();
    expectTypeOf<BodyHasValues>().toEqualTypeOf<false>();
    expectTypeOf<Response>().toExtend<TypedResponse<unknown>>();
  });

  // ── every TypedResponse member, pinned ──────────────────────────────
  // The type surface IS the product here, so a member that silently widens to
  // `any` is a shipped defect, not a test gap. The assertions above pin what is
  // ABSENT (`bytes`, `getSetCookie`, `values`) plus `json`, `status`, `body`,
  // `headers`, and `clone`. That left ten members provable-by-nothing:
  // replacing `ok`, `statusText`, `url`, and `text()` with `any` all at once
  // still compiled the whole project with zero errors.
  //
  // `toExtend<TypedResponse<unknown>>` cannot catch it either — a WIDER
  // `TypedResponse` still satisfies it — and the public-surface snapshots
  // freeze export NAMES, never member types.
  test("every TypedResponse member is pinned, so none can widen to any", () => {
    type R = TypedResponse<{ a: 1 }>;

    expectTypeOf<R["ok"]>().toEqualTypeOf<boolean>();
    expectTypeOf<R["redirected"]>().toEqualTypeOf<boolean>();
    expectTypeOf<R["bodyUsed"]>().toEqualTypeOf<boolean>();
    expectTypeOf<R["status"]>().toEqualTypeOf<number>();
    expectTypeOf<R["statusText"]>().toEqualTypeOf<string>();
    expectTypeOf<R["url"]>().toEqualTypeOf<string>();
    expectTypeOf<R["type"]>().toEqualTypeOf<
      "basic" | "cors" | "default" | "error" | "opaque" | "opaqueredirect"
    >();

    expectTypeOf<R["arrayBuffer"]>().returns.toEqualTypeOf<Promise<ArrayBuffer>>();
    expectTypeOf<R["blob"]>().returns.toEqualTypeOf<Promise<Blob>>();
    expectTypeOf<R["formData"]>().returns.toEqualTypeOf<Promise<FormData>>();
    expectTypeOf<R["text"]>().returns.toEqualTypeOf<Promise<string>>();
    expectTypeOf<R["json"]>().returns.toEqualTypeOf<Promise<{ a: 1 }>>();
    expectTypeOf<R["clone"]>().returns.toEqualTypeOf<R>();

    // `body` and `headers` carry types this library does not export, so they
    // cannot be named here. The absence assertions above pin their shape; this
    // pins the one thing those cannot say.
    expectTypeOf<R["body"]>().not.toBeAny();
    expectTypeOf<R["headers"]>().not.toBeAny();
  });

  test("TypedResponse has exactly the members pinned above", () => {
    // The growth direction. Without this, a member added tomorrow is unpinned
    // again and the test above still passes.
    expectTypeOf<keyof TypedResponse<unknown>>().toEqualTypeOf<
      | "body"
      | "bodyUsed"
      | "headers"
      | "ok"
      | "redirected"
      | "status"
      | "statusText"
      | "type"
      | "url"
      | "arrayBuffer"
      | "blob"
      | "formData"
      | "json"
      | "text"
      | "clone"
    >();
  });

  // ── the options slots: replaced, not intersected ───────────────────
  // `RequestInit["method"]` is `string`. Intersecting it with the open union
  // collapsed the whole slot to bare `string` — `string & (HttpMethods | (string
  // & {}))` reduces — and a slot typed `string` offers ZERO completions. The
  // native slot is now removed with `Omit` and REPLACED, which is the only
  // reason `method: "…"` suggests anything at all.

  test("the method slot keeps its union instead of collapsing to string", () => {
    expectTypeOf<TypedFetchOptions["method"]>().toEqualTypeOf<
      HttpMethods | (string & {}) | undefined
    >();
    expectTypeOf<TypedFetchOptions["method"]>().not.toEqualTypeOf<string | undefined>();
    // Still open: fetch accepts any method string, and this type validates none.
    expectTypeOf<"REPORT">().toExtend<NonNullable<TypedFetchOptions["method"]>>();
    expectTypeOf<string>().toExtend<NonNullable<TypedFetchOptions["method"]>>();
  });

  test("the headers slot is this library's type, not an intersection", () => {
    // The intersection also dragged in the PLATFORM's declared header names.
    // Under `@types/node` (no DOM) that is undici's full list, which put every
    // response-only name — `Set-Cookie`, `ETag`, `Content-Length`, `Host` —
    // back into the suggestion list that this library deliberately narrowed to
    // request-side names.
    expectTypeOf<NonNullable<TypedFetchOptions["headers"]>>().toEqualTypeOf<TypedHeaders>();
  });

  test("replacing two slots removes no other RequestInit member", () => {
    expectTypeOf<TypedFetchOptions>().toExtend<RequestInit>();
    type Native = NonNullable<Parameters<typeof fetch>[1]>;
    // Nothing the platform declares may go missing. This catches a mistyped
    // key in the `Omit`, which would silently delete a real option instead.
    expectTypeOf<Exclude<keyof Native, keyof TypedFetchOptions>>().toEqualTypeOf<never>();
    expectTypeOf<{ body: string; redirect: "manual" }>().toExtend<TypedFetchOptions>();
  });

  test("the fetch seam names undefined so a DI value assigns under EOPT", () => {
    // `fetch?: typeof fetch` REJECTS `typeof fetch | undefined` under
    // `exactOptionalPropertyTypes` (TS2379), which is the value a DI seam
    // actually holds. This repo does not compile with that flag, so the
    // assertion below cannot fail here: the gate that can is
    // `typecheck:node-eopt` in scripts/check-consumer.mjs, which compiles a
    // consumer against the PUBLISHED declarations with EOPT on.
    expectTypeOf<TypedFetchOptions["fetch"]>().toEqualTypeOf<typeof fetch | undefined>();
  });

  // `toEqualTypeOf`, never `toExtend`, on a NARROWING assertion. `any` extends
  // everything, so `toExtend` is satisfied by a predicate that has collapsed to
  // `value is any` — the exact widening these four tests are named to prevent.
  // Mutating each predicate to `error is any` left all four passing.
  test("isHttpError narrows to BaseHttpError", () => {
    const error: unknown = {};
    if (isHttpError(error)) {
      expectTypeOf(error).toEqualTypeOf<BaseHttpError>();
    }
  });

  test("isNetworkError narrows to NetworkError", () => {
    const error: unknown = {};
    if (isNetworkError(error)) {
      expectTypeOf(error).toEqualTypeOf<NetworkError>();
    }
  });

  test("NetworkError does not extend BaseHttpError", () => {
    expectTypeOf<NetworkError>().not.toExtend<BaseHttpError>();
  });

  test("AbortedError.reason is typed unknown (the consumer must narrow it)", () => {
    expectTypeOf<AbortedError["reason"]>().toEqualTypeOf<unknown>();
  });

  test("AbortedError and TimeoutError do not extend NetworkError or BaseHttpError", () => {
    expectTypeOf<AbortedError>().not.toExtend<NetworkError>();
    expectTypeOf<AbortedError>().not.toExtend<BaseHttpError>();
    expectTypeOf<TimeoutError>().not.toExtend<NetworkError>();
    expectTypeOf<TimeoutError>().not.toExtend<BaseHttpError>();
  });

  test("TypedFetchError includes AbortedError and TimeoutError", () => {
    // Name `TypedFetchError`. Spelling the union out by hand made this a
    // TAUTOLOGY — `X extends (… | X | …)` holds whatever `TypedFetchError` is,
    // so deleting both families from the type left this test green and only
    // the implementation's own return-type inference noticed.
    expectTypeOf<AbortedError>().toExtend<TypedFetchError>();
    expectTypeOf<TimeoutError>().toExtend<TypedFetchError>();
  });

  test("TypedFetchError is exactly the six families, and nothing else", () => {
    // The hand-written union above catches GROWTH (a new family that does not
    // extend it). This catches SHRINKAGE in the same breath, which is the
    // direction the tautology hid.
    expectTypeOf<TypedFetchError>().toEqualTypeOf<
      ClientErrors | ServerErrors | UnknownHttpError | NetworkError | AbortedError | TimeoutError
    >();
  });

  test("error.url is string on every TypedFetchError family, readable unconditionally", () => {
    // Previously impossible: `url` lived only on BaseHttpError, so code written
    // against the full union could not read `error.url` without narrowing. Now
    // all six families carry `readonly url: string`, so the union's `url` is a
    // plain `string` and this compiles with no guard — a real DX win.
    expectTypeOf<TypedFetchError["url"]>().toEqualTypeOf<string>();
    expectTypeOf<NetworkError["url"]>().toEqualTypeOf<string>();
    expectTypeOf<AbortedError["url"]>().toEqualTypeOf<string>();
    expectTypeOf<TimeoutError["url"]>().toEqualTypeOf<string>();
    expectTypeOf<BaseHttpError["url"]>().toEqualTypeOf<string>();
    // Reading `.url` off the bare union — no narrowing — must type as string.
    const anyError = {} as TypedFetchError;
    expectTypeOf(anyError.url).toEqualTypeOf<string>();
  });

  test("isAbortError narrows to AbortedError", () => {
    const error: unknown = {};
    if (isAbortError(error)) {
      expectTypeOf(error).toEqualTypeOf<AbortedError>();
    }
  });

  test("isTimeoutError narrows to TimeoutError", () => {
    const error: unknown = {};
    if (isTimeoutError(error)) {
      expectTypeOf(error).toEqualTypeOf<TimeoutError>();
    }
  });

  // NOTE: the per-class status/statusText literal coverage that used to
  // live here (3/40 classes) has moved to, and been extended to all 40
  // classes by, the "roster sync" describe block in roster-sync.spec.ts.

  // ── header values ──────────────────────────────────────────────────
  // Two surfaces, deliberately both: `TypedHeaders` is the library's own
  // layer, and `TypedFetchOptions["headers"]` is what a consumer annotates
  // against (TypedHeaders itself stopped being exported in v1.1.0). The
  // consumer slot intersects the platform's own `headers` type, which under
  // `lib.dom` already rejects `undefined` — so only the `TypedHeaders`
  // assertions below distinguish the fixed type from the leaky one in THIS
  // repo's lib profile. See scripts/check-consumer.mjs for the no-DOM pass.
  type HeaderInput = NonNullable<TypedFetchOptions["headers"]>;

  test("header values accept a string on a declared and on a custom name", () => {
    expectTypeOf<{ Authorization: "Bearer t" }>().toExtend<TypedHeaders>();
    expectTypeOf<{ "Content-Type": "application/json" }>().toExtend<TypedHeaders>();
    expectTypeOf<{ "content-type": "application/json" }>().toExtend<TypedHeaders>();
    expectTypeOf<{ "X-Request-Id": string }>().toExtend<TypedHeaders>();
    expectTypeOf<{ Authorization: "Bearer t" }>().toExtend<HeaderInput>();
    expectTypeOf<{ "X-Request-Id": string }>().toExtend<HeaderInput>();
  });

  test("header values reject undefined on a declared name", () => {
    expectTypeOf<{ Authorization: undefined }>().not.toExtend<TypedHeaders>();
    expectTypeOf<{ "Content-Type": undefined }>().not.toExtend<TypedHeaders>();
    expectTypeOf<{ Authorization: string | undefined }>().not.toExtend<TypedHeaders>();
    expectTypeOf<{ Authorization: undefined }>().not.toExtend<HeaderInput>();
  });

  test("header values reject undefined on a custom name", () => {
    expectTypeOf<{ "X-Request-Id": undefined }>().not.toExtend<TypedHeaders>();
    expectTypeOf<{ "X-Request-Id": string | undefined }>().not.toExtend<TypedHeaders>();
    expectTypeOf<Record<string, string | undefined>>().not.toExtend<TypedHeaders>();
    expectTypeOf<{ "X-Request-Id": string | undefined }>().not.toExtend<HeaderInput>();
  });

  test("headers still accept every native input shape", () => {
    expectTypeOf<Headers>().toExtend<TypedHeaders>();
    expectTypeOf<[string, string][]>().toExtend<TypedHeaders>();
    expectTypeOf<Record<string, string>>().toExtend<TypedHeaders>();
    expectTypeOf<Headers>().toExtend<HeaderInput>();
    expectTypeOf<[string, string][]>().toExtend<HeaderInput>();
  });

  test("headers validate no value — autocomplete only", () => {
    expectTypeOf<{ Authorization: "nospaces" }>().toExtend<TypedHeaders>();
    expectTypeOf<{ "X-Requested-With": "banana" }>().toExtend<TypedHeaders>();
    expectTypeOf<{ "Content-Type": string }>().toExtend<TypedHeaders>();
    expectTypeOf<{ Authorization: "nospaces" }>().toExtend<HeaderInput>();
  });

  // ── declared header names: request-side only ───────────────────────
  // The declared names are the autocomplete list for a REQUEST, so the list
  // must hold no response-only name. `TypedHeaders` accepts any string under
  // any name, so a name dropped from the list stays assignable and the change
  // is not visible there. `DeclaredHeaderNames` recovers the DECLARED names by
  // dropping `StrictHeaders`'s index signature, the same way `Named` does
  // inside src/headers.ts. That is the surface the tests below pin.
  type DeclaredHeaderNames = keyof {
    [K in keyof StrictHeaders as string extends K ? never : K]: unknown;
  };

  test("the declared names cover every request-side name they should", () => {
    expectTypeOf<"Content-Type">().toExtend<DeclaredHeaderNames>();
    expectTypeOf<"Authorization">().toExtend<DeclaredHeaderNames>();
    expectTypeOf<"Accept">().toExtend<DeclaredHeaderNames>();
    expectTypeOf<"Accept-Encoding">().toExtend<DeclaredHeaderNames>();
    expectTypeOf<"Accept-Language">().toExtend<DeclaredHeaderNames>();
    expectTypeOf<"Cache-Control">().toExtend<DeclaredHeaderNames>();
    expectTypeOf<"Content-Encoding">().toExtend<DeclaredHeaderNames>();
    expectTypeOf<"Cookie">().toExtend<DeclaredHeaderNames>();
    expectTypeOf<"If-Match">().toExtend<DeclaredHeaderNames>();
    expectTypeOf<"If-Modified-Since">().toExtend<DeclaredHeaderNames>();
    expectTypeOf<"If-None-Match">().toExtend<DeclaredHeaderNames>();
    expectTypeOf<"Origin">().toExtend<DeclaredHeaderNames>();
    expectTypeOf<"Range">().toExtend<DeclaredHeaderNames>();
    expectTypeOf<"Referer">().toExtend<DeclaredHeaderNames>();
    expectTypeOf<"User-Agent">().toExtend<DeclaredHeaderNames>();
    expectTypeOf<"X-Requested-With">().toExtend<DeclaredHeaderNames>();
  });

  test("the declared names hold no response-only name", () => {
    expectTypeOf<"Set-Cookie">().not.toExtend<DeclaredHeaderNames>();
    expectTypeOf<"ETag">().not.toExtend<DeclaredHeaderNames>();
    expectTypeOf<"Last-Modified">().not.toExtend<DeclaredHeaderNames>();
    expectTypeOf<"Location">().not.toExtend<DeclaredHeaderNames>();
    expectTypeOf<"WWW-Authenticate">().not.toExtend<DeclaredHeaderNames>();
    expectTypeOf<"Content-Security-Policy">().not.toExtend<DeclaredHeaderNames>();
    expectTypeOf<"Access-Control-Allow-Origin">().not.toExtend<DeclaredHeaderNames>();
    expectTypeOf<"Access-Control-Allow-Methods">().not.toExtend<DeclaredHeaderNames>();
    expectTypeOf<"Access-Control-Allow-Headers">().not.toExtend<DeclaredHeaderNames>();
    expectTypeOf<"Access-Control-Allow-Credentials">().not.toExtend<DeclaredHeaderNames>();
    expectTypeOf<"X-Frame-Options">().not.toExtend<DeclaredHeaderNames>();
    expectTypeOf<"X-Content-Type-Options">().not.toExtend<DeclaredHeaderNames>();
    expectTypeOf<"Strict-Transport-Security">().not.toExtend<DeclaredHeaderNames>();
  });

  test("the declared names hold no name the platform owns", () => {
    // `fetch` computes Content-Length from the body. On Node a value that
    // does not match the body makes the request throw. Undici replaces Host
    // with the URL's authority. The Fetch Standard forbids Connection, and
    // the connection pool owns the lifetime it describes.
    expectTypeOf<"Content-Length">().not.toExtend<DeclaredHeaderNames>();
    expectTypeOf<"Host">().not.toExtend<DeclaredHeaderNames>();
    expectTypeOf<"Connection">().not.toExtend<DeclaredHeaderNames>();
  });

  test("an undeclared header name still accepts a string value", () => {
    // Dropping a name drops a SUGGESTION, not a capability. The name still
    // reaches `fetch` through TypedHeaders's `Record<string, string>` arm,
    // so code written against the previous name list keeps compiling.
    expectTypeOf<{ "X-Frame-Options": "DENY" }>().toExtend<TypedHeaders>();
    expectTypeOf<{ "Set-Cookie": string }>().toExtend<TypedHeaders>();
    expectTypeOf<{ ETag: '"abc"' }>().toExtend<TypedHeaders>();
    expectTypeOf<{ "Content-Length": "12" }>().toExtend<TypedHeaders>();
    expectTypeOf<{ Host: string }>().toExtend<TypedHeaders>();
    expectTypeOf<{ "Access-Control-Allow-Origin": "*" }>().toExtend<TypedHeaders>();
    expectTypeOf<{ "x-frame-options": "DENY" }>().toExtend<TypedHeaders>();
    expectTypeOf<{ "X-Frame-Options": "DENY" }>().toExtend<HeaderInput>();
    expectTypeOf<{ "Set-Cookie": string }>().toExtend<HeaderInput>();
  });

  test("an undeclared header name still rejects undefined", () => {
    expectTypeOf<{ "X-Frame-Options": undefined }>().not.toExtend<TypedHeaders>();
    expectTypeOf<{ ETag: string | undefined }>().not.toExtend<TypedHeaders>();
    expectTypeOf<{ "X-Frame-Options": undefined }>().not.toExtend<HeaderInput>();
  });

  test("If-Match accepts an entity tag, a weak tag, a wildcard, and any string", () => {
    expectTypeOf<{ "If-Match": '"v1"' }>().toExtend<TypedHeaders>();
    expectTypeOf<{ "If-Match": 'W/"v1"' }>().toExtend<TypedHeaders>();
    expectTypeOf<{ "If-Match": "*" }>().toExtend<TypedHeaders>();
    expectTypeOf<{ "if-match": '"v1"' }>().toExtend<TypedHeaders>();
    expectTypeOf<{ "If-Match": "anything" }>().toExtend<TypedHeaders>();
    expectTypeOf<{ "If-Match": '"v1"' }>().toExtend<HeaderInput>();
    expectTypeOf<{ "If-Match": undefined }>().not.toExtend<TypedHeaders>();
  });

  test("Cache-Control suggests request directives, not response directives", () => {
    // RFC 9111 section 5.2.1 lists the request directives. `public`,
    // `private`, and `must-revalidate` are response directives (section
    // 5.2.2). The union stays open, so a response directive still compiles;
    // this assertion pins what the type SUGGESTS, not what it accepts.
    expectTypeOf<StrictHeaders["Cache-Control"]>().toEqualTypeOf<
      | "no-cache"
      | "no-store"
      | "no-transform"
      | "only-if-cached"
      | "max-age=0"
      | (string & {})
      | undefined
    >();
    expectTypeOf<{ "Cache-Control": "public" }>().toExtend<TypedHeaders>();
  });

  // ── the identity refactor changed no declared type ─────────────────

  test("TL-01: the error constructor still takes exactly one parameter", () => {
    // The guard against an optional second constructor parameter leaking in as
    // the identity handoff. A parameter there would widen a PUBLIC signature:
    // it would appear in both emitted declaration files, in every consumer's
    // IDE, and in the documented subclass contract — and the public-surface
    // snapshots freeze export NAMES, so nothing else would catch it.
    expectTypeOf(NotFoundError).toBeConstructibleWith(new Response(null, { status: 404 }));

    const response = new Response(null, { status: 404 });
    // @ts-expect-error — a second constructor argument does not exist.
    const extraArgument = new NotFoundError(response, {} as never);
    // Bound rather than discarded, so the line is a real construction and not
    // a statement a linter can read as a side effect.
    expect(extraArgument).toBeInstanceOf(NotFoundError);
  });

  test("TL-02: status is declared a number, and the runtime now keeps that promise", () => {
    // `UnknownHttpError.status` used to be able to hold the STRING a custom
    // Fetch implementation reported. The declared type never changed; what
    // changed is that it stopped being a promise the runtime could break.
    expectTypeOf<UnknownHttpError["status"]>().toEqualTypeOf<number>();
    expectTypeOf<BaseHttpError["status"]>().toEqualTypeOf<number>();
  });

  test("json<T>() returns Promise<T>", () => {
    const error = new NotFoundError(new Response(JSON.stringify({}), { status: 404 }));
    expectTypeOf(error.json<{ message: string }>()).toEqualTypeOf<Promise<{ message: string }>>();
  });
});
