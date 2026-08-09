/**
 * RESPONSES THE SUITES BUILD BY HAND.
 *
 * A synthesised `Response` reports an empty `url`, and `url` is read-only, so
 * every suite that asks what the library does with a url has to define the
 * property itself. That incantation, and three stream-backed responses that
 * report what the library did to their source, were copied file by file.
 *
 * Each helper below takes a parameter wherever the copies DISAGREED, rather
 * than flattening the difference: a response with a `null` body and one with a
 * `"{}"` body answer `cancel()` differently, and the difference is the point in
 * the suite that chose it.
 */

/**
 * A `Response` that reports `url`, the way a real fetch sets it.
 *
 * `body` is the parameter the copies disagreed on. A `null` body has no stream
 * to release, so a suite about cancellation needs the default and a suite about
 * identity alone can pass `null`.
 */
export function responseWith(url: string, status = 404, body: BodyInit | null = "{}"): Response {
  const response = new Response(body, { status, statusText: "Not Found" });
  Object.defineProperty(response, "url", { value: url, configurable: true });
  return response;
}

/**
 * A response whose body records whether it was cancelled and whether anything
 * ever pulled from it.
 *
 * `cancel()` must reach the stream WITHOUT buffering, so `pulled` has to stay
 * false. That is this response's whole reason to exist, and it is why it is not
 * the same helper as {@link releaseTrackedResponse}: the two track different
 * facts about the source, and a suite asserts on the one it asked for.
 *
 * `status` has no default. The copies defaulted to 200 and to 404, and a
 * default here would silently move one of them.
 */
export function pullTrackedResponse(status: number): {
  response: Response;
  state: { cancelled: boolean; reason: unknown; pulled: boolean };
} {
  const state = { cancelled: false, reason: undefined as unknown, pulled: false };
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      state.pulled = true;
      controller.enqueue(new TextEncoder().encode("payload"));
      controller.close();
    },
    cancel(reason) {
      state.cancelled = true;
      state.reason = reason;
    },
  });
  return { response: new Response(body, { status }), state };
}

/**
 * A `Response` over a stream that records whether its source was released,
 * either by a cancellation or by a read that ran to completion.
 */
export function releaseTrackedResponse(status = 500): {
  response: Response;
  state: { released: boolean };
} {
  const state = { released: false };
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new TextEncoder().encode('{"a":1}'));
      controller.close();
      state.released = true;
    },
    cancel() {
      state.released = true;
    },
  });
  return { response: new Response(body, { status }), state };
}

/**
 * Builds a `foreignResponse(overrides)` for one url: a plain object that
 * satisfies the `TypedResponse` baseline without being a platform `Response`.
 *
 * The url is bound once, by the caller, because the two suites that use this
 * plant different urls and each one's assertions name its own.
 */
export function foreignResponses(url: string): (overrides?: Record<string, unknown>) => Response {
  return function foreignResponse(overrides: Record<string, unknown> = {}): Response {
    const base: Record<string, unknown> = {
      [Symbol.toStringTag]: "Response",
      body: null,
      bodyUsed: false,
      headers: new Headers(),
      ok: true,
      redirected: false,
      status: 200,
      statusText: "OK",
      type: "basic",
      url,
      arrayBuffer: async () => new ArrayBuffer(0),
      blob: async () => new Blob(),
      clone: () => foreignResponse(overrides),
      formData: async () => new FormData(),
      json: async () => ({}),
      text: async () => "",
    };
    return { ...base, ...overrides } as unknown as Response;
  };
}

/**
 * A deterministic PRNG, so a failure names an input a rerun reproduces.
 *
 * Mulberry32. Five suites carried this, one of them spelled differently
 * (`1 | state` for `state | 1`, and the xor written on the other side). The
 * spellings were checked to produce identical sequences before they were
 * merged, because a suite whose generated population silently changed is worse
 * than a duplicate.
 */
export function mulberry(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
