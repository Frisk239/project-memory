# Project ledger

A personal, agent-facing project notebook. The next host session on this machine reads the same files. The owner rarely opens them. An empty ledger is a valid state.

## Language

**Owner**:
The one person this tool is for — a developer switching hosts on their own repos. They correct by talking, not by browsing files.
_Avoid_: team, organization, plugin user, end user, human reader of the ledger

**Consumer**:
The coding agent in a later session on the same project. The ledger exists so that agent does not redo work, not so a human can study it.
_Avoid_: end user, documentation reader

**Ledger**:
The consumer's working notes for one project, stored as plain files in that project. Empty is normal. Gitignored by default; committing a file is opt-in.
_Avoid_: human handbook, team wiki, clone-shared wiki, persona memory, knowledge graph, vector memory

**Durable fact**:
Something a future session would otherwise have to redo: a finished decision, constraint, shipped status, research finding, an explicit remember, or a correction.
_Avoid_: session chatter, code structure, git history, standing agent persona

**Extract**:
After each successful round, the main-session consumer writes durable facts with `memory_write` (Stop / idle reminder). The owner does not have to say remember. Same-topic facts upsert the existing file and the index; that is Organize. Corrections still happen in the main session (不对 / 忘掉).
_Avoid_: transcript dump, idle learning loop, skill evolution, sidecar extract runtime, per-turn dream

**Organize**:
Happens at write, not as a later job. The writer reads the index, updates the matching slug, and refreshes `MEMORY.md`. Near-duplicates are refused. There is no Dream product surface.
_Avoid_: dream, consolidation pass, gated housekeeping LLM

**Conflict**:
A new durable fact that disagrees with an existing one. Write does not overwrite. Both stay; the same-session consumer tells the owner. It must not pick a winner.
_Avoid_: merge, overwrite, delete-the-loser, later dream scan
