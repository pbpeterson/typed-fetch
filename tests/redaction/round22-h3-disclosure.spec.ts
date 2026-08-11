import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { NetworkError } from "../../src/errors";
import { redactUrl, redactUrlInMessage } from "../../src/errors/redact-url";
import { everyChannel, leakingChannels } from "../../fixtures/channels";

/**
 * ROUND 22, LANE H3 — THE SENTINEL THAT WOULD HAVE CAUGHT ALL FOUR.
 *
 * Rounds 20 and 21 each measured the same thing and got a worse number the
 * second time: revert the last disclosure fix in a scratch copy, and almost the
 * whole suite stays green while a password reaches the channel set. This round
 * reverted the last FOUR fixes, one at a time, against the committed suite at
 * `ca3fd78` — 99 spec files, 3,461 tests, all green before each revert.
 *
 *   | reverted                             | spec files red | of 99 |
 *   | ------------------------------------ | -------------- | ----- |
 *   | `ownUserinfo` (R20-H3-01/02)         | 2              | 97 green |
 *   | the raw head region scan (R19-H3-01) | 0              | 99 green |
 *   | the needle cut-back (R21-H3-01)      | 4              | 95 green |
 *   | the opaque-scheme guard (R21-H2-02)  | 2              | 97 green |
 *
 * `disclosure-channels.spec.ts`, `redact-url.spec.ts` and
 * `redaction-oracle.spec.ts` — the channel inventory, the redactor's own suite
 * and the 4,163-row oracle — stayed green through every one of the four.
 *
 * WHY. Four classes, and the fourth is the one nobody had named:
 *
 *  1. THE INVENTORY PLANTS ONE ASCII SECRET IN A URL THE PARSER READS.
 *     `disclosure-channels.spec.ts` renders the channel set three times, always
 *     for `https://alice:hunter2@api.test/v1`, where the caller's spelling and
 *     the parser's are the same string. Every one of the four fixes is about a
 *     spelling where they differ.
 *  2. THE REDACTOR'S SUITE ASSERTS THE RECORD. `redact-url.spec.ts` calls
 *     `redactUrl` 137 times and `redactUrlInMessage` 44, and renders the channel
 *     set never. All four fixes live in the NEEDLE, which is the message route
 *     alone: on every row this lane measured, `redactUrl`'s answer was
 *     byte-identical before and after each revert.
 *  3. A COUNT RATHER THAN A MEMBERSHIP. The oracle's corpus pins
 *     `CORPUS.length` at 4,163 and its confirmations with `toBeGreaterThan`, so
 *     a row that changes answer inside those bounds is invisible.
 *  4. AND THE ONE THAT DECIDES IT — THE MESSAGE QUOTES THE URL VERBATIM.
 *     `redaction-oracle.spec.ts`'s MESSAGE sweep builds
 *     `…credentials: ${input}` from the input itself. `redactUrlInMessage`
 *     replaces the whole url wherever it is quoted BEFORE the needle pass runs,
 *     so on a verbatim quote the needle pass has nothing left to decide. Section
 *     1 measures that directly: on all ten credential rows of the ledger below,
 *     the answer for a verbatim quote is exactly `message.replaceAll(url,
 *     redactUrl(url))`. A platform strips the fragment before it quotes, and the
 *     fragment is what takes the whole-url pass out of the picture.
 *
 * THE SENTINEL IS SECTION 2, and it is one assertion: a LEDGER of twelve rows
 * whose EXACT redacted message and EXACT leaking-channel MEMBERSHIP are pinned
 * together. Each of the four reverts moves at least one row of it, and the two
 * halves of the opaque-scheme guard — which cancel each other out at suite level
 * — move it separately as well:
 *
 *   | reverted                     | ledger rows that move                     |
 *   | ---------------------------- | ----------------------------------------- |
 *   | `ownUserinfo`                | file head space, tab scheme, opaque colon |
 *   | the raw head region scan     | tab solidus                               |
 *   | the needle cut-back          | forward filler                            |
 *   | the seam's scheme guard      | opaque colon, mailto, sip                 |
 *   | the head's authority guard   | mailto, sip                               |
 *
 * A "no secret reached a channel" assertion cannot be that sentinel, and this is
 * the round's second result: two of the four fixes changed no leak at all. Over
 * 38,880 urls the raw head region scan is worth zero leaking rows on top of
 * `ownUserinfo`, and the opaque-scheme guard is worth zero — what they buy is
 * that the pass stops eating a HOST, a mail recipient and a diagnostic. Only a
 * pin on the EXACT text can see a fix whose whole subject is over-redaction.
 *
 * NOT RE-REPORTED: RES-1 through RES-6, RES-7 (closed by round 19), the `file:`
 * seam residual for a `\` inside the password, the opaque bare `name@` limit,
 * the accessor-pollution guard shape, a forged brand accepted by design, and a
 * non-special scheme or `file:` under fewer than two solidi keeping its text.
 */

