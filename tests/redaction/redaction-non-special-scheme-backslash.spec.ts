import { describe, expect, test } from "vitest";
import { NetworkError } from "../../src/errors/network-error";
import { everyChannel, leakingChannels } from "../../fixtures/channels";

// ═══════════════════════════════════════════════════════════════════════════
// ROUND 20, ORCHESTRATOR — the fourth spelling class, found while closing.
//
// Round 20's H3 lane closed three spelling classes: a `file:` url under fewer
// than two solidi, a scheme token a tab, CR or LF breaks, and a `\` folded into
// a `/` inside a `file:` password. Its fix gave `userinfosOf` the url's OWN
// authority in the CALLER'S raw spelling, through the new `ownUserinfo`.
//
// `ownUserinfo` bounds its backward search with `authorityEnd`, and
// `authorityEnd` treats a reverse solidus as a solidus. Under a SPECIAL scheme
// that agrees with the URL Standard: authority state terminates on U+005C
// exactly as it does on `/`, `?`, `#` and EOF. Under a NON-SPECIAL scheme it
// does not — the backslash branch is gated on "url is special", so `\` stays an
// ordinary code point, the `@` branch still fires, and the parser reports a
// username and a password.
//
// So for `git://svc:hun\ter2@api.test/v1` the parser answers
// `username: "svc"`, `password: "hun%5Cter2"` — the url's own userinfo, in the
// exact class round 20's H3 lane exists to remove — while `authorityEnd` stops
// at the `\` before ever reaching the `@`, `ownUserinfo` answers `null`, and
// the only needle left is the parser's percent-encoded spelling. A platform
// message quoting the url the caller wrote keeps the password.
//
// This is PRE-EXISTING. The pre-fix tree leaks identically, so round 20's fix
// did not introduce it; round 20's corpus could not draw it, because every row
// of the backslash family used `https://` and the character list omitted `\`.
// It is filed here rather than deferred because `SECURITY.md` states "A
// PASSWORD does not survive it", a test pins that sentence verbatim, and a
// security document that is false while the suite is green is the shape this
// audit has paid for four times.
// ═══════════════════════════════════════════════════════════════════════════

/** The spelling the caller wrote, which is the one a platform message quotes. */
const RAW_PASSWORD = "hun\\ter2";

/**
 * One error in the shape `redactUrlInMessage`'s own comment is written for: a
 * platform naming the request target it could not reach, with the fragment
 * stripped, which is how undici spells it.
 */
function errorFor(url: string): NetworkError {
  const quoted = url.replace("#anchor", "");
  return new NetworkError(`request to ${quoted} failed`, { url });
}

describe("R20-ORCH-01 — a non-special scheme reports a userinfo the head scan cannot reach", () => {
  test("EVIDENCE: the parser reports this userinfo, so it is the url's OWN", () => {
    // The non-vacuity control. If the parser reported nothing here the finding
    // would belong to a different class — the one SECURITY.md already records
    // for a `file:` url, where the record is clean and no userinfo exists to
    // remove. It reports both members, so this is the own-userinfo class.
    const parsed = new URL(`git://svc:${RAW_PASSWORD}@api.test/v1`);

    expect(parsed.username).toBe("svc");
    expect(parsed.password).toBe("hun%5Cter2");
  });

  test("EVIDENCE: the same password under a SPECIAL scheme is removed", () => {
    // The half round 20 closed, kept here as the contrast that makes the
    // finding a gap rather than a design. One url shape, two scheme classes,
    // two answers.
    const error = errorFor(`https://svc:${RAW_PASSWORD}@api.test/v1#anchor`);

    expect(leakingChannels(everyChannel(error), [RAW_PASSWORD])).toEqual([]);
  });

  test("the password reaches no channel under a non-special scheme", () => {
    const error = errorFor(`git://svc:${RAW_PASSWORD}@api.test/v1#anchor`);

    expect(
      leakingChannels(everyChannel(error), [RAW_PASSWORD]),
      "`git://svc:hun\\ter2@api.test/v1` carries the url's OWN userinfo — the parser " +
        "reports `svc` and `hun%5Cter2` — and `\\` is exactly a character the parser " +
        "percent-encodes inside a userinfo. `ownUserinfo` bounds its backward search with " +
        "`authorityEnd`, which reads `\\` as a solidus; under a non-special scheme the URL " +
        "Standard does not, so the walk stops before the `@` and the caller's spelling is " +
        "never a needle. SECURITY.md says a password does not survive this",
    ).toEqual([]);
  });

  test("and every non-special scheme answers the same way", () => {
    // A disclosure decision applies to the class, never to one member. `git:`,
    // `svn:` and an invented scheme are all non-special, so all three take the
    // branch the URL Standard's special-scheme table excludes.
    const leaking = ["git", "svn", "custom-scheme"].filter(
      (scheme) =>
        leakingChannels(
          everyChannel(errorFor(`${scheme}://svc:${RAW_PASSWORD}@api.test/v1#anchor`)),
          [RAW_PASSWORD],
        ).length > 0,
    );

    expect(leaking, "the class answers as one, so the fix must too").toEqual([]);
  });
});
