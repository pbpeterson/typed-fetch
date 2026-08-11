import { describe, expect, test } from "vitest";
import { NetworkError } from "../../src/errors";
import { redactUrl, redactUrlInMessage } from "../../src/errors/redact-url";
import {
  pathScanText,
  pathUserinfoSpans,
  segmentUserinfos,
  type Span,
  userinfoSpans,
} from "../../src/errors/userinfo-spans";
import { everyChannel, leakingChannels, PASSWORD } from "../../fixtures/channels";

// ═══════════════════════════════════════════════════════════════════════════
// ROUND 23 — H2. ONE NEEDLE PER SPAN, AND THE COST OF COMPARING IT.
//
// Round 22 built the first instrument on the MESSAGE route and it found a
// 1024-to-1.7 defect immediately. It also left one sentence unfinished, and
// round 22's own fixer wrote it down as the thing round 23 should read first:
//
//   "a region that opens where none did draws ONE WIDE span, and
//    `hiddenUserinfos` derives one needle per span, so a narrow needle that
//    used to match elsewhere in the message can disappear."
//
// Round 22 measured six such rows out of 227,198 answers and closed them on the
// observation that the RECORD kept the same text on all six, so the message had
// not become less strict than the record. This file asks the question the six
// instances leave open: is the CLASS closed by that observation?
//
// ── 1. R23-H2-01. IT IS NOT, AND THE CLASS DOES NOT NEED ROUND 22'S CHANGE. ─
//
// `hiddenUserinfos` derives exactly one needle per span for every span inside
// `kept`:
//
//   for (const one of span.start < kept ? [span] : segmentUserinfos(text, span))
//
// The `kept` boundary is R17-H3-02 and it is right: past it a span covers a
// HOST in a slot the emitted url drops WHOLE, so splitting is the only reading
// that does not move a host. Inside it, the whole span is taken, and the
// comment states why — "`redactUrl` removes the same text from the url it
// emits, so both records move together".
//
// THE TWO RECORDS MOVE TOGETHER ON THE URL'S OWN QUOTE, AND NOWHERE ELSE. A
// needle is deleted from a message WHEREVER it appears; that is the whole of
// the pass, and it is what R21-H2-02's and R17-H3-02's harms are both stated
// in. So the question a wide span raises is not what happens where the message
// quotes the url — the wide needle matches there — but what happens where the
// message names the EMBEDDED authority a second time, which is what a
// forwarding diagnostic writes.
//
//   url     https://api.test/go/https://b.test/svc:hunter2@i.test/v1
//   record  https://api.test/go/https://i.test/v1          ← the credential GONE
//   message …; the upstream svc:hunter2@i.test was refused  ← the password KEPT
//
// One span, `b.test/svc:hunter2@`, one needle, and `svc:hunter2@` is not a
// needle at all. The url is an ordinary forward with no malformed scheme, no
// control character and no percent-encoding; the record is clean; the password
// reaches `error.message`, `toJSON().message` and every channel that renders
// either. That is the shape rounds 21 and 22 each called the worst one there
// is, reached from the boundary round 22 declined to test.
//
// AND THE FIX IS NOT THE SPLIT. Splitting a path span is what R17-H3-02
// forbids, and correctly: the segments of `alice@sso.test/svc:hunter2@` remove
// `alice@` and `svc:hunter2@` and LEAVE `sso.test/`, so a message would name
// `sso.test` as the host of the forward while `url` names `internal.test` — two
// records of one failure naming different hosts, which is the exact harm the
// boundary exists to prevent. The needle set has to hold BOTH: the whole span,
// which is what keeps the url's own quote answering as the url does, and the
// segments, which are what a second mention can lose. Section 1 measures both
// halves.
//
// ── 2. R23-H2-02. THE SEVENTH INSTRUMENT, BUILT AGAINST THE SIX. ───────────
//
// Six cost instruments now exist: round 16's rebuild count and probe count,
// round 19's `indexOf` distance, round 20's copied and parsed characters, round
// 21's grammar questions, and round 22's copied characters on the message
// route. Ask what a defect would have to grow for ALL SIX to stay flat, and the
// answer is one quantity: a CHARACTER COMPARISON THAT COPIES NOTHING. It
// allocates no slice, invokes no parse, walks no `indexOf`, rebuilds nothing
// and asks the grammar nothing.
//
// That is not a hypothetical quantity. It is where round 22's own fix moved the
// entire cost of the message pass. `withoutUserinfos` used to answer one hash
// lookup per (`@`, needle length) after one copy; it now WALKS the needles that
// share a length and compares each in place:
//
//   for (const needle of needles) if (spellsNeedle(message, start, needle)) …
//
// The comment names that trade — "a walk over the needles that share one
// length, where the copy cost one length" — and settles it with "the walk is
// what has no allocation in it". The needle COUNT is a remote quantity: one
// needle per embedded credential, and `response.url` after a redirect is a text
// the server wrote. So the pass costs the message's `@` count times the needle
// count, both chosen by the same server, and round 22's sweep could not see it
// because that sweep varied the needle LENGTH and held the count at one.
//
// Section 2 sweeps the count. Characters compared per input character:
// 41.6 → 82.4 → 163.9 → 327.0 over an eightfold sweep — a doubling per doubling
// — while round 22's own instrument reads 2.8, 2.8, 2.8, 2.8 on the same rows,
// and wall time inside ONE error construction goes 12 ms → 1,325 ms.
//
// ── 3. THE PASS COUNT, which round 22 called structural and did not test. ──
// ── 4. The grid: round 22's four new conditions crossed with what predates 21.
//
// NOTHING IN SECTION 2 IS A TIME RATIO. It states characters compared per input
// character, with wall time as the cross-check anti-pattern 13 requires of an
// instrument that reports flat.
// ═══════════════════════════════════════════════════════════════════════════

