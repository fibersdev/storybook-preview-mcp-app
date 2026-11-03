// The plugin's version lives in three places; they must agree.
import { readFileSync } from "node:fs";

/** @param {string} path */
const read = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));

const versions = {
  "package.json": read("package.json").version,
  ".claude-plugin/plugin.json": read(".claude-plugin/plugin.json").version,
};
const distinct = new Set(Object.values(versions));
if (distinct.size !== 1) {
  console.error("Versions differ:", versions);
  process.exit(1);
}
console.log(`Versions agree: ${[...distinct][0]}`);
