import { createRequire } from "node:module";
import { inspect } from "node:util";
import { describe, test, expect } from "vitest";
import {
  errorsDistExists as distExists,
  loadErrorsEsm,
  loadRootEsm,
  warnWhenDistMissing,
} from "../../fixtures/built-package";

// ═══════════════════════════════════════════════════════════════════════════
// ROUND 12, LANE H4 — the prose rounds 10 and 11 wrote, executed against the
// BUILT package.
//
// Round 11 rewrote `SECURITY.md`'s residual 2 (the region-END rule and the one
// residual it says is left), widened residual 1 to name both channels that keep
// `error.cause`, added a Phase sentence to `CONTEXT.md`, and recorded four
// measured properties in the ledger. Each of those is a testable claim, and
// each one below is asserted through `dist/` — the artifact a consumer installs
// — rather than through `src/`.
// ═══════════════════════════════════════════════════════════════════════════

warnWhenDistMissing("round12-h4", distExists);

type ErrorLike = Error & {
  url: string;
  cancel(): Promise<void>;
  toJSON(): { url?: string };
};
type ErrorsBag = { NotFoundError: new (response: Response) => ErrorLike };
type RootBag = {
  typedFetch: (
    input: unknown,
    options: Record<string, unknown>,
  ) => Promise<{ response: Response | null; error: (Error & { cause?: unknown }) | null }>;
};

const loadErrors = (): Promise<ErrorsBag> => loadErrorsEsm<ErrorsBag>();

const loadRoot = (): Promise<RootBag> => loadRootEsm<RootBag>();

/** The `url` the BUILT package emits for a 404 over a response reporting `url`. */
async function emittedUrl(url: string): Promise<string> {
  const { NotFoundError } = await loadErrors();
  const response = new Response(null, { status: 404, statusText: "Not Found" });
  Object.defineProperty(response, "url", { value: url, configurable: true });
  const error = new NotFoundError(response);
  await error.cancel();
  return error.toJSON().url ?? "";
}

// ═══════════════════════════════════════════════════════════════════════════
// R12-H4-01 — a credential that SPELLS the authority mark ends its own region,
// and the text before the mark survives in every channel.
//
// `SECURITY.md` residual 2 states the rule round 11 landed:
//
//   "A region opens where the URL Standard opens an authority: at two or more
//    solidi under any scheme, and at a SPECIAL scheme over any number of
//    solidi, including none. A region ends at every `@` inside it. Each `@` is
//    asked, on its own, whether the text before it is userinfo. The removed
//    span is the union of the `@` marks that answer yes."
//
// and closes with a width claim:
//
//   "The one residual left is a credential whose LAST character is `/`."
//
// Apply the stated rule by hand to
// `https://api.test/go/https://alice:s3cret://x@internal.test/v1`. The region
// opens after `https://`. It holds exactly one `@`, the one at `x@`. The text
// before it is `alice:s3cret://x`, which has a `:` before its first `/` — the
// second of the three shapes the rule calls userinfo. So the union of the yes
// answers is the whole credential, and the emitted url should name
// `internal.test` and nothing before it.
//
// The built package keeps `alice:s3cret`. A region does not only end at an `@`:
// it also ends at the next `://`, and this credential spells one. The mark that
// closes a region is the one thing a password can write, so a password that
// contains `://` chooses where its own authority stops and its head rides out.
//
// That is not the residual the documents name, on any of the three counts:
//
//  - `SECURITY.md` says the one residual left is a credential ending in `/`.
//    This one ends in `x`.
//  - The ledger's round-9 entry scopes the region-cut-short residual to a
//    credential "with no `@` of its own before it". This one has its own `@`.
//  - `redact-url.ts` scopes the same residual the same way, on
//    `malformedUserinfoSpans`.
//
// Round 9's own argument for keeping the END mark narrow was that widening it
// "gives a password that spells `:/` the power to end its own region and emit
// the prefix". The narrow mark hands the same power to a password that spells
// `://`, three characters instead of two.
//
// The suite's pinned counter-example does not stand in the way of closing it.
// `://host1/x://u2:pw@host2/v1` must keep `host1`, and it still would: that
// region has no `:` before its first `/`, so the second rule answers no for it
// and yes for `alice:s3cret://x`.
// ═══════════════════════════════════════════════════════════════════════════

