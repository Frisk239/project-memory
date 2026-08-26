# Extract after every successful round; dream is gated

ZCode's runtime logs split this clearly: `memoryExtractionEnabled` is its own flag, and extract is a sidecar model call (`querySource: project_memory_extract`) after a turn, using `generateText` plus tools — not `main_turn`, not a second "dream" query source. Index maintenance rides that extract. There is no per-turn consolidation LLM in the logs.

We copy that cadence: extract after each successful round so Kiro and OpenCode can see new facts the same day. Semantic dream (agree-merge, conflict marks) stays behind a change-and-time gate; a second model call every turn would burn tokens and is not what ZCode does. Deterministic index rebuild is not dream — it belongs on the write/extract path.

Host mechanism (locked): we do **not** copy ZCode's in-process `project_memory_extract` sidecar. OpenCode/Kiro extract is the main session after the round (Stop / idle), via `memory_write`.

Superseded in part by [0005](./0005-organize-at-write-no-dream-job.md): the gated Dream job is out. Index update and same-topic merge ride the write.
