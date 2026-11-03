// Finding a project's Storybook and its stories, using Storybook's own
// helpers from the project's install, so ids and titles match Storybook's.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * @typedef {{ id: string, title: string, name: string, exportName: string, file: string }} Story
 * @typedef {{ dir: string, error?: undefined } | { dir?: undefined, error: string }} ProjectChoice
 */

const MAIN_FILES = ["main.ts", "main.mts", "main.cts", "main.js", "main.mjs", "main.cjs"];
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "storybook-static",
  ".next",
  ".turbo",
]);
/** How far below the starting folder to look for .storybook. */
const SEARCH_DEPTH = 3;

/** @param {string} configDir */
const hasMain = (configDir) => MAIN_FILES.some((f) => existsSync(join(configDir, f)));

/** A path as an import specifier: forward slashes on every platform. @param {string} p */
export const toImportPath = (p) => p.split(sep).join("/");

/**
 * Storybook projects at or below `start` (SEARCH_DEPTH levels), else the
 * nearest one above it.
 * @param {string} start
 * @returns {string[]}
 */
export function findProjects(start) {
  /** @type {string[]} */
  const found = [];
  /** @param {string} dir @param {number} depth */
  const walk = (dir, depth) => {
    if (hasMain(join(dir, ".storybook"))) found.push(dir);
    if (depth === 0) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) {
        walk(join(dir, e.name), depth - 1);
      }
    }
  };
  walk(start, SEARCH_DEPTH);
  if (found.length) return found.toSorted();
  for (let d = dirname(start); d !== dirname(d); d = dirname(d)) {
    if (hasMain(join(d, ".storybook"))) return [d];
  }
  return [];
}

/**
 * The one project to use, or why there isn't one.
 * @param {string} start where the server was started
 * @param {string} [given] project_dir from the caller
 * @returns {ProjectChoice}
 */
export function chooseProject(start, given) {
  const from = given ? resolve(start, given) : start;
  if (given && !existsSync(from)) return { error: `project_dir ${from} doesn't exist.` };
  const projects = findProjects(from);
  if (projects.length === 1) return { dir: projects[0] };
  if (projects.length === 0) {
    return {
      error: `No Storybook project (.storybook/main.*) found in or above ${from}. Pass project_dir.`,
    };
  }
  return {
    error: `Several Storybook projects found; pass project_dir as one of:\n${projects.map((p) => "  " + p).join("\n")}`,
  };
}

/** @param {string} projectDir @param {string} specifier */
export function projectResolve(projectDir, specifier) {
  return createRequire(join(resolve(projectDir), "package.json")).resolve(specifier);
}

/**
 * Import a module the way the project itself would resolve it.
 * @param {string} projectDir
 * @param {string} specifier
 * @returns {Promise<any>}
 */
export function projectImport(projectDir, specifier) {
  return import(pathToFileURL(projectResolve(projectDir, specifier)).href);
}

/**
 * The project's Storybook version, or undefined when it isn't installed.
 * @param {string} projectDir
 */
export function storybookVersion(projectDir) {
  try {
    const pkg = projectResolve(projectDir, "storybook/package.json");
    return /** @type {{ version: string }} */ (JSON.parse(readFileSync(pkg, "utf8"))).version;
  } catch {
    return undefined;
  }
}

/** The lowest Storybook major this has been built against. */
export const MIN_STORYBOOK_MAJOR = 10;

/**
 * Load .storybook/main.* with Storybook's own loader.
 * @param {string} projectDir
 */
export async function loadMain(projectDir) {
  projectDir = resolve(projectDir);
  const version = storybookVersion(projectDir);
  if (!version) {
    throw new Error(
      `Storybook isn't installed in ${projectDir} (no "storybook" package found). Install the project's dependencies first.`,
    );
  }
  if (Number(version.split(".")[0]) < MIN_STORYBOOK_MAJOR) {
    throw new Error(
      `This project uses Storybook ${version}; storybook-preview-mcp-app needs Storybook ${MIN_STORYBOOK_MAJOR} or later.`,
    );
  }
  const common = await projectImport(projectDir, "storybook/internal/common");
  const configDir = join(projectDir, ".storybook");
  /** @type {any} */
  const main = await common.loadMainConfig({ configDir, noCache: true });
  return { main, configDir, common, version };
}

/**
 * The framework package name from main.ts, e.g. "@storybook/react-vite".
 * @param {any} main
 * @returns {string | undefined}
 */
export function frameworkName(main) {
  return typeof main.framework === "string" ? main.framework : main.framework?.name;
}

/** @param {string} dir @param {string[]} [out] */
function walkFiles(dir, out = []) {
  let entries;
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

/**
 * Every story Storybook would index. Parsed with Storybook's own CSF parser
 * and title rule, as its indexer does.
 * @param {string} projectDir
 * @returns {Promise<Story[]>}
 */
export async function listStories(projectDir) {
  projectDir = resolve(projectDir);
  const { main, configDir, common } = await loadMain(projectDir);
  const csfTools = await projectImport(projectDir, "storybook/internal/csf-tools");
  const previewApi = await projectImport(projectDir, "storybook/internal/preview-api");
  /** @type {any[]} */
  const specifiers = common
    .normalizeStories(main.stories, { configDir, workingDir: projectDir })
    // Negated globs ("!…") arrive as their own specifiers; they add nothing.
    .filter((/** @type {any} */ s) => !String(s.directory).includes("!"));
  /** @type {Story[]} */
  const stories = [];
  const seen = new Set();
  for (const spec of specifiers) {
    const base = resolve(projectDir, spec.directory);
    if (!existsSync(base) || !statSync(base).isDirectory()) continue;
    for (const file of walkFiles(base)) {
      const importPath = "./" + toImportPath(relative(projectDir, file));
      if (seen.has(file) || !spec.importPathMatcher.test(importPath)) continue;
      seen.add(file);
      let parsed;
      try {
        parsed = csfTools
          .loadCsf(readFileSync(file, "utf8"), {
            fileName: file,
            makeTitle: (/** @type {string | undefined} */ userTitle) =>
              previewApi.userOrAutoTitleFromSpecifier(importPath, spec, userTitle),
          })
          .parse();
      } catch {
        continue; // Not a story file Storybook could index either.
      }
      const title = parsed.meta?.title;
      for (const story of parsed.stories) {
        stories.push({
          id: story.id,
          title,
          name: story.name,
          exportName: story.exportName ?? story.name,
          file,
        });
      }
    }
  }
  return stories;
}
