// The two tools: preview_story builds one story and returns it in _meta for
// the MCP App page; list_stories names the stories a project has.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { chooseProject, listStories } from "./storybook.mjs";

const here = dirname(fileURLToPath(import.meta.url));

/** The key the page reads the story from, in the tool result's _meta. */
export const META_KEY = "storybook/story";
/** How long one build may take before it is stopped. */
export const BUILD_TIMEOUT_MS = Number(process.env.STORYBOOK_PREVIEW_TIMEOUT_MS) || 120_000;
/** list_stories prints at most this many lines. */
const LIST_LIMIT = 200;

/**
 * @typedef {{ type: "text", text: string }} TextContent
 * @typedef {{ content: TextContent[], isError?: boolean, _meta?: Record<string, unknown> }} ToolResult
 * @typedef {{ story_id?: unknown, theme?: unknown, project_dir?: unknown, filter?: unknown }} ToolArgs
 */

/** @param {string} text @returns {TextContent[]} */
const textContent = (text) => [{ type: "text", text }];

/** @param {string} text @returns {ToolResult} */
export const fail = (text) => ({
  isError: true,
  content: textContent(text),
  _meta: { [META_KEY]: { error: text } },
});

/** @param {unknown} value */
const optionalString = (value) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

/** Where to start looking for the project when the caller names none. */
export const startDir = () => process.env.CLAUDE_PROJECT_DIR || process.cwd();

/**
 * Run build-story.mjs in a child process, stopping it after the timeout.
 * @param {{ projectDir: string, file: string, outDir: string, title: string, timeoutMs?: number }} opts
 * @returns {Promise<{ code: number | null, out: string, timedOut: boolean }>}
 */
export function runBuild({ projectDir, file, outDir, title, timeoutMs = BUILD_TIMEOUT_MS }) {
  return new Promise((done) => {
    const child = spawn(
      process.execPath,
      [join(here, "build-story.mjs"), projectDir, file, outDir, title],
      { cwd: projectDir, stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => {
      clearTimeout(timer);
      done({ code, out, timedOut });
    });
  });
}

/** The last lines of a build's output, without Node's deprecation noise. @param {string} out */
const tail = (out) =>
  out
    .trim()
    .split("\n")
    .filter((l) => !/DeprecationWarning|trace-deprecation/.test(l))
    .slice(-15)
    .join("\n");

/**
 * @param {ToolArgs} args
 * @returns {Promise<ToolResult>}
 */
export async function previewStory(args) {
  const storyId = optionalString(args.story_id);
  if (!storyId) {
    return fail("story_id is required, e.g. button--primary. list_stories gives the ids.");
  }
  const theme = optionalString(args.theme) ?? "host";
  if (!["host", "light", "dark"].includes(theme)) {
    return fail(`theme must be host, light or dark; got ${theme}.`);
  }
  const project = chooseProject(startDir(), optionalString(args.project_dir));
  if (project.error !== undefined) return fail(project.error);

  const stories = await listStories(project.dir);
  const story = stories.find((s) => s.id === storyId);
  if (!story) {
    const component = storyId.split("--")[0];
    const near = stories.filter((s) => s.id.startsWith(component + "--")).map((s) => s.id);
    return fail(
      `No story ${storyId} in ${project.dir}.` +
        (near.length ? ` Same component: ${near.join(", ")}` : " list_stories gives the ids."),
    );
  }

  // Each call builds into its own folder, so two previews at once can't mix.
  const outDir = mkdtempSync(join(tmpdir(), "storybook-preview-"));
  try {
    const started = performance.now();
    const { code, out, timedOut } = await runBuild({
      projectDir: project.dir,
      file: story.file,
      outDir,
      title: story.title,
    });
    const ms = Math.round(performance.now() - started);
    const fileName = relative(project.dir, story.file);
    if (timedOut) {
      return fail(
        `Building ${fileName} took longer than ${BUILD_TIMEOUT_MS / 1000} s and was stopped. Set STORYBOOK_PREVIEW_TIMEOUT_MS to allow longer.`,
      );
    }
    if (code !== 0) return fail(`Building ${fileName} failed after ${ms} ms:\n${tail(out)}`);
    const css = readFileSync(join(outDir, "story.css"), "utf8");
    const js = readFileSync(join(outDir, "story.js"), "utf8");
    return {
      content: textContent(
        `Showing ${story.title} › ${story.name} (${storyId}) from ${fileName}; built in ${ms} ms.`,
      ),
      _meta: {
        [META_KEY]: { id: storyId, title: `${story.title} › ${story.name}`, theme, css, js },
      },
    };
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

/**
 * @param {ToolArgs} args
 * @returns {Promise<ToolResult>}
 */
export async function listStoriesTool(args) {
  const project = chooseProject(startDir(), optionalString(args.project_dir));
  if (project.error !== undefined) return { isError: true, content: textContent(project.error) };
  const filter = (optionalString(args.filter) ?? "").toLowerCase();
  const stories = (await listStories(project.dir)).filter(
    (s) => !filter || s.id.includes(filter) || s.title.toLowerCase().includes(filter),
  );
  const lines = stories.slice(0, LIST_LIMIT).map((s) => `${s.id}  (${s.title} › ${s.name})`);
  const more =
    stories.length > LIST_LIMIT
      ? `\n…and ${stories.length - LIST_LIMIT} more; narrow with filter.`
      : "";
  return {
    content: textContent(
      `${stories.length} stories in ${project.dir}:\n${lines.join("\n")}${more}`,
    ),
  };
}
