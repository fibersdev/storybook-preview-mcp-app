import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { entrySource } from "../../server/build-story.mjs";
import { runBuild } from "../../server/tools.mjs";

test("the entry imports the framework, preview and stories file", () => {
  const src = entrySource({
    framework: "@storybook/react-vite",
    preview: "/p/.storybook/preview.tsx",
    storiesFile: "/p/src/Button.stories.tsx",
    title: "Button",
  });
  assert.match(src, /from "@storybook\/react-vite"/);
  assert.match(src, /import \* as preview from "\/p\/\.storybook\/preview\.tsx"/);
  assert.match(src, /setProjectAnnotations\(\[preview\]\)/);
  assert.match(src, /import \* as stories from "\/p\/src\/Button\.stories\.tsx"/);
  assert.match(src, /\(stories\.default\?\.title \?\? "Button"\) \|\| undefined/);
});

test("the entry works without a preview file", () => {
  const src = entrySource({ framework: "@storybook/react-vite", storiesFile: "/p/a.stories.jsx" });
  assert.doesNotMatch(src, /preview/);
});

test("a build that runs too long is stopped", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sbp-timeout-"));
  try {
    const result = await runBuild({
      projectDir: dir,
      file: "x",
      outDir: dir,
      title: "",
      timeoutMs: 1,
    });
    assert.equal(result.timedOut, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
