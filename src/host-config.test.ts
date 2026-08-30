import assert from "node:assert/strict";
import { test } from "node:test";
import {
  asObject,
  mergeJsonText,
  parseJsonObject,
  referencesPath,
  removeMcpServer,
  removeProjectMemoryHookGroups,
  removeTomlTable,
  upsertHookGroup,
  upsertMcpServer,
} from "./core/host-config.js";

const CLI = "E:\\code\\project-memory\\dist\\cli.js";
const MCP = "E:\\code\\project-memory\\dist\\mcp.js";

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
  assert.equal(removeMcpServer(config), "removed");
  assert.deepEqual(asObject(config.mcpServers), { other: { command: "npx" } });
  assert.equal(removeMcpServer(config), "absent");
});

test("removeMcpServer with a path only deletes entries that reference our mcp.js", () => {
  const foreign = { mcpServers: { "project-memory": { command: "node", args: ["C:\\elsewhere\\mcp.js"] } } };
  assert.equal(removeMcpServer(foreign, "mcpServers", MCP), "kept");
  assert.ok(foreign.mcpServers["project-memory"], "foreign entry must survive");

  const ours = { mcpServers: { "project-memory": { command: "node", args: [MCP] } } };
  assert.equal(removeMcpServer(ours, "mcpServers", MCP), "removed");
});

test("referencesPath matches the path inside commands, args, and env", () => {
  assert.ok(referencesPath({ command: "node", args: [MCP] }, MCP));
  assert.ok(referencesPath({ command: `node "${MCP}"` }, MCP));
  assert.ok(referencesPath({ env: { FILE: MCP.toLowerCase() } }, MCP));
  assert.ok(!referencesPath({ command: "node", args: ["C:\\elsewhere\\mcp.js"] }, MCP));
  assert.ok(!referencesPath({ command: "node", args: [] }, MCP));
});

test("upsertMcpServer adds, replaces our own, and refuses a foreign entry", () => {
  const fresh: Record<string, unknown> = {};
  assert.equal(upsertMcpServer(fresh, { command: "node", args: [MCP] }, MCP), "added");

  const own = { "project-memory": { command: "node", args: [MCP], env: { EXTRA: "1" } } };
  assert.equal(upsertMcpServer(own, { command: "node", args: [MCP] }, MCP), "replaced");
  assert.deepEqual(own["project-memory"], { command: "node", args: [MCP] });

  // An entry pointing somewhere else entirely (e.g. an old checkout, or
  // someone else's server under the same key) is not ours: keep it.
  const stale = { "project-memory": { command: "node", args: ["E:\\old\\dist\\mcp.js"] } };
  assert.equal(upsertMcpServer(stale, { command: "node", args: [MCP] }, MCP), "kept");

  const foreign = { "project-memory": { command: "node", args: ["C:\\elsewhere\\mcp.js"] }, other: { command: "npx" } };
  const before = JSON.stringify(foreign["project-memory"]);
  assert.equal(upsertMcpServer(foreign, { command: "node", args: [MCP] }, MCP), "kept");
  assert.equal(JSON.stringify(foreign["project-memory"]), before, "foreign entry must be untouched");
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
