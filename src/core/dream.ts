import { forgetEntry, listEntries, listIndex, rebuildIndex, writeEntry } from "./store.js";
import type { MemoryEntry } from "./types.js";

const EMPTY_BODY = 20;
const SIMILAR = 0.82;
const TITLE_OVERLAP = 0.55;
const BODY_DIVERGE = 0.35;

export type DreamOp = {
  op: "forget" | "merge" | "rebuild-index" | "conflict";
  names: string[];
  keep?: string;
  reason: string;
  safe: boolean;
};

export type DreamReport = {
  dryRun: boolean;
  entryCount: number;
  indexCount: number;
  applied: DreamOp[];
  proposed: DreamOp[];
};

export function planDream(cwd?: string): DreamOp[] {
  const entries = listEntries(cwd);
  const index = listIndex(cwd);
  const ops: DreamOp[] = [];
  const indexNames = new Set(index.map((item) => item.name));
  const fileNames = new Set(entries.map((entry) => entry.name));

  const missingFromIndex = [...fileNames].filter((name) => !indexNames.has(name));
  const missingFiles = [...indexNames].filter((name) => !fileNames.has(name));
  if (missingFromIndex.length || missingFiles.length) {
    ops.push({
      op: "rebuild-index",
      names: [...missingFromIndex, ...missingFiles],
      reason: `index drift: ${missingFromIndex.length} file(s) not in MEMORY.md, ${missingFiles.length} index row(s) with no file`,
      safe: true,
    });
  }

  const seenEmpty = new Set<string>();
  for (const entry of entries) {
    if (entry.body.trim().length < EMPTY_BODY) {
      seenEmpty.add(entry.name);
      ops.push({
        op: "forget",
        names: [entry.name],
        reason: "empty or trivial body",
        safe: true,
      });
    }
  }

  const byBody = new Map<string, MemoryEntry[]>();
  for (const entry of entries) {
    if (seenEmpty.has(entry.name)) continue;
    const key = entry.body.trim();
    const group = byBody.get(key) ?? [];
    group.push(entry);
    byBody.set(key, group);
  }
  for (const group of byBody.values()) {
    if (group.length < 2) continue;
    const keep = pickKeep(group, index);
    const drop = group.filter((entry) => entry.name !== keep).map((entry) => entry.name);
    ops.push({
      op: "merge",
      names: group.map((entry) => entry.name),
      keep,
      reason: `identical body; keep ${keep}, drop ${drop.join(", ")}`,
      safe: true,
    });
  }

  const remaining = entries.filter((entry) => !seenEmpty.has(entry.name) && !exactDupDrop(ops, entry.name));
  for (let i = 0; i < remaining.length; i += 1) {
    for (let j = i + 1; j < remaining.length; j += 1) {
      const a = remaining[i];
      const b = remaining[j];
      const bodyScore = jaccard(tokens(a.body), tokens(b.body));
      const titleScore = jaccard(tokens(`${a.name} ${a.description}`), tokens(`${b.name} ${b.description}`));
      if (bodyScore >= SIMILAR) {
        ops.push({
          op: "merge",
          names: [a.name, b.name],
          keep: pickKeep([a, b], index),
          reason: `similar bodies (${pct(bodyScore)}); needs a human/LLM merge of non-identical text`,
          safe: false,
        });
      } else if (titleScore >= TITLE_OVERLAP && bodyScore < BODY_DIVERGE && a.type === b.type) {
        ops.push({
          op: "conflict",
          names: [a.name, b.name],
          reason: `same topic-ish titles (${pct(titleScore)}) but different bodies (${pct(bodyScore)}); do not keep both if they disagree`,
          safe: false,
        });
      }
    }
  }

  return dedupeOps(ops);
}

export function applyDream(opts: { cwd?: string; dryRun?: boolean } = {}): DreamReport {
  const cwd = opts.cwd;
  const dryRun = Boolean(opts.dryRun);
  const planned = planDream(cwd);
  const applied: DreamOp[] = [];
  const proposed: DreamOp[] = [];

  if (dryRun) {
    return {
      dryRun: true,
      entryCount: listEntries(cwd).length,
      indexCount: listIndex(cwd).length,
      applied: [],
      proposed: planned,
    };
  }

  for (const op of planned) {
    if (!op.safe) {
      proposed.push(op);
      continue;
    }
    if (op.op === "rebuild-index") {
      rebuildIndex(cwd);
      applied.push(op);
      continue;
    }
    if (op.op === "forget") {
      for (const name of op.names) forgetEntry(name, cwd);
      applied.push(op);
      continue;
    }
    if (op.op === "merge" && op.keep) {
      const keep = listEntries(cwd).find((entry) => entry.name === op.keep);
      if (keep) writeEntry(keep, cwd);
      for (const name of op.names) {
        if (name !== op.keep) forgetEntry(name, cwd);
      }
      applied.push(op);
    }
  }

  rebuildIndex(cwd);
  return {
    dryRun: false,
    entryCount: listEntries(cwd).length,
    indexCount: listIndex(cwd).length,
    applied,
    proposed,
  };
}

function pickKeep(group: MemoryEntry[], index: { name: string }[]): string {
  const order = new Map(index.map((item, i) => [item.name, i]));
  // Newest rows sit at the front of MEMORY.md. Keep the oldest duplicate.
  return [...group].sort((a, b) => (order.get(b.name) ?? -1) - (order.get(a.name) ?? -1))[0].name;
}

function exactDupDrop(ops: DreamOp[], name: string): boolean {
  return ops.some((op) => op.op === "merge" && op.safe && op.keep !== name && op.names.includes(name));
}

function tokens(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/g).filter((part) => part.length > 2));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const item of a) if (b.has(item)) inter += 1;
  return inter / (a.size + b.size - inter);
}

function pct(score: number): string {
  return `${Math.round(score * 100)}%`;
}

function dedupeOps(ops: DreamOp[]): DreamOp[] {
  const seen = new Set<string>();
  const out: DreamOp[] = [];
  for (const op of ops) {
    const key = `${op.op}:${[...op.names].sort().join(",")}:${op.keep ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(op);
  }
  return out;
}

export function formatDreamReport(report: DreamReport): string {
  const lines = [
    `dream ${report.dryRun ? "(dry-run)" : "(applied)"}: ${report.entryCount} files, ${report.indexCount} index rows`,
  ];
  if (report.applied.length) {
    lines.push("applied:");
    for (const op of report.applied) lines.push(`  [${op.op}] ${op.names.join(", ")} — ${op.reason}`);
  }
  if (report.proposed.length) {
    lines.push("proposed (not applied; use /memory-dream or memory_write/forget):");
    for (const op of report.proposed) lines.push(`  [${op.op}] ${op.names.join(", ")} — ${op.reason}`);
  }
  if (!report.applied.length && !report.proposed.length) lines.push("nothing to do.");
  return lines.join("\n");
}
