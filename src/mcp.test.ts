import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { writeEntry } from "./core/store.js";
import { memoryIndexText, withRoot } from "./mcp.js";

const dirs: string[] = [];

afterEach(() => {
  delete process.env.PROJECT_MEMORY_DIR;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("memory_index response leads with the ledger path it resolved to", () => {
  const dir = mkdtempSync(join(tmpdir(), "pmem-mcp-"));
  dirs.push(dir);
  process.env.PROJECT_MEMORY_DIR = dir;
  writeEntry({ name: "root-echo", description: "root must be visible", type: "project", body: "x" });
  const text = memoryIndexText();
  assert.ok(text.startsWith("[ledger: "), text);
  assert.ok(text.includes(dir), text);
  assert.match(text, /root-echo/);
});

test("withRoot stamps the ledger dir on every tool response", () => {
  const dir = mkdtempSync(join(tmpdir(), "pmem-mcp-"));
  dirs.push(dir);
  process.env.PROJECT_MEMORY_DIR = dir;
  assert.equal(withRoot("(no hits)"), `[ledger: ${dir}]\n(no hits)`);
});
