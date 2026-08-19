#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { forgetEntry, listIndex, readEntry, readIndexText, searchEntries, writeEntry } from "./core/store.js";
import { isMemoryType, type MemoryType } from "./core/types.js";
import { sessionContext } from "./hooks/context.js";
import { handleHook, type HookInput } from "./hooks/protocol.js";
import { doctorAgents, installAgents } from "./install.js";

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
      const saved = writeEntry({ name, description: description || name, type, body, origin: flag(rest, "--origin") }, cwd);
      print(`wrote ${saved.name}`);
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
    case "install":
      print(
        installAgents({
          cwd,
          agents:
            csv(flag(rest, "--agents")) || [
              "opencode",
              "zcode",
              "codex",
              "claude",
              "kiro",
              "commandcode",
              "gemini",
              "grok",
            ],
        }),
      );
      return;
    case "doctor":
      print(doctorAgents());
      return;
    case "mcp": {
      const { startMcp } = await import("./mcp.js");
      await startMcp();
      return;
    }
    case "help":
    default:
      print(`project-memory <hook|inject|index|read|write|search|forget|list|install|doctor|mcp>`);
  }
}

function runHook(rest: string[]): void {
  const event = flag(rest, "--event");
  const raw = readFileSync(0, "utf8").trim();
  const input = (raw ? JSON.parse(raw) : {}) as HookInput;
  if (event) input.hook_event_name = event;
  const output = handleHook(input);
  process.stdout.write(`${JSON.stringify(output ?? {})}\n`);
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
