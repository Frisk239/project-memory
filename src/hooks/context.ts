import { memoryDir } from "../core/paths.js";
import { readIndexText } from "../core/store.js";

const WRITE_RULES = `Write with memory_write when a future session would re-learn it: remember/记住; a correction or confirmed approach; a finished decision/constraint/shipped status; an external URL. New topic of value → new file. Same topic or a correction → same slug. Do not spam, but do write when it is worth keeping.
Recalled memories can be wrong. If the user corrects one (不对/其实是/忘掉/作废), memory_search then update that slug or memory_forget — never leave two conflicting entries.
Types: user · feedback · project · reference. Skip code, git, AGENTS.md, chatter.`;

const WRITE_REMINDER = `If this turn produced a new durable topic, memory_write a new file. If it updated an existing one, overwrite that slug. If the user corrected a memory, search and update or forget. If nothing worth keeping, do nothing.`;

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
