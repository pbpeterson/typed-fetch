import { describe, test, expect } from "vitest";
import { typedFetch, isHttpError, isKnownHttpError } from "../../src/index";
import { statusCodeErrorMap } from "../../src/http-status-codes";
import { httpErrors } from "../../src/errors/helpers";
import { redactUrl, redactUrlInMessage } from "../../src/errors/redact-url";
import { identityOf } from "../../src/errors/response-identity";
import { BaseHttpError } from "../../src/errors/base-http-error";
import { KnownHttpError } from "../../src/errors/known-http-error";
import { UnknownHttpError } from "../../src/errors/unknown-http-error";
import { NotFoundError } from "../../src/errors/not-found-error";
import { NetworkError } from "../../src/errors/network-error";
import {
  httpErrorBrand,
  knownHttpErrorBrand,
  unknownHttpErrorBrand,
  ownsResponseSymbol,
} from "../../src/errors/brand";
import { inspectCustom, denoCustomInspect } from "../../src/errors/inspect";
import { distExists, loadRootCjs, loadRootEsm } from "../../fixtures/built-package";
import { mulberry } from "../../fixtures/responses";

// ═══════════════════════════════════════════════════════════════════════════
// ROUND 10 — H2. Two clean rounds closed the body lifecycle as a state
// machine (rounds 8 and 9 between them swept every three- and four-operation
// sequence, every two-handle interleaving, and every clone-chain mix). This
// round attacks the parts of the lane those sweeps cannot reach by
// construction: the 55 error classes as a POPULATION rather than one at a
// time, the identity `WeakMap`s over a response's lifetime, the totality of
// the redactor the constructor depends on, and whether the guards agree when
// two genuine package copies are loaded in one process.
//
// Nothing here is a finding. Each block is a property no existing spec states
// over the whole population — a single class with a wrong static, or one
// url that makes the constructor throw, is exactly the defect a 40-file
// directory and a 671-line redactor hide from a per-case test.
// ═══════════════════════════════════════════════════════════════════════════

type SymbolBag = Record<symbol, unknown>;

// ── 1. The roster as a population ───────────────────────────────────────────

