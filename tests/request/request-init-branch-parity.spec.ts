import http from "node:http";
import net from "node:net";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { distExists, loadRootEsm, warnWhenDistMissing } from "../../fixtures/built-package";

// Round 18, lane H1 — the request path, measured through the BUILT package
// against servers this file owns, including two the fixture cannot produce.
//
// ── THE INSTRUMENT, and what it reaches that round 17's differential could not
//
// Round 17 changed the instrument once: it loaded `dist/` and compared
// `typedFetch` against a bare `fetch` over one real socket. It then wrote down
// four things it could NOT draw, and this file is those four.
//
//  1. IT MEASURES EVERY MEMBER OF THE INIT, ON BOTH BRANCHES OF THE FACADE.
//     Round 17 measured five reads of ONE member — `fetch` — on ONE branch, and
//     found a false sentence. `snapshotRequestInit` has TWO branches, chosen by
//     `Object.hasOwn(options, "fetch")`, and the whole existing corpus for the
//     init (`tests/request/request-plan.spec.ts`, "the init the transport
//     reads") passes a `fetch` option in EVERY case, so one of the two has
//     never been read at all. Section A crosses the fifteen `RequestInit`
//     members the Fetch Standard declares with own-versus-inherited and with
//     both branches — sixty cells, each measured through `dist/` on the init a
//     real transport received — and compares every cell to the caller's own
//     object. Exactly one cell disagrees between the branches. It is the
//     finding.
//
//  2. IT KILLS THE BODY MID-READ. `fixtures/http-server.ts` answers with
//     `res.end()`, so no suite in this repository has ever driven a response
//     whose body dies after the headers arrive. Section B builds a `node:net`
//     server that truncates a `Content-Length` and that resets a chunked body
//     mid-stream, and reads the envelope, `text()`, and `cancel()` on both
//     sides of the differential.
//
//  3. IT ASKS WHETHER PHASE 3 CAN REFUSE A GENUINE RESPONSE AT ALL. Round 17
//     could not draw a structural refusal from a platform value. Section C
//     hands genuine socket-backed responses — ten of them spelled by hand on
//     the wire — to an INJECTED transport that only returns them, so the
//     transport cannot fail and any `NetworkError` is necessarily a phase 3
//     refusal. None is.
//
//  4. IT LETS THE PLATFORM PICK THE INTERLEAVING. Section D drives one
//     `AbortController` across twelve concurrent in-flight calls, a timeout
//     that fires inside a redirect chain, and an abort raised between two calls
//     that share one `Response`.
//
// Everything here passes on HEAD except section A's second test. That test is
// the finding, and its comment names the branch, the sentence, and the sibling
// test in `request-plan.spec.ts` that stops one line short of it.

warnWhenDistMissing("request-init-branch-parity", distExists);

/** The built root entry's public shape. A type-only reference to `src/`. */
type PublicApi = typeof import("../../src/index");

let builtPackage: Promise<PublicApi> | undefined;

/** The built package, loaded once for the file. */
function api(): Promise<PublicApi> {
  builtPackage ??= loadRootEsm<PublicApi>();
  return builtPackage;
}

/**
 * The platform's own `fetch`, captured at module scope.
 *
 * Several tests here replace `globalThis.fetch` for the length of one call —
 * that is how a transport reaches the branch of `snapshotRequestInit` no
 * `fetch` option selects — and the differential needs a binding the
 * replacement cannot reach. Every such test loads `dist/` FIRST, because a
 * package loaded during the window would capture the replacement as its native
 * transport and take the ambient branch on the wrong value.
 */
const NATIVE_FETCH = globalThis.fetch;

/** Install a transport as the global for one call, and always put it back. */
async function withGlobalTransport<T>(transport: typeof fetch, run: () => Promise<T>): Promise<T> {
  const globals = globalThis as { fetch: typeof fetch };
  globals.fetch = transport;
  try {
    return await run();
  } finally {
    globals.fetch = NATIVE_FETCH;
  }
}

// ── The servers this file owns ─────────────────────────────────────────────

interface ControlServer {
  /** A target. `tag` names the exchange in {@link received} and {@link finished}. */
  url(params?: Record<string, string | number>): string;
  /** Tags the server has RECEIVED a request for. */
  received(): readonly string[];
  /** Tags the server has FINISHED a response for. A cancelled request is absent. */
  finished(): readonly string[];
}

/**
 * An ordinary HTTP server that reports both halves of an exchange.
 *
 * `fixtures/http-server.ts` reports neither, and this file needs both: the
 * observable that separates a GOVERNED request from an ungoverned one is
 * whether the server finished writing a response the caller had already
 * aborted. A response cancelled by the client clears its own timer, so a tag
 * reaching {@link ControlServer.finished} means the request ran to completion.
 */
