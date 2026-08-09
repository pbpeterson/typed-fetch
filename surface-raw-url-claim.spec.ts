import { existsSync, readFileSync } from "node:fs";
import { describe, test, expect } from "vitest";

// ═══════════════════════════════════════════════════════════════════════════
// ROUND 14, LANE H4 — the sentences round 13's docs pass CORRECTED, executed
// against the BUILT package, plus the width of every residual `SECURITY.md`
// names.
//
// Round 13 corrected two sentences that five previous rounds had read without
// measuring: `file:` was wrongly listed among the schemes that open a region,
// and the `%3A` bullet was false in both directions. This round re-measures
// the corrections themselves. A correction can be wrong in a new way, and the
// residual bullets are where round 10's and round 13's criticals came from —
// each was a sentence that claimed a limit NARROWER than the one the module
// actually holds.
//
// Everything here reads `dist/`, the artifact a consumer installs, and every
// document sentence is quoted from the file at run time so a rewritten
// sentence cannot leave a stale quotation behind.
// ═══════════════════════════════════════════════════════════════════════════

const distExists = existsSync(new URL("./dist/errors/index.mjs", import.meta.url));

if (!distExists) {
  if (process.env.CI) {
    throw new Error(
      "[round14-h4] dist/ not found in CI — .github/workflows/ci.yml must run " +
        "`pnpm build` before `pnpm test` so the dist-gated suites run for real.",
    );
  }
  // eslint-disable-next-line no-console
  console.warn(
    "\n[round14-h4] dist/ not found — skipping the built-surface suites. " +
      "Run `pnpm build` first (e.g. `pnpm build && pnpm test`) to exercise them.\n",
  );
}

type ErrorLike = Error & {
  url: string;
  headers: Headers;
  cancel(): Promise<void>;
  toJSON(): { url?: string };
};
type ErrorsBag = { NotFoundError: new (response: Response) => ErrorLike };

const loadErrors = async (): Promise<ErrorsBag> =>
  (await import(
    /* @vite-ignore */ new URL("./dist/errors/index.mjs", import.meta.url).href
  )) as ErrorsBag;

type Envelope = { response: Response | null; error: (Error & { cause?: unknown }) | null };
type RootBag = {
  typedFetch: (input: string, options?: Record<string, unknown>) => Promise<Envelope>;
};

const loadRoot = async (): Promise<RootBag> =>
  (await import(/* @vite-ignore */ new URL("./dist/index.mjs", import.meta.url).href)) as RootBag;

/** A built `NotFoundError` over a `Response` reporting `url`, body released. */
async function errorFor(url: string): Promise<ErrorLike> {
  const { NotFoundError } = await loadErrors();
  const response = new Response(null, { status: 404, statusText: "Not Found" });
  Object.defineProperty(response, "url", { value: url, configurable: true });
  const error = new NotFoundError(response);
  await error.cancel();
  return error;
}

/** The REDACTED url the built package emits — the `toJSON()` record's copy. */
async function emittedUrl(url: string): Promise<string> {
  return (await errorFor(url)).toJSON().url ?? "";
}

const documentText = (name: string): string =>
  readFileSync(new URL(`./${name}`, import.meta.url), "utf8");

/** A document sentence with its line wrapping removed, so a quote can be found. */
const unwrapped = (text: string): string => text.replaceAll(/\s+/g, " ");

// ═══════════════════════════════════════════════════════════════════════════
// R14-H4-01 — `SECURITY.md` residual 2 claims a redaction property for
// `error.url`, and `error.url` is the RAW href.
//
// Residual 2 ends with the strongest sentence in the document, and it names a
// property:
//
//   "`error.url` never emits a byte the caller wrote after a `?` or a `#`,
//    under any spelling."
//
// `error.url` is the documented ESCAPE HATCH. The same document says so four
// bullets later — "`error.url` and `error.headers` hold the raw values" — and
// the built package agrees with the second sentence: `error.url` is
// `response.url` verbatim, query, fragment, and credentials included. The
// redacted copy lives on `toJSON().url` and inside `message`.
//
// So the document contradicts itself about the one property a consumer reads
// when they decide whether a signed query parameter may go into a log line,
// and it is the SAFE-sounding half that is false. Round 13's H4 quoted this
// sentence and measured `toJSON().url` against it — the substitution was
// silent, and it is why the sentence survived four rounds.
// ═══════════════════════════════════════════════════════════════════════════

