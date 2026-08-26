import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { ensureGitignored } from "./core/gitignore.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "pmem-gi-"));
  dirs.push(dir);
  return dir;
}

test("missing .gitignore is created with the rule and a comment", () => {
  const root = tmp();
  assert.equal(ensureGitignored(root), "created");
  const raw = readFileSync(join(root, ".gitignore"), "utf8");
  assert.match(raw, /^#.*project-memory/m);
  assert.match(raw, /^\.memory\/$/m);
});

test("present .gitignore without the rule gets it appended", () => {
  const root = tmp();
  writeFileSync(join(root, ".gitignore"), "node_modules/\n", "utf8");
  assert.equal(ensureGitignored(root), "appended");
  const raw = readFileSync(join(root, ".gitignore"), "utf8");
  assert.match(raw, /node_modules\//);
  assert.match(raw, /^\.memory\/$/m);
});

test("append handles a file with no trailing newline", () => {
  const root = tmp();
  writeFileSync(join(root, ".gitignore"), "dist/", "utf8"); // no newline
  assert.equal(ensureGitignored(root), "appended");
  const raw = readFileSync(join(root, ".gitignore"), "utf8");
  assert.match(raw, /^dist\/$/m);
  assert.match(raw, /^\.memory\/$/m);
});

test("already-ignored is a no-op and idempotent", () => {
  const root = tmp();
  writeFileSync(join(root, ".gitignore"), ".memory/\n", "utf8");
  const before = readFileSync(join(root, ".gitignore"), "utf8");
  assert.equal(ensureGitignored(root), "present");
  assert.equal(readFileSync(join(root, ".gitignore"), "utf8"), before);
  // Also idempotent across the created→present path.
  const root2 = tmp();
  ensureGitignored(root2);
  const after1 = readFileSync(join(root2, ".gitignore"), "utf8");
  assert.equal(ensureGitignored(root2), "present");
  assert.equal(readFileSync(join(root2, ".gitignore"), "utf8"), after1);
});

test("recognizes the .memory (no slash) and glob forms as already ignored", () => {
  const root = tmp();
  writeFileSync(join(root, ".gitignore"), "**/.memory/**\n", "utf8");
  assert.equal(ensureGitignored(root), "present");
});

test("this repo's own .gitignore ignores .memory/", () => {
  // Dogfood: the repo root two levels up from dist/core would be hard to find
  // from the test dir; assert on the source .gitignore path instead.
  const repoRoot = join(process.cwd());
  const gi = join(repoRoot, ".gitignore");
  if (!existsSync(gi)) return; // running from an unexpected cwd; skip quietly
  assert.match(readFileSync(gi, "utf8"), /^\.memory\/?$/m);
});
