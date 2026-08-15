import { describe, expect, test } from "vitest";
import { NetworkError } from "../../src/errors";
import { redactUrl, redactUrlInMessage } from "../../src/errors/redact-url";
import { userinfoSpans } from "../../src/errors/userinfo-spans";
import { everyChannel, leakingChannels, PASSWORD } from "../../fixtures/channels";

// ═══════════════════════════════════════════════════════════════════════════
// ROUND 21 — H2. THE SPAN THE SCANNER FINDS AND THE NEEDLE NO MESSAGE CAN
// MATCH, AND THE SEAM ASKED OF A URL THAT HAS NO SEAM.
//
// Two mechanisms, both in the SECOND line of `redactUrlInMessage`. The first
// line replaces the caller's url wherever a message quotes it verbatim; the
// second removes every userinfo the url carries, and its own comment states
// what it is for:
//
//   "BEST EFFORT, and deliberately so: a platform that re-serializes the URL
//    before putting it in its message defeats the exact-string replacement.
//    The userinfo pass is the second line — userinfo is unconditionally a
//    credential, so it is removed wherever it survives."
//
// Section 1 is a credential the scanner FINDS and that second line cannot
// remove. Section 2 is ordinary text the second line removes although no
// parser reads it as a userinfo at all.
//
// ── 1. R21-H2-01. A NEEDLE THAT ENDS AT A SOLIDUS MATCHES NOTHING. ─────────
//
// `pastFiller` advances the span cursor past everything the next parse will
// drop — the solidi, and the single-dot segments — and `userinfoSpans` closes
// the span AT that cursor:
//
//   cut = pastFiller(text, at + 1, SINGLE_DOT_SEGMENTS);
//   ...
//   if (cut > open) spans.push({ start: open, end: cut });
//
// So where the region's last `@` is followed by a solidus, the span the
// scanner answers ends at a `/` rather than at the `@`. For `redactUrl` that
// is correct and free: the span is a POSITION, and removing one character more
// removes text the rebuild would have dropped anyway.
//
// For a MESSAGE it is not free. `hiddenUserinfos` turns the same span into a
// needle by slicing it, and `withoutUserinfos` matches needles only at the
// `@`s of the message:
//
//   for (let at = message.indexOf("@"); at >= 0; at = message.indexOf("@", at + 1))
//
// A needle whose last character is `/` therefore cannot match ANY message,
// ever. The credential the scanner found is dropped on the floor between the
// two routes, and the password stays in `error.message`, in
// `toJSON().message`, and in every channel that renders either.
//
// Round 20's fixer named this mechanism — `pastFiller` "WIDENS a span" — and
// acted on it only for the direction that costs a POP. The direction that
// costs a needle was left standing.
//
// THE URLS BELOW ALL PARSE. `new URL` accepts every one of them; the empty
// host belongs to the EMBEDDED authority, which is path text to the outer
// parse. The class of url the parser REJECTS is a different class and is not
// this section's subject.
//
// ── 2. R21-H2-02. THE SEAM IS ASKED OF A URL THAT HAS NO AUTHORITY. ────────
//
// `seamUserinfo` decides whether a url has a seam by reading one member:
//
//   if (parsed.host !== "" && !spilled) return null;
//   return seamSpan(parsed.pathname);
//
// Its own comment names the state that guard is written for: "AN EMPTY HOST.
// The origin is then `scheme://` and the solidi are its. Among the six
// hierarchical schemes only `file:` reaches one." An OPAQUE url reports the
// same empty `host` for the opposite reason — it has no authority component at
// all, so there is no seam and no origin solidi for a mark to be written
// across. `slotUserinfos` asks the question of every parsed url, hierarchical
// or not, so `mailto:alice@example.com` is handed to `seamSpan`, which reads
// the pathname `alice@example.com`, finds the `@`, and answers the span
// `alice@`.
//
// `redactUrl` is right about the same url — an opaque url is reduced to its
// scheme, and `redaction-discarded-input-text.spec.ts` pins that row. The
// needle is the only route that acts on the wrong answer, and it deletes the
// local part of an e-mail address from the message WHEREVER it appears. That
// is R20-H3-04's class at a needle that is not empty: text the URL Standard
// reads as nothing of the kind, removed from a record a logger ships.
//
// ── 3, 4, 5. Corpora that came out CLEAN, recorded so the next round does not
// redraw them: the pairwise and triplewise grid, the terminator parameter's
// six call sites, and a fifth cost instrument with its bound.
//
// NOTHING HERE IS A TIME RATIO. Section 5 states counts per input character
// and a flat ratio across an eightfold size sweep.
// ═══════════════════════════════════════════════════════════════════════════

