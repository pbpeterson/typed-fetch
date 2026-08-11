import { describe, expect, test } from "vitest";
import { NetworkError, NotFoundError } from "../../src/errors";
import { redactUrl, redactUrlInMessage } from "../../src/errors/redact-url";
import { everyChannel, leakingChannels } from "../../fixtures/channels";

/**
 * ROUND 20, LANE H3 — THE SPELLING CLASS, WIDENED.
 *
 * Round 19 found R19-H3-01: a password whose RAW spelling differs from the
 * spelling the URL parser writes stayed in `error.message` and in
 * `toJSON().message` and reached all seven channels. The fix taught
 * `userinfosOf` to scan the url's OWN authority in the raw text as well as in
 * the parser's report.
 *
 * THE FIX IS SOUND AND IT IS PARTIAL, and the two halves are measured
 * separately below.
 *
 *  - ON THE OVER-REDACTION AXIS it introduces exactly one new needle, and that
 *    needle is `:@` — see R20-H3-04. Over 16,848 urls crossed with five
 *    quotings apiece the raw head scan removes MORE text on 660 rows and LESS
 *    on none, it names no host the message did not already name, and it opens
 *    no new leak family: the round-19 leak set is a strict superset of the
 *    round-20 one, 9,204 leaking checks down to 2,508.
 *  - ON THE UNDER-REDACTION AXIS it closes the head only where the head opens a
 *    REGION. The head is scanned with `hiddenUserinfos`, which reaches
 *    `userinfoSpans`; a region opens at a scheme colon only where
 *    `isSpecialScheme` reads the token in front of it, and that question
 *    deliberately answers `false` for `file:` and deliberately does not skip
 *    the ASCII tab, CR and LF the parser removes. So for those spellings the
 *    only needle is still the parser's, which is the exact state R19-H3-01
 *    described. R20-H3-01 and R20-H3-02 below.
 *
 * AND THE SEAM WAS NEVER TAUGHT THE RAW SPELLING AT ALL. `seamSpan` reads the
 * parser's `pathname`, where a `\` the caller wrote inside a password has
 * already become a `/`, and `authorityEnd` stops there — so the credential is
 * never found, and `redactUrl` itself emits it. R20-H3-03. That one reaches
 * `toJSON().url`, the record, and not only the message.
 *
 * THE CORPUS. 600 urls in the classification below, 16,848 in the differential
 * this header quotes, and 6,232 in the judge delta. Every leaking row in all
 * three carries a scheme token broken by tab, CR or LF, or a scheme the URL
 * Standard does not call special. No cleanly spelled `http`, `https`, `ws`,
 * `wss` or `ftp` url leaks: round 19's fix holds everywhere it fires.
 *
 * WHAT THIS LANE COULD NOT DRAW: a shape where the platform re-serializes the
 * url into a spelling no `URL` accessor produces, which is the best-effort
 * limit `redactUrlInMessage` states and not a defect; and the `Location`-header
 * route, because no code path hands a second url to the message pass.
 *
 * A disclosure decision applies to the CHANNEL SET, so every sentinel here goes
 * through `everyChannel` in `fixtures/channels.ts`.
 *
 * NOT RE-REPORTED: RES-1 through RES-6, RES-7 (closed by round 19),
 * `showHidden: true`, `console.dir` with `cause`, the accessor-pollution guard
 * shape, a forged brand accepted by design, and `error.cause` carrying the
 * platform's text.
 */

const TAB = String.fromCharCode(9);
const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);
const BACKSLASH = String.fromCharCode(92);

/** The one platform sentence this whole module exists for, with the url in it. */
function messageFor(quoted: string): string {
  return `Request cannot be constructed from a URL that includes credentials: ${quoted}`;
}

/**
 * The message a fetch adapter writes for `url`: the platform never sends a
 * fragment, so it quotes the url with the fragment stripped. That is the first
 * of the three divergent spellings `SECURITY.md` names, and it is what takes
 * the whole-url `replaceAll` out of the picture and leaves the userinfo pass as
 * the only line of defence.
 */
function quotedWithoutFragment(url: string): string {
  const hash = url.indexOf("#");
  return hash < 0 ? url : url.slice(0, hash);
}

/* -------------------------------------------------------------------------- */
/* 1. THE SPELLING-AWARE JUDGE                                                */
/* -------------------------------------------------------------------------- */

