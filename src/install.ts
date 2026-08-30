import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { ensureGitignored, isGitRepo } from "./core/gitignore.js";
import {
  asObject,
  mergeJsonText,
  parseJsonObject,
  PROJECT_MEMORY_ID,
  removeMcpServer,
  removeProjectMemoryHookGroups,
  removeTomlTable,
  upsertHookGroup,
} from "./core/host-config.js";
import { patchKiroAgentFrontmatter, removeKiroAgentHooks, shouldPatchKiroAgent } from "./core/kiro-agent.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "dist", "cli.js");
const MCP = join(ROOT, "dist", "mcp.js");
const MARKER = PROJECT_MEMORY_ID;
export const DEFAULT_AGENTS = [
  "opencode",
  "zcode",
  "codex",
  "claude",
  "kiro",
  "commandcode",
  "gemini",
  "grok",
];

export function doctorAgents(opts: { cwd?: string; selftest?: boolean } = {}): string {
  const lines: string[] = [];
  const ok = (name: string, pass: boolean, detail: string) =>
    lines.push(`${pass ? "ok" : "missing"}  ${name}${detail ? ` — ${detail}` : ""}`);
  ok("cli", existsSync(CLI), CLI);
  ok("mcp", existsSync(MCP), MCP);
  const ocPlugin = join(homedir(), ".config", "opencode", "plugins", "project-memory.js");
  ok("opencode plugin", existsSync(ocPlugin), ocPlugin);
  const ocConfig = join(homedir(), ".config", "opencode", "opencode.json");
  ok("opencode mcp", jsonHas(ocConfig, "project-memory"), ocConfig);
  const zcConfig = join(homedir(), ".zcode", "cli", "config.json");
  ok("zcode hooks", jsonHas(zcConfig, "hooks") && jsonHas(zcConfig, MARKER), zcConfig);
  ok("zcode mcp", jsonHas(zcConfig, "project-memory"), zcConfig);
  const cxHooks = join(homedir(), ".codex", "hooks.json");
  ok("codex hooks", jsonHas(cxHooks, MARKER) || jsonHas(cxHooks, CLI.replaceAll("\\", "\\\\")), cxHooks);
  const cxToml = join(homedir(), ".codex", "config.toml");
  ok("codex mcp", existsSync(cxToml) && readFileSync(cxToml, "utf8").includes("project-memory"), cxToml);
  ok("skill opencode", existsSync(join(homedir(), ".config", "opencode", "skills", "project-memory", "SKILL.md")), "");
  ok("skill zcode", existsSync(join(homedir(), ".zcode", "skills", "project-memory", "SKILL.md")), "");
  const codexSkillPaths = [
    join(homedir(), ".codex", "skills", "project-memory", "SKILL.md"),
    join(homedir(), ".agents", "skills", "project-memory", "SKILL.md"),
  ];
  const codexSkillInstalled = codexSkillPaths.some((path) => existsSync(path));
  ok("skill codex", codexSkillInstalled, codexSkillInstalled ? codexSkillPaths.filter((path) => existsSync(path)).join(", ") : "");
  ok("claude hooks", jsonHas(join(homedir(), ".claude", "settings.json"), MARKER), "");
  ok("claude mcp", jsonHas(join(homedir(), ".claude.json"), "project-memory"), "");
  ok("kiro mcp", jsonHas(join(homedir(), ".kiro", "settings", "mcp.json"), "project-memory"), "");
  const kiroUserHooks = join(homedir(), ".kiro", "hooks", "project-memory.json");
  ok("kiro user hooks", jsonHas(kiroUserHooks, "SessionStart") && jsonHas(kiroUserHooks, MARKER), kiroUserHooks);
  const kiroEngineer = join(homedir(), ".kiro", "agents", "engineer.md");
  ok(
    "kiro agent hooks",
    existsSync(kiroEngineer) && readFileSync(kiroEngineer, "utf8").includes("agentSpawn"),
    kiroEngineer,
  );
  ok("commandcode mcp", jsonHas(join(homedir(), ".commandcode", "mcp.json"), "project-memory"), "");
  ok("gemini mcp", jsonHas(join(homedir(), ".gemini", "config", "mcp_config.json"), "project-memory"), "");
  ok("grok hooks", existsSync(join(homedir(), ".grok", "hooks", "project-memory.json")), "");
  for (const missing of configuredMissingPaths()) {
    ok("configured path", false, missing);
  }
  if (opts.selftest) {
    const result = runHookSelftest(opts.cwd ?? process.cwd());
    ok("selftest hook root", result.pass, result.detail);
  }
  return lines.join("\n");
}

