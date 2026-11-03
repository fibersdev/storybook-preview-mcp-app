# storybook-preview-mcp-app

A Claude Code plugin that shows your Storybook stories inside the chat, live.

Ask Claude to preview a story and it appears under the reply: your real CSS, fonts and decorators, buttons that click, menus that open. Edit the component, ask again, and the new version shows. You don't need Storybook running.

## Install

You'll need Claude Code, Node 20 or later, and a project using Storybook 10 with React and Vite (`@storybook/react-vite`).

The plugin is listed in the [fibersdev marketplace](https://github.com/fibersdev/plugins). In a Claude Code terminal session:

```
/plugin marketplace add fibersdev/plugins
/plugin install storybook-preview-mcp-app@fibersdev
```

Or from a shell:

```bash
claude plugin marketplace add fibersdev/plugins
claude plugin install storybook-preview-mcp-app@fibersdev
```

In the Claude desktop app (as of November 2026): click + next to the prompt box, then Plugins, Add marketplace with `fibersdev/plugins`, then add storybook-preview-mcp-app.

Nothing needs adding to your project.

## Use

Ask in plain words: "show me the Button primary story", "preview the menu open in dark mode", "what stories does the Card have?". Claude uses two tools (functions the plugin offers, which Claude calls for you):

- **`preview_story`** shows one story. It takes the story's id as Storybook names it (for example `button--primary`), an optional `theme` (`host`, `light` or `dark`) and an optional `project_dir`.
- **`list_stories`** lists the story ids in a project, optionally filtered by a word.

The preview is an MCP App: a small web page the chat draws under the tool call. In the Claude desktop app's Code tab it sits in a collapsed "Rendering widget" row; click the row to open it.

**Which project it previews.** The plugin looks for a `.storybook` folder in and below the folder Claude Code started in, then above it. In a monorepo with several, I'd expect Claude to pass `project_dir`. In a git worktree, it should pass the worktree's path, so the preview shows the code you are editing rather than the main checkout. If it picks the wrong one, name the folder in your ask.

**Theme.** By default the story follows the app's light or dark theme. The page sets a `dark` or `light` class and a `data-theme` attribute on the root element, which I'd expect to cover most setups.

## What it supports

- **Storybook 10 with `@storybook/react-vite`.** Other frameworks aren't supported yet.
- **Your Vite config**, from `vite.config.*` or the file your `main` config names, then `viteFinal`, in the order Storybook's own Vite builder uses.
- **Your decorators and global CSS** from `.storybook/preview.*`, and each story's `play` step.
- **Story ids worked out by Storybook's own parser**, so they match your Storybook. The tests check this against `storybook build`.

## Limits

- Each preview shows the story's default args. There is no controls panel.
- To see a change, ask again. It doesn't refresh on save.
- A story that fetches from your dev server or an API at run time would not reach it. The reason is below.
- The bundle includes React and Storybook's preview code, so it is often 1 to 2 MB. It goes to the page, not to Claude.

## Why it is built this way

At least one host gives an MCP App (a small web page the chat draws under a tool call) no network access. In my testing in the Claude desktop app's Code tab (November 2026), the page could not load a frame, script, stylesheet or image from `localhost`, even with that address listed as allowed. That rules out pointing a frame at a running Storybook in that host.

As I understand it, that is the approach Storybook's own MCP addon takes, and in the same test its frame stayed empty for me. It may well work in hosts that allow `localhost`.

What the page can do is read the result of the tool call. So each preview builds the one stories file with your project's own Vite and Storybook config. The result is a single script and stylesheet with fonts and images inlined, sent in the result's `_meta` field (a part of the tool result the page can read but Claude doesn't see). In my runs, `_meta` reached the page without being added to Claude's context, so a preview cost one line of context however large the bundle was.

## How it works

- `server/server.mjs` runs the MCP server over stdio. It has no dependencies.
- `server/mcp.mjs` answers MCP requests; `server/tools.mjs` holds the two tools.
- `server/storybook.mjs` finds the project and lists its stories with Storybook's own loader and parser.
- `server/build-story.mjs` builds one stories file. It runs in a child process with a time limit (two minutes, or `STORYBOOK_PREVIEW_TIMEOUT_MS`).
- `server/page.html` is the MCP App page. It does the handshake with the host, mounts the story, runs its `play` step and follows the theme.

## Development

```bash
bun install
bun run verify
```

`bun run verify` runs the format check (`bun fmt`), lint (oxlint), type check (`bun check`), version check and unit tests. The end-to-end tests build two fixture projects in `test/fixtures` and show their stories in headless Chromium, with the test playing the host:

```bash
bun run fixtures:install
bunx playwright install chromium
bun run test:e2e
```

CI runs all of these on every pull request.

## Credits

Made by [fibers](https://github.com/fibersdev). MIT licence. The icon is the "view" icon from [Lucide](https://lucide.dev) (ISC licence, notice in `.claude-plugin/ICON-LICENSE`).
