// No title: Storybook works it out from the path ("Counter").
import { Counter } from "./Counter";

export default { component: Counter };

export const Primary = { args: { label: "Clicked" } };

export const Clicked = {
  args: { label: "Pressed" },
  play: async ({ canvasElement }) => canvasElement.querySelector("button").click(),
};
