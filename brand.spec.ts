import { describe, it, expect } from "vitest";
import {
  isHttpError,
  isNetworkError,
  isAbortError,
  isTimeoutError,
  isKnownHttpError,
} from "./src/index";
import { NotFoundError } from "./src/errors";
import { httpErrorBrand, hasBrand } from "./src/errors/brand";

describe("hardened brand reads", () => {
  it("guards return false for a Proxy whose get trap throws", () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("trap");
        },
      },
    );

    expect(() => isHttpError(hostile)).not.toThrow();
    expect(() => isNetworkError(hostile)).not.toThrow();
    expect(() => isAbortError(hostile)).not.toThrow();
    expect(() => isTimeoutError(hostile)).not.toThrow();
    expect(() => isKnownHttpError(hostile)).not.toThrow();

    expect(isHttpError(hostile)).toBe(false);
    expect(isNetworkError(hostile)).toBe(false);
    expect(isAbortError(hostile)).toBe(false);
    expect(isTimeoutError(hostile)).toBe(false);
    expect(isKnownHttpError(hostile)).toBe(false);
  });

  it("hasBrand returns false when a symbol-keyed getter throws", () => {
    const obj = Object.defineProperty({}, httpErrorBrand, {
      get() {
        throw new Error("hostile");
      },
    });

    expect(hasBrand(obj, httpErrorBrand)).toBe(false);
  });

  it("hasBrand still detects real branded instances", () => {
    const error = new NotFoundError(new Response(null, { status: 404 }));

    expect(hasBrand(error, httpErrorBrand)).toBe(true);
  });
});
