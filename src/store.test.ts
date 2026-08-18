import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { forgetEntry, listIndex, readEntry, searchEntries, writeEntry } from "./core/store.js";

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
