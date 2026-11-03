#!/usr/bin/env node
// storybook-preview-mcp-app: an MCP server whose tool shows a Storybook story
// live inside the chat, as an MCP App.
//
// Hosts such as the Claude desktop app's Code tab run an MCP App page with no
// network access at all: no frame, fetch, stylesheet or script from
// localhost. So each call builds the story's file with the project's own Vite
// and Storybook config (build-story.mjs) and sends the whole bundle in the
// tool result's _meta, which reaches the page and stays out of the model's
// context. The page mounts the story, runs its play step and follows the
// host's light or dark theme. Calling again after an edit is the reload.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { chooseProject, listStories } from "./storybook.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const VERSION = "0.1.0";
const URI = "ui://storybook-preview/story-v1.html";
const MIME = "text/html;profile=mcp-app";
const page = () => readFileSync(join(here, "page.html"), "utf8");
const start = () => process.env.CLAUDE_PROJECT_DIR || process.cwd();
const text = (t) => [{ type: "text", text: t }];
const fail = (t) => ({ isError: true, content: text(t), _meta: { "storybook/story": { error: t } } });

function runBuild(projectDir, file, outDir, title) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [join(here, "build-story.mjs"), projectDir, file, outDir, title], {
      cwd: projectDir,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => done({ code, out }));
  });
}

async function previewStory(args) {
  const storyId = String(args.story_id ?? "").trim();
  if (!storyId) return fail("story_id is required, e.g. button--primary. list_stories gives the ids.");
  const project = chooseProject(start(), args.project_dir);
  if (project.error) return fail(project.error);
  const stories = await listStories(project.dir);
  const story = stories.find((s) => s.id === storyId);
  if (!story) {
    const near = stories.filter((s) => s.id.startsWith(storyId.split("--")[0])).map((s) => s.id);
    return fail(`No story ${storyId} in ${project.dir}.${near.length ? " Same component: " + near.join(", ") : " list_stories gives the ids."}`);
  }
  const outDir = join(tmpdir(), "storybook-preview-mcp-app", createHash("sha1").update(story.file).digest("hex").slice(0, 12));
  const started = performance.now();
  const { code, out } = await runBuild(project.dir, story.file, outDir, story.title);
  const ms = Math.round(performance.now() - started);
  if (code !== 0) {
    const tail = out.trim().split("\n").filter((l) => !/DeprecationWarning|trace-deprecation/.test(l)).slice(-15).join("\n");
    return fail(`Building ${relative(project.dir, story.file)} failed after ${ms} ms:\n${tail}`);
  }
  const css = readFileSync(join(outDir, "story.css"), "utf8");
  const js = readFileSync(join(outDir, "story.js"), "utf8");
  return {
    content: text(`Showing ${story.title} › ${story.name} (${storyId}) from ${relative(project.dir, story.file)}; built in ${ms} ms.`),
    _meta: { "storybook/story": { id: storyId, title: `${story.title} › ${story.name}`, theme: args.theme ?? "host", css, js } },
  };
}

async function listStoriesTool(args) {
  const project = chooseProject(start(), args.project_dir);
  if (project.error) return { isError: true, content: text(project.error) };
  const filter = String(args.filter ?? "").toLowerCase();
  const stories = (await listStories(project.dir)).filter(
    (s) => !filter || s.id.includes(filter) || s.title.toLowerCase().includes(filter),
  );
  const lines = stories.slice(0, 200).map((s) => `${s.id}  (${s.title} › ${s.name})`);
  const more = stories.length > 200 ? `\n…and ${stories.length - 200} more; narrow with filter.` : "";
  return { content: text(`${stories.length} stories in ${project.dir}:\n${lines.join("\n")}${more}`) };
}

const projectDirSchema = {
  type: "string",
  description:
    "Absolute path of the folder holding .storybook, or of a checkout above it. Pass the folder you are working in (a git worktree, say): without it the server searches from where it was started.",
};

const tools = [
  {
    name: "preview_story",
    description:
      "Show a Storybook story live in the chat: the project's real CSS, fonts and decorators, its play step run, clickable. Call it again after an edit to see the change. Needs no running Storybook. story_id as Storybook names it (button--primary); list_stories gives them.",
    inputSchema: {
      type: "object",
      properties: {
        story_id: { type: "string" },
        theme: { type: "string", enum: ["host", "light", "dark"], description: "Default host: follow the app's light or dark theme." },
        project_dir: projectDirSchema,
      },
      required: ["story_id"],
    },
    _meta: { ui: { resourceUri: URI } },
  },
  {
    name: "list_stories",
    description: "List the Storybook story ids in a project, optionally filtered by a word in the id or title.",
    inputSchema: { type: "object", properties: { filter: { type: "string" }, project_dir: projectDirSchema } },
  },
];

async function handle(msg) {
  switch (msg.method) {
    case "initialize":
      return {
        protocolVersion: msg.params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: "storybook-preview", version: VERSION },
      };
    case "tools/list":
      return { tools };
    case "tools/call": {
      const args = msg.params?.arguments ?? {};
      try {
        if (msg.params?.name === "preview_story") return await previewStory(args);
        if (msg.params?.name === "list_stories") return await listStoriesTool(args);
        return fail(`No tool ${msg.params?.name}.`);
      } catch (e) {
        return fail(String(e?.stack ?? e));
      }
    }
    case "resources/list":
      return { resources: [{ uri: URI, name: "Storybook story", mimeType: MIME }] };
    case "resources/read":
      return { contents: [{ uri: URI, mimeType: MIME, text: page(), _meta: { ui: { prefersBorder: true } } }] };
    case "ping":
      return {};
    default:
      return undefined;
  }
}

// MCP over stdio: one JSON-RPC message per line.
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("end", () => process.exit(0));
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.id === undefined) continue;
    handle(msg).then((result) => {
      const reply =
        result === undefined
          ? { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } }
          : { jsonrpc: "2.0", id: msg.id, result };
      process.stdout.write(JSON.stringify(reply) + "\n");
    });
  }
});
