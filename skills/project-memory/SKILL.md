---
name: project-memory
description: Shared project memory. MUST USE after finishing a non-trivial task (decision, constraint, shipped status), when the user says remember/forget/记住, corrects you, or confirms an approach. Also use at session start to read the index.
---

You write memories yourself with `memory_write`. Do not wait to be asked.

## After a non-trivial task

Before you stop: if a future session would otherwise re-learn this, `memory_write` now. Update the same slug instead of duplicating.

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
