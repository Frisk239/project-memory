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
- **Organize at write** — the same topic reuses the same slug (upsert). A new slug too close to an existing topic is refused so the agent retries the right slug.
- **Conflict tells the owner** — when a new fact disagrees with an existing one, both entries stay and the agent tells you which two slugs disagree. It never picks a winner, merges, or deletes.

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
| ZCode | New session. Settings → Hooks should show `project-memory`. |
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
- **Skill** `project-memory`: when to read / write / correct, how conflict is handled, what not to store
- **`memory_dream`** stays as an optional CLI/MCP escape hatch (dry-run default) for manual housekeeping — not part of the normal loop

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
```

`dream` is an optional escape hatch: it rebuilds `MEMORY.md` from topic files, deletes empty entries, and merges **identical** bodies. Similar or conflicting topics are reported, never auto-merged. Organize already happens at write, so you rarely need this and nothing auto-invokes it.

## Uninstall

```bash
node dist/cli.js uninstall
node dist/cli.js uninstall --agents codex,kiro
```

Memory files in each project's `.memory/` stay until you delete them.

## License

MIT
