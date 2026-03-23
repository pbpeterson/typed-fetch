import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["index.ts"],
    format: ["cjs", "esm"],
    dts: true,
    sourcemap: true,
    outDir: "dist",
    clean: true,
    target: "es2020",
    splitting: false,
  },
  {
    entry: ["src/errors/*.ts"],
    format: ["cjs", "esm"],
    dts: true,
    sourcemap: true,
    outDir: "dist/errors",
    target: "es2020",
    bundle: false,
  },
]);
