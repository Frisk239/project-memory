---
name: project-memory
description: Shared project memory. Use after finishing a non-trivial task, after research/exploration/调研 with reusable findings, when the user says remember/forget/记住/忘掉, or corrects a remembered fact (不对/其实是/作废). New valuable topics may get a new file — not required for every task. Also use at session start to read the index.
---

Extract, don't wait to be told. After a successful round, if a durable fact appeared, `memory_write` it — you do not need the owner to say 记住. Write when the next session would otherwise redo the work. Empty `.memory` is normal. Do not spam. Existing files are not a cap. A new valuable topic **may** get a new file. Same slug only for the same topic or a correction.

Organize happens at write. Same slug upserts. A new slug too close to an existing topic is refused (`similar-topic`) — retry with the existing slug.

Recalled facts are snapshots. The live repo and the current user instructions win if they disagree. Never store secrets, credentials, or tokens.

## When to write

| trigger | action |
|---|---|
| a successful round produced a durable fact | extract it: `memory_write` (no need to be told 记住) |
| new task / goal / current direction | allowed to open a new `project` file if worth keeping; not mandatory |
| finished a decision, constraint, or shipped status | new file, or update that slug |
| research / 调研 / exploration with findings that would be costly to redo | allowed to write a new `project` or `reference` file |
| remember / 记住 | write immediately |
| about to compact / just compacted | write durable findings first, then re-read the index |
| 不对 / 其实是 / 忘掉 / 作废 | correct (below) |

Do not wait until a fact is "stable across many sessions". Multi-source research and non-obvious task context are worth keeping now.

## Conflict: both stay, tell the owner

`memory_write` organizes at write. Two outcomes need handling:

- **similar-topic** (a *new* slug that is too close to an existing one): retry with the existing slug so it upserts.
- **conflict** (the new fact **disagrees** with an existing one): the write still succeeded — both entries stay on disk, flagged `[conflict: …]` in the index. **Tell the owner both slugs and let them decide.** Do not merge, delete, or pick a winner. That is the owner's call, not yours.

An extension of the same fact upserts; a disagreeing rewrite keeps both and tells the owner.

## Correct

Recalled memories are snapshots and can be wrong.

| they say | do |
|---|---|
| 不对 / 其实是 / 改成 | `memory_search` → `memory_write` the same slug |
| 忘掉 / 作废 / forget | `memory_forget` |
| topic split | new slug + `memory_forget` the old one |

Confirm the slug you changed.

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

## Tools

`memory_index` · `memory_read` · `memory_search` · `memory_write` · `memory_forget`

`memory_write` args: `name` (slug), `description` (one-line summary; `title` also ok), `type` (`user` | `feedback` | `project` | `reference`), `body` (full text; `content` also ok). Confirm the returned index line. `memory_read` a topic slug from the index — not `MEMORY.md`.

## Consolidation (optional, owner-run)

Organize already happens at write, so you rarely need this. `memory_dream` (CLI: `node dist/cli.js dream --dry-run` from the project-memory checkout) is an escape hatch for manual housekeeping — rebuild index, drop empty topics, merge identical bodies. It is not part of the normal loop; do not auto-invoke it. Pinned topics (`pin: true`) are never touched.
