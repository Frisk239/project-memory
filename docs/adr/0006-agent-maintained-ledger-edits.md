# Agent-maintained ledger edits

The project ledger is primarily for agents to read and maintain. Updating or deleting a memory is not an owner-approval boundary.

When the live repo, current user instructions, or existing ledger evidence make a memory stale, wrong, incomplete, duplicate, or harmful to future sessions, the active agent may update it with `memory_write` on the same slug or delete it with `memory_forget`. The agent should ask the owner only when the evidence is insufficient, not merely because the operation edits memory.

The store still owns deterministic hygiene:

- Same slug replaces/upserts in place and refreshes `MEMORY.md`.
- A new slug too close to an existing topic is refused with `similar-topic`; the agent should reuse the existing slug for the same topic, or choose a clearly distinct slug.
- `memory_dream` applies only deterministic safe operations itself: index rebuild, empty-topic delete, and identical-body merge. Non-identical merges, stale notes, relative dates, and legacy conflict markers are reported for agent judgment, then resolved through ordinary `memory_write` / `memory_forget` calls when justified.
- `pin: true` protects against dream's automatic forget/merge, but explicit same-slug writes and `memory_forget` may still update or delete pinned topics.

Still out of scope: sidecar extraction, transcript mining, idle learning loops, persona memory, vector search, writing into AGENTS.md, and moving the store out of the checkout.
