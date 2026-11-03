import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import {
  chooseProject,
  findProjects,
  loadMain,
  storybookVersion,
  toImportPath,
} from "../../server/storybook.mjs";

const root = mkdtempSync(join(tmpdir(), "sbp-unit-"));
after(() => rmSync(root, { recursive: true, force: true }));

/** Make a folder with a .storybook/main.js in it. @param {string} dir */
function storybookAt(dir) {
  mkdirSync(join(dir, ".storybook"), { recursive: true });
  writeFileSync(join(dir, ".storybook/main.js"), "export default {};\n");
  return dir;
}

describe("findProjects", () => {
  test("finds a project at the start folder", () => {
    const dir = storybookAt(join(root, "single"));
    assert.deepEqual(findProjects(dir), [dir]);
  });

  test("finds projects below the start folder, as in a monorepo", () => {
    const mono = join(root, "mono");
    const web = storybookAt(join(mono, "apps/web"));
    const ui = storybookAt(join(mono, "packages/ui"));
    assert.deepEqual(findProjects(mono), [web, ui].toSorted());
  });

  test("skips node_modules and dot folders", () => {
    const dir = join(root, "skips");
    storybookAt(join(dir, "node_modules/some-lib"));
    storybookAt(join(dir, ".cache/thing"));
    assert.deepEqual(findProjects(dir), []);
  });

  test("falls back to the nearest project above", () => {
    const dir = storybookAt(join(root, "above"));
    const deep = join(dir, "src/components/button");
    mkdirSync(deep, { recursive: true });
    assert.deepEqual(findProjects(deep), [dir]);
  });

  test("looks no deeper than three levels", () => {
    const dir = join(root, "deep");
    storybookAt(join(dir, "a/b/c/d"));
    assert.deepEqual(findProjects(dir), []);
  });
});

describe("chooseProject", () => {
  test("picks the only project", () => {
    const dir = storybookAt(join(root, "choose-one"));
    assert.deepEqual(chooseProject(dir), { dir });
  });

  test("project_dir wins over the start folder, and can be a checkout above it", () => {
    const checkout = join(root, "worktree");
    const web = storybookAt(join(checkout, "apps/web"));
    assert.deepEqual(chooseProject("/", checkout), { dir: web });
  });

  test("asks for project_dir when there are several", () => {
    const mono = join(root, "mono");
    const result = chooseProject(mono);
    assert.ok(result.error?.includes("Several Storybook projects"));
    assert.ok(result.error?.includes(join(mono, "apps/web")));
  });

  test("says so when there is none", () => {
    const empty = join(root, "empty");
    mkdirSync(empty);
    assert.match(chooseProject(empty).error ?? "", /No Storybook project/);
  });

  test("says so when project_dir doesn't exist", () => {
    assert.match(chooseProject(root, join(root, "nope")).error ?? "", /doesn't exist/);
  });
});

describe("Storybook install checks", () => {
  test("storybookVersion is undefined without an install", () => {
    assert.equal(storybookVersion(join(root, "single")), undefined);
  });

  test("loadMain explains a missing install", async () => {
    await assert.rejects(loadMain(join(root, "single")), /Storybook isn't installed/);
  });

  test("loadMain refuses an old Storybook", async () => {
    const dir = storybookAt(join(root, "old"));
    mkdirSync(join(dir, "node_modules/storybook"), { recursive: true });
    writeFileSync(join(dir, "package.json"), "{}");
    writeFileSync(
      join(dir, "node_modules/storybook/package.json"),
      JSON.stringify({ name: "storybook", version: "8.6.0" }),
    );
    await assert.rejects(loadMain(dir), /Storybook 8\.6\.0.*needs Storybook 10/);
  });
});

test("toImportPath uses forward slashes", () => {
  assert.equal(toImportPath(join("a", "b", "c.tsx")), "a/b/c.tsx");
});
