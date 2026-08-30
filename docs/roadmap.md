# Improvement roadmap

> **Superseded by `docs/tech-debt-and-roadmap.md`, ADR-0001–0007, and the shipped implementation.** The shipped shape is a project-local, **gitignored-by-default** ledger shared **by path**, with **organize at write** and **agent-maintained updates/deletes**. Extract happens in-session after a round (no sidecar). Conflict-sibling / owner-arbitration language below is historical and superseded by ADR-0006. The Phase 2/3 `/memory` `/remember` UI, search snippets, supersede/audit trail, and any auto-dream loop below are **not** this work — treat them as ideas, not commitments. Where this doc says "in git", read "shared by path, gitignored by default".

Project-scoped development ledger, shared by path (gitignored by default). OpenCode and Kiro are the primary hosts.

This is not a plan to give OpenCode Hermes-style auto-memory or self-evolving skills. Memory is a **project notebook** the next session (and other agents, and humans) can read. Empty `.memory/` is normal.

## Product boundary

| | Hermes / hermes-memory | Claude auto-memory / kuitos | This repo |
|---|---|---|---|
| Whose memory | The agent's (persona, standing rules, failure lessons, skill evolution) | The agent's private notes about a project | The **project's** development notes |
| Where | `~/.config/opencode/memory/` | `~/.claude/projects/…` | `<git-root>/.memory/` (in git) |
| Who writes | Idle / compact / bash-error loops | Post-session extraction | Explicit `memory_write` when a future session would otherwise redo the work |

Operating loop (keep):

- **Write** — durable facts only: finished decision, constraint, shipped status, research finding, user said remember, or a correction. Same topic → same slug. Skip code structure, git history, AGENTS.md, one-off chatter.
- **Read** — inject the index; `memory_read` a topic before acting on it. Do not auto-stuff full bodies into the turn.
- **Dream** — optional `/memory-dream` escape hatch. Code applies deterministic safe ops only; semantic candidates are left for the active agent to resolve with `memory_write` / `memory_forget` when evidence is sufficient.

## Do not build

These optimize “the agent gets smarter by itself.” They turn `.memory/` into a second session log.

**Product lines**

- Hermes / `opencode-hermes-memory`: `STANDING.md`, idle summarization, bash-failure prefetch, per-turn relevance injection, `history.md` as persona evolution
- Mem0 Synthesis / user profiling
- Auto-evolving skills or writing into AGENTS.md (this project already skips AGENTS.md)

**Mechanisms** (even when they sit on a “project memory” repo)

- Post-session auto-extraction (kuitos)
- Auto-dream that writes files once 24h + N sessions pass, with no confirmation
- Session-transcript mining into memory
- Per-turn injection of “relevant” full topic files (index injection is enough)
- Vector DB, 20 MCP tools, knowledge graphs
- Global `USER.md` as the primary store
- Idle learning loops, failure prefetch, auto-extract, “2 memories per turn”

The OpenCode plugin stays an **injector**. `session.idle` stays “if nothing durable, do nothing.” Do not turn it into a learning loop.

## Borrow only the ledger-shaped pieces

Already in place — keep:

- Claude file contract: `MEMORY.md` is an index, one topic per file, types `user` / `feedback` / `project` / `reference`, index capped at 200 lines / 25KB
- Write discipline in the skill and hook text
- Dream split: deterministic safe ops vs LLM merge vs report conflicts
- OpenCode: index in the system prompt + `/memory-dream`
- Compact flush, then re-read the index

Worth copying, narrowly:

