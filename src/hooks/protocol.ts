import { compactFlush, postCompactContext, sessionContext, stopReminder } from "./context.js";

export type HookFlavor = "claude" | "antigravity" | "grok";

export type HookInput = {
  hook_event_name?: string;
  hookEventName?: string;
  trigger?: string;
  cwd?: string;
  workspaceRoot?: string;
  source?: string;
  reason?: string;
  session_id?: string;
  sessionId?: string;
  conversationId?: string;
  workspacePaths?: string[];
  invocationNum?: number;
  terminationReason?: string;
  fullyIdle?: boolean;
  toolCall?: unknown;
  stopHookActive?: boolean;
  permissionMode?: string;
};

export type HandleHookOptions = {
  flavor?: HookFlavor | string;
};

const INJECT_EVENTS = new Set(["SessionStart", "PreInvocation", "UserPromptSubmit"]);
const STOP_EVENTS = new Set(["Stop", "SessionEnd"]);
const COMPACT_FLUSH_EVENTS = new Set(["PreCompact", "PreCompress"]);
const POST_COMPACT_EVENTS = new Set(["PostCompact"]);

const EVENT_ALIASES: Record<string, string> = {
  sessionstart: "SessionStart",
  agentspawn: "SessionStart",
  preinvocation: "PreInvocation",
  userpromptsubmit: "UserPromptSubmit",
  stop: "Stop",
  agentstop: "Stop",
  sessionend: "SessionEnd",
  precompact: "PreCompact",
  precompress: "PreCompress",
  postcompact: "PostCompact",
};

export function handleHook(input: HookInput, options?: HandleHookOptions): Record<string, unknown> | null {
  const event = inferEvent(input);
  const cwd = resolveCwd(input);
  const flavor = resolveFlavor(input, options);
  if (COMPACT_FLUSH_EVENTS.has(event)) {
    return formatOutput(flavor, event, compactFlush());
  }
  if (POST_COMPACT_EVENTS.has(event)) {
    return formatOutput(flavor, event, postCompactContext(cwd));
  }
  if (INJECT_EVENTS.has(event)) {
    const text = input.source === "compact" ? postCompactContext(cwd) : sessionContext(cwd);
    return formatOutput(flavor, event, text);
  }
  if (STOP_EVENTS.has(event)) {
    // Grok treats Stop additionalContext as "keep working" and will re-fire
    // until the 8-continuation cap. OpenCode's idle path is observe-only;
    // Grok memory writes stay in the skill + SessionStart/PreCompact context.
    if (flavor === "grok") return null;
    if (flavor === "antigravity") return { decision: "allow" };
    return formatOutput(flavor, event, stopReminder());
  }
  return flavor === "antigravity" ? {} : null;
}

function inferEvent(input: HookInput): string {
  const named = input.hook_event_name || input.hookEventName || input.trigger || "";
  if (named) return canonicalEvent(named);
  if (input.terminationReason != null || input.fullyIdle != null) return "Stop";
  if (input.invocationNum != null) return "PreInvocation";
  if (input.toolCall) return "PreToolUse";
  return "";
}

function canonicalEvent(name: string): string {
  const compact = name.replace(/[_-\s]/g, "").toLowerCase();
  return EVENT_ALIASES[compact] || name;
}

function resolveCwd(input: HookInput): string | undefined {
  return input.cwd || input.workspaceRoot || process.env.GROK_WORKSPACE_ROOT || input.workspacePaths?.[0];
}

function resolveFlavor(input: HookInput, options?: HandleHookOptions): HookFlavor {
  const requested = options?.flavor?.trim().toLowerCase();
  if (requested === "grok" || requested === "antigravity" || requested === "claude") return requested;
  if (process.env.GROK_HOOK_EVENT) return "grok";
  if (isAntigravity(input)) return "antigravity";
  return "claude";
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

export function hookPlainText(output: Record<string, unknown> | null): string {
  if (!output) return "";
  const spec = output.hookSpecificOutput as { additionalContext?: string } | undefined;
  if (spec?.additionalContext) return spec.additionalContext;
  const steps = output.injectSteps as { ephemeralMessage?: string }[] | undefined;
  if (steps?.[0]?.ephemeralMessage) return steps[0].ephemeralMessage;
  return "";
}