function jsonHas(path: string, needle: string): boolean {
  if (!existsSync(path)) return false;
  return readFileSync(path, "utf8").includes(needle);
}

function configuredMissingPaths(): string[] {
  const jsonFiles = [
    join(homedir(), ".config", "opencode", "opencode.json"),
    join(homedir(), ".zcode", "cli", "config.json"),
    join(homedir(), ".codex", "hooks.json"),
    join(homedir(), ".claude", "settings.json"),
    join(homedir(), ".claude.json"),
    join(homedir(), ".kiro", "settings", "mcp.json"),
    join(homedir(), ".kiro", "hooks", "project-memory.json"),
    join(homedir(), ".commandcode", "mcp.json"),
    join(homedir(), ".commandcode", "settings.json"),
    join(homedir(), ".gemini", "config", "mcp_config.json"),
    join(homedir(), ".gemini", "settings.json"),
    join(homedir(), ".gemini", "config", "hooks.json"),
    join(homedir(), ".grok", "hooks", "project-memory.json"),
  ];
  const tomlFiles = [
    join(homedir(), ".codex", "config.toml"),
    join(homedir(), ".grok", "config.toml"),
  ];
  const paths = new Set<string>();
  for (const file of jsonFiles) {
    if (!existsSync(file)) continue;
    try {
      collectConfiguredPaths(JSON.parse(readFileSync(file, "utf8")), paths);
    } catch {
      /* invalid user config is reported by the host; doctor keeps scanning */
    }
  }
  for (const file of tomlFiles) {
    if (!existsSync(file)) continue;
    collectPathsFromText(readFileSync(file, "utf8"), paths);
  }
  return [...paths].filter((path) => !existsSync(path));
}

function collectConfiguredPaths(value: unknown, paths: Set<string>): void {
  if (typeof value === "string") {
    collectPathsFromText(value, paths);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectConfiguredPaths(item, paths);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectConfiguredPaths(item, paths);
  }
}