const ORIGIN = "https://api.test";

/** The path a parse produces for `url`, which is the text the needles come from. */
function pathnameOf(url: string): string {
  return new URL(url).pathname;
}

/**
 * Every needle the scanner hands the message pass for one text, taken exactly
 * as `hiddenUserinfos` takes it: the span, sliced.
 */
function spansOf(text: string): string[] {
  return userinfoSpans(text)
    .map((span) => text.slice(span.start, span.end))
    .filter((span) => span.length > 1);
}

/**
 * Every needle the scanner hands the MESSAGE pass, as `hiddenUserinfos` derives
 * it: the span, cut back to the last `@` it holds.
 *
 * ORCHESTRATOR REPAIR, round 21. This helper did not exist, and the property
 * test below read `spansOf` instead — so it demanded that every SPAN end at an
 * `@` while its sibling pinned one span as `svc:hunter2@/`. Both read the same
 * expression and asked for opposite answers, so no implementation could satisfy
 * the pair, and the fix the finding calls for deliberately leaves the span
 * alone: the span's width is right for the url route, and only the needle
 * derived from it was wrong. The two concepts now have two names.
 */
function needlesOf(text: string): string[] {
  return spansOf(text)
    .map((span) => span.slice(0, span.lastIndexOf("@") + 1))
    .filter((needle) => needle.length > 1);
}

// ── 1. R21-H2-01 — the span the message pass cannot spend ──────────────────

