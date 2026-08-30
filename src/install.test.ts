import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { doctorAgents, installAgents, installKiroWorkspaceMcp, uninstallAgents } from "./install.js";

const dirs: string[] = [];
let savedHome: string | undefined;
let savedProfile: string | undefined;

afterEach(() => {
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  if (savedProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = savedProfile;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tmpWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "pmem-kiro-"));
  dirs.push(dir);
  return dir;
}

function isolateHome(): string {
  savedHome = process.env.HOME;
  savedProfile = process.env.USERPROFILE;
  const home = mkdtempSync(join(tmpdir(), "pmem-install-home-"));
  dirs.push(home);
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  return home;
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

test("codex install uses codex hook flavor and avoids compact hooks", () => {
  const home = isolateHome();
  mkdirSync(join(home, ".codex"), { recursive: true });
  writeFileSync(join(home, ".codex", "config.toml"), "", "utf8");
  installAgents({ agents: ["codex"] });
  const hooks = JSON.parse(readFileSync(join(home, ".codex", "hooks.json"), "utf8")) as {
    hooks: Record<string, unknown>;
  };
  assert.match(JSON.stringify(hooks.hooks.SessionStart), /--flavor codex/);
  assert.match(JSON.stringify(hooks.hooks.Stop), /--flavor codex/);
  assert.equal(hooks.hooks.PreCompact, undefined);
  assert.equal(hooks.hooks.PostCompact, undefined);
  assert.ok(existsSync(join(home, ".codex", "skills", "project-memory", "SKILL.md")));
  assert.ok(existsSync(join(home, ".agents", "skills", "project-memory", "SKILL.md")));
  assert.ok(!existsSync(join(home, ".config", "opencode", "skills", "project-memory", "SKILL.md")));
  assert.ok(!existsSync(join(home, ".config", "opencode", "commands", "memory-dream.md")));
});

test("codex uninstall removes both codex and agents skill copies", () => {
  const home = isolateHome();
  mkdirSync(join(home, ".codex", "skills", "project-memory"), { recursive: true });
  mkdirSync(join(home, ".agents", "skills", "project-memory"), { recursive: true });
  writeFileSync(join(home, ".codex", "skills", "project-memory", "SKILL.md"), "codex", "utf8");
  writeFileSync(join(home, ".agents", "skills", "project-memory", "SKILL.md"), "agents", "utf8");
  uninstallAgents({ agents: ["codex"] });
  assert.ok(!existsSync(join(home, ".codex", "skills", "project-memory", "SKILL.md")));
  assert.ok(!existsSync(join(home, ".agents", "skills", "project-memory", "SKILL.md")));
});

test("uninstall removes current cli hook groups but preserves external project-memory text", () => {
  const home = isolateHome();
  const cli = fileURLToPath(new URL("./cli.js", import.meta.url));
  mkdirSync(join(home, ".claude"), { recursive: true });
  writeFileSync(
    join(home, ".claude", "settings.json"),
    `${JSON.stringify(
      {
        hooks: {
          Stop: [
            { hooks: [{ command: "node ./scripts/project-memory-report.js", statusMessage: "project-memory" }] },
            { hooks: [{ command: `node "${cli}" hook`, statusMessage: "project-memory" }] },
          ],
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  writeFileSync(
    join(home, ".claude.json"),
    `${JSON.stringify({ mcpServers: { "project-memory": { command: "node" }, other: { command: "npx" } } }, null, 2)}\n`,
    "utf8",
  );
  uninstallAgents({ agents: ["claude"] });
  const settings = JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8")) as {
    hooks: { Stop: unknown[] };
  };
  assert.equal(settings.hooks.Stop.length, 1);
  assert.match(JSON.stringify(settings.hooks.Stop[0]), /project-memory-report/);
  const claude = JSON.parse(readFileSync(join(home, ".claude.json"), "utf8")) as { mcpServers: Record<string, unknown> };
  assert.deepEqual(Object.keys(claude.mcpServers), ["other"]);
});

test("doctor selftest runs the built hook against the requested root", () => {
  isolateHome();
  const workspace = tmpWorkspace();
  execFileSync("git", ["init"], { cwd: workspace, stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
  const report = doctorAgents({ cwd: workspace, selftest: true });
  assert.match(report, /ok  selftest hook root/);
  assert.match(report, /\.memory/);
});

test("doctor reports stale configured project-memory paths", () => {
  const home = isolateHome();
  mkdirSync(join(home, ".codex"), { recursive: true });
  writeFileSync(
    join(home, ".codex", "hooks.json"),
    `${JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: 'node "C:\\missing\\project-memory\\dist\\cli.js" hook' }] }] } }, null, 2)}\n`,
    "utf8",
  );
  const report = doctorAgents();
  assert.match(report, /missing  configured path/);
  assert.match(report, /project-memory\\dist\\cli\.js/);
});