describe.skipIf(!distExists)("residual 2 names a property that does not have the property", () => {
  const QUERY = "QSECRET";
  const FRAGMENT = "FSECRET";
  const URL_UNDER_TEST = `https://api.test/v1?token=${QUERY}#note=${FRAGMENT}`;

  test("`error.url` is the raw href — every byte after `?` and `#` survives", async () => {
    const error = await errorFor(URL_UNDER_TEST);

    // The escape hatch works exactly as the LATER bullet promises. This half
    // is the one that must not change: round 11 pinned the same property, and
    // `clone()`, `recreate`, and the identity record all read it.
    expect(error.url).toBe(URL_UNDER_TEST);

    // And the redacted copy — the one residual 2 is really describing — does
    // hold the property the sentence claims.
    expect(error.toJSON().url).toBe("https://api.test/v1");
    expect(error.message).not.toContain(QUERY);
    expect(error.message).not.toContain(FRAGMENT);
  });

  test("`SECURITY.md` must not claim `error.url` drops what follows a `?` or a `#`", async () => {
    const security = unwrapped(documentText("SECURITY.md"));
    const CLAIM = "`error.url` never emits a byte the caller wrote after a `?` or a `#`";

    const error = await errorFor(URL_UNDER_TEST);
    const carried = [QUERY, FRAGMENT].filter((byte) => error.url.includes(byte));

    // The document may make the claim only about something that holds it.
    // `error.url` carries both sentinels, so the sentence must name the
    // channels that redact — `error.message` and `toJSON()` — instead.
    expect({
      sentenceInSecurityMd: security.includes(CLAIM),
      bytesErrorUrlCarries: carried,
    }).toEqual({
      sentenceInSecurityMd: false,
      bytesErrorUrlCarries: [QUERY, FRAGMENT],
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// R14-H4-02 — the `file:` correction is false against the built package, in
// the direction opposite to the error it replaced.
//
// Round 13 removed `file` from residual 2's special-scheme list and wrote the
// exclusion out:
//
//   "`file:` is the one special scheme this rule excludes: the URL Standard
//    gives it its own state, so a `file:` reference under fewer than two
//    solidi is a path with an empty host, exactly as `git:/svc:pw@host` is,
//    and keeps its text."
//
// The URL Standard half is right, and `redaction-oracle.spec.ts`
// pins it from the platform. The MODULE never moved. `SPECIAL_SCHEMES` is
// derived from `HIERARCHICAL_PROTOCOLS` — the "path is structure" list, which
// must contain `file:` — and `authorityAt` opens a region for every member of
// it at any solidus count. So the built package removes a span from a `file:`
// reference that the parser reads as an ordinary path, and `git:` in the same
// shape keeps its text, which is the comparison the sentence itself draws.
//
// The cost is a deleted path segment in `error.message` and in the `toJSON()`
// record: `https://api.test/go/file:/Users/alice@corp/report.pdf` is emitted
// as `https://api.test/go/file:/corp/report.pdf`.
// ═══════════════════════════════════════════════════════════════════════════

describe.skipIf(!distExists)("a `file:` reference under fewer than two solidi", () => {
  test("the URL Standard reads it as a path with an empty host and no credential", () => {
    // The document's justification, measured on the platform this package
    // runs on, at both solidus counts the sentence covers.
    for (const solidi of ["", "/"]) {
      const parsed = new URL(`file:${solidi}svc:pw@host`);
      expect({
        solidi,
        host: parsed.host,
        username: parsed.username,
        password: parsed.password,
        pathname: parsed.pathname,
      }).toEqual({
        solidi,
        host: "",
        username: "",
        password: "",
        pathname: "/svc:pw@host",
      });
    }

    // `git:` is the comparison the sentence draws, and it answers identically.
    expect(new URL("git:/svc:pw@host").username).toBe("");
    expect(new URL("git:/svc:pw@host").pathname).toBe("/svc:pw@host");
  });

  test("keeps its text, exactly as `git:/svc:pw@host` does", async () => {
    // The control: a non-special scheme in the identical shape. This is
    // residual 4, and it passes.
    expect(await emittedUrl("https://api.test/go/git:/svc:pw@host/v1")).toBe(
      "https://api.test/go/git:/svc:pw@host/v1",
    );

    // The claim. Both solidus counts the sentence covers.
    expect(await emittedUrl("https://api.test/go/file:/svc:pw@host/v1")).toBe(
      "https://api.test/go/file:/svc:pw@host/v1",
    );
    expect(await emittedUrl("https://api.test/go/file:svc:pw@host/v1")).toBe(
      "https://api.test/go/file:svc:pw@host/v1",
    );

    // What the same defect costs a reader who is not attacking anything: the
    // segment naming WHO the file belongs to disappears from the message.
    expect(await emittedUrl("https://api.test/go/file:/Users/alice@corp/report.pdf")).toBe(
      "https://api.test/go/file:/Users/alice@corp/report.pdf",
    );
  });

  test("the other five special schemes DO open a region, and must keep doing so", async () => {
    // The correction must not widen past `file:`. Every other special scheme
    // reaches its authority over no solidi at all, the parser says so, and the
    // module must go on removing the credential.
    for (const scheme of ["http", "https", "ws", "wss", "ftp"]) {
      expect(new URL(`${scheme}:svc:pw@host.test/v1`).username).toBe("svc");
      expect(await emittedUrl(`https://api.test/go/${scheme}:svc:pw@host.test/v1`)).toBe(
        `https://api.test/go/${scheme}:host.test/v1`,
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The `%3A` / `%40` bullet, rewritten in round 13, measured claim by claim.
//
// This is the sentence that was false in BOTH directions before. Every url it
// names is executed here, in the spelling it is written in, so a later
// rewrite that drifts fails instead of reading well.
// ═══════════════════════════════════════════════════════════════════════════

describe.skipIf(!distExists)("a percent-encoded delimiter is not a delimiter", () => {
  test("the bullet's own urls are all still in the document", () => {
    const security = unwrapped(documentText("SECURITY.md"));
    for (const quoted of [
      "`https://api.test/go/https%3A/svc:SECRET@i.test/v1` and `https://api.test/go/https%3Asvc:SECRET@i.test/v1` keep `svc:SECRET@` in full",
      "`https://api.test/go/https://svc%3APW%40host/v1` keeps `svc%3APW%40host` in full",
      "`https://api.test/go/https%3A//svc:SECRET@i.test/v1`, DOES redact to `https://api.test/go/https%3A//i.test/v1`",
    ]) {
      expect(security).toContain(quoted);
    }
  });

  test("`%3A` at zero and one solidus shields the credential", async () => {
    expect(await emittedUrl("https://api.test/go/https%3Asvc:SECRET@i.test/v1")).toBe(
      "https://api.test/go/https%3Asvc:SECRET@i.test/v1",
    );
    expect(await emittedUrl("https://api.test/go/https%3A/svc:SECRET@i.test/v1")).toBe(
      "https://api.test/go/https%3A/svc:SECRET@i.test/v1",
    );
  });

  test("`%40` shields the credential it stands in for", async () => {
    expect(await emittedUrl("https://api.test/go/https://svc%3APW%40host/v1")).toBe(
      "https://api.test/go/https://svc%3APW%40host/v1",
    );
  });

  test("the two-solidus spelling redacts, and the LITERAL `//` is why", async () => {
    expect(await emittedUrl("https://api.test/go/https%3A//svc:SECRET@i.test/v1")).toBe(
      "https://api.test/go/https%3A//i.test/v1",
    );
    // The bullet's own falsifier: swap the encoded scheme for text that spells
    // no scheme at all. Same answer, so the colon opened nothing.
    expect(await emittedUrl("https://api.test/go/zz%3A//svc:SECRET@i.test/v1")).toBe(
      "https://api.test/go/zz%3A//i.test/v1",
    );
    // And with no head in front of the solidi at all.
    expect(await emittedUrl("https://api.test/go///svc:SECRET@i.test/v1")).toContain("i.test");
    expect(await emittedUrl("https://api.test/go///svc:SECRET@i.test/v1")).not.toContain("SECRET");
  });

  test("all three spellings throw as a standalone url", () => {
    for (const spelling of [
      "https%3A/svc:pw@i.test/v1",
      "https%3Asvc:pw@i.test/v1",
      "https%3A//svc:pw@i.test/v1",
    ]) {
      expect(() => new URL(spelling)).toThrow();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The three-seam paragraph, added in round 13.
//
//   "Where the parser CONSUMED the opening mark instead of leaving it in the
//    text, the removed span is the parser's own answer and nothing wider.
//    Three seams do this: a host-less origin's `scheme://` seam, the path a
//    protocol-relative reference leaves behind, and a reference whose scheme
//    equals the resolution base's scheme…"
//
// Measured as a SET: each of the three named seams removes the credential,
// and the third is measured over every special scheme, because the round-13
// changelog entry says the internal base "now answers for every special
// scheme, not only its own spelling".
// ═══════════════════════════════════════════════════════════════════════════

describe.skipIf(!distExists)("the three seams that consume their own mark", () => {
  const SECRET = "hunter2SECRET";

  test("a host-less origin's `scheme://` seam", async () => {
    // The parse throws (a special scheme with an empty host is a parse
    // failure), and round 13's rule removes the span anyway.
    const emitted = await emittedUrl(`https://svc:${SECRET}@/v1`);
    expect(emitted).not.toContain(SECRET);
    expect(emitted).not.toContain("svc");
  });

  test("the path a protocol-relative reference leaves behind", async () => {
    expect(await emittedUrl(`//svc:${SECRET}@h.test/v1`)).toBe("/v1");
  });

  test("a reference whose scheme equals the resolution base's, for every special scheme", async () => {
    for (const scheme of ["http", "https", "ws", "wss", "ftp"]) {
      const emitted = await emittedUrl(`${scheme}:alice:${SECRET}@api.test:99999/v1`);
      expect({ scheme, leaks: emitted.includes(SECRET) }).toEqual({ scheme, leaks: false });
    }
  });

  test("a parse that SUCCEEDS and names no credential is still believed", async () => {
    // The other half of round 13's rule, and the url its changelog entry
    // names. A `file:` url's path is structure, so it is kept whole.
    expect(await emittedUrl("file:///c:/Users/alice@corp/x")).toBe("file:///c:/Users/alice@corp/x");
    // And an ordinary path segment that spells an `@` after a real authority.
    expect(await emittedUrl("https://api.test/users/@alice")).toBe("https://api.test/users/@alice");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The fixed-point sentence, rewritten in round 13 to name the three re-asked
// questions:
//
//   "Redacting it re-asks three questions of what the previous answer leaves
//    behind — a region's `@` question, its END question, and the seam's own
//    span — so `redactUrl` is a fixed point of itself:
//    `redactUrl(redactUrl(u)) === redactUrl(u)`."
//
// The sentence now states the property as an equation, so it is measured as
// one, over the families each of the three questions covers.
// ═══════════════════════════════════════════════════════════════════════════

describe.skipIf(!distExists)("`redactUrl(redactUrl(u)) === redactUrl(u)`", () => {
  const HEADS = [
    "https://api.test/v1",
    "https://api.test//x:/a@b:PW",
    "//x:/a@b:PW://h.test/@bob",
    "https://api.test/go/https://YWxpY2U/cGFzc3dvcmQ://x@host",
    "https://svc:pw@/v1",
    "https:alice:pw@api.test:99999/v1",
    "file:///c:/Users/alice@corp/x",
    "https://api.test/go/file:/Users/alice@corp/x",
    "https://api.test/go/git:/svc:pw@host",
    "//h.test/p",
    "/rel/@path",
    "https://api.test/go/https%3A//svc:pw@i.test/v1",
  ];
  const TAILS = ["", "/@x", "://u:p@h/x", "/a@b/c", "//u@h", "\\@z", ":/q@r"];

  test("over every head and tail", { timeout: 60_000 }, async () => {
    const moved: string[] = [];
    let measured = 0;
    for (const head of HEADS) {
      for (const tail of TAILS) {
        const once = await emittedUrl(`${head}${tail}`);
        const twice = await emittedUrl(once);
        measured += 1;
        if (twice !== once) moved.push(`${head}${tail} — ${once} -> ${twice}`);
      }
    }
    expect(measured).toBe(HEADS.length * TAILS.length);
    expect(moved.slice(0, 5)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Advice sufficiency — residual 1.
//
//   "Do not pass an error to `structuredClone` or `postMessage` without
//    removing `cause` first."
//
// The consumer who follows that advice EXACTLY: they call `delete
// error.cause` and then clone. The advice is only sufficient if the delete
// succeeds on a frozen-looking error property and if nothing else on the
// error carries the credential through the same platform algorithm.
// ═══════════════════════════════════════════════════════════════════════════

describe.skipIf(!distExists)("the consumer who removes `cause` before cloning", () => {
  const SECRET = "hunter2SECRET";

  test("`delete error.cause` succeeds, and the clone then carries nothing", async () => {
    const { typedFetch } = await loadRoot();
    const platform = new TypeError(`fetch failed for https://svc:${SECRET}@i.test/v1`);
    const { error } = await typedFetch("https://i.test/v1", {
      fetch: () => Promise.reject(platform),
    });
    if (error === null) throw new Error("expected an error envelope");

    // Before: the residual is real, and the sentence is about a real leak.
    expect(structuredClone(error).cause).toBeDefined();
    expect(JSON.stringify(structuredClone(error).cause)).toBeDefined();

    // The advice, followed exactly.
    expect(Object.getOwnPropertyDescriptor(error, "cause")?.configurable).toBe(true);
    expect(delete error.cause).toBe(true);

    // After: the clone carries no byte of the credential, through any of its
    // own properties, not only through `cause`.
    const clone = structuredClone(error) as Error & { cause?: unknown };
    expect(clone.cause).toBeUndefined();
    for (const key of Object.getOwnPropertyNames(clone)) {
      expect(String((clone as unknown as Record<string, unknown>)[key])).not.toContain(SECRET);
    }
    expect(clone.stack ?? "").not.toContain(SECRET);
  });

  test("the escape hatches stay off every enumerating channel", async () => {
    const error = await errorFor("https://svc:pw@api.test/v1?t=SECRET");
    expect(Object.propertyIsEnumerable.call(error, "url")).toBe(false);
    expect(Object.propertyIsEnumerable.call(error, "headers")).toBe(false);
    expect(Object.keys(error)).toEqual(["name", "status", "statusText"]);
    expect(JSON.stringify({ ...error })).not.toContain("SECRET");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The two ledger corrections round 13 recorded, against the built package.
//
//   "`typedFetch` reads `options.signal` earlier than a bare `fetch` does…
//    A bare `fetch` converts `init` as a WebIDL dictionary in member order and
//    reads `method` first, `signal` later."
//
// Both halves are measurable with accessor-backed init members, and the
// second is a platform claim: WebIDL converts dictionary members in
// lexicographical order, and `method` sorts before `signal`.
// ═══════════════════════════════════════════════════════════════════════════

describe.skipIf(!distExists)("the read order the ledger records", () => {
  const MEMBERS = [
    "body",
    "cache",
    "credentials",
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
  ];

  const spyInit = (order: string[]): Record<string, unknown> => {
    const init: Record<string, unknown> = {};
    for (const member of MEMBERS) {
      Object.defineProperty(init, member, {
        enumerable: true,
        configurable: true,
        get() {
          order.push(member);
          return undefined;
        },
      });
    }
    return init;
  };

  test("the platform reads `method` before `signal`, in member order", () => {
    const order: string[] = [];
    new Request("https://api.test/v1", spyInit(order));

    expect(order).toEqual(MEMBERS);
    expect(order.indexOf("method")).toBeLessThan(order.indexOf("signal"));
    // Lexicographical, which is what "member order" means in WebIDL.
    expect(order).toEqual([...order].sort());
  });

  test("`typedFetch` reads `signal` in the setup phase, before the transport", async () => {
    const { typedFetch } = await loadRoot();
    const order: string[] = [];
    const init = spyInit(order);
    Object.defineProperty(init, "fetch", {
      enumerable: true,
      configurable: true,
      get() {
        order.push("fetch");
        return async () => {
          order.push("<transport>");
          return new Response(null, { status: 200 });
        };
      },
    });

    await typedFetch("https://api.test/v1", init);

    expect(order.indexOf("signal")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("signal")).toBeLessThan(order.indexOf("<transport>"));
    // And it does NOT read `method` first, which is the whole difference the
    // ledger records: the transport owns the init, so `typedFetch` reads only
    // what it must capture itself.
    expect(order.includes("method")).toBe(false);
  });
});