const BACKSLASH = String.fromCharCode(92);
const TAB = "\t";

/** The one platform sentence this module exists for, with the url in it. */
function messageFor(quoted: string): string {
  return `Request cannot be constructed from a URL that includes credentials: ${quoted}`;
}

/** The platform never sends a fragment, so it quotes the url without one. */
function quotedWithoutFragment(url: string): string {
  const hash = url.indexOf("#");
  return hash < 0 ? url : url.slice(0, hash);
}

/** One error carrying `url`, with the platform's own quoting of it. */
function errorFor(url: string, message: string): NetworkError {
  return new NetworkError(message, { url });
}

/**
 * One ledger row: a url, the message a platform writes about it, and the secret
 * a reader must not recover from any channel.
 *
 * `secret` is the empty string on the two rows whose subject is the other
 * direction — text the pass must NOT remove.
 */
type Row = {
  readonly label: string;
  readonly url: string;
  /** The empty string means "the platform's fragment-stripped quote". */
  readonly message: string;
  readonly secret: string;
};

const ROWS: readonly Row[] = [
  // `ownUserinfo`: a `file:` head under one solidus, and a scheme token an
  // ASCII tab breaks. Neither opens a region, so round 19's region scan finds
  // nothing and only the head question can name the credential.
  {
    label: "file head, space",
    url: `file:svc:hun ter2@api.test/v1#anchor`,
    message: "",
    secret: "hun ter2",
  },
  {
    label: "tab scheme",
    url: `htt${TAB}ps:/svc:hun ter2@api.test/v1#anchor`,
    message: "",
    secret: "hun ter2",
  },
  // The raw head region scan: the parser removes the tab, so the head question
  // answers a span that stops after it and the region scan is the only reader
  // of the two characters the caller wrote in front of the credential.
  {
    label: "tab solidus",
    url: `https:/${TAB}/svc:hunter2@api.test/v1#anchor`,
    message: "",
    secret: "hunter2",
  },
  // The needle cut-back: the span closes past the solidus behind the `@`.
  {
    label: "forward filler",
    url: `https://api.test/go/https://svc:hunter2@/cdn.test/v1#anchor`,
    message: "",
    secret: "hunter2",
  },
  // The opaque-scheme guard, both halves. The head is kept because the caller
  // spelled a colon; the seam is refused because there is no authority slot.
  {
    label: "opaque colon",
    url: `git:svc:hunter2@api.test:8443/go/https://u:hunter2@cdn.test/v1#anchor`,
    message: "",
    secret: "hunter2",
  },
  {
    label: "opaque empty host",
    url: `git:///svc:hunter2@api.test/v1#anchor`,
    message: "",
    secret: "hunter2",
  },
  // The `file:` residual round 20 recorded and round 23 closed, pinned by its
  // channel MEMBERSHIP rather than by a count, so a round that reopens it comes
  // here first. The membership was fourteen renders and is now none.
  {
    label: "file backslash",
    url: `file:///svc:hun${BACKSLASH}ter2@api.test/v1#anchor`,
    message: "",
    secret: `hun${BACKSLASH}ter2`,
  },
  // The other direction: an address the caller never wrote as a credential.
  {
    label: "mailto",
    url: "mailto:alice@example.com",
    message: "could not reach alice@example.com over smtp",
    secret: "",
  },
  {
    label: "sip",
    url: "sip:alice@example.com",
    message: "could not reach alice@example.com over sip",
    secret: "",
  },
  // Three shapes earlier rounds settled, carried so that a fix which trades one
  // of them for a row above has to say so here.
  {
    label: "nested head",
    url: `https://alice@svc:hunter2@api.test/v1#anchor`,
    message: "",
    secret: "hunter2",
  },
  {
    label: "seam file",
    url: `file:///x@./alice:hunter2@internal.test/v1#anchor`,
    message: "",
    secret: "hunter2",
  },
  {
    label: "query slot",
    url: `https://api.test/v1?next=https://u:hunter2@cdn.test/v1#anchor`,
    message: "",
    secret: "hunter2",
  },
];

