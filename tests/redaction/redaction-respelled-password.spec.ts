import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { NetworkError } from "../../src/errors";
import { redactUrl, redactUrlInMessage } from "../../src/errors/redact-url";
import { everyChannel, leakingChannels } from "../../fixtures/channels";

/**
 * ROUND 19, LANE H3 — THE JUDGE, THEN THE MODULE.
 *
 * Round 18 qualified every removal count this audit has ever reported: its
 * TRANSFORMED axis fires on 9,258 rows where the secret is absent VERBATIM and
 * present in the spelling the URL parser writes for it, and every
 * `leakingChannels` sentinel in this repository is a raw substring test. That
 * note was recorded and nothing acts on it. This lane asks the question the
 * note leaves open: is the blindness confined to rows the module would have
 * kept anyway?
 *
 * THE JUDGE INVENTORY, and what each member can and cannot see.
 *
 *  1. `leakingChannels` in `fixtures/channels.ts` — the judge behind every
 *     disclosure assertion in this repository. It is `text.includes(secret)`
 *     over seven rendered channels. It sees the PLAIN spelling and nothing
 *     else: not percent-encoding in either direction, not a `\` the parser
 *     folds to `/`, not a tab the parser deletes, not case folding, not
 *     punycode, not NFC/NFD/NFKC/NFKD, not the parser's own re-spelling of an
 *     authority, and not a secret split across a removal boundary.
 *  2. The round 14 oracle in `redaction-oracle.spec.ts` — `credentialsOf` plus
 *     `isSubsequence`. It reads a SUBSEQUENCE, so it survives an inserted
 *     byte, and it still cannot see a byte the parser REWRITES.
 *  3. Round 17's calibrated host reader, reproduced in
 *     `redaction-empty-userinfo.spec.ts` as `hostsNamedBy`/`judgeHosts`. It grades
 *     over-redaction only and says nothing about a credential.
 *  4. Round 18's third judge, `gradeEscapes`. Its `emittedSpelling` probe is
 *     one call — a secret pushed through a PATH slot — so it models the path
 *     percent-encode set and the backslash fold, and nothing that happens to a
 *     HOST (case folding, IDNA, punycode, percent-decoding) or to a USERINFO,
 *     whose encode set is wider than the path's.
 *
 * WHAT THE SPELLING-AWARE JUDGE FOUND, over 583,200 rows in three grammars.
 *
 *  - `redactUrl` is CLEAN on this axis, and the reason is structural rather
 *    than statistical. The absolute branch reads the parsed `URL` and never the
 *    raw text, so two spellings that parse alike are one input to it: no
 *    rewrite can save a secret the plain spelling loses. Measured at 0 rows of
 *    583,200 where the rewrite is what saved it, in the absolute branch and
 *    in the relative branch that DOES read raw text.
 *  - The over-redaction axis is clean beyond RES-6 and RES-7. Crossing the two
 *    residuals with each other and with round 18's anchor over 10,240 rows,
 *    every invented host needs an `@` after the embedded authority, which is
 *    the shared precondition both residuals are written on.
 *  - `redactUrlInMessage` is NOT clean, and it is not a spelling gap in the
 *    judge: it is a spelling gap in the MODULE. R19-H3-01 below.
 *
 * A disclosure decision applies to the CHANNEL SET, so every sentinel here goes
 * through `everyChannel` in `fixtures/channels.ts`.
 *
 * NOT RE-REPORTED: RES-1 through RES-7, `showHidden`, `console.dir` with
 * `cause`, the accessor-pollution guard shape, a forged brand, `error.cause`
 * carrying the platform's text, the merge-overlap fix, and round 16's `%40`,
 * IDN, `blob:`, `data:`, pollution and header sweeps, which already drew every
 * shape the round 16 gap list names.
 */

/* -------------------------------------------------------------------------- */
/* 1. THE SPELLING-AWARE JUDGE                                                */
/* -------------------------------------------------------------------------- */