const ORIGIN = "https://api.test";

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

/** The spelling a platform writes: the url as the URL parser serialized it. */
function quotedOf(url: string): string {
  const parsed = parseEither(url);
  return parsed === null ? url : parsed.href;
}

/** The platform never sends a fragment, so it quotes the url without one. */
function withoutFragment(url: string): string {
  const hash = url.indexOf("#");
  return hash < 0 ? url : url.slice(0, hash);
}

// ── 1. R23-H2-01 — one needle per path span, and the second mention ────────

/**
 * A message that quotes the url AND names the embedded target a second time.
 *
 * THE MODEL IS THE AUDIT'S OWN, and it is the one both harms this boundary was
 * built out of are stated in. R17-H3-02: "a message quoting the callback TARGET
 * read `…contacting https://example.com/…`". R21-H2-02: "`…; alice@example.com
 * was refused` became `…; example.com was refused`". Neither is the url quoted
 * whole, and both are what a forwarding diagnostic writes — the request failed
 * at the upstream, so the upstream is what the wording names.
 */
function forwardingMessage(url: string, target: string): string {
  return `TypeError: fetch failed for ${withoutFragment(url)}; the upstream ${target} was refused`;
}

/** The credential and the host the corpus below embeds, as one authority. */
const TARGET = `svc:${PASSWORD}@i.test`;

/**
 * What sits between the mark that OPENS the region and the credential, which is
 * the whole of what decides whether the span is wide.
 *
 * The empty lead is the control: the span is then the credential itself, one
 * segment, and the whole span IS the narrow needle.
 */
const LEADS = [
  "",
  "b.test/",
  "b.test/c/d/",
  "a@b.test/",
  "@./",
  "a@",
  "c@d.test/",
  "@",
  ":@",
  "./",
] as const;

