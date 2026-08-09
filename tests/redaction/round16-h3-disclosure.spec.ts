import { describe, expect, test } from "vitest";
import { NetworkError, NotFoundError } from "../../src/errors";
import { redactUrl, redactUrlInMessage } from "../../src/errors/redact-url";
import { everyChannel, leakingChannels } from "../../fixtures/channels";
import { responseWith } from "../../fixtures/responses";

/**
 * ROUND 16, LANE H3 — the generator, not the module.
 *
 * Round 15 H3 returned clean over four million inputs and five generators, and
 * stated the disclosure class is closed structurally. This file does not argue
 * with that. It attacks the instrument instead, on the two axes a clean lane
 * cannot see itself:
 *
 *  1. WHAT THE FIVE GENERATORS CANNOT DRAW. Read, not guessed:
 *
 *     - `redaction-oracle.spec.ts` `buildCorpus`. Every `PATHS` value that
 *       nests a url plants `INNERUSERSENTEE:INNERPASSSENTFF@`, and every
 *       `EMBEDDED` value does too, so the corpus holds NO embedded url whose
 *       authority is complete and whose path carries an ordinary `@` with no
 *       credential anywhere in the input. Its composer also writes at most one
 *       scheme (`${scheme}:${solidi}${userinfo}${host}…`), so no `blob:` or
 *       `data:` payload can spell an authority, and its IDN host is only ever
 *       the OUTER authority.
 *     - `redaction-normalisation-enumeration.spec.ts` `corpus` and
 *       `credentialCorpus`. One alphabet of 60 tokens, concatenated. It can
 *       spell a near neighbour of the shape below, but its three judges are
 *       "no suffix reads as a credential", "fixed point", and "the planted
 *       password is gone" — every one of them is a SURVIVAL judge, so a url
 *       that loses text it should have kept is graded PASS.
 *     - `redaction-protocol-relative.spec.ts`. Its first generator `continue`s
 *       unless `parsed.username`/`parsed.password` contains the secret, so by
 *       construction it cannot draw a credential-free input at all. Its second
 *       generator is credential-free and grades origin, subsequence and value
 *       slots — the OUTER origin only.
 *     - `redaction-region-at-signs.spec.ts` `corpus(20000)`. Grades
 *       "subsequence of origin + pathname" and "never moves the host", where
 *       "the host" is `new URL(url).host`: the outer one.
 *
 *     So no generator plants a host inside a path and then asks whether it came
 *     out again.
 *
 *  2. THE SECOND JUDGE. The round-14 oracle judges credential SURVIVAL, so
 *     OVER-redaction is invisible to it by construction. The judge below reads
 *     the other direction, and it is not the mirror of the first: it does not
 *     ask whether the answer is shorter. It asks whether the answer NAMES A
 *     HOST THE INPUT NEVER NAMED. `redact-url.ts` states the rule this encodes
 *     — "a redaction can move text out of this url, and can never move the HOST
 *     it names: a redaction that lies is worse than one that leaks" — and
 *     round 10 recorded "naming a host the url never named" as the harm half of
 *     a defect, not as a residual.
 *
 * WHAT IS NOT RE-REPORTED. The five residuals of section 2.5 stand: `%40` as an
 * encoded at-sign (RES-2) is pinned below as STILL OPEN and still bounded, not
 * as a finding. `showHidden: true`, `console.dir` with `cause`, the
 * accessor-pollution guard shape and the merge-overlap fix are untouched.
 *
 * A disclosure decision applies to the CHANNEL SET, so every sentinel here goes
 * through `everyChannel` in `fixtures/channels.ts`.
 */

/* -------------------------------------------------------------------------- */
/* THE SECOND JUDGE — over-redaction, read as "which hosts does this name?"    */
/* -------------------------------------------------------------------------- */

