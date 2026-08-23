# project-memory

Project-scoped markdown memory shared across coding agents.

What one agent writes, the others can read. Storage is plain files in the git repo:

```
<git-root>/.memory/
  MEMORY.md     # index — injected at session start
  *.md          # one durable fact per file
```

Requires **Node 20+**.

## Install

```bash
git clone <this-repo> project-memory
cd project-memory
npm install
node dist/cli.js install
node dist/cli.js doctor
```

`npm install` runs `tsc` via `prepare`. Install only writes into **your user config**.

Default agents: `opencode`, `zcode`, `codex`, `claude`, `kiro`, `commandcode`, `gemini` (Antigravity), `grok`.

| After install | Do this |
|---|---|
| OpenCode | Restart. Index is injected into the system prompt (not the chat UI). |
| ZCode | New session. Settings → Hooks should show `project-memory`. |
| Codex | `/hooks` and trust the new commands. |
| Grok | `/hooks` and trust the new commands. Grok does **not** use a Stop write-reminder: its Stop `additionalContext` continues the turn. |
| Claude | New session. `/hooks` if you want to confirm. |
| Kiro | New session. Enable MCP if prompted. |
| Command Code | New session. |
| Gemini / Antigravity | New session. Antigravity uses `PreInvocation` once per session. |

Optional: install one agent only.

```bash
node dist/cli.js install --agents opencode
```

## What gets installed

- **MCP** `project-memory`: `memory_index` / `memory_read` / `memory_search` / `memory_write` / `memory_forget` / `memory_list`
- **Hooks** (same semantics on every host, different Stop wiring):
  - **Read** at session start / resume / clear / compact (OpenCode: every model call, so the index stays in the rebuilt system prompt)
  - **Write** only when durable — not every turn. Claude/Codex/ZCode Stop and OpenCode idle say: if nothing durable, do nothing. Grok omits Stop so the reminder cannot loop.
- **Skill** `project-memory`: when to read / write / dream / what not to store
- **OpenCode** `/memory-dream`: consolidate `.memory/` (safe ops in CLI; semantic merge in-session)

## Usage

In any wired agent:

1. Start non-trivial work → `memory_index`, then `memory_read` a topic.
2. Write only facts a future session would otherwise re-learn.

| type | write |
|---|---|
| `user` | identity, standing preferences |
| `feedback` | corrections about how the agent should work |
| `project` | goals, constraints, progress that is not in git |
| `reference` | external docs / URLs |

Do **not** write code structure, git history, or one-off session chatter.

CLI (same store as MCP):

```bash
npx project-memory index
npx project-memory write --name slug --type project --description "one line" --body "Why / How to apply"
npx project-memory read slug
npx project-memory search keyword
npx project-memory forget slug
npx project-memory dream --dry-run
npx project-memory dream
```

`dream` rebuilds `MEMORY.md` from topic files, deletes empty entries, and merges **identical** bodies. Similar or conflicting topics are reported, not auto-merged (OpenCode `/memory-dream` does the LLM pass).

OpenCode: after `install --agents opencode`, run `/memory-dream` in the TUI.

## Uninstall (manual)

Remove the `project-memory` MCP entry, hooks, plugin, and skill copies from:

- `~/.config/opencode/`
- `~/.zcode/cli/config.json` and `~/.zcode/skills/project-memory/`
- `~/.codex/hooks.json`, `~/.codex/config.toml`, `~/.codex/skills/project-memory/`

Memory files in each project's `.memory/` stay until you delete them.

## License

MIT