/** The outer shapes, one per region opening and per slot the url route drops. */
const OUTER = [
  (body: string) => `${ORIGIN}/go/https://${body}${TARGET}/v1`,
  (body: string) => `${ORIGIN}/go/https:/${body}${TARGET}/v1`,
  (body: string) => `${ORIGIN}/go//${body}${TARGET}/v1`,
  (body: string) => `${ORIGIN}/go/https://${body}${TARGET}/v1?q=1`,
  (body: string) => `${ORIGIN}/go/https://${body}${TARGET}/v1#f`,
  (body: string) => `file:///${body}${TARGET}/v1`,
  (body: string) => `file:///x@./${body}${TARGET}/v1`,
  (body: string) => `//https:/${body}${TARGET}/v1`,
  (body: string) => `${ORIGIN}/go/https://${body}${TARGET}/v1\\q`,
  (body: string) => `${ORIGIN}/x/${body}${TARGET}/v1`,
] as const;

/**
 * Every userinfo the scanner's OWN answer holds, read narrowly: the segments of
 * each span that end at an `@`.
 *
 * This is the reading R17-H3-02 forbids as a REPLACEMENT for the whole span,
 * and it is used here only as an ORACLE — it names the text a needle could have
 * been cut to, so a row can say "a narrower needle would have removed this"
 * without any planted string being calibrated.
 */
function narrowUserinfos(text: string, spans: readonly Span[]): string[] {
  const found: string[] = [];
  for (const span of spans) {
    for (const one of segmentUserinfos(text, span)) {
      const userinfo = text.slice(one.start, one.end);
      if (userinfo.length > 1) found.push(userinfo);
    }
  }
  return found;
}

/** Every text the scanner reads for one url, in the spelling a message quotes. */
function scannedTexts(url: string): { text: string; spans: Span[] }[] {
  const parsed = parseEither(url);
  if (parsed === null) return [{ text: url, spans: userinfoSpans(url) }];
  const path = parsed.pathname;
  const joined = pathScanText(path, parsed.search + parsed.hash);
  const texts = [{ text: path, spans: userinfoSpans(path) }];
  if (joined !== path) {
    texts.push({ text: joined, spans: pathUserinfoSpans(path, parsed.search + parsed.hash, null) });
  }
  return texts;
}

/** The rows: one url per outer shape and lead, with the target it embeds. */
const ROWS = OUTER.flatMap((outer) => LEADS.map((lead) => ({ url: outer(lead), lead })));

