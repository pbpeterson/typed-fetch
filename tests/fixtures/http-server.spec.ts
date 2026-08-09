import { describe, expect, test } from "vitest";
import { useTestServer } from "../../fixtures/http-server";

// THE TEST SERVER'S OWN CONTRACT.
//
// `?header=Key:Value` took the value from `split(":")[1]`, so every value
// carrying a colon was truncated: `Location:https://host/x` set
// `Location: https`. No spec passed such a value, so nothing was lying — it was
// a trap for the next test, which would have read `https` and blamed the
// library. Those are the ordinary values too: an absolute `Location`, an
// HTTP-date `Retry-After`, a `Link`, a `Content-Range`.
//
// This block used to sit in `tests/envelope/typed-fetch.spec.ts` and drive the
// server through `typedFetch`, which put the library between the claim and its
// subject: a `typedFetch` defect would have failed a test about the fixture.
// The ambient `fetch` is the shortest thing that can ask the question.

const { url } = useTestServer();

describe("the test server sets the header value it was given", () => {
  test("a value that carries colons survives whole", async () => {
    const target = "https://example.test/moved?a=1";

    const response = await fetch(url({ header: `Location:${target}` }));

    expect(response.headers.get("location")).toBe(target);
    await response.body?.cancel();
  });

  test("two different names are both set", async () => {
    const response = await fetch(
      `${url()}&header=${encodeURIComponent("X-One:first")}&header=${encodeURIComponent("X-Two:second")}`,
    );

    expect(response.headers.get("x-one")).toBe("first");
    expect(response.headers.get("x-two")).toBe("second");
    await response.body?.cancel();
  });

  test("an entry with no colon sets nothing rather than an empty header", async () => {
    const response = await fetch(url({ header: "NoColonHere" }));

    expect(response.headers.get("nocolonhere")).toBe(null);
    await response.body?.cancel();
  });
});
