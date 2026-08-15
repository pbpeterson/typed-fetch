import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { builtEntryUrl, distExists, warnWhenDistMissing } from "../../fixtures/built-package";

// ═══════════════════════════════════════════════════════════════════════════
// ROUND 20, LANE H4 — the sentences round 19 wrote, read against `dist`.
//
// This audit has produced four false sentences while CORRECTING a document.
// Round 19 wrote nine more, across SECURITY.md, CONTRIBUTING.md, CONTEXT.md,
// docs/adr/0003 and CHANGELOG.md. Each one is a claim with a quantifier in it,
// so each one is read here by enumerating the configurations it ranges over and
// asking the BUILT package, never another document.
//
// The one that does not hold is the one SECURITY.md's own membership rule cares
// about most: a bald negative about a credential.
//
// Every behavior claim resolves through `fixtures/built-package`, the one place
// in this repository that names a built path.
// ═══════════════════════════════════════════════════════════════════════════

warnWhenDistMissing("surface-password-residual-claims", distExists);

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const repoText = (path: string): string => readFileSync(join(REPO_ROOT, path), "utf8");
/** A document sentence with its line wrapping removed, so a quote can be found. */
const unwrapped = (text: string): string => text.replaceAll(/\s+/g, " ");

interface ErrorBag {
  NetworkError: new (
    message?: string,
    options?: { cause?: unknown; url?: string },
  ) => Error & { url: string; toJSON(): { url: string; message: string } };
}

