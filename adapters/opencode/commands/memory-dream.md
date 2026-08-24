---
description: Consolidate project .memory files (dream) — dedupe, drop empty, flag conflicts
---

Consolidate this project's `.memory/` store. Follow Claude Code Auto-Dream and Mem0 `/mem0-dream` practice: merge duplicates, drop empty/stale chatter, never invent facts, never auto-resolve true conflicts.

1. Call MCP `memory_dream` with `dryRun: true` (or run `npx project-memory dream --dry-run` in the project root).
2. Show the report. Safe ops are index rebuild, empty-file delete, and identical-body merges. Pinned topics stay. Stale TODO/Next (>14 days) and relative dates are proposed only.
3. If the user did not pass `apply` as an argument, stop after the dry-run unless they confirm.
4. Call `memory_dream` with `dryRun: false` to apply **safe** ops only. If a lock error is returned, wait or tell the user `.memory/.dream.lock` is held.
5. For each **proposed** merge/conflict: `memory_read` both slugs. If they agree, `memory_write` one merged body (same slug or the `keep` slug) with Fact / Why / How to apply, then `memory_forget` the extra slug. If they disagree, do not merge — tell the user both facts and wait.
6. For **relative-date** proposals: rewrite the body with absolute dates (YYYY-MM-DD), do not invent facts.
7. For **stale** TODO/Next proposals: ask before deleting; never auto-delete.
8. `memory_index` at the end. Confirm the index lines you changed.

Do not write MEMORY.md as a topic. Do not store secrets. Arguments: $ARGUMENTS