function collectPathsFromText(text: string, paths: Set<string>): void {
  if (!text.includes("project-memory") || !/dist[\\/](?:cli|mcp)\.js/i.test(text)) return;
  for (const match of text.matchAll(/["']([^"']*project-memory[^"']*dist[\\/](?:cli|mcp)\.js)["']/gi)) {
    paths.add(match[1]);
  }
  for (const match of text.matchAll(/(\S*project-memory\S*dist[\\/](?:cli|mcp)\.js)/gi)) {
    paths.add(match[1].replace(/^[\["'({]+/g, "").replace(/[\]"'),]+$/g, ""));
  }
}

function runHookSelftest(cwd: string): { pass: boolean; detail: string } {
  const root = resolve(cwd);
  const expected = join(root, ".memory");
  const env: NodeJS.ProcessEnv = { ...process.env, PROJECT_MEMORY_ROOT: root };
  delete env.PROJECT_MEMORY_DIR;
  try {
    const out = execFileSync(process.execPath, [CLI, "hook", "--event", "SessionStart", "--plain"], {
      cwd: root,
      env,
      input: "",
      encoding: "utf8",
      timeout: 5_000,
      windowsHide: true,
    });
    const pass = out.includes("Project memory") && out.includes(expected);
    return { pass, detail: pass ? expected : `unexpected hook output for ${expected}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { pass: false, detail: message };
  }
}

export function installAgents(opts: { cwd?: string; agents: string[] }): string {
  const reports: string[] = [];
  const agents = opts.agents.map(normalizeAgent);
  for (const agent of opts.agents) {
    const name = normalizeAgent(agent);
    if (name === "opencode") reports.push(installOpenCode());
    else if (name === "zcode") reports.push(installZcode());
    else if (name === "codex") reports.push(installCodex());
    else if (name === "claude") reports.push(installClaude());
    else if (name === "kiro") reports.push(installKiro(opts.cwd));
    else if (name === "commandcode") reports.push(installCommandCode());
    else if (name === "gemini") reports.push(installGemini());
    else if (name === "grok") reports.push(installGrok());
    else reports.push(`skip unknown agent: ${agent}`);
  }
  reports.push(installSkill(agents));
  if (opts.cwd && isGitRepo(opts.cwd)) {
    reports.push(`gitignore: .memory/ ${ensureGitignored(opts.cwd)}`);
  }
  return reports.join("\n");
}

export function uninstallAgents(opts: { cwd?: string; agents: string[] }): string {
  const reports: string[] = [];
  for (const agent of opts.agents) {
    const name = normalizeAgent(agent);
    if (name === "opencode") reports.push(uninstallOpenCode());
    else if (name === "zcode") reports.push(uninstallZcode());
    else if (name === "codex") reports.push(uninstallCodex());
    else if (name === "claude") reports.push(uninstallClaude());
    else if (name === "kiro") reports.push(uninstallKiro(opts.cwd));
    else if (name === "commandcode") reports.push(uninstallCommandCode());
    else if (name === "gemini") reports.push(uninstallGemini());
    else if (name === "grok") reports.push(uninstallGrok());
    else reports.push(`skip unknown agent: ${agent}`);
  }
  return reports.join("\n");
}

function normalizeAgent(agent: string): string {
  if (agent === "antigravity" || agent === "gemini-cli") return "gemini";
  if (agent === "command-code") return "commandcode";
  return agent;
}

function installOpenCode(): string {
  const source = openCodePluginSource();
  const pluginDir = join(homedir(), ".config", "opencode", "plugins");
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(join(pluginDir, "project-memory.js"), source, "utf8");
  const configPath = join(homedir(), ".config", "opencode", "opencode.json");
  const pluginHref = pathToFileUrl(join(pluginDir, "project-memory.js"));
  mergeJson(configPath, (config) => {
    const mcp = asObject(config.mcp);
    mcp["project-memory"] = {
      type: "local",
      enabled: true,
      command: ["node", MCP],
    };
    config.mcp = mcp;
    if (Array.isArray(config.plugin)) {
      const plugins = config.plugin.filter((item) => item !== pluginHref);
      if (plugins.length) config.plugin = plugins;
      else delete config.plugin;
    }
  });
  return `opencode: plugin ${pluginHref} (auto-discovered) + mcp`;
}

function installZcode(): string {
  const configPath = join(homedir(), ".zcode", "cli", "config.json");
  if (!existsSync(configPath)) return "zcode: config.json missing, skipped";
  mergeJson(configPath, (config) => {
    const hooks = asObject(config.hooks);
    hooks.enabled = true;
    const events = asObject(hooks.events);
    events.SessionStart = upsertHookGroup(events.SessionStart, {
      matcher: "startup|clear|compact",
      hooks: [
        {
          type: "process",
          command: "node",
          args: [CLI, "hook"],
          enabled: true,
          timeoutMs: 5000,
          statusMessage: MARKER,
        },
      ],
    }, CLI);
    events.Stop = upsertHookGroup(events.Stop, {
      hooks: [
        {
          type: "process",
          command: "node",
          args: [CLI, "hook"],
          enabled: true,
          timeoutMs: 4000,
          statusMessage: MARKER,
        },
      ],
    }, CLI);
    const compactHook = {
      type: "process",
      command: "node",
      args: [CLI, "hook"],
      enabled: true,
      timeoutMs: 5000,
      statusMessage: MARKER,
    };
    events.PreCompact = upsertHookGroup(events.PreCompact, { hooks: [compactHook] }, CLI);
    events.PostCompact = upsertHookGroup(events.PostCompact, { hooks: [compactHook] }, CLI);
    hooks.events = events;
    config.hooks = hooks;
    const mcp = asObject(config.mcp);
    const servers = asObject(mcp.servers);
    servers["project-memory"] = {
      type: "stdio",
      command: "node",
      args: [MCP],
      enabled: true,
    };
    mcp.servers = servers;
    config.mcp = mcp;
  });
  return `zcode: user hooks SessionStart/Stop/PreCompact + mcp`;
}

function installCodex(): string {
  const hooksPath = join(homedir(), ".codex", "hooks.json");
  mergeJson(hooksPath, (config) => {
    const hooks = asObject(config.hooks);
    hooks.SessionStart = upsertHookGroup(hooks.SessionStart, {
      matcher: "startup|resume|clear|compact",
      hooks: [
        {
          type: "command",
          command: `node "${CLI}" hook --flavor codex`,
          commandWindows: `node "${CLI}" hook --flavor codex`,
          statusMessage: "Loading project memory",
          timeout: 5,
          additionalContextLimit: 2500,
        },
      ],
    }, CLI);
    hooks.Stop = upsertHookGroup(hooks.Stop, {
      hooks: [
        {
          type: "command",
          command: `node "${CLI}" hook --flavor codex`,
          commandWindows: `node "${CLI}" hook --flavor codex`,
          statusMessage: "Project memory write reminder",
          timeout: 5,
        },
      ],
    }, CLI);
    config.hooks = hooks;
  });
  const tomlPath = join(homedir(), ".codex", "config.toml");
  if (existsSync(tomlPath)) {
    const raw = readFileSync(tomlPath, "utf8");
    if (!raw.includes("[mcp_servers.project-memory]")) {
      const block = `\n[mcp_servers.project-memory]\ncommand = "node"\nargs = [${JSON.stringify(MCP)}]\n`;
      writeFileSync(tomlPath, raw.endsWith("\n") ? raw + block : `${raw}\n${block}`, "utf8");
    }
  }
  return `codex: hooks.json SessionStart/Stop + mcp`;
}

function installSkill(agents: string[]): string {
  const skillSrc = join(ROOT, "skills", "project-memory", "SKILL.md");
  if (!existsSync(skillSrc)) return "skill: SKILL.md missing";
  const skillAgents = skillAgentsForInstall(agents);
  const targets = [...skillAgents].map((agent) => skillPath(agent)).filter((path): path is string => !!path);
  if (!targets.length) return "skill: no compatible skill target";
  for (const target of targets) {
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(skillSrc, target);
  }
  if (skillAgents.has("opencode")) installOpenCodeDreamCommand();
  return `skill: copied to ${[...skillAgents].join(", ")}`;
}

function skillAgentsForInstall(agents: string[]): Set<string> {
  const skillAgents = new Set<string>();
  for (const agent of agents) {
    if (agent === "codex") {
      skillAgents.add("codex");
      skillAgents.add("agents");
    } else if (skillPath(agent)) {
      skillAgents.add(agent);
    }
  }
  return skillAgents;
}

function installOpenCodeDreamCommand(): void {
  const src = join(ROOT, "adapters", "opencode", "commands", "memory-dream.md");
  if (!existsSync(src)) return;
  const dirs = [join(homedir(), ".config", "opencode", "commands")];
  if (process.platform === "win32" && process.env.APPDATA) {
    dirs.push(join(process.env.APPDATA, "opencode", "commands"));
  }
  for (const dir of dirs) {
    mkdirSync(dir, { recursive: true });
    copyFileSync(src, join(dir, "memory-dream.md"));
  }
}

function hookCommand(): Record<string, unknown> {
  return {
    type: "command",
    command: `node "${CLI}" hook`,
    timeout: 5,
    statusMessage: MARKER,
  };
}

function claudeStyleHooks(startMatcher: string): Record<string, unknown> {
  return {
    SessionStart: [
      {
        matcher: startMatcher,
        hooks: [hookCommand()],
      },
    ],
    PreCompact: [{ hooks: [hookCommand()] }],
    PostCompact: [{ hooks: [hookCommand()] }],
    Stop: [
      {
        hooks: [hookCommand()],
      },
    ],
  };
}

function mergeMcpStdio(config: Record<string, unknown>, key = "mcpServers"): void {
  const servers = asObject(config[key]);
  servers["project-memory"] = { command: "node", args: [MCP] };
  config[key] = servers;
}

function installClaude(): string {
  const settings = join(homedir(), ".claude", "settings.json");
  if (!existsSync(dirname(settings))) return "claude: ~/.claude missing, skipped";
  mergeJson(settings, (config) => {
    const hooks = asObject(config.hooks);
    Object.assign(hooks, {
      SessionStart: upsertHookGroup(hooks.SessionStart, {
        matcher: "startup|resume|clear|compact",
        hooks: [hookCommand()],
      }, CLI),
      Stop: upsertHookGroup(hooks.Stop, { hooks: [hookCommand()] }, CLI),
      PreCompact: upsertHookGroup(hooks.PreCompact, { hooks: [hookCommand()] }, CLI),
      PostCompact: upsertHookGroup(hooks.PostCompact, { hooks: [hookCommand()] }, CLI),
    });
    config.hooks = hooks;
  });
  const claudeJson = join(homedir(), ".claude.json");
  if (existsSync(claudeJson)) {
    mergeJson(claudeJson, (config) => mergeMcpStdio(config));
  }
  return "claude: settings.json SessionStart/Stop + ~/.claude.json mcp";
}

function installKiro(workspace?: string): string {
  const reports: string[] = [];
  const mcpPath = join(homedir(), ".kiro", "settings", "mcp.json");
  if (!existsSync(dirname(mcpPath))) reports.push("kiro: ~/.kiro missing, skipped (user-level mcp)");
  else {
    mergeJson(mcpPath, (config) => mergeMcpStdio(config));
    reports.push("kiro: user-level mcp.json (no root pin — workspace entry carries it)");
  }
  if (workspace) reports.push(installKiroWorkspaceMcp(workspace));
  const hookDir = join(homedir(), ".kiro", "hooks");
  mkdirSync(hookDir, { recursive: true });
  writeFileSync(
    join(hookDir, "project-memory.json"),
    `${JSON.stringify(
      {
        version: "v1",
        hooks: [
          { name: MARKER, trigger: "SessionStart", action: { type: "command", command: `node "${CLI}" hook --event SessionStart --plain` } },
          { name: `${MARKER}-prompt`, trigger: "UserPromptSubmit", action: { type: "command", command: `node "${CLI}" hook --event UserPromptSubmit --plain` } },
          { name: `${MARKER}-stop`, trigger: "Stop", action: { type: "command", command: `node "${CLI}" hook --event Stop --plain` } },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  const patched = patchKiroAgentFiles();
  reports.push(`kiro: user hooks + agent files (${patched.join(", ") || "none"})`);
  return reports.join("\n");
}

/**
 * Workspace-level MCP entry for Kiro: `<workspace>/.kiro/settings/mcp.json`
 * outranks the user-level entry and pins env.PROJECT_MEMORY_ROOT, so the
 * server stops guessing the project from a cwd it was never given. Merges
 * with whatever the workspace already has; refuses to overwrite a
 * project-memory entry it did not write.
 */
export function installKiroWorkspaceMcp(workspace: string): string {
  const root = resolve(workspace);
  if (!isDirectory(root)) return `kiro workspace: not a directory, skipped (${root})`;
  const entry = { command: "node", args: [MCP], env: { PROJECT_MEMORY_ROOT: root } };
  const mcpPath = join(root, ".kiro", "settings", "mcp.json");
  const existing = readJsonIfExists(mcpPath);
  if (existing) {
    const mine = asObject(asObject(existing.mcpServers)["project-memory"]);
    if (Object.keys(mine).length && JSON.stringify(mine) !== JSON.stringify(entry)) {
      return `kiro workspace: ${mcpPath} already defines project-memory differently — not overwritten`;
    }
  }
  mkdirSync(dirname(mcpPath), { recursive: true });
  mergeJson(mcpPath, (config) => {
    const servers = asObject(config.mcpServers);
    servers["project-memory"] = entry;
    config.mcpServers = servers;
  });
  return `kiro workspace: ${mcpPath} (env PROJECT_MEMORY_ROOT=${root})`;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function readJsonIfExists(path: string): Record<string, unknown> | undefined {
  if (!existsSync(path)) return undefined;
  const raw = readFileSync(path, "utf8").trim();
  if (!raw) return {};
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`cannot read non-object json: ${path}`);
  }
  return parsed as Record<string, unknown>;
}

function patchKiroAgentFiles(): string[] {
  const dir = join(homedir(), ".kiro", "agents");
  if (!existsSync(dir)) return [];
  const patched: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (!ent.isFile()) continue;
    const name = ent.name;
    const file = join(dir, name);
    const raw = readFileSync(file, "utf8");
    if (!shouldPatchKiroAgent(name, raw)) continue;
    const next = patchKiroAgentFrontmatter(raw, CLI);
    if (!next || next === raw) continue;
    writeFileSync(file, next, "utf8");
    patched.push(name);
  }
  return patched;
}

function installCommandCode(): string {
  const home = join(homedir(), ".commandcode");
  if (!existsSync(home)) return "commandcode: ~/.commandcode missing, skipped";
  mergeJson(join(home, "mcp.json"), (config) => mergeMcpStdio(config));
  mergeJson(join(home, "settings.json"), (config) => {
    const hooks = asObject(config.hooks);
    hooks.SessionStart = upsertHookGroup(hooks.SessionStart, {
      matcher: "startup|resume|clear|compact",
      hooks: [hookCommand()],
    }, CLI);
    hooks.Stop = upsertHookGroup(hooks.Stop, { hooks: [hookCommand()] }, CLI);
    hooks.PreCompact = upsertHookGroup(hooks.PreCompact, { hooks: [hookCommand()] }, CLI);
    hooks.PostCompact = upsertHookGroup(hooks.PostCompact, { hooks: [hookCommand()] }, CLI);
    config.hooks = hooks;
  });
  return "commandcode: mcp.json + settings.json SessionStart/Stop/PreCompact";
}

function installGemini(): string {
  const gemini = join(homedir(), ".gemini");
  if (!existsSync(gemini)) return "gemini: ~/.gemini missing, skipped";
  mergeJson(join(gemini, "config", "mcp_config.json"), (config) => mergeMcpStdio(config));
  mergeJson(join(gemini, "settings.json"), (config) => {
    const hooks = asObject(config.hooks);
    Object.assign(hooks, claudeStyleHooks("startup|resume|clear|compact"));
    hooks.PreCompress = upsertHookGroup(hooks.PreCompress, { hooks: [hookCommand()] }, CLI);
    config.hooks = hooks;
  });
  writeFileSync(
    join(gemini, "config", "hooks.json"),
    `${JSON.stringify(
      {
        "project-memory": {
          PreInvocation: [{ type: "command", command: `node "${CLI}" hook`, timeout: 5 }],
          Stop: [{ type: "command", command: `node "${CLI}" hook`, timeout: 5 }],
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return "gemini/antigravity: mcp_config.json + PreInvocation/Stop hooks";
}

function grokHookCommand(event: string): Record<string, unknown> {
  return {
    type: "command",
    command: `node "${CLI}" hook --flavor grok --event ${event}`,
    timeout: 5,
    statusMessage: MARKER,
  };
}

function grokStyleHooks(): Record<string, unknown> {
  // Grok's Stop additionalContext keeps the agent working (up to 8
  // continuations). Memory writes are skill-driven plus SessionStart /
  // PreCompact context, matching OpenCode's observe-only idle path.
  return {
    SessionStart: [
      {
        matcher: "startup|resume|clear|compact",
        hooks: [grokHookCommand("SessionStart")],
      },
    ],
    PreCompact: [{ hooks: [grokHookCommand("PreCompact")] }],
    PostCompact: [{ hooks: [grokHookCommand("PostCompact")] }],
  };
}

function installGrok(): string {
  const grok = join(homedir(), ".grok");
  if (!existsSync(grok)) return "grok: ~/.grok missing, skipped";
  const hookDir = join(grok, "hooks");
  mkdirSync(hookDir, { recursive: true });
  writeFileSync(
    join(hookDir, "project-memory.json"),
    `${JSON.stringify({ hooks: grokStyleHooks() }, null, 2)}\n`,
    "utf8",
  );
  const tomlPath = join(grok, "config.toml");
  if (existsSync(tomlPath)) {
    const raw = readFileSync(tomlPath, "utf8");
    if (!raw.includes("[mcp_servers.project-memory]")) {
      const block = `\n[mcp_servers.project-memory]\ncommand = "node"\nargs = [${JSON.stringify(MCP)}]\nenabled = true\n`;
      writeFileSync(tomlPath, raw.endsWith("\n") ? raw + block : `${raw}\n${block}`, "utf8");
    }
  }
  return "grok: hooks/project-memory.json (SessionStart/PreCompact/PostCompact, no Stop) + config.toml mcp";
}

function uninstallOpenCode(): string {
  const pluginFile = join(homedir(), ".config", "opencode", "plugins", "project-memory.js");
  const commandFiles = [
    join(homedir(), ".config", "opencode", "commands", "memory-dream.md"),
  ];
  if (process.platform === "win32" && process.env.APPDATA) {
    commandFiles.push(join(process.env.APPDATA, "opencode", "commands", "memory-dream.md"));
  }
  const removedFiles = [removeFile(pluginFile), ...commandFiles.map(removeFile), removeSkill("opencode")].filter(Boolean).length;
  const configPath = join(homedir(), ".config", "opencode", "opencode.json");
  const configChanged = updateJson(configPath, (config) => {
    let changed = false;
    const mcp = asObject(config.mcp);
    if (Object.hasOwn(mcp, MARKER)) {
      delete mcp[MARKER];
      config.mcp = mcp;
      changed = true;
    }
    const pluginHref = pathToFileUrl(pluginFile);
    if (Array.isArray(config.plugin)) {
      const plugins = config.plugin.filter((item) => item !== pluginHref);
      if (plugins.length !== config.plugin.length) {
        if (plugins.length) config.plugin = plugins;
        else delete config.plugin;
        changed = true;
      }
    }
    return changed;
  });
  return `opencode: ${removedFiles || configChanged ? "removed project-memory files/config" : "not installed"}`;
}

function uninstallZcode(): string {
  const configPath = join(homedir(), ".zcode", "cli", "config.json");
  const configChanged = updateJson(configPath, (config) => {
    let changed = false;
    const hooks = asObject(config.hooks);
    const events = asObject(hooks.events);
    changed = removeHookEvents(events, ["SessionStart", "Stop", "PreCompact", "PostCompact"]) || changed;
    if (changed) {
      hooks.events = events;
      config.hooks = hooks;
    }
    const mcp = asObject(config.mcp);
    const servers = asObject(mcp.servers);
    if (Object.hasOwn(servers, MARKER)) {
      delete servers[MARKER];
      mcp.servers = servers;
      config.mcp = mcp;
      changed = true;
    }
    return changed;
  });
  const skillRemoved = removeSkill("zcode");
  return `zcode: ${configChanged || skillRemoved ? "removed hooks/mcp/skill" : "not installed"}`;
}

function uninstallCodex(): string {
  const hooksChanged = updateJson(join(homedir(), ".codex", "hooks.json"), (config) => {
    const hooks = asObject(config.hooks);
    const changed = removeHookEvents(hooks, ["SessionStart", "Stop", "PreCompact", "PostCompact"]);
    if (changed) config.hooks = hooks;
    return changed;
  });
  const tomlChanged = removeTomlBlock(join(homedir(), ".codex", "config.toml"), "mcp_servers.project-memory");
  const codexSkillRemoved = removeSkill("codex");
  const agentsSkillRemoved = removeSkill("agents");
  const skillRemoved = codexSkillRemoved || agentsSkillRemoved;
  return `codex: ${hooksChanged || tomlChanged || skillRemoved ? "removed hooks/mcp/skill" : "not installed"}`;
}

function uninstallClaude(): string {
  const hooksChanged = updateJson(join(homedir(), ".claude", "settings.json"), (config) => {
    const hooks = asObject(config.hooks);
    const changed = removeHookEvents(hooks, ["SessionStart", "Stop", "PreCompact", "PostCompact"]);
    if (changed) config.hooks = hooks;
    return changed;
  });
  const mcpChanged = updateJson(join(homedir(), ".claude.json"), (config) => removeMcpServer(config));
  const skillRemoved = removeSkill("claude");
  return `claude: ${hooksChanged || mcpChanged || skillRemoved ? "removed hooks/mcp/skill" : "not installed"}`;
}

function uninstallKiro(workspace?: string): string {
  const reports: string[] = [];
  const userMcp = updateJson(join(homedir(), ".kiro", "settings", "mcp.json"), (config) => removeMcpServer(config));
  reports.push(`kiro user mcp: ${userMcp ? "removed" : "not installed"}`);
  if (workspace) {
    const workspaceMcp = updateJson(join(resolve(workspace), ".kiro", "settings", "mcp.json"), (config) => removeMcpServer(config));
    reports.push(`kiro workspace mcp: ${workspaceMcp ? "removed" : "not installed"}`);
  }
  const hooksRemoved = removeFile(join(homedir(), ".kiro", "hooks", "project-memory.json"));
  const patched = unpatchKiroAgentFiles();
  const skillRemoved = removeSkill("kiro");
  reports.push(`kiro hooks/agents/skill: ${hooksRemoved || patched.length || skillRemoved ? `removed (${patched.join(", ") || "no agent files"})` : "not installed"}`);
  return reports.join("\n");
}

function uninstallCommandCode(): string {
  const home = join(homedir(), ".commandcode");
  const mcpChanged = updateJson(join(home, "mcp.json"), (config) => removeMcpServer(config));
  const hooksChanged = updateJson(join(home, "settings.json"), (config) => {
    const hooks = asObject(config.hooks);
    const changed = removeHookEvents(hooks, ["SessionStart", "Stop", "PreCompact", "PostCompact"]);
    if (changed) config.hooks = hooks;
    return changed;
  });
  const skillRemoved = removeSkill("commandcode");
  return `commandcode: ${mcpChanged || hooksChanged || skillRemoved ? "removed hooks/mcp/skill" : "not installed"}`;
}

function uninstallGemini(): string {
  const gemini = join(homedir(), ".gemini");
  const mcpChanged = updateJson(join(gemini, "config", "mcp_config.json"), (config) => removeMcpServer(config));
  const settingsChanged = updateJson(join(gemini, "settings.json"), (config) => {
    const hooks = asObject(config.hooks);
    const changed = removeHookEvents(hooks, ["SessionStart", "Stop", "PreCompact", "PostCompact", "PreCompress"]);
    if (changed) config.hooks = hooks;
    return changed;
  });
  const hookFileChanged = updateJson(join(gemini, "config", "hooks.json"), (config) => {
    if (!Object.hasOwn(config, MARKER)) return false;
    delete config[MARKER];
    return true;
  });
  const skillRemoved = removeSkill("gemini");
  return `gemini/antigravity: ${mcpChanged || settingsChanged || hookFileChanged || skillRemoved ? "removed hooks/mcp/skill" : "not installed"}`;
}

function uninstallGrok(): string {
  const hooksRemoved = removeFile(join(homedir(), ".grok", "hooks", "project-memory.json"));
  const tomlChanged = removeTomlBlock(join(homedir(), ".grok", "config.toml"), "mcp_servers.project-memory");
  return `grok: ${hooksRemoved || tomlChanged ? "removed hooks/mcp" : "not installed"}`;
}

function removeHookEvents(container: Record<string, unknown>, events: string[]): boolean {
  let changed = false;
  for (const event of events) {
    const before = container[event];
    const after = removeProjectMemoryHookGroups(before, CLI);
    if (Array.isArray(before) && after.length !== before.length) {
      if (after.length) container[event] = after;
      else delete container[event];
      changed = true;
    }
  }
  return changed;
}

function removeFile(path: string): boolean {
  if (!existsSync(path)) return false;
  rmSync(path, { force: true });
  return true;
}

function updateJson(path: string, mutate: (value: Record<string, unknown>) => boolean): boolean {
  if (!existsSync(path)) return false;
  const raw = readFileSync(path, "utf8");
  const value = parseJsonObject(raw, path);
  const changed = mutate(value);
  if (changed) writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return changed;
}

function removeTomlBlock(path: string, tableName: string): boolean {
  if (!existsSync(path)) return false;
  const raw = readFileSync(path, "utf8");
  const result = removeTomlTable(raw, tableName);
  if (result.removed) writeFileSync(path, result.text.endsWith("\n") ? result.text : `${result.text}\n`, "utf8");
  return result.removed;
}

function removeSkill(agent: string): boolean {
  const file = skillPath(agent);
  return file ? removeFile(file) : false;
}

function skillPath(agent: string): string | undefined {
  if (agent === "opencode") return join(homedir(), ".config", "opencode", "skills", "project-memory", "SKILL.md");
  if (agent === "zcode") return join(homedir(), ".zcode", "skills", "project-memory", "SKILL.md");
  if (agent === "agents") return join(homedir(), ".agents", "skills", "project-memory", "SKILL.md");
  if (agent === "codex") return join(homedir(), ".codex", "skills", "project-memory", "SKILL.md");
  if (agent === "claude") return join(homedir(), ".claude", "skills", "project-memory", "SKILL.md");
  if (agent === "kiro") return join(homedir(), ".kiro", "skills", "project-memory", "SKILL.md");
  if (agent === "commandcode") return join(homedir(), ".commandcode", "skills", "project-memory", "SKILL.md");
  if (agent === "gemini") return join(homedir(), ".gemini", "skills", "project-memory", "SKILL.md");
  return undefined;
}

function unpatchKiroAgentFiles(): string[] {
  const dir = join(homedir(), ".kiro", "agents");
  if (!existsSync(dir)) return [];
  const patched: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (!ent.isFile()) continue;
    const file = join(dir, ent.name);
    const raw = readFileSync(file, "utf8");
    const next = removeKiroAgentHooks(raw, CLI);
    if (!next || next === raw) continue;
    writeFileSync(file, next, "utf8");
    patched.push(ent.name);
  }
  return patched;
}

function pathToFileUrl(file: string): string {
  return `file:///${file.replaceAll("\\", "/")}`;
}

function openCodePluginSource(): string {
  return `import { appendFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const CLI = ${JSON.stringify(CLI)};
const LOG = join(homedir(), ".project-memory", "opencode-hook.log");

function log(message) {
  try {
    mkdirSync(join(homedir(), ".project-memory"), { recursive: true });
    appendFileSync(LOG, new Date().toISOString() + " " + message + "\\n");
  } catch {}
}

function sessionContext(cwd) {
  const result = spawnSync("node", [CLI, "inject", "--cwd", cwd], {
    encoding: "utf8",
    timeout: 4000,
    windowsHide: true,
  });
  return (result.stdout || "").trim();
}

export const ProjectMemory = async ({ directory, worktree }) => {
  const cwd = worktree || directory;
  log("loaded cwd=" + cwd);
  return {
    "experimental.chat.system.transform": async (input, output) => {
      const id = input?.sessionID || "default";
      const text = sessionContext(cwd);
      log("recall session=" + id + " len=" + text.length);
      if (text && Array.isArray(output.system)) output.system.splice(1, 0, text);
    },
    "experimental.session.compacting": async (input, output) => {
      const id = input?.sessionID || "default";
      const flush = spawnSync("node", [CLI, "inject", "--flush", "--cwd", cwd], {
        encoding: "utf8",
        timeout: 4000,
        windowsHide: true,
      });
      const text = sessionContext(cwd);
      log("compact session=" + id);
      const flushText = (flush.stdout || "").trim();
      if (flushText) output.context.push(flushText);
      if (text) output.context.push(text);
    },
    event: async ({ event }) => {
      const type = event?.type;
      if (type !== "session.idle" && type !== "session.status") return;
      log("idle " + type + " " + (event?.properties?.sessionID || ""));
    },
  };
};

export default ProjectMemory;
`;
}

function mergeJson(path: string, mutate: (value: Record<string, unknown>) => void): void {
  const raw = existsSync(path) ? readFileSync(path, "utf8") : "{}";
  writeFileSync(path, mergeJsonText(raw, mutate, path), "utf8");
}
