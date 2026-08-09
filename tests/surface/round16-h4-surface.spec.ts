import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { builtEntryUrl, distExists, warnWhenDistMissing } from "../../fixtures/built-package";

// ═══════════════════════════════════════════════════════════════════════════
// ROUND 16, LANE H4 — release readiness, the residual list, and the README's
// second copy of the redaction rule.
//
// Round 15 handed over one verdict: RELEASE READINESS IS FALSE, with four
// recorded reasons. Three of them were fixed in round 15's own fix phase, and
// this file PINS all three rather than re-reporting them — a pin is what stops
// a repaired sentence from rotting back, and `RELEASING.md` step 1 moves
// `[Unreleased]` VERBATIM into an immutable dated section, so a sentence that
// rots there rots permanently.
//
// The fourth reason is open, and it splits in two: the semver policy binds no
// rule to a change in what a REDACTED field emits, and no release step
// publishes a security advisory although `SECURITY.md` sends every reporter to
// one.
//
// Two more sentences are falsified here, both in `README.md`, and both are the
// same defect the frontier names: the README keeps its OWN copy of the
// redaction rule instead of linking `SECURITY.md`'s, and a copy drifts. Rounds
// 13 and 14 each produced a false sentence exactly this way.
//
// EVERY behavior claim below is measured against `dist/`, the artifact a
// consumer installs, and reached through `fixtures/built-package` — the one
// place in this repository that resolves a built path. No sentence is checked
// against another sentence.
// ═══════════════════════════════════════════════════════════════════════════

warnWhenDistMissing("round16-h4-surface", distExists);

// ── Reading the documents ────────────────────────────────────────────────

const documentText = (name: string): string =>
  readFileSync(new URL(`../../${name}`, import.meta.url), "utf8");

/** A document sentence with its line wrapping removed, so a quote can be found. */
const unwrapped = (text: string): string => text.replaceAll(/\s+/g, " ");

/**
 * One Markdown section, from its heading to the next heading at the same or a
 * higher level.
 *
 * BY HEADING TEXT, never by line number. Round 14 recorded the reason: a proof
 * that reads a document by line number silently moves onto a different sentence
 * when a paragraph above it grows, and then asserts about an empty string.
 */
