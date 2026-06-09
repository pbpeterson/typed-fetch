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
  splitting: false,
});
