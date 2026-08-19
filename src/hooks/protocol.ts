import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { sessionContext, stopReminder } from "./context.js";

export type HookInput = {
  hook_event_name?: string;
  hookEventName?: string;
  cwd?: string;
  source?: string;
  session_id?: string;
  sessionId?: string;
  conversationId?: string;
  workspacePaths?: string[];
  invocationNum?: number;
  terminationReason?: string;
  fullyIdle?: boolean;
  toolCall?: unknown;
};

const INJECT_EVENTS = new Set(["SessionStart", "agentSpawn"]);
const STOP_EVENTS = new Set(["Stop", "stop", "SessionEnd", "agentStop"]);
const ONCE_INJECT_EVENTS = new Set(["PreInvocation"]);

export function handleHook(input: HookInput): Record<string, unknown> | null {
  const event = inferEvent(input);
  const cwd = resolveCwd(input);
  const flavor = isAntigravity(input) ? "antigravity" : "claude";
  if (INJECT_EVENTS.has(event)) {
    return formatOutput(flavor, event, sessionContext(cwd));
  }
  if (ONCE_INJECT_EVENTS.has(event)) {
    const id = resolveSessionId(input, cwd);
    if (!markRecalled(id)) return flavor === "antigravity" ? {} : null;
    return formatOutput(flavor, event, sessionContext(cwd));
  }
  if (STOP_EVENTS.has(event)) {
    if (flavor === "antigravity") return { decision: "allow" };
    return formatOutput(flavor, event, stopReminder());
  }
  return flavor === "antigravity" ? {} : null;
}

function inferEvent(input: HookInput): string {
  const named = input.hook_event_name || input.hookEventName || "";
  if (named) return named;
  if (input.terminationReason != null || input.fullyIdle != null) return "Stop";
  if (input.invocationNum != null) return "PreInvocation";
  if (input.toolCall) return "PreToolUse";
  return "";
}

function resolveCwd(input: HookInput): string | undefined {
  if (input.cwd) return input.cwd;
  if (input.workspacePaths?.[0]) return input.workspacePaths[0];
  return undefined;
}

function resolveSessionId(input: HookInput, cwd?: string): string {
  return input.session_id || input.sessionId || input.conversationId || `${cwd || ""}:default`;
}

function isAntigravity(input: HookInput): boolean {
  return input.conversationId != null || input.workspacePaths != null || input.invocationNum != null || input.fullyIdle != null;
}

function formatOutput(flavor: string, event: string, text: string): Record<string, unknown> {
  if (flavor === "antigravity") {
    return { injectSteps: [{ ephemeralMessage: text }] };
  }
  return {
    hookSpecificOutput: {
      hookEventName: event,
      additionalContext: text,
    },
  };
}

function recalledPath(): string {
  return join(homedir(), ".project-memory", "recalled-sessions.json");
}

function markRecalled(id: string): boolean {
  const file = recalledPath();
  mkdirSync(join(homedir(), ".project-memory"), { recursive: true });
  let map: Record<string, number> = {};
  if (existsSync(file)) {
    try {
      map = JSON.parse(readFileSync(file, "utf8")) as Record<string, number>;
    } catch {
      map = {};
    }
  }
  if (map[id]) return false;
  const now = Date.now();
  const fresh: Record<string, number> = {};
  for (const [key, ts] of Object.entries(map)) {
    if (now - ts < 7 * 24 * 60 * 60 * 1000) fresh[key] = ts;
  }
  fresh[id] = now;
  writeFileSync(file, `${JSON.stringify(fresh)}\n`, "utf8");
  return true;
}
