# Organize at write; no Dream job

ZCode has no separate consolidation query. After each successful turn a sidecar extract reads the index, upserts same-topic files, and rewrites `MEMORY.md`. We copy that policy, not the sidecar runtime: the main-session agent calls `memory_write`; the store upserts by slug, refuses near-duplicates, and updates the index.

Superseded in part by [0006](./0006-agent-maintained-ledger-edits.md): same-slug writes now replace in place even when the body changes materially. A new slug too close to an existing topic is refused with `similar-topic`, so the agent can reuse the existing slug or choose a distinct one. The store no longer creates conflict siblings that require owner arbitration. A later Dream pass was considered and rejected so we do not grow a second product surface ZCode does not have; manual `memory_dream` remains a CLI/MCP housekeeping escape hatch.
