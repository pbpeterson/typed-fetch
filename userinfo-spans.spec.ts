import { describe, expect, test } from "vitest";
import {
  HIERARCHICAL_SCHEMES,
  isIgnored,
  isSchemeCharacter,
  isSolidus,
  isStripped,
  parseProbe,
  pathUserinfoSpans,
  seamSpan,
  type Span,
  userinfoSpans,
} from "./src/errors/userinfo-spans";

/**
 * THE SCANNER, ASSERTED AS SPANS.
 *
 * `src/errors/userinfo-spans.ts` answers one question — where does this text
 * spell a credential the URL parser did not report as one — and answers it with
 * positions. Every fact in this file used to be reachable only as a
 * whole-string diff through `redactUrl`, which is a test of the EMITTER for a
 * defect in the SCANNER: a span one character wide and a rebuild that moved the
 * text produce the same red line, and neither says which one moved. So each
 * test here names an index.
 *
 * The other suites keep their jobs. `redact-url.spec.ts` owns the emitted url,
 * `redaction-oracle.spec.ts` judges any output against the platform and the
 * written contract, and the `redaction-*` files own the shapes each audit round
 * found. Nothing here duplicates them: this file asserts the interface those
 * suites reach through.
 */

/** The spans as `[start, end]` pairs, which is the shape an assertion reads in. */
function spansOf(text: string, seam: Span | null = null): [number, number][] {
  return userinfoSpans(text, seam).map((span) => [span.start, span.end]);
}

/** What each span covers, which is what a removal takes out. */
function coveredBy(text: string, seam: Span | null = null): string[] {
  return userinfoSpans(text, seam).map((span) => text.slice(span.start, span.end));
}