/** The message a row asks about: its own, or the platform's quote of its url. */
function textOf(row: Row): string {
  return row.message === "" ? messageFor(quotedWithoutFragment(row.url)) : row.message;
}

/* -------------------------------------------------------------------------- */
/* 1. WHY 97 OF 99 FILES COULD STAY GREEN                                     */
/* -------------------------------------------------------------------------- */

describe("the blindness, measured rather than argued", () => {
  test("EVIDENCE: a verbatim quote is decided by the whole-url pass, never by a needle", () => {
    // The fourth class, and the reason the 4,163-row oracle sees none of this.
    // Its MESSAGE sweep quotes the input back verbatim, and `replaceAll` then
    // removes the whole url before `withoutUserinfos` runs — so every needle
    // the last four fixes changed decides nothing on any row of it.
    const decidedByReplaceAll = ROWS.filter((row) => row.secret !== "").map((row) => {
      const verbatim = messageFor(row.url);
      return (
        redactUrlInMessage(verbatim, row.url) === verbatim.replaceAll(row.url, redactUrl(row.url))
      );
    });

    expect(decidedByReplaceAll).toEqual(Array.from({ length: 10 }, () => true));
  });

  test("EVIDENCE: the fragment is what hands the row to the needle pass", () => {
    // One url, two quotes, one character of difference in what the platform
    // wrote — and the second is the only one that asks the question this file
    // exists for. The `#anchor` never reaches the wire, so the message a fetch
    // adapter writes cannot spell the url the caller handed it.
    const url = `https://api.test/go/https://svc:hunter2@/cdn.test/v1#anchor`;

    expect(redactUrlInMessage(messageFor(url), url)).toBe(messageFor(redactUrl(url)));
    expect(redactUrlInMessage(messageFor(quotedWithoutFragment(url)), url)).not.toBe(
      messageFor(quotedWithoutFragment(url)),
    );
  });

  test("EVIDENCE: none of the four fixes moves the record, which is what the redactor's suite asserts", () => {
    // The second class. `redact-url.spec.ts` and `redaction-oracle.spec.ts`
    // judge `redactUrl`. A needle is spent in `redactUrlInMessage` and nowhere
    // else, so a suite that reads the record can be complete and still see no
    // part of the route all four fixes live in.
    const records = ROWS.map((row) => redactUrl(row.url));

    expect(records).toEqual([
      "file:///api.test/v1",
      "https://api.test/v1",
      "https://api.test/v1",
      "https://api.test/go/https://cdn.test/v1",
      "git:",
      "git:",
      "file:///api.test/v1",
      "mailto:",
      "sip:",
      "https://api.test/v1",
      "file:///internal.test/v1",
      "https://api.test/v1",
    ]);
  });
});

/* -------------------------------------------------------------------------- */
/* 2. THE SENTINEL — one ledger, pinned as text and as membership             */
/* -------------------------------------------------------------------------- */

