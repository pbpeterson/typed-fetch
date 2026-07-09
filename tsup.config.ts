import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "index.ts",
    "errors/index": "src/errors/index.ts",
  },
  format: ["cjs", "esm"],
  dts: {
    compilerOptions: {
      // tsup injects baseUrl into the DTS build; TS 6 hard-errors on the
      // deprecation without this. Remove once tsup stops setting baseUrl.
      ignoreDeprecations: "6.0",
    },
  },
  sourcemap: false,
  outDir: "dist",
  clean: true,
  target: "es2022",
  // Splitting makes the two entry points (`.` and `./errors`) share a common
  // chunk *within each format*, so the error classes are defined once per
  // format instead of duplicated per entry. That collapses the same-format
  // cross-entry copies (`NotFoundError` from `./errors` === the one used by
  // `typedFetch`), restoring raw `instanceof` across entry points. It cannot
  // (and no bundler can) merge the CJS and ESM graphs — that boundary is
  // handled by the brand-based guards.
  splitting: true,
});
