import type { Meta, StoryObj } from "@storybook/react-vite";
import { Badge } from "./Badge";

// An explicit meta id replaces the title in story ids.
const meta = { title: "Components/Pinned", id: "pinned-badge", component: Badge } satisfies Meta<
  typeof Badge
>;
export default meta;

export const Basic: StoryObj<typeof meta> = { args: { text: "pinned" } };
