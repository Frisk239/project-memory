import { memoryDir } from "../core/paths.js";
import { readIndexText } from "../core/store.js";

const WRITE_RULES = `Write with memory_write when the next session would otherwise redo the work. Allowed, not required: a new task/goal may get a new file if it is worth keeping; existing files are not a cap. Same topic or a correction → same slug. Also write: remember/记住; confirmed approach; finished decision/constraint/shipped status; research/exploration findings; external URL. Empty .memory is fine.
Do not wait for "stable across many sessions". Recalled memories can be wrong: 不对/其实是/忘掉/作废 → search then update or forget, never two conflicting entries.
Types: user · feedback · project · reference. Skip what the repo already records (code, git, AGENTS.md).`;

const WRITE_REMINDER = `If this turn left something worth keeping (including a new task that is a new topic), you may memory_write a new file or update a slug. Not required. If the user corrected a memory, search and update or forget. If nothing worth keeping, do nothing.`;

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