/**
 * Every spelling of `secret` a reader recovers without guessing, keyed by the
 * transformation that produces it.
 *
 * Each entry is a rewrite some layer between the caller and the log line
 * performs: the URL parser's path and userinfo and query encode sets, the host
 * parser's percent-DECODE and IDNA mapping, the four Unicode normalization
 * forms, the backslash fold a special scheme applies, and the tab/CR/LF
 * deletion the parser runs before it parses anything. A judge that asks only
 * about the plain spelling answers "removed" for all of them.
 */
function spellingsOf(secret: string): Map<string, string> {
  const found = new Map<string, string>();
  const add = (name: string, text: string | null): void => {
    if (text !== null && text !== "" && !found.has(text)) found.set(text, name);
  };
  add("plain", secret);
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
    add("query-encoded", new URL(`http://s.invalid/?${secret}`).search.slice(1));
  } catch {
    /* and for the query state */
  }
  try {
    add("percent-decoded", decodeURIComponent(secret));
  } catch {
    /* a malformed escape decodes to nothing */
  }
  try {
    add("host-mapped", new URL(`http://${secret}.invalid/`).hostname.replace(/\.invalid$/, ""));
  } catch {
    /* not every secret reads as a host label */
  }
  add("lowercase", secret.toLowerCase());
  add("uppercase", secret.toUpperCase());
  for (const form of ["NFC", "NFD", "NFKC", "NFKD"] as const)
    add(`normalized ${form}`, secret.normalize(form));
  add("solidus-folded", secret.replaceAll("\\", "/"));
  add("tab-stripped", secret.replace(/[\t\r\n]/g, ""));
  return found;
}

/** The first reader-recoverable spelling of `secret` present in `text`. */
function survivingSpelling(text: string, secret: string): { spelling: string; how: string } | null {
  for (const [spelling, how] of spellingsOf(secret)) {
    if (spelling.length >= 4 && text.includes(spelling)) return { spelling, how };
  }
  return null;
}

