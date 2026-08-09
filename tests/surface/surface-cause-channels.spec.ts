import { readFileSync } from "node:fs";
import { describe, test, expect } from "vitest";
import {
  errorsDistExists as distExists,
  loadErrorsEsm,
  loadRootEsm,
  warnWhenDistMissing,
} from "../../fixtures/built-package";

// ═══════════════════════════════════════════════════════════════════════════
// ROUND 11, LANE H4 — the prose rounds 9 and 10 wrote, executed against the
// BUILT package.
//
// Round 10 rewrote `SECURITY.md`'s residual 2, added an invariant sentence to
// `CONTEXT.md`, and recorded an opening rule in the ledger. A quantitative
// claim is a test and a rule stated in prose is a table test, so each of them
// is one below. Nothing here reads `src/`: every assertion goes through
// `dist/`, which is what a consumer installs, or through `new URL`, which is
// the platform oracle for what a credential IS.
// ═══════════════════════════════════════════════════════════════════════════

warnWhenDistMissing("round11-h4", distExists);

const SECURITY = readFileSync(new URL("../../SECURITY.md", import.meta.url), "utf8");

/**
 * One bullet of `SECURITY.md`'s "Known residuals" list, by its opening words.
 *
 * Matched on CONTENT, never on a line number: `docs-claims.spec.ts` records
 * that the proofs which read a document by line silently moved onto a
 * different sentence when an edit landed two paragraphs earlier.
 */
function residualBullet(opening: string): string {
  const start = SECURITY.indexOf(`- **${opening}`);
  expect(start, `SECURITY.md must keep a residual bullet opening "${opening}"`).toBeGreaterThan(-1);
  const rest = SECURITY.slice(start + 1);
  const end = rest.indexOf("\n- **");
  return rest.slice(0, end === -1 ? rest.length : end);
}