| Source | Copy | Why it fits a git ledger |
|---|---|---|
| [jl-cmd/claude-dream](https://github.com/jl-cmd/claude-dream) | Audit → propose → execute → verify | Semantic ledger edits need evidence first |
| Claude dream (cheap rules only) | Relative dates → absolute; stale TODO/Next flagged | Notes expire; this is not personality synthesis |
| [transportrefer/opencode-memory-plugin](https://github.com/transportrefer/opencode-memory-plugin) | Memory is advisory; repo + current instructions win; no secrets | Dev notes must not outrank the tree |
| same | `/memory` `/remember`; if the agent writes, say what it saved | The agent-facing ledger should be visible, not chatty |
| Engram `mem_suggest_topic_key` | On write, surface existing similar slugs | Cuts dupes without a background job |
| Mem0 pin; optional supersede | Pin “this repo uses pnpm”; voided facts leave a trace | Auditable ledger, not Hermes `history.md` |
| Engram progressive disclosure | Search returns a one-line snippet; full body via `memory_read` | Index stays thin |
| OpenCode prompt-cache lesson | Injected text must be stable; no per-turn timestamps in the system prompt | Cache, not learning |

## Current state (2026-08-23)

Phase 1 (ledger hygiene) is in the tree.

| Surface | Today |
|---|---|
| Store | `.memory/MEMORY.md` + one markdown file per slug, gitignored by default. `saveEntry` organizes at write: same slug replaces/upserts; a new slug close to an existing topic is refused so the agent reuses the existing slug or picks a distinct name. Legacy conflict markers can still be read and cleaned. |
| MCP / CLI | `memory_index` / `read` / `search` / `write` / `forget` / `list` / `dream`. Write accepts `pin`. |
| Dream | Rebuild index, drop empty, merge identical bodies. Similar/legacy-conflict/stale TODO/relative dates are reported for agent judgment. Pin is never forgotten or merged away by dream. Apply takes `.memory/.dream.lock`. |
| OpenCode | Thin plugin injects index every model call; idle only logs; command `/memory-dream` |
| Inject / skill | Recalled facts are snapshots; live repo and current instructions win; no secrets. Index text has no per-turn timestamps. |

## Phases

Each phase is a vertical cut that can ship alone. Do not pull later-phase work forward. OpenCode first; MCP/CLI keep the same store.

### Phase 1 — Ledger hygiene

Stop dupes at write time. Make dream safe to run against git.

1. **Similar-slug hint on `memory_write`**
   - Before create, score name / description / body against existing entries (reuse dream’s Jaccard, or the same thresholds).
   - If a close slug exists and the writer did not pass that name, return the candidates and do not create a second file. Updating the named slug still overwrites as today.
   - Touch: `src/core/store.ts` or a small helper next to `dream.ts`; `src/mcp.ts`; tests.

2. **Pin**
   - Frontmatter `pin: true` (or equivalent). Dream never forgets/merges a pinned entry away. Index still lists it.
   - Touch: `src/core/types.ts`, `store.ts`, `dream.ts`, skill.

3. **Dream lock**
   - Per-repo lock file under `.memory/` while apply runs. Second apply fails clearly. Stale lock expires.
   - Touch: `src/core/dream.ts`.

4. **Cheap dream rules (propose only unless identical/empty)**
   - Relative dates in bodies → absolute dates (LLM pass inside `/memory-dream`, or a conservative regex for obvious cases).
   - Flag `TODO` / `Next` older than 14 days as stale. Do not auto-delete.
   - Touch: `dream.ts` + `adapters/opencode/commands/memory-dream.md`.

5. **Advisory + secrets in the injected rules**
   - One short paragraph: recalled facts are snapshots; live repo and current user instructions win; never store secrets.
   - Touch: `src/hooks/context.ts`, `skills/project-memory/SKILL.md`.
   - Do not add timestamps to the injected index.

**Done when:** writing a near-duplicate is rejected or redirected to the existing slug; `/memory-dream` cannot clobber a pin; two concurrent dreams cannot both apply; skill/inject text states advisory + no secrets.

### Phase 2 — OpenCode as a ledger UI

Better commands and search. Plugin does not start learning.

1. **Slash commands** (same pattern as `memory-dream.md`)
   - `/memory` — show index
   - `/remember` — write (args = fact)
   - `/forget` — forget or supersede a slug
   - Keep `/memory-dream` as dry-run-by-default; `apply` runs deterministic safe ops, and semantic candidates are resolved by the agent through normal write/forget tools.

2. **Search returns a snippet**
   - `memory_search` includes ~1 sentence of body, not only `name — description`.
   - Full text still `memory_read`.

3. **Say what you saved**
   - Skill: if the agent writes without the user saying 记住, it reports the slug it wrote.
   - No extra daemon.

4. **Plugin stays injector**
   - `experimental.chat.system.transform`: splice a **stable** index snapshot. Do not put `updated:` timestamps in that string.
   - `session.idle`: keep “nothing durable → do nothing.” No extraction, no auto-dream.
   - Optional later: idle may *mention* that `.memory/` looks messy and `/memory-dream` exists — text only, no writes.

**Done when:** OpenCode can list / write / forget / dream from slash commands; search hits are skimmable; injected prompt text is byte-stable for a given index.

### Phase 3 — Audit trail (optional)

Only if Phase 1–2 are in use and hard `forget` is losing history people wanted.

1. **Supersede instead of silent delete**
   - `memory_forget` (or a new `memory_supersede`) marks `status: superseded`, links to the replacement slug, drops the row from the default index.
   - File stays until a later dream or an explicit hard delete.
   - Default `memory_index` / inject lists **active** only.
   - This is an audit trail for project facts, not Hermes `history.md`.

2. **`created` / `updated` in topic files only**
   - Allowed on disk. Forbidden in the injected index string.

**Done when:** voiding a fact does not require deleting the file; the index a session sees is active-only.

### Out of scope (do not schedule)

- Idle / compact / tool-error learning loops
- Post-session forked extraction
- Auto-dream apply without confirmation
- Transcript grep → `memory_write`
- Per-turn relevant-body injection
- Vector search
- Promoting memory into AGENTS.md or skills
- Moving the store out of git into `~/.config`
- Splitting `user` type into a global USER.md — keep `user` / `feedback` entries rare and project-relevant; do not build a persona layer

## Implementation notes

- Primary host: OpenCode. Other agents keep the same MCP/store; do not add host-specific learning.
- Safe dream ops stay in CLI/MCP (`dryRun` default true). Semantic merge stays in-session.
- Prefer extending `src/core/dream.ts` and `src/core/store.ts` over new packages.
- Tests next to the change (`src/dream.test.ts`, `src/store.test.ts`, write-path tests).
- Skill and OpenCode command markdown are part of the product, not afterthoughts.

## Suggested order of work

1. Phase 1.1 similar-slug hint + tests
2. Phase 1.2–1.3 pin + lock
3. Phase 1.4–1.5 dream command + advisory text
4. Phase 2 slash commands + search snippet
5. Phase 3 only after the ledger is in daily use
