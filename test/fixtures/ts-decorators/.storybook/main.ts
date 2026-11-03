import { fileURLToPath } from "node:url";
import type { StorybookConfig } from "@storybook/react-vite";
import { mergeConfig } from "vite";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  framework: { name: "@storybook/react-vite", options: {} },
  // A path alias and a build-time constant, both only set here.
  viteFinal: async (vite) =>
    mergeConfig(vite, {
      resolve: { alias: { "~": fileURLToPath(new URL("../src", import.meta.url)) } },
      define: { __BRAND__: JSON.stringify("Fixture") },
    }),
};

export default config;
