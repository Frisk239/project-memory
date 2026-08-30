#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { applyDream, formatDreamReport } from "./core/dream.js";
import { forgetEntry, listIndex, readEntry, readIndexText, saveEntry, searchEntries } from "./core/store.js";
import { isMemoryType, type MemoryType } from "./core/types.js";
import { compactFlush, sessionContext } from "./hooks/context.js";
import { conflictMessage } from "./mcp-write.js";
import { handleHook, hookPlainText, readHookInput, resolveCwd } from "./hooks/protocol.js";
import { rememberRoot } from "./core/paths.js";
import { DEFAULT_AGENTS, doctorAgents, installAgents, uninstallAgents } from "./install.js";

const args = process.argv.slice(2);
const command = args[0] ?? "help";

try {
  await dispatch(command, args.slice(1));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

async function dispatch(cmd: string, rest: string[]): Promise<void> {
  const cwd = flag(rest, "--cwd") || process.cwd();
  switch (cmd) {
    case "hook":
      return runHook(rest);
    case "inject":
      if (rest.includes("--flush")) return print(compactFlush());
      return print(sessionContext(cwd));
    case "index":
      return print(readIndexText(cwd) || "(empty)");
    case "read": {
      const name = rest.find((arg) => !arg.startsWith("--"));
      if (!name) throw new Error("usage: project-memory read <name>");
      const entry = readEntry(name, cwd);
      if (!entry) throw new Error(`memory not found: ${name}`);
      print(`${entry.name} [${entry.type}]\n${entry.description}\n\n${entry.body}`);
      return;
    }
    case "write": {
      const name = flag(rest, "--name");
      const description = flag(rest, "--description") || name;
      const type = (flag(rest, "--type") || "project") as MemoryType;
      const body = flag(rest, "--body") || rest.filter((arg) => !arg.startsWith("--")).slice(1).join(" ");
      if (!name || !body) throw new Error("usage: project-memory write --name <slug> --type <type> --description <text> --body <text>");
      if (!isMemoryType(type)) throw new Error(`invalid type: ${type}`);
      const saved = saveEntry(
        {
          name,
          description: description || name,
          type,
          body,
          origin: flag(rest, "--origin"),
          pin: rest.includes("--pin") ? true : undefined,
        },
        cwd,
      );
      // Conflict still wrote the sibling file: instruct, exit 0. Only a
      // SimilarTopicError (thrown, no write) exits non-zero.
      if (saved.conflict) print(conflictMessage(saved.conflict));
      else print(`wrote ${saved.name}`);
      return;
    }
    case "search": {
      const query = rest.filter((arg) => !arg.startsWith("--")).join(" ");
      const hits = searchEntries(query, cwd);
      print(hits.length ? hits.map((hit) => `- ${hit.name} — ${hit.description}`).join("\n") : "(no hits)");
      return;
    }
    case "forget": {
      const name = rest.find((arg) => !arg.startsWith("--"));
      if (!name) throw new Error("usage: project-memory forget <name>");
      print(forgetEntry(name, cwd) ? `forgot ${name}` : `memory not found: ${name}`);
      return;
    }
    case "list":
      print(listIndex(cwd).map((item) => `${item.name}\t${item.description}`).join("\n") || "(empty)");
      return;
    case "dream": {
      const dryRun = rest.includes("--dry-run");
      print(formatDreamReport(applyDream({ cwd, dryRun })));
      return;
    }
    case "install":
      print(
        installAgents({
          cwd,
          agents: csv(flag(rest, "--agents")) || DEFAULT_AGENTS,
        }),
      );
      return;
    case "uninstall":
      print(
        uninstallAgents({
          cwd,
          agents: csv(flag(rest, "--agents")) || DEFAULT_AGENTS,
        }),
      );
      return;
    case "doctor":
      print(doctorAgents({ cwd, selftest: rest.includes("--selftest") }));
      return;
    case "mcp": {
      const { startMcp } = await import("./mcp.js");
      await startMcp();
      return;
    }
    case "help":
    default:
      print(`project-memory <hook|inject|index|read|write|search|forget|list|dream|install|uninstall|doctor|mcp>`);
  }
}

function runHook(rest: string[]): void {
  const event = flag(rest, "--event");
  const flavor = flag(rest, "--flavor");
  const input = readHookInput(process.stdin, () => readFileSync(0, "utf8"));
  if (event) input.hook_event_name = event;
  // Hook processes are spawned with the workspace as cwd, so stamp the root
  // for cwd-less clients (Kiro MCP) to recover later.
  rememberRoot(resolveCwd(input) || process.cwd());
  const output = handleHook(input, flavor ? { flavor } : undefined);
  if (rest.includes("--plain")) {
    const text = hookPlainText(output);
    if (text) process.stdout.write(`${text}\n`);
    return;
  }
  // Grok Stop is allow-by-silence: empty stdout ends the turn. `{}` is also
  // treated as allow, but writing nothing matches the documented contract.
  if (!output) return;
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

function flag(rest: string[], name: string): string | undefined {
  const index = rest.indexOf(name);
  if (index === -1) return undefined;
  return rest[index + 1];
}

function csv(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function print(text: string): void {
  process.stdout.write(`${text}\n`);
}