describe("THE SENTINEL — the exact answer, and the exact channels, for twelve rows", () => {
  test("the ledger holds", () => {
    // WHY THIS SHAPE AND NOT "NO SECRET REACHED A CHANNEL". Two of the four
    // fixes this sentinel is written against changed no leak on any of 38,880
    // urls: what they bought is that the pass stops removing a HOST and a mail
    // recipient from a diagnostic. A leak assertion is blind to a fix whose
    // whole subject is over-redaction, and an over-redaction assertion is blind
    // to a leak. The exact text is the one judge that sees both.
    //
    // AND THE CHANNELS ARE A MEMBERSHIP, not a count. `file backslash` was the
    // recorded residual and it named its fourteen renders, so a round that
    // widens the class or narrows it has to move this list.
    //
    // AND ROUND 23 NARROWED IT TO NOTHING. This row survived round 22's own
    // 198-line rewrite of this file unmoved, and it moves now because the
    // behaviour genuinely changed: R23-H2-01 made `hiddenUserinfos` emit a path
    // span AND its segments, so `ter2@` is a needle in the spelling the caller
    // wrote, the message reads `file:///svc:hun\api.test/v1`, and `hun\ter2` is
    // in none of the twenty-two renders. The old needle was the whole span in
    // the PARSER's spelling, `svc:hun/ter2@`, which no quote of the caller's
    // text could match — which is why the fourteen renders existed at all.
    //
    // THE HEAD IS WHAT IS LEFT, and the message is pinned as exact text rather
    // than as "no secret", so `hun\` standing where the password began is
    // visible in this ledger to anyone who reads it. Stop emitting the segments
    // and both halves of this row go back at once: the message to the caller's
    // url verbatim, and the channels to the fourteen named renders.
    const ledger = ROWS.map((row) => {
      const text = textOf(row);
      return {
        label: row.label,
        message: redactUrlInMessage(text, row.url),
        channels:
          row.secret === ""
            ? []
            : leakingChannels(everyChannel(errorFor(row.url, text)), [row.secret]),
      };
    });

    expect(ledger).toEqual([
      {
        label: "file head, space",
        message: messageFor("file:api.test/v1"),
        channels: [],
      },
      {
        label: "tab scheme",
        message: messageFor(`htt${TAB}ps:/api.test/v1`),
        channels: [],
      },
      {
        label: "tab solidus",
        message: messageFor("https:/api.test/v1"),
        channels: [],
      },
      {
        label: "forward filler",
        message: messageFor("https://api.test/go/https:///cdn.test/v1"),
        channels: [],
      },
      {
        label: "opaque colon",
        message: messageFor("git:api.test:8443/go/https://cdn.test/v1"),
        channels: [],
      },
      {
        label: "opaque empty host",
        message: messageFor("git:///api.test/v1"),
        channels: [],
      },
      {
        label: "file backslash",
        message: messageFor(`file:///svc:hun${BACKSLASH}api.test/v1`),
        channels: [],
      },
      {
        label: "mailto",
        message: "could not reach alice@example.com over smtp",
        channels: [],
      },
      {
        label: "sip",
        message: "could not reach alice@example.com over sip",
        channels: [],
      },
      {
        label: "nested head",
        message: messageFor("https://api.test/v1"),
        channels: [],
      },
      {
        label: "seam file",
        message: messageFor("file:///internal.test/v1"),
        channels: [],
      },
      {
        label: "query slot",
        message: messageFor("https://api.test/v1?next=https://cdn.test/v1"),
        channels: [],
      },
    ]);
  });
});

/* -------------------------------------------------------------------------- */
/* 3. WHAT A SPELLING-AWARE JUDGE MUST TAKE, AND WHAT ADOPTING IT COSTS       */
/* -------------------------------------------------------------------------- */