describe("a credential the scanner finds and no message can lose", () => {
  /**
   * Three spellings of one mechanism. Each is a url the parser ACCEPTS whose
   * embedded credential is followed immediately by a solidus, and each carries
   * a `quoted` spelling a platform writes that is NOT the caller's own text —
   * which is the exact state the userinfo pass exists for.
   */
  const SHAPES = [
    {
      name: "an embedded authority with an empty host, quoted without the fragment",
      url: `${ORIGIN}/go/https://svc:${PASSWORD}@/v1#anchor`,
      quoted: `${ORIGIN}/go/https://svc:${PASSWORD}@/v1`,
    },
    {
      name: "a reverse solidus the parser folded, quoted as the parser serialized it",
      url: `${ORIGIN}/go/https://svc:${PASSWORD}@\\v1`,
      quoted: `${ORIGIN}/go/https://svc:${PASSWORD}@/v1`,
    },
    {
      name: "a dot segment behind the region's last `@`, quoted as the path",
      url: `${ORIGIN}/go/https://svc:${PASSWORD}@h.test/@./v1`,
      quoted: `/go/https://svc:${PASSWORD}@h.test/@./v1`,
    },
  ] as const;

  test("R21-H2-01: NON-VACUITY — every url parses, and the scanner finds the credential", () => {
    // The parse succeeds, so this is not the unparseable-url class.
    expect(SHAPES.map((shape) => new URL(shape.url).protocol)).toEqual([
      "https:",
      "https:",
      "https:",
    ]);
    // The scanner found it: `redactUrl` removes the credential from the url it
    // emits, on every one of the three. The defect below is therefore a defect
    // of the needle ROUTE and never of the scan.
    expect(SHAPES.filter((shape) => redactUrl(shape.url).includes(PASSWORD))).toEqual([]);
    // And the platform really does write the quoted spelling: it is the url's
    // own serialization, or its serialization with a slot the message dropped.
    expect(SHAPES.filter((shape) => !shape.quoted.includes(PASSWORD))).toEqual([]);
  });

  test("R21-H2-01: a needle ends at the `@` that closes the userinfo it names", () => {
    // THE CORRECT BEHAVIOUR, stated as a property of the needle rather than of
    // one url. `withoutUserinfos` tests a message slice only where the slice
    // ends at an `@`, so a needle whose last character is anything else is a
    // needle that can never be spent. Whatever the span is worth to the url
    // route, the text handed to the message route has to end where a userinfo
    // ends.
    const dead = SHAPES.flatMap((shape) =>
      needlesOf(pathnameOf(shape.url))
        .filter((needle) => !needle.endsWith("@"))
        .map((needle) => `${shape.name}: ${needle}`),
    );
    expect(dead).toEqual([]);
  });

  test("R21-H2-01: the userinfo pass removes the password the first line could not", () => {
    // The message quotes a spelling the exact-string replacement cannot reach,
    // which is the documented state the second line is the answer to. The
    // second line holds a needle for this credential and cannot match it.
    const leaking = SHAPES.filter((shape) =>
      redactUrlInMessage(`TypeError: fetch failed for ${shape.quoted}`, shape.url).includes(
        PASSWORD,
      ),
    ).map((shape) => shape.name);
    expect(leaking).toEqual([]);
  });

  test("R21-H2-01: no channel of a NetworkError carries the password", () => {
    // THE PUBLIC SURFACE. `NetworkError` is public API and its constructor is
    // the one a consumer wrapping an adapter calls with the platform's own
    // text; `pre-response-error.ts` cleans that text with `redactUrlInMessage`
    // and copies the result into `toJSON().message` verbatim.
    const shape = SHAPES[0];
    const error = new NetworkError(`TypeError: fetch failed for ${shape.quoted}`, {
      url: shape.url,
    });
    expect(leakingChannels(everyChannel(error), [PASSWORD])).toEqual([]);
    // And the url channel is clean, so the two records of one failure disagree
    // about whether the caller wrote a credential.
    expect(String(error.toJSON().url).includes(PASSWORD)).toBe(false);
  });

  test("R21-H2-01: the widening is the cause, and a needle ending at the `@` is enough", () => {
    // THE MECHANISM, ISOLATED. The same embedded credential with one character
    // changed — a host where the empty host was — closes its span AT the `@`,
    // and the same message loses the password. So nothing about the message,
    // the quoting, or the scan differs; only where `pastFiller` left the span.
    const control = `${ORIGIN}/go/https://svc:${PASSWORD}@h.test/v1#anchor`;
    const quoted = `${ORIGIN}/go/https://svc:${PASSWORD}@h.test/v1`;
    expect(spansOf(pathnameOf(control))).toEqual([`svc:${PASSWORD}@`]);
    expect(redactUrlInMessage(`TypeError: fetch failed for ${quoted}`, control)).not.toContain(
      PASSWORD,
    );
    // The subject differs from that control by the host alone.
    // The SPAN keeps its width — that is right for the url route. The needle
    // derived from it is what had to change, and the property test above holds
    // it.
    expect(spansOf(pathnameOf(SHAPES[0].url))).toEqual([`svc:${PASSWORD}@/`]);
  });
});

// ── 2. R21-H2-02 — the seam asked of a url that has none ───────────────────