function useControlServer(): ControlServer {
  let base = "";
  let server: http.Server;
  const received: string[] = [];
  const finished: string[] = [];

  beforeAll(async () => {
    server = http.createServer((request, response) => {
      const parsed = new URL(request.url ?? "/", "http://control.invalid");
      const tag = parsed.searchParams.get("tag") ?? "";
      const status = Number(parsed.searchParams.get("status") ?? 200);
      const delay = Number(parsed.searchParams.get("delay") ?? 0);
      const location = parsed.searchParams.get("location");
      const body = parsed.searchParams.get("body") ?? "";
      received.push(tag);

      const timer = setTimeout(() => {
        if (location !== null) response.setHeader("Location", location);
        response.setHeader("Content-Type", "text/plain");
        response.writeHead(status);
        response.end(body);
        finished.push(tag);
      }, delay);
      // A request the client cancelled must never reach `finished`.
      response.on("close", () => clearTimeout(timer));
    });

    await new Promise<void>((resolve) => {
      server.listen(0, () => resolve());
    });
    base = `http://localhost:${(server.address() as net.AddressInfo).port}`;
  });

  afterAll(() => {
    server.close();
  });

  return {
    url(params = {}) {
      const search = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) search.append(key, String(value));
      return `${base}/?${search}`;
    },
    received: () => received,
    finished: () => finished,
  };
}

/** A raw TCP server, so a response can be spelled byte by byte — or cut short. */
interface RawServer {
  url(path: string): string;
}

/**
 * The responses `node:http` will not write.
 *
 * Two of them are the point of section B: a `Content-Length` the server never
 * satisfies, and a chunked body whose socket is destroyed mid-stream. The rest
 * are status lines a real origin can send and `res.writeHead` cannot — an
 * absent reason phrase, a 999, an informational preamble, HTTP/1.0.
 */
