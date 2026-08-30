# Implementation plan: ZCode-shaped extract (write-time organize)

> **Superseded by `docs/tech-debt-and-roadmap.md` and the shipped implementation.** This file records the original slice plan only.

Dispatch this document to a new session. Product decisions are locked. Do not reopen them. Do not add a Dream job, sidecar extract runtime, doorbell, or auto-apply LLM merge.

Normative language: `CONTEXT.md`, `docs/adr/0001`–`0005`. If this plan and an ADR disagree, the ADR wins.

## Locked shape

Personal, agent-facing ledger at `<project>/.memory/`. Default gitignore. Owner switches **Kiro** and **OpenCode** on one machine. Empty ledger is normal.

| Piece | Behavior |
|---|---|
| **Extract** | After a successful round, the **main-session** consumer `memory_write`s durable facts. The owner does not have to say 记住. Stop / idle reminder. Not a sidecar model. |
| **Organize** | Happens **at write**. Same slug upserts. Index (`MEMORY.md`) updates in `writeEntry`. Near-duplicates of a *new* slug are refused (`SimilarTopicError`). |
| **Conflict** | New durable fact **disagrees** with an existing one → do **not** overwrite. **Both stay**. Same-session consumer **tells the owner**. Never pick a winner. |
| **Not this slice** | Gated Dream, per-turn consolidation LLM, ZCode `project_memory_extract` sidecar, team git wiki, Hermes loops, `/memory` UI, search snippets, slash-command expansion. |

`memory_dream` stays as a **CLI/MCP escape hatch** (dry-run default). Do not mention it as the happy path in skill/inject copy. Do not auto-invoke it.

Primary hosts: **Kiro** and **OpenCode**. Other installed hosts keep existing hooks; do not deepen them. Grok still has **no Stop reminder** (continuation loop).

## Already in the tree (do not rebuild)

- Markdown ledger: `.memory/*.md` + `MEMORY.md`, types `user | feedback | project | reference`.
- `saveEntry` / `writeEntry`: same-slug upsert; new slug close-topic → `SimilarTopicError`.
- Inject: `sessionContext` + `WRITE_RULES`; Stop reminder except Grok; OpenCode plugin injects every model call; idle is log-only.
- Kiro/OpenCode MCP + hooks install; skill at `skills/project-memory/SKILL.md`.
- Uncommitted (land in this work): `rememberRoot` / `~/.project-memory/last-root.txt` for cwd-less Kiro MCP; `src/paths.test.ts`; `cli.ts` stamping cwd on hook. See current git diff.

## Gap vs locked shape

1. **Conflict is not implemented.** `SimilarTopicError` refuses a *new similar slug*. Same-slug write **silently overwrites**, including disagreeing bodies. That violates “both stay / tell the owner”.
2. **Extract copy is still “when durable, you may write”.** Locked: you write without being asked, after a successful round. Skill still lists Dream as a primary flow and says “Never leave two entries that disagree.”
3. **`.memory/` is not default-gitignored.** First write / install with `--cwd` must ensure the project `.gitignore` contains `.memory/`.
4. **Kiro cwd-less MCP** must land (`rememberRoot`).
5. Docs/README still describe git-tracked ledger and `/memory-dream` as the organize path.

## Implementation order

Do these in order. Each slice should compile and `npm test` green before the next. Keep diffs scoped.

### Slice A — Land root cache (uncommitted)

**Files:** `src/core/paths.ts`, `src/hooks/protocol.ts`, `src/cli.ts`, `src/paths.test.ts`

Already drafted: hook with a cwd stamps `rememberRoot`; MCP with no cwd falls back to `~/.project-memory/last-root.txt` after git / `.memory` walk fail. Single-slot cache; document the two-project MCP-only limit in a short comment (already there). Tests: cache hit, missing cache, `PROJECT_MEMORY_ROOT` still wins.

**Done when:** `npm test` includes `paths.test.js`; Kiro MCP without cwd can read/write the last hooked project.

### Slice B — Conflict at write

**Files:** `src/core/similarity.ts` (reuse `BODY_SIMILAR`, `TITLE_OVERLAP`, `BODY_DIVERGE`), `src/core/store.ts`, `src/core/types.ts`, `src/mcp.ts`, `src/cli.ts`, `src/store.test.ts`

**Rules for `saveEntry`:**

| Incoming vs existing | Action |
|---|---|
| Same slug, bodies similar (`bodyScore >= BODY_SIMILAR`) or empty previous | Upsert (today). Keep `pin`. |
| Same slug, bodies **diverge** (`bodyScore < BODY_DIVERGE`) | **Conflict.** Do not overwrite. Persist incoming under a new slug `{name}-conflict` (or `{name}-conflict-2` if taken). Mark both. Return a structured result, not a silent write. |
| New slug, `isCloseTopic` and bodies similar | `SimilarTopicError` (today): tell writer to use the existing slug. |
| New slug, title-overlap and bodies **diverge** | **Conflict.** Write the new slug (both stay). Mark both. |
| New slug, not close | Create (today). |

