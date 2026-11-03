// Install each test fixture's own dependencies, so each one resolves
// Storybook, Vite and React from its own node_modules like a real project.
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";

const root = new URL("../test/fixtures/", import.meta.url);
for (const entry of readdirSync(root, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const cwd = new URL(`${entry.name}/`, root);
  console.log(`Installing ${entry.name}`);
  execFileSync("bun", ["install", "--frozen-lockfile"], { cwd, stdio: "inherit" });
}
