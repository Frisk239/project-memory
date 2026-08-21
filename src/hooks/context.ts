import { memoryDir } from "../core/paths.js";
import { readIndexText } from "../core/store.js";

const WRITE_RULES = `Write with memory_write when the next session would otherwise redo the work. Allowed, not required: a new task/goal may get a new file if it is worth keeping; existing files are not a cap. Same topic or a correction → same slug. Also write: remember/记住; confirmed approach; finished decision/constraint/shipped status; research/exploration findings; external URL. Empty .memory is fine.
memory_write args: name (slug), description (one-line; title ok), type, body (full text; content ok). Confirm the returned index line. Do not write MEMORY.md as a topic.
Do not wait for "stable across many sessions". Recalled memories can be wrong: 不对/其实是/忘掉/作废 → search then update or forget, never two conflicting entries.
Types: user · feedback · project · reference. Skip what the repo already records (code, git, AGENTS.md).`;

const WRITE_REMINDER = `Before you stop: if this turn produced a durable decision, task status, or research finding not already in memory, memory_write it (new file if new topic). If the user corrected a memory, search and update or forget. If nothing worth keeping, do nothing.`;

const COMPACT_FLUSH = `Context is about to be compacted — chat detail will be discarded. If this session has a durable decision, current task, or research finding not yet in project memory, memory_write it now (new file if new topic). Then continue.`;

const POST_COMPACT = `Context was just compacted. Re-read the index below. If something durable survived only in the summary and is not a memory yet, memory_write it.`;

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

export function compactFlush(): string {
  return COMPACT_FLUSH;
}

export function postCompactContext(cwd?: string): string {
  return `${POST_COMPACT}\n\n${sessionContext(cwd)}`;
}
