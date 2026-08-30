import assert from "node:assert/strict";
import { test } from "node:test";
import {
  asObject,
  mergeJsonText,
  parseJsonObject,
  removeMcpServer,
  removeProjectMemoryHookGroups,
  removeTomlTable,
  upsertHookGroup,
} from "./core/host-config.js";

const CLI = "E:\\code\\project-memory\\dist\\cli.js";

test("upsertHookGroup only replaces hooks that target this cli hook", () => {
  const external = {
    matcher: "Stop",
    hooks: [{ type: "command", command: "node tools/project-memory-report.js", statusMessage: "project-memory" }],
  };
  const previousMine = {
    matcher: "Stop",
    hooks: [{ type: "command", command: `node "${CLI}" hook`, statusMessage: "project-memory" }],
  };
  const nextMine = {
    matcher: "Stop",
    hooks: [{ type: "command", command: `node "${CLI}" hook --flavor codex`, statusMessage: "project-memory" }],
  };
  const next = upsertHookGroup([external, previousMine], nextMine, CLI);
  assert.equal(next.length, 2);
  assert.equal(next[0], external);
  assert.equal(next[1], nextMine);
});

test("removeProjectMemoryHookGroups ignores marker text without the project-memory cli", () => {
  const external = { hooks: [{ command: "node ./scripts/project-memory-audit.js" }] };
  assert.deepEqual(removeProjectMemoryHookGroups([external], CLI), [external]);
});

test("json merge is pure and rejects non-object roots", () => {
  const next = mergeJsonText("{}", (config) => {
    config.enabled = true;
  });
  assert.deepEqual(parseJsonObject(next), { enabled: true });
  assert.throws(() => parseJsonObject("[]", "bad.json"), /non-object json/);
});

test("removeMcpServer removes only the project-memory server", () => {
  const config = { mcpServers: { "project-memory": { command: "node" }, other: { command: "npx" } } };
  assert.equal(removeMcpServer(config), true);
  assert.deepEqual(asObject(config.mcpServers), { other: { command: "npx" } });
});

test("removeTomlTable removes one mcp table and keeps following tables", () => {
  const raw = `first = true

[mcp_servers.project-memory]
command = "node"
args = ["dist/mcp.js"]

[mcp_servers.other]
command = "npx"
`;
  const result = removeTomlTable(raw, "mcp_servers.project-memory");
  assert.equal(result.removed, true);
  assert.doesNotMatch(result.text, /project-memory/);
  assert.match(result.text, /\[mcp_servers\.other\]/);
});
