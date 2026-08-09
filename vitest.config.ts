import { configDefaults, defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    // Installed agent-skill bundles carry their own .mjs scripts named like
    // tests but holding no suite, so vitest collects six files it cannot run
    // and `npm run test` reports failures that have nothing to do with the app.
    // A red suite nobody trusts is worse than no suite.
    exclude: [...configDefaults.exclude, ".agents/**", ".claude/**"],
    // The template sweep instantiates every template across every seed,
    // difficulty and format and runs KaTeX over the results — it lands within a
    // few hundred ms of the 5s default on a warm machine and over it on a cold
    // one. The work is real, not a hang, so give it room rather than trimming
    // the coverage that makes it worth having.
    testTimeout: 30_000,
  },
});