/** The BUILT public error cluster. */
async function builtErrors(): Promise<ErrorBag> {
  return (await import(/* @vite-ignore */ builtEntryUrl("dist/errors/index.mjs").href)) as ErrorBag;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. SECURITY.md's new absolute: "A PASSWORD does not survive it."
//
// Round 19 added three sentences to the `redactUrlInMessage` residual. The
// first is unqualified:
//
//   "A PASSWORD does not survive it. The url's own userinfo is removed in the
//    spelling the caller wrote as well as in the spelling the parser writes, so
//    a password holding a space, a non-ASCII letter, or any other character the
//    parser percent-encodes inside a userinfo goes even when the whole-url
//    replacement finds no match."
//
// The second sentence names the mechanism, and the mechanism has a boundary the
// first sentence does not: the raw scan finds a userinfo only where the region
// rules put one, and a password whose FIRST character is a solidus or a
// backslash is not in a userinfo the URL parser reads at all. `\` ends the
// authority — the URL Standard treats it as a solidus under a special scheme —
// so `https://alice:\hunter2@api.test/p` parses with host `alice` and path
// `/hunter2@api.test/p`, and no rule in the redactor removes `hunter2`.
//
// The password then survives in `error.message` under EVERY spelling, including
// the one the caller wrote, and in `toJSON().url`, which is the record a
// structured logger writes. SECURITY.md's own membership rule — "a limit
// belongs here when this library's own output can harm the reader who acts on
// it" — is exactly what this row satisfies, and the sentence now tells the
// reader the opposite.
// ═══════════════════════════════════════════════════════════════════════════

/** The url spellings a platform can quote back for the same request. */
function spellingsOf(url: string): string[] {
  const parsed = new URL(url);
  const withoutFragment = new URL(url);
  withoutFragment.hash = "";
  return [
    url,
    parsed.href,
    withoutFragment.href,
    parsed.href.replace(parsed.hostname, parsed.hostname.toUpperCase()),
  ];
}

describe.skipIf(!distExists)("SECURITY.md's `redactUrlInMessage` password sentence", () => {
  // R20-ORCH-01 requalified the sentence. Round 19 wrote it as an absolute —
  // "A PASSWORD does not survive it." — and this lane proved the absolute false
  // twice: once for a backslash under a special scheme, which R20-H4-08 fixed,
  // and once for a backslash under a NON-special scheme, where the parser DOES
  // report the userinfo. The qualifier is what makes the claim checkable: the
  // pass can only name what the parser reads as userinfo.
  const SENTENCE = "A PASSWORD THE PARSER READS AS USERINFO does not survive it.";
  /** A password whose first character ends the authority for the URL parser. */
  const LEAKY = "https://alice:\\hunter2@api.test/p?q=1#f";
  const SECRET = "hunter2";

  test("EVIDENCE: SECURITY.md carries the sentence round 19 wrote", () => {
    expect(unwrapped(repoText("SECURITY.md"))).toContain(SENTENCE);
    expect(unwrapped(repoText("SECURITY.md"))).toContain(
      "The url's own userinfo is removed in the spelling the caller wrote as well as in the " +
        "spelling the parser writes",
    );
  });

  test("EVIDENCE: the sentence holds for every userinfo the parser reads", async () => {
    // The half that is true, and the control for the row below. Across the
    // encode set the sentence names — a space, a non-ASCII letter, a tab, `|`,
    // `<`, a backslash the parser keeps inside the userinfo — no password the
    // parser reports survives any spelling of the message.
    const { NetworkError } = await builtErrors();
    let measured = 0;
    for (const character of [" ", "\t", "|", "<", ">", "`", '"', "^", "{", "}", "é", "😀", "%"]) {
      for (const password of [`${SECRET}${character}x`, `${character}${SECRET}`]) {
        const url = `https://alice:${password}@api.test/p?q=1#f`;
        let parsed: URL;
        try {
          parsed = new URL(url);
        } catch {
          continue;
        }
        if (parsed.password === "") continue;
        measured += 1;
        for (const quoted of spellingsOf(url)) {
          const error = new NetworkError(`request to ${quoted} failed`, { url });
          expect(error.message).not.toContain(SECRET);
          expect(error.toJSON().message).not.toContain(SECRET);
        }
      }
    }
    expect(measured).toBeGreaterThan(15);
  });

  test("EVIDENCE: the leaky url is an ordinary one the platform accepts", () => {
    // Not a malformed string. It parses, and what the parser makes of it is
    // exactly why the scan finds no userinfo: the backslash ends the authority.
    const parsed = new URL(LEAKY);
    expect(parsed.host).toBe("alice");
    expect(parsed.password).toBe("");
    expect(parsed.pathname).toBe("/hunter2@api.test/p");
  });

  test("a password behind a leading backslash survives `error.message`", async () => {
    // R20-H4-08.
    const { NetworkError } = await builtErrors();
    const survivors = spellingsOf(LEAKY).filter((quoted) =>
      new NetworkError(`request to ${quoted} failed`, { url: LEAKY }).message.includes(SECRET),
    );

    expect(
      survivors,
      `SECURITY.md says "${SENTENCE}" of \`redactUrlInMessage\`. For ` +
        `${JSON.stringify(LEAKY)} the password survives in \`error.message\` under every ` +
        "spelling a platform can quote, including the one the caller wrote, because the URL " +
        "parser reads the backslash as ending the authority and the redactor's region rules " +
        "then find no userinfo to remove",
    ).toEqual([]);
  });

  test("and it survives `toJSON().url`, the record a structured logger writes", async () => {
    // R20-H4-08, second half — and the reason this is a SECURITY.md row rather
    // than a wording quibble. The residual list under this very sentence names
    // two shapes `redactUrl` cannot withhold; this is a third, and it is
    // undocumented.
    const { NetworkError } = await builtErrors();
    const record = new NetworkError("Network error", { url: LEAKY }).toJSON();

    expect(
      record.url,
      "`toJSON().url` is `redactUrl(this.url)`, the copy of the url a structured logger " +
        "records. SECURITY.md names exactly two residuals `redactUrl` itself cannot withhold — " +
        "a credential whose last character is `/`, and a credential holding a `://`. A " +
        "password whose first character is a backslash is a third, and no document records it",
    ).not.toContain(SECRET);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. The other eight sentences round 19 wrote, enumerated and held.
//
// These pass. They are here because the finding above is only meaningful beside
// them: the method is to enumerate what a sentence quantifies over and ask
// `dist`, and a lane that reports only its failures has not shown the method
// ran.
// ═══════════════════════════════════════════════════════════════════════════

describe.skipIf(!distExists)("CONTEXT.md's signal-snapshot invariant, over every spelling", () => {
  test("all four spellings reach the transport as one own enumerable data property", async () => {
    const { typedFetch } = (await import(
      /* @vite-ignore */ builtEntryUrl("dist/index.mjs").href
    )) as {
      typedFetch: (input: string, init: Record<string, unknown>) => Promise<unknown>;
    };
    const signal = AbortSignal.timeout(60_000);
    let seen: { spread: unknown; enumerable: boolean | undefined; own: boolean } | null = null;
    const transport = (_input: unknown, init: Record<string, unknown>): Promise<Response> => {
      seen = {
        spread: { ...init }.signal,
        enumerable: Object.getOwnPropertyDescriptor(init, "signal")?.enumerable,
        own: Object.hasOwn(init, "signal"),
      };
      return Promise.resolve(new Response("{}", { status: 200 }));
    };

    const spellings: Record<string, () => Record<string, unknown>> = {
      "own enumerable": () => ({ fetch: transport, signal }),
      "own non-enumerable data": () =>
        Object.defineProperty({ fetch: transport }, "signal", {
          configurable: true,
          enumerable: false,
          value: signal,
          writable: true,
        }),
      "own non-enumerable accessor": () =>
        Object.defineProperty({ fetch: transport }, "signal", {
          configurable: true,
          enumerable: false,
          get: () => signal,
        }),
      inherited: () => Object.assign(Object.create({ signal }), { fetch: transport }),
    };

    for (const [name, make] of Object.entries(spellings)) {
      seen = null;
      await typedFetch("https://api.test/x", make());
      expect(seen, `the ${name} spelling did not reach the transport as a snapshot`).toEqual({
        enumerable: true,
        own: true,
        spread: signal,
      });
    }

    // "An init that reports no signal materializes no entry."
    seen = null;
    await typedFetch("https://api.test/x", { fetch: transport });
    expect(seen).toEqual({ enumerable: undefined, own: false, spread: undefined });
  });
});

describe.skipIf(!distExists)("CHANGELOG.md's two new Security entries, as fixed points", () => {
  test("both urls the bare-`//` entry names are left unchanged by the redactor", async () => {
    const { NetworkError } = await builtErrors();
    const block = unwrapped(repoText("CHANGELOG.md"));
    for (const url of [
      "https://api.test/go/https://media.test:8443/img/@alice",
      "https://api.test//media.test:8443/img/@alice",
    ]) {
      expect(block, "the entry must still name this url").toContain(url);
      expect(new NetworkError("Network error", { url }).toJSON().url).toBe(url);
    }
  });

  test("SECURITY.md's struck RES-7 entry names a url the redactor now keeps", async () => {
    const { NetworkError } = await builtErrors();
    const url = "https://api.test/proxy///cdn.test:8443/img/@alice";
    const security = unwrapped(repoText("SECURITY.md"));
    expect(security.includes(`\`${url}\` emitted`)).toBe(true);
    expect(security.includes("The url above is a fixed point of the redactor now.")).toBe(true);
    expect(new NetworkError("Network error", { url }).toJSON().url).toBe(url);
  });
});