/**
 * The judge's own base. Deliberately not the module's: a relative reference
 * resolved against any base with an empty path yields the same `pathname`, so
 * nothing here depends on which reserved host was picked.
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
 * Every url-shaped slice of `text`, in the same four views the round-14 oracle
 * reads: the raw text, the text with the three ignored characters removed, and
 * the `pathname` of the absolute and relative parses.
 *
 * Shared by both halves of this judge on purpose. The host half and the
 * credential half must read the SAME text, or "the output named a host the
 * input did not" could be an artefact of two different readings.
 */
function urlShapedSlices(text: string): Set<string> {
  const views = new Set<string>([text, text.replace(/[\t\r\n]/g, "")]);
  const absolute = parseAbsolute(text);
  if (absolute) views.add(absolute.pathname);
  const relative = parseRelative(text);
  if (relative) views.add(relative.pathname);

  const slices = new Set<string>();
  for (const view of views) {
    slices.add(view);
    for (const at of matchIndexes(view, SCHEME_TOKEN)) slices.add(view.slice(at));
    for (const at of matchIndexes(view, SOLIDUS_PAIR)) slices.add(view.slice(at));
  }
  return slices;
}

/**
 * Every host the PLATFORM reads out of `text`, at any authority it can find.
 *
 * The judge never decides this itself: it hands each url-shaped slice to
 * `new URL` and collects whatever the parser calls `host`. The judge's own base
 * host is dropped, because it is the judge's and not the input's.
 */
function hostsNamedBy(text: string): Set<string> {
  const hosts = new Set<string>();
  for (const slice of urlShapedSlices(text)) {
    const parsed = parseAbsolute(slice) ?? parseRelative(slice);
    if (parsed && parsed.host !== "" && parsed.host !== "judge.invalid") hosts.add(parsed.host);
  }
  return hosts;
}

