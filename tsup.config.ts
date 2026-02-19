import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    cli: "src/cli/cli.ts",
    index: "src/index.ts",
  },
  format: ["esm"],
  target: "node20",
  platform: "node",
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: true,
  treeshake: true,
  minify: false,
  external: [
    "better-sqlite3",
    "keytar",
    "fsevents",
  ],
  noExternal: [],
  esbuildOptions(options) {
    options.jsx = "automatic";
  },
});
