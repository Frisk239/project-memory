export const PROJECT_MEMORY_ID = "project-memory";

export function parseJsonObject(raw: string, path = "json"): Record<string, unknown> {
  const parsed: unknown = raw.trim() ? JSON.parse(raw) : {};
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`cannot merge non-object json: ${path}`);
  }
  return parsed as Record<string, unknown>;
}

export function mergeJsonText(
  raw: string,
  mutate: (value: Record<string, unknown>) => void,
  path = "json",
): string {
  const value = parseJsonObject(raw, path);
  mutate(value);
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

export function upsertHookGroup(existing: unknown, group: Record<string, unknown>, cli: string): unknown[] {
  return [...removeProjectMemoryHookGroups(existing, cli), group];
}

export function removeProjectMemoryHookGroups(existing: unknown, cli: string): unknown[] {
  const list = Array.isArray(existing) ? existing : [];
  return list.filter((item) => !isProjectMemoryHookGroup(item, cli));
}

export function isProjectMemoryHookGroup(value: unknown, cli: string): boolean {
  const obj = asObject(value);
  if (obj.id === PROJECT_MEMORY_ID) return true;
  const hooks = obj.hooks;
  if (Array.isArray(hooks)) return hooks.some((hook) => isProjectMemoryHookCommand(hook, cli));
  return isProjectMemoryHookCommand(value, cli);
}

export function isProjectMemoryHookCommand(value: unknown, cli: string): boolean {
  const obj = asObject(value);
  if (obj.id === PROJECT_MEMORY_ID) return true;
  if (typeof obj.command === "string" && commandTargetsCliHook(obj.command, cli)) return true;
  if (Array.isArray(obj.args) && argsTargetCliHook(obj.args, cli)) return true;
  if (obj.action && isProjectMemoryHookCommand(obj.action, cli)) return true;
  if (Array.isArray(obj.hooks) && obj.hooks.some((hook) => isProjectMemoryHookCommand(hook, cli))) return true;
  return false;
}

/**
 * True when any string inside the value (command, args, env, ...) references
 * the given path after path normalization. This is what makes an MCP entry
 * recognizably *ours* — the same precise-recognition rule the hook groups
 * use, not the bare key name.
 */
export function referencesPath(value: unknown, target: string): boolean {
  if (typeof value === "string") return normalizePath(value).includes(normalizePath(target));
  if (Array.isArray(value)) return value.some((item) => referencesPath(item, target));
  if (value && typeof value === "object") return Object.values(value).some((item) => referencesPath(item, target));
  return false;
}

export type McpUpsertStatus = "added" | "replaced" | "kept";

/**
 * Upsert the project-memory MCP server entry into a servers map. An existing
 * entry that does not reference our mcp.js belongs to someone else: refuse to
 * overwrite it and report "kept" — mirrors installKiroWorkspaceMcp's rule.
 */
export function upsertMcpServer(servers: Record<string, unknown>, entry: Record<string, unknown>, mcpPath: string): McpUpsertStatus {
  const existing = asObject(servers[PROJECT_MEMORY_ID]);
  if (Object.keys(existing).length && !referencesPath(existing, mcpPath)) return "kept";
  servers[PROJECT_MEMORY_ID] = entry;
  return Object.keys(existing).length ? "replaced" : "added";
}

export type McpRemoveStatus = "removed" | "kept" | "absent";

/**
 * Remove the project-memory MCP server entry. When `mcpPath` is given, an
 * entry that does not reference our mcp.js is not ours to delete and is left
 * untouched ("kept") — deletion follows the same precise-recognition rule as
 * hook groups, not the bare key name.
 */
export function removeMcpServer(config: Record<string, unknown>, key = "mcpServers", mcpPath?: string): McpRemoveStatus {
  const servers = asObject(config[key]);
  if (!Object.hasOwn(servers, PROJECT_MEMORY_ID)) return "absent";
  if (mcpPath && !referencesPath(servers[PROJECT_MEMORY_ID], mcpPath)) return "kept";
  delete servers[PROJECT_MEMORY_ID];
  config[key] = servers;
  return "removed";
}

export function removeTomlTable(raw: string, tableName: string): { text: string; removed: boolean } {
  const lines = raw.split(/\r?\n/);
  const out: string[] = [];
  let removed = false;
  let skipping = false;
  for (const line of lines) {
    if (line.trim() === `[${tableName}]`) {
      skipping = true;
      removed = true;
      continue;
    }
    if (skipping && /^\[[^\]]+\]\s*$/.test(line.trim())) skipping = false;
    if (!skipping) out.push(line);
  }
  return { text: out.join("\n").replace(/\n{3,}/g, "\n\n"), removed };
}

function argsTargetCliHook(args: unknown[], cli: string): boolean {
  const normalizedCli = normalizePath(cli);
  const strings = args.filter((arg): arg is string => typeof arg === "string");
  return strings.some((arg) => normalizePath(arg) === normalizedCli) && strings.includes("hook");
}

function commandTargetsCliHook(command: string, cli: string): boolean {
  return normalizePath(command).includes(normalizePath(cli)) && /(?:^|\s)hook(?:\s|$)/.test(command);
}

function normalizePath(value: string): string {
  return value.replaceAll("\\\\", "\\").replaceAll("\\", "/").toLowerCase();
}