describe("an opaque url is handed the seam question", () => {
  const RECIPIENT = "alice@example.com";
  const MAILTO = `mailto:${RECIPIENT}`;

  test("R21-H2-02: NON-VACUITY — the parser reads no userinfo, and the url route agrees", () => {
    const parsed = new URL(MAILTO);
    // No authority component at all: the empty `host` is not an empty HOST, it
    // is the absence of the slot the seam question is about.
    expect({ host: parsed.host, username: parsed.username, password: parsed.password }).toEqual({
      host: "",
      username: "",
      password: "",
    });
    // And `redactUrl` is right about the same url: an opaque url is reduced to
    // its scheme. `redaction-discarded-input-text.spec.ts` pins that row.
    expect(redactUrl(MAILTO)).toBe("mailto:");
  });

  test("R21-H2-02: a message keeps the recipient an opaque url names", () => {
    // The platform's own wording, quoting the address once inside the url and
    // once as the value it is. The first line of `redactUrlInMessage` removes
    // the url; nothing may remove the local part of an address that is not a
    // userinfo of anything.
    const message = `TypeError: Failed to parse URL from ${MAILTO}; ${RECIPIENT} was refused`;
    expect(redactUrlInMessage(message, MAILTO)).toBe(
      `TypeError: Failed to parse URL from mailto:; ${RECIPIENT} was refused`,
    );
  });

  test("R21-H2-02: every opaque scheme with an `@` before its first solidus", () => {
    // A PROPERTY OF THE GUARD, not of one scheme name. Any scheme the URL
    // Standard leaves opaque reports the empty `host`, so any of them reaches
    // `seamSpan`.
    const damaged = ["mailto", "sip", "xmpp", "urn", "im"]
      .map((scheme) => `${scheme}:${RECIPIENT}`)
      .filter((url) => !redactUrlInMessage(`sent to ${RECIPIENT}`, url).includes(RECIPIENT));
    expect(damaged).toEqual([]);
  });

  test("R21-H2-02: the state the guard IS written for still answers", () => {
    // THE FIX MAY NOT COST THIS. `file:` is the one hierarchical scheme that
    // reaches an empty host, and there the origin's own solidi really do write
    // a mark across the seam. The needle for that url must stay.
    const url = `file:///svc:${PASSWORD}@internal.test/v1`;
    expect(redactUrlInMessage(`boom ${new URL(url).pathname} boom`, url)).not.toContain(PASSWORD);
    expect(redactUrl(url)).not.toContain(PASSWORD);
  });
});

// ── 3. The grid: round 20's changes crossed with what predates them ────────

/**
 * ONE FRAGMENT PER INDEPENDENT CONDITION the two modules carry, chosen so that
 * a fragment is a piece of PATH and any two or three of them concatenate into
 * one url. The list crosses round 20's seven changes with the conditions that
 * predate them, which is the half no previous grid covered: round 20's own
 * grid crossed its six changes with each other.
 */
const FRAGMENTS = [
  // authorityAt / isSpecialScheme / nextAuthority — the region OPENINGS
  `https://svc:${PASSWORD}@h.test/`,
  `https:/svc:${PASSWORD}@h.test/`,
  `https:svc:${PASSWORD}@h.test/`,
  `//svc:${PASSWORD}@h.test/`,
  `://svc:${PASSWORD}@h.test/`,
  `9://svc:${PASSWORD}@h.test/`,
  `file:/svc:${PASSWORD}@h.test/`,
  `file://svc:${PASSWORD}@h.test/`,
  `git://svc:${PASSWORD}@h.test/`,
  // spellsToken — the ASCII case-insensitive scheme match (round 20)
  `HtTpS://svc:${PASSWORD}@h.test/`,
  `https:\\\\svc:${PASSWORD}@h.test/`,
  // pastFiller / pastOnePop / popsBefore — the dot segments and the pops
  "@./",
  "@../",
  "@%2e/",
  "@%2e%2e/",
  "///@../",
  "https:/@../",
  // looksLikeUserinfo — its three rules
  "users/@alice/",
  "@scope/pkg/",
  "tok@",
  "YWxpY2U/cGFzc3dvcmQ@h.test/",
  // readsAsHostAndPort — its three conditions, including round 20's second
  "://cdn.test:8443/users/@alice/",
  "://u:@cdn.test:8443/users/@alice/",
  "://:@cdn.test:8443/users/@alice/",
  `://svc:${PASSWORD}@i.test/users/@bob/`,
  "://a:99999/x/@bob/",
  "://a:1234/x/@bob/",
  // parsesAsAuthority — the region whose start does and does not read
  `https://alice:${PASSWORD}://x@i.test/`,
  "https://YWxpY2U/cGFzc3dvcmQ://x@h.test/",
  // endsAuthority(character, folds) and spilledAuthority (round 20)
  `https://svc:hun\\ter2@h.test/`,
  `git://svc:hun\\ter2@h.test/`,
  `\\svc:${PASSWORD}@h.test/`,
  // spellsCredentialHead and its drive-letter carve-out (round 20)
  "c:/Users/alice@corp/",
  "a:b/c/mail@example.com/",
  // ordinary path, so a cross can be one condition alone
  "deep/",
  "a/b/",
  "x:y/",
] as const;

