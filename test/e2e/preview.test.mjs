// End to end: build stories from the fixture projects, and show them in the
// real MCP App page inside headless Chromium, with this test playing the host.
// The page runs under a CSP that allows no network at all, as strict as the
// Claude desktop app's Code tab, and without font-src, so fonts must come
// through the page's fallback.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { PAGE_URI, reply } from "../../server/mcp.mjs";
import { META_KEY } from "../../server/tools.mjs";
import { listStories } from "../../server/storybook.mjs";

const fixture = (/** @type {string} */ name) =>
  fileURLToPath(new URL(`../fixtures/${name}/`, import.meta.url));

const CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:";

/** @type {import("playwright").Browser} */
let browser;
/** @type {string} */
let pageHtml;

before(async () => {
  browser = await chromium.launch();
  const read = /** @type {any} */ (
    await reply({ jsonrpc: "2.0", id: 1, method: "resources/read", params: { uri: PAGE_URI } })
  );
  pageHtml = read.result.contents[0].text.replace(
    "<head>",
    `<head><meta http-equiv="Content-Security-Policy" content="${CSP}">`,
  );
});
after(() => browser?.close());

/**
 * Call a tool the way a host would.
 * @param {string} name
 * @param {Record<string, unknown>} args
 */
async function callTool(name, args) {
  const out = /** @type {any} */ (
    await reply({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } })
  );
  return out.result;
}

/**
 * Show a tool result in the page, with this test as the host: answer
 * ui/initialize with the theme, then send the tool result.
 * @param {any} result
 * @param {"light" | "dark"} hostTheme
 */
async function show(result, hostTheme = "light") {
  const tab = await browser.newPage();
  /** @type {string[]} */
  const errors = [];
  tab.on("pageerror", (e) => errors.push(e.message));
  await tab.setContent("<!doctype html><body></body>");
  await tab.evaluate(
    ({ html, toolResult, theme }) => {
      const frame = document.createElement("iframe");
      frame.style.width = "800px";
      frame.style.height = "600px";
      const send = (/** @type {object} */ msg) =>
        frame.contentWindow?.postMessage({ jsonrpc: "2.0", ...msg }, "*");
      window.addEventListener("message", (event) => {
        const m = event.data;
        if (m?.method === "ui/initialize") {
          send({ id: m.id, result: { protocolVersion: "2026-01-26", hostContext: { theme } } });
        } else if (m?.method === "ui/notifications/initialized") {
          send({ method: "ui/notifications/tool-result", params: toolResult });
        }
      });
      frame.srcdoc = html;
      document.body.append(frame);
    },
    { html: pageHtml, toolResult: result, theme: hostTheme },
  );
  const frame = tab.frameLocator("iframe");
  return { tab, frame, errors };
}

describe("basic-js fixture (JS config, auto titles, play step)", () => {
  const dir = fixture("basic-js");

  test("lists the same story ids as Storybook's own index", async () => {
    await assertIdsMatchStorybook(dir);
  });

  test("shows a story, runs its play step, and stays clickable", async () => {
    const result = await callTool("preview_story", {
      story_id: "counter--clicked",
      project_dir: dir,
    });
    assert.ok(!result.isError, result.content[0].text);
    assert.match(result.content[0].text, /^Showing Counter › Clicked/);
    const { tab, frame, errors } = await show(result);
    const button = frame.locator("#storybook-root button");
    await button.getByText("Pressed 1 times").waitFor();
    await button.click();
    await button.getByText("Pressed 2 times").waitFor();
    const bg = await button.evaluate((el) => getComputedStyle(el).backgroundColor);
    assert.equal(bg, "rgb(47, 111, 222)");
    assert.deepEqual(errors, []);
    await tab.close();
  });

  test("follows a dark host theme", async () => {
    const result = await callTool("preview_story", {
      story_id: "counter--primary",
      project_dir: dir,
    });
    const { tab, frame } = await show(result, "dark");
    const button = frame.locator("#storybook-root button");
    await button.waitFor();
    assert.equal(
      await button.evaluate((el) => getComputedStyle(el).backgroundColor),
      "rgb(138, 180, 255)",
    );
    assert.equal(await frame.locator("html").getAttribute("data-theme"), "dark");
    await tab.close();
  });

  test("a theme argument overrides the host", async () => {
    const result = await callTool("preview_story", {
      story_id: "counter--primary",
      project_dir: dir,
      theme: "dark",
    });
    const { tab, frame } = await show(result, "light");
    await frame.locator("#storybook-root button").waitFor();
    assert.equal(await frame.locator("html").getAttribute("data-theme"), "dark");
    await tab.close();
  });

  test("names the stories of the same component when an id is wrong", async () => {
    const result = await callTool("preview_story", { story_id: "counter--nope", project_dir: dir });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /Same component: counter--primary, counter--clicked/);
  });
});

describe("ts-decorators fixture (TS config, viteFinal, decorators, fonts)", () => {
  const dir = fixture("ts-decorators");

  test("lists the same story ids as Storybook's own index", async () => {
    await assertIdsMatchStorybook(dir);
  });

  test("applies viteFinal, the decorator and the global CSS font", async () => {
    const result = await callTool("preview_story", {
      story_id: "components-badge--default",
      project_dir: dir,
    });
    assert.ok(!result.isError, result.content[0].text);
    const { tab, frame, errors } = await show(result);
    const badge = frame.getByTestId("badge");
    await badge.getByText("Fixture: hello (from-decorator)").waitFor();
    const font = await badge.evaluate(async () => {
      await document.fonts.ready;
      return document.fonts.check('16px "IBM Plex Mono"');
    });
    assert.equal(font, true, "IBM Plex Mono should load from the bundle without font-src");
    assert.deepEqual(errors, []);
    await tab.close();
  });

  test("an explicit meta id names the story", async () => {
    const result = await callTool("preview_story", {
      story_id: "pinned-badge--basic",
      project_dir: dir,
    });
    const { tab, frame } = await show(result);
    await frame.getByTestId("badge").getByText("Fixture: pinned (from-decorator)").waitFor();
    await tab.close();
  });

  test("the bundle travels in _meta, not in the text the model reads", async () => {
    const result = await callTool("preview_story", {
      story_id: "components-badge--default",
      project_dir: dir,
    });
    assert.ok(result.content[0].text.length < 300);
    assert.ok(result._meta[META_KEY].js.length > 10_000);
    assert.equal(result.structuredContent, undefined);
  });
});

/**
 * Build the fixture's Storybook and compare its index.json with ours.
 * @param {string} dir
 */
async function assertIdsMatchStorybook(dir) {
  const out = mkdtempSync(join(tmpdir(), "sbp-index-"));
  try {
    execFileSync(
      join(dir, "node_modules/.bin/storybook"),
      ["build", "--test", "--quiet", "-o", out],
      {
        cwd: dir,
        stdio: "pipe",
      },
    );
    /** @type {{ entries: Record<string, { id: string, type: string }> }} */
    const index = JSON.parse(readFileSync(join(out, "index.json"), "utf8"));
    const expected = Object.values(index.entries)
      .filter((e) => e.type === "story")
      .map((e) => e.id)
      .toSorted();
    const ours = (await listStories(dir)).map((s) => s.id).toSorted();
    assert.deepEqual(ours, expected);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}
