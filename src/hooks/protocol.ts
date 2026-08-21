import { compactFlush, postCompactContext, sessionContext, stopReminder } from "./context.js";

export type HookInput = {
  hook_event_name?: string;
  hookEventName?: string;
  trigger?: string;
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

const INJECT_EVENTS = new Set(["SessionStart", "agentSpawn", "PreInvocation", "userPromptSubmit", "UserPromptSubmit"]);
const STOP_EVENTS = new Set(["Stop", "stop", "SessionEnd", "agentStop"]);
const COMPACT_FLUSH_EVENTS = new Set(["PreCompact", "PreCompress"]);
const POST_COMPACT_EVENTS = new Set(["PostCompact"]);

export function handleHook(input: HookInput): Record<string, unknown> | null {
  const event = inferEvent(input);
  const cwd = resolveCwd(input);
  const flavor = isAntigravity(input) ? "antigravity" : "claude";
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
    if (flavor === "antigravity") return { decision: "allow" };
    return formatOutput(flavor, event, stopReminder());
  }
  return flavor === "antigravity" ? {} : null;
}

function inferEvent(input: HookInput): string {
  const named = input.hook_event_name || input.hookEventName || input.trigger || "";
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