/** The outer shapes: the seam, the head, `pastStripped`, and the two branches. */
const OUTER = [
  (body: string) => `${ORIGIN}/x/${body}v1`,
  (body: string) => `${ORIGIN}/x/${body}v1?q=1`,
  (body: string) => `${ORIGIN}/x/${body}v1#f`,
  (body: string) => `https://svc:${PASSWORD}@api.test/x/${body}v1`,
  (body: string) => `file:///x/${body}v1`,
  (body: string) => `//api.test/x/${body}v1`,
  (body: string) => `/x/${body}v1`,
  (body: string) => ` ${ORIGIN}/x/${body}v1`,
] as const;

function parseEither(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    /* not absolute */
  }
  try {
    return new URL(url, "http://url.invalid");
  } catch {
    return null;
  }
}

/**
 * The judge: the classes of wrong answer one url can produce.
 *
 * NO PLANTED-STRING JUDGE, and that is deliberate. Counting the appearance of
 * a secret in the emitted text calls a leak on `/x/tok@\svc:PW@h.test/v1`,
 * where the parser folds the `\` into a `/` and the text is a PATH SEGMENT no
 * parse anywhere reads as a credential — the residual this module records and
 * keeps. So every property below is asked of the module's own answers instead,
 * and needs no calibration:
 *
 *  - `redactUrl` is a fixed point of itself, never throws, and never moves the
 *    host it names.
 *  - EVERY NEEDLE ENDS AT AN `@`, because `withoutUserinfos` matches a message
 *    slice only there.
 *  - EVERY USERINFO THE SCANNER FOUND IS SPENT. A span the scan answers for a
 *    `pathname` names a userinfo; the message pass is handed that same text,
 *    so a message quoting the path may not keep it.
 */
function classesOf(url: string, answers: { n: number }): Set<string> {
  const bad = new Set<string>();
  let redacted: string;
  try {
    redacted = redactUrl(url);
    answers.n += 1;
  } catch {
    bad.add("throw:url");
    return bad;
  }
  try {
    answers.n += 1;
    if (redactUrl(redacted) !== redacted) bad.add("fixedpoint");
  } catch {
    bad.add("throw:fixedpoint");
  }
  const parsed = parseEither(url);
  if (parsed !== null && parsed.host !== "" && redacted.startsWith(`${parsed.protocol}//`)) {
    const again = parseEither(redacted);
    if (again !== null && again.host !== parsed.host) bad.add("movedhost");
  }
  const path = parsed === null ? url : parsed.pathname;
  const userinfos: string[] = [];
  for (const span of userinfoSpans(path)) {
    const needle = path.slice(span.start, span.end);
    if (needle.length > 1 && !needle.endsWith("@")) bad.add("unmatchable-needle");
    const at = path.lastIndexOf("@", span.end - 1);
    if (at < span.start) continue;
    const userinfo = path.slice(span.start, at + 1);
    if (userinfo.length > 1) userinfos.push(userinfo);
  }
  if (userinfos.length > 0) {
    answers.n += 1;
    let out = "";
    try {
      out = redactUrlInMessage(`boom ${path} boom`, url);
    } catch {
      bad.add("throw:message");
    }
    for (const userinfo of userinfos) if (out.includes(userinfo)) bad.add("unspent-needle");
  }
  return bad;
}