describe("round 10 / H2 — the 40 dedicated classes checked as one population", () => {
  test("every class agrees with the map, its own statics, its brands, and its stamps", async () => {
    const anomalies: string[] = [];
    const built: BaseHttpError[] = [];

    for (const Class of httpErrors) {
      const status: number = Class.status;
      const error = new Class(new Response(null, { status }));
      built.push(error);
      const push = (message: string): void => {
        anomalies.push(`${Class.name}(${status}): ${message}`);
      };
      const bag = error as unknown as SymbolBag;

      // The map is a projection of `static status`, so a class that answers to
      // the wrong code is only visible by comparing both directions.
      if (statusCodeErrorMap.get(status) !== Class)
        push("statusCodeErrorMap entry is not this class");
      if (!Number.isInteger(status) || status < 400 || status > 599) push("status is out of range");

      // static <-> instance. The type-level guardrail in `roster-sync.spec.ts`
      // proves the LITERAL types; this proves the two values are the same value.
      if (error.status !== status) push(`instance status ${String(error.status)}`);
      if (error.statusText !== Class.statusText) push(`instance statusText ${error.statusText}`);
      if (error.name !== Class.name) push(`name ${error.name}`);

      // Position in the hierarchy, which is what the two brands encode.
      if (!(error instanceof KnownHttpError)) push("not a KnownHttpError");
      if (!(error instanceof BaseHttpError)) push("not a BaseHttpError");
      if (error instanceof UnknownHttpError) push("is an UnknownHttpError");
      if (bag[httpErrorBrand] !== true) push("no httpErrorBrand");
      if (bag[knownHttpErrorBrand] !== true) push("no knownHttpErrorBrand");
      if (unknownHttpErrorBrand in error) push("carries unknownHttpErrorBrand");
      if (!isHttpError(error)) push("isHttpError is false");
      if (!isKnownHttpError(error)) push("isKnownHttpError is false");

      // Every stamped member, inherited from the one root prototype.
      if (typeof bag[ownsResponseSymbol] !== "function") push("no ownership query");
      if (typeof bag[inspectCustom] !== "function") push("no Node inspect hook");
      if (typeof bag[denoCustomInspect] !== "function") push("no Deno inspect hook");
      if (typeof bag[Symbol.toPrimitive] !== "function") push("no Symbol.toPrimitive");

      // Message shape and the record, for a response carrying no reason phrase.
      if (error.message !== `HTTP ${status}`) push(`message ${JSON.stringify(error.message)}`);
      const record = error.toJSON();
      if (record.name !== Class.name) push("toJSON name");
      if (record.status !== status) push("toJSON status");
      if (record.statusText !== Class.statusText) push("toJSON statusText");
      if (record.message !== error.message) push("toJSON message");

      // The three own enumerable members, and no fourth.
      const keys = Object.keys(error).toSorted().join(",");
      if (keys !== "name,status,statusText") push(`own enumerable keys are ${keys}`);
    }

    await Promise.all(built.map((error) => error.cancel()));
    expect(anomalies).toEqual([]);
  });

  test("the 4xx/5xx split in the unions matches every class's own status", () => {
    // `roster-sync.spec.ts` compares `InstanceType<HttpErrors>` with
    // `ClientErrors | ServerErrors` — the UNION, so a class moved from one side
    // to the other is invisible there. The runtime split is checked here.
    const client = httpErrors.filter((Class) => Class.status < 500);
    const server = httpErrors.filter((Class) => Class.status >= 500);
    expect([client.length, server.length]).toEqual([29, 11]);
    expect(client.every((Class) => Class.status >= 400)).toBe(true);
    expect(server.every((Class) => Class.status <= 599)).toBe(true);
  });

  test("every status from 400 to 599 selects the mapped class, or UnknownHttpError", async () => {
    const anomalies: string[] = [];
    const built: BaseHttpError[] = [];

    for (let status = 400; status <= 599; status += 1) {
      const response = new Response(null, { status });
      const { error } = await typedFetch("https://api.test/v1", {
        fetch: async () => response,
      });
      if (error === null || !isHttpError(error)) {
        anomalies.push(`${status}: ${error === null ? "no error" : error.name}`);
        continue;
      }
      built.push(error);
      const Mapped = statusCodeErrorMap.get(status);
      if (Mapped === undefined) {
        if (!(error instanceof UnknownHttpError)) anomalies.push(`${status}: not UnknownHttpError`);
        if (isKnownHttpError(error)) anomalies.push(`${status}: isKnownHttpError is true`);
      } else if (error.constructor !== Mapped) {
        anomalies.push(`${status}: selected ${error.constructor.name}`);
      }
      if (error.status !== status) anomalies.push(`${status}: reports ${String(error.status)}`);
    }

    await Promise.all(built.map((error) => error.cancel()));
    expect(anomalies).toEqual([]);
  });
});

// ── 2. Cross-field invariants over the whole response phase ─────────────────

const CONTROL_OR_BIDI = (text: string): boolean => {
  for (const character of text) {
    const code = character.codePointAt(0) as number;
    if (
      code <= 0x1f ||
      (code >= 0x7f && code <= 0x9f) ||
      code === 0x2028 ||
      code === 0x2029 ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069)
    ) {
      return true;
    }
  }
  return false;
};

interface Shape {
  readonly label: string;
  readonly install: (response: Response) => void;
}

const shift = (response: Response, key: string, first: unknown, later: unknown): void => {
  let reads = 0;
  Object.defineProperty(response, key, {
    get: () => (reads++ === 0 ? first : later),
    configurable: true,
  });
};

const fixed = (response: Response, key: string, value: unknown): void => {
  Object.defineProperty(response, key, { value, configurable: true });
};

