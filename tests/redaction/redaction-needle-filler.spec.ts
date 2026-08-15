import { describe, expect, test } from "vitest";
import { NetworkError } from "../../src/errors";
import { redactUrl, redactUrlInMessage } from "../../src/errors/redact-url";
import { userinfoSpans } from "../../src/errors/userinfo-spans";
import { PASSWORD, everyChannel, leakingChannels } from "../../fixtures/channels";

/**
 * ROUND 21, LANE H3 — THE NEEDLE THAT CANNOT MATCH.
 *
 * Round 20 qualified `SECURITY.md`'s password claim to "a password THE PARSER
 * READS AS USERINFO does not survive it", and named two shapes where the parser
 * reads none: a `file:` url, and a url the parser rejects outright. Round 20
 * also recorded the second of those as MEDIUM, on the reading that an
 * unparseable url leaves no parse to derive a needle from.
 *
 * BOTH HALVES OF THAT READING ARE WRONG, and the second is what makes this
 * critical.
 *
 *  - A NEEDLE IS ALREADY DERIVED WITHOUT A PARSE. `userinfosOf` scans the raw
 *    text with `userinfoSpans`, which opens a region on the GRAMMAR and never
 *    on a parse. It finds the credential in `http://svc:hunter2@/v1` exactly as
 *    it finds every other one. Nothing is missing.
 *  - AND THE SAME MECHANISM FIRES ON A URL THE PARSER ACCEPTS. The defect is
 *    not the absence of a parse. It is that `pastFiller` advances the span's
 *    cursor over the solidus behind the credential's `@`, so the span the
 *    scanner answers is `svc:hunter2@/` — and `withoutUserinfos` matches a
 *    needle only where the needle ENDS at an `@` in the message. A needle whose
 *    last character is a solidus is a needle no `@` anywhere can terminate, so
 *    it is dead on arrival: it can never remove one character from any message,
 *    on any input, ever.
 *
 * The class is therefore every url whose credential's `@` is followed by
 * anything `pastFiller` walks over — a solidus, `//`, `./`, `%2e/` — and it
 * reaches urls the parser accepts through the ordinary embedded-forward shape
 * `https://api.test/go/https://svc:hunter2@/cdn.test/v1`. On those the record
 * `toJSON().url` comes out CLEAN while `toJSON().message` keeps the password,
 * which is the state R19-H3-01, R20-H3-01 and R20-H3-02 were each filed as
 * critical for.
 *
 * WHAT THIS LANE MEASURED AND DID NOT FIND. Over 59,360 urls where the parser
 * DOES report a username or a password — ten scheme tokens, ten solidus
 * spellings, thirty-seven delimiters at four positions, seven hosts including
 * punycode, a unicode label and an IPv6 literal, each quoted four ways — the
 * password reaches no channel on any row. `SECURITY.md`'s qualified claim has
 * no counterexample. Section 3 ships the affordable half of that grid.
 *
 * A disclosure decision applies to the CHANNEL SET, so every sentinel here goes
 * through `everyChannel` in `fixtures/channels.ts`.
 *
 * NOT RE-REPORTED: RES-1 through RES-6, RES-7 (closed by round 19), the `file:`
 * seam residual round 20 recorded, `showHidden: true`, `console.dir` with
 * `cause`, the accessor-pollution guard shape, a forged brand accepted by
 * design, and a non-special scheme or `file:` under fewer than two solidi
 * keeping its text.
 */

const BACKSLASH = String.fromCharCode(92);

/** The one platform sentence this module exists for, with the url in it. */
function messageFor(quoted: string): string {
  return `Request cannot be constructed from a URL that includes credentials: ${quoted}`;
}

/**
 * The message a fetch adapter writes: the platform never sends a fragment, so
 * it quotes the url with the fragment stripped. That takes the whole-url
 * `replaceAll` out of the picture and leaves the userinfo pass alone.
 */
function quotedWithoutFragment(url: string): string {
  const hash = url.indexOf("#");
  return hash < 0 ? url : url.slice(0, hash);
}

/** One error carrying `url`, with the platform's own quoting of it. */
function errorFor(url: string): NetworkError {
  return new NetworkError(messageFor(quotedWithoutFragment(url)), { url });
}