function sectionOf(text: string, heading: string): string {
  const depth = heading.match(/^#+/)?.[0].length ?? 0;
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start < 0) throw new Error(`no section titled ${heading}`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => {
    const marks = line.match(/^#+/)?.[0].length ?? 0;
    return marks > 0 && marks <= depth;
  });
  return (end < 0 ? rest : rest.slice(0, end)).join("\n");
}

// ── Reading the built package ────────────────────────────────────────────

type PreResponseError = Error & {
  url: string;
  toJSON(): { name: string; message: string; url: string };
};
type HttpErrorLike = Error & {
  status: number;
  statusText: string;
  cancel(): Promise<void>;
  toJSON(): { url: string; statusText: string };
};
type RootBag = {
  NetworkError: new (message?: string, options?: { url?: string }) => PreResponseError;
  UnknownHttpError: new (response: Response) => HttpErrorLike;
};

const loadRoot = async (): Promise<RootBag> =>
  (await import(/* @vite-ignore */ builtEntryUrl("dist/index.mjs").href)) as RootBag;

/** The REDACTED url the BUILT package emits for `url` — the record's copy. */
async function emittedUrl(url: string): Promise<string> {
  const { NetworkError } = await loadRoot();
  return new NetworkError("Network error", { url }).toJSON().url;
}

/**
 * An `UnknownHttpError` built by the BUILT package over a response that reports
 * the wire reason phrase verbatim.
 *
 * A foreign response rather than `new Response`, because the platform
 * constructor refuses a `statusText` carrying a control character while the
 * HTTP parser does not — and the origin-written phrase is exactly what the
 * filter under test exists for.
 */
async function unknownHttpErrorFor(url: string, statusText: string): Promise<HttpErrorLike> {
  const { UnknownHttpError } = await loadRoot();
  const response = {
    [Symbol.toStringTag]: "Response",
    body: null,
    bodyUsed: false,
    headers: new Headers(),
    ok: false,
    redirected: false,
    status: 599,
    statusText,
    type: "basic",
    url,
    arrayBuffer: async () => new ArrayBuffer(0),
    blob: async () => new Blob(),
    clone: () => response,
    formData: async () => new FormData(),
    json: async () => ({}),
    text: async () => "",
  } as unknown as Response;
  return new UnknownHttpError(response);
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. RELEASE READINESS — the four reasons round 15 recorded.
//
// Reasons (a), (b), and (c) are PINS. They were fixed in round 15 and they are
// asserted here so the fix cannot be undone by the next edit to a block that
// `RELEASING.md` step 1 makes immutable.
// ═══════════════════════════════════════════════════════════════════════════

describe("the `[Unreleased]` block, which step 1 moves verbatim into a dated section", () => {
  const unreleased = (): string => sectionOf(documentText("CHANGELOG.md"), "## [Unreleased]");

  test("PIN (a): it states the split-point seam rule, not round 12's believed-parse rule", () => {
    const text = unwrapped(unreleased());

    // R15-H4-02 was this sentence: the seam believed "a parse that succeeds and
    // reports no credential". Round 14 replaced that mechanism with a direct
    // read of the parser's own split point, and round 15 corrected the block.
    expect(text).not.toMatch(/reports no credential/i);
    expect(text).not.toMatch(/only a parse that succeeds/i);
    expect(text.toLowerCase()).toContain("split point");
  });

  test("PIN (b): it opens with the affected released versions and the impact class", () => {
    // The lead has to answer a reader's two questions before the fix list: am I
    // affected, and what does the defect cost me.
    const lead = unwrapped(unreleased().trim().split("\n\n")[0] ?? "");

    expect(lead, "the `[Unreleased]` lead must name the affected released versions").toMatch(
      /2\.0\.1/,
    );
    expect(lead, "the `[Unreleased]` lead must name the impact class").toMatch(
      /credential|userinfo/i,
    );
  });

  test("PIN (c): a `### Changed` section holds the redactor move, and dist moved both ways", async () => {
    const text = unwrapped(unreleased());
    expect(text).toContain("### Changed");

    // BOTH directions, measured on the built package. The Changed section
    // claims the output moved for an ORDINARY input in each direction, so each
    // direction is one assertion against `dist`.
    expect({
      embeddedCredentialNowRemoved: await emittedUrl(
        "https://api.test/go/https://svc:hunter2@i.test/v1",
      ),
      filePathSegmentNowKept: await emittedUrl("file:///Users/alice@corp/report.pdf"),
    }).toEqual({
      embeddedCredentialNowRemoved: "https://api.test/go/https://i.test/v1",
      filePathSegmentNowKept: "file:///Users/alice@corp/report.pdf",
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// R16-H4-01 — the semver policy permits a PATCH for a change in what a
// redacted field emits.
//
// The policy is binding for every release and it decides the version number
// this release carries. Rule 2 frees `error.message` in any release, including
// a patch. No rule mentions `toJSON().url` at all — and `toJSON().url` is the
// record a structured logger writes, the one field `SECURITY.md` calls redacted
// by construction. `[Unreleased]`'s own `### Changed` section says that field's
// output moved in BOTH directions for ordinary inputs.
//
// So a strict reading of `RELEASING.md` permits 2.0.2: a patch that silently
// changes the string every log line, alert rule, and correlation key is built
// from. The rule this policy is missing is the one that binds a change in what
// a REDACTED field emits to at least a minor.
// ═══════════════════════════════════════════════════════════════════════════

describe.skipIf(!distExists)(
  "the semver policy against the redacted field it does not name",
  () => {
    test("`toJSON().url` emits a different string than 2.0.1 did, for an ordinary input", async () => {
      // The evidence half, and it passes: the field moved. `2.0.1` emitted the
      // embedded credential and deleted the `file:` segment; `dist` does the
      // opposite of both. Neither input is an attack shape.
      expect({
        embedded: await emittedUrl("https://api.test/go/https://svc:hunter2@i.test/v1"),
        file: await emittedUrl("file:///go/file:/Users/alice@corp/report.pdf"),
      }).toEqual({
        embedded: "https://api.test/go/https://i.test/v1",
        file: "file:///go/file:/Users/alice@corp/report.pdf",
      });
    });

    test("the semver policy binds a rule to what a redacted field emits", () => {
      const policy = sectionOf(documentText("RELEASING.md"), "## Semver policy");
      const flat = unwrapped(policy);

      // The field the policy has to name. Any of these spellings counts: the test
      // asks for a RULE about the redacted emission, not for one wording.
      const named = ["toJSON()", "redactUrl", "redacted"].filter((needle) => flat.includes(needle));

      expect(
        named,
        "RELEASING.md `## Semver policy` binds no rule to what `toJSON().url` emits, so a " +
          "release that moves a redacted field in both directions is permitted as a patch",
      ).not.toEqual([]);
    });
  },
);

// ═══════════════════════════════════════════════════════════════════════════
// R16-H4-02 — no release step publishes a security advisory.
//
// `SECURITY.md` sends every reporter to GitHub Security Advisories. A reporter
// who followed that instruction gets a fix shipped through a checklist with no
// step that publishes the advisory back, so the advisory the reporter opened is
// the only record, and it stays private. The eleven-gate checklist is the
// document that would carry the step.
// ═══════════════════════════════════════════════════════════════════════════

describe("the release checklist against the channel `SECURITY.md` directs reporters to", () => {
  test("`SECURITY.md` directs a reporter to GitHub Security Advisories", () => {
    // The evidence half, and it passes.
    expect(unwrapped(documentText("SECURITY.md"))).toContain("GitHub Security Advisories");
  });

  test("the release checklist has a step that publishes the advisory", () => {
    const checklist = sectionOf(documentText("RELEASING.md"), "## Release checklist");

    expect(
      /advisor/i.test(checklist),
      "RELEASING.md `## Release checklist` never publishes a security advisory, although " +
        "SECURITY.md sends every reporter to one and this release fixes reported credential " +
        "disclosure",
    ).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// R16-H4-03 — the residual list states no membership rule at its head.
//
// THE RULE THE LIST FOLLOWS, read off its six entries: the list holds every
// deliberate limit under which a SECRET the caller placed in a url or a header
// can still reach a reader through a channel this library controls. A limit
// that costs only a DIAGNOSTIC — a detail a reader would have liked, never a
// value an attacker wants — is out of scope and is not listed.
//
// That rule is consistent with all six entries, and the source holds four
// limits it excludes. All four are proved against `dist` below. Nothing at the
// head of the list says which of the two a reader is looking at, so a reader
// who finds one of the four in the source cannot tell an omission that was
// decided from one that was forgotten. Round 14 already found one residual
// bullet claiming a limit NARROWER than the module holds, so "nobody wrote it
// down" is not a safe default here.
// ═══════════════════════════════════════════════════════════════════════════

describe.skipIf(!distExists)("the `SECURITY.md` residual list and the limits it excludes", () => {
  const residuals = (): string => sectionOf(documentText("SECURITY.md"), "## Known residuals");

  /** The head of the list: everything before the first bullet. */
  const head = (): string => unwrapped(residuals().split("\n- **")[0] ?? "");

  test("the head states the rule that decides what the list holds", () => {
    const text = head();

    expect({
      namesWhatTheListHolds: /secret|credential/i.test(text) && /channel|reader|reach/i.test(text),
      namesWhatItExcludes: /diagnostic/i.test(text),
    }).toEqual({
      // A reader must be able to decide, from the head alone, whether a limit
      // found in the source belongs here.
      namesWhatTheListHolds: true,
      namesWhatItExcludes: true,
    });
  });

  test("EVIDENCE: the list never names a limit whose cost is a diagnostic", () => {
    // The passing half. The list is silent about the whole class, which is what
    // makes the head sentence load-bearing rather than cosmetic.
    //
    // Scoped to the BULLETS. The head is a substring of the section, and the
    // test above requires the head to name the excluded class by that exact
    // word, so reading the whole section here asks the document to say
    // "diagnostic" and not say it at the same time. The first version of this
    // pair was unsatisfiable, and F4b reported it rather than editing either
    // test.
    const bullets = residuals().split("\n- **").slice(1).join("");
    expect(/diagnostic/i.test(bullets)).toBe(false);
  });

  test("EVIDENCE 1 and 2: the origin's reason phrase is bounded and filtered in dist", async () => {
    const bounded = await unknownHttpErrorFor("https://api.test/x", "P".repeat(300));
    // ESC opens the two terminal sequences `safeReasonPhrase` names, and U+202E
    // reverses everything the library appends after the phrase.
    const filtered = await unknownHttpErrorFor(
      "https://api.test/x",
      "before\u001b[2K\u001b[1A\u202Eafter",
    );

    expect({
      truncatedAt: bounded.statusText.length,
      filtered: filtered.statusText,
    }).toEqual({
      // `REASON_PHRASE_LIMIT`. The tail of a long phrase is a diagnostic, and
      // no origin puts a caller's secret there.
      truncatedAt: 128,
      // The ESC bytes and the bidi override are gone; the legible text is not.
      filtered: "before[2K[1Aafter",
    });
  });

  test("EVIDENCE 3: a message loses text that matches a credential needle from the url", async () => {
    const { NetworkError } = await loadRoot();
    const url = "https://api.test/avatar/https://gravatar.test/u/alice@example.com";
    const error = new NetworkError(`failed while contacting gravatar.test/u/alice@example.com`, {
      url,
    });

    // `redactUrlInMessage` takes `gravatar.test/u/alice@` as a needle and
    // removes every occurrence. The message now names a different host than the
    // request reached. A diagnostic, and never a secret: the needle IS the
    // credential span, so the direction of the loss is always over-redaction.
    expect(error.message).toBe("failed while contacting example.com");
  });

  test("EVIDENCE 4: parentheses in a path are percent-encoded in the message only", async () => {
    const error = await unknownHttpErrorFor("https://api.test/a(b)c", "Nope");

    expect({
      message: error.message,
      record: error.toJSON().url,
    }).toEqual({
      // The parentheses are the message line's own delimiters, so the message
      // form escapes them. A reader who greps the message for the path it
      // requested finds nothing.
      message: 'HTTP 599 "Nope" (https://api.test/a%28b%29c)',
      record: "https://api.test/a(b)c",
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// R16-H4-04 — the README's own copy of the redaction rule is false against
// dist for an embedded url.
//
// `SECURITY.md` carries the qualifier: "An embedded url inside that path is not
// a path segment." The README's copy does not, and states the unqualified rule
// twice — "the record holds the origin and path", and "A hierarchical path is
// kept, so a secret in a path segment reaches the record".
//
// Both are false for an ordinary proxy or forwarding url. A caller who
// correlates concurrent failures by `toJSON().url`, which is the use the same
// paragraph recommends, gets a url whose path is not the path it requested.
// ═══════════════════════════════════════════════════════════════════════════

describe.skipIf(!distExists)("the README `toJSON()` section against dist", () => {
  const serializeSection = (): string =>
    sectionOf(documentText("README.md"), "#### Serialize an error");

  test("PIN: the section links the residual list rather than owning the residual shapes", () => {
    expect(unwrapped(serializeSection())).toContain("SECURITY.md#known-residuals");
  });

  test("the record does not hold the whole path of a url carrying an embedded url", async () => {
    const url = "https://api.test/go/https://svc:hunter2@i.test/v1";
    const parsed = new URL(url);

    // The evidence half, and it passes: a path segment is gone.
    expect(await emittedUrl(url)).not.toBe(`${parsed.origin}${parsed.pathname}`);

    // So the README's copy of the rule needs the qualifier SECURITY.md's copy
    // carries. Restating the rule instead of linking it is what produced this,
    // and it is the third time.
    expect(
      /embedded url/i.test(serializeSection()),
      "README `#### Serialize an error` states 'the record holds the origin and path' and " +
        "'a secret in a path segment reaches the record' with no embedded-url qualifier, and " +
        "dist drops a path segment for https://api.test/go/https://svc:hunter2@i.test/v1",
    ).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// R16-H4-05 — the README enumerates the opaque schemes the record can hold,
// and dist holds others.
//
// "An opaque scheme carries its payload in the path instead. The redactor
// therefore keeps only `data:` or `blob:`." A reader building a log allow-list
// or a redaction check from that enumeration gets a set of two. `dist` emits
// `mailto:`, `urn:`, `git:`, and `about:` for the same rule.
// ═══════════════════════════════════════════════════════════════════════════

describe.skipIf(!distExists)("the README's opaque-scheme enumeration against dist", () => {
  test("dist emits opaque schemes the enumeration does not list", async () => {
    expect({
      mailto: await emittedUrl("mailto:alice:pw@example.com"),
      urn: await emittedUrl("urn:isbn:0451450523"),
      git: await emittedUrl("git://svc:pw@host.test/x"),
      about: await emittedUrl("about:blank"),
    }).toEqual({
      mailto: "mailto:",
      urn: "urn:",
      git: "git:",
      about: "about:",
    });
  });

  test("the README does not claim the redactor keeps only two of them", () => {
    expect(
      unwrapped(documentText("README.md")),
      "README claims the redactor keeps only `data:` or `blob:` for an opaque url; dist also " +
        "emits `mailto:`, `urn:`, `git:`, and `about:`",
    ).not.toContain("The redactor therefore keeps only `data:` or `blob:`.");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// COVERAGE SUB-LANE C4 — the exclusion pin.
//
// Section 8.5 option (d) grants an exclusion to exactly two files, because each
// runs under a runtime a Node worker cannot host and each is executed by that
// runtime in CI. An exclusion list that can grow in silence turns a 100 percent
// threshold into decoration, so the list is pinned here and a third path fails
// this test.
//
// This is COVERAGE work, not a defect report. It fails until F4 lands the
// config of section 8.6.
// ═══════════════════════════════════════════════════════════════════════════

describe("the coverage configuration", () => {
  const config = (): string => documentText("vitest.config.ts");

  /**
   * The strings of one named array in the config, read as an ARRAY.
   *
   * R17-H4-02. Both pins below used to match the config's whole text with a
   * regular expression anchored on what they expected to find: the exclusion
   * pin looked for `"scripts/smoke/…"` and the include pin for
   * `"src|scripts|fixtures/**"`. A pattern that names what it expects cannot
   * see what it does not expect, so adding `"fixtures/http-server.ts"` to the
   * exclusion list left the pin green, and a file the round had just brought
   * under measurement could be dropped from the 100 percent gate in silence.
   * That is the same defect as R16-ORCH-01 one layer up: a test that reads
   * something other than what it claims to guard.
   *
   * Reading the array itself is what makes the pin able to fail. Any entry,
   * named or not, appears in the answer.
   */
  const stringsOf = (field: "include" | "exclude"): string[] => {
    const block = new RegExp(`${field}:\\s*\\[([^\\]]*)\\]`).exec(config());
    expect(block, `vitest.config.ts declares no ${field} array`).not.toBeNull();
    return [...(block?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((match) => match[1] ?? "").toSorted();
  };

  test("the exclusion list holds exactly the two cross-runtime smokes", () => {
    expect(stringsOf("exclude")).toEqual(["scripts/smoke/bun.mjs", "scripts/smoke/deno.ts"]);
  });

  test("the include list names `scripts/**` and `fixtures/**` beside `src/**`", () => {
    expect(stringsOf("include")).toEqual(["fixtures/**", "scripts/**", "src/**"]);
  });

  test("the `coverage` script does not override the include the config declares", () => {
    // Round 16 landed the include above and the gate kept reporting on `src/`
    // alone, because `package.json`'s `coverage` script carried
    // `--coverage.include='src/**'` and a command-line value beats the config
    // file. The two pins above read the file the command was ignoring, so they
    // were green while the gate measured the wrong thing — a gate that cannot
    // fail when what it guards is broken.
    //
    // Any `--coverage.include` in the script re-creates that, whatever it
    // names, so the assertion forbids the flag rather than a value.
    const manifest = JSON.parse(documentText("package.json")) as {
      scripts: Record<string, string>;
    };

    expect(manifest.scripts.coverage).not.toMatch(/--coverage\.include/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The declared engines floor against the newest built-in `src/` reaches for.
//
// A PIN, and it passes. `engines.node` is `>=20.13.0`, and the floor is set by
// undici's `Response.clone()` tee polarity rather than by a syntax feature — so
// the way this claim breaks is a later round reaching for a built-in that
// landed after 20.13.0. The names below are the ones a modern editor suggests
// first, each landing in Node 21 or later.
// ═══════════════════════════════════════════════════════════════════════════

describe("the declared engines floor", () => {
  const AFTER_THE_FLOOR = [
    "Object.groupBy",
    "Map.groupBy",
    "Promise.withResolvers",
    "Array.fromAsync",
    "ArrayBuffer.prototype.transfer",
    "RegExp.escape",
    "Error.isError",
    "Iterator.from",
    "Math.f16round",
  ];

  test("`src/` reaches for no built-in newer than the floor it declares", () => {
    const sources = documentText("package.json");
    expect(JSON.parse(sources).engines.node).toBe(">=20.13.0");

    const src = readFileSync(new URL("../../src/index.ts", import.meta.url), "utf8");
    const errors = readFileSync(new URL("../../src/errors/index.ts", import.meta.url), "utf8");
    const reached = AFTER_THE_FLOOR.filter((name) => src.includes(name) || errors.includes(name));

    expect(reached).toEqual([]);
  });
});