const statusShapes: Shape[] = [
  { label: "native-404", install: () => {} },
  { label: "unmapped-599", install: (r) => fixed(r, "status", 599) },
  { label: "string-404", install: (r) => fixed(r, "status", "404") },
  { label: "array-404", install: (r) => fixed(r, "status", [404]) },
  { label: "fractional-404.7", install: (r) => fixed(r, "status", 404.7) },
  { label: "boundary-400", install: (r) => fixed(r, "status", 400) },
  { label: "shifting-404-500", install: (r) => shift(r, "status", 404, 500) },
  { label: "shifting-500-404", install: (r) => shift(r, "status", 500, 404) },
];

const statusTextShapes: Shape[] = [
  { label: "native", install: () => {} },
  { label: "empty", install: (r) => fixed(r, "statusText", "") },
  { label: "non-string", install: (r) => fixed(r, "statusText", 12) },
  { label: "c0-and-bidi", install: (r) => fixed(r, "statusText", "Not\r\n‮Found") },
  {
    label: "delimiter-injection",
    install: (r) => fixed(r, "statusText", 'Bad" (https://evil.test/) "x'),
  },
  { label: "shifting", install: (r) => shift(r, "statusText", "First", "Second") },
];

const urlShapes: Shape[] = [
  { label: "plain", install: (r) => fixed(r, "url", "https://api.test/v1") },
  {
    label: "credentialed",
    install: (r) => fixed(r, "url", "https://svc:hunter2@api.test/v1?token=SECRET#f"),
  },
  { label: "empty", install: (r) => fixed(r, "url", "") },
  { label: "non-string", install: (r) => fixed(r, "url", new URL("https://x.test/")) },
  { label: "opaque", install: (r) => fixed(r, "url", "data:text/plain,SECRET") },
  { label: "parenthesised", install: (r) => fixed(r, "url", "https://api.test/a(b)c?q=1") },
];

const headerShapes: Shape[] = [
  { label: "native", install: () => {} },
  {
    label: "replaced",
    install: (r) => fixed(r, "headers", new Headers({ "x-a": "1", "set-cookie": "s=1" })),
  },
  {
    label: "fresh-each-read",
    install: (r) => {
      let reads = 0;
      Object.defineProperty(r, "headers", {
        get: () => new Headers({ "x-read": String(reads++) }),
        configurable: true,
      });
    },
  },
];

const SECRETS = ["hunter2", "SECRET"];

function checkInvariants(error: BaseHttpError, label: string, problems: string[]): void {
  const push = (message: string): void => {
    problems.push(`${label}: ${message}`);
  };
  if (!isHttpError(error)) push("isHttpError is false");
  if (typeof error.status !== "number") push(`status is a ${typeof error.status}`);
  // The message line is composed from the status that selected the class, so
  // it can never open with a different one.
  if (!error.message.startsWith(`HTTP ${error.status}`)) {
    push(`message ${JSON.stringify(error.message)} does not open with HTTP ${error.status}`);
  }
  const Mapped = statusCodeErrorMap.get(error.status);
  if (Mapped !== undefined && error.constructor !== Mapped) {
    push(`${error.constructor.name} for mapped status ${error.status}`);
  }
  if (Mapped !== undefined && !isKnownHttpError(error)) push("a mapped status is not known");
  if (Mapped === undefined && isKnownHttpError(error)) push("an unmapped status is known");
  const record = error.toJSON();
  if (record.status !== error.status) push("toJSON status disagrees");
  if (record.name !== error.name) push("toJSON name disagrees");
  if (record.message !== error.message) push("toJSON message disagrees");
  if (record.url !== redactUrl(error.url)) push(`toJSON url is ${record.url}`);
  if (String(error) !== `${error.name}: ${error.message}`) push(`String() is ${String(error)}`);
  if (CONTROL_OR_BIDI(error.message)) push("message carries a line-rewriting character");
  for (const secret of SECRETS) {
    if (error.message.includes(secret)) push(`message leaks ${secret}`);
    if (record.url.includes(secret)) push(`toJSON url leaks ${secret}`);
  }
}