/** Every credential the platform reports anywhere in `text`. */
function credentialsNamedBy(text: string): string[] {
  const found = new Set<string>();
  for (const slice of urlShapedSlices(text)) {
    const parsed = parseAbsolute(slice) ?? parseRelative(slice);
    if (!parsed) continue;
    for (const value of [parsed.username, parsed.password]) if (value) found.add(value);
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
 * `invented` is the finding. `dropped` is carried beside it because the two
 * together are what make the failure legible: a host that disappears and a host
 * that appears in the same answer is one host being REWRITTEN into another,
 * which is what a reader of the record acts on.
 */
function judgeHosts(input: string): Verdict | null {
  const output = redactUrl(input);
  const before = hostsNamedBy(input);
  const after = hostsNamedBy(output);
  const invented = [...after].filter((host) => !before.has(host));
  if (invented.length === 0) return null;
  return { input, output, invented, dropped: [...before].filter((host) => !after.has(host)) };
}

/** A readable, capped rendering. The count leads: a population is the measure. */
function report(verdicts: readonly Verdict[]): string[] {
  if (verdicts.length === 0) return [];
  return [
    `${verdicts.length} urls named a host they never named; first 3:`,
    ...verdicts
      .slice(0, 3)
      .map(
        (it) =>
          `in=${it.input} out=${it.output} invented=${it.invented.join(",")} dropped=${it.dropped.join(",")}`,
      ),
  ];
}

/* -------------------------------------------------------------------------- */
/* THE CORPUS THE FIVE GENERATORS CANNOT DRAW                                 */
/* -------------------------------------------------------------------------- */

/**
 * A forwarding url whose EMBEDDED authority is one the parser reads completely,
 * followed by a path segment that carries an ordinary `@`.
 *
 * Every value here is well formed. This is an image proxy, a callback, or a
 * signed-forward url — the shapes that carry a target host in a path segment —
 * and not one of them holds a credential the platform can find.
 */
const OUTER = ["https://api.test", "http://api.test:8443", "https://api.test/v1", ""] as const;

/** The embedded url, under each spelling of an authority the parser accepts. */
const EMBEDDED = ["https://cdn.test", "http://cdn.test", "//cdn.test", "ftp://cdn.test"] as const;

/**
 * The target path. Each one holds an `@` that names something rather than
 * delimiting a credential: a gravatar-style mailbox, a handle, an e-mail-shaped
 * segment, and — as the controls — the `@`-at-segment-head spellings the module
 * is documented to keep.
 */
const TAIL = [
  "/img/alice@example.com/avatar.png",
  "/u/bob@example.com",
  "/mail/alice@example.com",
  "/a/b@c/d",
  "/img/@alice",
  "/users/@alice/photo",
] as const;

interface Case {
  input: string;
  tail: string;
}

function buildCorpus(): Case[] {
  const seen = new Map<string, Case>();
  for (const outer of OUTER) {
    for (const embedded of EMBEDDED) {
      for (const tail of TAIL) {
        const input = `${outer}/proxy/${embedded}${tail}`;
        if (!seen.has(input)) seen.set(input, { input, tail });
      }
    }
  }
  return [...seen.values()];
}

const CORPUS = buildCorpus();

/** The one url quoted in the finding, kept as a constant so both tests agree. */
const PROXY_URL = "https://api.test/proxy/https://cdn.test/img/alice@example.com/avatar.png";

/* -------------------------------------------------------------------------- */
/* THE JUDGE CHECKS ITSELF FIRST                                              */
/* -------------------------------------------------------------------------- */

describe("the over-redaction judge, before it grades anything", () => {
  test("the corpus is credential-free, so no row can be excused as a redaction", () => {
    const withCredentials = CORPUS.filter(({ input }) => credentialsNamedBy(input).length > 0);
    expect(withCredentials.map((one) => one.input)).toEqual([]);
    expect(CORPUS.length).toBe(96);
  });

  test("the judge reads hosts from the PLATFORM, in the path as well as the authority", () => {
    expect([...hostsNamedBy(PROXY_URL)].toSorted()).toEqual(["api.test", "cdn.test"]);
    // And it does not invent one out of a mailbox: `example.com` is a host only
    // once something puts an authority mark in front of it.
    expect(hostsNamedBy("https://api.test/mail/alice@example.com").has("example.com")).toBe(false);
  });

  test("the judge CATCHES a redactor that rewrites an embedded host", () => {
    // Graded against a hand-written answer, so the judge is shown to work
    // independently of what the module does today.
    const lying = "https://api.test/proxy/https://example.com/avatar.png";
    expect(hostsNamedBy(lying).has("example.com")).toBe(true);
    expect(hostsNamedBy(PROXY_URL).has("example.com")).toBe(false);
  });

  test("the judge ACQUITS the answers the module is documented to give", () => {
    // Removing a credential is not naming a host: the answer names fewer hosts,
    // never a different one. This is the case the survival judge already grades,
    // and the over-redaction judge must stay silent on it.
    expect(judgeHosts("https://api.test/go/https://svc:hunter2@internal.test/v1")).toBeNull();
    // An opaque url reduced to its scheme names no host at all.
    expect(judgeHosts("blob:https://api.test/550e8400-e29b")).toBeNull();
    expect(judgeHosts("data:text/plain,//alice:hunter2@internal.test/v1")).toBeNull();
    // And a path with nothing to remove is untouched.
    expect(judgeHosts("https://api.test/v1/things")).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* R16-H3-01 — the redaction names a host the url never named                 */
/* -------------------------------------------------------------------------- */

/**
 * WHAT IS WRONG, stated once.
 *
 * `SECURITY.md` says: "A region ends where the parser ends an authority it can
 * read. A region whose start is not an authority the parser can read does not
 * end at all." For `https://api.test/proxy/https://cdn.test/img/alice@example.com/…`
 * the parser CAN read the embedded authority — `new URL("https://cdn.test/")`
 * answers the host `cdn.test` — and it ends it at the first `/`. Under the
 * document's sentence the region is over before the `@` in `alice@example.com`,
 * and nothing is removed.
 *
 * `userinfoSpans` in `./userinfo-spans` ends a region somewhere else: at the
 * next `://`, and at the end of the text when there is none. `parsesAsAuthority`
 * decides only whether that `://` is BELIEVED, never where the authority
 * finished. So the region runs past the embedded host, `looksLikeUserinfo`
 * reads `cdn.test/img/alice` as a credential — no `/`-preceded `@`, so its
 * third rule says yes — and the span takes the host with it.
 *
 * `looksLikeUserinfo` records this as an over-redaction residual and bounds it
 * with one sentence: "It costs a diagnostic on a URL that was already
 * malformed." Both halves of that bound are false here, which is why this is
 * reported rather than restated. The url is well formed under the URL Standard,
 * with a complete authority the parser reads at every level. And the cost is
 * not a lost diagnostic: the record NAMES `example.com` — a host the request
 * never contacted — and drops `cdn.test`, the host it did. `SECURITY.md`'s
 * residual list does not mention it at all.
 *
 * The trigger is remote-chosen. `response.url` after a redirect is the server's
 * text, so a 302 to a proxy url of this shape puts the wrong host into
 * `error.message` and `toJSON().url` of every failure that follows.
 */
/*
 * ADJUDICATED IN ROUND 16, AND THE VERDICT IS A RESIDUAL, NOT A FIX.
 *
 * The finding above is correct about the code. Round 16 F3 built the fix the
 * document's own sentence implies — a region ends where the parser ends an
 * authority it can read — and measured it: it passes all 96 rows of this
 * corpus and leaves 2,425 further planted credentials of 4,375 in the emitted
 * url, up from 750, and turns 33 more tests red. One of them is the exact
 * twin, `redact-url.spec.ts :: "two solidi still reach the base64 credential
 * the single one does not"`. The two inputs spell the same grammar token for
 * token; only one extra `/` inside the middle token separates them, and round
 * 10 recorded that these rules do not count solidi. No structural rule
 * separates them, so removing this over-redaction re-opens a credential leak.
 *
 * The two tests below therefore PIN the residual instead of demanding the fix.
 * They are red when the behavior moves in EITHER direction. A round that makes
 * one of them fail has either closed the residual — in which case delete the
 * pin and the `SECURITY.md` entry together — or widened it.
 */
describe("R16-H3-01 — the embedded-authority over-redaction, pinned as a residual", () => {
  test("the corpus over-redacts exactly the embedded-authority shape, and nothing else", () => {
    const verdicts = CORPUS.map(({ input }) => judgeHosts(input)).filter(
      (verdict): verdict is Verdict => verdict !== null,
    );

    // The count is pinned so a fix cannot shrink it in silence, and a
    // regression cannot grow it in silence.
    expect(verdicts.length).toBe(64);
    // Every row is the one shape, and no row is a credential leak: the judge
    // grades hosts, and the credential half is the CONTROLS block below.
    for (const verdict of verdicts) {
      expect(verdict.invented.length, verdict.input).toBeGreaterThan(0);
      expect(verdict.dropped.length, verdict.input).toBeGreaterThan(0);
    }
    // The documented example, quoted in `SECURITY.md`, exactly as it emits.
    expect(report(verdicts)[1]).toBe(
      "in=https://api.test/proxy/https://cdn.test/img/alice@example.com/avatar.png" +
        " out=https://api.test/proxy/https://example.com/avatar.png" +
        " invented=example.com dropped=cdn.test",
    );
  });

  test("the residual reaches the channel set, and the channel set agrees with itself", async () => {
    const error = new NotFoundError(responseWith(PROXY_URL));
    const rendered = everyChannel(error);

    // The record names a host the request never contacted, and drops the one
    // it did. That is the residual, quoted here so it cannot be rediscovered
    // as news. The disclosure rule that still binds is UNIFORMITY: whatever
    // the record says, every channel says the same, so a later fix cannot
    // close one channel and leave another.
    const record = error.toJSON().url;
    expect(record).toBe("https://api.test/proxy/https://example.com/avatar.png");
    expect(hostsNamedBy(record).has("example.com")).toBe(true);
    expect(hostsNamedBy(record).has("cdn.test")).toBe(false);
    expect(leakingChannels(rendered, ["cdn.test"])).toEqual([]);

    await error.cancel();
  });
});

/**
 * THE CONTROLS. Each one passes today, and each one is what stops the finding
 * above from being read as "redact less".
 */
describe("R16-H3-01 — the controls that bound it", () => {
  test("the same shape carrying a real credential still loses the credential", async () => {
    const url = "https://api.test/proxy/https://TOKENSENTINEL@cdn.test/img/alice@example.com/x";
    const error = new NotFoundError(responseWith(url));

    expect(leakingChannels(everyChannel(error), ["TOKENSENTINEL"])).toEqual([]);

    await error.cancel();
  });

  test("a target path with no `@` at all keeps every host and every segment", () => {
    expect(redactUrl("https://api.test/proxy/https://cdn.test/img/avatar.png")).toBe(
      "https://api.test/proxy/https://cdn.test/img/avatar.png",
    );
  });

  test("the outer host is never moved, which is the half that already holds", () => {
    for (const { input } of CORPUS) {
      const output = redactUrl(input);
      const parsed = parseAbsolute(input);
      if (!parsed) continue;
      expect(new URL(output).host, input).toBe(parsed.host);
    }
  });

  test("the message pass answers with the same hosts the url pass answers with", () => {
    // Stated so a fix cannot close one channel and leave the other: whatever
    // `redactUrl` decides about the embedded host, the message must agree.
    const viaUrl = redactUrl(PROXY_URL);
    const viaMessage = redactUrlInMessage(PROXY_URL, PROXY_URL);
    expect([...hostsNamedBy(viaMessage)].toSorted()).toEqual([...hostsNamedBy(viaUrl)].toSorted());
  });
});

/* -------------------------------------------------------------------------- */
/* THE SHAPES THE ALPHABETS NEVER HELD, DRAWN AND GRADED                      */
/* -------------------------------------------------------------------------- */

const PASSWORD_SENTINEL = "PWSENTINEL9K";

/** Every channel, for one url, asked whether the sentinel survived anywhere. */
async function channelsFor(url: string): Promise<string[]> {
  const error = new NotFoundError(responseWith(url));
  const leaked = leakingChannels(everyChannel(error), [PASSWORD_SENTINEL]);
  await error.cancel();
  return leaked;
}

describe("shapes no generator drew, across the channel SET", () => {
  test.each([
    ["an IDN host with userinfo, absolute", `https://svc:${PASSWORD_SENTINEL}@ünïcode.test/v1`],
    [
      "an IDN host with userinfo, embedded",
      `https://api.test/go/https://svc:${PASSWORD_SENTINEL}@ünïcode.test/v1`,
    ],
    [
      "an already-Punycoded host with userinfo",
      `https://api.test/go/https://svc:${PASSWORD_SENTINEL}@xn--n3h.test/v1`,
    ],
    ["a decimal-IPv4 host the parser rewrites", `https://svc:${PASSWORD_SENTINEL}@2130706433/v1`],
    [
      "a blob: url whose payload spells an authority",
      `blob:https://svc:${PASSWORD_SENTINEL}@h.test/x`,
    ],
    [
      "a data: url whose payload spells an authority",
      `data:text/plain,//svc:${PASSWORD_SENTINEL}@internal.test/v1`,
    ],
    [
      "a data: url whose base64 payload spells one",
      `data:text/plain;base64,Ly9zdmM6${PASSWORD_SENTINEL}QGludGVybmFsLnRlc3Q=`,
    ],
    [
      "an uppercase embedded scheme",
      `https://api.test/go/HTTPS://svc:${PASSWORD_SENTINEL}@h.test/v1`,
    ],
    [
      "a credential the outer query cut in half",
      `https://api.test/go/https://svc:${PASSWORD_SENTINEL}@h.test?x=1`,
    ],
  ])("%s surrenders the credential on every channel", async (_label, url) => {
    expect(await channelsFor(url)).toEqual([]);
  });

  test("a needle that is the WHOLE message empties it rather than leaking it", () => {
    // The one input the MESSAGE property of the round-14 oracle cannot draw: it
    // always prefixes undici's sentence, so the needle is never the whole
    // string. Over-redaction to the empty string is the safe answer here — the
    // caller's message WAS the credential — and the point of drawing it is that
    // no half of it survives.
    const url = `https://svc:${PASSWORD_SENTINEL}@api.test/v1`;
    const error = new NetworkError(`svc:${PASSWORD_SENTINEL}@`, { url });

    expect(error.message).toBe("");
    expect(leakingChannels(everyChannel(error), [PASSWORD_SENTINEL])).toEqual([]);
  });

  test("RES-2 stays exactly where it is: `%40` shields, and one spelling over does not", () => {
    // Pinned as STILL OPEN and still bounded, not reported. A residual that
    // widens by one character turns this red.
    const shielded = `https://api.test/go/https://svc:${PASSWORD_SENTINEL}%40h.test/v1`;
    expect(redactUrl(shielded)).toContain(PASSWORD_SENTINEL);
    // The literal spelling of the same delimiter is removed, so the residual is
    // about the ENCODING and not about the shape.
    expect(
      redactUrl(`https://api.test/go/https://svc:${PASSWORD_SENTINEL}@h.test/v1`),
    ).not.toContain(PASSWORD_SENTINEL);
    // And the document's own bound holds: the shielded spelling is not a url a
    // parser will read at all, so nothing reports a credential in it.
    expect(() => new URL(`https://svc:${PASSWORD_SENTINEL}%40h.test/v1`)).toThrow();
  });
});

/* -------------------------------------------------------------------------- */
/* POLLUTION SHAPES, ACROSS THE CHANNEL SET                                   */
/* -------------------------------------------------------------------------- */

const POLLUTED_URL = "https://alice:POLLUTIONSECRET@api.test/v1?t=POLLUTIONSECRET";

/**
 * Run `body` with one polluting write to `Object.prototype` in place, and take
 * it back afterwards whatever happens.
 *
 * `configurable: true` and `Reflect.deleteProperty`, not `delete o[k]`: the
 * write has to be reversible even when the assertion inside throws, or one red
 * test poisons every file that runs after it in the same worker.
 */
function withPollution(key: PropertyKey, value: unknown, body: () => void): void {
  // oxlint-disable-next-line no-extend-native -- polluting it IS the test
  Object.defineProperty(Object.prototype, key, { value, configurable: true, writable: true });
  try {
    body();
  } finally {
    Reflect.deleteProperty(Object.prototype, key);
  }
}

/**
 * The gadget every polluting write below installs: the disclosure an attacker
 * wants, which is the value's own members rendered out.
 *
 * It reads STRING members only. A gadget that stringified an object member
 * would re-enter itself through the `Symbol.toPrimitive` write and blow the
 * stack, which measures this harness and not the library. The one member that
 * matters here is `url`, and it is a string.
 */
function ownStringMembers(this: object): string {
  return Object.getOwnPropertyNames(this)
    .map((key) => {
      const value = (this as Record<string, unknown>)[key];
      return typeof value === "string" ? `${key}=${value}` : key;
    })
    .join("&");
}

/** The four writes, as `[label, key]`. All four install {@link ownStringMembers}. */
const POLLUTION_KEYS: readonly [string, PropertyKey][] = [
  ["Object.prototype.toJSON", "toJSON"],
  ["Object.prototype[Symbol.toPrimitive]", Symbol.toPrimitive],
  ["the Node inspect symbol on Object.prototype", Symbol.for("nodejs.util.inspect.custom")],
  ["the Deno inspect symbol on Object.prototype", Symbol.for("Deno.customInspect")],
];

describe("prototype pollution cannot open a channel", () => {
  test.each(POLLUTION_KEYS)("%s does not reach any channel", async (_label, key) => {
    const error = new NotFoundError(responseWith(POLLUTED_URL));
    withPollution(key, ownStringMembers, () => {
      expect(leakingChannels(everyChannel(error), ["POLLUTIONSECRET"])).toEqual([]);
    });
    await error.cancel();
  });

  test.each(POLLUTION_KEYS)("%s does not reach a pre-response class either", (_label, key) => {
    // `NetworkError` carries `url` and `cause` by `defineProperty` and owns its
    // own `toJSON`; the question is whether a polluted lookup gets underneath.
    const error = new NetworkError("fetch failed", {
      url: POLLUTED_URL,
      cause: new Error("boom"),
    });
    withPollution(key, ownStringMembers, () => {
      expect(leakingChannels(everyChannel(error), ["POLLUTIONSECRET"])).toEqual([]);
    });
  });
});

/* -------------------------------------------------------------------------- */
/* SET-COOKIE AND AUTHORIZATION, PLANTED ON AN ERROR RESPONSE                 */
/* -------------------------------------------------------------------------- */

const COOKIE_SECRET = "SIDSECRETQ7";
const BEARER_SECRET = "BEARERSECRETQ7";

function responseWithCredentialHeaders(): Response {
  const headers = new Headers();
  headers.append("set-cookie", `sid=${COOKIE_SECRET}; Path=/; HttpOnly`);
  headers.append("set-cookie", `csrf=${COOKIE_SECRET}2; Path=/`);
  headers.append("authorization", `Bearer ${BEARER_SECRET}`);
  headers.append("proxy-authorization", `Basic ${BEARER_SECRET}`);
  headers.append("content-type", "application/json");
  const response = new Response("{}", { status: 404, statusText: "Not Found", headers });
  Object.defineProperty(response, "url", { value: "https://api.test/v1/x", configurable: true });
  return response;
}

describe("names, never values — Set-Cookie and Authorization on an error response", () => {
  test("no channel emits a cookie or a bearer, and every name is still reported", async () => {
    const error = new NotFoundError(responseWithCredentialHeaders());

    expect({
      leaked: leakingChannels(everyChannel(error), [COOKIE_SECRET, BEARER_SECRET]),
      names: error.toJSON().headers,
    }).toEqual({
      leaked: [],
      // One entry per `set-cookie` the server sent, so a repeated header still
      // shows how many times it arrived — the claim `toJSON`'s own comment makes.
      names: ["authorization", "content-type", "proxy-authorization", "set-cookie", "set-cookie"],
    });

    await error.cancel();
  });

  test("a clone() copy answers exactly what the original did", async () => {
    const error = new NotFoundError(responseWithCredentialHeaders());
    const copy = error.clone();

    expect({
      leaked: leakingChannels(everyChannel(copy), [COOKIE_SECRET, BEARER_SECRET]),
      names: copy.toJSON().headers,
    }).toEqual({
      leaked: [],
      names: error.toJSON().headers,
    });

    // `clone()` tees the body, so the two branches must be released TOGETHER:
    // awaiting one and then the other deadlocks on the tee's backpressure.
    await Promise.all([error.cancel(), copy.cancel()]);
  });

  test("the escape hatch still holds every value, and stays off every enumeration", async () => {
    const error = new NotFoundError(responseWithCredentialHeaders());

    expect(error.headers.getSetCookie()).toEqual([
      `sid=${COOKIE_SECRET}; Path=/; HttpOnly`,
      `csrf=${COOKIE_SECRET}2; Path=/`,
    ]);
    expect(error.headers.get("authorization")).toBe(`Bearer ${BEARER_SECRET}`);
    expect(Object.keys(error)).not.toContain("headers");

    await error.cancel();
  });
});
