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
  assert.equal(out.hookSpecificOutput.hookEventName, "SessionStart");
  assert.match(out.hookSpecificOutput.additionalContext, /no-sed/);
  assert.match(out.hookSpecificOutput.additionalContext, /Project memory/);
});

test("Stop injects write reminder only", () => {
  const out = handleHook({ hook_event_name: "Stop" });
  assert.ok(out);
  assert.match(out.hookSpecificOutput.additionalContext, /memory_write/);
  assert.match(out.hookSpecificOutput.additionalContext, /ending/);
  assert.doesNotMatch(out.hookSpecificOutput.additionalContext, /MEMORY\.md/);
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
  assert.match(start.hookSpecificOutput.additionalContext, /Project memory/);
  const end = handleHook({ hook_event_name: "SessionEnd" });
  assert.ok(end);
  assert.match(end.hookSpecificOutput.additionalContext, /ending/);
});