describe("round 10 / H2 — cross-field invariants across the whole identity matrix", () => {
  test("864 identity shapes: no disagreement between class, status, message, and record", async () => {
    const problems: string[] = [];
    let checked = 0;

    for (const status of statusShapes) {
      for (const statusText of statusTextShapes) {
        for (const url of urlShapes) {
          for (const headers of headerShapes) {
            const label = `${status.label}/${statusText.label}/${url.label}/${headers.label}`;
            const response = new Response("payload", { status: 404, statusText: "Not Found" });
            status.install(response);
            statusText.install(response);
            url.install(response);
            headers.install(response);

            const { error } = await typedFetch("https://api.test/v1", {
              fetch: async () => response,
            });
            if (error === null || !isHttpError(error)) {
              problems.push(`${label}: ${error === null ? "no error" : error.name}`);
              continue;
            }
            checked += 1;
            checkInvariants(error, label, problems);

            // A copy must agree with its original in every field, whatever the
            // double answered on a later read.
            const copy = error.clone();
            checkInvariants(copy, `${label} [copy]`, problems);
            if (copy.status !== error.status) problems.push(`${label}: copy status differs`);
            if (copy.message !== error.message) problems.push(`${label}: copy message differs`);
            if (copy.name !== error.name) problems.push(`${label}: copy name differs`);
            if (copy.url !== error.url) problems.push(`${label}: copy url differs`);
            await Promise.all([error.cancel(), copy.cancel()]);
          }
        }
      }
    }

    expect(checked).toBe(864);
    expect(problems).toEqual([]);
  }, 60_000);
});

// ── 3. The redactor the constructor depends on is total ─────────────────────

const ALPHABET = [
  ":",
  "/",
  "\\",
  "@",
  "?",
  "#",
  "%",
  "[",
  "]",
  "\t",
  "\r",
  "\n",
  " ",
  ".",
  "a",
  "1",
  "https",
  "file",
  "..",
  "%2f",
  "%40",
  "|",
  "^",
  "<",
  ">",
  '"',
  "'",
  "`",
  "{",
  "}",
  ";",
  ",",
  "=",
  "+",
  "-",
  "_",
  "~",
  "!",
  "$",
  "&",
  "(",
  ")",
  "*",
];

function urlsFrom(seed: number, count: number): string[] {
  const random = mulberry(seed);
  const urls: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const length = 1 + Math.floor(random() * 12);
    let url = "";
    for (let piece = 0; piece < length; piece += 1) {
      url += ALPHABET[Math.floor(random() * ALPHABET.length)] as string;
    }
    urls.push(url);
  }
  return urls;
}

describe("round 10 / H2 — a url can never turn an HTTP error into a NetworkError", () => {
  // `redactUrl` runs inside the `BaseHttpError` constructor, and that
  // constructor runs inside `typedFetch`'s response-phase `try`. A throw there
  // is not a crash — it is a 404 delivered as a `NetworkError`, which is the
  // wrong class for a mapped status. The redactor's "total by construction"
  // claim is therefore load-bearing for class selection, and it is measured
  // here over the marks the module actually distinguishes rather than over
  // random noise (the fuzz lesson round 6 recorded).
  test("100,000 generated urls: redactUrl and redactUrlInMessage never throw", () => {
    const throwers: string[] = [];
    for (const url of urlsFrom(20261010, 100_000)) {
      try {
        redactUrl(url);
        redactUrlInMessage(`failed for ${url} end`, url);
      } catch (thrown) {
        throwers.push(`${JSON.stringify(url)} -> ${String(thrown)}`);
        if (throwers.length > 4) break;
      }
    }
    expect(throwers).toEqual([]);
  }, 60_000);

  test("20,000 generated urls on a 404: the class stays NotFoundError", async () => {
    const throwers: string[] = [];
    const built: BaseHttpError[] = [];
    for (const url of urlsFrom(99991, 20_000)) {
      const response = new Response(null, { status: 404 });
      fixed(response, "url", url);
      try {
        built.push(new NotFoundError(response));
      } catch (thrown) {
        throwers.push(`${JSON.stringify(url)} -> ${String(thrown)}`);
        if (throwers.length > 4) break;
      }
      try {
        const networkError = new NetworkError("boom", { url });
        if (typeof networkError.message !== "string") throwers.push("NetworkError message");
      } catch (thrown) {
        throwers.push(`NetworkError ${JSON.stringify(url)} -> ${String(thrown)}`);
        if (throwers.length > 4) break;
      }
    }
    await Promise.all(built.map((error) => error.cancel()));
    expect(throwers).toEqual([]);
  }, 60_000);
});

