// The MCP protocol side: tool and resource definitions, and one function
// that answers a JSON-RPC request.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fail, listStoriesTool, previewStory } from "./tools.mjs";

const here = dirname(fileURLToPath(import.meta.url));

export const SERVER_NAME = "storybook-preview";
export const VERSION = /** @type {{ version: string }} */ (
  JSON.parse(readFileSync(join(here, "../package.json"), "utf8"))
).version;
export const PAGE_URI = "ui://storybook-preview/story-v1.html";
export const PAGE_MIME = "text/html;profile=mcp-app";

const projectDirSchema = {
  type: "string",
  description:
    "Absolute path of the folder holding .storybook, or of a checkout above it. Pass the folder you are working in (a git worktree, say): without it the server searches from where it was started.",
};

export const TOOLS = [
  {
    name: "preview_story",
    description:
      "Show a Storybook story live in the chat: the project's real CSS, fonts and decorators, its play step run, clickable. Call it again after an edit to see the change. Needs no running Storybook. story_id as Storybook names it (button--primary); list_stories gives them.",
    inputSchema: {
      type: "object",
      properties: {
        story_id: { type: "string" },
        theme: {
          type: "string",
          enum: ["host", "light", "dark"],
          description: "Default host: follow the app's light or dark theme.",
        },
        project_dir: projectDirSchema,
      },
      required: ["story_id"],
    },
    _meta: { ui: { resourceUri: PAGE_URI } },
  },
  {
    name: "list_stories",
    description:
      "List the Storybook story ids in a project, optionally filtered by a word in the id or title.",
    inputSchema: {
      type: "object",
      properties: { filter: { type: "string" }, project_dir: projectDirSchema },
    },
  },
];

const page = () => readFileSync(join(here, "page.html"), "utf8");

/**
 * @typedef {{ jsonrpc?: string, id?: string | number, method: string, params?: any }} Request
 */

/**
 * Answer one request. Undefined means "method not found".
 * @param {Request} msg
 * @returns {Promise<unknown>}
 */
export async function handle(msg) {
  switch (msg.method) {
    case "initialize":
      return {
        protocolVersion: msg.params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: SERVER_NAME, version: VERSION },
      };
    case "tools/list":
      return { tools: TOOLS };
    case "tools/call": {
      const args = msg.params?.arguments ?? {};
      try {
        if (msg.params?.name === "preview_story") return await previewStory(args);
        if (msg.params?.name === "list_stories") return await listStoriesTool(args);
        return fail(`No tool named ${msg.params?.name}.`);
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    }
    case "resources/list":
      return { resources: [{ uri: PAGE_URI, name: "Storybook story", mimeType: PAGE_MIME }] };
    case "resources/read":
      if (msg.params?.uri !== PAGE_URI) return undefined;
      return {
        contents: [
          {
            uri: PAGE_URI,
            mimeType: PAGE_MIME,
            text: page(),
            _meta: { ui: { prefersBorder: true } },
          },
        ],
      };
    case "ping":
      return {};
    default:
      return undefined;
  }
}

/**
 * The JSON-RPC reply for a request, or undefined for a notification.
 * @param {Request} msg
 */
export async function reply(msg) {
  if (msg.id === undefined) return undefined;
  const result = await handle(msg);
  return result === undefined
    ? {
        jsonrpc: "2.0",
        id: msg.id,
        error: { code: -32601, message: `Method not found: ${msg.method}` },
      }
    : { jsonrpc: "2.0", id: msg.id, result };
}
