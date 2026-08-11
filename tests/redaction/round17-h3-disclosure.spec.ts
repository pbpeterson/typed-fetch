import { describe, expect, test } from "vitest";
import { NetworkError, NotFoundError } from "../../src/errors";
import { redactUrl, redactUrlInMessage } from "../../src/errors/redact-url";
import { userinfoSpans } from "../../src/errors/userinfo-spans";
import { everyChannel, leakingChannels } from "../../fixtures/channels";
import { responseWith } from "../../fixtures/responses";

/**
 * ROUND 17, LANE H3 — the conflict round 16 opened, and the instrument it left.
 *
 * Round 16 built an over-redaction judge, ran it over 96 rows, and recorded two
 * things that do not fit together. R16-H3-01: for
 * `https://api.test/proxy/https://cdn.test/img/alice@example.com/avatar.png`
 * the module emits `https://api.test/proxy/https://example.com/avatar.png`,
 * naming a host the request never contacted. And the same judge grades the
 * answer `redact-url.spec.ts` PINS for
 * `https://api.test/go/https://YWxpY2U/cGFzc3dvcmQ@internal.test/v1` as
 * `invented=internal.test dropped=ywxpy2u`. The ledger says a later round must
 * decide which of the two is wrong before it reads either one as evidence.
 *
 * This file decides it, and the decision is NOT "one of them is wrong". It is
 * that the judge's rule and the suite's requirement are the SAME predicate with
 * opposite signs, so no rule of the module's current shape can satisfy both:
 *
 *  - Section 3 shows the module's answer for `://A/B@C/D` is a function of the
 *    SHAPE alone. All 1,296 label substitutions answer `://C/D`. The two inputs
 *    above are two label substitutions of one shape, and the two required
 *    answers differ, so any separating rule must read the LABELS — which is the
 *    deny list `redact-url.ts`'s own header rejects. The rule is exhibited, and
 *    the input that turns it into a shield is exhibited beside it.
 *  - Section 3 also bounds what the judge can ever condemn. A credential the
 *    PARSER reports cannot contain a solidus — the solidus is what ends the
 *    authority it lives in — so removing one leaves the host where the parser
 *    read it. Of the 5,683 credential-population rows that report one, not one
 *    credential spells a solidus, and the judge is silent on all 144 rows of a
 *    well-formed family that carries one. Everything it condemns is a removal
 *    the module's HEURISTIC made, which is the class the conflict is about, all
 *    of it and nothing else.
 *
 * THE INSTRUMENT IS GRADED FIRST, because it has run once, over 96 rows, and
 * the ledger already cites it. Section 1 reproduces round 16's rule verbatim
 * and shows it answers about a SPELLING rather than about a url: `file:svc:`
 * and `file:///svc:` are one url — the first's `href` IS the second, and it is
 * also the module's whole answer for it — and the rule reads a host out of one
 * and not the other. That is R17-H3-03. Section 2 measures what it costs: over
 * the 40,000-url credential population round 16's rule returns 475 verdicts
 * where the calibrated one returns 154, and over the 57,344-url structured
 * population — every row of which the URL Standard reads, absolutely or as a
 * reference — the two agree exactly, 37,038 against 37,038. The whole
 * difference is text that is not a url, read by a rule that slices where no
 * parser opens an authority.
 *
 * WHAT IS NEW ABOUT THE MODULE, after the instrument is calibrated, is two
 * shapes RES-6 does not cover. R17-H3-01: an embedded authority with a PORT
 * loses its host even where the later `@` sits at a segment HEAD — the spelling
 * round 16's own corpus acquits and `looksLikeUserinfo` promises to keep.
 * R17-H3-02: the MESSAGE channel names a host the url channel does not, from a
 * needle harvested out of a slot `redactUrl` drops whole.
 *
 * NOT RE-REPORTED: RES-1 through RES-6 as such — RES-6 is re-pinned unmoved in
 * section 4 — `showHidden`, `console.dir` with `cause`, the accessor-pollution
 * guard shape, and round 16's pollution and header sweeps.
 *
 * A disclosure decision applies to the CHANNEL SET, so every sentinel here goes
 * through `everyChannel` in `fixtures/channels.ts`.
 */

/* -------------------------------------------------------------------------- */
/* 1. THE INSTRUMENT — round 16's judge, reproduced, and what it answers about */
/* -------------------------------------------------------------------------- */

/**
 * The judge's own base, copied from round 16 for the reason round 16 gives: a
 * relative reference resolved against any base with an empty path yields the
 * same `pathname`, so nothing here depends on which reserved host was picked.
 */
const JUDGE_BASE = "http://judge.invalid";

function parseAbsolute(text: string): URL | null {
  try {
    return new URL(text);
  } catch {
    return null;
  }
}

function parseRelative(text: string): URL | null {
  try {
    return new URL(text, JUDGE_BASE);
  } catch {
    return null;
  }
}

/** The two places the URL Standard can begin reading an authority. */
const SCHEME_TOKEN = /[a-zA-Z][a-zA-Z0-9+.-]*:/g;
const SOLIDUS_PAIR = /[/\\][/\\]/g;

/**
 * A solidus pair that a scheme in the SAME text has already consumed.
 *
 * `file:///v1` spells `//` at index 5, and those two solidi are the `file:`
 * scheme's own authority delimiter — the parser reads them, finds the empty
 * host, and hands `/v1` to the path state. Slicing there produces `///v1`,
 * which is a protocol-relative reference the parser reads as an authority all
 * over again. See {@link R17_H3_03}.
 */
const OWN_DELIMITER = /^[a-zA-Z][a-zA-Z0-9+.-]*:$/;

function matchIndexes(text: string, pattern: RegExp): number[] {
  const found: number[] = [];
  pattern.lastIndex = 0;
  for (let hit = pattern.exec(text); hit !== null; hit = pattern.exec(text)) {
    found.push(hit.index);
    if (found.length >= 16) break;
  }
  return found;
}

/**
 * Every host the PLATFORM reads out of `text`, at any authority it can find.
 *
 * `calibrated` selects between the rule round 16 wrote and the rule this file
 * grades with. The two differ in exactly two lines, and both differences are
 * the same correction: the judge must answer about a URL and not about one
 * spelling of it.
 *
 *  - The `href` is a VIEW. `new URL(text).href` is the same url as `text`, so a
 *    host the judge can read out of one it must read out of the other.
 *  - A solidus pair the text's own scheme consumed is NOT a slice. Nothing
 *    reads `file:///v1` as naming a host, and the judge must not either.
 *
 * Everything else — the four views, the two slice marks, the 16-match cap, the
 * base host dropped as the judge's own — is round 16's, character for
 * character, so the counts below can be compared with the counts it reported.
 */
function hostsIn(text: string, calibrated: boolean): Set<string> {
  const views = new Set<string>([text, text.replace(/[\t\r\n]/g, "")]);
  const absolute = parseAbsolute(text);
  if (absolute) {
    if (calibrated) views.add(absolute.href);
    views.add(absolute.pathname);
  }
  const relative = parseRelative(text);
  if (relative) {
    if (calibrated) views.add(relative.href);
    views.add(relative.pathname);
  }

  const slices = new Set<string>();
  for (const view of views) {
    slices.add(view);
    for (const at of matchIndexes(view, SCHEME_TOKEN)) slices.add(view.slice(at));
    for (const at of matchIndexes(view, SOLIDUS_PAIR)) {
      if (calibrated && OWN_DELIMITER.test(view.slice(0, at))) continue;
      slices.add(view.slice(at));
    }
  }

  const hosts = new Set<string>();
  for (const slice of slices) {
    const parsed = parseAbsolute(slice) ?? parseRelative(slice);
    if (parsed && parsed.host !== "" && parsed.host !== "judge.invalid") hosts.add(parsed.host);
  }
  return hosts;
}