/**
 * `leakingChannels` tests `text.includes(secret)` and nothing else, so it can
 * only ever see the ONE spelling the caller handed it. The class it cannot see
 * is the class this audit keeps finding, so the question is what a judge that
 * could see it needs as its INPUT.
 *
 * IT NEEDS THE URL, NOT ONLY THE SECRET. Every rewrite the pipeline applies is
 * decided by the url rather than by the secret:
 *
 *  - `\` becomes `/` only under one of the URL Standard's six SPECIAL schemes.
 *    `endsAuthority` states that three-way rule, and it is a fact about the
 *    scheme token, which a secret does not carry.
 *  - ASCII tab, CR and LF are removed from the WHOLE input before the parser
 *    reads anything, so where they go is a fact about the url's text.
 *  - Which percent-encode set the secret meets — the userinfo set or the path
 *    set — is decided by the SLOT it lands in, which is a fact about the url's
 *    solidus count and scheme, not about the secret's characters.
 *
 * So the judge is `(rendered, secret, url) => string[]`, and the url-free
 * closure round 21 shipped in `round21-h3-disclosure.spec.ts` is an
 * approximation of it, not the thing.
 *
 * ADOPTION MOVES NO PINNED ANSWER THAT IS `[]`, and that is provable rather
 * than hoped for: the closure always contains the raw spelling, so the wide
 * judge returns a SUPERSET of the raw judge's answer. A pin asserting `[]`
 * either stays `[]` or turns red; it can never slide to a different non-empty
 * value. Measured, by widening `leakingChannels` in `fixtures/channels.ts` with
 * round 21's closure and running the whole suite: 5 tests in 4 files move, and
 * every one of them is a test whose SUBJECT is the raw judge's blindness —
 * `round17`'s two host pins, `round18`'s "a raw sentinel cannot see any of the
 * three", `round19`'s mutation witness and `round20`'s "a raw sentinel still
 * cannot see a secret the redactor re-spelled". Not one `toEqual([])` pin moved.
 */
function spellingsOf(secret: string, url: string): string[] {
  const found = new Set<string>([secret]);
  const add = (text: string): void => {
    if (text.length >= 4) found.add(text);
  };
  // The fold is the SCHEME's, so it is asked of the url.
  const scheme = url.slice(0, url.indexOf(":") + 1).toLowerCase();
  if (["http:", "https:", "ws:", "wss:", "ftp:", "file:"].includes(scheme))
    add(secret.replaceAll(BACKSLASH, "/"));
  // The removal is the whole input's, so it applies whatever the scheme.
  add(secret.replace(/[\t\r\n]/g, ""));
  try {
    add(new URL(`http://s.invalid/${secret}`).pathname.slice(1));
  } catch {
    /* a secret the path state refuses has no path spelling */
  }
  try {
    add(new URL(`http://${secret.replaceAll("@", "")}@s.invalid/`).username);
  } catch {
    /* likewise for the userinfo state */
  }
  return [...found];
}

describe("the spelling-aware judge, and what it would cost to adopt", () => {
  test("EVIDENCE: the raw judge calls a secret removed that the record re-spelled", () => {
    // Calibration before anything rests on it. `redactUrl` keeps this credential
    // as an opaque path and re-spells the space, so the raw spelling is absent
    // and a reader still recovers the secret.
    const url = "https://api.test/go/git:/svc:PW SENT@internal.test/v1";
    const record = redactUrl(url);

    expect(record).not.toContain("PW SENT");
    expect(spellingsOf("PW SENT", url).some((spelling) => record.includes(spelling))).toBe(true);
  });

  test("the wide judge answers a superset, so every `[]` pin can adopt it unchanged", () => {
    // The adoption argument, run over this file's own rows rather than asserted.
    const widened = ROWS.filter((row) => row.secret !== "").map((row) => {
      const text = textOf(row);
      const rendered = everyChannel(errorFor(row.url, text));
      const raw = leakingChannels(rendered, [row.secret]);
      const wide = leakingChannels(rendered, spellingsOf(row.secret, row.url));
      return raw.every((channel) => wide.includes(channel));
    });

    expect(widened).toEqual(Array.from({ length: 10 }, () => true));
  });
});

/* -------------------------------------------------------------------------- */
/* 4. R22-H3-01 — A `file:` SOLIDUS PAIR AN ASCII TAB BREAKS                  */
/* -------------------------------------------------------------------------- */

