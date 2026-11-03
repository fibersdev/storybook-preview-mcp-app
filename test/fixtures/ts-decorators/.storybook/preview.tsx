import type { Decorator, Preview } from "@storybook/react-vite";
import "~/global.css";
import { ThemeName } from "~/theme";

const withTheme: Decorator = (Story) => (
  <ThemeName.Provider value="from-decorator">
    <Story />
  </ThemeName.Provider>
);

const preview: Preview = { decorators: [withTheme] };
export default preview;