/** Round 16's rule, unchanged. */
function round16Hosts(text: string): Set<string> {
  return hostsIn(text, false);
}

/** The same rule, asked about the url rather than about its spelling. */
function hostsNamedBy(text: string): Set<string> {
  return hostsIn(text, true);
}

/**
 * Every credential the platform reports anywhere in `text`, read out of the
 * same slices the host half reads. The two halves must read one text, or "the
 * output named a host the input did not" could be an artefact of two readings.
 */
function credentialsNamedBy(text: string): string[] {
  const found = new Set<string>();
  const views = new Set<string>([text, text.replace(/[\t\r\n]/g, "")]);
  const absolute = parseAbsolute(text);
  if (absolute) views.add(absolute.pathname);
  const relative = parseRelative(text);
  if (relative) views.add(relative.pathname);
  for (const view of views) {
    const slices = new Set<string>([view]);
    for (const at of matchIndexes(view, SCHEME_TOKEN)) slices.add(view.slice(at));
    for (const at of matchIndexes(view, SOLIDUS_PAIR)) slices.add(view.slice(at));
    for (const slice of slices) {
      const parsed = parseAbsolute(slice) ?? parseRelative(slice);
      if (!parsed) continue;
      for (const value of [parsed.username, parsed.password]) if (value) found.add(value);
    }
  }
  return [...found];
}

/** One graded row. Reported as a measurement, never as a diff. */
interface Verdict {
  input: string;
  output: string;
  invented: string[];
  dropped: string[];
}

/**
 * OVER/host — the emitted url must name no host the input did not name.
 *
 * The `output === input` return is not a narrowing of the rule: an answer that
 * is its own input names the same hosts, so the verdict cannot differ. It is
 * here because the sweeps below run it 555,000 times.
 */
function judgeWith(reader: (text: string) => Set<string>, input: string): Verdict | null {
  const output = redactUrl(input);
  if (output === input) return null;
  const before = reader(input);
  const after = reader(output);
  const invented = [...after].filter((host) => !before.has(host));
  if (invented.length === 0) return null;
  return { input, output, invented, dropped: [...before].filter((host) => !after.has(host)) };
}

/** The judge this file grades with. */
function judgeHosts(input: string): Verdict | null {
  return judgeWith(hostsNamedBy, input);
}

/** A readable rendering, in round 16's own format so the two can be compared. */
function line(verdict: Verdict): string {
  return `in=${verdict.input} out=${verdict.output} invented=${verdict.invented.join(",")} dropped=${verdict.dropped.join(",")}`;
}

/**
 * R17-H3-03 — the judge answers about a SPELLING, not about a url.
 *
 * `new URL("file:svc:").href` is `file:///svc:`. The two strings are one url:
 * the parser produced the second from the first, and every question a reader
 * can ask has one answer for both. Round 16's rule answers `{}` for the input
 * and `{svc}` for the href, because the href spells the two solidi that the
 * shorter form left to the parser, and the rule slices at every solidus pair —
 * including the one `file:` itself consumed. `///svc:` under a special base is
 * protocol-relative, so the judge's own base hands it back a host.
 *
 * The module changed nothing here. `redactUrl("file:svc:")` is exactly
 * `new URL("file:svc:").href`, so the ANSWER IS THE INPUT, re-serialized — and
 * the judge reports it as a url that named a host the input did not name.
 *
 * WHAT IT COSTS is not a wrong count. It is that the instrument's verdicts
 * cannot be read at all without knowing which of them are this: the sweep in
 * section 2 measures 2,633 of 3,409 over the 400,000-url corpus, and the ledger
 * already cites this instrument as the evidence that the corpus rule and the
 * suite pin disagree.
 */
const R17_H3_03 = "file:svc:";

