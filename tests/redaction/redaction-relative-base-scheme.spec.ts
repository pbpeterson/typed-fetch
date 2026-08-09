import { describe, expect, test } from "vitest";
import { typedFetch } from "../../src/index";
import { NetworkError } from "../../src/errors/network-error";
import { NotFoundError } from "../../src/errors/not-found-error";
import { redactUrl, redactUrlInMessage } from "../../src/errors/redact-url";
import { PASSWORD, everyChannel } from "../../fixtures/channels";
import { responseWith } from "../../fixtures/responses";

/**
 * ROUND 13, LANE H3 — disclosure and security.
 *
 * Round 12 replaced five rounds of textual rules with one sentence:
 *
 * > A region opens where the URL Standard opens an authority — at a scheme
 * > colon with its solidi, at two or more solidi with NO scheme, and at the
 * > seam where the parser consumed the mark — and it ends only where `new URL`
 * > reads a complete authority at its start.
 *
 * This lane attacked the SECOND half of that sentence and could not move it.
 * The end question is asked of the parser, and the parser cannot be talked into
 * ending an authority without naming a host: a bounding `://` contains a `/`,
 * so the `@` the parser split the userinfo at is always BELOW the bound, and
 * `looksLikeUserinfo` answers `true` for every `@` that precedes the region's
 * first `/`. A host the parser normalises away from its own text — decimal
 * IPv4, a trailing dot, an IDN label, a percent-encoded byte, IPv6 — shortens
 * the region and still surrenders the credential in front of it. That is pinned
 * below, and it held over 402,648 generated urls judged by an independent
 * parser-derived oracle.
 *
 * The FIRST half is where this round's finding is. "At the seam where the
 * parser consumed the mark" names two seams, and `SECURITY.md` names the same
 * two: a host-less origin's `scheme://`, and the path a protocol-relative
 * reference leaves behind. There is a THIRD, and no rule reaches it.
 *
 * `redactUrl`'s relative branch resolves against `RELATIVE_BASE`, which is
 * `http://url.invalid`. The URL Standard's scheme state sends a reference whose
 * scheme EQUALS the base's special scheme to the special-relative-or-authority
 * state, and from there — with fewer than two solidi — to the relative state.
 * So the parser consumes the `http:` mark and hands back a PATH. The mark that
 * would open a region is gone from the text the scan reads, `parsed.host` is
 * the base's host rather than the empty string, and the reference does not
 * begin with two solidi, so neither consumed-mark rule applies. Nothing opens,
 * and the credential is emitted as path.
 *
 * The bytes are `user:password@host`, spelled under a SPECIAL scheme over fewer
 * than two solidi — which is the one spelling `SECURITY.md` promises by name:
 * "at a SPECIAL scheme (`http`, `https`, `ws`, `wss`, `ftp`, `file`) over any
 * number of solidi, including none".
 */

/**
 * The trigger, in the shape a caller reaches it.
 *
 * A credentialed url under the zero-solidus spelling — the one every
 * slash-collapsing proxy and every `path.join` produces, and the one round 10
 * shipped a critical for — whose port the caller got wrong. `99999` is out of
 * the Standard's range, so `new URL` refuses the whole url, `redactUrl` falls
 * to its relative branch, and the credential rides out inside the path.
 *
 * Nothing here is exotic. The credential is `user:password`, the character
 * before its `@` is a letter, the scheme is special, no delimiter is
 * percent-encoded, and no later `://` cuts the region short. None of the five
 * recorded residuals applies.
 */
const REFUSED_PORT = `http:alice:${PASSWORD}@api.test:99999/v1`;

/**
 * The same credential with a port the parser accepts.
 *
 * This is the control, and it is what makes the row a defect rather than a
 * judgement about what counts as a credential: the module already removes this
 * text, and the platform already calls it userinfo. Two digits of PORT — text
 * that comes AFTER the credential — decide the verdict.
 */
const ACCEPTED_PORT = `http:alice:${PASSWORD}@api.test:8443/v1`;

/** A 404 `Response` whose `url` is the one under test, the way a fetch sets it. */

/* ────────────────────────────────────────────────────────────────────────────
 * R13-H3-01 — the mark a SAME-SCHEME relative reference lets the parser eat.
 * ──────────────────────────────────────────────────────────────────────────── */

