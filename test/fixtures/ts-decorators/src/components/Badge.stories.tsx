import type { Meta, StoryObj } from "@storybook/react-vite";
import { Badge } from "./Badge";

const meta = {
  title: "Components/Badge",
  component: Badge,
  excludeStories: ["sampleText"],
} satisfies Meta<typeof Badge>;
export default meta;
type Story = StoryObj<typeof meta>;

// Not a story: excluded above.
export const sampleText = "sample";

export const Default: Story = { args: { text: "hello" } };

export const OpenSettingsLinks: Story = { args: { text: "camel case export" } };