describe("userinfoSpans — where a credential sits, as positions", () => {
  test("a text with no authority mark has no span", () => {
    expect(spansOf("/v1/things")).toEqual([]);
    expect(spansOf("/users/alice")).toEqual([]);
  });

  test("the full mark opens a region, and the span ends after the `@`", () => {
    expect(spansOf("/go/https://svc:hunter2@internal.test/v1")).toEqual([[12, 24]]);
    expect(coveredBy("/go/https://svc:hunter2@internal.test/v1")).toEqual(["svc:hunter2@"]);
    // The scheme can be missing entirely: a template that produced an empty one
    // is the ordinary way a malformed authority reaches this scan.
    expect(spansOf("://svc:hunter2@internal.test/v1")).toEqual([[3, 15]]);
  });

  test("a SPECIAL scheme opens its region over one solidus, and over none", () => {
    expect(spansOf("/go/https:/svc:pw@host")).toEqual([[11, 18]]);
    expect(spansOf("/go/https:svc:pw@host")).toEqual([[10, 17]]);
    // A solidus is `/` or `\` under a special scheme, and the count is any.
    expect(coveredBy("/go/https:\\svc:pw@host")).toEqual(["svc:pw@"]);
    // ASCII case-insensitive, and a whole token: `xhttps:` is not `https:`.
    expect(spansOf("/go/HTTPS:/svc:pw@host")).toEqual([[11, 18]]);
    expect(spansOf("/go/xhttps:/svc:pw@host")).toEqual([]);
  });

  test("a NON-special scheme reaches an authority only at two solidi", () => {
    // Residual 2, as a span rather than as an emitted url.
    expect(spansOf("/go/git:/svc:pw@host")).toEqual([]);
    expect(spansOf("/go/git://svc:pw@host")).toEqual([[10, 17]]);
    // Two solidi open a region under a scheme nothing has heard of.
    expect(spansOf("/go/zz://svc:pw@host")).toEqual([[9, 16]]);
  });

  test("`file:` is the special scheme that opens nothing under fewer than two solidi", () => {
    expect(spansOf("/go/file:/svc:pw@host")).toEqual([]);
    expect(spansOf("/go/file://svc:pw@host")).toEqual([[11, 18]]);
    // Which is what keeps a real path whole: `/Users/alice@corp` is a segment.
    expect(spansOf("/go/file:/Users/alice@corp/x")).toEqual([]);
  });

  test("a Windows drive letter opens no region at all", () => {
    expect(spansOf("/c:/Users/alice@corp/x")).toEqual([]);
  });

  test("an `@` a path spells at the head of a segment is not a credential", () => {
    expect(spansOf("/users/@alice")).toEqual([]);
    expect(spansOf("/@scope/pkg")).toEqual([]);
  });

  test("EVERY occurrence, not the first", () => {
    const text = "/go/http://plain.test/then/https://svc:hunter2@internal.test/v1";
    expect(spansOf(text)).toEqual([[35, 47]]);
    const two = "://a:1@one.test/x://b:2@two.test/y";
    expect(coveredBy(two)).toEqual(["a:1@", "b:2@"]);
  });

  test("one region, every `@` asked — the span is the union of the yes answers", () => {
    // The region's LAST `@` belongs to `/@alice`, which reads as a path. Asking
    // only that one left the credential in front of it unasked.
    expect(coveredBy("/go/https://TOKEN@cdn.test/img/@alice")).toEqual(["TOKEN@"]);
  });

  test("a region the parser can read ends at the next mark", () => {
    // `YWxpY2U` is a host the parser accepts, so the `://` after it starts a url
    // of its own and bounds the region. The base64 credential survives — the
    // residual this module states rather than closes.
    expect(coveredBy("/go/https://YWxpY2U/cGFzc3dvcmQ://x@host")).toEqual(["x@"]);
  });

  test("a region the parser CANNOT read has no end, so a later mark cannot cut it", () => {
    // `alice:s3cret` is not a host with a port, so the `://` a password spelled
    // is not a terminator and the whole credential goes.
    expect(coveredBy("/go/https://alice:s3cret://x@internal.test/v1")).toEqual([
      "alice:s3cret://x@",
    ]);
  });

  test("`@` alone is a span of exactly one character", () => {
    // The needle pass drops it. A one-character span reaching `replaceAll`
    // would strip every `@` from a message.
    expect(spansOf("://@host/x")).toEqual([[3, 4]]);
    expect(coveredBy("://@host/x")).toEqual(["@"]);
  });

  test("what the removal would expose goes with it — solidi and dot segments", () => {
    // `/x//@./@./y` spells one empty userinfo per dot segment. A span that
    // stopped at the `@` left a `.` at the head of a segment, which the rebuild
    // deletes, which uncovers the next `@` — one group per pass.
    expect(spansOf("/x//@./@./y")).toEqual([[4, 10]]);
    expect(coveredBy("/x//@./@./y")).toEqual(["@./@./"]);
  });
});

describe("the spans are a removal a caller can apply without reading them again", () => {
  const HEADS = ["", "/", "//", "///", "/go/"];
  const SCHEMES = ["", "https:", "https://", "https:/", "file:", "file://", "git:/", "zz://"];
  const CREDENTIALS = ["", "svc:PW@", "token@", "a:b@c:d@", ":@", "@", "x@./"];
  const HOSTS = ["i.test", "i.test:8443", "", "host/deep", "c:"];
  const TAILS = ["", "/v1", "/a/../b", "/users/@alice", "/file..@"];

  test("ascending, disjoint, in bounds, and never over index 0 of a path", () => {
    const notAscending: string[] = [];
    const outOfBounds: string[] = [];
    const holdsNoAt: string[] = [];
    const tookTheLeadingSolidus: string[] = [];
    let measured = 0;

    for (const head of HEADS) {
      for (const scheme of SCHEMES) {
        for (const credential of CREDENTIALS) {
          for (const host of HOSTS) {
            for (const tail of TAILS) {
              const text = head + scheme + credential + host + tail;
              for (const seam of [null, seamSpan(text)]) {
                measured += 1;
                let cursor = 0;
                for (const span of userinfoSpans(text, seam)) {
                  if (span.start < cursor || span.end <= span.start) notAscending.push(text);
                  if (span.end > text.length) outOfBounds.push(text);
                  if (!text.slice(span.start, span.end).includes("@")) holdsNoAt.push(text);
                  // The rebuild joins an origin to this text, so index 0's `/`
                  // is what keeps a redaction from moving the HOST it names.
                  if (span.start === 0 && text.startsWith("/")) tookTheLeadingSolidus.push(text);
                  cursor = span.end;
                }
              }
            }
          }
        }
      }
    }

    expect({
      measured,
      notAscending: notAscending.slice(0, 4),
      outOfBounds: outOfBounds.slice(0, 4),
      holdsNoAt: holdsNoAt.slice(0, 4),
      tookTheLeadingSolidus: tookTheLeadingSolidus.slice(0, 4),
    }).toEqual({
      measured: 14_000,
      notAscending: [],
      outOfBounds: [],
      holdsNoAt: [],
      tookTheLeadingSolidus: [],
    });
  });
});

