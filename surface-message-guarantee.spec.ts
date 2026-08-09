import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  errorsDistExists as distExists,
  loadErrorsEsm,
  warnWhenDistMissing,
} from "./fixtures/built-package";

// ═══════════════════════════════════════════════════════════════════════════
// ROUND 15, LANE H4 — the LAST round. Two jobs, in this file in this order:
//
//  1. Round 14's corrections, measured against the BUILT package. `SECURITY.md`
//     gained a split-point paragraph, a widened `file:` bullet, a rewritten
//     fixed-point sentence, and a corrected `error.url` sentence. A correction
//     can be wrong in a new way, and rounds 13 and 14 each proved it.
//  2. The document set read as ONE BODY. Seven rounds have edited
//     `SECURITY.md`, `CONTEXT.md`, `CHANGELOG.md` and the ledger under time
//     pressure. A sentence that was true when it was written and is no longer
//     descriptive costs a reader exactly what a false one costs.
//
// Everything reads `dist/`, the artifact a consumer installs, and every
// document sentence is quoted from the file at run time so a rewritten
// sentence cannot leave a stale quotation behind.
// ═══════════════════════════════════════════════════════════════════════════

warnWhenDistMissing("round15-h4", distExists);

type ErrorLike = Error & {
  url: string;
  cancel(): Promise<void>;
  toJSON(): { url?: string; message?: string };
};

type ErrorsBag = {
  NotFoundError: new (response: Response) => ErrorLike;
  NetworkError: new (message?: string, options?: { cause?: unknown; url?: string }) => ErrorLike;
};

const loadErrors = (): Promise<ErrorsBag> => loadErrorsEsm<ErrorsBag>();

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
// R15-H4-01 — `SECURITY.md` promises `error.message` a property that only
// `toJSON().url` has.
//
// Round 14 moved residual 2's strongest sentence off `error.url`, which is the
// raw href, and onto two members that redact:
//
//   "Neither `error.message` nor `toJSON().url` emits a byte the caller wrote
//    after a `?` or a `#`, under any spelling."
//
// `toJSON().url` holds it BY CONSTRUCTION: it is `redactUrl(this.url)`, and
// every byte that function emits comes from the origin or from a parsed
// `pathname`. `error.message` does not hold it by construction. For an HTTP
// error the message is built from `redactUrl`, so it does; for `NetworkError`
// the message is a value a CALLER passes, and the constructor cleans it by
// replacing the exact string `url` with its redacted form. That replacement is
// exact-string, so it is best effort. `CHANGELOG.md` said so in the released
// 2.0.0 section, where the pass was added — "The replacement is exact-string,
// so it is best effort" — and `SECURITY.md`'s residual list never carried the
// limit across.
//
// A fragment is never sent to the server (RFC 9112 section 3.2.1: a client
// sends only the absolute path and query components) and a default port is
// normalized away (URL Standard: the port is set to null when it equals the
// scheme's default), so a platform reporting "the URL it refused" routinely
// quotes a DIFFERENT SPELLING of the same url. The replacement then finds
// nothing, the userinfo pass has no needle for a query, and the token
// survives — in `error.message` and in `toJSON().message`, which is the record
// a structured logger writes.
//
// "under any spelling" is the exact phrase that fails: the failure mode IS a
// spelling difference. This is a documentation defect, not a code one. The
// library's own path never reaches it — `classifyRequestFailure` is the single
// construction site and it passes a library constant — but `NetworkError` is
// public API, and residual 1 of this same document tells a consumer wrapping an
// adapter that `error.message` redacts a platform's quoted URL.
// ═══════════════════════════════════════════════════════════════════════════