// ── 4. Identity lifetime over one Response ─────────────────────────────────

describe("round 10 / H2 — the identity tables over a response's lifetime", () => {
  test("mutating the response after the first error cannot change the second", async () => {
    const response = new Response("payload", { status: 404, statusText: "Not Found" });
    fixed(response, "url", "https://api.test/first");

    const first = await typedFetch("https://api.test/v1", { fetch: async () => response });
    const firstError = first.error as BaseHttpError;
    expect(firstError.status).toBe(404);

    // Everything the identity is taken from, rewritten between the two calls.
    fixed(response, "status", 500);
    fixed(response, "statusText", "Internal Server Error");
    fixed(response, "url", "https://api.test/second");
    fixed(response, "headers", new Headers({ "x-late": "1" }));

    const second = await typedFetch("https://api.test/v1", { fetch: async () => response });
    const secondError = second.error as BaseHttpError;

    // One response, one identity: the recorded reads win over every later one.
    expect(secondError.status).toBe(404);
    expect(secondError.constructor).toBe(NotFoundError);
    expect(secondError.message).toBe(firstError.message);
    expect(secondError.url).toBe("https://api.test/first");
    expect(secondError.toJSON()).toEqual(firstError.toJSON());
    // Two errors, two header copies, neither aliasing the other.
    expect(secondError.headers).not.toBe(firstError.headers);
    expect([...secondError.headers.keys()]).toEqual([...firstError.headers.keys()]);

    await firstError.cancel();
    await expect(secondError.text()).rejects.toThrow(/single-use/);
    await secondError.cancel();
  });

  test("identityOf answers with one record object for one response", () => {
    const response = new Response(null, { status: 404 });
    expect(identityOf(response)).toBe(identityOf(response));
  });

  test("a clone() copy inherits the identity rather than re-reading the branch", async () => {
    // The branch a real `Response.clone()` produces reports internal slots, not
    // the own-property getter that produced the original's identity.
    const response = new Response("payload", { status: 404 });
    shift(response, "url", "https://api.test/original", "https://api.test/branch");
    fixed(response, "statusText", "Gone Away");

    const error = new NotFoundError(response);
    const copy = error.clone();

    expect(copy.url).toBe(error.url);
    expect(copy.url).toBe("https://api.test/original");
    expect(copy.message).toBe(error.message);
    expect(copy.toJSON()).toEqual(error.toJSON());
    await Promise.all([error.cancel(), copy.cancel()]);
  });

  test("the loan is gone once clone() returns: a later error reads the branch itself", async () => {
    const response = new Response("payload", { status: 404 });
    fixed(response, "url", "https://api.test/original");

    const error = new NotFoundError(response);
    let branch: Response | undefined;
    const copy = error.clone((given) => {
      branch = given;
      return new NotFoundError(given) as never;
    });
    expect(branch).toBeDefined();

    // Built from the branch AFTER the construction the loan existed for.
    const later = new NotFoundError(branch as Response);
    expect(later.url).toBe((branch as Response).url);
    // The loan reached the copy and stopped there: this one read the branch.
    expect(later.url).not.toBe(error.url);
    expect(copy.url).toBe(error.url);

    await Promise.all([error.cancel(), copy.cancel()]);
    await later.cancel().catch(() => {});
  });
});

