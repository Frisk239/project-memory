import assert from "node:assert/strict";
import { test } from "node:test";
import { kiroMemoryHookYaml, patchKiroAgentFrontmatter, shouldPatchKiroAgent } from "./core/kiro-agent.js";

const CLI = "E:\\\\code\\\\project-memory\\\\dist\\\\cli.js";

test("patch inserts hooks when the agent has no hooks block", () => {
  const raw = `---
name: engineer
tools: ["read", "write"]
---

body
`;
  const next = patchKiroAgentFrontmatter(raw, CLI);
  assert.ok(next);
  assert.match(next ?? "", /agentSpawn/);
  assert.match(next ?? "", /userPromptSubmit/);
  assert.match(next ?? "", /stop:/);
  assert.match(next ?? "", /hook --event agentSpawn --plain/);
  assert.match(next ?? "", /\nbody\n/);
});

test("patch is idempotent when already wired", () => {
  const once = patchKiroAgentFrontmatter(
    `---
name: engineer
---
x
`,
    CLI,
  );
  assert.ok(once);
  const twice = patchKiroAgentFrontmatter(once ?? "", CLI);
  assert.equal(twice, once);
});

test("patch returns null without frontmatter", () => {
  assert.equal(patchKiroAgentFrontmatter("no front", CLI), null);
});

test("shouldPatchKiroAgent covers engineer and @project-memory, skips harness", () => {
  assert.equal(shouldPatchKiroAgent("engineer.md", "---\nname: engineer\n---\n"), true);
  assert.equal(shouldPatchKiroAgent("architect.md", "---\ntools: [\"@project-memory\"]\n---\n"), true);
  assert.equal(shouldPatchKiroAgent("architect.md", "---\ntools: [\"read\"]\n---\n"), false);
  assert.equal(shouldPatchKiroAgent("HARNESS.md", "---\nname: x\n---\n"), false);
  assert.ok(kiroMemoryHookYaml(CLI).includes("agentSpawn"));
});