/**
 * `SECURITY.md` scopes its password claim to a userinfo the parser reads, names
 * the `file:` url as the first shape where it reads none, and then says what is
 * still true there: **"What the pass can still name there is the caller's own
 * spelling, and a `\` inside the password takes even that."** One exception,
 * named.
 *
 * THERE IS A SECOND, AND IT NEEDS NO `\` AT ALL. An ASCII tab, CR or LF between
 * the two solidi of a `file:` url is removed by the parser before it reads
 * anything, so `file:/<TAB>/svc:hunter2@api.test/v1` is parsed as
 * `file://svc:hunter2@api.test/v1` — and a `@` where a file host would be is a
 * parse failure. `userinfosOf` then asks `ownUserinfo` NOTHING, because the head
 * question is asked only where `parseProbe` answered; and the region scan does
 * NOT remove the characters the parser removes, so the text it reads spells one
 * solidus and `file:` opens no region under fewer than two. Round 20's own
 * comment on `userinfosOf` names both halves of that — "which never skip the
 * tab, CR and LF the parser removes from the whole input before it reads
 * anything" — and closed only the half where the parse succeeds.
 *
 * The result is the shape three rounds have each filed as critical, with the
 * record at its most reduced: `redactUrl` answers the documented empty string,
 * so `toJSON().url` is `""` and a reader who checks it sees nothing at all,
 * while `toJSON().message` carries `svc:hunter2@` into every log line.
 *
 * SIX SPELLINGS, and no more: the break must sit BETWEEN the two solidi. A tab
 * in front of the pair leaves two solidi for the region to open on, and the
 * password goes.
 */
const BROKEN_PAIR = ["\t", "\r", "\n"] as const;

describe("R22-H3-01 — a `file:` url whose solidus pair a control character breaks", () => {
  test("EVIDENCE: the same url with the break in front of the pair loses its password", () => {
    // The non-vacuity control and the whole width of the difference: one
    // character moved one place, two answers.
    const url = `file:${TAB}//svc:hunter2@api.test/v1#anchor`;

    expect(() => new URL(url)).toThrow();
    expect(
      leakingChannels(everyChannel(errorFor(url, messageFor(quotedWithoutFragment(url)))), [
        "hunter2",
      ]),
    ).toEqual([]);
  });

  test("the password reaches no channel through a broken solidus pair", () => {
    // All three characters the parser removes from the whole input, because a
    // disclosure decision applies to the class and not to the tab.
    const leaking = BROKEN_PAIR.filter((broken) => {
      const url = `file:/${broken}/svc:hunter2@api.test/v1#anchor`;
      const text = messageFor(quotedWithoutFragment(url));
      return leakingChannels(everyChannel(errorFor(url, text)), ["hunter2"]).length > 0;
    });

    expect(
      leaking,
      "the parser removes the tab, so this url is `file://svc:hunter2@api.test/v1` and it is " +
        "REFUSED — `ownUserinfo` is asked only where the parse answered. The region scan does " +
        "not remove what the parser removes, so it reads one solidus, and `file:` opens no " +
        "region under fewer than two. No needle is derived at all",
    ).toEqual([]);
  });

  test("and `SECURITY.md`'s one named exception does not cover it", () => {
    // The document says the caller's own spelling is what the pass can still
    // name under `file:`, with a `\` inside the password as the single thing
    // that takes it. This password holds no `\`.
    const url = `file:/${TAB}/svc:hunter2@api.test/v1#anchor`;

    expect(url).not.toContain(BACKSLASH);
    expect(redactUrlInMessage(messageFor(quotedWithoutFragment(url)), url)).not.toContain(
      "svc:hunter2@",
    );
  });

  test("and the class is every break spelling, over a grid the record leaves clean", () => {
    // A disclosure decision applies to the class. Eight scheme tokens across
    // all three scheme classes, five solidus spellings, eight delimiters
    // inside the password and five fillers behind the embedded `@` — 3,200
    // rows, none of which carries a `\` or a bare `name@`, so every recorded
    // residual is out of the grid and the answer must be empty.
    //
    // ASKED AS A COORDINATE MEMBERSHIP, not as a row count: a failure names
    // the scheme and the solidus spelling that leaked, which is the pair that
    // has to be argued about.
    const schemes = ["https", "http", "ws", "wss", "ftp", "file", "git", "zz-custom"] as const;
    const solidi = ["", "/", "//", "///", `/${TAB}/`] as const;
    const delimiters = ["", " ", TAB, "|", "é", "%20", "<", "^"] as const;
    const shapes = ["svc:<S>@", "alice@svc:<S>@"] as const;
    const fillers = ["", "/", "//", "./", "%2e/"] as const;

    let rows = 0;
    const leaking = new Set<string>();
    for (const scheme of schemes)
      for (const spelling of solidi)
        for (const delimiter of delimiters) {
          const secret = `hun${delimiter}ter2`;
          for (const shape of shapes)
            for (const filler of fillers) {
              const head = shape.replace("<S>", secret);
              const url = `${scheme}:${spelling}${head}api.test/go/https://u:${secret}@${filler}cdn.test/v1#anchor`;
              const text = messageFor(quotedWithoutFragment(url));
              rows += 1;
              if (leakingChannels(everyChannel(errorFor(url, text)), [secret]).length > 0)
                leaking.add(`${scheme}: + ${JSON.stringify(spelling)}`);
            }
        }

    expect({ rows, leaking: [...leaking].toSorted() }).toEqual({ rows: 3200, leaking: [] });
  }, 60_000); // twenty-two channels of 3,200 urls. // the 5,000 ms default under v8 instrumentation; this one renders the // Stated rather than inherited. Round 21 found a generator 0.6 seconds from
});