describe("round 23 / H2 — one needle per path span, and the mention the wide needle misses", () => {
  test("R23-H2-01: NON-VACUITY — the class exists, the control is one lead apart", () => {
    // THE CONTROL. With nothing between the mark and the credential the span IS
    // the credential, the needle is narrow, and the second mention loses it.
    const control = `${ORIGIN}/go/https://${TARGET}/v1`;
    expect(redactUrl(control)).not.toContain(PASSWORD);
    expect(forwardingMessage(control, TARGET)).toContain(PASSWORD);
    expect(redactUrlInMessage(forwardingMessage(control, TARGET), control)).not.toContain(PASSWORD);

    // ONE HOST FURTHER ALONG, and the same region draws one WIDE span. The
    // scanner found the credential — this is a defect of the needle the span is
    // cut to, never of the scan.
    const wide = `${ORIGIN}/go/https://b.test/${TARGET}/v1`;
    const path = new URL(wide).pathname;
    expect(userinfoSpans(path).map((span) => path.slice(span.start, span.end))).toEqual([
      `b.test/svc:${PASSWORD}@`,
    ]);
    expect(redactUrl(wide)).not.toContain(PASSWORD);
  });

  test("R23-H2-01: the record drops the credential and the message keeps it", () => {
    // THE LEDGER: exact text, three shapes, one class. Each row is `url`, the
    // record `redactUrl` emits, and the message the pass answers with.
    const rows = [
      `${ORIGIN}/go/https://b.test/${TARGET}/v1`,
      `${ORIGIN}/go/https://alice@sso.test/svc:${PASSWORD}@internal.test/v1`,
      `file:///x@./alice:${PASSWORD}@internal.test/v1`,
    ];
    const targets = [TARGET, `svc:${PASSWORD}@internal.test`, `alice:${PASSWORD}@internal.test`];
    const leaking = rows
      .map((url, index) => ({
        url,
        recordClean: !redactUrl(url).includes(PASSWORD),
        message: redactUrlInMessage(forwardingMessage(url, targets[index]!), url),
      }))
      .filter((row) => row.recordClean && row.message.includes(PASSWORD))
      .map((row) => row.url);
    expect(leaking).toEqual([]);
  });

  test("R23-H2-01: no channel of a NetworkError carries the password", () => {
    // THE PUBLIC SURFACE. `NetworkError`'s message is public API, and a consumer
    // wrapping an adapter passes the platform's own text; the constructor cleans
    // it with `redactUrlInMessage` and `toJSON()` copies the result verbatim.
    const url = `${ORIGIN}/go/https://b.test/${TARGET}/v1`;
    const error = new NetworkError(forwardingMessage(url, TARGET), { url });
    expect(leakingChannels(everyChannel(error), [PASSWORD])).toEqual([]);
    // And the url channel is clean, so the two records of one failure disagree
    // about whether the caller's url carried a credential.
    expect(String(error.toJSON().url).includes(PASSWORD)).toBe(false);
  });

  test("R23-H2-01: over the corpus, no row keeps in the message what the record dropped", () => {
    let answers = 0;
    const leaking: string[] = [];
    for (const row of ROWS) {
      const record = redactUrl(row.url);
      const message = redactUrlInMessage(forwardingMessage(row.url, TARGET), row.url);
      answers += 1;
      // THE ORACLE IS THE SCANNER'S OWN ANSWER. A row counts only where the
      // scanner named the credential — a narrow reading of a span it drew — and
      // where the record dropped it. Neither half is a planted string.
      const narrow = scannedTexts(row.url).flatMap((one) => narrowUserinfos(one.text, one.spans));
      const named = narrow.some((one) => one.includes(PASSWORD) && !record.includes(one));
      if (named && !record.includes(PASSWORD) && message.includes(PASSWORD)) leaking.push(row.url);
    }
    expect({
      answers,
      recordCleanAndMessageKeeps: leaking.length,
      first: leaking[0] ?? null,
    }).toEqual({ answers: ROWS.length, recordCleanAndMessageKeeps: 0, first: null });
  });

  test("R23-H2-01: the split alone is NOT the fix — R17-H3-02's host must not move", () => {
    // THE OTHER HALF, GREEN, and it is what makes the fix "both" rather than
    // "narrow". Removing only the segments of this span would leave `sso.test/`
    // standing in a message while `url` names `internal.test`.
    const url = `${ORIGIN}/go/https://alice@sso.test/svc:${PASSWORD}@internal.test/v1`;
    expect(redactUrl(url)).toBe(`${ORIGIN}/go/https://internal.test/v1`);
    const quoted = `TypeError: fetch failed for ${quotedOf(url)}`;
    expect(redactUrlInMessage(quoted, url)).toBe(
      `TypeError: fetch failed for ${ORIGIN}/go/https://internal.test/v1`,
    );
  });

  test("R23-H2-03: the UNION comment names two needles for one url and the module derives one", () => {
    // `withoutUserinfos`' own comment: "`alice@sso.test/svc:hunter2@` and
    // `alice@` both come out of
    // `https://api.test/go/https://alice@sso.test/svc:hunter2@internal.test/v1`".
    // The first does. The second is the needle this section is about, and the
    // sentence is the module describing behaviour it does not have.
    const url = `${ORIGIN}/go/https://alice@sso.test/svc:${PASSWORD}@internal.test/v1`;
    const derived = (needle: string) =>
      redactUrlInMessage(`left ${needle}example.com right`, url) !==
      `left ${needle}example.com right`;
    expect({
      wide: derived(`alice@sso.test/svc:${PASSWORD}@`),
      narrow: derived("alice@"),
    }).toEqual({ wide: true, narrow: true });
  });
});

// ── 2. R23-H2-02 — the seventh instrument: comparisons that copy nothing ───

