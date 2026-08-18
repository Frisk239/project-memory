import { memoryDir } from "../core/paths.js";
import { readIndexText } from "../core/store.js";

const WRITE_RULES = `You write memories yourself with memory_write. Do not wait to be asked.
Write after: user says remember/记住; user corrects you or confirms a non-obvious approach; you finish a non-trivial task (decision, constraint, shipped status); user points at an external doc/URL.
Types: user (who they are) · feedback (how to work, include why) · project (goals/status/constraints not in git; use absolute dates) · reference (external pointers).
Skip: code structure, git history, AGENTS.md/CLAUDE.md, one-off chatter. Same slug = update. Body: fact + Why + How to apply.`;

const WRITE_REMINDER = `This turn is ending. If it finished a non-trivial task, or the user corrected/confirmed you, call memory_write now. Skip if nothing durable.`;

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
