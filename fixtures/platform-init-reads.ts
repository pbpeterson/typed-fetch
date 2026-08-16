// ═══════════════════════════════════════════════════════════════════════════
// WHICH `RequestInit` MEMBERS THIS PLATFORM READS.
//
// Not a constant, because it is not constant. `Request` reads the init through
// a WebIDL dictionary conversion, and both the SET and the ORDER have moved
// between the undici generations this package supports:
//
//   undici 6 (Node 20, 22)  15 members, spec order, `priority` NOT read
//   undici 7 (Node 24)      16 members, spec order
//   undici 8 (Node 26)      16 members, lexicographic order
//
// Three suites pinned undici 8's answer as a literal and went red on the two
// LTS majors the package supports — `engines` is `>=20.13.0`. The pin was never
// a claim about this library: it is a claim about the platform, and the
// platform is the only thing entitled to answer it.
//
// So the suites ask HERE, at run time, and assert what this library does
// RELATIVE to what the platform did. A member the platform never reads cannot
// carry a getter this library is obliged to notice.
// ═══════════════════════════════════════════════════════════════════════════

/** Every member name a `RequestInit` can carry, across the platforms in play. */
export const CANDIDATE_INIT_MEMBERS = [
  "body",
  "cache",
  "credentials",
  "dispatcher",
  "duplex",
  "headers",
  "integrity",
  "keepalive",
  "method",
  "mode",
  "priority",
  "redirect",
  "referrer",
  "referrerPolicy",
  "signal",
  "window",
] as const;

/**
 * The members this platform reads, in the order it reads them.
 *
 * Measured by constructing one `Request` over an init whose every candidate
 * member is an accessor. Synchronous, no network, no server.
 */
export function platformInitReadOrder(): readonly string[] {
  const order: string[] = [];
  const init: Record<string, unknown> = {};
  for (const member of CANDIDATE_INIT_MEMBERS) {
    Object.defineProperty(init, member, {
      enumerable: true,
      get() {
        order.push(member);
        return undefined;
      },
    });
  }
  new Request("https://platform-probe.invalid/", init as RequestInit);
  return order;
}

/**
 * Whether applying the platform `status` accessor to `candidate` throws.
 *
 * Split out so BOTH answers are exercised on every runtime. Asked only of the
 * real `Response` wrapper, one of the two paths is dead on any given platform —
 * undici 6 never throws, undici 7+ always does — and a 100 percent threshold
 * cannot hold for code whose reachable half depends on the runtime.
 */
export function statusAccessorThrowsOn(candidate: object): boolean {
  const statusGetter = Object.getOwnPropertyDescriptor(Response.prototype, "status")?.get;
  try {
    Reflect.apply(statusGetter as () => number, candidate, []);
    return false;
  } catch {
    return true;
  }
}

/**
 * Whether this runtime keeps a `Response`'s internal state where a trapless
 * `Proxy` cannot forward it.
 *
 * undici 6 (Node 20, 22) keeps it in a symbol-keyed property, which a `Proxy`
 * with no handler forwards — so the platform accessor answers for the wrapper
 * exactly as it answers for the target, and the wrapper is indistinguishable
 * AND fully usable. undici 7 and later moved it to a private field, which no
 * `Proxy` carries, so the same accessor throws.
 *
 * Measured, never read off a version number: Bun and Deno ship neither undici
 * build and answer for themselves.
 */
export function responseSlotsResistProxy(): boolean {
  return statusAccessorThrowsOn(new Proxy(new Response(null, { status: 204 }), {}));
}