/**
 * What one call spends, counted rather than timed.
 *
 * `compares` is the seventh instrument and it is the whole point of this
 * section: a `charCodeAt` read, which is what `spellsNeedle` and `spellsToken`
 * spend and what NO instrument this audit owns has ever counted. `copied`,
 * `slices` and `restarts` are round 22's own three, kept beside it so that a
 * row can say what the sixth instrument reads while the seventh climbs.
 */
function counted(run: () => void) {
  const nativeCharCodeAt = String.prototype.charCodeAt;
  const nativeSlice = String.prototype.slice;
  const nativeIndexOf = String.prototype.indexOf;
  let compares = 0;
  let copied = 0;
  let restarts = 0;
  String.prototype.charCodeAt = function (this: string, at: number) {
    compares += 1;
    return nativeCharCodeAt.call(this, at);
  } as typeof String.prototype.charCodeAt;
  String.prototype.slice = function (this: string, start?: number, end?: number) {
    const answer = nativeSlice.call(this, start, end);
    copied += answer.length;
    return answer;
  } as typeof String.prototype.slice;
  String.prototype.indexOf = function (this: string, search: string, position?: number) {
    const found = nativeIndexOf.call(this, search, position);
    const from = position === undefined ? 0 : Math.max(0, position);
    restarts += (found < 0 ? this.length : found) - from;
    return found;
  } as typeof String.prototype.indexOf;
  const started = performance.now();
  try {
    run();
  } finally {
    String.prototype.charCodeAt = nativeCharCodeAt;
    String.prototype.slice = nativeSlice;
    String.prototype.indexOf = nativeIndexOf;
  }
  return { compares, copied, restarts, elapsed: performance.now() - started };
}

/** The MESSAGE route's own spend, which is the whole call less the url route's. */
function messagePass(message: string, url: string) {
  const whole = counted(() => void redactUrlInMessage(message, url));
  const urlRoute = counted(() => void redactUrl(url));
  return {
    size: message.length + url.length,
    compares: whole.compares - urlRoute.compares,
    copied: whole.copied - urlRoute.copied,
    restarts: whole.restarts - urlRoute.restarts,
    elapsed: whole.elapsed,
  };
}

/**
 * `units` embedded credentials of ONE length, which is one needle each and one
 * `@` each in the message that quotes them.
 *
 * EVERY BYTE IS REMOTE. `response.url` after a redirect is the text a server
 * chose, and the message is the platform's own serialization of it — which is
 * why the trailing `\q` is there: the parser folds it, so the href differs from
 * the input and `replaceAll` cannot take the url out of the message. That is
 * the documented state the userinfo pass is the answer to.
 *
 * ONE LENGTH IS THE POINT. Round 22's sweep varied the needle LENGTH and held
 * the count at one, which is the axis the copy was quadratic in. This holds the
 * length and varies the COUNT, which is the axis the bucket walk is quadratic
 * in — the same two remote quantities, multiplied the other way round.
 */
function sweepRow(units: number) {
  let body = "";
  for (let unit = 0; unit < units; unit += 1) {
    body += `https://u${String(unit).padStart(6, "0")}:${PASSWORD}@h.test/`;
  }
  const url = `${ORIGIN}/go/${body}v1\\q`;
  return messagePass(`TypeError: fetch failed for ${quotedOf(url)}`, url);
}