/* -------------------------------------------------------------------------- */
/* 1. R21-H3-01 — THE DEAD NEEDLE                                             */
/* -------------------------------------------------------------------------- */

/** The forwarding url every callback and every proxy carries. */
const OUTER = "https://api.test/go/";

/** Everything `pastFiller` walks over, plus the `..` it refuses to walk over. */
const FILLERS = ["", "/", "//", "./", "%2e/", "../"] as const;

const SCHEMES = ["https", "http", "ws", "wss", "ftp", "file", "git", "custom-scheme"] as const;
const SOLIDI = ["", "/", "//", "///"] as const;

/** Every embedded-forward url in the grid that the URL parser ACCEPTS. */
function forwards(): string[] {
  const found: string[] = [];
  for (const scheme of SCHEMES)
    for (const solidi of SOLIDI)
      for (const filler of FILLERS) {
        const url = `${OUTER}${scheme}:${solidi}svc:${PASSWORD}@${filler}cdn.test/v1#anchor`;
        try {
          new URL(url);
        } catch {
          continue;
        }
        found.push(url);
      }
  return found;
}

describe("R21-H3-01 — a needle that does not end at an `@` removes nothing", () => {
  test("EVIDENCE: the same credential with the host behind its `@` is removed", () => {
    // The non-vacuity control, and the whole width of the difference. One url
    // shape, one character apart, two answers — so what follows is a gap and
    // not a design.
    const error = errorFor(`${OUTER}https://svc:${PASSWORD}@cdn.test/v1#anchor`);

    expect(leakingChannels(everyChannel(error), [PASSWORD])).toEqual([]);
  });

  test("EVIDENCE: the span the scanner answers ends on a solidus, not on the `@`", () => {
    // The MECHANISM, pinned as it is and as it must stay. The span's width is
    // right for `redactUrl`, which removes it by position and pays a pass for
    // every character it leaves behind — `pastFiller` states that. What is
    // wrong is the needle DERIVED from it: `hiddenUserinfos` slices the span
    // whole for a path-slot scan, and `withoutUserinfos` tests only slices that
    // END at an `@` in the message. So this needle can never match anything.
    const url = `${OUTER}https://svc:${PASSWORD}@/cdn.test/v1`;
    const spans = userinfoSpans(url).map((span) => url.slice(span.start, span.end));

    expect(spans).toEqual([`svc:${PASSWORD}@/`]);
  });

  test("the needle removes the credential wherever a message spells it", () => {
    // The observable form of the paragraph above, and the row that has to move.
    // The message quotes the credential and nothing else, so the whole-url
    // replacement cannot fire and the userinfo pass is the only line there is.
    const url = `${OUTER}https://svc:${PASSWORD}@/cdn.test/v1`;

    expect(
      redactUrlInMessage(`the userinfo svc:${PASSWORD}@ was refused`, url),
      "the needle derived for this url is `svc:hunter2@/`, and no `@` in any message " +
        "ends a slice spelling that, so the needle can never remove one character",
    ).toBe("the userinfo  was refused");
  });

  test("the password reaches no channel through an embedded forward", () => {
    const url = `${OUTER}https://svc:${PASSWORD}@/cdn.test/v1#anchor`;

    expect(
      leakingChannels(everyChannel(errorFor(url)), [PASSWORD]),
      "`pastFiller` walks the span past the solidus behind the `@`, so the needle is " +
        "`svc:hunter2@/`. `withoutUserinfos` matches a needle only where it ends at an `@` " +
        "in the message, so this one can never match anything. The url PARSES, and " +
        "`redactUrl` drops the credential from the record — the message keeps it",
    ).toEqual([]);
  });

  test("and the whole class answers alike, over every filler and every scheme", () => {
    // A disclosure decision applies to the class. Four filler spellings the
    // cursor walks over, eight scheme tokens across all three scheme classes.
    //
    // ASKED ONLY WHERE THE RECORD IS CLEAN. A non-special scheme, or `file:`,
    // under fewer than two solidi keeps its text in `redactUrl` too — that is a
    // residual `SECURITY.md` records, and a row of it is not this one. The
    // subject here is the rows where `redactUrl` DID remove the credential and
    // the message pass did not.
    const asked = forwards().filter((url) => !redactUrl(url).includes(PASSWORD));
    const leaking = asked.filter(
      (url) => leakingChannels(everyChannel(errorFor(url)), [PASSWORD]).length > 0,
    );

    expect({ asked: asked.length, leaking: leaking.length }).toEqual({
      asked: 156,
      leaking: 0,
    });
  });

  test("the record and the message do not move together", () => {
    // The invariant `userinfosOf`'s own comment states for every needle it
    // derives: "what the span covers is text `redactUrl` drops from `url` too
    // … so the two records move together". A row where `toJSON().url` is clean
    // and `toJSON().message` is not is that sentence falsified, and it is the
    // worst shape a record can take — the reader who checks `url` sees nothing
    // and the logger that writes `message` ships the password.
    let recordClean = 0;
    const split: string[] = [];
    for (const url of forwards()) {
      if (redactUrl(url).includes(PASSWORD)) continue;
      recordClean += 1;
      const quoted = messageFor(quotedWithoutFragment(url));
      if (redactUrlInMessage(quoted, url).includes(PASSWORD)) split.push(url);
    }

    expect({ recordClean, split: split.length }).toEqual({ recordClean: 156, split: 0 });
  });

  test("the head spelling the parser rejects is the same class, not a class apart", () => {
    // Round 20 recorded this as medium on the reading that no parse exists to
    // derive a needle from. The scan that finds it opens on the GRAMMAR, so a
    // needle IS derived here — `userinfoSpans` answers the same span it answers
    // for the parseable rows above, and it dies for the same reason.
    const url = `http://svc:${PASSWORD}@/v1#anchor`;

    expect(() => new URL(url)).toThrow();
    expect(leakingChannels(everyChannel(errorFor(url)), [PASSWORD])).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* 2. THE QUALIFIER, MEASURED — the negative result this lane owes            */
/* -------------------------------------------------------------------------- */

/** Every delimiter the parser rewrites, terminates on, or refuses outright. */
const DELIMITERS = [
  BACKSLASH,
  "\t",
  "\n",
  "\r",
  " ",
  "/",
  "?",
  "#",
  ":",
  "@",
  "%",
  "%3A",
  "%40",
  "[",
  "]",
  "|",
  "<",
  ">",
  "^",
  "{",
  "}",
  "é",
  "☃",
  " ",
  "ß",
  "ﬁ",
  "é",
] as const;

const QUALIFIER_SCHEMES = ["https", "http", "ftp", "file", "git", "custom-scheme"] as const;
const QUALIFIER_SOLIDI = ["", "/", "//", "///", BACKSLASH, "/\t/"] as const;
const QUALIFIER_HOSTS = ["api.test", "api.test:8443", "xn--n3h.test", "☃.test", "[::1]"] as const;

describe("the qualifier holds: a userinfo the parser READS never reaches a channel", () => {
  test("no row of the delimiter grid leaks, and the grid is not empty", () => {
    // `SECURITY.md` scopes its password claim to a userinfo the parser reads.
    // That scope is the new attack surface, so it is measured rather than
    // assumed. `reads` is the non-vacuity floor: a grid that stopped producing
    // parsed credentials would also report no leak.
    let reads = 0;
    const leaking: string[] = [];
    for (const scheme of QUALIFIER_SCHEMES)
      for (const solidi of QUALIFIER_SOLIDI)
        for (const delimiter of DELIMITERS)
          for (const host of QUALIFIER_HOSTS) {
            const password = `hun${delimiter}ter2`;
            const url = `${scheme}:${solidi}svc:${password}@${host}/v1#anchor`;
            let parsed: URL;
            try {
              parsed = new URL(url);
            } catch {
              continue;
            }
            if (parsed.username === "" && parsed.password === "") continue;
            reads += 1;
            const found = leakingChannels(everyChannel(errorFor(url)), [password]);
            if (found.length > 0) leaking.push(url);
          }

    expect({ reads, leaking }).toEqual({ reads: 2550, leaking: [] });
  });
});

/* -------------------------------------------------------------------------- */
/* 3. THE `file:` SEAM'S EIGHT ROWS, DRAWN                                    */
/* -------------------------------------------------------------------------- */

/**
 * The eight rows of round 20's 1,200-check corpus that held the password in the
 * caller's own spelling until round 23, written out rather than counted.
 *
 * They are ONE shape under four spellings of a mark and two hosts: a `file:`
 * url whose password holds a `\`, quoted by a message that stripped the
 * fragment. `file:` is one of the URL Standard's six special schemes, so
 * `authorityEnd` folds that `\` into a solidus and `ownUserinfo`'s backward
 * search stops in front of the `@` — R20-ORCH-01's mechanism, under the one
 * scheme where the fold is what the Standard asks for.
 *
 * AND R23-H2-01 CLOSED ALL EIGHT. `hiddenUserinfos` emits a path span AND every
 * segment of it that ends in an `@`, so `ter2@` — the segment on the far side
 * of the folded `\`, which the parser and the caller spell identically — is now
 * a needle of its own. The whole-span needle `svc:hun/ter2@` never was one: it
 * is written in the PARSER's spelling and no quote of the caller's text can
 * match it.
 *
 * The parser still reports neither a username nor a password on any of the
 * eight, which is why the first test below stays: the class this closes is
 * exactly the one the `SECURITY.md` qualifier scoped ITSELF out of, so the eight
 * are now covered by more than the qualifier promises. The rows stay written out
 * so a later round that reopens the class has to come here first.
 */
const FILE_SEAM_ROWS = [
  `file:svc:hun${BACKSLASH}ter2@api.test/v1#anchor`,
  `file:svc:hun${BACKSLASH}ter2@api.test:8443/v1#anchor`,
  `file:/svc:hun${BACKSLASH}ter2@api.test/v1#anchor`,
  `file:/svc:hun${BACKSLASH}ter2@api.test:8443/v1#anchor`,
  `file:///svc:hun${BACKSLASH}ter2@api.test/v1#anchor`,
  `file:///svc:hun${BACKSLASH}ter2@api.test:8443/v1#anchor`,
  `file:${BACKSLASH}svc:hun${BACKSLASH}ter2@api.test/v1#anchor`,
  `file:${BACKSLASH}svc:hun${BACKSLASH}ter2@api.test:8443/v1#anchor`,
] as const;

describe("the recorded `file:` residual, drawn out row by row", () => {
  test("every one of the eight is a userinfo the parser reports as absent", () => {
    const reported = FILE_SEAM_ROWS.filter((url) => {
      const parsed = new URL(url);
      return parsed.username !== "" || parsed.password !== "";
    });

    expect(reported).toEqual([]);
  });

  test("and not one of them keeps the password through either quote", () => {
    // THIS PINNED THE RESIDUAL AND NOW PINS ITS CLOSURE. `stripped` was 8 —
    // every row keeping the password through the quote a fetch adapter really
    // writes — and R23-H2-01 took it to 0. `exact` was 0 and stays 0: that
    // quote holds the whole url, so the first line of `redactUrlInMessage`
    // always reached it and the seam was never the only reader.
    //
    // THE THIRD COUNT IS WHAT MAKES THIS MORE THAN THE FIRST TWO. `ter2@` is
    // the needle that does the work, so `tail` asks directly whether that
    // segment left the message, and it must stay 0 whatever else moves. A
    // change that emitted a WIDER needle could take the password out while
    // leaving the tail somewhere else in the text; a change that stopped
    // emitting segments at all turns all three counts back to 8.
    //
    // WHAT SURVIVES IS THE HEAD, and it is stated rather than pinned: the
    // answer is `…: file:///svc:hun\api.test/v1`, so `hun\` stands where the
    // password's first three characters were. It is not asserted because
    // asserting it would turn a later round that removes it red for an
    // improvement.
    const password = `hun${BACKSLASH}ter2`;
    const answers = FILE_SEAM_ROWS.map((url) => ({
      stripped: redactUrlInMessage(messageFor(quotedWithoutFragment(url)), url).includes(password),
      exact: redactUrlInMessage(messageFor(url), url).includes(password),
      tail: redactUrlInMessage(messageFor(quotedWithoutFragment(url)), url).includes("ter2"),
    }));

    expect(answers.length).toBe(8);
    expect(answers.filter((one) => one.stripped).length).toBe(0);
    expect(answers.filter((one) => one.exact).length).toBe(0);
    expect(answers.filter((one) => one.tail).length).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* 4. THE SPELLING-AWARE JUDGE, RUN OVER THE WHOLE CHANNEL SET                */
/* -------------------------------------------------------------------------- */

/**
 * Round 20 ran its spelling judge over `redactUrlInMessage`'s output alone. A
 * disclosure decision applies to the channel set, so this runs the same judge
 * over all twenty-two renders `everyChannel` produces.
 */
function spellingsOf(secret: string): Map<string, string> {
  const found = new Map<string, string>();
  const add = (name: string, text: string | null): void => {
    if (text !== null && text !== "" && !found.has(text)) found.set(text, name);
  };
  try {
    add("path-encoded", new URL(`http://s.invalid/${secret}`).pathname.slice(1));
  } catch {
    /* a secret the path state refuses has no path spelling */
  }
  try {
    add("userinfo-encoded", new URL(`http://${secret.replaceAll("@", "")}@s.invalid/`).username);
  } catch {
    /* likewise for the userinfo state */
  }
  try {
    add("percent-decoded", decodeURIComponent(secret));
  } catch {
    /* a malformed escape decodes to nothing */
  }
  add("lowercase", secret.toLowerCase());
  add("uppercase", secret.toUpperCase());
  for (const form of ["NFC", "NFD", "NFKC", "NFKD"] as const)
    add(`normalized ${form}`, secret.normalize(form));
  add("solidus-folded", secret.replaceAll(BACKSLASH, "/"));
  add("tab-stripped", secret.replace(/[\t\r\n]/g, ""));
  return found;
}

/** The classes round 20's corpus could not draw, one url apiece. */
const SPELLING_ROWS = [
  // A punycode host behind the credential.
  ["https://svc:hu%6Eter2@xn--n3h.test/v1#anchor", "hu%6Eter2"],
  // A unicode host label the parser rewrites into punycode.
  ["https://svc:hunter2@☃.test/v1#anchor", "hunter2"],
  // A secret split by a percent-escape boundary.
  ["https://svc:hunte%72@api.test/v1#anchor", "hunte%72"],
  // Case folding inside the password.
  ["https://svc:HUNTER2@API.TEST/v1#anchor", "HUNTER2"],
  // A compatibility ligature: NFKC and NFKD disagree with NFC and NFD.
  ["https://svc:ﬁhunter2@api.test/v1#anchor", "ﬁhunter2"],
  // A combining sequence: NFC and NFD disagree.
  ["https://svc:hunéter2@api.test/v1#anchor", "hunéter2"],
] as const;

describe("the spelling-aware judge over every channel", () => {
  test("EVIDENCE: the judge names a rewrite a raw sentinel calls removed", () => {
    // Calibration before anything rests on it. `redactUrl` keeps this
    // credential as an opaque path and re-spells the space, so the raw
    // spelling is absent and a reader still recovers the secret.
    const output = redactUrl("https://api.test/go/git:/svc:PW SENT@internal.test/v1");

    expect(output).not.toContain("PW SENT");
    expect([...spellingsOf("PW SENT").keys()].some((one) => output.includes(one))).toBe(true);
  });

  test("no re-spelling of the secret reaches any channel on the classes not yet drawn", () => {
    const surviving: string[] = [];
    for (const [url, secret] of SPELLING_ROWS) {
      const rendered = everyChannel(errorFor(url));
      if (leakingChannels(rendered, [secret]).length > 0) {
        surviving.push(`${url} (plain)`);
        continue;
      }
      for (const [label, text] of Object.entries(rendered))
        for (const [spelling, how] of spellingsOf(secret))
          if (spelling.length >= 4 && text.includes(spelling))
            surviving.push(`${url} (${how} in ${label})`);
    }

    expect(surviving).toEqual([]);
  });
});
