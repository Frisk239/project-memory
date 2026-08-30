import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { memoryDir } from "./paths.js";
import { BODY_DIVERGE, BODY_SIMILAR, TITLE_OVERLAP, bodyScore, titleScore } from "./similarity.js";
import { forgetEntry, listEntries, listIndex, rebuildIndex, writeEntry } from "./store.js";
import type { MemoryEntry } from "./types.js";

const EMPTY_BODY = 20;
const STALE_MS = 14 * 24 * 60 * 60 * 1000;
const LOCK_TTL_MS = 5 * 60 * 1000;
const LOCK_NAME = ".dream.lock";
const RELATIVE_DATE =
  /\b(yesterday|today|tomorrow|last\s+(night|week|month|year)|(?:a|\d+)\s+days?\s+ago)\b/i;
const TODO_OR_NEXT = /(?:^|\n)\s*(?:#{1,6}\s*)?(?:TODO|Next)\b/;

export type DreamOp = {
  op: "forget" | "merge" | "rebuild-index" | "conflict" | "stale" | "relative-date";
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

export function dreamLockPath(cwd?: string): string {
  return join(memoryDir(cwd), LOCK_NAME);
}

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
      if (entry.pin) continue;
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
    const drop = group.filter((entry) => entry.name !== keep && !entry.pin).map((entry) => entry.name);
    if (!drop.length) continue;
    ops.push({
      op: "merge",
      names: [keep, ...drop],
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
      const bodies = bodyScore(a.body, b.body);
      const titles = titleScore(a, b);
      if (bodies >= BODY_SIMILAR) {
        ops.push({
          op: "merge",
          names: [a.name, b.name],
          keep: pickKeep([a, b], index),
          reason: `similar bodies (${pct(bodies)}); needs a human/LLM merge of non-identical text`,
          safe: false,
        });
      } else if (titles >= TITLE_OVERLAP && bodies < BODY_DIVERGE && a.type === b.type) {
        ops.push({
          op: "conflict",
          names: [a.name, b.name],
          reason: `same topic-ish titles (${pct(titles)}) but different bodies (${pct(bodies)}); do not keep both if they disagree`,
          safe: false,
        });
      }
    }
  }

  for (const entry of entries) {
    if (TODO_OR_NEXT.test(entry.body) && topicAgeMs(entry.name, cwd) >= STALE_MS) {
      ops.push({
        op: "stale",
        names: [entry.name],
        reason: "TODO/Next section older than 14 days; review or drop — not auto-deleted",
        safe: false,
      });
    }
    if (RELATIVE_DATE.test(entry.body)) {
      ops.push({
        op: "relative-date",
        names: [entry.name],
        reason: "relative date wording; convert to an absolute date — not auto-edited",
        safe: false,
      });
    }
  }

  return dedupeOps(ops);
}

export function applyDream(opts: { cwd?: string; dryRun?: boolean } = {}): DreamReport {
  const cwd = opts.cwd;
  const dryRun = Boolean(opts.dryRun);
  const planned = planDream(cwd);

  if (dryRun) {
    return {
      dryRun: true,
      entryCount: listEntries(cwd).length,
      indexCount: listIndex(cwd).length,
      applied: [],
      proposed: planned,
    };
  }

  const release = acquireDreamLock(cwd);
  try {
    const applied: DreamOp[] = [];
    const proposed: DreamOp[] = [];
    const entrySnapshot = listEntries(cwd);
    const pinned = new Set(entrySnapshot.filter((entry) => entry.pin).map((entry) => entry.name));
    const byName = new Map(entrySnapshot.map((entry) => [entry.name, entry]));

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
        const names = op.names.filter((name) => !pinned.has(name));
        if (!names.length) continue;
        for (const name of names) forgetEntry(name, cwd);
        applied.push({ ...op, names });
        continue;
      }
      if (op.op === "merge" && op.keep) {
        if (!pinned.has(op.keep) && op.names.some((name) => name !== op.keep && pinned.has(name))) {
          proposed.push({ ...op, safe: false, reason: `${op.reason}; pinned names were left untouched` });
          continue;
        }
        const keep = byName.get(op.keep);
        if (keep) writeEntry(keep, cwd);
        const dropped: string[] = [];
        for (const name of op.names) {
          if (name === op.keep) continue;
          if (pinned.has(name)) continue;
          forgetEntry(name, cwd);
          dropped.push(name);
        }
        if (dropped.length) applied.push({ ...op, names: [op.keep, ...dropped] });
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
  } finally {
    release();
  }
}

export class DreamLockError extends Error {
  constructor(message = "dream already running (.memory/.dream.lock). retry after it finishes, or delete the lock if it is stuck.") {
    super(message);
    this.name = "DreamLockError";
  }
}

function acquireDreamLock(cwd?: string): () => void {
  const file = dreamLockPath(cwd);
  if (existsSync(file) && !lockIsStale(file)) {
    throw new DreamLockError();
  }
  // The lock lives in the ledger: creating it is a write, so an unresolvable
  // root must fail here, before the lock file lands in a guessed project.
  mkdirSync(memoryDir(cwd, { forWrite: true }), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ pid: process.pid, at: new Date().toISOString() })}\n`, "utf8");
  return () => {
    try {
      unlinkSync(file);
    } catch {
      /* already gone */
    }
  };
}

function lockIsStale(file: string): boolean {
  try {
    const raw = readFileSync(file, "utf8");
    const parsed = JSON.parse(raw) as { at?: string };
    const at = parsed.at ? Date.parse(parsed.at) : NaN;
    if (!Number.isFinite(at)) return true;
    return Date.now() - at > LOCK_TTL_MS;
  } catch {
    return true;
  }
}

function topicAgeMs(name: string, cwd?: string): number {
  try {
    const file = join(memoryDir(cwd), `${name}.md`);
    return Date.now() - statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

function pickKeep(group: MemoryEntry[], index: { name: string }[]): string {
  const pinned = group.filter((entry) => entry.pin);
  const pool = pinned.length ? pinned : group;
  const order = new Map(index.map((item, i) => [item.name, i]));
  // Newest rows sit at the front of MEMORY.md. Keep the oldest duplicate.
  return [...pool].sort((a, b) => (order.get(b.name) ?? -1) - (order.get(a.name) ?? -1))[0].name;
}

function exactDupDrop(ops: DreamOp[], name: string): boolean {
  return ops.some((op) => op.op === "merge" && op.safe && op.keep !== name && op.names.includes(name));
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
