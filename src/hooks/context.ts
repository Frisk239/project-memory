import { memoryDir, UnresolvedRootError } from "../core/paths.js";
import { readIndexText } from "../core/store.js";

const WRITE_RULES = `After a successful round, if a durable fact appeared, memory_write it. You do not have to be told 记住 — extract it yourself. Durable = a decision, constraint, shipped status, standing preference, research/exploration finding, or external URL the next session would otherwise redo. Empty .memory is fine; do not spam.
Organize at write: same topic → same slug (it replaces/upserts). If memory_write returns similar-topic, use that existing slug to update the topic, or pick a clearly distinct slug. Agents may update or delete memories when repo evidence/current instructions make them stale, wrong, or duplicate; no owner approval is required. Ask only when evidence is insufficient.
memory_write args: name (slug), description (one-line; title ok), type, body (full text; content ok). Confirm the returned index line. Do not write MEMORY.md as a topic. Legacy [conflict] entries may be resolved by reading both, writing the chosen slug, then memory_forget-ing the obsolete one.
Recalled facts are snapshots. The live repo and the current user instructions win if they disagree. Never store secrets, credentials, or tokens.
Recalled memories can be wrong: 不对/其实是/忘掉/作废 → search then update the same slug, or forget.
Types: user · feedback · project · reference. Skip what the repo already records (code, git, AGENTS.md).`;

const WRITE_REMINDER = `Before you stop: extract. If this round produced a durable decision, task status, or research finding not already in memory, memory_write it now (same slug for the same topic; new file for a distinct topic) — you do not need to be told 记住. If an existing memory is now stale, wrong, or duplicate, update that slug or memory_forget it without waiting for owner approval. If nothing durable appeared, do nothing.`;

const COMPACT_FLUSH = `Context is about to be compacted — chat detail will be discarded. If this session has a durable decision, current task, or research finding not yet in project memory, memory_write it now (new file if new topic). Then continue.`;

const POST_COMPACT = `Context was just compacted. Re-read the index below. If something durable survived only in the summary and is not a memory yet, memory_write it.`;

export function sessionContext(cwd?: string): string {
  let index: string;
  let dir: string;
  try {
    index = readIndexText(cwd).trim();
    dir = memoryDir(cwd);
  } catch (error) {
    // No reliable root (not a workspace, cache stale): inject nothing rather
    // than another project's index. A hook must never crash the host; the
    // explicit CLI/MCP paths surface this error instead.
    if (error instanceof UnresolvedRootError) return "";
    throw error;
  }
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