describe("seamSpan — the mark an origin and a path spell between them", () => {
  test("the credential the parser read out of an authority it took", () => {
    // `file:///svc:pw@host/v1` has the empty host, so the parser reports no
    // username and the emitted `file://` + `/svc:pw@host/v1` spells the mark
    // whole to the next reader.
    expect(seamSpan("/svc:pw@host/v1")).toEqual({ start: 1, end: 8 });
    expect(seamSpan("//svc:pw@host/v1")).toEqual({ start: 2, end: 9 });
  });

  test("a path with no `@` before the authority ends has no seam", () => {
    expect(seamSpan("/v1/things")).toBeNull();
    // A Windows path: the authority ends at the first solidus, so the `@` in
    // `alice@corp` is never even asked about.
    expect(seamSpan("/c:/Users/alice@corp/x")).toBeNull();
  });

  test("an `@` with nothing in front of it names no userinfo", () => {
    expect(seamSpan("/@api.test/v1")).toBeNull();
  });

  test("the empty userinfo the parser consumed is still a userinfo", () => {
    // `:@` normalises away — `new URL("https://:@x/").href` is `https://x/` —
    // so a parse that reported neither a username nor a password used to read
    // as "no credential" and left the password behind it.
    expect(new URL("https://:@x/").href).toBe("https://x/");
    expect(seamSpan("/:@./alice:pw@internal.test/v1")).toEqual({ start: 1, end: 14 });
  });

  test("asked again of what its own answer leaves behind", () => {
    // Removing the first authority rejoins the origin's solidi to what follows,
    // so the next mark is a consumed mark all over again.
    expect(seamSpan("///hunter2-:@/file..@")).toEqual({ start: 3, end: 21 });
  });
});

describe("the seam and an ordinary region that open at the same place are one region", () => {
  test("the seam is a FLOOR where a region opens at its start", () => {
    const text = "//svc:PW@i.test/users/@alice";
    expect(seamSpan(text)).toEqual({ start: 2, end: 9 });
    // The parser's answer and the heuristic's are one span with two answers.
    // The parser says the credential ends at `PW@`, and the text after it reads
    // as a path, so the region ends there too.
    expect(spansOf(text, seamSpan(text))).toEqual([[2, 9]]);
    // Without it the region has only the heuristic, which reaches the last `@`.
    expect(spansOf(text)).toEqual([[2, 23]]);
  });

  test("under ONE leading solidus the parser's answer stands by itself", () => {
    // No ordinary region opens at index 1, so the seam is a span of its own.
    const text = "/x@/y@z";
    expect(spansOf(text, seamSpan(text))).toEqual([[1, 6]]);
    expect(spansOf(text)).toEqual([]);
  });
});