const PASSWORD = "s3cretPASSWORD";

describe.skipIf(!distExists)("R12-H4-01: a credential that spells the authority mark", () => {
  test("a credential containing :// is removed from error.url", async () => {
    const url = `https://api.test/go/https://alice:${PASSWORD}://x@internal.test/v1`;

    const emitted = await emittedUrl(url);

    // The redaction must not move the host it names — the invariant every
    // round since 9 has held onto — so this is asserted alongside, not instead.
    expect(emitted.startsWith("https://api.test/")).toBe(true);
    expect(
      emitted,
      "SECURITY.md residual 2 asks every `@` in the region on its own, and " +
        "`alice:s3cret…://x` has a `:` before its first `/` — the second shape " +
        "the rule calls userinfo",
    ).not.toContain(PASSWORD);
  });

  test("the same credential spelled with the solidi the parser writes", async () => {
    // The caller writes backslashes; the URL parser rewrites them to solidi
    // before this module ever reads the path, so the credential spells the
    // authority mark without ever containing one. Round 9 closed exactly this
    // shape one solidus narrower (`://svc:hun\ter2@host`), which is why the
    // rewrite is documented on `isSolidus` rather than discovered here.
    const url = `https://api.test/go/https://alice:${PASSWORD}:\\\\x@internal.test/v1`;

    const emitted = await emittedUrl(url);

    expect(emitted.startsWith("https://api.test/")).toBe(true);
    expect(emitted).not.toContain(PASSWORD);
  });

  test("every channel carries what error.url kept", async () => {
    const { NotFoundError } = await loadErrors();
    const url = `https://api.test/go/https://alice:${PASSWORD}://x@internal.test/v1`;
    const response = new Response(null, { status: 404, statusText: "Not Found" });
    Object.defineProperty(response, "url", { value: url, configurable: true });
    const error = new NotFoundError(response);
    await error.cancel();

    // A disclosure decision applies to the channel set, never to one channel,
    // so the leak is measured across the ones a logger actually reaches.
    for (const [channel, text] of [
      ["message", error.message],
      ["toJSON", JSON.stringify(error.toJSON())],
      ["toString", String(error)],
      ["util.inspect", inspect(error)],
    ] as const) {
      expect(text, `${channel} must not carry the password`).not.toContain(PASSWORD);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The ledger's round-11 measurements, re-run against the built package.
//
// "Once every `@` is asked, the heuristic set strictly contains what `new URL`
// answers" and "a hierarchical redaction is a FIXED POINT,
// `redactUrl(redactUrl(u)) === redactUrl(u)`". Both were measured against
// `src/` while the fix was being made. They travel with the artifact only if
// something asserts them there.
// ═══════════════════════════════════════════════════════════════════════════

/** A seeded generator, so a failure names an input a reader can paste. */
function generator(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

describe.skipIf(!distExists)("what the ledger measured, against dist/", () => {
  const SCHEMES = ["https", "http", "ftp", "ws", "wss", "file", "git", "x", "custom+1", ""];
  const SOLIDI = ["", "/", "//", "///", "\\\\", "/\\", "\\/"];
  const USERS = ["USERTOK", "USERTOK/x", "USERTOK.y", "USERTOK%2Fy"];
  const PASSES = ["", ":PASSTOK", ":PASSTOK/x", ":x/PASSTOK", ":PASSTOK/"];
  const TAILS = ["", "/v1", "/img/@alice", "/users/@bob", "/a@b/c"];
  const HOSTS = ["host.test", "[::1]", "h.test:8443"];

  test(
    "a credential the URL parser itself confirms is never emitted",
    { timeout: 60_000 },
    async () => {
      const random = generator(20261212);
      const pick = <T>(values: readonly T[]): T => {
        const chosen = values[Math.floor(random() * values.length)];
        if (chosen === undefined) throw new Error("the generator needs a non-empty table");
        return chosen;
      };

      const failures: string[] = [];
      let confirmed = 0;
      for (let round = 0; round < 30_000 && failures.length < 5; round += 1) {
        const embedded =
          `${pick(SCHEMES)}:${pick(SOLIDI)}${pick(USERS)}${pick(PASSES)}` +
          `@${pick(HOSTS)}${pick(TAILS)}`;
        let parsed: URL | null = null;
        try {
          parsed = new URL(embedded);
        } catch {
          parsed = null;
        }
        // Only the rows the PARSER calls a credential. The heuristics answer
        // yes for more than this; the ledger's claim is containment, not
        // equality, so the rows it does not confirm decide nothing here.
        if (parsed === null || (parsed.username === "" && parsed.password === "")) continue;
        confirmed += 1;
        const emitted = await emittedUrl(`https://api.test/go/${embedded}`);
        if (emitted.includes("USERTOK") || emitted.includes("PASSTOK")) {
          failures.push(`${JSON.stringify(embedded)} — emitted ${JSON.stringify(emitted)}`);
        }
      }

      expect(
        confirmed,
        "the corpus must actually reach parser-confirmed credentials",
      ).toBeGreaterThan(1_000);
      expect(failures).toEqual([]);
    },
  );

  test("a hierarchical redaction is a fixed point of itself", { timeout: 60_000 }, async () => {
    const random = generator(20261112);
    const pick = <T>(values: readonly T[]): T => {
      const chosen = values[Math.floor(random() * values.length)];
      if (chosen === undefined) throw new Error("the generator needs a non-empty table");
      return chosen;
    };

    const failures: string[] = [];
    for (let round = 0; round < 6_000 && failures.length < 5; round += 1) {
      const embedded =
        `${pick(SCHEMES)}:${pick(SOLIDI)}${pick(USERS)}${pick(PASSES)}` +
        `@${pick(HOSTS)}${pick(TAILS)}`;
      const input = `https://api.test/go/${embedded}${pick(["", "?q=1", "#f", "?a=://b@c"])}`;
      const once = await emittedUrl(input);
      const twice = await emittedUrl(once);
      if (twice !== once) {
        failures.push(
          `${JSON.stringify(input)} — ${JSON.stringify(once)} then ${JSON.stringify(twice)}`,
        );
      }
    }

    expect(failures).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// `SECURITY.md` residual 1, and whether a consumer who follows it EXACTLY is
// covered.
//
// Round 11's finding was that advice naming one of two channels leaves a reader
// exposed. The bullet now names both, and adds an instruction: "Do not pass an
// error to `structuredClone` or `postMessage` without removing `cause` first."
// So the consumer who does exactly that is constructed here, and the whole
// clone is searched — `structuredClone` copies `name`, `message`, `stack`, and
// `cause`, and the advice only addresses one of the four.
// ═══════════════════════════════════════════════════════════════════════════

describe.skipIf(!distExists)("residual 1's advice, followed exactly", () => {
  const CREDENTIAL = "hunter2SECRET";
  const CREDENTIALED_URL = `https://alice:${CREDENTIAL}@api.example.com/v1/x?token=${CREDENTIAL}`;

  async function builtRequestFailure(): Promise<Error & { cause?: unknown }> {
    const { typedFetch } = await loadRoot();
    const { error } = await typedFetch(CREDENTIALED_URL, {
      // Verbatim undici, which is where this string comes from in production.
      fetch: async () => {
        throw new TypeError(
          `Request cannot be constructed from a URL that includes credentials: ${CREDENTIALED_URL}`,
        );
      },
    });
    if (error === null) throw new Error("expected a request failure");
    return error;
  }

  test("removing cause is enough — no other cloned slot carries the credential", async () => {
    const error = await builtRequestFailure();

    // The half the bullet warns about: this is what a consumer who ignores it
    // ships into the other realm.
    const leaked = structuredClone(error) as { cause?: Error };
    expect(String(leaked.cause?.message)).toContain(CREDENTIAL);

    // The half the bullet promises: the instruction it gives is sufficient.
    delete error.cause;
    const cloned = structuredClone(error) as unknown as Record<string, unknown>;
    for (const slot of Object.getOwnPropertyNames(cloned)) {
      expect(String(cloned[slot] ?? ""), `${slot} must not carry the credential`).not.toContain(
        CREDENTIAL,
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// `CONTEXT.md`'s Phase sentence, executed against the built package.
//
// "The setup phase can end a call only for a read that PRODUCES what the
// transport receives — the input serialization, the transport selection, the
// init — never for a read that only describes the request."
//
// Round 11 proved it for the `signal` read on a `Proxy`. The sentence is wider
// than that one read, so every OWN member the setup phase can touch on a
// handed-over `Request` is made to throw here, one at a time, and the request
// must still leave.
// ═══════════════════════════════════════════════════════════════════════════

describe.skipIf(!distExists)("a describing read never ends a call", () => {
  test.each(["url", "signal", "method", "headers", "body", "bodyUsed"])(
    "a handed-over Request whose own %s getter throws still reaches the transport",
    async (member) => {
      const { typedFetch } = await loadRoot();
      const request = new Request("https://api.test/v1");
      Object.defineProperty(request, member, {
        get() {
          throw new Error(`${member} boom`);
        },
        configurable: true,
      });

      let reached = 0;
      const { response, error } = await typedFetch(request, {
        fetch: async () => {
          reached += 1;
          return new Response("ok", { status: 200 });
        },
      });

      expect(reached, `a throwing ${member} getter refused the whole request`).toBe(1);
      expect(error).toBeNull();
      expect(response?.status).toBe(200);
    },
  );

  test("a Symbol.toStringTag that throws still reaches the transport", async () => {
    const { typedFetch } = await loadRoot();
    const request = new Request("https://api.test/v2");
    Object.defineProperty(request, Symbol.toStringTag, {
      get() {
        throw new Error("tag boom");
      },
      configurable: true,
    });

    let reached = 0;
    const { error } = await typedFetch(request, {
      fetch: async () => {
        reached += 1;
        return new Response("ok", { status: 200 });
      },
    });

    expect(reached).toBe(1);
    expect(error).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The frozen surface after four rounds of source changes.
//
// `CONTEXT.md` names five members stamped with `defineProperty` — the two
// brands, the inspect hook under Node's key, the same hook under Deno's key,
// the ownership query, and the string-conversion hook — and states which of
// them are frozen and which stay replaceable. A consumer can hold FOUR copies
// of this library (two entry points × two formats), and the rule is about the
// stamp, not about the file it happens to be built into. Nothing has read all
// four bags against each other since the stamps were last changed.
// ═══════════════════════════════════════════════════════════════════════════

type Bag = { NotFoundError: new (response: Response) => ErrorLike };

/** The descriptor of `key` wherever it sits on the prototype chain. */
function stampOf(bag: Bag, key: symbol): PropertyDescriptor | undefined {
  let proto: object | null = bag.NotFoundError.prototype;
  while (proto !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, key);
    if (descriptor !== undefined) return descriptor;
    proto = Object.getPrototypeOf(proto) as object | null;
  }
  return undefined;
}

describe.skipIf(!distExists)("every copy carries the same stamps", () => {
  test("the four copies agree on all five stamps", async () => {
    const requireCjs = createRequire(import.meta.url);
    const bags: [string, Bag][] = [
      ["cjs root", requireCjs("../../dist/index.js") as Bag],
      ["cjs errors", requireCjs("../../dist/errors/index.js") as Bag],
      ["esm root", (await loadRoot()) as unknown as Bag],
      ["esm errors", await loadErrors()],
    ];

    // key, what it carries, and whether a consumer may replace it.
    const stamps: [symbol, "marker" | "function", boolean][] = [
      [Symbol.for("@pbpeterson/typed-fetch.BaseHttpError"), "marker", false],
      [Symbol.for("@pbpeterson/typed-fetch.KnownHttpError"), "marker", false],
      [Symbol.for("@pbpeterson/typed-fetch.ownsResponse"), "function", false],
      [Symbol.for("nodejs.util.inspect.custom"), "function", true],
      [Symbol.for("Deno.customInspect"), "function", true],
      [Symbol.toPrimitive, "function", true],
    ];

    for (const [key, carries, replaceable] of stamps) {
      for (const [name, bag] of bags) {
        const descriptor = stampOf(bag, key);
        expect(descriptor, `${name} is missing ${String(key)}`).toBeDefined();
        expect(typeof descriptor?.value, `${name}: ${String(key)}`).toBe(
          carries === "marker" ? "boolean" : "function",
        );
        expect(descriptor?.writable, `${name}: ${String(key)} writable`).toBe(replaceable);
        expect(descriptor?.configurable, `${name}: ${String(key)} configurable`).toBe(replaceable);
      }
    }
  });

  // That the two declaration files differ only in the specifier they import is
  // asserted once, in `surface-cause-channels.spec.ts`, which carries the
  // reason the comparison exists.
});
