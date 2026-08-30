import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { writeEntry } from "./core/store.js";
import { sessionContext } from "./hooks/context.js";
import { handleHook, readHookInput } from "./hooks/protocol.js";

const cli = fileURLToPath(new URL("./cli.js", import.meta.url));

const dirs: string[] = [];

afterEach(() => {
  delete process.env.PROJECT_MEMORY_DIR;
  delete process.env.GROK_HOOK_EVENT;
  delete process.env.GROK_WORKSPACE_ROOT;
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
  assert.match(text, /do not need to be told/);
  assert.doesNotMatch(text, /MEMORY\.md/);
});

test("PreCompact asks to flush and SessionStart compact reloads index", () => {
  const dir = mkdtempSync(join(tmpdir(), "pmem-c-"));
  dirs.push(dir);
  process.env.PROJECT_MEMORY_DIR = dir;
  writeEntry({ name: "keep-me", description: "keep", type: "project", body: "x" });
  const pre = handleHook({ hook_event_name: "PreCompact", cwd: dir });
  assert.ok(pre);
  const preText = JSON.stringify(pre);
  assert.match(preText, /compacted/i);
  assert.doesNotMatch(preText, /keep-me/);
  const post = handleHook({ hook_event_name: "SessionStart", source: "compact", cwd: dir });
  assert.ok(post);
  assert.match(JSON.stringify(post), /keep-me/);
  assert.match(JSON.stringify(post), /just compacted/i);
});

test("only SessionStart reads and Stop writes", () => {
  assert.equal(handleHook({ hook_event_name: "PreToolUse" }), null);
  assert.equal(handleHook({ hook_event_name: "SubagentStart" }), null);
});

test("userPromptSubmit injects index as Kiro post-compact path", () => {
  const dir = mkdtempSync(join(tmpdir(), "pmem-k-"));
  dirs.push(dir);
  process.env.PROJECT_MEMORY_DIR = dir;
  writeEntry({ name: "kiro-keep", description: "keep", type: "project", body: "x" });
  const out = handleHook({ hook_event_name: "userPromptSubmit", cwd: dir });
  assert.ok(out);
  assert.match(JSON.stringify(out), /kiro-keep/);
});

test("agentSpawn aliases SessionStart and SessionEnd aliases Stop", () => {
  const start = handleHook({ hook_event_name: "agentSpawn" });
  assert.ok(start);
  assert.match(String((start as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext), /Project memory/);
  const end = handleHook({ hook_event_name: "SessionEnd" });
  assert.ok(end);
  assert.match(String((end as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext), /do nothing/i);
});

test("Grok Stop is silent so additionalContext cannot continue the turn", () => {
  assert.equal(handleHook({ hook_event_name: "Stop" }, { flavor: "grok" }), null);
  const out = execFileSync(process.execPath, [cli, "hook"], {
    input: JSON.stringify({ hookEventName: "stop", reason: "end_turn" }),
    encoding: "utf8",
    env: { ...process.env, GROK_HOOK_EVENT: "stop" },
    windowsHide: true,
  });
  assert.equal(out, "");
});

test("Grok session_start still injects the index", () => {
  const dir = mkdtempSync(join(tmpdir(), "pmem-grok-"));
  dirs.push(dir);
  process.env.PROJECT_MEMORY_DIR = dir;
  writeEntry({ name: "grok-topic", description: "Grok inject works", type: "project", body: "x" });
  const out = handleHook(
    { hookEventName: "session_start", workspaceRoot: dir },
    { flavor: "grok" },
  );
  assert.ok(out);
  const text = (out as { hookSpecificOutput: { additionalContext: string; hookEventName: string } }).hookSpecificOutput;
  assert.equal(text.hookEventName, "SessionStart");
  assert.match(text.additionalContext, /grok-topic/);
  assert.match(text.additionalContext, /Project memory/);
});

test("Grok pre_compact and post_compact use canonical events", () => {
  const dir = mkdtempSync(join(tmpdir(), "pmem-grok-c-"));
  dirs.push(dir);
  process.env.PROJECT_MEMORY_DIR = dir;
  writeEntry({ name: "keep-grok", description: "keep", type: "project", body: "x" });
  const pre = handleHook({ hookEventName: "pre_compact" }, { flavor: "grok" });
  assert.match(JSON.stringify(pre), /compacted/i);
  assert.doesNotMatch(JSON.stringify(pre), /keep-grok/);
  const post = handleHook({ hookEventName: "post_compact", workspaceRoot: dir }, { flavor: "grok" });
  assert.match(JSON.stringify(post), /keep-grok/);
  assert.match(JSON.stringify(post), /just compacted/i);
});

test("Claude Stop still injects the write reminder", () => {
  const out = handleHook({ hook_event_name: "Stop" }, { flavor: "claude" });
  assert.ok(out);
  const text = (out as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext;
  assert.match(text, /memory_write/);
});

test("workspaceRoot is used when cwd is missing", () => {
  const dir = mkdtempSync(join(tmpdir(), "pmem-ws-"));
  dirs.push(dir);
  process.env.PROJECT_MEMORY_DIR = dir;
  writeEntry({ name: "via-root", description: "from workspaceRoot", type: "project", body: "x" });
  const out = handleHook({ hook_event_name: "SessionStart", workspaceRoot: dir });
  assert.match(JSON.stringify(out), /via-root/);
});

test("injected rules treat memories as snapshots and forbid secrets; index has no timestamps", () => {
  const dir = mkdtempSync(join(tmpdir(), "pmem-adv-"));
  dirs.push(dir);
  process.env.PROJECT_MEMORY_DIR = dir;
  writeEntry({ name: "no-sed", description: "Do not sed batch edits", type: "feedback", body: "use Read+Edit" });
  const text = sessionContext(dir);
  assert.match(text, /snapshots/i);
  assert.match(text, /live repo/i);
  assert.match(text, /current user instructions/i);
  assert.match(text, /secret/i);
  assert.match(text, /you do not have to be told/i);
  assert.match(text, /conflict/i);
  assert.doesNotMatch(text, /\bupdated:/i);
  assert.doesNotMatch(text, /\d{4}-\d{2}-\d{2}T\d{2}:/);
  assert.match(text, /no-sed/);
  const skill = readFileSync(join(fileURLToPath(new URL(".", import.meta.url)), "..", "skills", "project-memory", "SKILL.md"), "utf8");
  assert.match(skill, /snapshots/i);
  assert.match(skill, /live repo/i);
  assert.match(skill, /current user instructions/i);
  assert.match(skill, /secret/i);
});

test("Antigravity PreInvocation injects ephemeralMessage each call", () => {
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
  const again = (second as { injectSteps: { ephemeralMessage: string }[] }).injectSteps;
  assert.match(again[0].ephemeralMessage, /ag-topic/);
});

test("readHookInput treats a TTY stdin as empty payload without reading fd 0", () => {
  let read = false;
  const input = readHookInput({ isTTY: true }, () => {
    read = true;
    return "";
  });
  assert.deepEqual(input, {});
  assert.equal(read, false);
});

test("readHookInput parses piped JSON and treats an empty pipe as {}", () => {
  assert.deepEqual(readHookInput({ isTTY: false }, () => '{"hook_event_name":"Stop"}'), { hook_event_name: "Stop" });
  assert.deepEqual(readHookInput({}, () => " \n"), {});
});