/**
 * Every spelling of `secret` a reader recovers without guessing, keyed by the
 * transformation that produces it. Round 19's judge, unchanged, because a delta
 * measured with a different instrument is not a delta.
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
  add("solidus-folded", secret.replaceAll(BACKSLASH, "/"));
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
  test("it names the rewrite on a row the raw judge calls removed", () => {
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
/* 2. R20-H3-01 — `file:` UNDER FEWER THAN TWO SOLIDI                         */
/* -------------------------------------------------------------------------- */

/**
 * `file:/svc:hun ter2@api.test/v1` and `file:///svc:hun ter2@api.test/v1` are
 * ONE url. `new URL` answers `file:///svc:hun%20ter2@api.test/v1` for both, and
 * `redactUrl` answers `file:///api.test/v1` for both — the credential is gone
 * from `toJSON().url` under every spelling.
 *
 * The MESSAGE keeps it under two of the three. Round 19's head scan reaches
 * `userinfoSpans`, and a region opens at a scheme colon under fewer than two
 * solidi only where `isSpecialScheme` accepts the token. `SPECIAL_SCHEMES`
 * excludes `file:` on purpose — the URL Standard gives it a state of its own,
 * and reading a `file:` colon as a mark deleted a segment of a real path. That
 * exclusion is right for a colon found INSIDE a path. It is wrong for the url's
 * OWN scheme colon, which is the one place the parser has already committed to
 * reading the text after it as this url's authority-or-path, and where
 * `seamSpan` goes on to report the credential.
 *
 * So the needle set holds `svc:hun%20ter2@`, the parser's spelling, and nothing
 * else — the state R19-H3-01 named — and a password holding a space, a
 * non-ASCII letter, `|`, `<` or any other character the userinfo encode set
 * touches rides out through all seven channels.
 */
const FILE_SPELLINGS = [
  ["no solidus", `file:svc:%P@api.test/v1#anchor`],
  ["one solidus", `file:/svc:%P@api.test/v1#anchor`],
  ["one backslash", `file:${BACKSLASH}svc:%P@api.test/v1#anchor`],
] as const;

const RESPELLED = ["hun ter2", "hün ter2", "hun<ter2"] as const;

