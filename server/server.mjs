#!/usr/bin/env node
// storybook-preview-mcp-app: an MCP server whose tool shows a Storybook story
// live inside the chat, as an MCP App.
//
// Hosts such as the Claude desktop app's Code tab run an MCP App page with no
// network access: no frame, fetch, stylesheet or script from localhost. So
// each call builds the story's file with the project's own Vite and Storybook
// config (build-story.mjs) and sends the whole bundle in the tool result's
// _meta, which reaches the page and stays out of the model's context.
//
// Transport: MCP over stdio, one JSON-RPC message per line.
import { reply } from "./mcp.mjs";

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
      process.stdout.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Parse error" },
        }) + "\n",
      );
      continue;
    }
    reply(msg).then((out) => {
      if (out) process.stdout.write(JSON.stringify(out) + "\n");
    });
  }
});