describe("the grid, round 20's changes crossed with what predates them", () => {
  // ORCHESTRATOR, round 21: an explicit timeout. Under v8 instrumentation this
  // grid takes 4.4 s against 1.7 s without, so it sat 0.6 s under the 5000 ms
  // default and turned `pnpm coverage` — a RELEASE gate — red on a slower
  // runner. A generator test states its own budget.
  test("R21-H2 grid: no interaction produces a class its parts do not", () => {
    const answers = { n: 0 };
    // Every fragment alone, under every outer shape, is the baseline: a class
    // a fragment produces by itself is that fragment's own answer, and the
    // grid is only interested in what the CROSS adds.
    const solo = new Map<string, Set<string>>();
    for (const [index, outer] of OUTER.entries()) {
      for (const fragment of FRAGMENTS) {
        solo.set(`${index}|${fragment}`, classesOf(outer(fragment), answers));
      }
    }
    const unknown = new Set<string>();
    // The two classes the cross is ALLOWED to add, both of them section 1's:
    // a span the message pass cannot match, and the userinfo it therefore
    // cannot spend.
    const known = new Set(["unmatchable-needle", "unspent-needle"]);
    let urls = solo.size;
    const cross = (index: number, parts: readonly string[]) => {
      urls += 1;
      const found = classesOf(OUTER[index]!(parts.join("")), answers);
      const base = new Set(parts.flatMap((part) => [...solo.get(`${index}|${part}`)!]));
      for (const one of found) if (!base.has(one) && !known.has(one)) unknown.add(one);
    };
    for (const index of OUTER.keys()) {
      for (const a of FRAGMENTS) for (const b of FRAGMENTS) cross(index, [a, b]);
    }
    for (const a of FRAGMENTS) {
      for (const b of FRAGMENTS) for (const c of FRAGMENTS) cross(0, [a, b, c]);
    }
    // NON-VACUITY: the grid is the size it claims to be, and it read that many
    // answers out of the module — the emitted url, the second emitted url the
    // fixed point needs, and one message per url that carries a userinfo.
    expect(urls).toBe(296 + 8 * 37 * 37 + 37 * 37 * 37);
    expect(answers.n).toBeGreaterThan(150_000);
    expect([...unknown]).toEqual([]);
  }, 30_000);
});

// ── 4. The terminator is a parameter: six call sites, one dissenter ────────

describe("`endsAuthority(character, folds)` and its six call sites", () => {
  test("R21-H2 folds: a password the PARSER reports is removed under every scheme", () => {
    // `authorityEnd` is the only reader of `endsAuthority`, and six questions
    // reach it. Five pass `folds = true` — `seamUserinfoEnd`, `parsesAsAuthority`,
    // `readsAsHostAndPort`, `userinfoSpans`' bound, and every region scan
    // underneath them — because every text they read that is not a raw url is
    // read as the authority a SPECIAL-scheme parse would produce. One passes
    // the scheme's own answer: `afterOwnAuthority`, and through it
    // `ownUserinfo` and `spilledAuthority`.
    //
    // The one region two of them both read is the url's OWN authority: the
    // scheme-aware walk bounds it, and the region scan over `url.slice(0, cut)`
    // reads the same slice with `folds` fixed true. This corpus crosses eleven
    // schemes with five solidus counts and eight authority bodies, and asks the
    // only question the disagreement could cost: does the caller's own spelling
    // of a password the PARSER reports survive anywhere?
    const schemes = ["https", "http", "ws", "wss", "ftp", "file", "git", "svn", "x-x", "ssh"];
    const marks = ["//", "/", "", "\\\\", "\\/"];
    const bodies = [
      "svc:hun\\ter2@api.test/v1",
      "svc:hun\\ter2@api.test:8443/v1",
      "svc:hunter2@api.test\\v1",
      "svc:hunter2@api.test/v1",
      "svc:hun\\ter2@api.test",
      "a\\b:hunter2@h.test/v1",
      "svc:hun\\ter2@api.test/x?q=1",
      "svc:hun\\ter2@api.test/x#f",
    ];
    let reported = 0;
    const lost: string[] = [];
    for (const scheme of schemes) {
      for (const mark of marks) {
        for (const body of bodies) {
          const url = `${scheme}:${mark}${body}`;
          const parsed = parseEither(url);
          if (parsed === null || parsed.password === "") continue;
          reported += 1;
          // The password in the CALLER's own spelling, which is the one a
          // message quotes and the one the parser rewrites.
          const at = url.indexOf("@");
          const raw = url.slice(url.lastIndexOf(":", at) + 1, at);
          if (redactUrl(url).includes(raw)) lost.push(`url: ${url}`);
          for (const quoted of [url, parsed.href]) {
            if (!quoted.includes(raw)) continue;
            if (redactUrlInMessage(`boom ${quoted} boom`, url).includes(raw)) {
              lost.push(`message: ${url}`);
            }
          }
        }
      }
    }
    // NON-VACUITY: the corpus really does contain urls the parser reads a
    // password out of, under both fold answers.
    expect(reported).toBeGreaterThan(70);
    expect(lost).toEqual([]);
  });
});

