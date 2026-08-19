import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { writeEntry } from "./core/store.js";
import { handleHook } from "./hooks/protocol.js";

const dirs: string[] = [];

afterEach(() => {
  delete process.env.PROJECT_MEMORY_DIR;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("SessionStart injects index", () => {
  const dir = mkdtempSync(join(tmpdir(), "pmem-hook-"));
  dirs.push(dir);
  process.env.PROJECT_MEMORY_DIR = dir;
  writeEntry({ name: "no-sed", description: "Do not sed batch edits", type: "feedback", body: "use Read+Edit" });
  const out = handleHook({ hook_event_name: "SessionStart", cwd: dir });
  assert.ok(out);
  const payload = out as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
  assert.equal(payload.hookSpecificOutput.hookEventName, "SessionStart");
  assert.match(payload.hookSpecificOutput.additionalContext, /no-sed/);
  assert.match(payload.hookSpecificOutput.additionalContext, /Project memory/);
});

test("Stop injects write reminder only", () => {
  const out = handleHook({ hook_event_name: "Stop" });
  assert.ok(out);
  const text = (out as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext;
  assert.match(text, /memory_write/);
  assert.match(text, /do nothing/i);
  assert.doesNotMatch(text, /MEMORY\.md/);
});

test("only SessionStart reads and Stop writes", () => {
  assert.equal(handleHook({ hook_event_name: "UserPromptSubmit" }), null);
  assert.equal(handleHook({ hook_event_name: "PreToolUse" }), null);
  assert.equal(handleHook({ hook_event_name: "PreCompact" }), null);
  assert.equal(handleHook({ hook_event_name: "SubagentStart" }), null);
});

test("agentSpawn aliases SessionStart and SessionEnd aliases Stop", () => {
  const start = handleHook({ hook_event_name: "agentSpawn" });
  assert.ok(start);
  assert.match(String((start as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext), /Project memory/);
  const end = handleHook({ hook_event_name: "SessionEnd" });
  assert.ok(end);
  assert.match(String((end as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext), /do nothing/i);
});

test("Antigravity PreInvocation injects ephemeralMessage once", () => {
  const dir = mkdtempSync(join(tmpdir(), "pmem-ag-"));
  dirs.push(dir);
  process.env.PROJECT_MEMORY_DIR = dir;
  writeEntry({ name: "ag-topic", description: "AG inject works", type: "project", body: "x" });
  const id = `ag-${Date.now()}`;
  const first = handleHook({ invocationNum: 0, conversationId: id, workspacePaths: [dir] });
  assert.ok(first);
  const steps = (first as { injectSteps: { ephemeralMessage: string }[] }).injectSteps;
  assert.match(steps[0].ephemeralMessage, /ag-topic/);
  const second = handleHook({ invocationNum: 1, conversationId: id, workspacePaths: [dir] });
  assert.deepEqual(second, {});
});
