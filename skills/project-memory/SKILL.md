---
name: project-memory
description: Shared project memory. Use after finishing a non-trivial task, after research/exploration/调研 with reusable findings, when the user says remember/forget/记住/忘掉, or corrects a remembered fact (不对/其实是/作废). New valuable topics may get a new file — not required for every task. Also use at session start to read the index.
---

Write when the next session would otherwise redo the work. Empty `.memory` is normal. Do not spam. Existing files are not a cap. A new valuable topic **may** get a new file — not required for every new task. Same slug only for the same topic or a correction.

## When to write

| trigger | action |
|---|---|
| new task / goal / current direction | allowed to open a new `project` file if worth keeping; not mandatory |
| finished a decision, constraint, or shipped status | new file, or update that slug |
| research / 调研 / exploration with findings that would be costly to redo | allowed to write a new `project` or `reference` file |
| remember / 记住 | write immediately |
| about to compact / just compacted | write durable findings first, then re-read the index |
| dream / consolidate / 整理记忆 / `/memory-dream` | `memory_dream` dry-run, then apply safe ops; LLM-merge only when two files agree |
| 不对 / 其实是 / 忘掉 / 作废 | correct (below) |

Do not wait until a fact is "stable across many sessions". Multi-source research and non-obvious task context are worth keeping now.

## Correct

Recalled memories are snapshots and can be wrong.

| they say | do |
|---|---|
| 不对 / 其实是 / 改成 | `memory_search` → `memory_write` the same slug |
| 忘掉 / 作废 / forget | `memory_forget` |
| topic split | new slug + `memory_forget` the old one |

Never leave two entries that disagree. Confirm the slug you changed.

## Types

| type | when_to_save |
|---|---|
| user | who they are, role, standing preferences |
| feedback | they correct you OR confirm a non-obvious approach |
| project | goals, current task, constraints, shipped status, research conclusions not in git |
| reference | external URL, wiki, ticket, dashboard |

Skip: code structure, git history, AGENTS.md/CLAUDE.md, one-off chatter. If they ask to save a list that is already in the repo, keep only what was surprising.

Body: the fact, **Why**, **How to apply**.

## Read

`memory_index` at session start / after compact. `memory_read` a topic before acting on it. Empty index: do not invent memories; write the first one when something durable appears.

## Dream

Like Claude Code Auto-Dream and Mem0 `/mem0-dream`: housekeeping is deterministic; semantic merges need you.

1. `memory_dream` with `dryRun: true` (CLI: `project-memory dream --dry-run`).
2. Apply safe ops with `dryRun: false` (rebuild index, drop empty, merge **identical** bodies).
3. For proposed similar/conflict pairs: `memory_read` both. Merge only if they agree. Never invent. If they disagree, tell the user.

OpenCode: `/memory-dream`.

## Tools

`memory_index` · `memory_read` · `memory_search` · `memory_write` · `memory_forget` · `memory_dream`

`memory_write` args: `name` (slug), `description` (one-line summary; `title` also ok), `type` (`user` | `feedback` | `project` | `reference`), `body` (full text; `content` also ok). Confirm the returned index line. `memory_read` a topic slug from the index — not `MEMORY.md`.