// ── 5. The fifth instrument: the grammar questions nobody counted ──────────

/**
 * One `redactUrl`, with seven numbers.
 *
 * SIX OF THEM THE AUDIT ALREADY HAS — round 16's rebuild and probe counts,
 * round 19's forward and backward walks, and round 20's copied characters and
 * parsed characters.
 *
 * THE SEVENTH IS THE FIFTH INSTRUMENT, and it counts a quantity none of the
 * six reads: the GRAMMAR QUESTIONS. Every `RegExp.prototype.test` is an
 * `isSchemeCharacter` or a `SCHEME_HEAD` question, every `Set.prototype.has` is
 * a scheme-list or dot-segment question, and every `String.prototype.charCodeAt`
 * is one character of `spellsToken` or `isStripped`. None of them moves an
 * `indexOf` distance, copies a character, or reaches a `URL` constructor —
 * `spellsToken` exists precisely because comparing in place copies nothing —
 * so a walk built out of them is invisible to all six.
 */
function measure(url: string) {
  const nativeUrl = globalThis.URL;
  const nativeSlice = String.prototype.slice;
  const nativeLower = String.prototype.toLowerCase;
  const nativeIndexOf = String.prototype.indexOf;
  const nativeLastIndexOf = String.prototype.lastIndexOf;
  const nativeTest = RegExp.prototype.test;
  const nativeHas = Set.prototype.has;
  const nativeCharCodeAt = String.prototype.charCodeAt;
  let rebuilds = 0;
  let probes = 0;
  let forward = 0;
  let backward = 0;
  let copied = 0;
  let parsedChars = 0;
  let grammar = 0;
  class Watched extends nativeUrl {
    constructor(argument: string | URL, base?: string | URL) {
      super(argument, base);
      parsedChars += String(argument).length;
      if (base !== undefined) return;
      if (String(argument).startsWith(ORIGIN)) rebuilds += 1;
      else probes += 1;
    }
  }
  String.prototype.slice = function (this: string, start?: number, end?: number) {
    const answer = nativeSlice.call(this, start, end);
    copied += answer.length;
    return answer;
  } as typeof String.prototype.slice;
  String.prototype.toLowerCase = function (this: string) {
    const answer = nativeLower.call(this);
    copied += answer.length;
    return answer;
  } as typeof String.prototype.toLowerCase;
  String.prototype.indexOf = function (this: string, search: string, position?: number) {
    const found = nativeIndexOf.call(this, search, position);
    const from = position === undefined ? 0 : Math.max(0, position);
    forward += (found < 0 ? this.length : found) - from;
    return found;
  } as typeof String.prototype.indexOf;
  String.prototype.lastIndexOf = function (this: string, search: string, position?: number) {
    const found = nativeLastIndexOf.call(this, search, position);
    const from = position === undefined ? this.length : Math.min(this.length, position);
    backward += Math.max(0, from - (found < 0 ? 0 : found));
    return found;
  } as typeof String.prototype.lastIndexOf;
  RegExp.prototype.test = function (this: RegExp, text: string) {
    grammar += 1;
    return nativeTest.call(this, text);
  } as typeof RegExp.prototype.test;
  Set.prototype.has = function (this: Set<unknown>, value: unknown) {
    grammar += 1;
    return nativeHas.call(this, value);
  } as typeof Set.prototype.has;
  String.prototype.charCodeAt = function (this: string, index: number) {
    grammar += 1;
    return nativeCharCodeAt.call(this, index);
  } as typeof String.prototype.charCodeAt;
  globalThis.URL = Watched as unknown as typeof URL;
  const started = performance.now();
  try {
    redactUrl(url);
  } finally {
    globalThis.URL = nativeUrl;
    String.prototype.slice = nativeSlice;
    String.prototype.toLowerCase = nativeLower;
    String.prototype.indexOf = nativeIndexOf;
    String.prototype.lastIndexOf = nativeLastIndexOf;
    RegExp.prototype.test = nativeTest;
    Set.prototype.has = nativeHas;
    String.prototype.charCodeAt = nativeCharCodeAt;
  }
  const elapsed = performance.now() - started;
  return {
    length: url.length,
    rebuilds,
    probes,
    forward,
    backward,
    copied,
    parsedChars,
    grammar,
    elapsed,
  };
}

