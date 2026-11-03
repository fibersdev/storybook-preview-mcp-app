// Build one stories file into a single IIFE + CSS that mounts a story by id.
// Usage: node build-story.mjs <project dir> <stories file> <out dir> [title]
//
// The Vite config is put together the way Storybook's Vite builder does it:
// the project's Vite config (or the one main.ts names), the React plugin, then
// main.ts viteFinal. On top go the settings that make one self-contained
// bundle: an IIFE library build with every asset (fonts, images) inlined.
// Prints one JSON line on success: { "ms": <build time> }.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  frameworkName,
  loadMain,
  projectImport,
  projectResolve,
  toImportPath,
} from "./storybook.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PREVIEW_FILES = ["preview.tsx", "preview.ts", "preview.jsx", "preview.js", "preview.mjs"];
/** A string as a JavaScript literal. @param {string} s */
const q = (s) => JSON.stringify(s);

/**
 * The bundle's entry: compose the file's stories with the project
 * annotations and expose window.__story.mount(id, element).
 * @param {{ framework: string, preview?: string, storiesFile: string, title?: string }} opts
 */
export function entrySource({ framework, preview, storiesFile, title }) {
  return `import { composeStories, setProjectAnnotations } from ${q(framework)};
import { createRoot } from "react-dom/client";
${preview ? `import * as preview from ${q(toImportPath(preview))};` : ""}
import * as stories from ${q(toImportPath(storiesFile))};

${preview ? "setProjectAnnotations([preview]);" : ""}
// A file with no title gets Storybook's auto title from its path, which only
// the indexer knows; give it the one the server worked out, so ids match.
const meta = { ...stories.default, title: (stories.default?.title ?? ${q(title ?? "")}) || undefined };
const composed = Object.values(composeStories({ ...stories, default: meta }));
let root;
window.__story = {
  ids: composed.map((s) => s.id),
  async mount(id, el) {
    const Story = composed.find((s) => s.id === id);
    if (!Story) return { ok: false };
    root ??= createRoot(el);
    root.render(<Story />);
    // A story's play step (a click that opens a menu, say) is part of its look.
    if (!Story.play) return { ok: true };
    await new Promise((r) => setTimeout(r, 50));
    try {
      await Story.play({ canvasElement: el });
      return { ok: true, played: true };
    } catch (e) {
      return { ok: true, played: false, playError: String(e?.message ?? e) };
    }
  },
};
`;
}

/**
 * Build `storiesFile` into `outDir/story.js` and `outDir/story.css`.
 * @param {{ projectDir: string, storiesFile: string, outDir: string, title?: string }} opts
 */
export async function buildStory({ projectDir, storiesFile, outDir, title }) {
  const started = performance.now();
  const { main, configDir, version } = await loadMain(projectDir);
  const framework = frameworkName(main);
  if (!framework?.endsWith("react-vite")) {
    throw new Error(
      `Only React + Vite Storybooks (@storybook/react-vite) are supported so far; this one uses ${framework ?? "an unnamed framework"} (Storybook ${version}).`,
    );
  }

  const vite = await projectImport(projectDir, "vite");
  const viteConfigPath = main.framework?.options?.builder?.viteConfigPath;
  const loaded = await vite.loadConfigFromFile(
    { command: "build", mode: "production" },
    viteConfigPath,
    projectDir,
    "silent",
  );
  /** @type {any} */
  let config = loaded?.config ?? {};

  /** @type {string[]} */
  const pluginNames = (config.plugins ?? [])
    .flat(Infinity)
    .filter(Boolean)
    .map((/** @type {{ name: string }} */ p) => p.name);
  if (!pluginNames.some((n) => n.startsWith("vite:react"))) {
    try {
      const react = (await projectImport(projectDir, "@vitejs/plugin-react")).default;
      config = vite.mergeConfig(config, { plugins: [react()] });
    } catch {
      config = vite.mergeConfig(config, { esbuild: { jsx: "automatic" } });
    }
  }
  if (typeof main.viteFinal === "function") {
    config = await main.viteFinal(config, {
      configType: "PRODUCTION",
      configDir,
      outputDir: outDir,
    });
  }

  const preview = PREVIEW_FILES.map((f) => join(configDir, f)).find((f) => {
    try {
      return Boolean(projectResolve(projectDir, f));
    } catch {
      return false;
    }
  });

  mkdirSync(outDir, { recursive: true });
  const entry = join(outDir, "entry.jsx");
  writeFileSync(entry, entrySource({ framework, preview, storiesFile, title }));

  // The entry lives outside the project, so the packages it names are pinned
  // to the project's own copies.
  /** @param {string} specifier */
  const pin = (specifier) => ({
    find: new RegExp(`^${specifier.replaceAll("/", "\\/")}$`),
    replacement: projectResolve(projectDir, specifier),
  });
  const pins = [
    "react",
    "react/jsx-runtime",
    "react/jsx-dev-runtime",
    "react-dom/client",
    framework,
  ].flatMap((s) => {
    try {
      return [pin(s)];
    } catch {
      return [];
    }
  });
  const existingAlias = config.resolve?.alias;
  const alias = [
    // Storybook's Vitest addon imports this lazily; it only exists in a test run.
    { find: /^vitest\/browser$/, replacement: join(here, "stubs/vitest-browser.mjs") },
    ...pins,
    ...(Array.isArray(existingAlias)
      ? existingAlias
      : Object.entries(existingAlias ?? {}).map(([find, replacement]) => ({ find, replacement }))),
  ];

  await vite.build({
    ...config,
    root: projectDir,
    configFile: false,
    logLevel: "error",
    publicDir: false,
    define: { ...config.define, "process.env.NODE_ENV": JSON.stringify("production") },
    resolve: { ...config.resolve, alias },
    build: {
      outDir,
      emptyOutDir: false,
      copyPublicDir: false,
      assetsInlineLimit: () => true,
      cssCodeSplit: false,
      minify: true,
      sourcemap: false,
      rollupOptions: {},
      lib: {
        entry,
        formats: ["iife"],
        name: "StoryBundle",
        fileName: () => "story.js",
        cssFileName: "story",
      },
    },
  });
  return { ms: Math.round(performance.now() - started) };
}

// Run as a child process by the server, so a crash or hang in a project's
// build can't take the server down.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [projectDir, storiesFile, outDir, title] = process.argv.slice(2);
  const result = await buildStory({ projectDir, storiesFile, outDir, title });
  console.log(JSON.stringify(result));
}