function useRawServer(): RawServer {
  let base = "";
  let server: net.Server;

  beforeAll(async () => {
    server = net.createServer((socket) => {
      // A client abort resets the socket. That is the scenario, not a failure.
      socket.on("error", () => {});
      socket.once("data", (chunk: Buffer) => {
        const line = chunk.toString("utf8").split("\r\n")[0] ?? "";
        const parsed = new URL(line.split(" ")[1] ?? "/", "http://raw.invalid");
        const kind = parsed.pathname.slice(1);
        const status = parsed.searchParams.get("status") ?? "200 OK";

        if (kind === "truncated") {
          // Sixty-four bytes promised, five delivered, then the socket closes.
          socket.write(
            `HTTP/1.1 ${status}\r\nContent-Type: text/plain\r\nContent-Length: 64\r\n\r\nfive!`,
          );
          setTimeout(() => socket.end(), 25);
          return;
        }
        if (kind === "reset") {
          socket.write(
            `HTTP/1.1 ${status}\r\nContent-Type: text/plain\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nfive!\r\n`,
          );
          setTimeout(() => socket.destroy(), 25);
          return;
        }
        if (kind === "cut-before-headers") {
          socket.write("HTTP/1.1 2");
          setTimeout(() => socket.destroy(), 5);
          return;
        }
        socket.end(EXOTIC_RESPONSES[kind] ?? "HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok");
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, () => resolve());
    });
    base = `http://localhost:${(server.address() as net.AddressInfo).port}`;
  });

  afterAll(() => {
    server.close();
  });

  return { url: (path) => `${base}${path}` };
}

/**
 * Genuine responses a real origin can send, spelled on the wire.
 *
 * Section C's question is whether ANY of them can reach a refusal in phase 3,
 * so the set is chosen for the reads phase 3 performs: the status line
 * (`statusOf`), the reason phrase (`statusText`), the header block
 * (`headersOf`, and the success surface's `getSetCookie`), and the body
 * (`hasCompatibleForeignBody`, which accepts `null`).
 */
const EXOTIC_RESPONSES: Readonly<Record<string, string>> = {
  "status-999": "HTTP/1.1 999 Very Odd\r\nContent-Length: 2\r\n\r\nhi",
  "status-599": "HTTP/1.1 599 \r\nContent-Length: 2\r\n\r\nhi",
  "no-reason-phrase": "HTTP/1.1 404\r\nContent-Length: 2\r\n\r\nhi",
  "informational-preamble":
    "HTTP/1.1 103 Early Hints\r\nLink: </s.css>; rel=preload\r\n\r\n" +
    "HTTP/1.1 404 Not Found\r\nContent-Length: 2\r\n\r\nhi",
  "http-1-0": "HTTP/1.0 500 Server Error\r\n\r\nlegacy",
  "no-content": "HTTP/1.1 204 No Content\r\n\r\n",
  "not-modified": "HTTP/1.1 304 Not Modified\r\n\r\n",
  trailers:
    "HTTP/1.1 500 Oops\r\nTransfer-Encoding: chunked\r\nTrailer: X-T\r\n\r\n2\r\nhi\r\n0\r\nX-T: v\r\n\r\n",
  "repeated-set-cookie":
    "HTTP/1.1 403 Forbidden\r\nSet-Cookie: a=1\r\nSet-Cookie: b=2\r\nContent-Length: 2\r\n\r\nhi",
  "undecodable-content-encoding":
    "HTTP/1.1 500 Oops\r\nContent-Encoding: gzip\r\nContent-Length: 4\r\n\r\nJUNK",
};

const control = useControlServer();
const raw = useRawServer();

// ── A. Every member of the init, own versus inherited, on both branches ────

/**
 * The fifteen members the Fetch Standard declares on `RequestInit`, with a
 * value each. `fetch` is deliberately absent: it is this library's own
 * extension, round 17 measured it, and its treatment is the settled sentence
 * this section is the sequel to.
 */
const INIT_MEMBERS: ReadonlyMap<string, unknown> = new Map<string, unknown>([
  ["method", "POST"],
  ["headers", { "x-round18": "1" }],
  ["body", "payload"],
  ["mode", "cors"],
  ["credentials", "same-origin"],
  ["cache", "no-store"],
  ["redirect", "follow"],
  ["referrer", ""],
  ["referrerPolicy", "no-referrer"],
  ["integrity", ""],
  ["keepalive", false],
  ["signal", new AbortController().signal],
  ["window", null],
  ["duplex", "half"],
  ["priority", "auto"],
]);

/**
 * The five channels a transport can use to read one member off its init.
 *
 * The same five round 17 measured for `fetch`, so the two tables are directly
 * comparable. `spread` is the one a FORWARDING transport actually writes.
 */
function readMember(object: object, member: string, value: unknown): string {
  const parts = [
    Reflect.get(object, member) === value ? "get" : "get:MISSING",
    member in object ? "in" : "in:MISSING",
    Reflect.ownKeys(object).includes(member) ? "ownKeys" : "ownKeys:MISSING",
    Object.getOwnPropertyDescriptor(object, member) !== undefined ? "desc" : "desc:MISSING",
    Object.hasOwn({ ...object }, member) ? "spread" : "spread:MISSING",
  ];
  return parts.join(" ");
}

type Ownership = "own" | "inherited";
type Branch = "the fetch option" | "the replaced global";

/**
 * Run one request and report what the transport saw for `member`, beside what
 * the CALLER's own object says for the same member.
 *
 * The transport forwards with a bare request rather than the init it received:
 * this measures the READS, and a `body` on a GET would fail delivery for a
 * reason that has nothing to do with the facade.
 */
async function measureMember(
  member: string,
  ownership: Ownership,
  branch: Branch,
): Promise<{ readonly init: string; readonly caller: string }> {
  const { typedFetch } = await api();
  const value = INIT_MEMBERS.get(member);
  const target = control.url({ tag: `member-${member}` });

  const prototype = ownership === "inherited" ? { [member]: value } : {};
  const options = Object.create(prototype) as Record<string, unknown>;
  if (ownership === "own") options[member] = value;

  let seen = "the transport never ran";
  const transport = (async (_input: unknown, init: RequestInit) => {
    seen = readMember(init, member, value);
    return await NATIVE_FETCH(target);
  }) as unknown as typeof fetch;

  if (branch === "the fetch option") options.fetch = transport;

  const result =
    branch === "the fetch option"
      ? await typedFetch(target, options)
      : await withGlobalTransport(transport, async () => await typedFetch(target, options));

  expect(result.error).toBe(null);
  await result.response?.text();
  return { init: seen, caller: readMember(options, member, value) };
}

describe.skipIf(!distExists)("the init members, on both branches", () => {
  test("every member but `signal` reaches the transport exactly as the caller wrote it", async () => {
    // THE TABLE. Sixty cells: fifteen members × own/inherited × both branches
    // of `snapshotRequestInit`. Each cell is what a real transport read off
    // the init it was handed, and each is compared to the same five reads on
    // the caller's OWN object — the control being what a bare `fetch` wrapper
    // would have seen if `typedFetch` were not between them.
    //
    // The facade is transparent for fourteen of the fifteen, on both branches
    // and under both ownerships. That is the property this test pins, and it
    // is what isolates the one member that is not.
    const divergences: string[] = [];
    let cells = 0;

    for (const branch of ["the fetch option", "the replaced global"] satisfies Branch[]) {
      for (const ownership of ["own", "inherited"] satisfies Ownership[]) {
        for (const member of INIT_MEMBERS.keys()) {
          const { init, caller } = await measureMember(member, ownership, branch);
          cells += 1;
          if (member === "signal") continue;
          if (init !== caller) {
            divergences.push(`${branch} / ${ownership} / ${member}: init "${init}" vs "${caller}"`);
          }
        }
      }
    }

    expect(divergences).toEqual([]);
    expect(cells).toBe(60);
    // Non-vacuity: the reads really do distinguish own from inherited, so the
    // fourteen agreements above are not fourteen readings of one constant.
    const ownRead = await measureMember("method", "own", "the fetch option");
    const inheritedRead = await measureMember("method", "inherited", "the fetch option");
    expect(ownRead.init).toContain("ownKeys ");
    expect(inheritedRead.init).toContain("ownKeys:MISSING");
  }, 60_000);

  test("an inherited signal survives a forwarding transport's spread on both branches", async () => {
    // R18-H1-01.
    //
    // THE ONE CELL OF SIXTY WHERE THE TWO BRANCHES DISAGREE, and its
    // consequence over a real socket.
    //
    // THE SENTENCE, in `src/request-plan.ts`, `snapshotRequestInit`:
    //
    //   "An INHERITED signal still needs the entry, and testing only for an own
    //    descriptor dropped it. A proxy invariant does not require it — the
    //    sanitized target keeps the original prototype — but `{ ...init }`
    //    does, and that spread is what a forwarding transport writes. Without
    //    it the request ran UNGOVERNED while `classifyRequestFailure` went on
    //    treating that signal as the authority: `controller.abort()` cancelled
    //    nothing, and a later network failure was reported as an
    //    `AbortedError`."
    //
    // WHY IT HOLDS ON ONE BRANCH ONLY. That paragraph, and the descriptor it
    // justifies, live inside `if (!removeFetchOverride) { … } ` 's OTHER arm.
    // `removeFetchOverride` is `Object.hasOwn(options, "fetch")`. When the
    // caller passed no own `fetch`, `snapshotRequestInit` returns
    // `new Proxy(options, { get })` — the caller's own object IS the target, so
    // `Reflect.ownKeys` reports the caller's own keys and an inherited `signal`
    // is not among them. `{ ...init }` copies own enumerable keys, so the
    // signal is dropped exactly as the paragraph describes, on the branch the
    // paragraph does not reach.
    //
    // WHY NO EXISTING TEST SEES IT. Every test in `request-plan.spec.ts`'s
    // "the init the transport reads" block passes a `fetch` option, so all of
    // them measure the sanitized branch. The closest one —
    // `request-plan.spec.ts:246`, "an inherited signal is materialized as an
    // own key, so a spread keeps it" — writes `options.fetch =
    // recordingTransport().fetch` one line before it asserts, which is the line
    // that selects the branch that carries the fix.
    //
    // THE INPUT IS ORDINARY, ON BOTH AXES. A per-call options object built as
    // `Object.create(defaults)` over a shared configuration is how a client
    // wrapper carries a default signal; and a transport installed on
    // `globalThis.fetch` is the case `src/request-plan.ts` names twice as
    // first-class — "a replaced `globalThis.fetch` carries no key while being
    // caller code" — and is what every tracing, retry, and mock library does.
    // Neither half is hostile and neither is exotic.
    //
    // WHAT THE CALLER OBSERVES. `controller.abort()` cancels nothing: the
    // server writes the whole response, the socket stays open for its whole
    // life, and the envelope reports a SUCCESS for a request the caller
    // aborted. The same caller code, with the same transport handed over as a
    // `fetch` option instead of installed on the global, reports an
    // `AbortedError`.
    // NON-VACUITY IS BUILT INTO THE TABLE. All four rows run the SAME
    // forwarding transport — one that spreads its init, which is the whole
    // hazard — over the same server and the same abort timing. Three of them
    // are governed. So a failure cannot be blamed on the spread as such, on
    // the wrapper, on the server, or on the timing: the only thing that moves
    // between the passing rows and the failing one is where the caller wrote
    // `signal` and where the caller installed the transport.
    const { typedFetch, isAbortError } = await api();

    async function drive(
      ownership: Ownership,
      branch: Branch,
    ): Promise<{
      readonly spreadKeepsSignal: boolean;
      readonly outcome: string;
      readonly serverFinished: boolean;
    }> {
      const tag = `abort-${ownership}-${branch === "the fetch option" ? "option" : "global"}`;
      const target = control.url({ tag, delay: 400 });
      const controller = new AbortController();

      const prototype = ownership === "inherited" ? { signal: controller.signal } : {};
      const options = Object.create(prototype) as Record<string, unknown>;
      if (ownership === "own") options.signal = controller.signal;

      let spreadKeepsSignal = false;
      const measured = (async (input: unknown, init: RequestInit) => {
        const forwarded = { ...init } as RequestInit;
        spreadKeepsSignal = forwarded.signal === controller.signal;
        return await NATIVE_FETCH(input as string, forwarded);
      }) as unknown as typeof fetch;

      if (branch === "the fetch option") options.fetch = measured;
      setTimeout(() => controller.abort(), 60);

      const { response, error } =
        branch === "the fetch option"
          ? await typedFetch(target, options)
          : await withGlobalTransport(measured, async () => await typedFetch(target, options));
      if (response) await response.text().catch(() => "");

      return {
        spreadKeepsSignal,
        outcome: error === null ? "success" : isAbortError(error) ? "AbortedError" : error.name,
        serverFinished: control.finished().includes(tag),
      };
    }

    const observed = {
      "own signal, via the fetch option": await drive("own", "the fetch option"),
      "own signal, via the replaced global": await drive("own", "the replaced global"),
      "inherited signal, via the fetch option": await drive("inherited", "the fetch option"),
      "inherited signal, via the replaced global": await drive("inherited", "the replaced global"),
    };

    const governed = {
      spreadKeepsSignal: true,
      outcome: "AbortedError",
      serverFinished: false,
    };
    expect(
      observed,
      "an inherited `signal` is materialized as an own key only on the branch an own `fetch` " +
        "option selects, so a forwarding transport installed on `globalThis.fetch` spreads an " +
        "init with no signal: the request runs ungoverned and the envelope reports a success " +
        "for a request the caller aborted",
    ).toEqual({
      "own signal, via the fetch option": governed,
      "own signal, via the replaced global": governed,
      "inherited signal, via the fetch option": governed,
      "inherited signal, via the replaced global": governed,
    });
  }, 30_000);
});

// ── B. A body that dies mid-read ───────────────────────────────────────────

/** What one side of the differential reports for a body that dies mid-read. */
interface BodyDeathReport {
  readonly status: number;
  readonly bodyOutcome: string;
}

/** The rejection a body read produced, reduced to what both sides can agree on. */
function rejectionShape(cause: unknown): string {
  const error = cause as {
    readonly name?: unknown;
    readonly cause?: { readonly message?: unknown };
  };
  return `${String(error.name)}: ${String(error.cause?.message ?? "")}`;
}

describe.skipIf(!distExists)("a body that dies mid-read", () => {
  test.each([
    { name: "a truncated Content-Length, on a 200", path: "/truncated?status=200 OK", http: false },
    {
      name: "a truncated Content-Length, on a 500",
      path: "/truncated?status=500 Oops",
      http: true,
    },
    {
      name: "a chunked body reset mid-stream, on a 200",
      path: "/reset?status=200 OK",
      http: false,
    },
    {
      name: "a chunked body reset mid-stream, on a 500",
      path: "/reset?status=500 Oops",
      http: true,
    },
  ])(
    "$name reports what a bare fetch reports",
    async (outcome) => {
      // THE FAILURE THIS SUITE HAS NEVER DRIVEN. `fixtures/http-server.ts` ends
      // every response with `res.end()`, so the body always arrives whole. Here
      // the headers arrive and the bytes do not, which is the one real transport
      // failure that lands AFTER `fetch` has already resolved — so it cannot
      // reach the envelope at all, and the envelope must report the status the
      // origin sent.
      const { typedFetch, isHttpError } = await api();
      const target = raw.url(outcome.path);

      const bare = await NATIVE_FETCH(target);
      const bareReport: BodyDeathReport = {
        status: bare.status,
        bodyOutcome: await bare.text().then(
          (text) => `resolved ${JSON.stringify(text)}`,
          (cause: unknown) => `rejected ${rejectionShape(cause)}`,
        ),
      };

      const { response, error } = await typedFetch(target);
      // The envelope never refuses here: the transport resolved, the status
      // arrived, and only the bytes are missing.
      expect(error === null || isHttpError(error)).toBe(true);
      expect(error === null).toBe(!outcome.http);

      const typedReport: BodyDeathReport = {
        status: response ? response.status : isHttpError(error) ? error.status : -1,
        bodyOutcome: await (
          response ? response.text() : (error as { text(): Promise<string> }).text()
        ).then(
          (text) => `resolved ${JSON.stringify(text)}`,
          (cause: unknown) => `rejected ${rejectionShape(cause)}`,
        ),
      };

      expect(typedReport).toEqual(bareReport);
      // Non-vacuity: the body really did die. A whole body resolves here.
      expect(typedReport.bodyOutcome.startsWith("rejected ")).toBe(true);
    },
    20_000,
  );

  test("cancel() on an error whose body died settles, and says so in one place", async () => {
    // `src/errors/error-body.ts`, `ErrorBody.cancel`: "Rejects only when an
    // EXTERNAL reader holds the stream and has read nothing through it — a
    // stream-level failure, such as a truncated response, resolves."
    //
    // That sentence is the only place this behavior is written down, and no
    // test had ever produced the state it names: the swallow it describes is
    // reached from a REAL errored stream here rather than from a constructed
    // one. Both orders are driven — cancel after a failed read, and cancel
    // with no read at all — because they take different steps of the
    // documented decision order.
    const { typedFetch, isHttpError } = await api();

    const afterFailedRead = await typedFetch(raw.url("/truncated?status=500 Oops"));
    if (!isHttpError(afterFailedRead.error)) throw new Error("expected an HTTP error");
    await expect(afterFailedRead.error.text()).rejects.toThrow();
    await expect(afterFailedRead.error.cancel()).resolves.toBeUndefined();

    const withoutAnyRead = await typedFetch(raw.url("/reset?status=503 Down"));
    if (!isHttpError(withoutAnyRead.error)) throw new Error("expected an HTTP error");
    // Let the socket die first, so the cancel really does meet an errored
    // stream rather than a live one.
    await new Promise((resolve) => setTimeout(resolve, 80));
    await expect(withoutAnyRead.error.cancel()).resolves.toBeUndefined();
    // A repeated cancel settles with the first one, on a stream that failed.
    await expect(withoutAnyRead.error.cancel()).resolves.toBeUndefined();
  }, 20_000);

  test("a socket cut BEFORE the headers is a NetworkError naming the caller's url", async () => {
    // The other side of the same seam, and the one that DOES reach the
    // envelope: the transport rejects, phase 2 classifies, and the pre-response
    // error carries the url the caller asked for because no response exists to
    // take one from.
    const { typedFetch, isNetworkError, isAbortError, isTimeoutError } = await api();
    const target = raw.url("/cut-before-headers");

    let rejection = "resolved";
    try {
      await NATIVE_FETCH(target);
    } catch (cause) {
      rejection = (cause as { readonly name?: string }).name ?? typeof cause;
    }
    expect(rejection).toBe("TypeError");

    const { response, error } = await typedFetch(target);
    expect(response).toBe(null);
    expect(isNetworkError(error)).toBe(true);
    expect(isAbortError(error)).toBe(false);
    expect(isTimeoutError(error)).toBe(false);
    expect(error?.url).toBe(target);
    expect(error?.message).toBe("Network error");
  }, 20_000);
});

// ── C. Can a genuine platform Response reach a refusal in phase 3? ─────────

describe.skipIf(!distExists)("phase 3 against genuine responses", () => {
  test("no genuine response reaches a refusal, whatever the origin spells", async () => {
    // ROUND 17'S STATED LIMIT, DECIDED. It could not draw a structural refusal
    // from a platform value, and recorded that as a limit of the test. It is a
    // property of the code, and this measures it rather than arguing it.
    //
    // THE INSTRUMENT. Each response is fetched over a real socket and then
    // handed to an INJECTED transport that only returns it. The transport
    // cannot fail, so the transport phase cannot produce an error: any
    // `NetworkError` from these calls is necessarily a phase 3 refusal, which
    // is the read this differential could not isolate while the ambient
    // transport was in the loop.
    //
    // THE CONSEQUENCE, and why it is worth writing down: `isResponse`,
    // `hasCompatibleForeignBody`, `hasCompatibleForeignHeaders`,
    // `hasTypedResponseIdentityScalars`, and the `FOREIGN_RESPONSE_TYPES`
    // membership test are all satisfied BY CONSTRUCTION for a value the
    // platform built. So every refusal path in phase 3 — and with it the
    // cross-call release ADR 0003's amendment of 2026-08-09 describes — is
    // reachable only through out-of-scope item 3, a value that answers a
    // structural read differently on a second presentation. No sentence in the
    // ADR states that precondition in general; the amendment states it for the
    // release path alone.
    const { typedFetch, isNetworkError, isHttpError } = await api();
    const kinds = Object.keys(EXOTIC_RESPONSES);
    expect(kinds.length).toBe(10);

    const refusals: string[] = [];
    const verdicts: string[] = [];

    for (const kind of kinds) {
      const wire = await NATIVE_FETCH(raw.url(`/${kind}`));
      const transport = (async () => wire) as unknown as typeof fetch;

      // Presented TWICE, because a refusal that needs a second presentation is
      // exactly the shape round 17 could not rule out.
      for (const presentation of ["first", "second"]) {
        const { response, error } = await typedFetch("https://round18.test/resource", {
          fetch: transport,
        });
        if (error !== null && isNetworkError(error)) {
          refusals.push(`${kind} (${presentation}): refused with ${String(error.cause)}`);
          continue;
        }
        if (response) {
          verdicts.push(`${kind} (${presentation}): success ${response.status}`);
          continue;
        }
        if (!isHttpError(error)) {
          refusals.push(`${kind} (${presentation}): ${error.name}`);
          continue;
        }
        verdicts.push(`${kind} (${presentation}): ${error.name} ${error.status}`);
        await error.cancel().catch(() => {});
      }
      // The success arm keeps the body; close it rather than stranding it.
      await wire.body?.cancel().catch(() => {});
    }

    expect(refusals).toEqual([]);
    expect(verdicts.length).toBe(20);
    // Non-vacuity: the corpus really does span both arms of the verdict, so
    // "no refusal" is not "nothing was classified".
    expect(verdicts.some((entry) => entry.includes("success"))).toBe(true);
    expect(verdicts.some((entry) => entry.includes("Error "))).toBe(true);
  }, 30_000);

  test("a genuine response satisfies every structural read phase 3 performs", async () => {
    // The same conclusion asked the other way round, one predicate at a time,
    // so a future change to `src/response-verdict.ts` that adds a read a real
    // response cannot satisfy fails HERE rather than in production. The member
    // lists are `FOREIGN_RESPONSE_FIELDS`, `FOREIGN_RESPONSE_METHODS`,
    // `FOREIGN_RESPONSE_BODY_METHODS`, `FOREIGN_RESPONSE_HEADERS_METHODS`, and
    // `FOREIGN_RESPONSE_TYPES` in that file, which is INTERNAL and exports
    // none of them.
    const wire = await NATIVE_FETCH(control.url({ tag: "structural", status: 404, body: "gone" }));
    const bodiless = await NATIVE_FETCH(raw.url("/no-content"));

    const fields = [
      "body",
      "bodyUsed",
      "headers",
      "ok",
      "redirected",
      "status",
      "statusText",
      "url",
    ];
    const methods = ["arrayBuffer", "blob", "clone", "formData", "json", "text"];
    const bodyMethods = ["cancel", "getReader", "pipeThrough", "pipeTo", "tee"];
    const headerMethods = [
      "append",
      "delete",
      "entries",
      "forEach",
      "get",
      "getSetCookie",
      "has",
      "keys",
      "set",
      "values",
    ];
    const types = new Set(["basic", "cors", "default", "error", "opaque", "opaqueredirect"]);

    const missing: string[] = [];
    for (const response of [wire, bodiless]) {
      const value = response as unknown as Record<string, unknown>;
      for (const field of fields) if (!(field in value)) missing.push(`field ${field}`);
      for (const method of methods) {
        if (typeof value[method] !== "function") missing.push(`method ${method}`);
      }
      const body = response.body as unknown as Record<string, unknown> | null;
      if (body !== null) {
        if (typeof body.locked !== "boolean") missing.push("body.locked");
        for (const method of bodyMethods) {
          if (typeof body[method] !== "function") missing.push(`body.${method}`);
        }
      }
      const headers = response.headers as unknown as Record<string, unknown>;
      for (const method of headerMethods) {
        if (typeof headers[method] !== "function") missing.push(`headers.${method}`);
      }
      if (typeof headers[Symbol.iterator as unknown as string] !== "function") {
        missing.push("headers[Symbol.iterator]");
      }
      if (typeof response.status !== "number") missing.push("status is not a number");
      if (typeof response.statusText !== "string") missing.push("statusText is not a string");
      if (typeof response.url !== "string") missing.push("url is not a string");
      if (typeof response.bodyUsed !== "boolean") missing.push("bodyUsed is not a boolean");
      if (typeof response.ok !== "boolean") missing.push("ok is not a boolean");
      if (typeof response.redirected !== "boolean") missing.push("redirected is not a boolean");
      if (!types.has(response.type)) missing.push(`type ${response.type}`);
    }

    expect(missing).toEqual([]);
    // The bodiless arm is the one `hasCompatibleForeignBody` short-circuits on.
    expect(bodiless.body).toBe(null);
    await wire.body?.cancel().catch(() => {});
  }, 20_000);
});

// ── D. Interleavings the platform decides ──────────────────────────────────

describe.skipIf(!distExists)("concurrency the platform schedules", () => {
  test("one AbortController across twelve in-flight calls ends all twelve", async () => {
    // Round 17 ran 24 concurrent calls that all SUCCEEDED. This shares one
    // signal across twelve calls the server is still holding, and aborts only
    // once the server has confirmed it received all twelve — so the abort
    // lands while every one of them is genuinely in flight, rather than at a
    // moment the test guessed.
    const { typedFetch, isAbortError } = await api();
    const controller = new AbortController();
    const tags = Array.from({ length: 12 }, (_value, index) => `fleet-${index}`);

    const calls = tags.map(async (tag) =>
      typedFetch(control.url({ tag, delay: 2000 }), { signal: controller.signal }),
    );
    while (!tags.every((tag) => control.received().includes(tag))) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    controller.abort();
    const settled = await Promise.all(calls);

    const classes = settled.map((entry) =>
      entry.error === null
        ? "success"
        : isAbortError(entry.error)
          ? "AbortedError"
          : entry.error.name,
    );
    expect(classes).toEqual(tags.map(() => "AbortedError"));
    // Each call reports its OWN url, so one shared signal did not collapse
    // twelve failures into one identity.
    expect(new Set(settled.map((entry) => entry.error?.url)).size).toBe(12);
    // The server finished none of them: the abort reached the socket.
    expect(tags.filter((tag) => control.finished().includes(tag))).toEqual([]);
    // A thirteenth call on the SAME, already-aborted signal is still an abort,
    // and still names its own url.
    const late = await typedFetch(control.url({ tag: "fleet-late" }), {
      signal: controller.signal,
    });
    expect(isAbortError(late.error)).toBe(true);
  }, 30_000);

  test("a timeout that fires inside a redirect chain names the entry url", async () => {
    // The chain is three real exchanges. The timeout is set to fire while the
    // LAST hop is in flight, and the error must still be filed against the url
    // the caller asked for — a pre-response error holds no response, so there
    // is no final url to take one from.
    const { typedFetch, isTimeoutError, isAbortError } = await api();
    const final = control.url({ tag: "chain-final", delay: 4000 });
    const hop = control.url({ tag: "chain-hop", status: 302, location: final });
    const entry = control.url({ tag: "chain-entry", status: 302, location: hop });

    let rejection = "resolved";
    try {
      await NATIVE_FETCH(entry, { signal: AbortSignal.timeout(300) });
    } catch (cause) {
      rejection = (cause as { readonly name?: string }).name ?? typeof cause;
    }
    expect(rejection).toBe("TimeoutError");

    const { response, error } = await typedFetch(entry, { signal: AbortSignal.timeout(300) });

    expect(response).toBe(null);
    expect(isTimeoutError(error)).toBe(true);
    expect(isAbortError(error)).toBe(false);
    expect(error?.url).toBe(entry);
    // The chain really did reach its last hop, and that hop never finished.
    expect(control.received()).toContain("chain-final");
    expect(control.finished()).not.toContain("chain-final");
  }, 30_000);

  test("a signal aborted between two calls that share one Response changes nothing", async () => {
    // Phase 3 never consults a signal, and this is the interleaving that says
    // so out loud: the same genuine `Response` is presented to two calls, and
    // the signal is aborted between them. The transport does not reject, so
    // nothing an abort decides is ever asked — the second call must report the
    // same HTTP status as the first, never an `AbortedError`.
    const { typedFetch, isHttpError, isAbortError } = await api();
    const wire = await NATIVE_FETCH(control.url({ tag: "shared", status: 404, body: "gone" }));
    const transport = (async () => wire) as unknown as typeof fetch;
    const controller = new AbortController();

    const first = await typedFetch("https://round18.test/shared", {
      fetch: transport,
      signal: controller.signal,
    });
    controller.abort();
    const second = await typedFetch("https://round18.test/shared", {
      fetch: transport,
      signal: controller.signal,
    });

    if (!isHttpError(first.error)) throw new Error("expected an HTTP error");
    if (!isHttpError(second.error)) throw new Error("expected an HTTP error");
    expect(isAbortError(second.error)).toBe(false);
    expect(second.error.status).toBe(first.error.status);
    expect(second.error.url).toBe(first.error.url);
    // One response, one identity, and one body: the first error owns it, and
    // the second is refused by the single-use rule rather than by the abort.
    expect(await first.error.text()).toBe("gone");
    await expect(second.error.text()).rejects.toThrow(/single-use/u);
  }, 20_000);

  test("an abort raised after the envelope resolved is the platform's, unchanged", async () => {
    // The last interleaving, and the one that is a difference in nothing:
    // aborting a signal after the response has been handed over errors the
    // body stream. `typedFetch` returns the platform's own object — ADR 0003,
    // out-of-scope item 3 — so both sides fail identically, and this pins that
    // the library adds nothing here rather than leaving it unmeasured.
    const { typedFetch } = await api();
    const target = control.url({ tag: "late-abort", body: "payload" });

    const bareController = new AbortController();
    const bare = await NATIVE_FETCH(target, { signal: bareController.signal });
    bareController.abort();
    const bareOutcome = await bare.text().then(
      (text) => `resolved ${text}`,
      (cause: unknown) => `rejected ${String((cause as { name?: unknown }).name)}`,
    );

    const controller = new AbortController();
    const { response, error } = await typedFetch(target, { signal: controller.signal });
    expect(error).toBe(null);
    controller.abort();
    const typedOutcome = await (response as { text(): Promise<string> }).text().then(
      (text) => `resolved ${text}`,
      (cause: unknown) => `rejected ${String((cause as { name?: unknown }).name)}`,
    );

    expect(typedOutcome).toBe(bareOutcome);
    expect(typedOutcome).toBe("rejected AbortError");
  }, 20_000);
});
