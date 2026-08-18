import { memoryDir } from "../core/paths.js";
import { readIndexText } from "../core/store.js";

const WRITE_RULES = `Write with memory_write only when a future session would otherwise re-learn it: remember/记住; a correction or confirmed approach; a finished decision/constraint/shipped status; an external URL. Not every turn.
Types: user · feedback · project · reference. Skip code, git, AGENTS.md, chatter. Same slug = update.`;

const WRITE_REMINDER = `If this turn actually finished something durable, memory_write it. Otherwise do nothing.`;

export function sessionContext(cwd?: string): string {
  const index = readIndexText(cwd).trim();
  const dir = memoryDir(cwd);
  if (!index) {
    return `## Project memory
No memories yet for this project (${dir}).
${WRITE_RULES}`;
  }
  return `## Project memory
Index from ${dir}/MEMORY.md. Read a topic before acting on it.
${WRITE_RULES}

${index}`;
}

export function stopReminder(): string {
  return WRITE_REMINDER;
}
