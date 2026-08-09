import { describe, test, expect } from "vitest";
import {
  errorsDistExists as distExists,
  loadErrorsEsm,
  warnWhenDistMissing,
} from "./fixtures/built-package";

// ═══════════════════════════════════════════════════════════════════════════
// ROUND 13, LANE H4 — the sentences round 12's docs pass wrote, executed
// against the BUILT package.
//
// Round 12 rewrote `SECURITY.md` residual 2 substantially, split the
// percent-encoded residual into two halves and declared one of them closed,
// and opened a `### Security` block under `[Unreleased]` in `CHANGELOG.md`.
// The pass records that each line was measured against `dist/` before it was
// written. Each new or corrected sentence is re-measured here — through
// `dist/`, the artifact a consumer installs, rather than through `src/`.
// ═══════════════════════════════════════════════════════════════════════════

warnWhenDistMissing("round13-h4", distExists);

type ErrorLike = Error & {
  url: string;
  cancel(): Promise<void>;
  toJSON(): { url?: string };
};
type ErrorsBag = { NotFoundError: new (response: Response) => ErrorLike };

const loadErrors = (): Promise<ErrorsBag> => loadErrorsEsm<ErrorsBag>();

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
// R13-H4-01 — `redactUrl` is not a fixed point of itself.
//
// `CHANGELOG.md`, `[Unreleased]` → `### Security`, states it as a heading:
//
//   "**`redactUrl` is a fixed point of itself for every url, including a
//    relative one.**"
//
// `SECURITY.md` residual 2 states the same thing, and gives the reason:
//
//   "A relative answer never begins with two solidi. It is resolved until it
//    stops moving, so `redactUrl` is a fixed point of itself."
//
// The relative branch does now resolve until it stops moving. That is not
// what makes the whole function a fixed point, and the property fails on both
// branches for a reason the loop never touches.
//
// A region opened by two bare solidi is BOUNDED by the next `://` only where
// `parsesAsAuthority` reads a complete authority at the region's start. In
// `//x:/a@b:PW://h.test/@bob` the region starts at `x:/…`, and `x:` IS an
// authority the parser can read (`new URL("https://x:/")` names the host
// `x`), so the region ends at the `://` after `PW` and only `x:/a@` is
// removed. What is left at that same start is `b:PW://…`, and `PW` is not a
// port — so on a second reading the region has no end at all, every later `@`
// is a candidate, and the second pass removes `b:PW://h.test/users/@` as
// well.
//
// So the redaction of a redaction removes text the first redaction emitted,
// which is the shape round 11 measured over 604,204 urls and round 12's
// second finding recorded as a defect. Neither document qualifies the claim,
// and round 12's own corpora cannot reach it: `redact-url.spec.ts` and
// `response-read-inventory.spec.ts` both build their paths from `/a:/b` and
// `/go/https:…`, and a region whose start the parser reads as an authority
// only to stop reading it as one after the removal needs the bare-`//`
// opening that round 12 added.
// ═══════════════════════════════════════════════════════════════════════════