describe("R20-H3-01 — CLOSED: a `file:` url under fewer than two solidi loses its password", () => {
  test("CONTROL: the three-solidus spelling of the same url removes it", () => {
    // Same url, same password, one more solidus: the region opens on the count
    // instead of on the scheme, the head scan finds the raw needle, and the
    // message loses the password. That is what makes the rows below a spelling
    // defect rather than a restatement of the best-effort limit.
    const url = `file:///svc:hun ter2@api.test/v1#anchor`;
    expect(redactUrl(url)).toBe("file:///api.test/v1");
    expect(redactUrlInMessage(messageFor(quotedWithoutFragment(url)), url)).not.toContain(
      "hun ter2",
    );
  });

  test.each(RESPELLED)("the password %j goes under every spelling under two solidi", (password) => {
    const kept: string[] = [];
    for (const [label, template] of FILE_SPELLINGS) {
      const url = template.replace("%P", password);
      // The url channel is clean on every row: this is the message pass alone,
      // so the two records of one failure disagree about the password.
      expect(redactUrl(url)).toBe("file:///api.test/v1");
      const cleaned = redactUrlInMessage(messageFor(quotedWithoutFragment(url)), url);
      if (cleaned.includes(password)) kept.push(label);
    }

    expect(kept, `the userinfo pass kept the password on: ${kept.join(", ")}`).toEqual([]);
  });

  test("and it reaches the record and the whole channel set", () => {
    const password = "hun ter2";
    const url = `file:/svc:${password}@api.test/v1#anchor`;
    const error = new NetworkError(messageFor(quotedWithoutFragment(url)), { url });

    expect(error.toJSON().url).not.toContain(password);
    expect(leakingChannels(everyChannel(error), [password])).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* 3. R20-H3-02 — A SCHEME TOKEN A TAB, CR OR LF BREAKS                       */
/* -------------------------------------------------------------------------- */

/**
 * The URL parser removes every ASCII tab, CR and LF from its input before it
 * parses anything, so `htt<TAB>ps:/svc:hun ter2@api.test/v1` IS
 * `https://svc:hun%20ter2@api.test/v1` — the parser reports the username, the
 * password and the host, and `redactUrl` answers `https://api.test/v1`.
 *
 * `isSpecialScheme` does not skip those three characters, and its own comment
 * says why: it was written to read text a parse had already produced, where
 * they cannot occur, and it records the cost as "a needle, never an emitted
 * url, and it is under-redaction of a message rather than of `url`". Round 19
 * made the url's own head a RAW scan, so that sentence now quantifies over the
 * url's own credential: with fewer than two solidi nothing else opens a region,
 * the raw needle is never found, and the cost is a PASSWORD.
 *
 * Two or more solidi open the region on the count, so those spellings are
 * clean — which is the control below.
 */
const BROKEN_SCHEMES = [
  ["a tab inside the token", `htt${TAB}ps`],
  ["a CR inside the token", `h${CR}ttps`],
  ["an LF before the colon", `https${LF}`],
] as const;

const UNDER_TWO_SOLIDI = ["", "/", BACKSLASH] as const;

describe("R20-H3-02 — CLOSED: a scheme the parser repairs no longer hides the credential", () => {
  test("CONTROL: the same broken token under two solidi loses the password", () => {
    const url = `htt${TAB}ps://svc:hun ter2@api.test/v1#anchor`;
    expect(new URL(url).password).toBe("hun%20ter2");
    expect(redactUrlInMessage(messageFor(quotedWithoutFragment(url)), url)).not.toContain(
      "hun ter2",
    );
  });

  test.each(BROKEN_SCHEMES)("%s loses the password under fewer than two solidi", (_l, scheme) => {
    const password = "hun ter2";
    const kept: string[] = [];
    for (const solidi of UNDER_TWO_SOLIDI) {
      const url = `${scheme}:${solidi}svc:${password}@api.test/v1#anchor`;
      // The parser read the credential, and `redactUrl` removed it.
      expect(new URL(url).password).toBe("hun%20ter2");
      expect(redactUrl(url)).toBe("https://api.test/v1");
      const cleaned = redactUrlInMessage(messageFor(quotedWithoutFragment(url)), url);
      if (cleaned.includes(password)) kept.push(JSON.stringify(solidi));
    }

    expect(kept, `the userinfo pass kept the password at solidi: ${kept.join(", ")}`).toEqual([]);
  });

  test("and it reaches the record and the whole channel set", () => {
    const password = "hun ter2";
    const url = `htt${TAB}ps:/svc:${password}@api.test/v1#anchor`;
    const error = new NetworkError(messageFor(quotedWithoutFragment(url)), { url });

    expect(error.toJSON().url).not.toContain(password);
    expect(leakingChannels(everyChannel(error), [password])).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* 4. R20-H3-03 — THE SEAM, AND A SOLIDUS THE PARSER FOLDED                   */
/* -------------------------------------------------------------------------- */

/**
 * This one is not the message. It is `redactUrl`, and therefore `toJSON().url`,
 * the record a structured logger writes.
 *
 * `file:` has an empty host, so the credential lands in `pathname` and
 * `seamSpan` is what removes it. `seamUserinfoEnd` reads to `authorityEnd` —
 * the first `/`, `\`, `?` or `#` — and takes the last `@` before it. The text
 * it reads is the parser's `pathname`, and `file:` is a SPECIAL scheme, so a
 * `\` the caller wrote inside the password has already been folded into a `/`
 * by the time the seam sees it. The authority therefore "ends" in the middle of
 * the password, there is no `@` before that end, and the whole credential is
 * emitted as path.
 *
 * `redactUrl("file:///svc:hun\ter2@api.test/v1")` is
 * `file:///svc:hun/ter2@api.test/v1`, and the same password written `%5C`
 * instead of `\` is removed in full. One character of the caller's own spelling
 * decides whether the credential reaches every channel, and the spelling the
 * parser rewrote is the one that leaks — which is R19-H3-01's sentence, at the
 * one slot round 19 did not reach.
 *
 * The message inherits it: `redactUrlInMessage` substitutes `redactUrl(url)`
 * for the url, so the replacement text itself carries the password.
 */
const FOLDED = `hun${BACKSLASH}ter2`;
const SEAM_SPELLINGS = [
  ["three solidi", `file:///svc:${FOLDED}@api.test/v1`],
  ["one solidus", `file:/svc:${FOLDED}@api.test/v1`],
  ["a leading backslash", `file:${BACKSLASH}svc:${FOLDED}@api.test/v1`],
] as const;

describe("R20-H3-03 — CLOSED: a `\\` inside a `file:` password leaves `toJSON().url`", () => {
  test("CONTROL: the percent-encoded spelling of the same password is removed", () => {
    expect(redactUrl(`file:///svc:hun%5Cter2@api.test/v1`)).toBe("file:///api.test/v1");
    expect(redactUrl(`file:///svc:hunter2@api.test/v1`)).toBe("file:///api.test/v1");
  });

  test.each(SEAM_SPELLINGS)("%s emits no recoverable spelling of it", (_label, url) => {
    expect(survivingSpelling(redactUrl(url), FOLDED)).toBeNull();
  });

  test("and it reaches the record and the whole channel set", () => {
    const url = `file:///svc:${FOLDED}@api.test/v1`;
    const error = new NetworkError(messageFor(url), { url });

    // The recoverable spelling is `hun/ter2`: the caller wrote `\` and the
    // parser folded it, so a reader who types the url back gets the password.
    expect(error.toJSON().url).not.toContain("hun/ter2");
    expect(leakingChannels(everyChannel(error), ["hun/ter2"])).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* 5. R20-H3-04 — `:@` BECOMES A NEEDLE, AND `replaceAll` IS NOT PICKY        */
/* -------------------------------------------------------------------------- */

/**
 * The over-redaction shape round 19's measurement could not draw, because no
 * generator in this repository plants an EMPTY userinfo on the url's OWN
 * authority.
 *
 * `new URL("https://:@api.test/v1").href` is `https://api.test/v1`: the URL
 * Standard erases an empty userinfo, and both accessors answer the empty
 * string, so before round 19 the needle set held nothing for it. The raw head
 * scan reads `https://:@api.test`, `userinfoSpans` answers the two-character
 * span `:@`, and `hiddenUserinfos` admits it because its only guard is
 * `userinfo.length > 1`.
 *
 * `hiddenUserinfos` states the rule this breaks in its own first paragraph:
 * "`\"@\"` ALONE is not a credential, and it is the one needle that must never
 * reach `replaceAll`. `://@host/x` yields a span of exactly one character, and
 * stripping every `@` from a message deletes e-mail addresses, handles, and
 * anything else the diagnostic was carrying." `:@` is the same non-credential —
 * the parser erases it too — and `withoutUserinfos` now deletes every `:@` in
 * the message.
 */
describe("R20-H3-04 — CLOSED: an empty userinfo is a needle only behind a mark", () => {
  test("CONTROL: the one-character span is still refused", () => {
    const url = "https://@api.test/v1#anchor";
    const message = `${messageFor(quotedWithoutFragment(url))}; handles a@b and c@d`;
    expect(redactUrlInMessage(message, url)).toContain("handles a@b and c@d");
  });

  test("`:@` is deleted from the message wherever it appears", () => {
    const url = "https://:@api.test/v1#anchor";
    const message = `${messageFor(quotedWithoutFragment(url))}; ratio 3:@4; key:@value`;

    // The url itself is redacted, which is correct and not what this asserts.
    const cleaned = redactUrlInMessage(message, url);
    expect(cleaned).toContain("https://api.test/v1");

    // The rest of the platform's diagnostic must survive: `:@` names no
    // credential, and the parser erased it before this module was asked.
    expect(cleaned).toContain("ratio 3:@4");
    expect(cleaned).toContain("key:@value");
  });
});

/* -------------------------------------------------------------------------- */
/* 6. THE CORPUS, CLASSIFIED — the negative result, committed                 */
/* -------------------------------------------------------------------------- */

const SCHEMES = [
  "https",
  "http",
  "ws",
  "wss",
  "ftp",
  "file",
  "git",
  `htt${TAB}ps`,
  `h${CR}ttps`,
  `https${LF}`,
] as const;
const SOLIDI = ["", "/", "//", "///", BACKSLASH, `/${TAB}/`] as const;
const PASSWORDS = [
  "hun ter2",
  "hün ter2",
  "hun|ter2",
  "hunter2",
  `hun${BACKSLASH}ter2`,
  `hun${TAB}ter2`,
] as const;
const HOSTS = ["api.test", "api.test:8443"] as const;
const URL_SPECIAL_SCHEMES = new Set(["http", "https", "ws", "wss", "ftp"]);

type Row = { url: string; password: string; message: string; exact: string };

/**
 * Every generated url that parses, with the two messages a platform writes for
 * it: one quoting the url as the caller wrote it, and one quoting it with the
 * fragment stripped. The two exercise different halves of
 * `redactUrlInMessage` — the first runs the whole-url replacement and the
 * second cannot — and a judge that saw only one of them would report half the
 * module.
 */
function corpus(): Row[] {
  const rows: Row[] = [];
  for (const scheme of SCHEMES)
    for (const solidi of SOLIDI)
      for (const password of PASSWORDS)
        for (const host of HOSTS) {
          const url = `${scheme}:${solidi}svc:${password}@${host}/v1#anchor`;
          try {
            new URL(url);
          } catch {
            continue;
          }
          rows.push({
            url,
            password,
            message: messageFor(quotedWithoutFragment(url)),
            exact: messageFor(url),
          });
        }
  return rows;
}

describe("the corpus, and what every surviving password has in common", () => {
  test("round 19's fix holds for every cleanly spelled special scheme", () => {
    // The claim this lane rests its three findings on: what leaks is never a
    // url whose scheme token the URL Standard reads as special AS WRITTEN. If
    // this row ever fails, a fourth family exists and the three findings above
    // do not describe the class.
    const rows = corpus();
    const unclassified: string[] = [];
    for (const { url, password, message } of rows) {
      if (!redactUrlInMessage(message, url).includes(password)) continue;
      const scheme = url.slice(0, url.indexOf(":"));
      if (/[\t\r\n]/.test(scheme)) continue;
      if (!URL_SPECIAL_SCHEMES.has(scheme)) continue;
      unclassified.push(url);
    }

    expect(rows.length).toBeGreaterThan(500);
    expect(unclassified).toEqual([]);
  });

  test("the spelling-aware judge finds nothing the raw judge misses", () => {
    // The instrument delta this lane owes, over the same corpus. A row the raw
    // judge calls removed and the spelling judge calls present is a leak no
    // sentinel in this repository can see.
    //
    // THE DELTA WAS `["path-encoded"]` AND IS NOW EMPTY. Those rows were
    // R20-H3-03: `seamSpan` read the parser's `pathname`, where a `\` the
    // caller wrote inside a `file:` password has already become a `/`, so the
    // authority "ended" in the middle of the password and the whole credential
    // was emitted as path — invisible to a raw sentinel, because the text it
    // emitted was not the text the caller wrote. `seamUserinfoEnd` now falls
    // back to the path's last `@` where the first segment holds a colon no
    // Windows drive letter wrote, and the rows are gone.
    //
    // THE EMPTY MAP IS THE ASSERTION AND THE TWO COUNTS ARE ITS NON-VACUITY. A
    // corpus that stopped drawing rows, or a redactor that stopped removing
    // anything, would also report an empty map; `rawRemoved` is what refuses
    // both. It is pinned exactly, so a fix that bought this delta by narrowing
    // the corpus turns the test red instead of green.
    const spellingOnly = new Map<string, number>();
    let checks = 0;
    let rawRemoved = 0;
    for (const { url, password, message, exact } of corpus()) {
      for (const quoted of [message, exact]) {
        checks += 1;
        const out = redactUrlInMessage(quoted, url);
        if (out.includes(password)) continue;
        rawRemoved += 1;
        const found = survivingSpelling(out, password);
        if (found === null) continue;
        spellingOnly.set(found.how, (spellingOnly.get(found.how) ?? 0) + 1);
      }
    }

    expect({ checks, rawRemoved, spellingOnly: [...spellingOnly.keys()].sort() }).toEqual({
      // 600 corpus rows, each quoted the two ways a platform quotes a url.
      checks: 1200,
      // 8 of the 1,200 still hold the password in the caller's own spelling.
      // It was 12 until R20-ORCH-01 closed the four `git:` rows — a `\` inside
      // a userinfo the parser reports under a NON-special scheme. The eight
      // that remain are all `file:`, which the URL Standard DOES call special;
      // this spec's own five-name `URL_SPECIAL_SCHEMES` is what excludes it,
      // and `SECURITY.md` records the limit. The raw judge SEES those 8, so
      // they are not this test's subject.
      //
      // `rawRemoved` is a non-vacuity FLOOR on how much the redactor removes,
      // so closing four more credentials must raise it. It is pinned exactly,
      // not as a bound, because a bound stays green while the number falls.
      rawRemoved: 1192,
      // And on none of the 1,188 does any reader-recoverable spelling survive.
      spellingOnly: [],
    });
  });
});

/* -------------------------------------------------------------------------- */
/* 7. POLLUTION AND THE RECORD, RE-RUN AGAINST ROUND 19'S MODULE              */
/* -------------------------------------------------------------------------- */

/**
 * Round 16 drew these four. Round 19 changed `src/errors/redact-url.ts`,
 * `src/errors/userinfo-spans.ts` and `src/errors/request-plan.ts`. Nothing
 * moved, and this is the measurement that says so rather than the assumption.
 */
const POLLUTION_URL = "https://svc:hunter2@api.test/v1";
const NODE_INSPECT = Symbol.for("nodejs.util.inspect.custom");

function withPollution(key: PropertyKey, value: unknown, body: () => void): void {
  Object.defineProperty(Object.prototype, key, { value, configurable: true, writable: true });
  try {
    body();
  } finally {
    Reflect.deleteProperty(Object.prototype, key);
  }
}

describe("pollution and the record, re-run", () => {
  test.each([
    ["Object.prototype.toJSON", "toJSON" as PropertyKey],
    ["Symbol.toPrimitive", Symbol.toPrimitive as PropertyKey],
    ["the prototype-level inspect symbol", NODE_INSPECT as PropertyKey],
  ])("%s reaches no channel", (_label, key) => {
    const leaked: string[] = [];
    withPollution(
      key,
      function (this: { url?: string }): unknown {
        return this.url ?? "";
      },
      () => {
        const error = new NetworkError("request to https://api.test/v1 failed", {
          url: POLLUTION_URL,
        });
        leaked.push(...leakingChannels(everyChannel(error), ["hunter2"]));
      },
    );

    expect(leaked).toEqual([]);
  });

  test("a Set-Cookie and an Authorization NAME survive `clone()` with no value", async () => {
    const headers = new Headers({ "content-type": "application/json" });
    headers.append("set-cookie", "sid=COOKIESENTINEL20; Path=/; HttpOnly");
    headers.append("authorization", "Bearer BEARERSENTINEL20");
    const error = new NotFoundError(new Response("{}", { status: 404, headers }));
    const copy = error.clone();

    expect({
      leaked: leakingChannels(everyChannel(copy), ["COOKIESENTINEL20", "BEARERSENTINEL20"]),
      names: copy.toJSON().headers,
    }).toEqual({ leaked: [], names: error.toJSON().headers });

    await Promise.all([error.cancel(), copy.cancel()]);
  });
});

/* -------------------------------------------------------------------------- */
/* 8. GATE STRENGTH — what the judge can see, and what the corpus never drew   */
/* -------------------------------------------------------------------------- */

/**
 * Round 19's gate-strength result was that the sentinel CLASS is blind: a
 * password reaching all seven channels in the parser's spelling is reported as
 * removed by `leakingChannels`, which asks for the caller's.
 *
 * Round 20's result was the other half, and it is the more uncomfortable one.
 * For R20-H3-01 and R20-H3-02 the judge was NOT blind — `leakingChannels` fired
 * on the caller's own spelling the moment the shape was drawn. Nothing found
 * them for eighteen rounds because no generator in this repository plants a
 * `file:` credential under fewer than two solidi, or a scheme token broken by a
 * character the parser removes. The instrument was adequate and the corpus was
 * not, so a spelling-aware sentinel would not have caught these two.
 *
 * Reverting round 19's head scan in a scratch copy leaves 15 of the 16
 * `tests/redaction` spec files fully green while a password reaches all seven
 * channels; only `round19-h3-disclosure.spec.ts`, written for it, turns red.
 *
 * BOTH SHAPES ARE FIXED, so the first test below can no longer measure the
 * question it was written for: an instrument that reports "no leak" and an
 * instrument that is blind produce the same empty list. It now pins the closure
 * instead, and the second test carries the surviving half of the subject —
 * round 19's result, that a raw-substring sentinel cannot see a secret the
 * redactor re-spelled — on an input the library is right to keep.
 */
describe("gate strength — what a raw sentinel can see, and what it cannot", () => {
  test("the two shapes the generators never drew now reach no channel", () => {
    // WHAT THIS TEST USED TO MEASURE NO LONGER EXISTS. It asked whether
    // `leakingChannels` was BLIND to R20-H3-01 and R20-H3-02 — whether the
    // instrument or the corpus was the reason eighteen rounds missed them — and
    // its answer was that the instrument was adequate: both fired the moment
    // the shape was drawn, so the corpus was at fault. Both shapes are fixed
    // now, `leakingChannels` is correctly silent on both, and the old assertion
    // `blind === []` cannot tell that silence apart from the blindness it was
    // written to rule out. It is the fourth instrument this round that cannot
    // survive its own fix, after R19-H1-02, R19-H4-01 and R20-H4-07's EVIDENCE
    // row.
    //
    // SO IT ASSERTS THE CLOSURE INSTEAD, which is the statement that holds
    // after the fix and the one worth keeping: `ownUserinfo` asks the head
    // question where the parser has already committed to reading an authority,
    // so neither `file:` nor a scheme token a tab breaks hides the url's own
    // credential from the needle set. Both shapes are clean on every channel
    // AND in the record, and the assertion is the whole channel set rather than
    // `error.message`, because a disclosure decision applies to the set.
    const drawn: Array<[string, string]> = [
      ["R20-H3-01", `file:/svc:hun ter2@api.test/v1#anchor`],
      ["R20-H3-02", `htt${TAB}ps:/svc:hun ter2@api.test/v1#anchor`],
    ];
    const leaking: Array<[string, string[]]> = [];
    const records: string[] = [];
    for (const [id, url] of drawn) {
      const error = new NetworkError(messageFor(quotedWithoutFragment(url)), { url });
      records.push(error.toJSON().url);
      const channels = leakingChannels(everyChannel(error), ["hun ter2"]);
      if (channels.length > 0) leaking.push([id, channels]);
    }

    expect({ leaking, records }).toEqual({
      leaking: [],
      // NON-VACUITY, and the reason the record is read here at all: a
      // constructor that stopped recording a url would report no leak either.
      // These are also the two urls' parsed identities — `file:` folds to three
      // solidi, and the parser removes the tab from the scheme token.
      records: ["file:///api.test/v1", "https://api.test/v1"],
    });
  });

  test("a raw sentinel still cannot see a secret the redactor re-spelled", () => {
    // THE SUBJECT THAT SURVIVES ITS OWN FIX, and it is round 19's gate-strength
    // result rather than round 20's: `leakingChannels` asks for the CALLER's
    // spelling, so a password that reaches a channel in the PARSER's spelling
    // is reported as removed. Round 20 closed the two shapes above and this
    // stays true, because it is a property of the sentinel and not of them.
    //
    // THE INPUT THAT STILL DEMONSTRATES IT is a documented residual rather than
    // a defect: `git:` under fewer than two solidi is an opaque path, so the
    // credential is text `redactUrl` must keep — see `SECURITY.md`. That makes
    // it the right specimen. The library is behaving correctly and the sentinel
    // still cannot see what it emitted.
    const url = "https://api.test/go/git:/svc:PW SENT@internal.test/v1";
    const error = new NetworkError(messageFor(url), { url });
    const emitted = redactUrl(url);
    const found = survivingSpelling(emitted, "PW SENT");

    expect({
      // The password is in the record, re-spelled by the parser.
      record: error.toJSON().url,
      spelling: found,
      // The raw judge, asked for what the caller wrote: silent.
      blindTo: leakingChannels(everyChannel(error), ["PW SENT"]),
      // The same judge, asked for what the module actually emitted: 16 of the
      // channel set. That gap IS the finding, and it is why a spelling-aware
      // judge exists in this file at all.
      seesWhenTold: leakingChannels(everyChannel(error), [found?.spelling ?? " "]).length,
    }).toEqual({
      record: "https://api.test/go/git:/svc:PW%20SENT@internal.test/v1",
      spelling: { spelling: "PW%20SENT", how: "path-encoded" },
      blindTo: [],
      seesWhenTold: 16,
    });
  });
});
