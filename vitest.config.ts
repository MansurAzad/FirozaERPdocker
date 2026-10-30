import { mergeConfig } from "vite";
import { defineConfig } from "vitest/config";
import viteConfig from "./vite.config";

export default defineConfig(async (env) =>
  mergeConfig(await viteConfig(env), {
    test: {
      environment: "jsdom",
    },
  }),
);