describe("round 23 / H2 — the seventh instrument, and the quantity the six cannot see", () => {
  test("R23-H2-02: the message pass compares a bounded number of characters per input character", () => {
    const rows = [250, 500, 1000, 2000].map((units) => sweepRow(units));

    // NON-VACUITY, TWICE. The pass really runs on this input — `restarts` is the
    // distance `withoutUserinfos` walks the message with `indexOf("@")`, a
    // quantity no fix to what the loop does per `@` can move.
    expect(rows[0]!.restarts).toBeGreaterThan(rows[0]!.size);
    // AND THE SIXTH INSTRUMENT IS BLIND TO IT. Round 22's reading — characters
    // COPIED per input character — is flat over the very sweep below, so this
    // measures a quantity that one cannot.
    const copyRatios = rows.map((row) => row.copied / row.size);
    expect(copyRatios[3]! / copyRatios[0]!).toBeLessThan(2);

    // THE BOUND. Characters compared per input character, over an eightfold
    // sweep of a count a redirecting server chooses. A reader that spends a
    // constant per character keeps this flat; one whose spend is the product of
    // the message's `@` count and the needle count multiplies it by the sweep.
    const ratios = rows.map((row) => row.compares / row.size);
    const climbing =
      ratios[3]! > 2 * ratios[0]!
        ? [`compares/char: ${ratios.map((ratio) => ratio.toFixed(1)).join(" -> ")}`]
        : [];
    expect(climbing).toEqual([]);
  }, 60_000);

  test("R23-H2-02: wall time is the cross-check a flat reading needs", () => {
    // ANTI-PATTERN 13. Time per character is coarse and it is the only number
    // that sees every quantity, including the ones no counter here reaches.
    const small = sweepRow(250);
    const large = sweepRow(1000);
    const perChar = (row: { elapsed: number; size: number }) => row.elapsed / row.size;
    const climbing =
      perChar(large) > 10 * perChar(small) + 0.01
        ? [`ms/char: ${perChar(small).toFixed(5)} -> ${perChar(large).toFixed(5)}`]
        : [];
    expect(climbing).toEqual([]);
  }, 60_000);

  test("R23-H2-02: the instrument reads the corpus too, and states its bound there", () => {
    // THE ADVERSARIAL CORPUS, GREEN. Every url section 1 crosses, measured
    // against a stated multiple of its own size. The bound is generous — the
    // pass is allowed a constant per character and the needle set is small here
    // — and it is what the sweep above breaks by growing the count.
    const over: string[] = [];
    for (const row of ROWS) {
      const message = forwardingMessage(row.url, TARGET);
      const spend = messagePass(message, row.url);
      if (spend.compares > 64 * spend.size) over.push(row.url);
    }
    expect(over).toEqual([]);
  }, 60_000);
});

// ── 3. The pass count: the url route loops, the message route asks once ────

describe("round 23 / H2 — the pass count, which the two routes cannot spend alike", () => {
  test("R23-H2 pass count: what the rebuild's later passes remove, one ask already named", () => {
    // `cleaned` re-asks the scanner of its OWN rebuilt output, so a userinfo the
    // rebuild UNCOVERS — a dot segment collapsing, a pop joining two texts — is
    // found on a pass the message route never runs. Round 22 called that
    // structural. It is, and the reason is the wide span section 1 is about:
    // the span the FIRST ask draws on the original text already covers the text
    // every later pass removes, so one ask and N passes answer alike for every
    // text a message can quote.
    const rows = [
      `file:///x@./alice:${PASSWORD}@internal.test/v1`,
      `file:///:@./alice:${PASSWORD}@internal.test/v1`,
      `file://\\hunter2-:@/file..@`,
      `${ORIGIN}/go/https://@../cdn.test:8443/svc:${PASSWORD}@i.test/v1`,
      `${ORIGIN}/x//@./@./svc:${PASSWORD}@i.test/v1`,
      `//https:/x@./alice:${PASSWORD}@internal.test/v1`,
    ];
    const kept: string[] = [];
    for (const url of rows) {
      const record = redactUrl(url);
      // Every spelling a platform can quote: the caller's text, the parser's
      // serialization, and each of those with the fragment stripped.
      const quotes = new Set([
        url,
        quotedOf(url),
        withoutFragment(url),
        withoutFragment(quotedOf(url)),
      ]);
      for (const quote of quotes) {
        const cleaned = redactUrlInMessage(`TypeError: fetch failed for ${quote}`, url);
        // A userinfo the URL ROUTE removed, in the spelling this quote holds:
        // the message route has to spend it too, however many passes the url
        // route needed to find it.
        for (const one of scannedTexts(url)) {
          for (const userinfo of narrowUserinfos(one.text, one.spans)) {
            if (record.includes(userinfo)) continue;
            if (quote.includes(userinfo) && cleaned.includes(userinfo)) {
              kept.push(`${url} | ${userinfo}`);
            }
          }
        }
      }
    }
    expect(kept).toEqual([]);
  });

  test("R23-H2 pass count: a userinfo the rebuild INVENTS is in no text a message can quote", () => {
    // THE OTHER DIRECTION, and it is what makes the asymmetry free. The rebuild
    // is a parse, and a parse MOVES text: a `..` pops the segment in front of
    // it, so two texts that were never adjacent become one. The credential that
    // text spells did not exist in the caller's url, in the parser's
    // serialization, or in the path — so no message can be quoting it, and the
    // single ask has nothing to miss.
    const url = `file:///svc:hun@x/../${PASSWORD}@i.test/v1`;
    const invented = `svc:hun${PASSWORD}@`;
    expect(
      [url, quotedOf(url), new URL(url).pathname].filter((one) => one.includes(invented)),
    ).toEqual([]);
    // And the record is clean either way, which is the url route paying for its
    // own extra passes.
    expect(redactUrl(url)).not.toContain(PASSWORD);
  });
});