describe.skipIf(!distExists)("residual 2's `error.message` half", () => {
  const QUERY = "QSECRET";
  const RAW = `https://api.test/v1?token=${QUERY}#note=FSECRET`;
  // The wire form of the same url: the fragment is never transmitted, so a
  // platform quoting the request it refused quotes this spelling.
  const QUOTED = `https://api.test/v1?token=${QUERY}`;
  const PLATFORM_MESSAGE = `Request cannot be constructed from ${QUOTED}`;

  test("`toJSON().url` does hold the property, for the raw and the wire spelling", async () => {
    // The half of the sentence that is true, pinned so a fix cannot weaken it.
    expect(await emittedUrl(RAW)).toBe("https://api.test/v1");
    expect(await emittedUrl(QUOTED)).toBe("https://api.test/v1");
  });

  test("the message pass is exact-string, so another spelling keeps the query byte", async () => {
    const { NetworkError } = await loadErrors();
    const exact = new NetworkError(`Request cannot be constructed from ${RAW}`, { url: RAW });
    const reSpelled = new NetworkError(PLATFORM_MESSAGE, { url: RAW });

    // MEASURED, not demanded. Widening the needle past the exact string needs
    // the caller's value a second time, which is the read the whole
    // library-authored-message rule exists to avoid, and the module states the
    // best-effort limit on `redactUrlInMessage`. So this is the behavior the
    // document has to describe, not behavior to change.
    expect({
      exactSpellingRedacts: !exact.message.includes(QUERY),
      reSpelledKeepsQuery: reSpelled.message.includes(QUERY),
      // `toJSON()` emits `message` verbatim, so the record a structured logger
      // writes carries the token even though its `url` member does not.
      recordMessageKeepsQuery: (reSpelled.toJSON().message ?? "").includes(QUERY),
      recordUrl: reSpelled.toJSON().url,
    }).toEqual({
      exactSpellingRedacts: true,
      reSpelledKeepsQuery: true,
      recordMessageKeepsQuery: true,
      recordUrl: "https://api.test/v1",
    });
  });

  test("`SECURITY.md` must not promise `error.message` what only `toJSON().url` holds", async () => {
    const security = unwrapped(documentText("SECURITY.md"));
    const CLAIM =
      "Neither `error.message` nor `toJSON().url` emits a byte the caller wrote " +
      "after a `?` or a `#`, under any spelling.";

    const { NetworkError } = await loadErrors();
    const error = new NetworkError(PLATFORM_MESSAGE, { url: RAW });

    // The document may make the claim only about members that hold it. Either
    // the sentence names `toJSON().url` alone, or it carries the scope the
    // changelog already states: the message pass is an exact-string
    // replacement of `url`, and a message quoting another spelling keeps its
    // query.
    expect({
      unqualifiedClaimInSecurityMd: security.includes(CLAIM),
      queryByteInMessage: error.message.includes(QUERY),
    }).toEqual({
      unqualifiedClaimInSecurityMd: false,
      queryByteInMessage: true,
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// R15-H4-02 — an `[Unreleased]` changelog entry states a seam rule the built
// package no longer has, and the rule it states would leak.
//
// Round 12 wrote this entry, and it was true then:
//
//   "The removed span is now the parser's own answer whether the parse
//    SUCCEEDS with a credential or THROWS; only a parse that succeeds and
//    reports no credential is believed, which is what keeps a `file:` drive
//    letter (`file:///c:/Users/alice@corp/x`) whole."
//
// Round 14 removed the parse. `seamUserinfo` in the shipped chunk contains no
// `new URL` at all: it reads the parser's SPLIT POINT — the last `@` before
// the authority ends — because the parser normalizes an empty userinfo away
// and a report of nothing is not proof there was nothing to remove. Two later
// entries in the SAME `[Unreleased]` section say so, and the drive letter is
// now kept by the `file:` exclusion rather than by a believed parse.
//
// The stale entry is not merely superseded wording. Its rule is observably
// DIFFERENT: `new URL("https://:@internal.test/")` succeeds and reports no
// credential, so the stated rule believes it and removes nothing, while the
// built package removes the span. That is the leak round 14 closed, described
// in `[Unreleased]` as the current behavior.
//
// `RELEASING.md` step 1 MOVES `[Unreleased]` into a dated section verbatim, so
// this ships into an immutable released section unless it is edited first.
// ═══════════════════════════════════════════════════════════════════════════

describe.skipIf(!distExists)("the `[Unreleased]` account of the seam", () => {
  const SEAM_URL = "file:///:@internal.test/v1";

  test("the built package removes an empty userinfo the parser reports as nothing", async () => {
    // The platform half: the parse the superseded rule would have believed.
    const parsed = new URL("https://:@internal.test/");
    expect({ href: parsed.href, username: parsed.username, password: parsed.password }).toEqual({
      href: "https://internal.test/",
      username: "",
      password: "",
    });

    // The module half: the span goes anyway, which is the split-point rule
    // `SECURITY.md` now states and the changelog entry contradicts.
    expect(await emittedUrl(SEAM_URL)).toBe("file:///internal.test/v1");
  });

  test("`CHANGELOG.md` must not state the superseded believed-parse rule as current", () => {
    const changelog = documentText("CHANGELOG.md");
    const unreleased = unwrapped(
      changelog.slice(
        changelog.indexOf("## [Unreleased]"),
        changelog.indexOf("## [", changelog.indexOf("## [Unreleased]") + 1),
      ),
    );

    expect({
      believedParseRule: unreleased.includes(
        "only a parse that succeeds and reports no credential is believed",
      ),
      splitPointRule: unreleased.includes(
        "The scan now reads the split point directly and no longer parses to confirm it.",
      ),
    }).toEqual({
      // The two sentences describe the same code and cannot both be current.
      believedParseRule: false,
      splitPointRule: true,
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// JOB 1 — round 14's corrections, measured. Everything below PASSES on the
// tree as it stands, and it is here so the last round leaves the corrections
// pinned rather than merely reviewed.
// ═══════════════════════════════════════════════════════════════════════════

describe.skipIf(!distExists)("round 14's `SECURITY.md` corrections", () => {
  test("the split-point paragraph is true of the platform and of the module", async () => {
    // "The parser normalizes an empty userinfo away: `new URL(\"https://:@x/\").href`
    //  is `https://x/`. So a report of nothing is not proof there was nothing
    //  to remove."
    expect(new URL("https://:@x/").href).toBe("https://x/");

    // And the three seams the paragraph names, each reached by its own state.
    expect(await emittedUrl("file:///svc:PW@internal.test/v1")).toBe("file:///internal.test/v1");
    expect(await emittedUrl("//https:/svc:PW@internal.test/v1")).toBe("/internal.test/v1");
    // A reference whose scheme EQUALS the resolution base's, which only reaches
    // the relative branch when it fails to parse absolutely.
    expect(() => new URL("http:alice:PW@api.test:99999/v1")).toThrow();
    expect(await emittedUrl("http:alice:PW@api.test:99999/v1")).toBe("/api.test:99999/v1");
  });

  test("`file:` under fewer than two solidi opens no region, exactly as `git:` does", async () => {
    // The URL Standard half, at both solidus counts the sentence covers.
    for (const solidi of ["", "/"]) {
      expect(new URL(`file:${solidi}svc:pw@host`).username).toBe("");
      expect(new URL(`git:${solidi}svc:pw@host`).username).toBe("");
    }
    // The module half: the embedded reference keeps its text under both.
    expect(await emittedUrl("https://api.test/go/file:/Users/alice@corp/report.pdf")).toBe(
      "https://api.test/go/file:/Users/alice@corp/report.pdf",
    );
    expect(await emittedUrl("https://api.test/go/git:/svc:pw@host/v1")).toBe(
      "https://api.test/go/git:/svc:pw@host/v1",
    );
  });

  test("the percent-encoded-delimiter bullet is true in all four of its spellings", async () => {
    // Zero and one solidus: the encoded colon still shields the credential.
    expect(await emittedUrl("https://api.test/go/https%3Asvc:SECRET@i.test/v1")).toBe(
      "https://api.test/go/https%3Asvc:SECRET@i.test/v1",
    );
    expect(await emittedUrl("https://api.test/go/https%3A/svc:SECRET@i.test/v1")).toBe(
      "https://api.test/go/https%3A/svc:SECRET@i.test/v1",
    );
    // The encoded `@` shields it under two solidi.
    expect(await emittedUrl("https://api.test/go/https://svc%3APW%40host/v1")).toBe(
      "https://api.test/go/https://svc%3APW%40host/v1",
    );
    // Two solidi DO redact — and the bullet's own proof that the colon opened
    // nothing is that any other text in front of the solidi redacts the same.
    expect(await emittedUrl("https://api.test/go/https%3A//svc:SECRET@i.test/v1")).toBe(
      "https://api.test/go/https%3A//i.test/v1",
    );
    expect(await emittedUrl("https://api.test/go/zz%3A//svc:SECRET@i.test/v1")).toBe(
      "https://api.test/go/zz%3A//i.test/v1",
    );
    // "All three spellings THROW as a standalone url."
    for (const solidi of ["", "/", "//"]) {
      expect(() => new URL(`https%3A${solidi}svc:pw@i.test/v1`)).toThrow();
    }
  });

  test("`error.url` keeps the raw href and both escape hatches stay non-enumerable", async () => {
    const RAW = "https://alice:PW@api.test/v1?token=QSECRET#note=FSECRET";
    const error = await errorFor(RAW);
    expect(error.url).toBe(RAW);
    expect(error.toJSON().url).toBe("https://api.test/v1");
    for (const member of ["url", "headers"]) {
      expect(Object.getOwnPropertyDescriptor(error, member)?.enumerable).toBe(false);
    }
  });

  test("both residuals residual 2 names are still exactly as wide as it says", async () => {
    // A credential whose LAST character is `/`, and the path it cannot be told
    // apart from.
    expect(await emittedUrl("https://api.test/go/https://token/@host/v1")).toBe(
      "https://api.test/go/https://token/@host/v1",
    );
    expect(await emittedUrl("https://api.test/users/@alice")).toBe("https://api.test/users/@alice");
    // A credential holding a `://` behind text the parser reads as a host.
    expect(await emittedUrl("https://api.test/go/https://YWxpY2U/cGFzc3dvcmQ://x@host/v1")).toBe(
      "https://api.test/go/https://YWxpY2U/cGFzc3dvcmQ://host/v1",
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// JOB 2 — the invariants the document set rests on, measured over a corpus
// rather than over the examples the documents chose. A sentence that holds for
// its own example and nothing else is the shape rounds 10 and 13 each found.
// ═══════════════════════════════════════════════════════════════════════════

describe.skipIf(!distExists)("the emitted url over a generated corpus", () => {
  const HEADS = ["", "/", "//", "///", "\\", "//\\", "/go/"];
  const SCHEMES = [
    "",
    "https:",
    "https://",
    "https:/",
    "http:",
    "file:",
    "file:/",
    "file://",
    "git:/",
    "zz://",
    "%3A",
    "https%3A//",
  ];
  const CREDENTIALS = ["", "svc:PWSECRET@", "token@", "a:b@c:d@", ":@", "@", "x@./"];
  const HOSTS = ["i.test", "i.test:8443", "", "[::1]", "host/deep"];
  const TAILS = [
    "",
    "/v1",
    "/v1?q=QSECRET",
    "/v1#h=FSECRET",
    "/a/../b",
    "/./x",
    "/v1?q=QSECRET#h=FSECRET",
  ];

  test("every url is a fixed point, never leads with two solidi, and drops its query", async () => {
    const notFixedPoint: string[] = [];
    const leadsWithTwoSolidi: string[] = [];
    const keptAValueByte: string[] = [];
    let measured = 0;

    for (const head of HEADS) {
      for (const scheme of SCHEMES) {
        for (const credential of CREDENTIALS) {
          for (const host of HOSTS) {
            for (const tail of TAILS) {
              const url = head + scheme + credential + host + tail;
              measured += 1;
              const once = await emittedUrl(url);
              // "So `redactUrl` is a fixed point of itself."
              if ((await emittedUrl(once)) !== once) notFixedPoint.push(url);
              // "A relative answer never begins with two solidi."
              if (once.startsWith("//")) leadsWithTwoSolidi.push(url);
              // "It never emits userinfo, a query, or a fragment." (CONTEXT.md)
              if (once.includes("QSECRET") || once.includes("FSECRET")) keptAValueByte.push(url);
            }
          }
        }
      }
    }

    expect({
      measured,
      notFixedPoint: notFixedPoint.slice(0, 4),
      leadsWithTwoSolidi: leadsWithTwoSolidi.slice(0, 4),
      keptAValueByte: keptAValueByte.slice(0, 4),
    }).toEqual({
      measured: 20_580,
      notFixedPoint: [],
      leadsWithTwoSolidi: [],
      keptAValueByte: [],
    });
    // 41,160 error constructions. Fast alone, and slower than the 5 s default
    // under the full suite's thread contention, so the bound is explicit.
  }, 180_000);
});

/** Does this rendering carry the sentinel planted in a cause's own message? */
const carries = (text: string): boolean => text.includes("CAUSESECRET");

describe.skipIf(!distExists)("the two channels that keep `error.cause`", () => {
  test("only `structuredClone` carries it out of the four the document names", async () => {
    const { NetworkError } = await loadErrors();
    const CAUSE = new TypeError(
      "Request cannot be constructed from a URL that includes credentials: " +
        "https://alice:CAUSESECRET@host/x",
    );
    const error = new NetworkError("Network error", { cause: CAUSE, url: "https://host/x" });

    expect({
      // "Every channel this library controls redacts that value:
      //  `error.message`, `toJSON()`, `toString()`, and the `util.inspect` hook."
      message: carries(error.message),
      json: carries(JSON.stringify(error)),
      string: carries(`${error}`),
      // The own-enumerable-properties channel cannot carry it either: `cause`
      // is non-enumerable, which is what the fatal-exception printer's rule
      // rests on.
      causeEnumerable: Object.prototype.propertyIsEnumerable.call(error, "cause"),
      // "`structuredClone` copies `error.cause` unchanged."
      cloned: carries(
        String((structuredClone(error) as { cause?: { message?: string } }).cause?.message),
      ),
    }).toEqual({
      message: false,
      json: false,
      string: false,
      causeEnumerable: false,
      cloned: true,
    });
  });
});
