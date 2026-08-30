import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { installKiroWorkspaceMcp } from "./install.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tmpWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "pmem-kiro-"));
  dirs.push(dir);
  return dir;
}

function workspaceMcpPath(workspace: string): string {
  return join(workspace, ".kiro", "settings", "mcp.json");
}

function readConfig(workspace: string): { mcpServers: Record<string, { command?: string; args?: string[]; env?: { PROJECT_MEMORY_ROOT?: string } }> } {
  return JSON.parse(readFileSync(workspaceMcpPath(workspace), "utf8"));
}

function writeConfig(workspace: string, value: unknown): void {
  mkdirSync(join(workspace, ".kiro", "settings"), { recursive: true });
  writeFileSync(workspaceMcpPath(workspace), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("writes a workspace-level mcp entry pinning PROJECT_MEMORY_ROOT", () => {
  const workspace = tmpWorkspace();
  const report = installKiroWorkspaceMcp(workspace);
  assert.ok(report.includes("PROJECT_MEMORY_ROOT"), report);
  const config = readConfig(workspace);
  const entry = config.mcpServers["project-memory"];
  assert.equal(entry.command, "node");
  assert.ok(entry.args?.[0]?.replaceAll("\\", "/").endsWith("dist/mcp.js"));
  // Absolute, so the server resolves this workspace from any cwd.
  assert.equal(entry.env?.PROJECT_MEMORY_ROOT, workspace);
});

test("reinstall is idempotent: identical entry leaves the file untouched", () => {
  const workspace = tmpWorkspace();
  installKiroWorkspaceMcp(workspace);
  const before = readFileSync(workspaceMcpPath(workspace), "utf8");
  installKiroWorkspaceMcp(workspace);
  assert.equal(readFileSync(workspaceMcpPath(workspace), "utf8"), before);
});

test("merges with other servers the workspace already defines", () => {
  const workspace = tmpWorkspace();
  writeConfig(workspace, { mcpServers: { other: { command: "npx", args: ["-y", "other-server"] } } });
  installKiroWorkspaceMcp(workspace);
  const config = readConfig(workspace);
  assert.ok(config.mcpServers["other"], "pre-existing server must survive the merge");
  assert.ok(config.mcpServers["project-memory"]);
});

test("refuses to overwrite a differing project-memory entry", () => {
  const workspace = tmpWorkspace();
  writeConfig(workspace, {
    mcpServers: { "project-memory": { command: "node", args: ["C:\\elsewhere\\mcp.js"] } },
  });
  const before = readFileSync(workspaceMcpPath(workspace), "utf8");
  const report = installKiroWorkspaceMcp(workspace);
  assert.match(report, /not overwritten/);
  assert.equal(readFileSync(workspaceMcpPath(workspace), "utf8"), before);
});

test("a relative workspace path is resolved to an absolute root", () => {
  const workspace = tmpWorkspace();
  const previous = process.cwd();
  process.chdir(workspace);
  try {
    installKiroWorkspaceMcp(".");
  } finally {
    process.chdir(previous);
  }
  assert.equal(readConfig(workspace).mcpServers["project-memory"].env?.PROJECT_MEMORY_ROOT, workspace);
});

test("a non-directory workspace is skipped, nothing written", () => {
  const workspace = tmpWorkspace();
  const report = installKiroWorkspaceMcp(join(workspace, "does-not-exist"));
  assert.match(report, /skipped/);
  assert.ok(!existsSync(workspaceMcpPath(workspace)));
});