// ── 4. The grid: round 22's four new conditions crossed with what predates 21

/**
 * ONE FRAGMENT PER CONDITION, chosen so any two or three concatenate into one
 * url. Round 22's grid crossed round 21's changes with what predates round 20;
 * this crosses round 22's FOUR — `pathScanText`, `solidiAt`, `spellsNeedle` and
 * the second `slotUserinfos` read — with everything that predates round 21.
 */
const FRAGMENTS = [
  // solidiAt — a solidus run the parser reads through a stripped character (r22)
  `/\t/svc:${PASSWORD}@h.test/`,
  `https:/\r/svc:${PASSWORD}@h.test/`,
  `file:/\n/svc:${PASSWORD}@h.test/`,
  // pathScanText and the second slotUserinfos read — the cut authority (r22)
  `https://svc:hun<${PASSWORD}`,
  `https://svc:hun{${PASSWORD}`,
  // spellsNeedle — needles that share a length, and one with an interior `@`
  `https://a@b.test/svc:${PASSWORD}@`,
  `https://u1:${PASSWORD}@h1.test/https://u2:${PASSWORD}@h2.test/`,
  // nextAuthority / authorityAt / isSpecialScheme — the region openings (r10, r12)
  `https://svc:${PASSWORD}@h.test/`,
  `https:/svc:${PASSWORD}@h.test/`,
  `https:svc:${PASSWORD}@h.test/`,
  `//svc:${PASSWORD}@h.test/`,
  `://svc:${PASSWORD}@h.test/`,
  `file:/svc:${PASSWORD}@h.test/`,
  // looksLikeUserinfo — its three rules, and the base64 residual (r9, r10, r11)
  "users/@alice/",
  "@scope/pkg/",
  "tok@",
  "YWxpY2U/cGFzc3dvcmQ@h.test/",
  // parsesAsAuthority — a region the parser can read, and one it cannot (r12)
  `https://alice:${PASSWORD}://x@i.test/`,
  // pastFiller and the dot segments (r14, r16)
  "@./",
  "@../",
  "///@../",
  // seamSpan and its drive-letter carve-out (r13)
  "c:/Users/alice@corp/",
  // segmentUserinfos and RES-6 — a span that covers a HOST (r17)
  "cdn.test/u/alice@",
  // the span that ends past its `@`, which is round 21's needle cut
  `https://svc:${PASSWORD}@/`,
  // ordinary path, so a cross can be one condition alone
  "deep/",
] as const;

