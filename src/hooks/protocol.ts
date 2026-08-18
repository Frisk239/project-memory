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
};

export type HookOutput = {
  hookSpecificOutput: {
    hookEventName: string;
    additionalContext: string;
  };
};

const INJECT_EVENTS = new Set(["SessionStart", "agentSpawn"]);
const STOP_EVENTS = new Set(["Stop", "SessionEnd", "agentStop"]);
const ONCE_INJECT_EVENTS = new Set(["PreInvocation"]);

export function handleHook(input: HookInput): HookOutput | null {
  const event = input.hook_event_name || input.hookEventName || "";
  if (INJECT_EVENTS.has(event)) {
    return wrap(event, sessionContext(input.cwd));
  }
  if (ONCE_INJECT_EVENTS.has(event)) {
    const id = input.session_id || input.sessionId || `${input.cwd || ""}:default`;
    if (!markRecalled(id)) return null;
    return wrap(event, sessionContext(input.cwd));
  }
  if (STOP_EVENTS.has(event)) {
    return wrap(event, stopReminder());
  }
  return null;
}

function wrap(event: string, additionalContext: string): HookOutput {
  return {
    hookSpecificOutput: {
      hookEventName: event,
      additionalContext,
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
