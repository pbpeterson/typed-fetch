import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { builtEntryUrl, distExists, warnWhenDistMissing } from "../../fixtures/built-package";

// ═══════════════════════════════════════════════════════════════════════════
// ROUND 18, LANE H4 — the sentences round 17 wrote, and the release itself.
//
// Round 17 corrected `CONTEXT.md`, `src/request-plan.ts`, `CONTRIBUTING.md` and
// the ledger, and added `pnpm coverage` to both workflows. Rounds 13, 14 and 16
// each produced a FALSE sentence while CORRECTING a document, so every sentence
// round 17 now carries is re-read here against the BUILT package, never against
// another document.
//
// Three subjects, in this order:
//
//  1. The transport re-entry sentence round 17 rewrote — all five reads, on a
//     polluted prototype, on an `Object.create(defaults)` config, with no
//     options object at all, and in the one configuration the rewrite left out.
//  2. RELEASE READINESS, the largest open item: the roster RELEASING.md tells a
//     maintainer to run, the `[Unreleased]` block semver rule 8 governs, the
//     advisory step 9 publishes, and the version the policy permits.
//  3. The R16-ORCH-01 shape, swept for once more: a check whose assertion reads
//     something other than what it guards — this time in a pin round 17 itself
//     added.
//
// Every behavior claim is measured through `fixtures/built-package`, the one
// place in this repository that resolves a built path.
// ═══════════════════════════════════════════════════════════════════════════

warnWhenDistMissing("round18-h4-surface", distExists);

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** A repository file, by its path from the root. */
const repoText = (path: string): string => readFileSync(join(REPO_ROOT, path), "utf8");

/** A document sentence with its line wrapping removed, so a quote can be found. */
const unwrapped = (text: string): string => text.replaceAll(/\s+/g, " ");

/**
 * The same, for a text whose lines may carry a JSDoc `*` gutter — so one quote
 * can be looked for in a Markdown file and in a source docblock alike.
 */
const flattened = (text: string): string => unwrapped(text.replaceAll(/^\s*\*[ \t]?/gm, ""));

// ── Reading the built package ────────────────────────────────────────────

type RecordedError = Error & { toJSON(): { url: string } };
type RootBag = {
  NetworkError: new (message?: string, options?: { url?: string }) => RecordedError;
  typedFetch: (input: string, options?: unknown) => Promise<{ error: unknown }>;
};

const loadRoot = async (): Promise<RootBag> =>
  (await import(/* @vite-ignore */ builtEntryUrl("dist/index.mjs").href)) as RootBag;