describe("the spelling-aware judge, calibrated before anything rests on it", () => {
  test("it sees what the raw judge cannot, on round 18's own pinned row", () => {
    // Round 18's TRANSFORMED row, verbatim. The raw judge says removed and the
    // spelling-aware judge names the rewrite.
    const output = redactUrl("https://api.test/go/git:/svc:PW SENT@internal.test/v1");
    expect(output.includes("PW SENT")).toBe(false);
    expect(survivingSpelling(output, "PW SENT")).toEqual({
      spelling: "PW%20SENT",
      how: "path-encoded",
    });
  });

  test("and it does not fire on an answer that carries nothing", () => {
    expect(survivingSpelling(redactUrl("https://svc:hunter2@api.test/v1"), "hunter2")).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* 2. R19-H3-01 — THE URL'S OWN USERINFO IS A NEEDLE IN ONE SPELLING          */
/* -------------------------------------------------------------------------- */

/**
 * `redactUrlInMessage` states its contract in two halves, and the second half
 * is unconditional:
 *
 *   "BEST EFFORT, and deliberately so: a platform that re-serializes the URL
 *    before putting it in its message defeats the exact-string replacement.
 *    The userinfo pass is the second line — userinfo is unconditionally a
 *    credential, so it is removed WHEREVER IT SURVIVES".
 *
 * It is not removed wherever it survives. `userinfosOf` reads the raw text only
 * from `afterOwnAuthority(url)` onward — round 7's DEFECT 3b fix, which taught
 * the parseable branch to read raw text for exactly this reason — and it reads
 * the url's OWN userinfo from `parsed.username`/`parsed.password`, which is the
 * spelling the URL parser writes and not the spelling the caller wrote. Where a
 * password holds a character the userinfo encode set touches — a space, a
 * non-ASCII letter, `|`, `<`, `>`, a backtick, `{`, `}`, `"`, `^` — the two
 * spellings differ, and the raw one is a needle nothing in the set holds.
 *
 * The trigger is any message that quotes the url in a spelling that keeps the
 * userinfo as the caller wrote it. `SECURITY.md` names three such spellings in
 * its own residual bullet — a stripped fragment, a normalized default port, and
 * a case-folded host — and admits only that "the query or fragment byte in that
 * spelling survives". A password is not a query byte.
 */
const OWN_USERINFO_SPELLINGS = [
  ["a stripped fragment", "https://svc:%P@api.test/v1#tail", "https://svc:%P@api.test/v1"],
  ["a normalized default port", "https://svc:%P@api.test:443/v1", "https://svc:%P@api.test/v1"],
  ["a case-folded host", "https://svc:%P@API.TEST/v1", "https://svc:%P@api.test/v1"],
  ["the authority alone", "https://svc:%P@api.test/v1", "svc:%P@api.test"],
] as const;

/** Passwords whose raw spelling the URL parser rewrites, and one that it does not. */
const REWRITTEN_PASSWORDS = ["hun ter2", "hün ter2", "hun|ter2", "hun<ter2"] as const;
const ASCII_PASSWORD = "hunter2";

function messageFor(quoted: string): string {
  return `request to ${quoted} failed, reason: connect ECONNREFUSED`;
}

describe("R19-H3-01 — a password the parser re-spells survives the userinfo pass", () => {
  test.each(OWN_USERINFO_SPELLINGS)(
    "CONTROL: an ASCII password is removed when the message quotes %s",
    (_label, urlTemplate, quotedTemplate) => {
      // The half that works, and the half that makes the rows below a SPELLING
      // defect rather than a restatement of the best-effort limit. The parser
      // writes `hunter2` for `hunter2`, so the one needle the set holds matches
      // the text the message carries.
      const url = urlTemplate.replace("%P", ASCII_PASSWORD);
      const cleaned = redactUrlInMessage(
        messageFor(quotedTemplate.replace("%P", ASCII_PASSWORD)),
        url,
      );

      expect(cleaned).not.toContain(ASCII_PASSWORD);
    },
  );

  test.each(REWRITTEN_PASSWORDS)(
    "the password %j survives every one of the three spellings",
    (password) => {
      const kept: string[] = [];
      for (const [label, urlTemplate, quotedTemplate] of OWN_USERINFO_SPELLINGS) {
        const url = urlTemplate.replace("%P", password);
        const cleaned = redactUrlInMessage(messageFor(quotedTemplate.replace("%P", password)), url);
        if (cleaned.includes(password)) kept.push(label);
        // The url channel is clean on every row: this is the message pass alone.
        expect(redactUrl(url)).not.toContain(password);
      }

      expect(kept, `the userinfo pass kept the password on: ${kept.join(", ")}`).toEqual([]);
    },
  );

  test("and it reaches the record and the whole channel set", () => {
    // The shape a consumer wrapping an adapter produces: the platform names the
    // request target it could not reach, the fragment stripped because a fetch
    // never sends one, and the caller hands the library the href it holds.
    const password = "hun ter2";
    const url = `https://svc:${password}@api.test/v1#anchor`;
    const error = new NetworkError(messageFor(`https://svc:${password}@api.test/v1`), {
      url,
      cause: undefined,
    });

    // `toJSON().url` is clean, so the two records of one failure disagree.
    expect(error.toJSON().url).not.toContain(password);
    expect(leakingChannels(everyChannel(error), [password])).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* 3. R19-H3-02 — THE SENTENCE THAT SAYS A MISS CANNOT REACH THE RECORD       */
/* -------------------------------------------------------------------------- */

/**
 * The same comment closes with a claim the record contradicts:
 *
 *   "and `toJSON()` redacts `url` independently, so a miss here never reaches
 *    the record."
 *
 * `toJSON()` redacts `url` and copies `message` verbatim, and `message` is what
 * the miss lands in. `SECURITY.md` already says so, in the residual bullet on
 * `redactUrlInMessage`: "The query or fragment byte in that spelling survives
 * in `error.message`, and in `toJSON().message`, which is the record a
 * structured logger writes." Two documents about one behavior, and the one in
 * the source is the false one. This is the fifth false sentence this audit has
 * produced while a document was being corrected.
 */
const REDACT_URL_SOURCE = readFileSync(
  new URL("../../src/errors/redact-url.ts", import.meta.url),
  "utf8",
);

describe("R19-H3-02 — the source claims a miss cannot reach the record", () => {
  test("a miss DOES reach the record, through `message`", () => {
    // The behaviour, which passes: this is the exhibit, not the finding.
    const url = "https://api.test/v1?access_token=QUERYSENTINEL19#anchor";
    const error = new NetworkError(messageFor("https://api.test/v1?access_token=QUERYSENTINEL19"), {
      url,
    });

    expect(error.toJSON().url).not.toContain("QUERYSENTINEL19");
    expect(error.toJSON().message).toContain("QUERYSENTINEL19");
  });

  test("so the sentence in `redact-url.ts` is false, and `SECURITY.md` says the opposite", () => {
    // `SECURITY.md` is the document a reporter reads. It is right.
    const policy = readFileSync(new URL("../../SECURITY.md", import.meta.url), "utf8");
    expect(policy).toContain("`toJSON().message`, which is the record a structured logger writes.");

    // Matched rather than asserted on the whole file, so the failure prints the
    // sentence and not 800 lines of module header.
    const FALSE_CLAIM = "so a miss here never reaches the record";
    const quoted = REDACT_URL_SOURCE.includes(FALSE_CLAIM) ? FALSE_CLAIM : "";

    expect(quoted, "src/errors/redact-url.ts still carries the sentence").toBe("");
  });
});

/* -------------------------------------------------------------------------- */
/* 4. THE SPELLING DIFFERENTIAL — the negative result, committed              */
/* -------------------------------------------------------------------------- */

const SECRET = "PWSENT19";
const TAB = String.fromCharCode(9);
const BACKSLASH = String.fromCharCode(92);
const CR = String.fromCharCode(13);

const BODIES = [
  SECRET,
  `PW SENT19`,
  `PW${TAB}SENT19`,
  `PW${BACKSLASH}SENT19`,
  `PW${CR}SENT19`,
  "PW@SENT19",
  "PW%40SENT19",
  "PW:SENT19",
  "PW/SENT19",
  "pwsent19",
  "PWSÉNT19",
  "PW%zzSENT19",
  "PW<SENT19",
  "PW{SENT19",
  "PW|SENT19",
  "PW^SENT19",
  'PW"SENT19',
  "PW[SENT19",
] as const;

const OUTER = ["https://api.test", ""] as const;
const MIDDLE = ["/go/", "//", "/"] as const;
const OPENER = [
  "https://",
  "https:/",
  "https:",
  "//",
  "ftp://",
  "zz://",
  "://",
  "git:/",
  `${BACKSLASH}${BACKSLASH}`,
  `https:${BACKSLASH}${BACKSLASH}`,
] as const;
const USERINFO = ["svc:%S@", "%S@", ":%S@", "svc:%S:x@", "%S%40", "svc:%S"] as const;
const AUTHORITY = [
  "internal.test",
  "internal.test:8443",
  "[::1]",
  "1.2.3.4",
  "пример.рф",
  "%65xample.test",
] as const;
const TAIL = ["/v1", "/v1/@alice", "", "/@", "/x/../y"] as const;
const SUFFIX = ["", "?q=a@b", "#f@g"] as const;

interface Differential {
  rows: number;
  whole: number;
  transformed: number;
  savedByTheRewrite: number;
}

/**
 * The one question a spelling-aware judge asks that a raw one cannot: is the
 * REWRITE what saved the secret? The counterfactual is the same url with the
 * secret already written the way the parser writes it. Where that answer also
 * carries it, the rewrite saved nothing and the survival belongs to a residual.
 */
function gradeSpellings(): Differential {
  const measured: Differential = { rows: 0, whole: 0, transformed: 0, savedByTheRewrite: 0 };
  for (const body of BODIES) {
    for (const outer of OUTER) {
      for (const middle of MIDDLE) {
        for (const opener of OPENER) {
          for (const userinfo of USERINFO) {
            for (const authority of AUTHORITY) {
              for (const tail of TAIL) {
                for (const suffix of SUFFIX) {
                  const url =
                    outer +
                    middle +
                    opener +
                    userinfo.replaceAll("%S", body) +
                    authority +
                    tail +
                    suffix;
                  if (!url.includes(body)) continue;
                  measured.rows += 1;
                  const output = redactUrl(url);
                  if (output.includes(body)) {
                    measured.whole += 1;
                    continue;
                  }
                  const found = survivingSpelling(output, body);
                  if (found === null) continue;
                  measured.transformed += 1;
                  const counterfactual = redactUrl(url.split(body).join(found.spelling));
                  if (!counterfactual.includes(found.spelling)) measured.savedByTheRewrite += 1;
                }
              }
            }
          }
        }
      }
    }
  }
  return measured;
}

describe("the spelling differential over the corpus this lane commits", () => {
  test("no rewrite saves a secret the plain spelling loses", { timeout: 600_000 }, () => {
    const graded = gradeSpellings();
    expect(graded.rows).toBe(583_200);
    expect(graded.transformed).toBeGreaterThan(0);
    expect(graded.savedByTheRewrite).toBe(0);
  });

  test("and the reason is structural, not statistical", () => {
    // The absolute branch computes its answer from the parsed `URL` and never
    // reads the raw string again, so two spellings that parse alike ARE one
    // input to it. The three round 18 named, on one row each.
    const folded = `https://api.test/go/git:/svc:PW${BACKSLASH}SENT@internal.test/v1`;
    const plain = "https://api.test/go/git:/svc:PW/SENT@internal.test/v1";
    expect(redactUrl(folded)).toBe(redactUrl(plain));

    const broken = `https://api.test/go/git:/svc:PW${TAB}SENT@internal.test/v1`;
    expect(redactUrl(broken)).toBe(
      redactUrl("https://api.test/go/git:/svc:PWSENT@internal.test/v1"),
    );
  });
});

/* -------------------------------------------------------------------------- */
/* 5. THE OVER-REDACTION CROSSING — RES-6 by RES-7 by round 18's anchor       */
/* -------------------------------------------------------------------------- */

const JUDGE_BASE = "http://judge.invalid";
const SCHEME_TOKEN = /[a-zA-Z][a-zA-Z0-9+.-]*:/g;
const SOLIDUS_PAIR = /[/\\][/\\]/g;
const OWN_DELIMITER = /^[a-zA-Z][a-zA-Z0-9+.-]*:$/;

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

function matchIndexes(text: string, pattern: RegExp): number[] {
  const found: number[] = [];
  pattern.lastIndex = 0;
  for (let hit = pattern.exec(text); hit !== null; hit = pattern.exec(text)) {
    found.push(hit.index);
    if (found.length >= 16) break;
  }
  return found;
}

/** Round 17's calibrated over-redaction reader, reproduced. */
function hostsNamedBy(text: string): Set<string> {
  const views = new Set<string>([text, text.replace(/[\t\r\n]/g, "")]);
  const absolute = parseAbsolute(text);
  if (absolute) {
    views.add(absolute.href);
    views.add(absolute.pathname);
  }
  const relative = parseRelative(text);
  if (relative) {
    views.add(relative.href);
    views.add(relative.pathname);
  }

  const slices = new Set<string>();
  for (const view of views) {
    slices.add(view);
    for (const at of matchIndexes(view, SCHEME_TOKEN)) slices.add(view.slice(at));
    for (const at of matchIndexes(view, SOLIDUS_PAIR)) {
      if (OWN_DELIMITER.test(view.slice(0, at))) continue;
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

function inventsAHost(input: string): boolean {
  const output = redactUrl(input);
  if (output === input) return false;
  const before = hostsNamedBy(input);
  return [...hostsNamedBy(output)].some((host) => !before.has(host));
}

const CROSS_MARK = [
  "https://",
  "https:/",
  "https:",
  "http://",
  "ftp://",
  "wss://",
  "file://",
  "git://",
  "zz://",
  "//",
  "///",
  "://",
  `${BACKSLASH}${BACKSLASH}`,
  `https:${BACKSLASH}${BACKSLASH}`,
  "a://",
  "1://",
] as const;
const CROSS_USERINFO = ["", ":@", "@", ":x@"] as const;
const CROSS_AUTHORITY = [
  "cdn.test",
  "cdn.test:8443",
  "[::1]",
  "[::1]:443",
  "1.2.3.4",
  "xn--n3h.test",
  "пример.рф",
  "cdn.test:",
  "CDN.TEST",
  "cdn.test.",
] as const;
const CROSS_TAIL = [
  "/x/y",
  "/img/",
  "/",
  "",
  "/x/../y",
  "/@",
  "/@alice",
  "/img/alice@example.com/a.png",
] as const;

describe("the over-redaction crossing — RES-6, RES-7 and round 18's anchor", () => {
  test(
    "every invented host needs an `@` after the embedded authority",
    { timeout: 300_000 },
    () => {
      // RES-6 and RES-7 are two spellings of one precondition: a region that ran
      // past the authority it opened on, and an `@` behind it for the colon rule
      // to read. Crossing the mark spelling, the empty-userinfo axis round 18
      // anchored, a port the parser reads and one it refuses, an IPv6 literal, an
      // IDN label and a case-folded label produces no third shape.
      const outside: string[] = [];
      let condemned = 0;
      for (const middle of ["/proxy/", "/go/"]) {
        for (const mark of CROSS_MARK) {
          for (const userinfo of CROSS_USERINFO) {
            for (const authority of CROSS_AUTHORITY) {
              for (const tail of CROSS_TAIL) {
                const url = `https://api.test${middle}${mark}${userinfo}${authority}${tail}`;
                if (!inventsAHost(url)) continue;
                condemned += 1;
                if (!tail.includes("@")) outside.push(url);
              }
            }
          }
        }
      }
      expect(condemned).toBeGreaterThan(0);
      expect(outside).toEqual([]);
    },
  );
});

/* -------------------------------------------------------------------------- */
/* 6. GATE STRENGTH — the redactor broken, and the suite still green          */
/* -------------------------------------------------------------------------- */

/**
 * Round 18's rule: every gate must be tested by BREAKING what it guards.
 *
 * The redactor is broken here through the seam round 15 found — the module
 * resolves `URL` as a global on every call — so a `URL` subclass installed for
 * ONE synchronous construction makes `slotUserinfos` read an empty userinfo and
 * the needle set come back empty. Nothing in the repository is edited and the
 * mutation lives for one statement.
 *
 * The result is the measurement this lane owes: with a password reaching all
 * seven channels, `leakingChannels` reports NO channel, because the record
 * carries the spelling the parser writes and the sentinel asks for the spelling
 * the caller wrote. This is not filed as a finding — round 18 pinned the same
 * blindness as accepted behaviour on its own row, and a fixture change would
 * turn that pin red — but it is why R19-H3-01 could sit in this tree behind
 * 3,224 green tests.
 */
describe("gate strength — a redactor that emits the userinfo passes every pin", () => {
  test("the mutation is real: the credential survives the message pass", () => {
    const url = "https://svc:hun ter2@api.test:443/v1";
    const message = messageFor("https://svc:hun%20ter2@api.test/v1");
    const RealUrl = globalThis.URL;
    class BlindUrl extends RealUrl {
      override get username(): string {
        return "";
      }
      override set username(value: string) {
        super.username = value;
      }
      override get password(): string {
        return "";
      }
      override set password(value: string) {
        super.password = value;
      }
    }

    // Unmutated, the parser's spelling IS the needle and the pass removes it.
    expect(redactUrlInMessage(message, url)).not.toContain("hun%20ter2");

    let broken: NetworkError;
    globalThis.URL = BlindUrl as unknown as typeof URL;
    try {
      broken = new NetworkError(message, { url });
    } finally {
      globalThis.URL = RealUrl;
    }

    // A password, in the record, on every channel that renders the record.
    expect(broken.message).toContain("hun%20ter2");
    expect(broken.toJSON().message).toContain("hun%20ter2");
    expect(leakingChannels(everyChannel(broken), ["hun%20ter2"]).length).toBeGreaterThan(3);

    // And the judge every disclosure assertion in this repository reaches
    // reports nothing, because it was asked about the caller's spelling.
    expect(leakingChannels(everyChannel(broken), ["hun ter2"])).toEqual([]);
    expect(survivingSpelling(broken.toJSON().message, "hun ter2")).not.toBeNull();
  });
});
