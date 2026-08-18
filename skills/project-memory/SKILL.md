---
name: project-memory
description: Shared project memory. Use after finishing a non-trivial task, when the user says remember/forget/记住/忘掉, or corrects a remembered fact (不对/其实是/作废). Also use at session start to read the index. Not every turn.
---

Write only when a future session would otherwise re-learn it. Not every turn.

## After a non-trivial task

If this turn finished a decision, constraint, or shipped status, `memory_write`. Update the same slug instead of duplicating. If nothing durable, skip.

## Correct

Recalled memories are snapshots and can be wrong. If the user contradicts one:

| they say | do |
|---|---|
| 不对 / 其实是 / 改成 | `memory_search` → `memory_write` the same slug |
| 忘掉 / 作废 / forget | `memory_forget` |
| topic split | new slug + `memory_forget` the old one |

Never leave two entries that disagree. Confirm the slug you changed.

## Types

| type | when_to_save |
|---|---|
| user | you learn who they are, their role, standing preferences |
| feedback | they correct you ("don't", "stop") OR confirm a non-obvious approach |
| project | goals, constraints, progress not in git; convert relative dates to absolute |
| reference | they point at an external URL, wiki, ticket, dashboard |

Skip: code structure, git history, AGENTS.md/CLAUDE.md, one-off chatter.

Body: the fact, **Why**, **How to apply**.

## Read

`memory_index` at session start / after compact. `memory_read` a topic before acting on it.

## Tools

`memory_index` · `memory_read` · `memory_search` · `memory_write` · `memory_forget`