describe("R17-H3-03 — the over-redaction judge grades a spelling", () => {
  test("round 16's rule answered differently for one url, which is the defect", () => {
    const href = new URL(R17_H3_03).href;
    // The premise, from the platform: these are one url, and the module's
    // answer for the first IS the second.
    expect(href).toBe("file:///svc:");
    expect(redactUrl(R17_H3_03)).toBe(href);

    // `round16Hosts` is a LOCAL SPECIMEN of the rule round 16 committed, kept
    // so the defect stays readable. Asked one question twice, it answers twice
    // differently: it slices at the solidus pair that `file:` already consumed
    // and reads `svc` out of the first path segment, so it condemned
    // `redactUrl("file:svc:")`, whose answer is the input's own href.
    //
    // The assertion is `not`, because a specimen of a defect that passed would
    // not be a specimen. The COMMITTED judge in
    // `round16-h3-disclosure.spec.ts` no longer does this: the orchestrator
    // closed R17-H3-03 there by skipping a solidus pair a scheme token in the
    // same text already consumed, and RES-6's pin held across the change.
    expect([...round16Hosts(R17_H3_03)]).not.toEqual([...round16Hosts(href)]);
  });

  test("the calibrated reader answers the same for both, and still condemns RES-6", () => {
    expect([...hostsNamedBy(R17_H3_03)]).toEqual([...hostsNamedBy(new URL(R17_H3_03).href)]);
    expect(judgeHosts(R17_H3_03)).toBeNull();

    // And the correction is not a way of making the judge quiet: the row round
    // 16 pinned is graded exactly as round 16 graded it.
    expect(line(judgeHosts(RES6_URL)!)).toBe(
      "in=https://api.test/proxy/https://cdn.test/img/alice@example.com/avatar.png" +
        " out=https://api.test/proxy/https://example.com/avatar.png" +
        " invented=example.com dropped=cdn.test",
    );
  });

  test("the acquittals round 16 wrote down stay acquittals", () => {
    // Removing a credential is not naming a host; an opaque url reduced to its
    // scheme names none; a path with nothing to remove is untouched.
    expect(judgeHosts("https://api.test/go/https://svc:hunter2@internal.test/v1")).toBeNull();
    expect(judgeHosts("blob:https://api.test/550e8400-e29b")).toBeNull();
    expect(judgeHosts("data:text/plain,//alice:hunter2@internal.test/v1")).toBeNull();
    expect(judgeHosts("https://api.test/v1/things")).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* 2. THE POPULATIONS THE MODULE IS ACTUALLY MEASURED AGAINST                 */
/* -------------------------------------------------------------------------- */

/**
 * The token generator of `redaction-normalisation-enumeration.spec.ts`,
 * reproduced rather than imported.
 *
 * Importing a spec file runs its `describe` blocks inside this module's graph,
 * so its three thousand tests would be declared twice and one file's failure
 * would be reported against the other. The seed and the alphabet are copied
 * exactly, so the corpus this file sweeps is the corpus that file sweeps.
 */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}

const PASSWORD = "ZQ7XKPWV";

const TOKENS = [
  "/",
  "//",
  "///",
  "\\",
  "\\\\",
  ":",
  "://",
  ":/",
  "@",
  "svc:",
  "@bob",
  `svc:${PASSWORD}@`,
  "http:",
  "https:",
  "ws:",
  "wss:",
  "ftp:",
  "file:",
  "git:",
  "zz:",
  "HTTPS:",
  "FiLe:",
  ".",
  "..",
  "%2e",
  "%2E%2E",
  "%2f",
  "%3A",
  "%40",
  "%5C",
  "|",
  "c|",
  "a",
  "b",
  "x",
  "h.test",
  "internal.test",
  "localhost",
  "127.0.0.1",
  "[::1]",
  ":8443",
  ":443",
  ":0",
  "?",
  "#",
  "?q=",
  "#f",
  "\t",
  "\n",
  "\r",
  "\0",
  " ",
  "\v",
  "\f",
  "%2e%2e",
  "é",
  "／",
  "：",
];

/** The random population: concatenated tokens, no credential planted. */
function randomUrls(seed: number, count: number): string[] {
  const random = seeded(seed);
  const out: string[] = [];
  for (let made = 0; made < count; made += 1) {
    const pieces = 2 + Math.floor(random() * 14);
    let url = "";
    for (let piece = 0; piece < pieces; piece += 1) {
      url += TOKENS[Math.floor(random() * TOKENS.length)]!;
    }
    out.push(url);
  }
  return out;
}

/** The credential population: the same generator with one credential spliced in. */
function credentialUrls(seed: number, count: number): string[] {
  const random = seeded(seed);
  const out: string[] = [];
  for (let made = 0; made < count; made += 1) {
    const pieces = 2 + Math.floor(random() * 10);
    const at = Math.floor(random() * (pieces + 1));
    let url = "";
    for (let piece = 0; piece < pieces; piece += 1) {
      if (piece === at) url += `svc:${PASSWORD}@`;
      url += TOKENS[Math.floor(random() * TOKENS.length)]!;
    }
    if (at === pieces) url += `svc:${PASSWORD}@internal.test/v1`;
    out.push(url);
  }
  return out;
}

/**
 * The STRUCTURED population, drawn here because the 119,070 urls round 16's F3
 * measured against are not in the tree — that sweep was a fix lane's scratch
 * and nothing committed reproduces it.
 *
 * This one is the cross product the host question needs, and it is well formed
 * by construction: an outer url, a segment, an authority mark under every
 * spelling the module opens a region on, an optional credential, an embedded
 * authority with and without a port, a target path that carries an `@` in every
 * position a path can carry one, and a query or fragment behind it.
 */
const OUTER = ["https://api.test", "http://api.test:8443", "https://api.test/v1", ""] as const;
const MIDDLE = ["/proxy/", "/go/", "/a/b/", "//"] as const;
const OPENER = [
  "https://",
  "http://",
  "//",
  "ftp://",
  "https:/",
  "https:",
  "HTTPS://",
  "wss://",
] as const;
const CREDENTIAL = ["", "svc:hunter2@"] as const;
const AUTHORITY = [
  "cdn.test",
  "cdn.test:8443",
  "127.0.0.1",
  "[::1]",
  "xn--n3h.test",
  "localhost",
  "cdn.test:0",
  "YWxpY2U",
] as const;
const TAIL = [
  "/img/alice@example.com/avatar.png",
  "/u/bob@example.com",
  "/mail/alice@example.com",
  "/a/b@c/d",
  "/img/@alice",
  "/users/@alice/photo",
  "/v1/things",
  "/",
  "",
  "/x/y@z",
  "/@alice",
  "/a/./b@c",
  "/a/../b@c",
  "/deep/a/b/c@d/e",
] as const;
const SUFFIX = ["", "?q=a@b"] as const;

function structuredUrls(): string[] {
  const seen = new Set<string>();
  for (const outer of OUTER) {
    for (const middle of MIDDLE) {
      for (const opener of OPENER) {
        for (const credential of CREDENTIAL) {
          for (const authority of AUTHORITY) {
            for (const tail of TAIL) {
              for (const suffix of SUFFIX) {
                seen.add(`${outer}${middle}${opener}${credential}${authority}${tail}${suffix}`);
              }
            }
          }
        }
      }
    }
  }
  return [...seen];
}

/** One population's measurement. Counts, never rows. */
interface Sweep {
  size: number;
  round16: number;
  calibrated: number;
  dropped: number;
  created: number;
}

/**
 * `both` reads every changed row twice, once under each rule, which is what it
 * takes to say how much of round 16's instrument is signal. It costs a second
 * pass of up to 128 `new URL` calls per row, so the 400,000-url population runs
 * with the calibrated rule alone and the two rules are compared on the two
 * populations where the difference is cheap enough to measure exactly.
 */
function sweep(urls: readonly string[], both: boolean): Sweep {
  const measured: Sweep = { size: urls.length, round16: 0, calibrated: 0, dropped: 0, created: 0 };
  for (const url of urls) {
    const output = redactUrl(url);
    if (output === url) continue;
    if (both) {
      const raw = round16Hosts(url);
      if ([...round16Hosts(output)].some((host) => !raw.has(host))) measured.round16 += 1;
    }
    const before = hostsNamedBy(url);
    const after = hostsNamedBy(output);
    if (![...after].some((host) => !before.has(host))) continue;
    measured.calibrated += 1;
    if ([...before].some((host) => !after.has(host))) measured.dropped += 1;
    else measured.created += 1;
  }
  return measured;
}

/**
 * Measured solo: 3.8 s for the structured population under both rules, 3.6 s
 * for the credential one, 21 s for the 400,000 random urls under one, and 53 s
 * for the whole file inside a `pnpm coverage` run. The budgets state that
 * rather than hiding the cost behind a smaller draw — the population IS the
 * measurement, and these three counts are the whole of what this lane can say
 * about how much of the instrument round 16 built is signal.
 *
 * THE STRUCTURED POPULATION IS WHERE THE TWO RULES AGREE, and that is the
 * sharpest thing the comparison says. Every one of its urls is one a parser
 * reads, and on every one of them the calibration moves no verdict. The entire
 * difference between 461 and 148 on the credential population is text no parser
 * reads as a url, read by a rule that slices where no parser opens an authority.
 *
 * ROUND 19 MOVED TWO OF THE THREE COUNTS, and R19-H2-02 is what moved them. A
 * region whose opening mark no scheme wrote is the URL Standard's own
 * protocol-relative authority, so it now buys the parser's reading of the
 * authority at its start exactly as a scheme-marked region does. RES-7 — the
 * bare-`//` gap round 18 recorded and refused to close — closes as a
 * by-product.
 *
 * ROUND 20 MOVED ALL THREE, and the paragraph above no longer holds: the
 * credential population moves too, and every one of its four counts FALLS. Two
 * fixes reach these sweeps. R20-H2-01 ends a region at the next colon mark
 * under ANY solidus count instead of at the three literal characters `://`, so
 * a one-solidus embedded url now bounds the region in front of it. R20-H3-01,
 * R20-H3-02 and R20-H3-03 teach the head and the seam the caller's own
 * spelling, which is what takes a `file:` credential out of the emitted url.
 * The counts below are re-measured on this tree, and each test says which fix
 * moved it and in which direction.
 */
describe("the judge over the populations the module is measured against", () => {
  test("the structured population, under both rules", { timeout: 120_000 }, () => {
    // MOVED BY R19-H2-02, and every row of that move was more correct. 558
    // fewer rows dropped a host the input named. 738 answers changed; the
    // sample is `https://api.test/proxy///cdn.test:8443/img/@alice`, which used
    // to emit `https://api.test/proxy///alice` and is a fixed point now.
    //
    // MOVED AGAIN BY R20-H2-01, and this move is +144 on all three condemned
    // counts. 1,392 answers changed and exactly 144 rows changed verdict, all
    // of them acquitted to `dropped`, all of them the ONE-SOLIDUS spelling of
    // the opener. The sample is
    // `https://api.test//https:/svc:hunter2@cdn.test/img/@alice`. A region used
    // to END at the three literal characters `://`, which the one-solidus
    // spelling never writes, so the outer bare-`//` region ran to the end of
    // the text and stopped at the credential's own `@`; it now ends at the
    // embedded mark, the inner region runs to `@alice`, and the answer is
    // `https://api.test//https:/alice`.
    //
    // THAT ANSWER IS THE ONE THE OTHER SEVEN SPELLINGS OF THE SAME OPENER
    // ALREADY GAVE. `https://`, `http://`, `//`, `ftp://`, `https:`, `HTTPS://`
    // and `wss://` each emit `<mark>alice` for this row and always did; the
    // one-solidus spelling was the single opener that answered differently, and
    // one reference answering two ways is the defect R19-H2-02 closed for the
    // bare pair. So the +144 is a spelling joining its own family, and it is
    // over-redaction, which is this module's safe direction.
    //
    // `created` IS STILL ZERO, which is the claim this test exists for: not one
    // row of a population every parser reads names a host its input did not.
    // The two rules also still agree on every row.
    expect(sweep(structuredUrls(), true)).toEqual({
      size: 57_344,
      round16: 36_624,
      calibrated: 36_624,
      dropped: 36_624,
      created: 0,
    });
  });

  test("the credential population, under both rules", { timeout: 120_000 }, () => {
    // MOVED BY ROUND 20, and it is the first round to move this population at
    // all. EVERY COUNT FALLS — 475 to 461, 154 to 148, 30 to 29, 124 to 119 —
    // so there is no axis on which the round bought a verdict with another one.
    //
    // 343 answers changed. 53 rows changed verdict, and the two that carry the
    // calibrated fall are `created` to acquitted, 6 rows, and `dropped` to
    // acquitted, 1 row; one row moves the other way, acquitted to `created`.
    // Almost every changed row is a `file:` url whose planted credential now
    // leaves the emitted record: R20-H3-03 taught the seam to fall back to the
    // path's last `@` where the first segment holds a colon no Windows drive
    // letter wrote, so `file:b%5C:/%5Cbsvc:svc:ZQ7XKPWV@internal.test/v1` emits
    // `file:///internal.test/v1` where it used to emit the credential whole.
    //
    // AND THAT IS THE HALF THE HOST JUDGE CANNOT SEE, so it is counted here as
    // well: 11,312 rows of this population used to emit the planted password
    // and 11,221 do now. A future round that widens a region must not buy a
    // host verdict with one of those secrets — see the `removed` count in
    // R17-H3-01 below, which pins the same quantity from the other side.
    //
    // MOVED BY R23-H3-01, and ONLY the round16 count moves: 461 to 456. The
    // calibrated rule's three counts are byte-identical, which is the sharpest
    // thing this move says — the five rows that leave were condemned by the
    // rule that reads a SPELLING, and the rule that reads a url never held them
    // against the module at all.
    //
    // `seamUserinfo` now forwards the SPILL to `seamSpan`, so a `\` the caller
    // wrote inside its own authority opens the seam even where the parser found
    // a host. All five rows are that one shape: `FiLe:localhost\\svc:…@`
    // `internal.test/v1` emitted `file:///localhost//internal.test/v1` and now
    // emits `file:///internal.test/v1`. The old answer spelled `localhost`
    // behind a solidus pair, which is exactly where round 16's rule slices and
    // reads a host; the text is gone now, so the invented host is too. 35
    // answers changed in all, and no row joined the condemned set under either
    // rule.
    //
    // AND NINE MORE SECRETS LEAVE WITH THEM. 11,230 rows emitted the planted
    // password before this fix; 11,221 do. So the five acquittals are not a
    // verdict bought with a disclosure — the disclosure count fell in the same
    // move, and R17-H3-01 below pins that same nine as `removed` rising.
    expect(sweep(credentialUrls(0xdeadbeef, 40_000), true)).toEqual({
      size: 40_000,
      round16: 456,
      calibrated: 148,
      dropped: 29,
      created: 119,
    });
  });

  test("the 400,000 random urls", { timeout: 120_000 }, () => {
    // MOVED BY R19-H2-02, and this is the one population where the move is not
    // uniformly an improvement. Eight rows change verdict: seven stop dropping
    // a host the input named and are no longer condemned at all, and ONE moves
    // from acquitted to `created`. That one row is
    // `127.0.0.1x\\%40\%2e：@bob%2e%2e://\t@bob`. It used to emit
    // `/127.0.0.1x//bob` and now emits `/127.0.0.1x//bob%2e%2e://bob`, so the
    // judge reads the host `bob..` out of the answer. The text is the input's
    // own — `bob%2e%2e` sits in front of the input's `@` — and keeping it is
    // the same decision that keeps `cdn.test:8443`; the judge condemns it
    // because the input never spelled that text where a parser reads a host.
    // It is stated here rather than averaged away: a later round that widens
    // this rule must know the widening already costs one row on this corpus.
    // That row is unmoved by round 20 and still emits
    // `/127.0.0.1x//bob%2e%2e://bob`.
    //
    // MOVED BY R20-H2-01, and this is the one count in the file that does not
    // fall on every axis. `dropped` falls by 7 and `created` rises by 6, for a
    // net of one fewer condemned row. 2,264 answers changed and 89 rows changed
    // verdict: 45 are no longer condemned at all (32 `created`, 13 `dropped`)
    // and 44 are newly condemned (38 `created`, 6 `dropped`).
    //
    // WHAT THE 44 HAVE IN COMMON, read off them rather than assumed: on every
    // one of them the invented host is the NAME OF A SCHEME the input itself
    // spelled — `https` 15 times, `ftp` 11, `http` 6, `ws` 6, `wss` 5, `.ws`
    // once, and nothing else. The shape is one narrowing: a region used to run
    // to the end of the text and swallow the trailing scheme token, and it now
    // ends at the mark that token opens, so the token survives — `|<TAB>file:
    // .://<CR>ftp:@` emitted `/|file:.://` and now emits `/|file:.://ftp:`. The
    // judge then slices at that token and reads a host out of it.
    //
    // SO THE SIX ARE THE SAME DECISION AS THE ONE ROW ABOVE: text the input
    // spelled, kept where the previous answer deleted it, condemned because the
    // input never spelled that text where a parser reads a host. Keeping it is
    // the decision that keeps `cdn.test:8443`. The seven rows on the other side
    // stop dropping a host the input DID name, which is the harm this judge
    // exists to find, so the net move is toward the safer half.
    //
    // MOVED BY R23-H3-01, and this is the smallest move any round has made
    // here: 195 answers change and TWO verdicts do. `created` falls by two —
    // three rows leave it and one joins — and `dropped` does not move at all,
    // neither leaving nor joining. That split is the claim. `dropped` is the
    // axis this judge exists to protect, because a dropped host is a host the
    // input really named; the seam forwarding its spill buys nothing on it and
    // pays nothing to it.
    //
    // THE THREE THAT LEAVE ARE THE SPILL REMOVING MORE, and the invented host
    // goes out with the text that spelled it:
    // `ftp:x\\／//:/:zz:<TAB><LF>@bob` emitted `ftp://x/%EF%BC%8F//bob`, out of
    // which the judge read the host `bob`, and now emits `ftp://x/bob`, where
    // there is no solidus pair left to slice at. THE ONE THAT JOINS is the
    // mirror of that and is stated rather than averaged away:
    // `https:@bob@bob:0\\\ \@bob..http:\` emitted
    // `https://bob:0///%20/@bob..http:/` and now emits
    // `https://bob:0///bob..http:/`, so removing the `@` in front of
    // `bob..http:` leaves that text behind a solidus pair and the judge reads
    // the host `bob..http` out of it. It is the same decision as the row named
    // above — text the input spelled, condemned because the input never spelled
    // it where a parser reads a host.
    expect(sweep(randomUrls(0xc0ffee, 400_000), false)).toEqual({
      size: 400_000,
      round16: 0,
      calibrated: 666,
      dropped: 125,
      created: 541,
    });
  });
});

/* -------------------------------------------------------------------------- */
/* 3. THE CONFLICT, DECIDED                                                   */
/* -------------------------------------------------------------------------- */

/** The url `redact-url.spec.ts` pins, and the answer it pins for it. */
const PINNED_URL = "https://api.test/go/https://YWxpY2U/cGFzc3dvcmQ@internal.test/v1";
const PINNED_ANSWER = "https://api.test/go/https://internal.test/v1";

/** The url `SECURITY.md` quotes for RES-6. */
const RES6_URL = "https://api.test/proxy/https://cdn.test/img/alice@example.com/avatar.png";
const RES6_ANSWER = "https://api.test/proxy/https://example.com/avatar.png";

/**
 * ONE STRING THAT IS BOTH. `cdn.test/img/alice` is RES-6's own embedded host and
 * its own two path segments, and it is also a credential — a token that spells a
 * dot and a solidus, which is what the base64 residual is made of.
 */
const ONE_STRING = "https://api.test/go/https://cdn.test/img/alice@internal.test/v1";

/**
 * THE ONLY SEPARATING PREDICATE READS THE LABELS, and it is a deny list.
 *
 * `redact-url.ts`'s header rejects that class in one sentence — "the dangerous
 * key is the one this library has never heard of" — and the reason shows here
 * in one line: the label is text the caller, or a redirecting server, writes. A
 * rule that keeps a region whose first label "looks like a host" is a rule
 * whose terminator the attacker spells, which is the defect rounds 9 and 12
 * each measured under a different mark.
 */
function looksLikeARealHost(label: string): boolean {
  return label.includes(".");
}

describe("the conflict: the judge and the suite are one predicate with two signs", () => {
  test("the judge condemns the answer the suite pins, in RES-6's own words", () => {
    expect(redactUrl(PINNED_URL)).toBe(PINNED_ANSWER);
    // The ledger's sentence, reproduced under the calibrated reader so it
    // cannot be dismissed as the instrument's spelling defect.
    expect(line(judgeHosts(PINNED_URL)!)).toBe(
      `in=${PINNED_URL} out=${PINNED_ANSWER} invented=internal.test dropped=ywxpy2u`,
    );
    // And the reason is the platform's, not the judge's: the parser reads
    // `YWxpY2U` as the embedded host and reports NO credential at all.
    const embedded = new URL("https://YWxpY2U/cGFzc3dvcmQ@internal.test/v1");
    expect([embedded.host, embedded.username, embedded.password]).toEqual(["ywxpy2u", "", ""]);
  });

  test("one string carries both requirements at once", () => {
    // Its embedded authority is RES-6's host, so RES-6 says it must survive.
    expect(new URL("https://cdn.test/img/alice@internal.test/v1").host).toBe("cdn.test");
    // Its shape is the pinned url's, so the suite says the text before the `@`
    // is a credential and must go. The module obeys the suite.
    expect(redactUrl(ONE_STRING)).toBe(PINNED_ANSWER);
    expect(line(judgeHosts(ONE_STRING)!)).toBe(
      `in=${ONE_STRING} out=${PINNED_ANSWER} invented=internal.test dropped=cdn.test`,
    );
  });

  /**
   * THE PROOF. A rule of this module's shape is a predicate over the scanned
   * text and the parser's answers about it. Both inputs above are members of
   * one family — mark, label, solidus, label, `@`, label, solidus, label — and
   * the module answers every member of that family the same way. So the answer
   * does not depend on the labels, and the two REQUIRED answers differ only in
   * the labels. No predicate that does not read the labels can separate them.
   */
  const LABELS = [
    "cdn.test",
    "YWxpY2U",
    "localhost",
    "xn--n3h.test",
    "a1b2c3",
    "internal.test",
  ] as const;

  test("the module's answer is a function of the SHAPE, over all 1,296 renamings", () => {
    const wrong: string[] = [];
    let drawn = 0;
    for (const first of LABELS) {
      for (const second of LABELS) {
        for (const third of LABELS) {
          for (const fourth of LABELS) {
            const url = `https://api.test/go/https://${first}/${second}@${third}/${fourth}`;
            drawn += 1;
            const expected = `https://api.test/go/https://${third}/${fourth}`;
            if (redactUrl(url) !== expected) wrong.push(`${url} -> ${redactUrl(url)}`);
          }
        }
      }
    }
    expect({ drawn, wrong }).toEqual({ drawn: 1296, wrong: [] });
  });

  /**
   * AND THE CLASS THE JUDGE CAN CONDEMN IS EXACTLY THE HEURISTIC'S.
   *
   * A credential the parser reports cannot contain a solidus: the solidus is
   * what ENDS the authority the credential lives in, so a userinfo that spells
   * one is not a userinfo. Removing such a credential therefore leaves the host
   * exactly where the parser read it, and the judge has nothing to see.
   *
   * The measurement below is the whole corpus rather than the clean half, so
   * the four condemned rows are here rather than filtered out of sight. In each
   * of them the moved host comes from a SECOND span elsewhere in the same text
   * — `|b//svc:ZQ7XKPWV@/127.0.0.1#…ws:svc:ZQ7XKPWV@internal.test/v1` loses both
   * credentials AND drops `internal.test` behind a region that crosses a
   * solidus — never from the parser-reported credential itself. The family
   * below is that half stated cleanly: a well-formed embedded credential, at
   * every label, and the judge is silent on all of it.
   */
  test("no credential the PARSER reports can move a host", () => {
    let reported = 0;
    let withSolidus = 0;
    let condemned = 0;
    for (const url of credentialUrls(0xdeadbeef, 40_000)) {
      const credentials = credentialsNamedBy(url);
      if (credentials.length === 0) continue;
      reported += 1;
      if (credentials.some((value) => value.includes("/"))) withSolidus += 1;
      if (judgeHosts(url) !== null) condemned += 1;
    }
    expect({ reported, withSolidus, condemned }).toEqual({
      reported: 5683,
      withSolidus: 0,
      condemned: 4,
    });

    const condemnedFamily: string[] = [];
    let family = 0;
    for (const user of LABELS) {
      for (const host of LABELS) {
        // No `@` in the tail: a later `@` opens the swallow this whole section
        // is about, and the question here is the credential's own removal.
        for (const tail of ["/v1", "/img/avatar.png", "/a/b/c", "/"]) {
          const url = `https://api.test/go/https://${user}:hunter2@${host}${tail}`;
          family += 1;
          expect(new URL(`https://${user}:hunter2@${host}${tail}`).password).toBe("hunter2");
          if (judgeHosts(url) !== null) condemnedFamily.push(url);
        }
      }
    }
    expect({ family, condemnedFamily }).toEqual({ family: 144, condemnedFamily: [] });
  });

  test("the dot rule separates the two, and one character hands it back", () => {
    // It does separate them, which is why it is worth writing down.
    expect(looksLikeARealHost("cdn.test")).toBe(true);
    expect(looksLikeARealHost("YWxpY2U")).toBe(false);

    // And every credential shields itself by spelling one dot before its first
    // solidus. Standard base64 has no `.` in its alphabet; an API key does.
    const shielded: string[] = [];
    for (const token of ["YWxpY2U", "dG9rZW4", "a1b2c3d4", "sk-live-9f2b", "AKIAIOSFODNN7"]) {
      const dotted = `${token.slice(0, 2)}.${token.slice(2)}`;
      if (looksLikeARealHost(dotted) && !looksLikeARealHost(token)) shielded.push(dotted);
    }
    expect(shielded.length).toBe(5);

    // The shielded spelling is the same grammar, token for token, as the one
    // the suite requires this library to strip.
    expect(redactUrl("https://api.test/go/https://sk.live/9f2b@internal.test/v1")).toBe(
      PINNED_ANSWER,
    );
  });
});

/* -------------------------------------------------------------------------- */
/* 4. THE SHAPES                                                              */
/* -------------------------------------------------------------------------- */

/**
 * SHAPE 1 — RES-6, unmoved.
 *
 * The region opens at the embedded mark, `parsesAsAuthority` believes the
 * authority at its start, and the span crosses the solidus that authority ended
 * at because the region's LAST `@` sits inside a later segment: the third rule
 * of `looksLikeUserinfo` reads "the `@` does not follow a `/`" and answers yes.
 *
 * Nothing in this file moves that pin, and section 3 says why it cannot be
 * moved by a rule of this module's shape.
 */
describe("shape 1 — RES-6, re-pinned in both directions", () => {
  test("the documented row emits exactly what SECURITY.md quotes", () => {
    expect(redactUrl(RES6_URL)).toBe(RES6_ANSWER);
  });

  test("and the answer still reaches every channel with the same hosts", async () => {
    const error = new NotFoundError(responseWith(RES6_URL));
    const rendered = everyChannel(error);

    expect(error.toJSON().url).toBe(RES6_ANSWER);
    expect(leakingChannels(rendered, ["cdn.test"])).toEqual([]);

    await error.cancel();
  });
});

/**
 * SHAPE 2 — R17-H3-01. THE SAME SWALLOW, THROUGH THE COLON RULE.
 *
 * `looksLikeUserinfo` has three rules, and RES-6 is the third one's. The SECOND
 * one — "a `:` before the first `/`" — reaches the same swallow through a
 * different door, and it reaches it on inputs RES-6's own corpus ACQUITS.
 *
 * `https://api.test/go/https://cdn.test:8443/users/@alice` is a forward to a
 * host on a non-default port, and `/users/@alice` is the `@`-at-segment-head
 * spelling `looksLikeUserinfo` promises to keep: "So `://api.test/users/@alice`
 * keeps every segment it names." The port supplies a colon before the region's
 * first solidus, the second rule fires before the third is ever consulted, and
 * the span runs to the `@` of the HANDLE. The emitted url is
 * `https://api.test/go/https://alice` — a forward to the host `alice`, which the
 * request never contacted and which is a user's handle rather than a host at
 * all. `cdn.test:8443`, the authority it did name, is gone.
 *
 * An IPv6 literal supplies the same colon (`https://[::1]/users/@alice`), and so
 * does an embedded scheme colon inside a region a bare `//` opened
 * (`https://api.test//https:/cdn.test/img/@alice`). The first two were fixed in
 * round 17 and the third in round 19, under R19-H2-02; the pins below carry
 * each answer.
 *
 * WHY THIS IS NOT RES-6 RESTATED. RES-6's bullet quotes the third rule's
 * mechanism and the third rule's example, and round 16's corpus pins 64 rows of
 * 96 — the 32 it acquits are exactly the two `@`-at-head tails. Those 32 rows
 * become 32 more the moment the embedded authority carries a port, so the
 * residual as written understates its own extent. `looksLikeUserinfo` does
 * record the port ambiguity, and it bounds it with the sentence round 16 found
 * false for the third rule: "It costs a diagnostic on a URL that was already
 * malformed." Both halves are false here too. The url is well formed at every
 * level, and the cost is a record that names the wrong host.
 *
 * AND IT IS SEPARABLE, which RES-6 is not. The predicate is already in the
 * module: `parsesAsAuthority` answers "is the text from the region's start to
 * its first solidus an authority a special-scheme parse would produce", and
 * that is the same question as "is this colon a PORT delimiter". Where it
 * answers yes, the colon rule is reading a port as a password and must not
 * fire; the third rule is untouched, so RES-6 stays exactly where it is. What
 * the change can cost is measured below and it is nothing: the only span it can
 * lose is one whose every `@` follows a solidus, which is the under-redaction
 * residual `looksLikeUserinfo` already records as open.
 */
const PORT_URL = "https://api.test/go/https://cdn.test:8443/users/@alice";

describe("R17-H3-01 — an embedded authority with a port loses its host to a handle", () => {
  test("the `@` at a segment head keeps every segment it names, port or no port", () => {
    // The control, which holds: with no port the handle is a path.
    expect(redactUrl("https://api.test/go/https://cdn.test/users/@alice")).toBe(
      "https://api.test/go/https://cdn.test/users/@alice",
    );
    // The same url with a port. Nothing here is a credential: the platform
    // reads the embedded authority whole and reports none.
    const embedded = new URL("https://cdn.test:8443/users/@alice");
    expect([embedded.host, embedded.username, embedded.password]).toEqual([
      "cdn.test:8443",
      "",
      "",
    ]);
    expect(redactUrl(PORT_URL)).toBe(PORT_URL);
  });

  test("the record keeps the authority, on every channel that carries it", async () => {
    const error = new NotFoundError(responseWith(PORT_URL));
    const rendered = everyChannel(error);

    // FIXED IN ROUND 17. This test measured the defect's REACH: it asserted
    // that the dropped authority reached no channel and that the handle
    // reached many. Both halves are now inverted, because F3 suppressed the
    // colon rule where the parser reads the region's pre-solidus text as
    // host:port.
    //
    // What the test is FOR does not change, and it is the reason to keep it:
    // whatever the record says, the channel set says once. A fix that returned
    // the authority to `toJSON().url` and left one rendering behind would fail
    // here, and that is the failure this file exists to catch.
    expect(error.toJSON().url).toBe(redactUrl(PORT_URL));
    expect(leakingChannels(rendered, ["cdn.test:8443"]).length).toBeGreaterThan(0);
    expect(leakingChannels(rendered, ["//alice"])).toEqual([]);

    await error.cancel();
  });

  test("all three spellings are fixed points now, and the third closed in round 19", () => {
    // FIXED IN ROUND 17 for the two spellings whose region carries a real
    // scheme mark: the IPv6 literal and the explicit port. Both are fixed
    // points of the redactor, which is what a url with no credential must be.
    expect(redactUrl("https://api.test/go/https://[::1]/users/@alice")).toBe(
      "https://api.test/go/https://[::1]/users/@alice",
    );
    expect(redactUrl("https://api.test/go/http://cdn.test:8080/u/@bob")).toBe(
      "https://api.test/go/http://cdn.test:8080/u/@bob",
    );

    // THE THIRD CLOSED IN ROUND 19, under R19-H2-02, and this row is where the
    // decision it reverses was written down. Round 17 left the bare `//`
    // spelling out because F3's first condition asks that a SCHEME wrote the
    // region's mark; round 19 asks instead whether the GRAMMAR wrote it, and a
    // bare `//` is the URL Standard's own protocol-relative authority, so it
    // writes one. The other two conditions are untouched: the authority text
    // must still hold no `@`, so `svc:PW@i.test` stays a password, and the
    // authority must still read.
    //
    // WHY THE NEW ANSWER IS THE CORRECT ONE. The authority of
    // `//https:/cdn.test/img/@alice` is the scheme token `https` with an empty
    // port, and everything after it is a path. So the old answer named `alice`,
    // a host no reader of the input could find, and dropped the text the
    // reference does put where a host goes. Nothing here is a credential.
    const embedded = new URL("https://https:/cdn.test/img/@alice");
    expect([embedded.host, embedded.username, embedded.password]).toEqual(["https", "", ""]);
    expect(redactUrl("https://api.test//https:/cdn.test/img/@alice")).toBe(
      "https://api.test//https:/cdn.test/img/@alice",
    );
  });
});

/**
 * The span the port rule is the ONLY reason for.
 *
 * `userinfoEnd` asks the last `@` of a region first and falls back to the last
 * `@` no solidus precedes, so suppressing the colon rule under a parser-read
 * authority can only lose a span whose every `@` follows a solidus. That is the
 * under-redaction residual `looksLikeUserinfo` already records — "a credential
 * whose LAST character is `/`" — and this counts the rows where it would be the
 * difference.
 */
function portOnlySpans(path: string): string[] {
  const lost: string[] = [];
  for (const span of userinfoSpans(path)) {
    const candidate = path.slice(span.start, span.end - 1);
    const slash = candidate.indexOf("/");
    const colon = candidate.indexOf(":");
    if (slash < 0) continue;
    if (colon < 0 || colon > slash) continue;
    if (candidate.at(-1) !== "/") continue;
    let readsAsAuthority = false;
    try {
      readsAsAuthority = new URL(`https://${candidate.slice(0, slash)}/`).host !== "";
    } catch {
      readsAsAuthority = false;
    }
    if (!readsAsAuthority) continue;
    let lone = false;
    for (let at = span.start; at < span.end; at += 1) {
      if (path[at] === "@" && path[at - 1] !== "/") lone = true;
    }
    if (lone || path[span.start] === "@") continue;
    lost.push(path.slice(span.start, span.end));
  }
  return lost;
}

function pathOf(url: string): string | null {
  const absolute = parseAbsolute(url);
  if (absolute) return absolute.pathname;
  try {
    return new URL(url, "http://url.invalid").pathname;
  } catch {
    return null;
  }
}

describe("R17-H3-01 — what the separating predicate costs, measured", () => {
  test("over 97,344 urls it now costs nothing at all", { timeout: 120_000 }, () => {
    // MOVED BY R19-H2-02: `touched` was 504 and is 0. Those 504 rows were the
    // whole of RES-7 — spans the colon rule took only because a bare `//`
    // wrote the region's mark — and round 19 gives that mark the parser's
    // reading, so `userinfoSpans` no longer offers a single one of them.
    //
    // `touched` AND `lostSecret` ARE THE TWO GUARDED ZEROS, and neither moved.
    // No span the predicate touches has ever held a planted secret, and after
    // round 19 the predicate touches nothing at all.
    //
    // `removed` IS THE NON-VACUITY GUARD, and it may only RISE. A population
    // that stopped redacting would report zero here and zero there alike, so
    // the two zeros above mean nothing without it. It rose in round 20, from
    // 57,360 to 57,442: 82 more planted credentials leave the emitted url.
    // Every one of the 82 is a credential-population row, all of them under
    // R20-H3-03's seam fallback — the structured half is unchanged at 28,672 of
    // 28,672, and the credential half goes from 28,688 to 28,770 of 40,000.
    //
    // AND IT ROSE AGAIN IN ROUND 23, from 57,442 to 57,451, under R23-H3-01.
    // `seamUserinfo` forwards the SPILL to `seamSpan` now, so a `\` the caller
    // wrote inside its own authority opens the seam even where the parser found
    // a host — and nine more planted credentials leave the emitted url with the
    // authority text they hid behind. Again every one of the nine is a
    // credential-population row: the structured half is still 28,672 of 28,672
    // and the credential half goes from 28,770 to 28,779 of 40,000. The
    // credential sweep above pins the same nine from the other side, as its
    // 11,230 rows still emitting the password falling to 11,221.
    //
    // A change that lets one of those 91 back through turns this red at 57,450
    // or below, and so does a change that stops removing any credential this
    // file plants. The number is asserted exactly rather than as a floor for
    // that reason. `touched` and `lostSecret` stay the guarded zeros above: the
    // seam is not the predicate this test measures, and R23-H3-01 offers it no
    // new span.
    let removed = 0;
    let touched = 0;
    let lostSecret = 0;
    const population = [
      ...structuredUrls().map((url) => ({ url, secret: "hunter2" })),
      ...credentialUrls(0xdeadbeef, 40_000).map((url) => ({ url, secret: PASSWORD })),
    ];
    for (const { url, secret } of population) {
      if (url.includes(secret) && !redactUrl(url).includes(secret)) removed += 1;
      const path = pathOf(url);
      if (path === null) continue;
      const spans = portOnlySpans(path);
      if (spans.length === 0) continue;
      touched += 1;
      if (spans.some((span) => span.includes(secret))) lostSecret += 1;
    }
    expect({ size: population.length, removed, touched, lostSecret }).toEqual({
      size: 97_344,
      removed: 57_451,
      touched: 0,
      lostSecret: 0,
    });
  });

  test("and RES-6 is untouched by it, because the third rule still answers", () => {
    // The colon is there, and the `@` is inside a segment rather than at its
    // head, so the third rule fires whatever the second one does.
    const path = pathOf("https://api.test/go/https://cdn.test:8443/img/alice@example.com/x")!;
    expect(portOnlySpans(path)).toEqual([]);
    expect(redactUrl("https://api.test/go/https://cdn.test:8443/img/alice@example.com/x")).toBe(
      "https://api.test/go/https://example.com/x",
    );
  });
});

/**
 * SHAPE 3 — R17-H3-02. THE MESSAGE CHANNEL NAMES A HOST THE URL CHANNEL DOES NOT.
 *
 * `redactUrlInMessage` harvests its needles from FOUR slots of the caller's url:
 * the parser's own credential, the path, the QUERY and the FRAGMENT. It then
 * removes each needle from the message wherever it appears. `redactUrl` drops
 * the query and the fragment WHOLE, so a needle harvested from one of those two
 * slots can never move a host in the url — and it moves one in the message.
 *
 * `https://api.test/v1?next=https://cdn.test/u/alice@example.com` is an ordinary
 * callback url. Its query yields the needle `cdn.test/u/alice@`. A platform
 * message that quotes the callback TARGET — which is the url the transport
 * actually tried — loses that host and reads `…contacting example.com…`.
 *
 * So the two records disagree about which host the request touched:
 * `toJSON().url` is `https://api.test/v1` and names `api.test`, while
 * `toJSON().message` names `example.com`, a host neither the caller's url nor
 * the platform's message ever named as a host. Round 16's control asserts the
 * two passes answer with the same hosts; it asserts it of one url, and it does
 * not generalize.
 *
 * WHY THIS IS NOT THE DOCUMENTED MESSAGE RESIDUAL RESTATED. That residual is
 * recorded on `redactUrlInMessage` and it bounds itself: "Over-redaction is the
 * safe direction, and it costs a diagnostic rather than a password."
 * `SECURITY.md` rests on that bound — it lists the message over-redaction third
 * among four limits "whose whole cost is a diagnostic" and states that none of
 * them "emits a value an attacker wants". The head of that same list, written
 * in round 16, states the membership rule: a limit belongs to the residual list
 * when "a value this library emits misleads that reader", and "a record that
 * names a host the request never contacted is one such value". The bound and
 * the membership rule cannot both be right about this limit.
 */
const CALLBACK_URL = "https://api.test/v1?next=https://cdn.test/u/alice@example.com";
const PLATFORM_MESSAGE =
  "connect ECONNREFUSED while contacting https://cdn.test/u/alice@example.com/avatar.png";

describe("R17-H3-02 — the message names a host the url never named", () => {
  test("a needle from the query slot must not rewrite a host in the message", () => {
    const named = hostsNamedBy(CALLBACK_URL);
    expect([...named].toSorted()).toEqual(["api.test", "cdn.test"]);

    const cleaned = redactUrlInMessage(PLATFORM_MESSAGE, CALLBACK_URL);
    expect([...hostsNamedBy(cleaned)].filter((host) => !named.has(host))).toEqual([]);
  });

  test("the url pass and the message pass answer with different hosts", () => {
    // Stated apart from the assertion above so the two failures cannot be read
    // as one: the URL channel is correct here, and that is the point. The query
    // is dropped whole, so nothing in `url` can move. Only `message` moves.
    const viaUrl = redactUrl(CALLBACK_URL);
    expect(viaUrl).toBe("https://api.test/v1");
    expect([...hostsNamedBy(viaUrl)]).toEqual(["api.test"]);
  });

  test("and no channel that carries a message invents a host", () => {
    const error = new NetworkError(PLATFORM_MESSAGE, { url: CALLBACK_URL });
    const rendered = everyChannel(error);

    // FIXED IN ROUND 17, and inverted for the same reason as the port test
    // above. F3 stopped `segmentUserinfos` past `kept`, closing all three
    // routes a needle took into the message: `parsed.search`, `parsed.hash`,
    // and the raw scan past `pathEnd`.
    //
    // The channel-set rule is what the test is for and it is unchanged: the
    // message channels all carry one text, so this is one decision and never
    // one channel's slip.
    expect(error.toJSON().message).toBe(redactUrlInMessage(PLATFORM_MESSAGE, CALLBACK_URL));
    expect(leakingChannels(rendered, ["contacting https://example.com"])).toEqual([]);
    expect(leakingChannels(rendered, ["cdn.test"]).length).toBeGreaterThan(3);
  });
});

/* -------------------------------------------------------------------------- */
/* 5. THE UNDER-REDACTION AXIS — every shape graded by the other judge         */
/* -------------------------------------------------------------------------- */

const CREDENTIAL_SENTINEL = "PWSENTINEL17";

/** Every channel, for one url, asked whether the sentinel survived anywhere. */
async function channelsFor(url: string): Promise<string[]> {
  const error = new NotFoundError(responseWith(url));
  const leaked = leakingChannels(everyChannel(error), [CREDENTIAL_SENTINEL]);
  await error.cancel();
  return leaked;
}

/**
 * An over-redaction report that costs a credential is a TRADE, not a finding.
 * Each row below is the credential twin of a shape above — the same grammar
 * with a real credential in it — and each one must still lose the credential on
 * every channel after the shape's fix.
 */
describe("both judges, on every shape this lane draws", () => {
  test.each([
    [
      "shape 2's twin: a credential whose password is all digits",
      `https://api.test/go/https://svc:8443/${CREDENTIAL_SENTINEL}@internal.test/v1`,
    ],
    [
      "shape 2's twin: a credential behind an IPv6-shaped opener",
      `https://api.test/go/https://[::1]:0/${CREDENTIAL_SENTINEL}@internal.test/v1`,
    ],
    [
      "shape 2's twin: the bare-`//` region with an embedded scheme colon",
      `https://api.test//https:/svc:${CREDENTIAL_SENTINEL}@internal.test/v1`,
    ],
    [
      "shape 3's twin: a credential in the query slot",
      `https://api.test/v1?next=https://svc:${CREDENTIAL_SENTINEL}@internal.test/x`,
    ],
    [
      "shape 3's twin: a credential in the fragment slot",
      `https://api.test/v1#next=https://svc:${CREDENTIAL_SENTINEL}@internal.test/x`,
    ],
  ])("%s still loses it on every channel", async (_label, url) => {
    expect(await channelsFor(url)).toEqual([]);
  });

  test("shape 2's fix keeps the credential twins the colon rule catches today", () => {
    // The three twins above are caught by the FIRST or the THIRD rule, so
    // suppressing the second one where the parser reads a port cannot reach
    // them. `portOnlySpans` is the set the change would lose, and it is empty
    // for each.
    for (const url of [
      `https://api.test/go/https://svc:8443/${CREDENTIAL_SENTINEL}@internal.test/v1`,
      `https://api.test/go/https://[::1]:0/${CREDENTIAL_SENTINEL}@internal.test/v1`,
      `https://api.test//https:/svc:${CREDENTIAL_SENTINEL}@internal.test/v1`,
    ]) {
      expect(portOnlySpans(pathOf(url)!), url).toEqual([]);
      expect(redactUrl(url), url).not.toContain(CREDENTIAL_SENTINEL);
    }
  });

  test("shape 3's fix has no credential to cost, because the slot is dropped whole", () => {
    // Narrowing the message pass to the needles `redactUrl` can also act on
    // would leave the query and fragment needles unremoved from a MESSAGE. That
    // is a real cost and it is named here rather than waved past: a platform
    // that quotes a callback target verbatim would keep the credential inside
    // it. The rows above show the current behavior; the fix lane owns the
    // choice, and this is the sentence the ledger wants beside it.
    const url = `https://api.test/v1?next=https://svc:${CREDENTIAL_SENTINEL}@internal.test/x`;
    expect(redactUrl(url)).toBe("https://api.test/v1");
    expect(redactUrlInMessage(`fetch failed: ${url}`, url)).not.toContain(CREDENTIAL_SENTINEL);
  });
});
