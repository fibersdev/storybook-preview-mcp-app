// Finding a project's Storybook and its stories, using Storybook's own
// helpers from the project's install, so ids and titles match Storybook's.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const MAIN_FILES = ["main.ts", "main.mts", "main.js", "main.mjs", "main.cjs"];
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "storybook-static", ".next", ".turbo"]);

const hasMain = (configDir) => MAIN_FILES.some((f) => existsSync(join(configDir, f)));

/** Storybook projects at or below `start` (three levels deep), then any above it. */
export function findProjects(start) {
  const found = [];
  const walk = (dir, depth) => {
    if (hasMain(join(dir, ".storybook"))) found.push(dir);
    if (depth === 0) return;
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) walk(join(dir, e.name), depth - 1);
    }
  };
  walk(start, 3);
  if (found.length) return found;
  for (let d = dirname(start); d !== dirname(d); d = dirname(d)) {
    if (hasMain(join(d, ".storybook"))) return [d];
  }
  return [];
}

/** Pick the one project to use, or explain why not. */
export function chooseProject(start, given) {
  const from = given ? resolve(start, given) : start;
  const projects = findProjects(from);
  if (projects.length === 1) return { dir: projects[0] };
  if (projects.length === 0) return { error: `No Storybook project (.storybook/main.*) found in or above ${from}. Pass project_dir.` };
  return { error: `Several Storybook projects found; pass project_dir as one of:\n${projects.map((p) => "  " + p).join("\n")}` };
}

/** Import a module the way the project itself would resolve it. */
export function projectImport(projectDir, specifier) {
  const require = createRequire(join(projectDir, "package.json"));
  return import(pathToFileURL(require.resolve(specifier)).href);
}

export function projectResolve(projectDir, specifier) {
  return createRequire(join(projectDir, "package.json")).resolve(specifier);
}

export async function loadMain(projectDir) {
  const common = await projectImport(projectDir, "storybook/internal/common");
  const configDir = join(projectDir, ".storybook");
  const main = await common.loadMainConfig({ configDir, noCache: true });
  return { main, configDir, common };
}

function walkFiles(dir, out = []) {
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walkFiles(p, out);
    } else out.push(p);
  }
  return out;
}

/** Every story Storybook would index: [{ id, title, name, exportName, file }].
 * Parsed with Storybook's own CSF parser and title rule, as its indexer does. */
export async function listStories(projectDir) {
  const { main, configDir, common } = await loadMain(projectDir);
  const csfTools = await projectImport(projectDir, "storybook/internal/csf-tools");
  const previewApi = await projectImport(projectDir, "storybook/internal/preview-api");
  const specifiers = common
    .normalizeStories(main.stories, { configDir, workingDir: projectDir })
    // Negated globs ("!…") arrive as their own specifiers; they add nothing.
    .filter((s) => !String(s.directory).includes("!"));
  const stories = [];
  const seen = new Set();
  for (const spec of specifiers) {
    const base = resolve(projectDir, spec.directory);
    if (!existsSync(base) || !statSync(base).isDirectory()) continue;
    for (const file of walkFiles(base)) {
      const importPath = "./" + relative(projectDir, file).split(sep).join("/");
      if (seen.has(file) || !spec.importPathMatcher.test(importPath)) continue;
      seen.add(file);
      let parsed;
      try {
        parsed = csfTools
          .loadCsf(readFileSync(file, "utf8"), {
            fileName: file,
            makeTitle: (userTitle) => previewApi.userOrAutoTitleFromSpecifier(importPath, spec, userTitle),
          })
          .parse();
      } catch {
        continue; // Not a story file Storybook could index either.
      }
      const title = parsed.meta?.title;
      for (const story of parsed.stories) {
        stories.push({ id: story.id, title, name: story.name, exportName: story.exportName ?? story.name, file });
      }
    }
  }
  return stories;
}
