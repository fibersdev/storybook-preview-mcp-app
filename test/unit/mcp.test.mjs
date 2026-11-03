import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { PAGE_MIME, PAGE_URI, reply, TOOLS, VERSION } from "../../server/mcp.mjs";
import { META_KEY } from "../../server/tools.mjs";

const empty = mkdtempSync(join(tmpdir(), "sbp-mcp-"));
after(() => rmSync(empty, { recursive: true, force: true }));

/** @param {string} method @param {any} [params] */
const call = async (method, params) =>
  /** @type {any} */ (await reply({ jsonrpc: "2.0", id: 1, method, params }));
/** @param {string} name @param {any} args */
const tool = async (name, args) => (await call("tools/call", { name, arguments: args })).result;

describe("protocol", () => {
  test("initialize names the server and echoes the protocol version", async () => {
    const { result } = await call("initialize", { protocolVersion: "2025-06-18" });
    assert.equal(result.protocolVersion, "2025-06-18");
    assert.deepEqual(result.serverInfo, { name: "storybook-preview", version: VERSION });
    assert.ok(result.capabilities.tools && result.capabilities.resources);
  });

  test("tools/list offers both tools, and preview_story points at the page", async () => {
    const { result } = await call("tools/list");
    assert.deepEqual(
      result.tools.map((/** @type {any} */ t) => t.name),
      ["preview_story", "list_stories"],
    );
    assert.equal(TOOLS[0]._meta?.ui.resourceUri, PAGE_URI);
  });

  test("resources/read returns the page as an MCP App", async () => {
    const { result } = await call("resources/read", { uri: PAGE_URI });
    const [content] = result.contents;
    assert.equal(content.mimeType, PAGE_MIME);
    assert.match(content.text, /ui\/initialize/);
    assert.match(content.text, new RegExp(META_KEY.replace("/", "\\/")));
  });

  test("an unknown resource or method is 'method not found'", async () => {
    assert.equal((await call("resources/read", { uri: "ui://other" })).error.code, -32601);
    assert.equal((await call("nope")).error.code, -32601);
  });

  test("notifications get no reply", async () => {
    assert.equal(await reply({ jsonrpc: "2.0", method: "notifications/initialized" }), undefined);
  });
});

describe("tool input", () => {
  test("preview_story needs a story_id", async () => {
    const result = await tool("preview_story", {});
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /story_id is required/);
    assert.match(result._meta[META_KEY].error, /story_id is required/);
  });

  test("preview_story refuses an unknown theme", async () => {
    const result = await tool("preview_story", { story_id: "a--b", theme: "sepia" });
    assert.match(result.content[0].text, /theme must be host, light or dark/);
  });

  test("a folder with no Storybook is explained, not thrown", async () => {
    const result = await tool("list_stories", { project_dir: empty });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /No Storybook project/);
  });

  test("an unknown tool is an error result", async () => {
    const result = await tool("nope", {});
    assert.equal(result.isError, true);
  });
});
