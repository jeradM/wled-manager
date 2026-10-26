import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  target: "node24",
  // Bundle the workspace package (it ships TS source); keep real deps external.
  noExternal: ["@wled-manager/shared"],
  clean: true,
});
