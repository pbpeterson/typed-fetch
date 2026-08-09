import { describe, expect, test } from "vitest";
import { typedFetch } from "./src/index";
import { NetworkError } from "./src/errors/network-error";
import { NotFoundError } from "./src/errors/not-found-error";
import { redactUrl, redactUrlInMessage } from "./src/errors/redact-url";
import { PASSWORD, everyChannel } from "./fixtures/channels";
import { responseWith } from "./fixtures/responses";

/**
 * ROUND 14, LANE H3 — disclosure and security.
 *
 * Round 13 made the module's contract one sentence:
 *
 * > When a parse the module leans on THROWS, the span is removed anyway. A
 * > parse that SUCCEEDS and names no credential is a different answer and is
 * > still believed.
 *
 * This lane attacked the believed half and could not move it — every input
 * where the confirming parse succeeds and reports no credential turns out to
 * hold an EMPTY userinfo, which is the one thing an `@` can precede and not be
 * a secret. That is measured below rather than argued.
 *
 * The finding is in the other half of round 13's sentence: WHICH text the
 * module hands to the parser at all. `bringsOwnAuthority` is the module's own
 * answer to "did the parser eat the mark this reference wrote", and it walks
 * the RAW input from index 0, skipping only the three characters
 * {@link isIgnored} names — ASCII tab, CR, and LF. The URL parser removes more
 * than those. Before any state of its machine reads a character it strips every
 * LEADING C0 control or space, so a single space in front of a url moves the
 * scheme out from under the module's walk while leaving it exactly where the
 * parser finds it. The two texts disagree again — the defect rounds 5, 8, 9 and
 * 13 each found under a different name — and round 13's own critical comes back
 * whole, one keystroke away from the spelling that closed it.
 */

/**
 * A leading character the URL parser strips: U+0020 SPACE.
 *
 * Nothing about it is exotic. It is what a base url read from an environment
 * variable, a YAML scalar, a `.env` line, or a pasted config value carries, and
 * the platform accepts it silently — `fetch(" https://api.test/v1")` requests
 * `https://api.test/v1`, because the parser removed the space before reading
 * anything. So the caller never learns the character was there.
 */
const LEAD = " ";

/**
 * The trigger, in the shape a caller reaches it.
 *
 * This is round 13's own trigger with {@link LEAD} in front of it: a credential
 * under a SPECIAL scheme over fewer than two solidi — the spelling `SECURITY.md`
 * promises by name — whose port the caller got wrong, so the absolute parse
 * refuses and `redactUrl` falls to its relative branch.
 */
const LED_REFUSED_PORT = `${LEAD}http:alice:${PASSWORD}@api.test:99999/v1`;

/**
 * The same url with the leading space removed.
 *
 * This is the control, and it is what makes the row a defect rather than a
 * judgement about what counts as a credential: round 13 closed this exact text,
 * and the suite pins it closed. One character of text the parser DISCARDS
 * decides the verdict.
 */
const REFUSED_PORT = `http:alice:${PASSWORD}@api.test:99999/v1`;

/** A 404 `Response` whose `url` is the one under test, the way a fetch sets it. */

/* ────────────────────────────────────────────────────────────────────────────
 * R14-H3-01 — a leading character the parser STRIPS moves the mark out from
 * under the module's own walk.
 * ──────────────────────────────────────────────────────────────────────────── */

