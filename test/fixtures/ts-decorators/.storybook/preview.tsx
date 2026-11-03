import type { Decorator, Preview } from "@storybook/react-vite";
import "~/global.css";
import { ThemeName } from "~/theme";

// Like Storybook's Vitest addon setups: a lazy import that only resolves in a
// Vitest browser run. Outside one it must quietly do nothing.
export async function vitestCommands() {
  const mod = await import("vitest/browser").catch(() => undefined);
  return mod?.commands;
}

const withTheme: Decorator = (Story) => (
  <ThemeName.Provider value="from-decorator">
    <Story />
  </ThemeName.Provider>
);

const preview: Preview = { decorators: [withTheme] };
export default preview;