**Marking:** add optional frontmatter on both files, e.g. `conflict: other-slug`. Index line prefix so the next session sees it without opening the file, e.g. `[conflict: foo] description…`. Pin: a pinned topic is never overwritten on conflict; incoming still gets the sibling file.

**MCP `memory_write`:** on conflict, `isError: false` (the write of the *new* file succeeded). Text must order the consumer to **tell the owner**, list both slugs, and **not pick a winner**. Distinct from `SimilarTopicError` (`isError: true`, “write that slug to update”).

**CLI `write`:** print the same instruction to stdout; exit 0 on conflict (new file written). Exit non-zero only on similar-topic refuse with no write.

**Tests (table-driven):**

- upsert same slug, similar body
- same slug, diverging body → old file bytes unchanged, new `*-conflict` file, both have `conflict:` frontmatter, index has two lines
- new slug close+similar → `SimilarTopicError`, no new file
- new slug title-overlap + diverging body → both files, marked
- pin + diverging same slug → pin file unchanged, sibling created
- MCP-shaped return string contains both slugs and “tell the owner”

Do not implement a later Dream scan. Do not auto-merge agreeing similar *different* slugs (that is Dream). Similar new slug still errors so the agent retries with the real slug (ZCode upsert).

### Slice C — Default-ignore `.memory/`

**Files:** new small helper e.g. `src/core/gitignore.ts`, called from `writeEntry` (first create of the dir) and from `installAgents` when `opts.cwd` is a git repo. Tests: `src/gitignore.test.ts`.

- If `.gitignore` missing, create with `.memory/` and a one-line comment.
- If present and no `.memory` rule, append `\n.memory/\n`.
- If already ignored (` .memory/`, `.memory`, `**/.memory/**` ), do nothing.
- Do not `git rm --cached`. Owner who already tracks files keeps them until they untrack.

Add `.memory/` to **this repo’s** `.gitignore` as well (dogfood).

### Slice D — Extract copy (main session, no sidecar)

**Files:** `src/hooks/context.ts`, `skills/project-memory/SKILL.md`, OpenCode plugin string in `src/install.ts` (only if it duplicates rules).

Rewrite `WRITE_RULES` / `WRITE_REMINDER` / skill so they match Extract:

- After a successful turn, if a durable fact appeared, `memory_write`. Do **not** wait for 记住 / remember.
- Same topic → same slug (organize at write).
- If `memory_write` returns similar-topic: retry **that** slug.
- If it returns **conflict**: tell the owner both slugs; do not merge; do not delete.
- Skip code, git, AGENTS.md, secrets. Empty ledger is fine.
- Remove or bury the Dream section as “optional CLI `node dist/cli.js dream --dry-run`”, not a trigger table row.

OpenCode: keep `experimental.chat.system.transform` inject (this **is** extract for OpenCode — no Stop). Do **not** turn `session.idle` into a writer. Idle stays log-only.

Kiro: existing Stop hook + SessionStart inject is enough. After Slice A, MCP writes hit the right root.

Grok: still no Stop; skill + SessionStart/PreCompact only.

### Slice E — Docs alignment

**Files:** `README.md`, `docs/roadmap.md` (note Phase 2/3 Dream UI is **not** this work), skill (Slice D).

README must say: project-local files, **gitignored by default**, shared by path not by git; extract after round in-session; organize at write; conflict tells the owner. Drop “plain files in the git repo” as the promise.

Do not rewrite `docs/auto-dream-design.md` into the product. Leave it or add one line at the top: superseded by ADR-0005.

## Out of scope (reject if they creep in)

- Sidecar / second model (`querySource: project_memory_extract` clone)
- Auto `applyDream` on Stop/idle/SessionStart
- Doorbell “run /memory-dream”
- OpenCode `/memory` `/remember` `/forget` as required
- `memory_search` snippets
- Supersede / audit trail
- Making all eight hosts first-class
- Vector DB, Mem0, writing AGENTS.md
- Changing the `.memory/` path to `~/.zcode/cli/memories/`

## Verify

```
npm test
```

Must include: `store`, `hooks`, `mcp-write`, `paths`, `gitignore` (new), existing `dream` tests still pass (escape hatch unchanged).

Manual (if hosts available):

1. OpenCode: finish a turn with a durable fact, no 记住 → `memory_write` appears; `.memory/` exists; `.gitignore` has `.memory/`.
2. Same slug update with similar wording → file replaced, one index line.
3. Same slug with opposite fact → original file unchanged, `*-conflict` created, agent text tells you.
4. Kiro: SessionStart injects index; Stop reminder; MCP write after a hook has stamped root.

## Dispatch prompt (paste into the other session)

```
Implement docs/implementation-plan.md in E:\code\project-memory.

Product is locked in CONTEXT.md and docs/adr/0001–0005. Do not reopen: no Dream job, no sidecar extract, no doorbell. Organize at write. Conflict = both stay, tell the owner.

Follow slices A→E in order. Land the uncommitted rememberRoot work first. npm test after each slice. Keep diffs scoped. Do not edit markdown the plan did not name except README/skill as in E/D.
```