describe.skipIf(!distExists)("R13-H4-01: the redaction is not a fixed point of itself", () => {
  test.each([
    ["an absolute url", "https://api.test//x:/a@b:PW://h.test/@bob"],
    ["a relative url", "/go//x:/a@b:PW://h.test/@bob"],
    ["a non-http special scheme", "ftp://api.test//x:/a@b:PW://h.test/@bob"],
    ["a query and a fragment behind it", "https://api.test//x:/a@b:PW://h.test/@bob?k=v#f"],
  ])("redacting %s twice removes more than redacting it once", async (_label, url) => {
    const once = await emittedUrl(url);

    expect(
      await emittedUrl(once),
      "CHANGELOG `[Unreleased]` and SECURITY.md residual 2 both state that " +
        "`redactUrl` is a fixed point of itself for every url",
    ).toBe(once);
  });

  test("it is a class, not one input", async () => {
    // Every combination of the three parts the shape needs: an opening the
    // parser reads as an authority, a second candidate that stops being one
    // once the first is removed, and a later `@` for the unbounded region to
    // reach. Nothing here is exotic — a proxy path with a port-less colon is
    // the ordinary way to spell the first part.
    const OPENINGS = ["x:/a@", "h.test:/a@", "[::1]:/a@"];
    const MIDDLES = ["b:PW://", "b:PW:/", "svc:hunter2://"];
    const TAILS = ["h.test/@bob", "h.test/img/@alice", "cdn.test/users/@a"];

    const moved: string[] = [];
    for (const opening of OPENINGS) {
      for (const middle of MIDDLES) {
        for (const tail of TAILS) {
          const url = `https://api.test//${opening}${middle}${tail}`;
          const once = await emittedUrl(url);
          const twice = await emittedUrl(once);
          if (twice !== once) moved.push(`${url} — ${once} then ${twice}`);
        }
      }
    }

    expect(moved.slice(0, 3)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// R13-H4-02 — a percent-encoded scheme colon still shields a credential.
//
// `SECURITY.md` gained a residual bullet with a headline and a closing
// sentence, both of which are about the whole class:
//
//   "**A percent-encoded scheme colon no longer shields a credential, and a
//    percent-encoded `@` still does.** … Only the second shape is open."
//
// The worked example it gives is a `%3A` followed by TWO solidi, and that one
// is closed: the bare-`//` rule opens a region at the solidi whatever
// precedes them. It is the only spelling that rule reaches. A special scheme
// reaches its authority over ANY number of solidi, INCLUDING NONE — which is
// round 10's finding, and which `disclosure-channels.spec.ts` pins for the
// LITERAL colon under one solidus ("a single-slash scheme IS an authority,
// and its credential is removed"). Percent-encode that colon and the credential
// comes back, because no rule opens a region there at all.
//
// So the first shape is open too, in the two spellings every slash-collapsing
// proxy and every `path.join` produces from the one the document measured.
// The bullet's headline and its "only the second shape" closer are both false
// against the built package.
//
// ── ROUND 13 ADJUDICATION. The finding is upheld and the DOCUMENT is what was
// wrong; the module is not. The rows below are converted from "the credential
// must go" to a measurement of the residual's real width, and the reason is
// this module's own authority rule rather than a preference.
//
// A region opens where a URL PARSER opens an authority in the text AS WRITTEN.
// That is the invariant round 12 installed after five rounds of hand-written
// marks each lost to a password that spelled them. `%3A` is not a colon to any
// parser: `new URL("https%3A/svc:pw@i.test/v1")` throws, and the outer parse
// reads the whole segment as path text. Opening a region there would be the
// first rule in this module that fires where NO parser opens an authority —
// a rule about a percent-decoded COPY of the text, which is the "two texts the
// parser does not agree about" defect the ledger records as the whole of
// rounds 5, 8 and 9.
//
// The two-solidus spelling is not evidence against that. It closes through its
// LITERAL SOLIDI — the bare-`//` opening round 12 added, which fires whatever
// precedes it — and not through the colon at all. The third assertion below
// measures that directly: replace the `%3A` with any other text and the answer
// does not move.
//
// Round 10's lesson does not transfer either. It was that one mark spelled
// over zero, one and two solidi must be answered the same way, and there all
// three spellings ARE an authority to the parser. Here only the two-solidus
// spelling is.
//
// The residual therefore stands, and it stands with the `%40` half it was
// always paired with: an encoded delimiter is not a delimiter. A reader that
// percent-decodes this path segment before re-parsing it defeats both halves
// at once, so closing the colon alone would not close the threat — it would
// only move where the document has to be honest.
// ═══════════════════════════════════════════════════════════════════════════

describe.skipIf(!distExists)("R13-H4-02: the percent-encoded colon residual's width", () => {
  test.each([
    ["one solidus", "https://api.test/go/https%3A/svc:SECRET@i.test/v1"],
    ["no solidi", "https://api.test/go/https%3Asvc:SECRET@i.test/v1"],
  ])("a %3A scheme colon over %s still shields the credential", async (_label, url) => {
    const literal = url.replace("%3A", ":");
    // The URL Standard's own answer for the LITERAL spelling, read from the
    // platform rather than restated: a special scheme reaches its authority
    // over any number of solidi, including none, so this IS a credential.
    const embedded = literal.slice(literal.indexOf("/go/") + 4);
    expect(new URL(embedded).password).toBe("SECRET");
    // And the library removes it there, which is what makes the encoded
    // spelling a shield rather than a shape nothing ever reached.
    expect(await emittedUrl(literal)).not.toContain("SECRET");

    // The platform's answer for the ENCODED spelling, which is the whole of the
    // residual: there is no authority here for a region to open at.
    expect(() => new URL(url.slice(url.indexOf("/go/") + 4))).toThrow();
    expect(
      await emittedUrl(url),
      "the encoded colon is a residual: no parser opens an authority at a `%3A`",
    ).toContain("svc:SECRET@");
  });

  test("the two-solidus spelling closes through its solidi, not through its colon", async () => {
    // The document's worked example, and the same url with the scheme text
    // replaced by something no scheme rule could ever match. Both lose the
    // credential, so the colon — encoded or not — decides nothing there.
    expect(await emittedUrl("https://api.test/go/https%3A//svc:SECRET@i.test/v1")).toBe(
      "https://api.test/go/https%3A//i.test/v1",
    );
    expect(await emittedUrl("https://api.test/go/zz%3A//svc:SECRET@i.test/v1")).toBe(
      "https://api.test/go/zz%3A//i.test/v1",
    );
    // And with the solidi taken away the answer moves, which is the other half
    // of the same measurement.
    expect(await emittedUrl("https://api.test/go/zz%3Asvc:SECRET@i.test/v1")).toContain(
      "svc:SECRET@",
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The worked examples round 12 wrote into `SECURITY.md`, byte for byte.
//
// Each of these is a sentence that names an input AND its output. They are
// asserted as exact strings rather than as "does not contain", because an
// example that is right about the secret and wrong about the rest of the url
// is still a false sentence.
// ═══════════════════════════════════════════════════════════════════════════

describe.skipIf(!distExists)("SECURITY.md's worked examples, measured", () => {
  test("the percent-encoded colon over two solidi redacts to what the document prints", async () => {
    expect(await emittedUrl("https://api.test/go/https%3A//svc:SECRET@i.test/v1")).toBe(
      "https://api.test/go/https%3A//i.test/v1",
    );
  });

  test("the percent-encoded @ keeps `svc%3APW%40host` in full", async () => {
    expect(await emittedUrl("https://api.test/go/https://svc%3APW%40host/v1")).toBe(
      "https://api.test/go/https://svc%3APW%40host/v1",
    );
  });

  test("a non-special scheme under fewer than two solidi keeps its text", async () => {
    // The document's justification is a claim about the URL Standard, so it is
    // asked of the platform here rather than restated.
    expect(new URL("git:/svc:pw@host").username).toBe("");
    expect(await emittedUrl("https://api.test/go/git:/svc:pw@host")).toBe(
      "https://api.test/go/git:/svc:pw@host",
    );
  });

  test("the counter-example residual 2 rests on still keeps host1", async () => {
    expect(await emittedUrl("https://api.test/go/://host1/x://u2:pw@host2/v1")).toBe(
      "https://api.test/go/://host1/x://host2/v1",
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Residual 2's two shapes, measured for WIDTH.
//
// "Two residuals are left, and neither can be told apart from an ordinary
// path by a structural rule. The first is a credential whose LAST character
// is `/`. … The second is a credential holding a `://` behind text the parser
// reads as a host."
//
// A residual wider than documented is a finding. Each shape is measured
// against its own near neighbour — the same url with the one stated property
// removed — which must still lose its credential.
// ═══════════════════════════════════════════════════════════════════════════

describe.skipIf(!distExists)("residual 2 is exactly as narrow as it says", () => {
  test("a credential whose last character is `/` survives, and one character later does not", async () => {
    expect(await emittedUrl("https://api.test/go/https://dG9rZW4vcGFzc3dvcmQ/@host/v1")).toBe(
      "https://api.test/go/https://dG9rZW4vcGFzc3dvcmQ/@host/v1",
    );

    // The same token with a non-solidus last character: the third rule reads it
    // as a credential and the whole span goes.
    expect(await emittedUrl("https://api.test/go/https://dG9rZW4vcGFzc3dvcmQx@host/v1")).toBe(
      "https://api.test/go/https://host/v1",
    );
  });

  test("a `://` behind text the parser reads as a host survives, and behind text it does not read as one does not", async () => {
    expect(await emittedUrl("https://api.test/go/https://YWxpY2U/cGFzc3dvcmQ://x@host/v1")).toBe(
      "https://api.test/go/https://YWxpY2U/cGFzc3dvcmQ://host/v1",
    );

    // `alice:s3cret` is not an authority the parser can read — `s3cret` is not
    // a port — so that region has no end and the whole credential goes. This is
    // the half round 12 closed, and it is what bounds the residual above.
    expect(await emittedUrl("https://api.test/go/https://alice:s3cret://x@host/v1")).toBe(
      "https://api.test/go/https://host/v1",
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// "`error.url` never emits a byte the caller wrote after a `?` or a `#`,
// under any spelling."
//
// The strongest sentence in residual 2, and the one a consumer reasons with
// when they decide a signed query parameter is safe. Measured over a corpus
// that crosses every head this module branches on with every mark spelling —
// including the marks the parser removes before it reads anything.
// ═══════════════════════════════════════════════════════════════════════════

describe.skipIf(!distExists)("nothing after a `?` or a `#` is ever emitted", () => {
  const HEADS = [
    "https://api.test/v1",
    "https://api.test/go/https://svc:pw@h.test/x",
    "https://api.test//x:/a@b:PW",
    "https://api.test/go/https:/",
    "//h.test/p",
    "/rel/path",
    "file:///c:/Users/alice",
    "ftp://api.test/a",
    "https://api.test/go/https://YWxpY2U/cGFzc3dvcmQ",
    "https://api.test/go/https://svc:hun",
  ];
  const MARKS = ["?", "#", "?a=1#", "#x?", "?%23", "\\?", "\t?"];
  const AFTER = [
    "QSECRET",
    "a@QSECRET",
    "://u:QSECRET@h.test",
    "QSECRET/x",
    "@QSECRET",
    "//QSECRET@h/x",
    ":QSECRET@h",
    "ter2@QSECRET",
  ];
  const SUFFIXES = ["", "&z=1", "/tail", "#f2"];

  test("over every head, mark, and tail", { timeout: 60_000 }, async () => {
    const leaked: string[] = [];
    let measured = 0;
    for (const head of HEADS) {
      for (const mark of MARKS) {
        for (const after of AFTER) {
          for (const suffix of SUFFIXES) {
            const url = `${head}${mark}${after}${suffix}`;
            const cut = Math.min(...[url.indexOf("?"), url.indexOf("#")].filter((at) => at >= 0));
            // The claim is about a byte the caller wrote AFTER the mark, so a
            // row whose sentinel also appears before it decides nothing.
            if (url.slice(0, cut).includes("QSECRET")) continue;
            measured += 1;
            const emitted = await emittedUrl(url);
            if (emitted.includes("QSECRET")) leaked.push(`${url} — emitted ${emitted}`);
          }
        }
      }
    }

    expect(measured).toBeGreaterThan(2_000);
    expect(leaked.slice(0, 5)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The `CHANGELOG.md` entry's third bullet, against the built package.
//
// "`console.log`, `util.inspect`, and `Deno.inspect` no longer print an
//  error's raw, unredacted properties on Deno when `Object.prototype` carries
//  a polluted `Symbol.for("Deno.customInspect")`. … Both keys are stamped
//  now."
//
// Round 12 pinned that both keys carry a function. The claim the bullet makes
// is about what the hook under Deno's key RENDERS while the pollution is in
// place, which is a different question and is the one a consumer acts on.
// ═══════════════════════════════════════════════════════════════════════════

describe.skipIf(!distExists)("the Deno inspect key renders the redacted record", () => {
  const CREDENTIAL = "hunter2SECRET";

  test("a polluted Object.prototype hook does not reach the error's own properties", async () => {
    const { NotFoundError } = await loadErrors();
    const response = new Response(null, { status: 404, statusText: "Not Found" });
    Object.defineProperty(response, "url", {
      value: `https://alice:${CREDENTIAL}@api.test/v1?token=${CREDENTIAL}`,
      configurable: true,
    });
    const error = new NotFoundError(response);
    await error.cancel();

    const key = Symbol.for("Deno.customInspect");
    const polluted = Object.getOwnPropertyDescriptor(Object.prototype, key);
    Object.defineProperty(Object.prototype, key, {
      value: function inspectEverything(this: object) {
        return `POLLUTED ${JSON.stringify(Object.entries(this))}`;
      },
      configurable: true,
      writable: true,
    });
    try {
      type DenoHook = (depth: number, options: unknown, render: unknown) => unknown;
      const hook = (error as unknown as Record<symbol, DenoHook | undefined>)[key];
      expect(typeof hook, "the Deno key must carry the library's own hook").toBe("function");
      // Called the way Deno calls it: the pollution is on `Object.prototype`,
      // so a hook that is not the library's own answers here instead.
      const rendered = String(hook?.call(error, 2, {}, () => ""));

      expect(rendered).not.toContain(CREDENTIAL);
      expect(rendered).toContain("api.test");
    } finally {
      if (polluted === undefined) delete (Object.prototype as Record<symbol, unknown>)[key];
      else Object.defineProperty(Object.prototype, key, polluted);
    }
  });
});