/** The REDACTED url the BUILT package emits for `url` — the record's copy. */
async function emittedUrl(url: string): Promise<string> {
  const { NetworkError } = await loadRoot();
  return new NetworkError("Network error", { url }).toJSON().url;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. THE TRANSPORT RE-ENTRY SENTENCE ROUND 17 WROTE, RE-READ AGAINST DIST.
//
// THE SENTENCE, `CONTEXT.md` under "Transport re-entry" and the module JSDoc of
// `src/request-plan.ts`, word for word in both:
//
//   "The init a transport receives carries no `fetch` extension under any of
//    the three reads that inspect its own shape: an own-property descriptor
//    answers absent, `Object.keys`/`ownKeys` omit the name, and a spread copy
//    carries none. A plain property get and the `in` operator read the
//    prototype chain too, and an INHERITED `fetch` answers both of them: the
//    property get returns the caller's value and `in` answers `true`."
//
// Five reads, split three and two. The three configurations round 17's own
// ledger entry names are measured first and all three hold. The fourth is the
// one the rewrite did not measure.
// ═══════════════════════════════════════════════════════════════════════════

/** The five reads a transport can make of its init, for the `fetch` name. */
interface ExtensionReads {
  readonly ownDescriptor: "absent" | "present";
  readonly ownKeyList: boolean;
  readonly objectKeys: boolean;
  readonly spreadCopy: boolean;
  readonly propertyGet: "undefined" | "the caller's value" | "some other value";
  readonly inCheck: boolean;
}

function readExtension(init: RequestInit, callersValue: unknown): ExtensionReads {
  const got = (init as { readonly fetch?: unknown }).fetch;
  return {
    ownDescriptor:
      Object.getOwnPropertyDescriptor(init, "fetch") === undefined ? "absent" : "present",
    ownKeyList: Reflect.ownKeys(init).includes("fetch"),
    objectKeys: Object.keys(init).includes("fetch"),
    spreadCopy: Object.hasOwn({ ...init }, "fetch"),
    propertyGet:
      got === undefined
        ? "undefined"
        : got === callersValue
          ? "the caller's value"
          : "some other value",
    inCheck: "fetch" in init,
  };
}

/** What the three reads that inspect the init's OWN shape must answer. */
const OWN_SHAPE_CARRIES_NOTHING = {
  ownDescriptor: "absent",
  ownKeyList: false,
  objectKeys: false,
  spreadCopy: false,
} as const;

/** A response a transport under test can answer with. */
const jsonResponse = (): Response =>
  new Response("{}", { headers: { "content-type": "application/json" } });

/**
 * Runs one call and answers the five reads the TRANSPORT made of its init.
 *
 * `place` says which slot the transport arrived in, because that is the slot
 * `snapshotRequestInit` branches on. `"ambient"` replaces `globalThis.fetch`,
 * which `src/request-plan.ts` names as a first-class case ("a replaced
 * `globalThis.fetch` carries no key while being caller code"); `"own"` passes
 * the recorder as the `fetch` option, which is what dependency injection
 * writes.
 *
 * The reads happen INSIDE the call, while any prototype pollution is still in
 * place — a read taken after the restore would answer about a clean prototype.
 */
async function readsOfTransportInit(
  options: Record<string, unknown> | undefined,
  place: "ambient" | "own",
  callersValue: unknown,
): Promise<ExtensionReads> {
  const { typedFetch } = await loadRoot();
  let seen: ExtensionReads | undefined;
  const recorder = ((_input: unknown, init: RequestInit) => {
    seen = readExtension(init, callersValue);
    return Promise.resolve(jsonResponse());
  }) as unknown as typeof fetch;

  const globals = globalThis as { fetch: typeof fetch };
  const nativeFetch = globals.fetch;
  try {
    if (place === "ambient") globals.fetch = recorder;
    else (options as Record<string, unknown>).fetch = recorder;
    const result =
      options === undefined
        ? await typedFetch("https://round18.test/x")
        : await typedFetch("https://round18.test/x", options);
    expect(result.error, "the recorded call must succeed").toBe(null);
  } finally {
    globals.fetch = nativeFetch;
  }

  expect(seen, "the recorder must have run as the transport").toBeDefined();
  return seen as ExtensionReads;
}

/** Runs `body` with `Object.prototype.fetch` set, exactly as pollution writes it. */
async function withPollutedPrototype<T>(value: unknown, body: () => Promise<T>): Promise<T> {
  const objectPrototype = Object.prototype as { fetch?: unknown };
  Object.defineProperty(objectPrototype, "fetch", {
    value,
    writable: true,
    enumerable: false,
    configurable: true,
  });
  try {
    return await body();
  } finally {
    Reflect.deleteProperty(objectPrototype, "fetch");
  }
}

describe.skipIf(!distExists)("the transport re-entry sentence round 17 wrote", () => {
  /** A value a caller can plant as an inherited `fetch`. It is never called. */
  const inheritedFetch = (async () => new Response("inherited")) as unknown as typeof fetch;

  test("both documents still carry the sentence this section judges", () => {
    const clause =
      "an INHERITED `fetch` answers both of them: the property get returns the caller's value and `in` answers `true`";

    expect(unwrapped(repoText("CONTEXT.md"))).toContain(clause);
    expect(flattened(repoText("src/request-plan.ts"))).toContain(clause);
  });

  test("VERIFIED: on a polluted prototype, all five reads answer as the sentence says", async () => {
    const reads = await withPollutedPrototype(
      inheritedFetch,
      async () => await readsOfTransportInit({}, "ambient", inheritedFetch),
    );

    expect(reads).toEqual({
      ...OWN_SHAPE_CARRIES_NOTHING,
      propertyGet: "the caller's value",
      inCheck: true,
    });
  });

  test("VERIFIED: on an `Object.create(defaults)` config, all five answer the same", async () => {
    // The ordinary, non-hostile spelling the ledger names: one shared
    // configuration object, one per-call options object created over it.
    const reads = await readsOfTransportInit(
      Object.create({ fetch: inheritedFetch }) as Record<string, unknown>,
      "ambient",
      inheritedFetch,
    );

    expect(reads).toEqual({
      ...OWN_SHAPE_CARRIES_NOTHING,
      propertyGet: "the caller's value",
      inCheck: true,
    });
  });

  test("VERIFIED: with no options object at all, all five answer the same", async () => {
    const reads = await withPollutedPrototype(
      inheritedFetch,
      async () => await readsOfTransportInit(undefined, "ambient", inheritedFetch),
    );

    expect(reads).toEqual({
      ...OWN_SHAPE_CARRIES_NOTHING,
      propertyGet: "the caller's value",
      inCheck: true,
    });
  });

  test("an inherited fetch answers NEITHER read when the caller also passes an own one", async () => {
    // R18-H4-05.
    //
    // The sentence has two clauses and only the FIRST carries a scope: "the
    // three reads that inspect its own shape". The second is stated of the init
    // a transport receives, without qualification — "A plain property get and
    // the `in` operator read the prototype chain too, and an INHERITED `fetch`
    // answers both of them".
    //
    // `snapshotRequestInit` has two branches and `Object.hasOwn(options,
    // "fetch")` picks between them. On the branch the three configurations
    // above take, the caller's object IS the proxy target and the only trap is
    // `get`, which delegates — so the chain is read and the sentence holds. On
    // the OTHER branch a `get` trap answers `undefined` for `fetch` and a `has`
    // trap answers `false`, and neither consults the prototype chain at all.
    //
    // That branch is the one a caller-written transport normally runs on: an
    // own `fetch` option is what makes caller code the transport in the first
    // place. Both configurations below carry a live inherited `fetch` AND an
    // own one, which is what dependency injection over a shared defaults object
    // spells, and in both the two prototype-walking reads answer as if no
    // `fetch` existed anywhere.
    //
    // The CONSEQUENCE the sentence draws is unaffected — `Object.hasOwn`
    // selects the transport, so re-entry still reaches the ambient one — and
    // the direction of the error is the safe one. The defect is the claim, and
    // it is the fourth false sentence this audit has produced while correcting
    // a document. Round 17's own lesson was that a claim quantified over "any
    // read" must be measured against an inherited value; the symmetric half is
    // that a claim quantified over "an inherited value" must be measured with
    // an own one present.
    const overSharedDefaults = await readsOfTransportInit(
      Object.create({ fetch: inheritedFetch }) as Record<string, unknown>,
      "own",
      inheritedFetch,
    );
    const overPollutedPrototype = await withPollutedPrototype(
      inheritedFetch,
      async () => await readsOfTransportInit({}, "own", inheritedFetch),
    );

    // ADJUDICATED IN ROUND 18. The finding was real and the remedy was the
    // SENTENCE, exactly as round 17's twin finding went. This assertion held
    // the OLD sentence's claim, so it could not go green when F4 corrected the
    // document, and F4 reported it rather than editing a spec outside its
    // grant. The orchestrator upheld that and rewrote it here.
    //
    // What the corrected sentence claims, and what this now pins: on the
    // branch an own `fetch` selects, the sanitizing proxy answers for all five
    // reads and never consults the chain, with the inherited value still on
    // it. The prototype-walking clause belongs to the OTHER branch, which the
    // test above this one pins.
    const theSanitizedBranchAnswersForEveryRead = {
      ...OWN_SHAPE_CARRIES_NOTHING,
      propertyGet: "undefined",
      inCheck: false,
    };

    expect(
      { overSharedDefaults, overPollutedPrototype },
      "on the branch an own `fetch` selects — the only way caller code becomes the transport " +
        "through the option — the sanitizing proxy answers `undefined` for a property get and " +
        "`false` for an `in` check, without reading the prototype chain, with the inherited " +
        "value still on it",
    ).toEqual({
      overSharedDefaults: theSanitizedBranchAnswersForEveryRead,
      overPollutedPrototype: theSanitizedBranchAnswersForEveryRead,
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. RELEASE READINESS.
//
// `package.json` is 2.0.1, the `[Unreleased]` block is uncut, and semver rule 8
// forbids a patch for it. Nothing moved in round 17. This section turns the
// release procedure itself into assertions: the roster, the changelog, the
// advisory, and the number.
// ═══════════════════════════════════════════════════════════════════════════

/** The `pnpm …` gate commands of one workflow job, in the order it runs them. */
function jobGates(workflow: string, jobName: string): string[] {
  const start = workflow.indexOf(`\n  ${jobName}:\n`);
  expect(start, `${jobName} must exist in the workflow`).not.toBe(-1);
  const rest = workflow.slice(start + 1);
  const end = rest.search(/\n {2}[A-Za-z][\w-]*:\n/);
  const job = end === -1 ? rest : rest.slice(0, end);
  return [...job.matchAll(/- run: (pnpm (?:run )?[\w:-]+)$/gm)].map((match) => match[1] ?? "");
}

/** The `pnpm …` lines of CONTRIBUTING's "The gates" block, in order. */
function contributingGates(): string[] {
  const block = /## The gates[\s\S]*?```bash\n([\s\S]*?)```/.exec(repoText("CONTRIBUTING.md"));
  expect(block, "CONTRIBUTING.md must keep a bash block under `## The gates`").not.toBeNull();
  return (block?.[1] ?? "")
    .split("\n")
    .map((line) => line.replace(/#.*$/, "").trim())
    .filter(Boolean);
}

/**
 * The numbered roster of "How publishing actually works" — RELEASING.md's
 * description of what the release workflow's package job runs.
 */
function releasingNumberedGates(): string[] {
  return [...repoText("RELEASING.md").matchAll(/^\s*\d+\. `(pnpm[^`]*)`\s*$/gm)].map(
    (match) => match[1] ?? "",
  );
}

/** The bash block of release-checklist step 2, the one a maintainer types. */
function releasingLocalGates(): string[] {
  const doc = repoText("RELEASING.md");
  const anchor = doc.indexOf("Run the exact package-job gates locally, in order:");
  expect(anchor, "RELEASING.md must keep the step-2 local-gate instruction").not.toBe(-1);
  const block = /```bash\n([\s\S]*?)```/.exec(doc.slice(anchor));
  expect(block, "RELEASING.md step 2 must keep a bash block").not.toBeNull();
  return (block?.[1] ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

describe("the gate roster the release documents carry", () => {
  test("VERIFIED: CONTRIBUTING, ci.yml and release.yml agree, coverage included", () => {
    // Round 17 added `pnpm coverage` to all three. This re-measures the claim
    // rather than trusting `scripts/gate-properties.spec.mjs`, and it also
    // states the ORDERING rule the documents give for it: the coverage gate
    // runs the whole suite again, so it sits after the build like every other
    // artifact gate.
    const release = repoText(".github/workflows/release.yml");
    const ci = repoText(".github/workflows/ci.yml");
    const audits = ["pnpm audit:prod", "pnpm run audit:ci"];
    const roster = contributingGates();

    expect(roster).toContain("pnpm coverage");
    expect(jobGates(release, "package")).toEqual(roster);
    expect(jobGates(ci, "test")).toEqual(roster.filter((gate) => !audits.includes(gate)));
    for (const workflow of [release, ci]) {
      const steps = jobGates(workflow, workflow === release ? "package" : "test");
      expect(steps.indexOf("pnpm build")).toBeLessThan(steps.indexOf("pnpm coverage"));
      expect(steps.indexOf("pnpm coverage")).toBeLessThan(steps.indexOf("pnpm check-docs"));
    }
  });

  test("RELEASING lists the gates the release job actually runs", () => {
    // R18-H4-01.
    //
    // RELEASING.md carries the roster TWICE — once as "the package job … then
    // runs:" and once as release-checklist step 2, "Run the exact package-job
    // gates locally, in order". Round 17 added a twelfth gate to
    // CONTRIBUTING.md and to both workflows and left both of these at eleven,
    // so the document a maintainer follows to cut a release now describes a
    // job that no longer exists.
    //
    // Nothing reads these two lists. `scripts/gate-properties.spec.mjs` exists
    // for exactly this class of drift and its section header says so — "the
    // gates CONTRIBUTING lists are the gates CI runs … Nothing else reads the
    // three lists together" — but there are FOUR rosters in this repository and
    // it reads three. The one it does not read is the one the release procedure
    // is written in.
    const runs = jobGates(repoText(".github/workflows/release.yml"), "package");

    expect(
      { numbered: releasingNumberedGates(), step2: releasingLocalGates() },
      "RELEASING.md calls its step-2 block 'the exact package-job gates … in order'; the " +
        "package job of .github/workflows/release.yml runs `pnpm coverage` and neither " +
        "RELEASING.md roster names it, so a maintainer who follows the document skips the " +
        "gate that enforces the 100 percent threshold and learns about it from CI",
    ).toEqual({ numbered: runs, step2: runs });
  });
});

// ── The `[Unreleased]` block, against semver rule 8 ──────────────────────

/** The text of the `[Unreleased]` section, up to the first dated heading. */
function unreleasedBlock(): string {
  const changelog = repoText("CHANGELOG.md");
  const start = changelog.indexOf("\n## [Unreleased]");
  expect(start, "CHANGELOG.md must keep an [Unreleased] heading").not.toBe(-1);
  const rest = changelog.slice(start + 1);
  const end = rest.indexOf("\n## [");
  return end === -1 ? rest : rest.slice(0, end);
}

/**
 * Every complete url a Markdown text names inside a code span.
 *
 * A span counts when it is spelled entirely in URL characters, holds a solidus,
 * and is long enough to be a reference rather than a mark. That admits
 * `/go/file:/Users/alice@corp/report.pdf` and rejects `://`, `//host/…` (the
 * ellipsis is not a URL character) and `new URL("https://:@x/").href` (spaces
 * and quotes are not either).
 */
function namedUrls(markdown: string): string[] {
  const urlCharacters = /^[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+$/;
  const spans = [...unwrapped(markdown).matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? "");
  return [
    ...new Set(
      spans.filter((span) => span.length >= 8 && span.includes("/") && urlCharacters.test(span)),
    ),
  ];
}

/**
 * Does this url spell an explicit `user:pw@` credential?
 *
 * The `[Unreleased]` block's own Changed entry draws this line — "for an
 * ordinary input, not only for an attack shape" — and semver rule 8 requires an
 * ORDINARY input per direction. A url on the wrong side of this predicate does
 * not satisfy the rule.
 */
const SPELLS_A_CREDENTIAL = /[^/@:]+:[^/@]*@/;

describe.skipIf(!distExists)("the `[Unreleased]` block, against semver rule 8", () => {
  test("VERIFIED: the block claims only the direction that has a witness", () => {
    // REQUALIFIED IN ROUND 19, BY R19-H4-01. This test used to read the block's
    // claim that the record "moved in both directions", and it read it as a
    // premise: the rest of this section then asks whether the block names an
    // ordinary input per direction. Round 19 measured the directions against a
    // REBUILT 2.0.1 tree and found the keeps-more direction had no witness at
    // all, so the block dropped the claim rather than the input.
    //
    // Round 19 re-measured after the redaction fixes of that round landed, and
    // the answer did not change: over the 5,600-url corpus of
    // `round19-h4-surface.spec.ts` the record is shorter than 2.0.1's on 2,264
    // rows and longer on none. Those fixes only reduce what a build inside this
    // unreleased window over-removed; they never return a byte the published
    // package had already dropped.
    //
    // The pin therefore reads the requalified sentence AND asserts the retracted
    // one is gone. It turns red if the claim comes back — and a round that means
    // to bring it back must supply the witness that
    // `round19-h4-surface.spec.ts` > "every direction the block names is a
    // direction some input actually took" demands, and update both pins in the
    // same commit.
    expect(unwrapped(repoText("RELEASING.md"))).toContain(
      "`CHANGELOG.md` states each direction the output moved, and names one ordinary input per direction.",
    );
    expect(unwrapped(unreleasedBlock())).toContain(
      "`redactUrl`'s output moved for an ordinary input, not only for an attack shape.",
    );
    expect(unwrapped(unreleasedBlock())).not.toContain("moved in both directions");
  });

  test("the block names an ordinary input whose record actually moves", async () => {
    // R18-H4-02.
    //
    // Rule 8 binds `toJSON().url` and requires the changelog to name one
    // ORDINARY input per direction. The block names four complete urls. Two of
    // them spell `user:pw@`, which its own text calls an attack shape. The
    // other two — `/go/file:/Users/alice@corp/report.pdf` and
    // `file:///c:/Users/alice@corp/x` — are ordinary, and the built package
    // emits both of them BYTE FOR BYTE. So no reader of the block can see the
    // direction that ordinary inputs took, and RELEASING.md step 1 copies the
    // block verbatim into the published `## [X.Y.Z]` section, which makes the
    // omission permanent.
    //
    // The direction they took is the one the test below exhibits, and
    // `SECURITY.md` already carries it as a residual with a complete input:
    // a credential-free proxy url loses the host the request contacted and
    // promotes a later path segment to look like one. The block says a
    // consumer's alert "sees a different string after this upgrade … even for a
    // url that carried no credential at all", and then names no such url.
    const named = namedUrls(unreleasedBlock());
    const ordinary = named.filter((url) => !SPELLS_A_CREDENTIAL.test(url));
    expect(ordinary.length, "the block must name at least one ordinary url").toBeGreaterThan(0);

    const moved: string[] = [];
    for (const url of ordinary) if ((await emittedUrl(url)) !== url) moved.push(url);

    expect(
      moved,
      `RELEASING.md semver rule 8 requires CHANGELOG.md to name one ordinary input per ` +
        `direction the redacted url moved. Every credential-free url the [Unreleased] block ` +
        `names — ${JSON.stringify(ordinary)} — is emitted unchanged by dist, so the block ` +
        `names an input for no direction a consumer without a credential in a url can observe`,
    ).not.toEqual([]);
  });

  test("EVIDENCE: an ordinary proxy url the block never names loses its host", async () => {
    // The input `SECURITY.md` names in its "An embedded URL loses the authority
    // the parser reads" residual. It carries no credential, it is well formed,
    // and after this release the record names `example.com` — a host the
    // request never contacted — and drops `cdn.test`, the host it did. This is
    // what the block owed rule 8 an input for.
    const ordinary = "https://api.test/proxy/https://cdn.test/img/alice@example.com/avatar.png";

    expect(SPELLS_A_CREDENTIAL.test(ordinary)).toBe(false);
    expect(unwrapped(repoText("SECURITY.md"))).toContain(ordinary);
    expect(await emittedUrl(ordinary)).toBe(
      "https://api.test/proxy/https://example.com/avatar.png",
    );
    expect(unreleasedBlock()).not.toContain("cdn.test");
  });
});

// ── Step 9, the advisory ─────────────────────────────────────────────────

describe("release-checklist step 9, against SECURITY.md", () => {
  /** The reporting channels SECURITY.md actually offers, read from the file. */
  function reportingChannels(): string[] {
    const security = repoText("SECURITY.md");
    const start = security.indexOf("## Reporting a Vulnerability");
    expect(start, "SECURITY.md must keep a reporting section").not.toBe(-1);
    const section = unwrapped(security.slice(start));
    const channels: string[] = [];
    if (section.includes("/security/advisories")) channels.push("GitHub Security Advisories");
    if (/by email to \S+@\S+/.test(section)) channels.push("email");
    return channels;
  }

  test("VERIFIED: step 9 exists and publishes a GitHub Security Advisory draft", () => {
    const releasing = unwrapped(repoText("RELEASING.md"));

    expect(releasing).toContain("9. **Publish the security advisory.**");
    expect(releasing).toContain("Publish the draft after step 8 confirms the version is live");
  });

  test("every channel SECURITY.md offers leaves the draft step 9 adds a version to", () => {
    // R18-H4-03.
    //
    // Step 9's whole procedure rests on one premise: "`SECURITY.md` sends every
    // reporter to GitHub Security Advisories, so a reported fix already has a
    // private draft there. Add the fixed version to that draft."
    //
    // SECURITY.md offers a SECOND channel, and a mail message creates no draft.
    // For a vulnerability reported by email the maintainer reaches step 9, is
    // told the draft is already there, finds none, and there is no step that
    // creates one. Step 9's only escape is "If the release fixes no reported
    // vulnerability, skip this step" — which does not cover a fix that WAS
    // reported, through the channel the same document offers. The result is the
    // outcome step 9 names as the reason it exists: "A shipped fix with a
    // private advisory leaves no public record that a consumer scanner can
    // read" — except with no advisory at all.
    // FIXED IN ROUND 18, and the maintainer chose WHICH END to fix. The first
    // fix narrowed the policy to one channel so step 9's premise became true.
    // The maintainer reverted that: a security policy is the public contract
    // with a reporter, and narrowing who can report privately to make an
    // internal checklist consistent is the wrong trade. Step 9 covers both
    // channels now.
    //
    // So the assertion is no longer "the policy names one channel". It is the
    // property the test was always for: EVERY channel the policy offers leaves
    // step 9 a draft to publish — either because the channel created one, or
    // because step 9 opens it.
    const releasing = repoText("RELEASING.md");
    const checklist = releasing.slice(releasing.indexOf("## Release checklist"));
    const step9 = unwrapped(checklist.slice(0, checklist.indexOf("## Semver policy")));

    expect(reportingChannels().length).toBeGreaterThan(1);
    expect(
      step9,
      "step 9 must not assume a draft exists for every reporter, because email creates none",
    ).not.toContain("`SECURITY.md` sends every reporter to");
    expect(
      step9,
      "step 9 must name the channel that creates no draft, and open one for it",
    ).toMatch(/email creates none: open the draft yourself/);
  });
});

// ── The number the policy permits ────────────────────────────────────────

type ReleaseGate = {
  validateRelease: (candidate: Record<string, unknown>) => { distTag: string };
};

const loadReleaseGate = async (): Promise<ReleaseGate> =>
  (await import(
    /* @vite-ignore */ new URL("../../scripts/validate-release.mjs", import.meta.url).href
  )) as ReleaseGate;

/** A changelog with the pending block already moved into `## [version]`. */
const changelogCutAt = (version: string): string =>
  [
    "# Changelog",
    "",
    "## [Unreleased]",
    "",
    `## [${version}] - 2026-08-09`,
    "",
    "### Changed",
    "",
    "- The redacted url moved.",
    "",
    `[Unreleased]: https://github.com/pbpeterson/typed-fetch/compare/v${version}...HEAD`,
    `[${version}]: https://github.com/pbpeterson/typed-fetch/compare/v2.0.1...v${version}`,
    "",
  ].join("\n");

describe("the version this tree can cut", () => {
  test("VERIFIED: nothing has been cut, and the uncut block blocks every tag", () => {
    const manifest = JSON.parse(repoText("package.json")) as { version: string };
    const block = unreleasedBlock();

    expect(manifest.version).toBe("2.0.1");
    expect(block).toContain("### Security");
    expect(block).toContain("### Changed");
    // The gate that stops a tag today, named from its own source.
    expect(repoText("scripts/validate-release.mjs")).toContain(
      "The CHANGELOG [Unreleased] section must be empty before publishing.",
    );
  });

  test("EVIDENCE: 2.1.0 is reachable, and so is the 2.0.2 the policy forbids", async () => {
    // What a maintainer must run is release-checklist step 1: move the block
    // into `## [2.1.0] - <date>`, leave `[Unreleased]` empty, rewrite the two
    // footer links, then steps 2 through 9. Rule 8 fixes the MINOR, because the
    // block itself declares that `toJSON().url` moved.
    //
    // What would break on the 2.0.2 path is nothing. `validate-release` decides
    // publishing identity, tag alignment and changelog shape from release
    // metadata alone; RELEASING.md says so and explains why it cannot hold
    // rule 7. Rule 8 has no such paragraph and no gate either, so the forbidden
    // patch passes the same gate the permitted minor does, and npm receives a
    // patch that moves the field a consumer's alert rule is built on.
    const { validateRelease } = await loadReleaseGate();
    const candidate = (version: string): Record<string, unknown> => ({
      tag: `v${version}`,
      refType: "tag",
      packageName: "@pbpeterson/typed-fetch",
      version,
      repositoryUrl: "git+https://github.com/pbpeterson/typed-fetch.git",
      publishAccess: "public",
      provenance: true,
      changelog: changelogCutAt(version),
      headCommit: "0".repeat(40),
      tagCommit: "0".repeat(40),
      mainCommit: "0".repeat(40),
    });

    expect(validateRelease(candidate("2.1.0"))).toEqual({ distTag: "latest" });
    expect(validateRelease(candidate("2.0.2"))).toEqual({ distTag: "latest" });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. THE R16-ORCH-01 SHAPE, SWEPT ONCE MORE.
//
// A check whose assertion reads something other than what it guards. Round 16
// had two and round 17 found both. Round 17 then wrote pins of its own, and one
// of them has the same shape: `tests/surface/round17-h4-surface.spec.ts` carries
// a test named "EVIDENCE: `coverage` is a real script, and its thresholds are
// the four at 100" whose whole reading of the thresholds is
// `expect(repoText("vitest.config.ts")).toContain("thresholds: {")`.
//
// Three documents now state the number that assertion does not read: both
// workflow steps ("Enforce the 100 percent statements/branches/functions/lines
// thresholds") and CONTRIBUTING's roster line ("100% on src/, scripts/ and
// fixtures/ — the threshold is enforced").
//
// The proof is differential and drives the REAL pin: the same repository, the
// same spec file, one line of `vitest.config.ts` changed.
// ═══════════════════════════════════════════════════════════════════════════

describe("the coverage threshold pin, driven against a lowered threshold", () => {
  const PIN = "its thresholds are the four at 100";

  /**
   * Round 17's pin, run over a repository whose `vitest.config.ts` carries
   * `mutated` in place of `anchor`. Answers the pin's exit status.
   *
   * A COPY OF THE SPEC IN A ROOT OF SYMLINKS, the shape round 17 established:
   * the pin resolves every document it reads from its own `import.meta.url`, so
   * copying the one file and linking the rest is what lets the config under it
   * be a different file while everything else stays the repository's own.
   */
  function pinExitCode(anchor: string, mutated: string): number {
    const root = mkdtempSync(join(tmpdir(), "tf-round18-h4-"));
    try {
      mkdirSync(join(root, "tests", "surface"), { recursive: true });
      copyFileSync(
        join(REPO_ROOT, "tests/surface/round17-h4-surface.spec.ts"),
        join(root, "tests/surface/round17-h4-surface.spec.ts"),
      );
      for (const entry of [
        ".github",
        "CHANGELOG.md",
        "CONTRIBUTING.md",
        "README.md",
        "RELEASING.md",
        "SECURITY.md",
        "package.json",
        "dist",
        "fixtures",
        "node_modules",
        "src",
      ]) {
        if (existsSync(join(REPO_ROOT, entry)))
          symlinkSync(join(REPO_ROOT, entry), join(root, entry));
      }
      symlinkSync(
        join(REPO_ROOT, "tests/surface/__snapshots__"),
        join(root, "tests/surface/__snapshots__"),
      );

      const config = repoText("vitest.config.ts");
      expect(config, "vitest.config.ts must still spell its thresholds this way").toContain(anchor);
      writeFileSync(join(root, "vitest.config.ts"), config.replace(anchor, mutated));

      // A clean environment: this runs inside a vitest worker, and the child
      // must not inherit the parent run's pool bookkeeping.
      const env = Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !key.startsWith("VITEST")),
      );
      const child = spawnSync(
        process.execPath,
        [
          join(REPO_ROOT, "node_modules/vitest/vitest.mjs"),
          "run",
          "--root",
          root,
          "-t",
          PIN,
          "--pool=threads",
          "--maxWorkers=1",
          "--fileParallelism=false",
        ],
        { cwd: root, encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] },
      );
      expect(
        child.stdout,
        `the pin did not run in the copied root:\n${child.stdout}\n${child.stderr}`,
      ).toMatch(/Test Files {2}1 (?:passed|failed)/);
      return child.status ?? 1;
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }

  test("EVIDENCE: removing the thresholds block entirely does fail it", () => {
    // The half that works, and the reason the pin's name reads as true. Without
    // this the test below could be failing because the harness is broken.
    expect(pinExitCode("thresholds: {", "thresholdsRemoved: {")).not.toBe(0);
  }, 120_000);

  test("lowering a threshold from 100 to 0 leaves the pin green", () => {
    // R18-H4-04.
    //
    // The pin is named "its thresholds are the four at 100" and it reads only
    // that the literal `thresholds: {` appears in the config. Every number
    // behind that brace is invisible to it, and no other test in this
    // repository reads them — `thresholds` appears in `tests/` and `scripts/`
    // exactly twice, both in that one test.
    //
    // So the edit below passes `pnpm test`, passes `pnpm coverage` (a 0 percent
    // floor is met by any tree), and passes the two workflow steps round 17
    // added, whose own comments promise the four thresholds at 100. The gate
    // round 17 wired into CI to stop coverage regressing can itself be turned
    // off in one line with nothing to catch it — the R16-ORCH-01 shape, in a
    // pin the same round wrote.
    expect(
      pinExitCode("branches: 100,", "branches: 0,"),
      "tests/surface/round17-h4-surface.spec.ts names its pin 'its thresholds are the four at " +
        "100' and asserts only that vitest.config.ts contains the text `thresholds: {`; both " +
        "workflow steps and CONTRIBUTING's roster line state the number 100, and lowering " +
        "`branches` to 0 leaves every one of those checks green",
    ).not.toBe(0);
  }, 120_000);
});
