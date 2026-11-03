# storybook-preview-mcp-app

A Claude Code plugin that shows a Storybook story live in the chat. It is an MCP App: a small web page the chat draws under a tool call.

Ask Claude to preview a story and it appears under the tool call, styled with your project's real CSS and fonts. Buttons click, menus open, and the story's `play` step (the scripted interaction a story can define) runs. Edit the component, ask again, and the new version shows.

It needs no running Storybook and no addon in your project. Each preview builds the one story file with your project's own Vite and Storybook config, in about half a second once warm.

## Why it is built this way

Some hosts give an MCP App page no network access. In my testing in the Claude desktop app's Code tab (November 2026), a page could not load a frame, script, stylesheet or image from `localhost`, even with that address listed in the page's allowed domains. That rules out pointing a frame at a running Storybook, which is how Storybook's own MCP addon shows a preview; in the same test its frame stayed empty.

What the page can do is read the result of the tool call. So the server builds the story into one bundle (HTML, CSS with fonts inlined, and JavaScript) and sends it in the result's `_meta` field. The page puts it on screen. In my runs, `_meta` reached the page without being added to Claude's context, so a preview cost one line of context however large the bundle was.

## Install

At the prompt of a Claude Code session:

```
/plugin install storybook-preview-mcp-app --marketplace fibersdev/storybook-preview-mcp-app
```

From a shell:

```bash
claude plugin install storybook-preview-mcp-app --marketplace fibersdev/storybook-preview-mcp-app
```

In the Claude desktop app: click + next to the prompt box, then Plugins, Add marketplace with `fibersdev/storybook-preview-mcp-app`, then Add plugin.

You'll need Node 20 or later on your `PATH`.

## Use

Ask for a story in plain words ("show me the Button primary story") and Claude calls the tools:

- **`list_stories`** lists the story ids in a project, optionally filtered by a word.
- **`preview_story`** shows one story. It takes `story_id` (as Storybook names it, for example `button--primary`), an optional `theme` (`host`, `light` or `dark`) and an optional `project_dir`.

In the desktop app's Code tab, the preview sits in a collapsed "Rendering widget" row under the tool call. Click it to open.

**Which project it builds.** The server looks for a `.storybook` folder in and below the folder it starts in, then above it. When you work in a git worktree, Claude passes the worktree's path as `project_dir`, so the preview shows the code you are editing rather than the main checkout.

**Theme.** By default the story follows the app's light or dark theme. The page sets a `dark` or `light` class and `data-theme` on the root element, which I'd expect to cover most setups.

## What it supports

- **Storybook 10 with `@storybook/react-vite`.** Other frameworks are not supported yet.
- **Your decorators and global CSS**, from `.storybook/preview.*`, applied as Storybook applies them.
- **Your Vite config**, from `vite.config.*` or the file `main.ts` names, then `viteFinal`, in the order Storybook's Vite builder uses.
- **Story ids** worked out with Storybook's own parser and title rules, so they match your Storybook.

## Limits

- Each preview shows the story's default args. There is no controls panel.
- Reloading means calling the tool again; there is no automatic refresh on save.
- A story that fetches from your dev server or an API at run time would not reach it, for the same network reason as above.
- A bundle includes React and Storybook's preview code, so it is often 1 to 2 MB. It travels to the page, not to Claude.

## How it works

Three files do the work:

- `server/server.mjs` is the MCP server (stdio, no dependencies). It finds the project, lists stories and runs a build per preview.
- `server/build-story.mjs` loads your `.storybook/main.*` with Storybook's own loader, puts the Vite config together, and builds one stories file into a single script and stylesheet.
- `server/page.html` is the MCP App page. It does the `ui/initialize` handshake (the first exchange that tells the host the page is ready), mounts the story from the tool result, runs its `play` step and follows the host theme.

Made by [fibers](https://github.com/fibersdev). MIT licence.
