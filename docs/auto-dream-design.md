# Auto-dream design — detect and prompt, human applies

> **Superseded by ADR-0005 (organize at write, no dream job).** The shipped product organizes at write and does not run a dream detection/prompt loop. `memory_dream` remains only as a manual CLI/MCP escape hatch. This document is kept for historical context; do not implement it.

Status: superseded. Extends the [roadmap](./roadmap.md); does not override it.

## The boundary this respects

The roadmap forbids one thing by name: **auto-dream that writes files with no confirmation**
("Do not build" and "Out of scope"). Dream mutates git-tracked files, so it "stays in the loop
with a person."

This design does **not** cross that line. Automation goes only as far as *detecting* that a dream
is worth running and *telling* the user. Every file mutation still waits for `/memory-dream`
(or an explicit `dream --apply`). Nothing writes behind the user's back.

So the split is:

| | Automated (no confirmation) | Human-gated (unchanged) |
|---|---|---|
| Rebuild index, drop empty, merge identical | detected & offered | applied on `/memory-dream` |
| Similar / conflict / stale / relative-date | detected & offered | resolved in-session by a person |
| The actual git file write | never | always |

The full dream feature stays exactly as complete as it is today. We are adding a *doorbell*, not
an autopilot.

## Why bother, if it never auto-applies

The one real cost of the current system: the user has to *remember* to run `/memory-dream`.
Nobody does, so index drift and duplicates accumulate silently. A cheap, gated detector that
surfaces "there are N safe fixes and M pairs to review, run `/memory-dream`" removes the
"remember to" without touching the safety model. This is the same shape the roadmap already
sanctions in Phase 2: "idle may *mention* that `.memory/` looks messy ... text only, no writes."

## What already exists (do not rebuild)

Most of the machinery is in the tree. The honest state:

| Layer | Where | Status |
|---|---|---|
| Deterministic safe ops | `applyDream()` in `src/core/dream.ts` | done — safe ops apply, non-safe become `proposed` |
| Pin protection | `dream.ts` (`isPinned`, `pickKeep`) | done — pinned entries never forgotten/merged away |
| Concurrency lock + stale TTL | `acquireDreamLock` / `lockIsStale` (`.memory/.dream.lock`, 5 min TTL) | done |
| Dry-run plan | `planDream()` + `dreamLockPath()` | done — `dream --dry-run` reports without touching files |
| Report formatting | `formatDreamReport()` | done |
| Similarity thresholds (reusable by a detector) | `src/core/similarity.ts` (`BODY_SIMILAR` etc.) | done |
| Hook wiring | `src/hooks/protocol.ts`, `context.ts` (Stop / PreCompact / SessionStart) | done — currently injects write-reminders only |

So "auto-dream" is not five layers of new code. It is **two small additions** on top of a nearly
complete dream: a gate, and a hook message that reads the gate.

## The five layers, mapped to reality

Numbered inner-to-outer. Only layers 3 and 4 are new work.

### Layer 1 — Safe kernel (exists)

Deterministic, lossless: rebuild index, drop empty, merge identical bodies, pin-protected.
This is `applyDream({ dryRun: false })` today. It is the *only* layer allowed to mutate, and only
when a human triggers it. No change.

### Layer 2 — Concurrency gate (exists, one gap to close)

`.memory/.dream.lock` with a 5-minute stale TTL already blocks two dreams from applying at once.

**Gap to verify, not assume:** the lock currently guards dream-vs-dream. It should also cover
dream-vs-`memory_write`, because opencode and kiro can share one `.memory/` and write while a
dream rewrites `MEMORY.md`. Action: confirm whether `saveEntry`/`writeEntry` respect the same
lock; if not, decide whether that is acceptable (writes are single-file + index rebuild, dream
rebuilds index at the end anyway) or whether the write path should take the lock too. Record the
decision — do not silently leave it ambiguous.

### Layer 3 — Trigger gate (new, cheap→expensive, clock-tolerant)

A `shouldSuggestDream(cwd)` predicate, checked in order of cost. Mirrors navi-core's 3-gate
auto-dream, but the outcome is a *suggestion*, never an apply.

1. **Time gate** — read `.memory/.last-dream` (a timestamp file). Suggest only if
   `>= MIN_HOURS` since the last dream (default 24h). **Clock tolerance:** a timestamp that is
   missing, unparseable, or in the future counts as "due" rather than trusting the clock — a
   drifted or reset clock must not permanently silence the doorbell (ponytail ceiling: wall-clock
   only; no monotonic source across process restarts).
2. **Change gate** — since `.last-dream`, has any `*.md` topic file changed (newest `mtime` in
   `.memory/` newer than `.last-dream`)? For a file-backed store this is the right analogue of
   navi's "N new sessions" — we care about new *memories*, not new chat sessions. No change → no
   suggestion.
3. **Cheap plan check** — run `planDream(cwd)` (already pure/read-only) and only suggest if it
   returns at least one op. If the ledger is already clean, stay silent even when time+change pass.

All three pass → emit a suggestion. `.last-dream` is stamped **when a dream actually applies**
(success or fail recorded), not when we merely suggest — otherwise one suggestion silences the
next day's check.

### Layer 4 — Trigger wiring (new, suggestion-only, flavor-aware)

Hook into the **SessionStart** injection path (`sessionContext` in `context.ts`), not Stop.

Rationale: the roadmap's sanctioned pattern is "mention on idle/session, text only." SessionStart
is where the index already gets injected, so appending one line costs nothing and blocks nothing.
Doing it at Stop risks the fire-and-forget-then-it-applies slippery slope we are explicitly
avoiding.

