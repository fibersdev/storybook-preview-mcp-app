// Build one stories file into a single IIFE + CSS that mounts a story by id.
// Usage: node build-story.mjs <project dir> <stories file> <out dir> [title]
//
// The Vite config is put together the way Storybook's Vite builder does it:
// the project's Vite config (or the one main.ts names), the React plugin, then
// main.ts viteFinal. On top go the settings that make one self-contained
// bundle: an IIFE library build with every asset (fonts, images) inlined.
// Prints one JSON line: { ms } on success.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadMain, projectImport, projectResolve } from "./storybook.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const [projectDir, storiesFile, outDir, title] = process.argv.slice(2);
const started = performance.now();

const { main, configDir } = await loadMain(projectDir);
const framework = typeof main.framework === "string" ? main.framework : main.framework?.name;
if (!/react-vite/.test(String(framework))) {
  throw new Error(`Only React + Vite Storybooks are supported so far; this one uses ${framework}.`);
}

const vite = await projectImport(projectDir, "vite");
const viteConfigPath = main.framework?.options?.builder?.viteConfigPath;
const loaded = await vite.loadConfigFromFile({ command: "build", mode: "production" }, viteConfigPath, projectDir, "silent");
let config = loaded?.config ?? {};

const pluginNames = (config.plugins ?? []).flat(Infinity).filter(Boolean).map((p) => p.name);
if (!pluginNames.some((n) => /^vite:react/.test(n))) {
  try {
    const react = (await projectImport(projectDir, "@vitejs/plugin-react")).default;
    config = vite.mergeConfig(config, { plugins: [react()] });
  } catch {
    config = vite.mergeConfig(config, { esbuild: { jsx: "automatic" } });
  }
}
if (typeof main.viteFinal === "function") {
  config = await main.viteFinal(config, { configType: "PRODUCTION", configDir, outputDir: outDir });
}

const preview = ["preview.tsx", "preview.ts", "preview.jsx", "preview.js", "preview.mjs"]
  .map((f) => join(configDir, f))
  .find((f) => {
    try {
      return Boolean(projectResolve(projectDir, f));
    } catch {
      return false;
    }
  });

mkdirSync(outDir, { recursive: true });
const entry = join(outDir, "entry.jsx");
writeFileSync(
  entry,
  `import { composeStories, setProjectAnnotations } from ${JSON.stringify(framework)};
import { createRoot } from "react-dom/client";
${preview ? `import * as preview from ${JSON.stringify(preview)};` : ""}
import * as stories from ${JSON.stringify(storiesFile)};

${preview ? "setProjectAnnotations([preview]);" : ""}
// A file with no title gets Storybook's auto title from its path, which only
// the indexer knows; give it the one the server worked out, so ids match.
const meta = { ...stories.default, title: stories.default?.title ?? ${JSON.stringify(title ?? null)} ?? undefined };
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
`,
);

// The entry lives outside the project, so the packages it names are pinned to
// the project's own copies.
const pin = (specifier) => ({ find: new RegExp(`^${specifier.replace(/[/]/g, "\\/")}$`), replacement: projectResolve(projectDir, specifier) });
const pins = ["react", "react/jsx-runtime", "react/jsx-dev-runtime", "react-dom/client", framework].flatMap((s) => {
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
    lib: { entry, formats: ["iife"], name: "StoryBundle", fileName: () => "story.js", cssFileName: "story" },
  },
});
console.log(JSON.stringify({ ms: Math.round(performance.now() - started) }));
