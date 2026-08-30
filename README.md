# project-memory

Project-scoped markdown memory shared across coding agents.

What one local IDE/CLI agent writes, the others can read. Storage is project-local plain files, **gitignored by default** — shared **by path**, not by git and not across machines. Switch between hosts on the same machine and same checkout and they see the same ledger because they resolve the same project root, not because it is committed.

```
<project-root>/.memory/    # gitignored on first write
  MEMORY.md     # index — injected at session start
  *.md          # one durable fact per file
```

On the first write into a git repo (and on install), `.memory/` is appended to that repo's `.gitignore`. Already-tracked files are left alone; untrack them yourself if you want them out.

Each checkout or Git worktree owns its local `.memory/` directory. To carry existing project memory into a new worktree, copy the entire `.memory/` directory from the source checkout into that worktree.

How it works:

- **Extract after a round** — after a successful turn, the in-session agent writes durable facts itself; you do not have to say 记住. No sidecar model, no background job.
- **Organize at write** — the same topic reuses the same slug (replace/upsert). A new slug too close to an existing topic is refused so the agent retries the right slug or chooses a distinct one.
- **Agent-maintained edits** — updating and deleting memories do not require owner approval. If repo evidence or current instructions make a note stale, wrong, or duplicate, the agent may `memory_write` the same slug or `memory_forget` it directly.

Requires **Node 20+**.

This repository is a local tool and is not published to npm. Run the checked-out build directly.

## Install

```bash
git clone <this-repo> project-memory
cd project-memory
npm install
node dist/cli.js install
node dist/cli.js doctor --selftest
```

`npm install` runs `tsc` via `prepare`. Install writes into **your user config**. Kiro also gets a workspace MCP entry at `<cwd>/.kiro/settings/mcp.json` with `PROJECT_MEMORY_ROOT=<cwd>`; this repo ignores that generated file by default.

Default agents: `opencode`, `zcode`, `codex`, `claude`, `kiro`, `commandcode`, `gemini` (Antigravity), `grok`.

Primary paths are Kiro and OpenCode. The other host adapters are best-effort local wiring: if that host's config directory does not exist, install skips it.

| After install | Do this |
|---|---|
| OpenCode | Restart. Index is injected into the system prompt (not the chat UI). |
| ZCode | New session. ZCode hooks are **optional**: the recommended wiring is the native auto-memory mirror — run `node dist/cli.js sync` from this checkout once per project (see below). |
| Codex | `/hooks` and trust the new commands. Codex uses `SessionStart` for context and one `Stop` continuation reminder for extraction. |
| Grok | `/hooks` and trust the new commands. Grok does **not** use a Stop write-reminder: its Stop `additionalContext` continues the turn. |
| Claude | New session. `/hooks` if you want to confirm. |
| Kiro | New session. User hooks in `~/.kiro/hooks/project-memory.json`; CLI `engineer` agent gets `agentSpawn` / `stop`. Enable MCP if prompted. |
| Command Code | New session. |
| Gemini / Antigravity | New session. Antigravity uses `PreInvocation` once per session. |

Optional: install one agent only.

```bash
node dist/cli.js install --agents opencode
node dist/cli.js install --agents kiro --cwd E:\code\your-project
```

## What gets installed

- **MCP** `project-memory`: `memory_index` / `memory_read` / `memory_search` / `memory_write` / `memory_forget` / `memory_list`
- **Hooks** (same semantics on every host, different Stop wiring):
  - **Read** at session start / resume / clear / compact (OpenCode: every model call, so the index stays in the rebuilt system prompt)
  - **Extract** after a successful round — durable facts only, organized at write. Claude/ZCode Stop and OpenCode idle say: if nothing durable, do nothing. Codex Stop blocks once with that reminder, then lets the turn end. OpenCode idle stays log-only. Grok omits Stop so the reminder cannot loop.
- **Skill** `project-memory`: when to read / write / correct / delete, and what not to store
- **`memory_dream`** stays as an optional CLI/MCP escape hatch (dry-run default) for housekeeping — not part of the normal loop
- **`sync`** (optional, ZCode only): two-way mirror between the repo ledger and ZCode's native auto-memory for the same project — see `docs/adr/0007-zcode-memory-mirror.md`. Run `node dist/cli.js sync` at a session boundary (`--dry-run` to preview). The ledger stays canonical; pinned topics are push-only.

## Usage

In any wired agent:

1. Start non-trivial work → `memory_index`, then `memory_read` a topic.
2. Write only facts a future session would otherwise re-learn.

Recalled ledger facts are snapshots. The live repo and current user instructions win if they disagree. Codex or ChatGPT native Memories, when enabled, are separate from this project-local ledger.

| type | write |
|---|---|
| `user` | identity, standing preferences |
| `feedback` | corrections about how the agent should work |
| `project` | goals, constraints, progress that is not in git |
| `reference` | external docs / URLs |

Do **not** write code structure, git history, or one-off session chatter.

Writes reject obvious secrets such as OpenAI keys, GitHub tokens, AWS access keys, and private key blocks. Redact first, then write the durable fact.

CLI (same store as MCP):

```bash
node dist/cli.js index
node dist/cli.js write --name slug --type project --description "one line" --body "Why / How to apply"
node dist/cli.js read slug
node dist/cli.js search keyword
node dist/cli.js forget slug
node dist/cli.js dream --dry-run
node dist/cli.js dream
node dist/cli.js sync
```

`dream` is an optional escape hatch: it rebuilds `MEMORY.md` from topic files, deletes empty entries, and merges **identical** bodies. Similar, stale, relative-date, or legacy conflict candidates are reported for agent judgment; the agent can then use `memory_write` / `memory_forget` directly when the evidence is sufficient. Organize already happens at write, so you rarely need this and nothing auto-invokes it.

### ZCode memory mirror (optional)

ZCode ships its own per-project auto-memory (`~/.zcode/cli/memories/projects/<project>-<hash>/memory/`) with the same schema lineage as this ledger. `node dist/cli.js sync` mirrors the repo ledger into it and back, so ZCode sessions see project memory natively without project-memory hooks:

- The repo ledger (`.memory/`) is the **only source of truth**; the ZCode copy is a regenerated mirror, never a second master.
- Sync is deterministic (no LLM, no background process): three-way reconcile against `.memory/.sync-zcode.json`. An edit beats an unchanged side, a true both-sides edit resolves by mtime, and a deletion propagates only when the other side did not edit since the last sync.
- Pinned topics (`pin: true`) are push-only — a ZCode-side edit is repaired from the ledger, never pulled in.
- First sync writes a `project-memory-ledger.md` pointer memory into the ZCode dir so future sessions (and later syncs) can find the ledger.
- Grok's native memory is **not** mirrored: it is freeform headings that Grok's auto-dream rewrites with an LLM, so round-tripping would sync dream's rewrites, not the ledger. Keep it as an export target only.

See `docs/adr/0007-zcode-memory-mirror.md` for the full decision.

## Uninstall

```bash
node dist/cli.js uninstall
node dist/cli.js uninstall --agents codex,kiro
```

Memory files in each project's `.memory/` stay until you delete them.

## License

MIT