Behavior: if `shouldSuggestDream(cwd)` is true, append to the injected context:

> Project memory has N safe fixes and M pairs to review. Run `/memory-dream` to see them.

Constraints:

- **Flavor-aware.** `protocol.ts` already special-cases grok (Stop = "keep working") and
  antigravity (`decision: allow`). The suggestion rides SessionStart injection for all flavors,
  so it inherits the existing per-flavor formatting via `formatOutput`. It must never be phrased
  as an instruction to *do* work (would push grok to keep going).
- **cwd-less clients.** kiro/MCP may have no cwd; reuse the existing `rememberRoot` fallback used
  in `runHook`. Do not assume a cwd.
- **Prompt-cache safe.** The roadmap warns injected text must be byte-stable for cache hits. The
  suggestion line changes the injected string, so gate it: only append when the gate fires, and
  keep the wording free of timestamps/counts that churn every call. (If even N/M counts break the
  cache in practice, fall back to a fixed sentence with no numbers — decide during implementation
  by checking whether the count actually varies session-to-session.)

### Layer 5 — Human boundary (mostly exists)

- **Safe ops:** offered, applied on `/memory-dream`. After an apply, `formatDreamReport` already
  says what changed.
- **Semantic pairs:** stay `proposed`; resolved by a person in-session. Never auto-applied. No change.
- **Noise control (small addition):** the suggestion must not nag. Because the gate re-checks
  `.last-dream` + change + a non-empty plan, an ignored suggestion keeps showing until the user
  either dreams or the ledger stops drifting — acceptable, but if it proves annoying, add a
  "snoozed until" stamp so an ignored suggestion goes quiet for `MIN_HOURS`. Ship without the
  snooze first; add it only if real use nags.
- **Opt-out:** one env var or config flag to disable the suggestion entirely. Auto-*detection* is
  still an opinion being pushed at the user; they must be able to turn it off.

## Bad experiences this design defends against

Each defense maps to a layer, so we can point at where the guard lives.

| Risk | Guard | Layer |
|---|---|---|
| Silently changed/deleted memory | never auto-apply; semantic merges human-only; pin protection | 1, 5 |
| Blocking / slowing the turn | suggestion rides existing SessionStart inject; `planDream` is read-only; no sync dream | 3, 4 |
| Concurrent write corrupts files | file lock + TTL; verify write path coverage | 2 |
| Nagging | gate needs non-empty plan; optional snooze; opt-out | 3, 5 |
| Context / token bloat | one line, gated, no per-turn LLM call | 3, 4 |
| Clock drift / reset / suspend | missing/future/unparseable timestamp treated as "due" | 3 |
| Silent background failure | not applicable — nothing runs in the background; apply is foreground on `/memory-dream` | — |

## Fit with opencode and kiro

- **Shared `.memory/` across hosts** → the Layer-2 lock must be a cross-process file lock. It
  already is (`.memory/.dream.lock`). The write-path gap in Layer 2 matters most here, because two
  hosts on one repo is exactly the collision case.
- **Per-flavor Stop semantics** → Layer 4 rides SessionStart, not Stop, partly to sidestep grok's
  "Stop = keep working" contract. The suggestion never tells the agent to act.
- **kiro is MCP, may lack cwd** → reuse `rememberRoot`.
- **opencode `/memory-dream` stays the apply path** → manual and auto-suggested both funnel to the
  same command, the same lock, and the same `.last-dream` stamp. A manual dream must stamp
  `.last-dream` too, or the auto-detector will re-suggest right after a hand-run dream.

## What we are explicitly NOT doing

Restating, so the next reader does not "improve" this into the thing the roadmap forbids:

- No file mutation without `/memory-dream` (or explicit `dream --apply`).
- No auto-resolution of similar/conflict/stale/relative-date pairs.
- No Stop-hook fire-and-forget dream that applies.
- No background subagent, transcript mining, or per-turn LLM relevance calls.
- No timestamps baked into the always-injected index string.

## Implementation order (vertical, each ships alone)

1. **Layer 2 gap** — decide/confirm whether the write path shares the dream lock. Record the call.
   Smallest change; unblocks the concurrency story before anything auto-fires.
2. **Layer 3 gate** — `.last-dream` stamp on apply (in `applyDream`, both success and fail) +
   `shouldSuggestDream(cwd)` in `dream.ts`. One test: gate is false on a clean/just-dreamed ledger,
   true after a topic file changes past `MIN_HOURS`, and true when the timestamp is in the future.
3. **Layer 4 wiring** — append the gated line in `sessionContext`; keep it flavor-safe and
   cwd-less-safe. One test: suggestion appears only when the gate fires; wording contains no
   "keep working" phrasing.
4. **Layer 5 opt-out** — env/config flag to silence suggestions. Optional snooze only if use nags.

Tests live next to the change (`src/dream.test.ts`, `src/hooks` tests), asserts only, no new deps —
matching the repo's existing `node --test` setup.

## Open decisions for the owner

- Layer 2: is single-file-write-during-dream actually a corruption risk, or does the end-of-dream
  `rebuildIndex` make it moot? Confirm before adding lock overhead to the write path.
- Layer 3 default `MIN_HOURS` (24h like navi/Claude, or shorter for a fast-moving repo).
- Layer 4: fixed sentence vs. sentence-with-counts, decided by whether counts churn the prompt cache.