describe("R13-H3-01 — a special scheme under fewer than two solidi keeps its credential", () => {
  test("R13-H3-01: no channel carries the credential of a url whose authority the parser refused", async () => {
    // Both halves of the interface reach this. An HTTP error takes its url from
    // `response.url` and puts the REDACTED form in `message`, so every one of
    // the seven channels carries it; a request failure puts it in the
    // `toJSON()` record, which channels 1 and 2 both render.
    const { error: httpError } = await typedFetch("https://api.test/v1", {
      fetch: async () => responseWith(REFUSED_PORT),
    });
    expect(httpError).toBeInstanceOf(NotFoundError);
    await (httpError as NotFoundError).cancel();

    const { error: failure } = await typedFetch(REFUSED_PORT);
    expect(failure).toBeInstanceOf(NetworkError);

    for (const error of [httpError as NotFoundError, failure as NetworkError]) {
      // RESIDUAL 1, APPLIED RATHER THAN RE-OPENED. `structuredClone` copies
      // `error.cause` unchanged — the HTML error serialization steps have no
      // hook — and the platform refused this url by quoting it back whole:
      // `TypeError: Failed to parse URL from http:alice:hunter2@api.test:99999/v1`.
      // So channel 6 carries the password for EVERY credentialed url a platform
      // refuses, redacted or not, and `disclosure-channels.spec.ts` pins that it
      // does ("residual 1: only channels 6 and 7 carry what error.cause
      // quotes"). `SECURITY.md` tells the consumer to remove `cause` before
      // cloning, so the channel is asked here the way the document says to ask
      // it. Nothing else is relaxed: the url this finding is about reaches all
      // seven channels through `message` and the `toJSON()` record, and both are
      // still asserted below, on the SAME error.
      Reflect.deleteProperty(error, "cause");
      for (const [channel, rendered] of Object.entries(everyChannel(error))) {
        expect(rendered, `${error.name}: channel ${channel} emitted the password`).not.toContain(
          PASSWORD,
        );
      }
      // The record is the channel a structured logger keeps, and it is redacted
      // independently of `message`, so it is asserted on its own too.
      expect(
        JSON.stringify(error.toJSON()),
        `${error.name}: toJSON() emitted the password`,
      ).not.toContain(PASSWORD);
    }

    // The control, in the same test so a fix cannot pass by emptying the url.
    // The module already calls these bytes userinfo when the port parses.
    expect(redactUrl(ACCEPTED_PORT)).toBe("http://api.test:8443/v1");
  });

  test("R13-H3-01: the class — a refused authority never resurrects a removed credential", () => {
    // TAIL-INDEPENDENCE, the measure round 11 recorded: text that comes after a
    // credential may not decide whether the credential is removed. Every row
    // below spells ONE credential in the one slot the URL grammar marks as a
    // value, under a SPECIAL scheme over fewer than two solidi — the spelling
    // `SECURITY.md` promises by name — and differs only in the authority tail
    // that follows it. The tails on the left parse; the tails on the right are
    // the ones a caller gets wrong.
    const TAILS = [
      "api.test:8443", // parses
      "api.test", // parses
      "api.test:99999", // port out of range
      "api.test:80a", // port that is not a number
      "api.test:", // trailing colon
      "", // the host a template never filled in
      "ho st", // a space the caller left in
      "[not-ipv6]", // a bracketed host that is not an address
      "api^test", // a forbidden host code point
    ];
    // Zero and one solidus, in every spelling the parser reads as one. Two or
    // more is a different state and is already correct.
    const MARKS = ["http:", "http:/", "http:\\", "HTTP:", "http:\t/"];

    const leaked: string[] = [];
    let urls = 0;
    for (const mark of MARKS) {
      for (const tail of TAILS) {
        for (const suffix of ["/v1", "", "?t=1", "#f"]) {
          const url = `${mark}alice:${PASSWORD}@${tail}${suffix}`;
          urls += 1;
          const emitted = redactUrl(url);
          if (emitted.includes(PASSWORD)) leaked.push(`${url} -> ${emitted}`);
          // The module's OWN second answer about the same input. `userinfosOf`
          // reads the RAW text, finds the `http:` mark the parser ate, and
          // removes `alice:hunter2@` from a message. So the module already
          // holds the verdict; only the value every channel carries disagrees.
          const inMessage = redactUrlInMessage(url, url);
          if (inMessage.includes(PASSWORD)) leaked.push(`message: ${url} -> ${inMessage}`);
        }
      }
    }

    expect(leaked.slice(0, 8)).toEqual([]);
    expect(urls).toBe(180);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * WHAT HELD. Attacked, measured, and pinned so the next round starts past it.
 * ──────────────────────────────────────────────────────────────────────────── */

describe("the end of a region cannot be spelled past, whatever host the parser reads", () => {
  test("a bounding authority the parser NORMALISES still surrenders what precedes it", () => {
    // The end question is `parsesAsAuthority`: does `new URL` read a complete
    // authority at the region's start? The attack is a host whose parsed value
    // is not its own text, so the region ends at a `://` a reader would not
    // call a host boundary. Every one of these shortens the region — and every
    // one still loses the credential that follows, because the shortened region
    // is bounded by a `://` and the next region opens on its own solidi.
    for (const host of [
      "2130706433", // IPv4 in decimal
      "0x7f.1", // IPv4 in hex
      "\u2603.test", // an IDN label the parser punycodes
      "ap%69.test", // a percent-encoded host byte
      "api.test.", // a trailing dot
      "[::1]", // IPv6
      "API.TEST", // a case the parser lowercases
    ]) {
      const url = `https://api.test/go/https://${host}://svc:${PASSWORD}@inner.test/x`;
      expect(redactUrl(url), `a ${host} bound let the credential out`).not.toContain(PASSWORD);
    }
  });

  test("the two consumed-mark seams SECURITY.md names still remove their credential", () => {
    // The host-less origin's `scheme://` seam, and the path a protocol-relative
    // reference leaves behind. Both are round 12's, and both hold.
    expect(redactUrl(`file:///svc:${PASSWORD}@host/v1`)).not.toContain(PASSWORD);
    expect(redactUrl(`//https://svc:${PASSWORD}@internal.test/v1`)).not.toContain(PASSWORD);
    expect(redactUrl(`https://api.test//svc:${PASSWORD}@inner.test/x`)).not.toContain(PASSWORD);
  });

  test("a credential that spells the end mark still goes, at every solidus count", () => {
    // Round 12's own finding, re-asked across the solidus axis rather than at
    // the one spelling it was found in.
    for (const solidi of ["//", "/", "", "///", "\\\\"]) {
      const url = `https://api.test/go/https:${solidi}alice:s3cret://x@internal.test/v1`;
      expect(redactUrl(url), `${solidi.length} solidi kept the credential`).not.toContain("s3cret");
    }
  });
});

describe("the relative branch's resolution loop", () => {
  test("it converges, and its answer never begins with two solidi", () => {
    // "Resolved until re-reading it changes nothing" is a fixed-point loop, and
    // a loop that does not converge hangs the response phase. Each pass hands
    // the text to `new URL`, which consumes the leading solidi AND a non-empty
    // host before it emits a path, so nothing a pass can do grows it. Measured
    // rather than argued, over nested authorities the parser reads back.
    for (const depth of [1, 2, 3, 8, 64, 512]) {
      const nested = "//a".repeat(depth) + `//svc:${PASSWORD}@inner.test/v1`;
      const emitted = redactUrl(nested);
      expect(emitted.startsWith("//"), `depth ${depth} emitted a protocol-relative path`).toBe(
        false,
      );
      expect(emitted, `depth ${depth} kept the credential`).not.toContain(PASSWORD);
      // The post-condition the loop exists for: read back, the answer names no
      // host of its own.
      expect(new URL(emitted, "http://read.invalid").host).toBe("read.invalid");
    }
  });

  test("it is a fixed point of itself on every shape this file drives", () => {
    for (const url of [
      `//https://svc:${PASSWORD}@internal.test/v1`,
      `////svc:${PASSWORD}@internal.test/v1`,
      `\\\\svc:${PASSWORD}@internal.test/v1`,
      `https://api.test/go/https://svc:${PASSWORD}@inner.test/x`,
      `file:///svc:${PASSWORD}@host/v1`,
      "://host1/x://u2:pw@host2/v1",
    ]) {
      const once = redactUrl(url);
      expect(redactUrl(once), `${url} is not a fixed point`).toBe(once);
    }
  });
});

describe("the recorded residuals are still exactly as narrow as SECURITY.md says", () => {
  test("each residual is open on the shape the document names, and closed one character over", () => {
    // A residual that silently WIDENS is the failure this block exists to
    // catch, so each pin asserts both halves.
    const TOKEN = "RESIDUALTOKEN";

    // 1 — a secret in a path segment survives; one slot over it does not.
    expect(redactUrl(`https://api.test/reset/${TOKEN}`)).toContain(TOKEN);
    expect(redactUrl(`https://${TOKEN}@api.test/x`)).not.toContain(TOKEN);

    // 2 — a percent-encoded `@` shields; a percent-encoded scheme colon does not.
    expect(redactUrl(`https://api.test/go/https://svc%3A${TOKEN}%40host/v1`)).toContain(TOKEN);
    expect(redactUrl(`https://api.test/go/https%3A//svc:${TOKEN}@i.test/v1`)).not.toContain(TOKEN);

    // 3 — a non-special scheme under fewer than two solidi keeps its text; one
    // more solidus and the parser sees the credential, so the residual stops.
    expect(redactUrl(`/go/git:/svc:${TOKEN}@host`)).toContain(TOKEN);
    expect(redactUrl(`/go/git://svc:${TOKEN}@host`)).not.toContain(TOKEN);

    // 4 — a credential whose LAST character is a solidus survives; without it
    // the same text goes.
    expect(redactUrl(`https://api.test//${TOKEN}/@inner.test/x`)).toContain(TOKEN);
    expect(redactUrl(`https://api.test//${TOKEN}@inner.test/x`)).not.toContain(TOKEN);

    // 5 — a credential behind text the parser reads as a host survives; the
    // same credential with no host in front of it does not.
    expect(redactUrl(`/go/https://YWxpY2U/${TOKEN}://x@host`)).toContain(TOKEN);
    expect(redactUrl(`/go/https://YWxpY2U:${TOKEN}@host`)).not.toContain(TOKEN);
  });
});

describe("the value slots are dropped whole, over a generated population", () => {
  test("no query or fragment byte is emitted, and no parser-confirmed credential survives", () => {
    // The generator's axes are the URL Standard's, crossed against the host
    // forms round 12's oracle did not spell: decimal and hex IPv4, IDN in both
    // spellings, a trailing dot, a percent-encoded byte, IPv6, and the empty
    // host. Every input here PARSES absolutely, so it exercises the branch
    // R13-H3-01 does not touch — the population is a control for that finding
    // as much as a sweep.
    const QUERY_SECRET = "QUERYSENTINELCC";
    const FRAGMENT_SECRET = "FRAGSENTINELDD";
    const INNER_SECRET = "INNERPASSSENTFF";

    const SCHEMES = ["https", "http", "ws", "wss", "ftp"];
    const HOSTS = [
      "api.test",
      "2130706433",
      "0x7f.1",
      "[::1]",
      "xn--n3h.test",
      "\u2603.test",
      "api.test.",
      "ap%69.test",
    ];
    const PATHS = [
      "/v1",
      `/go/https://svc:${INNER_SECRET}@inner.test/x`,
      `/go/https:/svc:${INNER_SECRET}@inner.test/x`,
      `/go/https:svc:${INNER_SECRET}@inner.test/x`,
      `/deep//svc:${INNER_SECRET}@inner.test/x`,
      `/go/https://2130706433://svc:${INNER_SECRET}@inner.test/x`,
      "/users/@alice",
    ];
    const TAILS = ["", `?t=${QUERY_SECRET}`, `#${FRAGMENT_SECRET}`, `?a=1#${FRAGMENT_SECRET}`];

    const leaked: string[] = [];
    let urls = 0;
    for (const scheme of SCHEMES) {
      for (const host of HOSTS) {
        for (const path of PATHS) {
          for (const tail of TAILS) {
            const url = `${scheme}://svc:${PASSWORD}@${host}${path}${tail}`;
            urls += 1;
            const emitted = redactUrl(url);
            for (const secret of [PASSWORD, QUERY_SECRET, FRAGMENT_SECRET, INNER_SECRET]) {
              if (emitted.includes(secret)) leaked.push(`${secret}: ${url} -> ${emitted}`);
            }
            // The origin may never move: a redaction that lies sends the reader
            // to a server the url never named.
            expect(new URL(emitted).host).toBe(new URL(url).host);
          }
        }
      }
    }

    expect(leaked.slice(0, 8)).toEqual([]);
    expect(urls).toBe(1120);
  });
});
