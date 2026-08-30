# The product is a project ledger, not agent memory

This repo is named project-memory, so a future reader will assume Claude-style auto-memory or Hermes-style self-evolving notes. It is neither. The product is a personal project notebook: durable facts as files in the project, empty-is-fine. Agent-private notes (`~/.claude/projects/…`) and idle/extract/auto-dream-apply loops were considered and rejected so the ledger cannot become a second session log. Git tracking is a separate decision — not what makes it a ledger.

Superseded in part by [0003](./0003-agent-facing-extract-and-dream.md) and [0006](./0006-agent-maintained-ledger-edits.md): extract and ledger edits no longer need per-op human approval. Hermes-style persona/skill evolution and background learning loops are still out.