/** The outer shapes, one per slot and per state the seam question reaches. */
const GRID_OUTER = [
  (body: string) => `${ORIGIN}/x/${body}v1`,
  (body: string) => `${ORIGIN}/x/${body}v1?q=1`,
  (body: string) => `${ORIGIN}/x/${body}v1#f`,
  (body: string) => `https://svc:${PASSWORD}@api.test/x/${body}v1`,
  (body: string) => `file:///x/${body}v1`,
  (body: string) => `//api.test/x/${body}v1`,
  (body: string) => `git://svc:hun\\ter2@api.test/x/${body}v1`,
  (body: string) => `mailto:${body}`,
] as const;

/**
 * The classes of wrong answer one url can produce, asked of the module's own
 * answers so that no planted string has to be calibrated.
 *
 *  - `redactUrl` is a fixed point of itself, never throws, never moves the host.
 *  - EVERY NEEDLE ENDS AT AN `@`, because `withoutUserinfos` tests a message
 *    slice only there.
 *  - EVERY USERINFO THE SCANNER FOUND AND THE RECORD DROPPED LEAVES A MESSAGE
 *    THAT QUOTES THE URL.
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
  const wanted: string[] = [];
  for (const one of scannedTexts(url)) {
    for (const span of one.spans) {
      const needle = one.text.slice(span.start, span.end);
      if (needle.length > 1 && !needle.endsWith("@")) bad.add("unmatchable-needle");
    }
    for (const userinfo of narrowUserinfos(one.text, one.spans)) {
      if (!redacted.includes(userinfo)) wanted.push(userinfo);
    }
  }
  if (wanted.length > 0) {
    const quote = withoutFragment(quotedOf(url));
    answers.n += 1;
    let out = "";
    try {
      out = redactUrlInMessage(`boom ${quote} boom`, url);
    } catch {
      bad.add("throw:message");
    }
    for (const userinfo of wanted) {
      if (quote.includes(userinfo) && out.includes(userinfo)) bad.add("unspent-needle");
    }
  }
  return bad;
}

describe("round 23 / H2 — the grid, round 22's four conditions crossed with what predates 21", () => {
  test("R23-H2 grid: no interaction produces a class its parts do not", () => {
    const answers = { n: 0 };
    const solo = new Map<string, Set<string>>();
    for (const [index] of GRID_OUTER.entries()) {
      for (const fragment of FRAGMENTS) {
        solo.set(`${index}|${fragment}`, classesOf(GRID_OUTER[index]!(fragment), answers));
      }
    }
    const unknown = new Set<string>();
    // TWO CLASSES THE CROSS IS ALLOWED TO ADD. `unmatchable-needle` is the
    // difference round 21 SETTLED and did not close: a span is a position and
    // closes past the filler behind its `@`, and only the needle cut from it has
    // to end at one. `unspent-needle` is section 1's own finding, reached here on
    // the url's own quote rather than on a second mention — one shape does it,
    // `git://svc:hun\ter2@api.test/x/…/https://a@b.test/svc:hunter2@v1`, where
    // `redactUrl` reduces an opaque-payload scheme to `git:` and the message
    // keeps the embedded credential the wide span never cut a narrow needle from.
    const known = new Set(["unmatchable-needle", "unspent-needle"]);
    let urls = solo.size;
    const cross = (index: number, parts: readonly string[]) => {
      urls += 1;
      const found = classesOf(GRID_OUTER[index]!(parts.join("")), answers);
      const base = new Set(parts.flatMap((part) => [...solo.get(`${index}|${part}`)!]));
      for (const one of found) if (!base.has(one) && !known.has(one)) unknown.add(one);
    };
    for (const index of GRID_OUTER.keys()) {
      for (const a of FRAGMENTS) for (const b of FRAGMENTS) cross(index, [a, b]);
    }
    for (const a of FRAGMENTS) {
      for (const b of FRAGMENTS) for (const c of FRAGMENTS) cross(0, [a, b, c]);
    }
    // NON-VACUITY: the grid is the size it claims, and it read that many answers
    // out of the module.
    expect(urls).toBe(8 * 25 + 8 * 25 * 25 + 25 * 25 * 25);
    expect(answers.n).toBeGreaterThan(40_000);
    expect([...unknown]).toEqual([]);
  }, 120_000);
});
