import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { entryPath, indexPath, slugify } from "./core/paths.js";
import {
  forgetEntry,
  listIndex,
  readEntry,
  rebuildIndex,
  saveEntry,
  searchEntries,
  SimilarTopicError,
  UnsafeMemoryEntryError,
  writeEntry,
} from "./core/store.js";

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

test("readEntry cannot escape the ledger with a raw filename fallback", () => {
  isolated();
  writeEntry({ name: "safe-topic", description: "Safe", type: "project", body: "stays in the ledger" });
  assert.equal(readEntry("../README.md"), null);
  assert.equal(readEntry("safe-topic.md")?.name, "safe-topic");
});

test("writeEntry rejects likely secrets before touching the ledger", () => {
  isolated();
  assert.throws(
    () =>
      writeEntry({
        name: "secret-test",
        description: "Should not write",
        type: "project",
        body: "temporary key sk-abcdefghijklmnopqrstuvwxyz123456",
      }),
    UnsafeMemoryEntryError,
  );
  assert.equal(listIndex().length, 0);
  assert.equal(readEntry("secret-test"), null);
});

test("frontmatter fields are kept single-line", () => {
  isolated();
  writeEntry({
    name: "frontmatter-safe",
    description: "first\norigin: injected",
    type: "project",
    body: "body",
    origin: "mcp\npin: true",
  });
  const raw = readFileSync(entryPath("frontmatter-safe"), "utf8");
  assert.match(raw, /description: first origin: injected/);
  assert.match(raw, /origin: mcp pin: true/);
  assert.doesNotMatch(raw, /\ndescription: first\norigin:/);
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

const DIVERGE_A = "Use pnpm for install and scripts in this repo because the workspace demands it.";
const DIVERGE_B = "Never use pnpm here; the toolchain only supports plain npm with a committed lockfile.";

test("same slug, latin extension → upsert, no conflict, one index line", () => {
  isolated();
  saveEntry({ name: "pkg-mgr", description: "old", type: "project", body: DIVERGE_A });
  const r = saveEntry({ name: "pkg-mgr", description: "new", type: "project", body: `${DIVERGE_A} And for CI.` });
  assert.equal(r.name, "pkg-mgr");
  assert.equal(listIndex().length, 1);
});

test("same slug, diverging body → agent update replaces in place", () => {
  isolated();
  saveEntry({ name: "pkg-mgr", description: "use pnpm", type: "project", body: DIVERGE_A });
  const originalBytes = readFileSync(entryPath("pkg-mgr"), "utf8");
  const r = saveEntry({ name: "pkg-mgr", description: "use npm", type: "project", body: DIVERGE_B });
  assert.equal(r.name, "pkg-mgr");
  assert.equal(readEntry("pkg-mgr")?.body, DIVERGE_B);
  assert.equal(readEntry("pkg-mgr")?.conflictWith, undefined);
  assert.equal(readEntry("pkg-mgr-conflict"), null);
  assert.equal(listIndex().length, 1);
  assert.equal(listIndex()[0].description, "use npm");
  assert.notEqual(originalBytes, readFileSync(entryPath("pkg-mgr"), "utf8"));
});

test("same slug, negated high-overlap body → agent update replaces in place", () => {
  isolated();
  saveEntry({
    name: "package-manager",
    description: "Package manager rule",
    type: "project",
    body: "Use pnpm for installs in this repo.",
  });
  const result = saveEntry({
    name: "package-manager",
    description: "Package manager rule",
    type: "project",
    body: "Do not use pnpm for installs in this repo.",
  });
  assert.equal(result.name, "package-manager");
  assert.match(readEntry("package-manager")?.body ?? "", /^Do not use pnpm/);
  assert.equal(listIndex().length, 1);
});

test("new slug, title-overlap + diverging body → SimilarTopicError, no new file", () => {
  isolated();
  saveEntry({ name: "package-manager-rule", description: "package manager rule", type: "project", body: DIVERGE_A });
  assert.throws(
    () => saveEntry({ name: "package-manager-rules", description: "package manager rule", type: "project", body: DIVERGE_B }),
    (error: unknown) => error instanceof SimilarTopicError,
  );
  assert.ok(readEntry("package-manager-rule"));
  assert.equal(readEntry("package-manager-rules"), null);
  assert.equal(listIndex().length, 1);
});

test("new slug, close + similar body → SimilarTopicError, no new file", () => {
  isolated();
  saveEntry({ name: "use-pnpm", description: "Always use pnpm", type: "feedback", body: PNPM_BODY });
  assert.throws(
    () => saveEntry({ name: "prefer-pnpm", description: "Prefer pnpm", type: "feedback", body: PNPM_BODY }),
    (e: unknown) => e instanceof SimilarTopicError,
  );
  assert.equal(readEntry("prefer-pnpm"), null);
});

test("pinned same slug + diverging body → explicit update replaces body and keeps pin", () => {
  isolated();
  saveEntry({ name: "pinned-fact", description: "pinned", type: "project", body: DIVERGE_A, pin: true });
  const r = saveEntry({ name: "pinned-fact", description: "counter", type: "project", body: DIVERGE_B });
  assert.equal(r.name, "pinned-fact");
  const kept = readEntry("pinned-fact");
  assert.equal(kept?.body, DIVERGE_B);
  assert.equal(kept?.pin, true);
  assert.equal(readEntry("pinned-fact-conflict"), null);
});

test("pinned same slug + similar body → upsert in place, keep pin, no sibling", () => {
  isolated();
  saveEntry({ name: "pinned-fact", description: "pinned", type: "project", body: DIVERGE_A, pin: true });
  const r = saveEntry({
    name: "pinned-fact",
    description: "pinned (updated)",
    type: "project",
    body: `${DIVERGE_A} Also for CI.`,
  });
  assert.equal(r.name, "pinned-fact");
  const kept = readEntry("pinned-fact");
  assert.equal(kept?.pin, true);
  assert.match(kept?.body ?? "", /Also for CI/);
  assert.equal(readEntry("pinned-fact-conflict"), null);
  assert.equal(listIndex().length, 1);
});

const CN_LEDGER =
  "采用仓库内明文记忆，不写向量库，整理由人触发。空账本是正常状态。";
const CN_DEPLOY =
  "生产环境由主分支自动发布，不走本地打包，禁止在开发机直接推制品。";

test("same slug, diverging Chinese bodies → agent update replaces in place", () => {
  isolated();
  saveEntry({
    name: "ledger-policy",
    description: "账本策略",
    type: "project",
    body: CN_LEDGER,
  });
  const r = saveEntry({
    name: "ledger-policy",
    description: "发布方式",
    type: "project",
    body: CN_DEPLOY,
  });
  assert.equal(r.name, "ledger-policy");
  assert.equal(readEntry("ledger-policy")?.body, CN_DEPLOY);
  assert.equal(readEntry("ledger-policy")?.conflictWith, undefined);
  assert.equal(listIndex().length, 1);
});

test("same slug, Chinese extension → upsert, no conflict", () => {
  isolated();
  saveEntry({
    name: "ledger-policy",
    description: "账本策略",
    type: "project",
    body: CN_LEDGER,
  });
  const r = saveEntry({
    name: "ledger-policy",
    description: "账本策略",
    type: "project",
    body: `${CN_LEDGER}下次会话先读索引。`,
  });
  assert.equal(r.name, "ledger-policy");
  assert.equal(listIndex().length, 1);
  assert.match(readEntry("ledger-policy")?.body ?? "", /下次会话先读索引/);
});

const GRAY_A = "alpha bravo charlie delta echo foxtrot";
const GRAY_B = "alpha bravo charlie delta golf hotel india juliet";

test("same slug, gray rewrite that is not an extension → agent update replaces in place", () => {
  isolated();
  saveEntry({ name: "gray-fact", description: "gray a", type: "project", body: GRAY_A });
  const r = saveEntry({ name: "gray-fact", description: "gray b", type: "project", body: GRAY_B });
  assert.equal(r.name, "gray-fact");
  assert.equal(readEntry("gray-fact")?.body, GRAY_B);
  assert.equal(listIndex().length, 1);
});

test("new slug, similar Chinese topic → SimilarTopicError, no new file", () => {
  isolated();
  saveEntry({
    name: "ledger-policy",
    description: "账本策略",
    type: "project",
    body: CN_LEDGER,
  });
  assert.throws(
    () =>
      saveEntry({
        name: "ledger-notes",
        description: "账本策略",
        type: "project",
        body: `${CN_LEDGER}读索引。`,
      }),
    (error: unknown) => error instanceof SimilarTopicError,
  );
  assert.equal(readEntry("ledger-notes"), null);
  assert.equal(listIndex().length, 1);
});

test("Chinese-only same slug updates in place", () => {
  isolated();
  saveEntry({ name: "发布方式", description: "发布方式", type: "project", body: CN_DEPLOY });
  const r = saveEntry({ name: "发布方式", description: "发布方式", type: "project", body: CN_LEDGER });
  assert.equal(r.name, slugify("发布方式"));
  assert.ok(readEntry("发布方式"));
  assert.equal(readEntry("发布方式")?.body, CN_LEDGER);
  assert.notEqual(slugify("发布方式"), "memory");
});

test("forget the legacy conflict sibling clears the kept file pointer and index flag", () => {
  isolated();
  writeEntry({ name: "pkg-mgr", description: "use pnpm", type: "project", body: DIVERGE_A, conflictWith: "pkg-mgr-conflict" });
  writeEntry({ name: "pkg-mgr-conflict", description: "use npm", type: "project", body: DIVERGE_B, conflictWith: "pkg-mgr" });
  assert.equal(forgetEntry("pkg-mgr-conflict"), true);
  assert.equal(readEntry("pkg-mgr-conflict"), null);
  const kept = readEntry("pkg-mgr");
  assert.equal(kept?.conflictWith, undefined);
  assert.equal(listIndex().length, 1);
  assert.doesNotMatch(readFileSync(indexPath(), "utf8"), /\[conflict:/);
});

test("forget a pinned topic still removes it", () => {
  isolated();
  saveEntry({ name: "pinned-fact", description: "pinned", type: "project", body: DIVERGE_A, pin: true });
  assert.equal(forgetEntry("pinned-fact"), true);
  assert.equal(readEntry("pinned-fact"), null);
  assert.equal(listIndex().length, 0);
});

test("same slug update clears a legacy conflict marker on that topic", () => {
  isolated();
  writeEntry({ name: "pkg-mgr", description: "use pnpm", type: "project", body: DIVERGE_A, conflictWith: "pkg-mgr-conflict" });
  writeEntry({ name: "pkg-mgr-conflict", description: "use npm", type: "project", body: DIVERGE_B, conflictWith: "pkg-mgr" });
  const r = saveEntry({
    name: "pkg-mgr",
    description: "use pnpm (updated)",
    type: "project",
    body: `${DIVERGE_A} Also for CI.`,
  });
  assert.equal(r.name, "pkg-mgr");
  const kept = readEntry("pkg-mgr");
  assert.equal(kept?.conflictWith, undefined);
  assert.match(kept?.body ?? "", /Also for CI/);
  assert.equal(listIndex().length, 2);
  assert.equal(listIndex().find((item) => item.name === "pkg-mgr")?.conflictWith, undefined);
  assert.equal(listIndex().find((item) => item.name === "pkg-mgr-conflict")?.conflictWith, "pkg-mgr");
});

test("agent can resolve a legacy conflict by updating the kept slug and forgetting the obsolete sibling", () => {
  isolated();
  writeEntry({ name: "pkg-mgr", description: "use pnpm", type: "project", body: DIVERGE_A, conflictWith: "pkg-mgr-conflict" });
  writeEntry({ name: "pkg-mgr-conflict", description: "use npm", type: "project", body: DIVERGE_B, conflictWith: "pkg-mgr" });
  saveEntry({ name: "pkg-mgr", description: "canonical", type: "project", body: `${DIVERGE_A} Also use pnpm for CI.` });
  assert.equal(forgetEntry("pkg-mgr-conflict"), true);
  assert.equal(listIndex().length, 1);
  assert.equal(readEntry("pkg-mgr")?.conflictWith, undefined);
  assert.doesNotMatch(readFileSync(indexPath(), "utf8"), /\[conflict:/);
});

test("rebuildIndex keeps conflictWith from topic frontmatter", () => {
  isolated();
  writeEntry({ name: "pkg-mgr", description: "use pnpm", type: "project", body: DIVERGE_A, conflictWith: "pkg-mgr-conflict" });
  writeEntry({ name: "pkg-mgr-conflict", description: "use npm", type: "project", body: DIVERGE_B, conflictWith: "pkg-mgr" });
  rebuildIndex();
  const idx = listIndex();
  assert.equal(idx.length, 2);
  assert.ok(idx.every((item) => item.conflictWith), "index rows should still be flagged after rebuild");
  assert.match(readFileSync(indexPath(), "utf8"), /\[conflict:/);
});

test("large indexes truncate on whole lines with a visible omitted marker", () => {
  isolated();
  for (let i = 0; i < 205; i += 1) {
    writeEntry({
      name: `topic-${i}`,
      description: `中文描述 ${i} `.repeat(40),
      type: "project",
      body: `durable fact ${i}`,
    });
  }
  const text = readFileSync(indexPath(), "utf8");
  assert.match(text, /\(\+\d+ more topics; run node dist\/cli\.js dream --dry-run\)/);
  assert.ok(text.split(/\r?\n/).length <= 200);
  assert.doesNotMatch(text, /\uFFFD/);
});
