import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "index.ts",
    "errors/index": "src/errors/index.ts",
  },
  format: ["cjs", "esm"],
  dts: true,
  sourcemap: false,
  outDir: "dist",
  clean: true,
  target: "es2020",
  splitting: false,
});
