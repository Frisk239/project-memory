---
description: Consolidate project .memory files (dream) — dedupe, drop empty, report semantic cleanup candidates
---

Consolidate this project's `.memory/` store. Merge deterministic duplicates, drop empty chatter, and report semantic cleanup candidates for agent judgment. Never invent facts.

1. Call MCP `memory_dream` with `dryRun: true` (or run `node dist/cli.js dream --dry-run` from the project-memory checkout).
2. Show the report. Deterministic safe ops are index rebuild, empty-file delete, and identical-body merges. Pinned topics stay during dream's automatic forget/merge.
3. If the user passed `apply`, call `memory_dream` with `dryRun: false` to apply deterministic safe ops. If a lock error is returned, wait or tell the user `.memory/.dream.lock` is held.
4. For each semantic candidate: `memory_read` the relevant slug(s). If evidence is sufficient, `memory_write` the corrected canonical slug and `memory_forget` obsolete duplicates. Do not ask the user merely for approval; ask only when evidence is insufficient.
5. For **relative-date** candidates: rewrite the body with absolute dates (YYYY-MM-DD) only when the exact date is known.
6. For **stale** TODO/Next candidates: refresh or delete when repo/history evidence shows the note is obsolete.
7. `memory_index` at the end. Confirm the index lines you changed.

Do not write MEMORY.md as a topic. Do not store secrets. Arguments: $ARGUMENTS