/* -------------------------------------------------------------------------- */
/* 5. R22-H3-02 — THE COST THE MODULE NAMES IS NOT THE COST IT PAYS           */
/* -------------------------------------------------------------------------- */

/**
 * `userinfosOf` states the price of round 21's head guard twice, twenty lines
 * apart, and the two sentences name different urls.
 *
 * The first is right: "only the state that has neither — an opaque path whose
 * `@` closes a bare name — gives it up." The second says the cost is "an opaque
 * path spelling a colon and an `@` — `git:svc:pw@h` — whose text stops being a
 * needle", and the guard is `authority || spelled.includes(":")`, so a colon is
 * exactly what KEEPS the needle. `SECURITY.md` agrees with the first sentence
 * and contradicts the second in as many words: "An opaque path that spells a
 * colon is a password the caller wrote, and `git:svc:hunter2@api.test/v1` still
 * loses `svc:hunter2@` from a message that quotes it."
 *
 * READ, NEVER COPIED, which is round 20's rule for a test whose subject is
 * another text: the url below is extracted from the comment, so correcting the
 * comment to name `git:svc@h` is what makes this pass.
 */
describe("R22-H3-02 — the url the module names as the guard's cost", () => {
  const source = readFileSync(new URL("../../src/errors/redact-url.ts", import.meta.url), "utf8");

  /** The urls the "WHAT IT COSTS" paragraph spells between backticks. */
  function namedCost(): string[] {
    const paragraph = /WHAT IT COSTS is an opaque path([\s\S]*?)stops being a needle/.exec(source);
    const spelled = paragraph?.[1] ?? "";
    return [...spelled.matchAll(/`([^`]+)`/g)]
      .map((match) => match[1] ?? "")
      .filter((token) => {
        try {
          return new URL(token).protocol !== "";
        } catch {
          return false;
        }
      });
  }

  test("EVIDENCE: the paragraph names exactly one url", () => {
    expect(namedCost()).toHaveLength(1);
  });

  test("the url it names is a url whose text stops being a needle", () => {
    const url = namedCost()[0] ?? "";

    expect(
      redactUrlInMessage(`the userinfo svc:pw@ was refused`, url),
      "the guard keeps a head needle where the caller spelled a colon, so `git:svc:pw@h` " +
        "still loses its userinfo from a message. The state that gives the needle up is an " +
        "opaque path whose `@` closes a BARE NAME — `git:svc@h` — which is what the same " +
        "function says twenty lines above and what `SECURITY.md` says too",
    ).toBe("the userinfo svc:pw@ was refused");
  });
});