// ── 5. Two genuine package copies ──────────────────────────────────────────

interface RootCopy {
  readonly NotFoundError: new (response: Response) => BaseHttpError;
  readonly UnknownHttpError: new (response: Response) => BaseHttpError;
  readonly NetworkError: new (message?: string, options?: { url?: string }) => Error;
  readonly AbortedError: new (message?: string, options?: { url?: string }) => Error;
  readonly TimeoutError: new (message?: string, options?: { url?: string }) => Error;
  readonly isHttpError: (value: unknown) => boolean;
  readonly isKnownHttpError: (value: unknown) => boolean;
  readonly isNetworkError: (value: unknown) => boolean;
  readonly isAbortError: (value: unknown) => boolean;
  readonly isTimeoutError: (value: unknown) => boolean;
}

const GUARDS = [
  "isHttpError",
  "isKnownHttpError",
  "isNetworkError",
  "isAbortError",
  "isTimeoutError",
] as const;

type GuardName = (typeof GUARDS)[number];

function buildFamilies(copy: RootCopy): [string, Error][] {
  return [
    ["NotFoundError", new copy.NotFoundError(new Response("x", { status: 404 }))],
    ["UnknownHttpError", new copy.UnknownHttpError(new Response("x", { status: 599 }))],
    ["NetworkError", new copy.NetworkError("boom", { url: "https://a.test/" })],
    ["AbortedError", new copy.AbortedError("boom", { url: "https://a.test/" })],
    ["TimeoutError", new copy.TimeoutError("boom", { url: "https://a.test/" })],
  ];
}

const EXPECTED: Record<string, Record<GuardName, boolean>> = {
  NotFoundError: {
    isHttpError: true,
    isKnownHttpError: true,
    isNetworkError: false,
    isAbortError: false,
    isTimeoutError: false,
  },
  UnknownHttpError: {
    isHttpError: true,
    isKnownHttpError: false,
    isNetworkError: false,
    isAbortError: false,
    isTimeoutError: false,
  },
  NetworkError: {
    isHttpError: false,
    isKnownHttpError: false,
    isNetworkError: true,
    isAbortError: false,
    isTimeoutError: false,
  },
  AbortedError: {
    isHttpError: false,
    isKnownHttpError: false,
    isNetworkError: false,
    isAbortError: true,
    isTimeoutError: false,
  },
  TimeoutError: {
    isHttpError: false,
    isKnownHttpError: false,
    isNetworkError: false,
    isAbortError: false,
    isTimeoutError: true,
  },
};

describe.skipIf(!distExists)("round 10 / H2 — every guard, both directions, two copies", () => {
  test("100 guard answers across the copy seam, and none disagrees", async () => {
    const esm = await loadRootEsm<RootCopy>();
    const cjs = loadRootCjs<RootCopy>();
    const copies: [string, RootCopy][] = [
      ["esm", esm],
      ["cjs", cjs],
    ];

    const disagreements: string[] = [];
    const bodies: BaseHttpError[] = [];

    for (const [builderName, builder] of copies) {
      for (const [family, error] of buildFamilies(builder)) {
        if (typeof (error as BaseHttpError).cancel === "function") {
          bodies.push(error as BaseHttpError);
        }
        for (const [askerName, asker] of copies) {
          for (const guard of GUARDS) {
            const answered = asker[guard](error);
            const expected = EXPECTED[family]?.[guard];
            if (answered !== expected) {
              disagreements.push(
                `${family} built by ${builderName}, asked by ${askerName}.${guard}: ` +
                  `${answered} instead of ${expected}`,
              );
            }
          }
        }
      }
    }

    await Promise.all(bodies.map((error) => error.cancel()));
    expect(disagreements).toEqual([]);
  });
});
