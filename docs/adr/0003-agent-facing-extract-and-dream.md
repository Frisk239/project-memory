# Agent-facing extract, dream, and ledger edits

The owner does not browse ledger files. After a successful round the consumer may extract durable facts without being asked. As of [0006](./0006-agent-maintained-ledger-edits.md), updating or deleting those ledger files is also agent-maintained: the agent may resolve stale, wrong, duplicate, or legacy conflict entries with `memory_write` / `memory_forget` when evidence is sufficient. Still out: Hermes standing-persona loops and writing into AGENTS.md.

Superseded in part by [0005](./0005-organize-at-write-no-dream-job.md) and [0006](./0006-agent-maintained-ledger-edits.md): there is no Dream job. Organize is write-time upsert, as in ZCode. The store no longer creates new conflict siblings; legacy conflict rows are ordinary housekeeping candidates for the agent.