describe("R14-H3-01 — text the URL parser discards decides whether a credential is removed", () => {
  test("R14-H3-01: no channel carries the credential of a url that carries a leading space", async () => {
    // Both halves of the interface reach this. An HTTP error takes its url from
    // `response.url` and puts the REDACTED form in `message`, so all seven
    // channels carry it; a request failure puts it in the `toJSON()` record,
    // which channels 1 and 2 both render.
    const { error: httpError } = await typedFetch("https://api.test/v1", {
      fetch: async () => responseWith(LED_REFUSED_PORT),
    });
    expect(httpError).toBeInstanceOf(NotFoundError);
    await (httpError as NotFoundError).cancel();

    const { error: failure } = await typedFetch(LED_REFUSED_PORT);
    expect(failure).toBeInstanceOf(NetworkError);

    for (const error of [httpError as NotFoundError, failure as NetworkError]) {
      // RESIDUAL 1, APPLIED RATHER THAN RE-OPENED, exactly as round 13 applied
      // it. `structuredClone` copies `error.cause` unchanged, and the platform
      // refused this url by quoting it back whole, so channel 6 carries the
      // password for EVERY credentialed url a platform refuses.
      // `disclosure-channels.spec.ts` pins that it does, and `SECURITY.md` tells
      // the consumer to remove `cause` before cloning — so the channel is asked
      // here the way the document says to ask it. Nothing else is relaxed.
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
    // Round 13 closed this text; only the leading space is new.
    expect(redactUrl(REFUSED_PORT)).toBe("/api.test:99999/v1");
  });

  test("R14-H3-01: the class — a discarded leading character never resurrects a credential", () => {
    // HEAD-INDEPENDENCE, which is the same measure round 11 recorded for tails
    // read from the other end: text the parser THROWS AWAY before it reads
    // anything may not decide whether a credential is removed. Every row spells
    // ONE credential under a SPECIAL scheme over fewer than two solidi — the
    // spelling `SECURITY.md` promises by name — and each is asserted twice: the
    // bare form, which round 13 closed, and the same bytes behind a lead the
    // URL Standard strips.
    const LEADS = [
      " ", // U+0020 SPACE
      "  ",
      String.fromCharCode(0), // U+0000, the C0 range's floor
      String.fromCharCode(11), // U+000B VERTICAL TAB
      String.fromCharCode(12), // U+000C FORM FEED
      String.fromCharCode(31), // U+001F, the C0 range's ceiling
      " \t ", // a stripped space, a removed tab, a stripped space
      "\t ", // the removal runs first, so the space is still leading
    ];
    // Zero and one solidus, in every spelling the parser reads as one. Two or
    // more solidi are a different state, and the parser reports the credential
    // itself there.
    const MARKS = ["http:", "http:/", "http:\\", "HTTP:", "hTtP:"];
    // The authority tails a caller gets wrong. Each makes the ABSOLUTE parse
    // refuse, which is what sends the url to the relative branch at all.
    const TAILS = ["api.test:99999", "", "ho st", "[not-ipv6]", "api^test"];
    const SUFFIXES = ["/v1", "", "?t=1", "#f"];

    const leaked: string[] = [];
    const controlsThatLeak: string[] = [];
    let urls = 0;
    for (const mark of MARKS) {
      for (const tail of TAILS) {
        for (const suffix of SUFFIXES) {
          const bare = `${mark}alice:${PASSWORD}@${tail}${suffix}`;
          // The control: round 13 closed this, in `url` and in a message alike.
          if (redactUrl(bare).includes(PASSWORD)) controlsThatLeak.push(bare);
          for (const lead of LEADS) {
            const url = lead + bare;
            urls += 1;
            const emitted = redactUrl(url);
            if (emitted.includes(PASSWORD)) leaked.push(`${JSON.stringify(url)} -> ${emitted}`);
          }
        }
      }
    }

    // Non-vacuity: the controls must all be clean, or the rows above are
    // measuring round 13's defect rather than this one.
    expect(controlsThatLeak).toEqual([]);
    expect(leaked.slice(0, 6)).toEqual([]);
    expect(urls).toBe(800);
  });

  test("R14-H3-01: the message pass leaks the same credential from the same shape", () => {
    // `redactUrlInMessage` is the second reader of the same answer, and it fails
    // the same way for a subset of the shape: `redactUrl` returns text that
    // still holds the credential, so the replacement writes the credential INTO
    // a message that quoted the raw url, and the raw needle the userinfo pass
    // builds ends in a solidus rather than in the `@` that pass matches on.
    const url = `${LEAD}http:alice:${PASSWORD}@/v1`;
    const message = `Failed to parse URL from ${url}`;
    expect(redactUrlInMessage(message, url)).not.toContain(PASSWORD);
    // The control: without the lead the same message is already clean.
    const bare = `http:alice:${PASSWORD}@/v1`;
    expect(redactUrlInMessage(`Failed to parse URL from ${bare}`, bare)).not.toContain(PASSWORD);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * WHAT HELD. Attacked, measured, and pinned so the next round starts past it.
 * ──────────────────────────────────────────────────────────────────────────── */

describe("the believed half of round 13's rule cannot hide a credential", () => {
  test("a confirming parse that names no credential is always an EMPTY userinfo", () => {
    // The asymmetry, stated as a property and measured rather than argued.
    // The seam's confirming parse is `new URL("https://" + authority + "/")`,
    // and the module believes a SUCCESS that reports no username and no
    // password. For that answer to hide a secret, some text before an `@` would
    // have to survive a successful parse without becoming userinfo — and no
    // such text exists: the parser splits userinfo at the LAST `@` before the
    // authority ends, so any byte in front of that `@` IS the userinfo it
    // reports. The only authority holding an `@` and reporting neither field is
    // one whose userinfo is empty.
    //
    // Driven through the seam that asks the question — a host-less `file:`
    // origin — so the property is measured where the module actually relies on
    // it.
    const kept: string[] = [];
    const dropped: string[] = [];
    for (const userinfo of [
      "", // the empty userinfo: believed, and there is nothing to hide
      "alice",
      `alice:${PASSWORD}`,
      `:${PASSWORD}`,
      `alice:${PASSWORD}@x`,
      `${PASSWORD}`,
      "%40",
      `a%3Ab:${PASSWORD}`,
    ]) {
      const url = `file:///${userinfo}@api.test/v1`;
      const emitted = redactUrl(url);
      (emitted.includes("@") ? kept : dropped).push(userinfo);
      // Whatever the verdict on the `@`, the secret itself never survives
      // unless the userinfo is empty and therefore holds none.
      if (userinfo !== "") {
        expect(emitted, `${url} kept its userinfo`).not.toContain(PASSWORD);
      }
    }
    // Exactly one shape is believed, and it is the one that carries nothing.
    expect(kept).toEqual([""]);
    expect(dropped.length).toBe(7);
  });

  test("a parse that succeeds and names a host still surrenders what precedes it", () => {
    // The other believed answer is `parsesAsAuthority`'s success, which BOUNDS
    // a region. What it can cost is recorded residual 5 — a credential hiding
    // behind text the parser reads as a host — and nothing wider: the bound
    // never reaches back over the `@` marks below it.
    for (const host of ["api.test", "2130706433", "[::1]", "xn--n3h.test", "api.test."]) {
      const url = `https://api.test/go/https://svc:${PASSWORD}@${host}://x@inner.test/v1`;
      expect(redactUrl(url), `a ${host} bound let the credential out`).not.toContain(PASSWORD);
    }
  });
});

describe("every state that consumes the opening mark is accounted for", () => {
  test("the three seams SECURITY.md names still remove their credential", () => {
    // 1 — a host-less origin's `scheme://` seam.
    expect(redactUrl(`file:///svc:${PASSWORD}@host/v1`)).not.toContain(PASSWORD);
    // 2 — the path a protocol-relative reference leaves behind.
    expect(redactUrl(`//https://svc:${PASSWORD}@internal.test/v1`)).not.toContain(PASSWORD);
    // 3 — a reference whose scheme equals the resolution base's.
    expect(redactUrl(`http:svc:${PASSWORD}@api.test:99999/v1`)).not.toContain(PASSWORD);
  });

  test("the characters the parser removes ANYWHERE are handled at every position", () => {
    // ASCII tab, CR and LF are removed from the whole input rather than from
    // its head, and `isIgnored` covers them wherever they fall. Broken marks
    // are still marks.
    for (const gap of ["\t", "\n", "\r"]) {
      for (const url of [
        `htt${gap}p:svc:${PASSWORD}@api.test:99999/v1`,
        `http${gap}:svc:${PASSWORD}@api.test:99999/v1`,
        `http:${gap}svc:${PASSWORD}@api.test:99999/v1`,
        `/${gap}/svc:${PASSWORD}@api.test:99999/v1`,
        `//svc:${PASSWORD}${gap}@api.test:99999/v1`,
      ]) {
        expect(redactUrl(url), `${JSON.stringify(url)} kept its credential`).not.toContain(
          PASSWORD,
        );
      }
    }
  });

  test("an opaque or non-special scheme is reduced to its scheme, payload and all", () => {
    // A scheme outside the six hierarchical ones carries its whole body in the
    // path, so the redactor emits the scheme alone. That covers a `blob:` url
    // wrapping an inner credentialed url and a `data:` url whose payload spells
    // a credential — the two shapes a reader would call disclosures and the
    // parser would not.
    for (const [url, scheme] of [
      [`blob:https://alice:${PASSWORD}@host/2f4c-uuid`, "blob:"],
      [`data:text/plain;base64,YWxpY2U6${PASSWORD}QGhvc3Q=`, "data:"],
      [`data:text/plain,alice:${PASSWORD}@host`, "data:"],
      [`git://alice:${PASSWORD}@host/v1`, "git:"],
      [`mailto:alice:${PASSWORD}@host`, "mailto:"],
      [`javascript:fetch("https://alice:${PASSWORD}@host")`, "javascript:"],
      [`about:blank#alice:${PASSWORD}@host`, "about:"],
    ] as const) {
      expect(redactUrl(url), `${url} emitted more than its scheme`).toBe(scheme);
    }
  });
});

describe("the recorded residuals hold exactly one kind of secret each", () => {
  test("every secret shape a URL carries lands in a documented slot or is removed", () => {
    // `SECURITY.md` residuals 1 and 2 are the module's stated blind spots, and
    // this pins them by the KIND of secret rather than by the syntax that
    // spells one — which is the axis a syntax-shaped harness cannot see. Each
    // row names the slot the secret sits in and the verdict the document
    // promises for that slot.
    const SECRET = "R14SECRETVALUE";
    const survives = (url: string) => redactUrl(url).includes(SECRET);

    // DROPPED — the query and the fragment are value slots, whole.
    expect(survives(`https://api.test/o?access_token=${SECRET}`)).toBe(false);
    expect(survives(`https://api.test/o?X-Amz-Signature=${SECRET}&X-Amz-Expires=60`)).toBe(false);
    expect(survives(`https://api.test/cb#id_token=${SECRET}`)).toBe(false);
    expect(survives(`https://api.test/o?sig=${SECRET}#k=${SECRET}`)).toBe(false);
    // DROPPED — userinfo is a value slot, in the authority and embedded alike.
    expect(survives(`https://${SECRET}@api.test/v1`)).toBe(false);
    expect(survives(`https://api.test/go/https://${SECRET}@inner.test/v1`)).toBe(false);

    // KEPT — residual 1, and it is exactly one slot: a hierarchical PATH
    // SEGMENT. A bearer token, a JWT, a reset token and a matrix parameter are
    // one residual wearing four costumes, not four residuals.
    expect(survives(`https://api.test/reset/${SECRET}`)).toBe(true);
    expect(survives(`https://api.test/v1/token/${SECRET}/use`)).toBe(true);
    expect(survives(`https://api.test/s;jsessionid=${SECRET}/page`)).toBe(true);
    expect(survives(`https://api.test/a.b.${SECRET}`)).toBe(true);
    // And it stops at the slot's edge: one delimiter over, the same bytes go.
    expect(survives(`https://api.test/reset?t=${SECRET}`)).toBe(false);
    expect(survives(`https://api.test/reset#${SECRET}`)).toBe(false);

    // KEPT — residual 2, and only at the two solidus counts the document names.
    expect(survives(`https://api.test/go/https%3A/svc:${SECRET}@i.test/v1`)).toBe(true);
    expect(survives(`https://api.test/go/https%3Asvc:${SECRET}@i.test/v1`)).toBe(true);
    expect(survives(`https://api.test/go/https://svc%3A${SECRET}%40host/v1`)).toBe(true);
    // Two solidi, and the document says the LITERAL `//` opens the region
    // whatever precedes it — so this one closes, and so does the same url with
    // the scheme text replaced by anything at all.
    expect(survives(`https://api.test/go/https%3A//svc:${SECRET}@i.test/v1`)).toBe(false);
    expect(survives(`https://api.test/go/zz%3A//svc:${SECRET}@i.test/v1`)).toBe(false);
  });
});