describe("pathUserinfoSpans — the one state that reads past the path", () => {
  test("a path that ends INSIDE an authority is read as far as the tail", () => {
    // The outer `?` cut the embedded authority mid-credential, so the `@` that
    // closes it is on the other side and there is no `@` left in the path.
    const path = "/go/https://svc:hun";
    expect(pathUserinfoSpans(path, "", null)).toEqual([]);
    expect(pathUserinfoSpans(path, "?ter2@host/v1", null)).toEqual([{ start: 12, end: 25 }]);
    // FOUND past the path, and the caller clips it: the span reaches beyond the
    // path it was asked about.
    expect(path.length).toBe(19);
  });

  test("a path whose embedded authority is COMPLETE never reads the tail", () => {
    // The embedded url reached `/img`, so the `?` starts its query and the `@`
    // in that query is an e-mail address rather than a terminator.
    expect(
      pathUserinfoSpans("/proxy/https://cdn.test/img", "?owner=alice@example.com", null),
    ).toEqual([]);
  });

  test("an empty tail asks nothing, because both answers are the same text", () => {
    const path = "/go/https://svc:pw@host/x";
    expect(pathUserinfoSpans(path, "", null)).toEqual(userinfoSpans(path));
  });

  test("the seam arrives as a span, so the scanner never reads a `URL`", () => {
    const path = "/svc:pw@host/v1";
    expect(pathUserinfoSpans(path, "", seamSpan(path))).toEqual([{ start: 1, end: 8 }]);
  });
});

describe("parseProbe — one parse, read rather than discarded", () => {
  test("a text the parser refuses answers `null`", () => {
    expect(parseProbe("nope")).toBeNull();
    expect(parseProbe("https://")).toBeNull();
  });

  test("a text that parses answers the URL, so a caller can read what it needs", () => {
    expect(parseProbe("https://api.test/x")?.host).toBe("api.test");
  });

  test("a base resolves a relative reference", () => {
    expect(parseProbe("/a", "http://b.test")?.href).toBe("http://b.test/a");
    expect(parseProbe("//", "http://b.test")).toBeNull();
  });
});

describe("the character classes both files read", () => {
  test("a solidus is `/` or `\\`, and nothing else", () => {
    expect([...`/\\`].every((character) => isSolidus(character))).toBe(true);
    expect([...`:?#. a`].some((character) => isSolidus(character))).toBe(false);
    expect(isSolidus(undefined)).toBe(false);
  });

  test("the parser removes tab, LF and CR from anywhere", () => {
    expect([..."\t\n\r"].every((character) => isIgnored(character))).toBe(true);
    expect(isIgnored(" ")).toBe(false);
    expect(isIgnored(undefined)).toBe(false);
  });

  test("it strips a wider set from the two ENDS: every C0 control, and the space", () => {
    // Wider than the ignored set, and a separate step of the URL Standard. One
    // leading space moves nothing for the parser and moved a scheme for a
    // reader that knew only the narrow set.
    expect(isStripped(" ")).toBe(true);
    expect(isStripped("\0")).toBe(true);
    expect(isStripped("\v")).toBe(true);
    expect(isStripped("\u001f")).toBe(true);
    expect(isStripped("!")).toBe(false);
    expect(isStripped(undefined)).toBe(false);
  });

  test("a scheme is spelled from ALPHA, DIGIT, `+`, `-` and `.`", () => {
    expect([..."aZ9+-."].every((character) => isSchemeCharacter(character))).toBe(true);
    expect([..."/:@ \\"].some((character) => isSchemeCharacter(character))).toBe(false);
    expect(isSchemeCharacter(undefined)).toBe(false);
  });
});

describe("HIERARCHICAL_SCHEMES is the one list both derivations read", () => {
  test("the six schemes whose path is structure rather than a value", () => {
    expect([...HIERARCHICAL_SCHEMES]).toEqual(["http", "https", "ws", "wss", "ftp", "file"]);
  });

  test("every one of them is a scheme the URL parser knows", () => {
    for (const scheme of HIERARCHICAL_SCHEMES) {
      expect(new URL(`${scheme}://host/x`).protocol).toBe(`${scheme}:`);
    }
  });
});
