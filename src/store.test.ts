import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { forgetEntry, listIndex, readEntry, saveEntry, searchEntries, SimilarTopicError, writeEntry } from "./core/store.js";

const dirs: string[] = [];

afterEach(() => {
  delete process.env.PROJECT_MEMORY_DIR;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function isolated(): string {
  const dir = mkdtempSync(join(tmpdir(), "pmem-"));
  dirs.push(dir);
  process.env.PROJECT_MEMORY_DIR = dir;
  return dir;
}

test("write updates index and is readable", () => {
  isolated();
  writeEntry({
    name: "user-frontend-liaison",
    description: "User is the frontend liaison",
    type: "user",
    body: "Give paste-ready answers.\n\n**Why:** they forward chat.\n**How to apply:** keep replies short.",
  });
  const index = listIndex();
  assert.equal(index.length, 1);
  assert.equal(index[0].name, "user-frontend-liaison");
  const entry = readEntry("user-frontend-liaison");
  assert.ok(entry);
  assert.equal(entry.type, "user");
  assert.match(entry.body, /paste-ready/);
});

test("write replaces same slug and search finds body", () => {
  isolated();
  writeEntry({ name: "build-via-idea", description: "old", type: "project", body: "use maven" });
  writeEntry({ name: "build-via-idea", description: "Compile in IDEA", type: "project", body: "do not run mvn" });
  assert.equal(listIndex().length, 1);
  assert.equal(listIndex()[0].description, "Compile in IDEA");
  assert.equal(searchEntries("mvn").length, 1);
  assert.equal(searchEntries("gradle").length, 0);
});

test("forget removes file and index row", () => {
  isolated();
  writeEntry({ name: "tmp-note", description: "gone soon", type: "feedback", body: "x" });
  assert.equal(forgetEntry("tmp-note"), true);
  assert.equal(listIndex().length, 0);
  assert.equal(readEntry("tmp-note"), null);
});

const PNPM_BODY =
  "Always use pnpm in this repo for install and scripts because npm lockfiles conflict with the workspace.";

test("saveEntry refuses a new slug close to an existing topic", () => {
  isolated();
  saveEntry({
    name: "use-pnpm",
    description: "Always use pnpm",
    type: "feedback",
    body: PNPM_BODY,
  });
  assert.throws(
    () =>
      saveEntry({
        name: "prefer-pnpm",
        description: "Prefer pnpm over npm",
        type: "feedback",
        body: "Always use pnpm in this repository for install and scripts because npm lockfiles conflict with the workspace layout.",
      }),
    (error: unknown) => {
      assert.ok(error instanceof SimilarTopicError);
      assert.ok(error.candidates.some((item) => item.name === "use-pnpm"));
      assert.match(error.message, /use-pnpm/);
      return true;
    },
  );
  assert.equal(listIndex().length, 1);
  assert.equal(listIndex()[0].name, "use-pnpm");
  assert.equal(readEntry("prefer-pnpm"), null);
});

test("saveEntry overwrites when the caller uses the existing slug", () => {
  isolated();
  saveEntry({
    name: "use-pnpm",
    description: "Always use pnpm",
    type: "feedback",
    body: PNPM_BODY,
  });
  const saved = saveEntry({
    name: "use-pnpm",
    description: "Always use pnpm (updated)",
    type: "feedback",
    body: `${PNPM_BODY} Also use pnpm for CI.`,
  });
  assert.equal(saved.name, "use-pnpm");
  assert.equal(listIndex().length, 1);
  assert.match(readEntry("use-pnpm")?.body ?? "", /Also use pnpm for CI/);
});

test("saveEntry allows two distinct CJK topics that have no latin tokens", () => {
  isolated();
  saveEntry({
    name: "research-cn",
    description: "本轮调研结果",
    type: "project",
    body: "采用仓库内明文记忆，不写向量库，整理由人触发。",
  });
  saveEntry({
    name: "deploy-cn",
    description: "发布方式",
    type: "project",
    body: "生产环境由主分支自动发布，不走本地打包。",
  });
  const names = listIndex().map((item) => item.name).sort();
  assert.deepEqual(names, ["deploy-cn", "research-cn"]);
  assert.match(readEntry("research-cn")?.body ?? "", /明文记忆/);
  assert.match(readEntry("deploy-cn")?.body ?? "", /主分支自动发布/);
});

test("writeEntry persists pin in frontmatter", () => {
  isolated();
  writeEntry({
    name: "keep-pin",
    description: "Pinned fact",
    type: "project",
    body: "This repo uses pnpm.",
    pin: true,
  });
  const entry = readEntry("keep-pin");
  assert.equal(entry?.pin, true);
});