/** Milliseconds per input character, the one number that sees every quantity. */
function perCharacter(row: { elapsed: number; length: number }): number {
  return row.elapsed / row.length;
}

describe("a fifth instrument, and the bound it reports", () => {
  const SHAPES: ReadonlyArray<readonly [string, (units: number) => string]> = [
    ["https:/@ per unit", (n) => `${ORIGIN}/x/${"https:/@".repeat(n)}v1`],
    ["https://@ per unit", (n) => `${ORIGIN}/x/${"https://@".repeat(n)}v1`],
    ["a: per unit", (n) => `${ORIGIN}/x/${"a:".repeat(n)}v1`],
    [": per unit", (n) => `${ORIGIN}/x/${":".repeat(n)}v1`],
    ["//@h.test:1 per unit", (n) => `${ORIGIN}/x/${"//@h.test:1".repeat(n)}v1`],
    ["@../ per unit", (n) => `${ORIGIN}/x/${"@../".repeat(n)}v1`],
    ["https:\\@ per unit", (n) => `${ORIGIN}/x/${"https:\\@".repeat(n)}v1`],
    ["file:/svc:pw@h/ per unit", (n) => `${ORIGIN}/x/${"file:/svc:pw@h/".repeat(n)}v1`],
  ];

  test("R21-H2 instrument 5: grammar questions stay linear in the input", () => {
    // NON-VACUITY: the instrument reads a number the others do not. The two
    // dot-segment shapes ask almost no grammar question at all while copying
    // one character per input character, so the seventh number is not a
    // restatement of the sixth.
    const smallest = measure(`${ORIGIN}/x/${"@../".repeat(500)}v1`);
    expect(smallest.grammar).toBeLessThan(smallest.copied / 100);

    // THE BOUND. Fourteen grammar questions per input character, on every
    // adversarial shape drawn, and the ratio does not climb with the size: an
    // eightfold sweep moves it by less than three questions per character,
    // where a super-linear reader would multiply the ratio by the sweep
    // factor of eight.
    const overBound: string[] = [];
    const climbing: string[] = [];
    for (const [name, make] of SHAPES) {
      const ratios = [125, 500, 1000].map((units) => {
        const row = measure(make(units));
        return row.grammar / row.length;
      });
      for (const ratio of ratios) if (ratio > 14) overBound.push(`${name}: ${ratio.toFixed(2)}`);
      if (ratios[2]! - ratios[0]! > 3) {
        climbing.push(`${name}: ${ratios[0]!.toFixed(2)} -> ${ratios[2]!.toFixed(2)}`);
      }
    }
    expect(overBound).toEqual([]);
    expect(climbing).toEqual([]);
  });

  test("R21-H2 instrument 5: wall time is the cross-check the flat reading needs", () => {
    // ANTI-PATTERN 13, applied to this instrument rather than to the last one.
    // An instrument that reports flat has to be checked against the resource
    // itself once, or it reports its own blind spot as an absence. Time per
    // character is a coarse number and it is the only one that sees EVERY
    // quantity, including the indexed comparisons in `pastSolidi`,
    // `beforeSolidi`, `authorityEnd` and `segmentUserinfos`, which no counter
    // in this file can reach.
    const climbing: string[] = [];
    for (const [name, make] of SHAPES) {
      const small = measure(make(250));
      const large = measure(make(1000));
      // Generous: a linear reader keeps the ratio inside one order of
      // magnitude across a fourfold sweep, and a quadratic one multiplies it
      // by four.
      if (perCharacter(large) > 10 * perCharacter(small) + 0.01) {
        climbing.push(
          `${name}: ${perCharacter(small).toFixed(5)} -> ${perCharacter(large).toFixed(5)}`,
        );
      }
    }
    expect(climbing).toEqual([]);
  });
});