type ErrorLike = Error & {
  url: string;
  cancel(): Promise<void>;
  toJSON(): { url?: string };
};
type ErrorsBag = { NotFoundError: new (response: Response) => ErrorLike };
type RootBag = {
  typedFetch: (
    input: string,
    options: { fetch: () => Promise<Response> },
  ) => Promise<{ error: (Error & { cause?: unknown }) | null }>;
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
// R11-H4-01 — SECURITY.md's residual 1 names ONE of the two channels that
// keep what `error.cause` quotes.
//
// The bullet is titled "A credential can reach a crash dump through
// `error.cause`", and the only leak it names is Node's fatal-exception
// printer. Its advice follows from that one channel: "Handle request failures
// as values, which is what this library returns them as, and do not copy
// `error.cause` into a log line."
//
// `CONTEXT.md` states the wider truth under **Residual**: "`cause` survives
// `structuredClone` and the fatal-exception printer, because both are platform
// algorithms with no hook." `disclosure-channels.spec.ts` measures it and says
// so in its own words — "residual 1: only channels 6 and 7 carry what
// error.cause quotes" — so the suite and `CONTEXT.md` both count two channels
// where the security policy counts one.
//
// The difference is not editorial. `structuredClone` and `postMessage` are how
// an error crosses into a Worker, a `MessageChannel`, or a log pipeline, and a
// consumer who obeys the bullet exactly — return failures as values, never
// throw one, never copy `error.cause` — still hands the platform-quoted
// password to the other realm.
// ═══════════════════════════════════════════════════════════════════════════

const PASSWORD = "hunter2SECRET";
const CREDENTIALED_URL = `https://alice:${PASSWORD}@api.example.com/v1/x?token=${PASSWORD}`;

/** A request failure from the BUILT package whose cause quotes the credential. */
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

describe.skipIf(!distExists)(
  "R11-H4-01: residual 1 counts the channels that keep the cause",
  () => {
    test("structuredClone carries the credential out of the BUILT package", async () => {
      const error = await builtRequestFailure();

      // Every channel the library controls is clean — this is the half of the
      // bullet that holds.
      expect(error.message).not.toContain(PASSWORD);
      expect(JSON.stringify(error)).not.toContain(PASSWORD);
      expect(String(error)).not.toContain(PASSWORD);
      expect(JSON.stringify({ ...error })).not.toContain(PASSWORD);

      // Channel 6 is not one of them, and it needs no crash and no log line.
      const cloned = structuredClone(error) as { cause?: Error };
      expect(String(cloned.cause?.message)).toContain(PASSWORD);
    });

    test("SECURITY.md's residual 1 names that channel", async () => {
      // Proved above against dist/, so this is a claim about the document, not a
      // guess about the code.
      const bullet = residualBullet("A credential can reach a crash dump");

      expect(bullet).toContain("fatal-exception printer");
      expect(
        bullet,
        "residual 1 must name structuredClone/postMessage, the second channel " +
          "that keeps error.cause — CONTEXT.md and disclosure-channels.spec.ts both do",
      ).toContain("structuredClone");
    });
  },
);

// ═══════════════════════════════════════════════════════════════════════════
// The opening rule, as a table against the platform.
//
// Round 10 recorded it: a userinfo region opens "at two or more solidi under
// any scheme, and at a SPECIAL scheme over any number of solidi, including
// none", and `SECURITY.md` residual 2 states the second half plus its
// complement — "A non-special scheme under fewer than two solidi is an opaque
// path and keeps its text."
//
// Round 10's own table pinned `https:` over zero to four solidi. It never
// asked a NON-special scheme, which is the half that decides what the redactor
// must KEEP, and it never used `new URL` as the oracle for the whole grid.
// Every row below states the platform's verdict first and the emitted url
// second, so a future change to either side has to move a row deliberately.
// ═══════════════════════════════════════════════════════════════════════════

describe.skipIf(!distExists)("the opening rule, against new URL over the whole grid", () => {
  const CREDENTIAL = "svc:hunter2";

  /** Does the URL Standard read `text` as an authority carrying userinfo? */
  function platformReadsUserinfo(text: string): boolean {
    try {
      return new URL(text).username !== "";
    } catch {
      return false;
    }
  }

  test.each([
    // scheme, solidi, the platform's verdict, whether the credential survives
    ["https", "", true, false],
    ["https", "/", true, false],
    ["https", "//", true, false],
    ["https", "///", true, false],
    ["ftp", "", true, false],
    ["ftp", "/", true, false],
    ["ftp", "//", true, false],
    // A non-special scheme reaches no authority under fewer than two solidi,
    // so the text is an opaque path and the redactor keeps it. SECURITY.md
    // residual 3 states exactly this.
    ["git", "", false, true],
    ["git", "/", false, true],
    ["git", "//", true, false],
    ["custom+1", "", false, true],
    ["custom+1", "/", false, true],
    ["custom+1", "//", true, false],
  ])(
    "%s: with %j solidi — platform authority %s, credential kept %s",
    async (scheme, solidi, isAuthority, kept) => {
      const embedded = `${scheme}:${solidi}${CREDENTIAL}@host.test/v1`;
      expect(platformReadsUserinfo(embedded)).toBe(isAuthority);

      const emitted = await emittedUrl(`https://api.test/go/${embedded}`);
      expect(emitted.includes(CREDENTIAL)).toBe(kept);
    },
  );

  test("two or more solidi open a region under a scheme the parser rejects", async () => {
    // The empty scheme a template leaves behind. The platform parses none of
    // these, and the rule opens a region anyway — over-redaction, which is the
    // module's safe direction.
    for (const text of [`://${CREDENTIAL}@host.test/v1`, `:///${CREDENTIAL}@host.test/v1`]) {
      expect(platformReadsUserinfo(text)).toBe(false);
      expect(await emittedUrl(`https://api.test/go/${text}`)).not.toContain(CREDENTIAL);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CONTEXT.md's invariant, executed against dist/.
//
// "A hierarchical `url` emits the origin and path, and only those: every
// emitted byte comes from the origin or from the parsed `pathname`."
//
// The ledger states the same thing as a shape — "the emitted url is a
// subsequence of the parsed origin-plus-path and the query and fragment are
// always dropped whole" — and records that the ABSENCE of a subsequence check
// is why a lying redaction shipped in round 9. Round 10's fuzz ran against the
// source; this one runs against the built package, deterministically, so the
// invariant travels with the artifact a consumer installs.
// ═══════════════════════════════════════════════════════════════════════════

describe.skipIf(!distExists)("every emitted byte comes from the origin or the pathname", () => {
  const HIERARCHICAL = new Set(["http:", "https:", "ws:", "wss:", "ftp:", "file:"]);
  const RELATIVE_BASE = "http://url.invalid";

  /** Is `needle` a subsequence of `hay`? */
  function isSubsequence(needle: string, hay: string): boolean {
    let at = 0;
    for (const character of hay) if (character === needle[at]) at += 1;
    return at === needle.length;
  }

  /** Every violation of the invariant for one input, named. */
  async function violationsOf(input: string): Promise<string[]> {
    const emitted = await emittedUrl(input);
    let parsed: URL | null = null;
    try {
      parsed = new URL(input);
    } catch {
      parsed = null;
    }

    if (parsed !== null && HIERARCHICAL.has(parsed.protocol)) {
      const origin = `${parsed.protocol}//${parsed.host}`;
      if (!emitted.startsWith(origin)) return [`origin moved: ${emitted} is not under ${origin}`];
      return isSubsequence(emitted.slice(origin.length), parsed.pathname)
        ? []
        : [`not a subsequence of ${parsed.pathname}: ${emitted}`];
    }
    if (parsed !== null) {
      // An opaque URL carries its payload in the path, so only the scheme.
      return emitted === parsed.protocol ? [] : [`opaque url emitted ${emitted}`];
    }
    let resolved: URL | null = null;
    try {
      resolved = new URL(input, RELATIVE_BASE);
    } catch {
      resolved = null;
    }
    if (resolved === null) return emitted === "" ? [] : [`unresolvable url emitted ${emitted}`];
    return isSubsequence(emitted, resolved.pathname)
      ? []
      : [`relative: not a subsequence of ${resolved.pathname}: ${emitted}`];
  }

  test.each([
    "https://api.test/go/https://svc:pw@internal.test/v1?next=https://a:b@c#f",
    "https://api.test/proxy/https://cdn.test/img?owner=alice@example.com&sig=deadbeef",
    "https://api.test/go/https://svc:hun?ter2@internal.test/v1",
    "https://api.test/go/https://svc:hun#ter2@internal.test/v1",
    "https://api.test/users/@alice?token=t#x",
    "https://api.test/x://u2:pw@host2/v1?q=1",
    "file:///c:/Users/alice@corp/x?token=t",
    "//api.test/go/https://svc:pw@internal.test/v1?q=1",
    "/go/https://svc:pw@internal.test/v1?q=1",
    "data:text/plain;base64,aHVudGVyMg==",
    "blob:https://api.test/6f0a-secret",
    "",
  ])("the shapes round 10 argued about: %s", async (input) => {
    expect(await violationsOf(input)).toEqual([]);
  });

  test(
    "5,000 generated urls, and not one byte from a query or a fragment",
    { timeout: 60_000 },
    async () => {
      // Deterministic: a seeded generator, so a failure names an input a reader
      // can paste. The alphabet is the marks every previous round tripped on —
      // solidi in both directions, the three characters the parser removes, the
      // percent-encoded delimiters, and the dot segments a rebuild can collapse.
      let seed = 20261108;
      const random = (): number => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed / 0x7fffffff;
      };
      const pick = <T>(values: readonly T[]): T => {
        const chosen = values[Math.floor(random() * values.length)];
        if (chosen === undefined) throw new Error("the generator needs a non-empty table");
        return chosen;
      };

      const atoms = [
        "https:",
        "http:",
        "ftp:",
        "file:",
        "git:",
        "x:",
        "data:",
        "blob:",
        "custom+1:",
        "/",
        "//",
        "///",
        "\\",
        "\\\\",
        ":",
        "@",
        "?",
        "#",
        "%40",
        "%3A",
        "%2F",
        "%2540",
        "svc",
        "pw",
        "host.test",
        "8443",
        ".",
        "..",
        "-",
        "_",
        "~",
        "=",
        "&",
        ";",
        ",",
        "+",
        "\t",
        "\n",
        "\r",
        " ",
        "%",
        "é",
        "[",
        "]",
        "|",
        "^",
        "<",
        ">",
        "'",
        "`",
        "{",
        "}",
      ] as const;
      const heads = ["https://", "http://", "ftp://", "file://", "ws://", "//", "/", ""] as const;
      const hosts = ["api.test", "h.test:8443", "u:p@api.test", "[::1]", "a.b.test"] as const;

      const failures: string[] = [];
      for (let round = 0; round < 5_000 && failures.length < 5; round += 1) {
        let input = pick(heads);
        if (input.endsWith("//")) input += pick(hosts);
        const length = 1 + Math.floor(random() * 12);
        for (let at = 0; at < length; at += 1) input += pick(atoms);
        for (const violation of await violationsOf(input)) {
          failures.push(`${JSON.stringify(input)} — ${violation}`);
        }
      }

      expect(failures).toEqual([]);
    },
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// Residual 4, and the two declaration files, read from the artifact.
//
// "`error.url` and `error.headers` hold the raw values. They are the escape
// hatches, non-enumerable so no structured logger reaches them by accident."
// The claim is about ENUMERABILITY, which is the only control over the one
// channel that disables every hook — so it is asserted over every own property
// of every root class the built package exports, not over the two the sentence
// happens to name.
// ═══════════════════════════════════════════════════════════════════════════

describe.skipIf(!distExists)("the escape hatches stay hidden from a structured logger", () => {
  test("name is the only enumerable own property any built error carries", async () => {
    const { NotFoundError } = await loadErrors();
    const response = new Response(null, {
      status: 404,
      statusText: "Not Found",
      headers: { "set-cookie": `session=${PASSWORD}` },
    });
    Object.defineProperty(response, "url", { value: CREDENTIALED_URL, configurable: true });
    const httpError = new NotFoundError(response);
    await httpError.cancel();

    // An HTTP error deliberately publishes its identity; the escape hatches
    // and the cause are the properties that must stay hidden.
    expect(Object.keys(httpError).toSorted()).toEqual(["name", "status", "statusText"]);
    for (const hidden of ["url", "headers", "message", "stack"]) {
      const descriptor = Object.getOwnPropertyDescriptor(httpError, hidden);
      expect(descriptor?.enumerable, `${hidden} must stay non-enumerable`).toBe(false);
    }

    const failure = await builtRequestFailure();
    expect(Object.keys(failure)).toEqual(["name"]);
    for (const hidden of ["url", "cause"]) {
      expect(Object.getOwnPropertyDescriptor(failure, hidden)?.enumerable).toBe(false);
    }
  });

  test("the two declaration files differ only in the specifier they import", () => {
    const esm = readFileSync(new URL("../../dist/index.d.mts", import.meta.url), "utf8");
    const cjs = readFileSync(new URL("../../dist/index.d.ts", import.meta.url), "utf8");

    // Three rounds of source changes landed since the last time anything read
    // these two against each other. A divergence beyond the specifier is the
    // shape that makes the `.d.ts` and `.d.mts` copies of a class mutually
    // unassignable, which CONTEXT.md calls out under "structural, deliberately".
    expect(esm.replaceAll("./errors/index.mjs", "./errors/index.js")).toBe(cjs);
    expect(readFileSync(new URL("../../dist/errors/index.d.mts", import.meta.url), "utf8")).toBe(
      readFileSync(new URL("../../dist/errors/index.d.ts", import.meta.url), "utf8"),
    );
  });
});
