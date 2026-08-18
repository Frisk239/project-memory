import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "dist", "cli.js");
const MCP = join(ROOT, "dist", "mcp.js");
const MARKER = "project-memory";

export function doctorAgents(): string {
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
  ok("skill codex", existsSync(join(homedir(), ".codex", "skills", "project-memory", "SKILL.md")), "");
  ok("claude hooks", jsonHas(join(homedir(), ".claude", "settings.json"), MARKER), "");
  ok("claude mcp", jsonHas(join(homedir(), ".claude.json"), "project-memory"), "");
  ok("kiro mcp", jsonHas(join(homedir(), ".kiro", "settings", "mcp.json"), "project-memory"), "");
  ok("commandcode mcp", jsonHas(join(homedir(), ".commandcode", "mcp.json"), "project-memory"), "");
  ok("gemini mcp", jsonHas(join(homedir(), ".gemini", "config", "mcp_config.json"), "project-memory"), "");
  ok("grok hooks", existsSync(join(homedir(), ".grok", "hooks", "project-memory.json")), "");
  return lines.join("\n");
}

function jsonHas(path: string, needle: string): boolean {
  if (!existsSync(path)) return false;
  return readFileSync(path, "utf8").includes(needle);
}

export function installAgents(opts: { cwd?: string; agents: string[] }): string {
  const reports: string[] = [];
  for (const agent of opts.agents) {
    const name = agent === "antigravity" || agent === "gemini-cli" ? "gemini" : agent === "command-code" ? "commandcode" : agent;
    if (name === "opencode") reports.push(installOpenCode());
    else if (name === "zcode") reports.push(installZcode());
    else if (name === "codex") reports.push(installCodex());
    else if (name === "claude") reports.push(installClaude());
    else if (name === "kiro") reports.push(installKiro());
    else if (name === "commandcode") reports.push(installCommandCode());
    else if (name === "gemini") reports.push(installGemini());
    else if (name === "grok") reports.push(installGrok());
    else reports.push(`skip unknown agent: ${agent}`);
  }
  reports.push(installSkill());
  return reports.join("\n");
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
    const plugins = Array.isArray(config.plugin) ? [...config.plugin] : [];
    if (!plugins.includes(pluginHref)) plugins.push(pluginHref);
    config.plugin = plugins;
  });
  return `opencode: plugin ${pluginHref} + mcp`;
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
    });
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
    });
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
  return `zcode: user hooks SessionStart/Stop + mcp`;
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
          command: `node "${CLI}" hook`,
          commandWindows: `node "${CLI}" hook`,
          statusMessage: "Loading project memory",
          timeout: 5,
          additionalContextLimit: 2500,
        },
      ],
    });
    hooks.Stop = upsertHookGroup(hooks.Stop, {
      hooks: [
        {
          type: "command",
          command: `node "${CLI}" hook`,
          commandWindows: `node "${CLI}" hook`,
          statusMessage: "Project memory write reminder",
          timeout: 5,
        },
      ],
    });
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

function installSkill(): string {
  const skillSrc = join(ROOT, "skills", "project-memory", "SKILL.md");
  if (!existsSync(skillSrc)) return "skill: SKILL.md missing";
  const targets = [
    join(homedir(), ".config", "opencode", "skills", "project-memory", "SKILL.md"),
    join(homedir(), ".zcode", "skills", "project-memory", "SKILL.md"),
    join(homedir(), ".agents", "skills", "project-memory", "SKILL.md"),
    join(homedir(), ".codex", "skills", "project-memory", "SKILL.md"),
    join(homedir(), ".claude", "skills", "project-memory", "SKILL.md"),
    join(homedir(), ".kiro", "skills", "project-memory", "SKILL.md"),
    join(homedir(), ".commandcode", "skills", "project-memory", "SKILL.md"),
    join(homedir(), ".gemini", "skills", "project-memory", "SKILL.md"),
    join(homedir(), ".grok", "skills", "project-memory", "SKILL.md"),
  ];
  for (const target of targets) {
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(skillSrc, target);
  }
  return `skill: copied to known skill dirs`;
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
      }),
      Stop: upsertHookGroup(hooks.Stop, { hooks: [hookCommand()] }),
    });
    config.hooks = hooks;
  });
  const claudeJson = join(homedir(), ".claude.json");
  if (existsSync(claudeJson)) {
    mergeJson(claudeJson, (config) => mergeMcpStdio(config));
  }
  return "claude: settings.json SessionStart/Stop + ~/.claude.json mcp";
}

function installKiro(): string {
  const mcpPath = join(homedir(), ".kiro", "settings", "mcp.json");
  if (!existsSync(dirname(mcpPath))) return "kiro: ~/.kiro missing, skipped";
  mergeJson(mcpPath, (config) => mergeMcpStdio(config));
  const hookDir = join(homedir(), ".kiro", "hooks");
  mkdirSync(hookDir, { recursive: true });
  writeFileSync(
    join(hookDir, "project-memory.json"),
    `${JSON.stringify(
      {
        hooks: [
          { name: MARKER, trigger: "SessionStart", action: { type: "command", command: `node "${CLI}" hook` } },
          { name: `${MARKER}-stop`, trigger: "Stop", action: { type: "command", command: `node "${CLI}" hook` } },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return "kiro: mcp.json + hooks/project-memory.json";
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
    });
    hooks.Stop = upsertHookGroup(hooks.Stop, { hooks: [hookCommand()] });
    config.hooks = hooks;
  });
  return "commandcode: mcp.json + settings.json SessionStart/Stop";
}

function installGemini(): string {
  const gemini = join(homedir(), ".gemini");
  if (!existsSync(gemini)) return "gemini: ~/.gemini missing, skipped";
  mergeJson(join(gemini, "config", "mcp_config.json"), (config) => mergeMcpStdio(config));
  mergeJson(join(gemini, "settings.json"), (config) => {
    const hooks = asObject(config.hooks);
    Object.assign(hooks, claudeStyleHooks("startup|resume|clear|compact"));
    config.hooks = hooks;
  });
  const agHooks = join(gemini, "config", "hooks.json");
  mergeJson(agHooks, (config) => {
    const hooks = asObject(config.hooks);
    hooks.SessionStart = upsertHookGroup(hooks.SessionStart, {
      matcher: "startup|resume|clear|compact",
      hooks: [hookCommand()],
    });
    hooks.PreInvocation = upsertHookGroup(hooks.PreInvocation, { hooks: [hookCommand()] });
    hooks.SessionEnd = upsertHookGroup(hooks.SessionEnd, { hooks: [hookCommand()] });
    config.hooks = hooks;
  });
  return "gemini/antigravity: mcp_config.json + settings/hooks";
}

function installGrok(): string {
  const grok = join(homedir(), ".grok");
  if (!existsSync(grok)) return "grok: ~/.grok missing, skipped";
  const hookDir = join(grok, "hooks");
  mkdirSync(hookDir, { recursive: true });
  writeFileSync(
    join(hookDir, "project-memory.json"),
    `${JSON.stringify({ hooks: claudeStyleHooks("startup|resume|clear|compact") }, null, 2)}\n`,
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
  return "grok: hooks/project-memory.json + config.toml mcp";
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
const recalled = new Set();

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
      if (recalled.has(id)) return;
      const text = sessionContext(cwd);
      log("recall session=" + id + " len=" + text.length);
      if (text && Array.isArray(output.system)) output.system.splice(1, 0, text);
      recalled.add(id);
    },
    "experimental.session.compacting": async (input, output) => {
      const id = input?.sessionID || "default";
      const text = sessionContext(cwd);
      log("compact session=" + id);
      if (text) output.context.push(text);
      recalled.delete(id);
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
  const parsed = raw.trim() ? JSON.parse(raw) : {};
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`cannot merge non-object json: ${path}`);
  }
  const value = parsed as Record<string, unknown>;
  mutate(value);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

function upsertHookGroup(existing: unknown, group: Record<string, unknown>): unknown[] {
  const list = Array.isArray(existing) ? [...existing] : [];
  const next = list.filter((item) => !containsMarker(item));
  next.push(group);
  return next;
}

function containsMarker(value: unknown): boolean {
  return JSON.stringify(value).includes(MARKER) || JSON.stringify(value).includes(CLI.replaceAll("\\", "\\\\"));
}
