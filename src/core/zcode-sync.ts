import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { topicSlug } from "./paths.js";
import { forgetEntry, listEntryFiles, readEntry, writeEntry } from "./store.js";
import { isMemoryType, type MemoryEntry, type MemoryType } from "./types.js";

/**
 * Bidirectional mirror between the canonical ledger (<root>/.memory) and the
 * owner's ZCode auto-memory for the same project
 * (~/.zcode/cli/memories/projects/<project>-<hash>/memory). The two stores
 * share one schema lineage — per-fact files with name/description/type — so
 * sync is a deterministic file mirror, not an LLM job:
 *
 * - Three-way reconcile against the last-sync snapshot (.memory/.sync-zcode.json):
 *   edit beats nothing, mtime breaks a true both-sides edit, deletions
 *   propagate only when the other side did not edit since the last sync.
 * - Pinned ledger topics are push-only: they reach ZCode, but a ZCode-side
 *   edit never overwrites the pinned original (reported as skipped instead).
 * - The ZCode-side pointer memory (project-memory-ledger.md) anchors repo →
 *   ZCode-dir discovery and doubles as the in-session hint that the ledger
 *   exists. It is excluded from mirroring.
 */

const POINTER_NAME = "project-memory-ledger";
const SNAPSHOT_NAME = ".sync-zcode.json";
const ZCODE_INDEX = "MEMORY.md";

export type SyncReport = {
  ledgerDir: string;
  zcodeDir: string;
  pushed: string[];
  pulled: string[];
  deletedLedger: string[];
  deletedZcode: string[];
  conflicts: string[];
  skippedPinned: string[];
  unreadable: string[];
  unchanged: number;
  dryRun: boolean;
};

type SideFile = {
  name: string;
  description: string;
  type: MemoryType;
  body: string;
  file: string;
  mtime: number;
  hash: string;
};

type Snapshot = {
  zcodeDir?: string;
  files?: Record<string, { ledger?: string; zcode?: string }>;
};

export function zcodeProjectsRoot(): string {
  return join(homedir(), ".zcode", "cli", "memories", "projects");
}

export function zcodeSyncSnapshotPath(ledgerDir: string): string {
  return join(ledgerDir, SNAPSHOT_NAME);
}

/**
 * Find this project's ZCode memory dir. Order: explicit flag, the last-sync
 * snapshot, a pointer memory containing the ledger path, then a unique
 * <basename>-<hash> directory match. The pointer is written on success so
 * later runs (and ZCode sessions themselves) can find the ledger.
 */
export function resolveZcodeMemoryDir(root: string, opts: { explicit?: string; snapshot?: Snapshot } = {}): string {
  if (opts.explicit) return opts.explicit;
  const ledgerDir = join(root, ".memory");
  if (opts.snapshot?.zcodeDir && existsSync(opts.snapshot.zcodeDir)) return opts.snapshot.zcodeDir;
  const projects = zcodeProjectsRoot();
  if (!existsSync(projects)) {
    throw new Error(`no ZCode memory projects dir at ${projects}. Use sync --zcode-dir <dir> to point at one.`);
  }
  const dirs = readdirSync(projects, { withFileTypes: true }).filter((ent) => ent.isDirectory()).map((ent) => ent.name);
  for (const dir of dirs) {
    const pointer = join(projects, dir, "memory", `${POINTER_NAME}.md`);
    if (existsSync(pointer) && readFileSync(pointer, "utf8").includes(ledgerDir)) {
      return join(projects, dir, "memory");
    }
  }
  const pattern = new RegExp(`^${escapeRegExp(basename(root))}-[0-9a-f]{6,}$`);
  const matches = dirs.filter((dir) => pattern.test(dir));
  if (matches.length === 1) return join(projects, matches[0], "memory");
  if (matches.length > 1) {
    throw new Error(`ambiguous ZCode project dirs for "${basename(root)}": ${matches.join(", ")}. Use sync --zcode-dir <dir>.`);
  }
  throw new Error(
    `cannot find a ZCode memory dir for ${root}. Open ZCode in this project once so it creates one, or use sync --zcode-dir <dir>.`,
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** One sync pass. Binds PROJECT_MEMORY_DIR to ledgerDir so store writes and
 * the index stay consistent, then restores it. */
export function syncZcodeMirror(opts: { ledgerDir: string; zcodeDir: string; dryRun?: boolean }): SyncReport {
  const previousDir = process.env.PROJECT_MEMORY_DIR;
  process.env.PROJECT_MEMORY_DIR = opts.ledgerDir;
  try {
    return syncUnbound(opts);
  } finally {
    if (previousDir === undefined) delete process.env.PROJECT_MEMORY_DIR;
    else process.env.PROJECT_MEMORY_DIR = previousDir;
  }
}

function syncUnbound(opts: { ledgerDir: string; zcodeDir: string; dryRun?: boolean }): SyncReport {
  mkdirSync(opts.zcodeDir, { recursive: true });
  const report: SyncReport = {
    ledgerDir: opts.ledgerDir,
    zcodeDir: opts.zcodeDir,
    pushed: [],
    pulled: [],
    deletedLedger: [],
    deletedZcode: [],
    conflicts: [],
    skippedPinned: [],
    unreadable: [],
    unchanged: 0,
    dryRun: Boolean(opts.dryRun),
  };
  const snapshot = loadSnapshot(opts.ledgerDir);
  const previous = snapshot.files ?? {};

  const ledger = new Map<string, SideFile>();
  for (const file of listEntryFiles()) {
    const entry = readEntry(basename(file, ".md"));
    if (!entry) continue;
    ledger.set(entry.name, toSide(entry.name, entry.description, entry.type, entry.body, join(opts.ledgerDir, file)));
  }
  const zcode = new Map<string, SideFile>();
  for (const file of listZcodeFiles(opts.zcodeDir)) {
    const path = join(opts.zcodeDir, file);
    const entry = parseZcodeFile(path);
    if (!entry) {
      report.unreadable.push(file);
      continue;
    }
    zcode.set(entry.name, entry);
  }

  const names = new Set([...ledger.keys(), ...zcode.keys(), ...Object.keys(previous)]);
  for (const name of names) {
    if (name === POINTER_NAME) continue;
    const l = ledger.get(name);
    const z = zcode.get(name);
    const prev = previous[name];
    reconcile(name, l, z, prev, report, opts);
  }

  if (!report.dryRun) {
    writeFileSync(
      zcodeSyncSnapshotPath(opts.ledgerDir),
      `${JSON.stringify({ zcodeDir: opts.zcodeDir, at: new Date().toISOString(), files: currentHashes(opts.ledgerDir, opts.zcodeDir, names) }, null, 2)}\n`,
      "utf8",
    );
    ensurePointer(opts.zcodeDir, opts.ledgerDir);
  }
  return report;
}

function reconcile(
  name: string,
  l: SideFile | undefined,
  z: SideFile | undefined,
  prev: { ledger?: string; zcode?: string } | undefined,
  report: SyncReport,
  opts: { ledgerDir: string; zcodeDir: string; dryRun?: boolean },
): void {
  const lChanged = Boolean(l && (!prev || prev.ledger !== l.hash));
  const zChanged = Boolean(z && (!prev || prev.zcode !== z.hash));

  if (l && z) {
    if (!lChanged && !zChanged) {
      report.unchanged += 1;
      return;
    }
    if (lChanged && zChanged) {
      // True both-sides edit since the last sync: newer mtime wins.
      if (l.mtime >= z.mtime) {
        report.conflicts.push(`${name} (ledger newer)`);
        push(name, l, report, opts);
      } else {
        report.conflicts.push(`${name} (zcode newer)`);
        pull(name, z, report, opts);
      }
      return;
    }
    if (lChanged) {
      push(name, l, report, opts);
      return;
    }
    // ZCode side changed. A pinned ledger topic is push-only: its content is
    // decided in the ledger, so the tampered mirror copy is repaired from the
    // ledger instead of pulled in.
    if (isPinned(name)) {
      report.skippedPinned.push(name);
      if (!report.dryRun) writeZcodeCopy(opts.zcodeDir, name, l);
      return;
    }
    pull(name, z, report, opts);
    return;
  }

  if (l && !z) {
    if (!prev?.zcode) {
      // Brand new on the ledger (or never synced): push it out.
      push(name, l, report, opts);
      return;
    }
    // Existed on both, now ZCode lost it. Propagate the delete unless the
    // ledger changed since the sync — an edit beats a deletion.
    if (lChanged || isPinned(name)) {
      push(name, l, report, opts);
      return;
    }
    if (!report.dryRun) forgetEntry(name);
    report.deletedLedger.push(name);
    return;
  }

  if (!l && z) {
    if (!prev?.ledger) {
      pull(name, z, report, opts);
      return;
    }
    if (zChanged) {
      pull(name, z, report, opts);
      return;
    }
    if (!report.dryRun) deleteZcodeTopic(opts.zcodeDir, name, z.file);
    report.deletedZcode.push(name);
  }
}

function push(name: string, l: SideFile, report: SyncReport, opts: { zcodeDir: string; dryRun?: boolean }): void {
  if (report.dryRun) {
    report.pushed.push(name);
    return;
  }
  writeZcodeCopy(opts.zcodeDir, name, l);
  upsertZcodeIndexLine(opts.zcodeDir, name, l.description);
  report.pushed.push(name);
}

function writeZcodeCopy(zcodeDir: string, name: string, l: SideFile): void {
  writeFileSync(join(zcodeDir, `${name}.md`), renderZcodeEntry({ name, description: l.description, type: l.type, body: l.body }), "utf8");
}

function pull(name: string, z: SideFile, report: SyncReport, opts: { ledgerDir: string; dryRun?: boolean }): void {
  if (report.dryRun) {
    report.pulled.push(name);
    return;
  }
  const previous = readEntry(name);
  writeEntry({
    name,
    description: z.description || name,
    type: z.type,
    body: z.body,
    origin: previous?.origin,
  });
  report.pulled.push(name);
}

function toSide(name: string, description: string, type: MemoryType, body: string, file: string): SideFile {
  return { name, description, type, body, file, mtime: fileMtime(file), hash: hashFile(file) };
}

function listZcodeFiles(zcodeDir: string): string[] {
  if (!existsSync(zcodeDir)) return [];
  return readdirSync(zcodeDir).filter(
    (file) => file.endsWith(".md") && file !== ZCODE_INDEX && file !== `${POINTER_NAME}.md`,
  );
}

function parseZcodeFile(path: string): SideFile | undefined {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return undefined;
  const front = match[1];
  const name = pickField(front, "name") || basename(path, ".md");
  const description = pickField(front, "description") || name;
  const typeRaw = pickField(front, "type") || "project";
  const type: MemoryType = isMemoryType(typeRaw) ? typeRaw : "project";
  const body = match[2].trim();
  return {
    name: topicSlug(name),
    description,
    type,
    body,
    file: path,
    mtime: fileMtime(path),
    hash: hashFile(path),
  };
}

function pickField(front: string, key: string): string | undefined {
  const match = front.match(new RegExp(`(?:^|\\n)\\s*${key}:\\s*(.+)$`, "m"));
  return match?.[1]?.trim();
}

function isPinned(name: string): boolean {
  const entry = readEntry(name);
  return Boolean(entry?.pin);
}

function renderZcodeEntry(entry: Pick<MemoryEntry, "name" | "description" | "type" | "body">): string {
  return `---
name: ${entry.name}
description: ${entry.description}
metadata:
  type: ${entry.type}
---

${entry.body.trim()}
`;
}

function upsertZcodeIndexLine(zcodeDir: string, name: string, description: string): void {
  const indexPath = join(zcodeDir, ZCODE_INDEX);
  const existing = existsSync(indexPath) ? readFileSync(indexPath, "utf8") : "# MEMORY.md\n";
  const lines = existing.split(/\r?\n/);
  const line = `- [${titleCase(name)}](${name}.md) — ${description}`;
  const index = lines.findIndex((entry) => entry.includes(`](${name}.md)`));
  if (index >= 0) lines[index] = line;
  else lines.push(line);
  writeFileSync(indexPath, lines.join("\n").replace(/\n{3,}/g, "\n\n"), "utf8");
}

function removeZcodeIndexLine(zcodeDir: string, name: string): void {
  const indexPath = join(zcodeDir, ZCODE_INDEX);
  if (!existsSync(indexPath)) return;
  const kept = readFileSync(indexPath, "utf8").split(/\r?\n/).filter((line) => !line.includes(`](${name}.md)`));
  writeFileSync(indexPath, kept.join("\n").replace(/\n{3,}/g, "\n\n"), "utf8");
}

function deleteZcodeTopic(zcodeDir: string, name: string, file: string): void {
  try {
    rmSync(file, { force: true });
  } catch {
    /* already gone */
  }
  removeZcodeIndexLine(zcodeDir, name);
}

function ensurePointer(zcodeDir: string, ledgerDir: string): void {
  const pointerPath = join(zcodeDir, `${POINTER_NAME}.md`);
  if (!existsSync(pointerPath)) {
    writeFileSync(
      pointerPath,
      renderZcodeEntry({
        name: POINTER_NAME,
        description: "This project's canonical agent ledger lives in the repo, not here",
        type: "reference",
        body:
          `The durable, cross-host ledger for this project is ${ledgerDir} (MEMORY.md index + one file per fact). ` +
          `Read it before non-trivial work; it is the source this mirror syncs from. ` +
          `Refresh the mirror with \`node dist/cli.js sync\` from the project-memory checkout.`,
      }),
      "utf8",
    );
  }
  upsertZcodeIndexLine(zcodeDir, POINTER_NAME, `Canonical ledger at ${ledgerDir}`);
}

function currentHashes(ledgerDir: string, zcodeDir: string, names: Set<string>): Record<string, { ledger?: string; zcode?: string }> {
  const files: Record<string, { ledger?: string; zcode?: string }> = {};
  for (const name of names) {
    if (name === POINTER_NAME) continue;
    const lPath = join(ledgerDir, `${name}.md`);
    const zPath = join(zcodeDir, `${name}.md`);
    const record: { ledger?: string; zcode?: string } = {};
    if (existsSync(lPath)) record.ledger = hashFile(lPath);
    if (existsSync(zPath)) record.zcode = hashFile(zPath);
    if (record.ledger || record.zcode) files[name] = record;
  }
  return files;
}

function loadSnapshot(ledgerDir: string): Snapshot {
  const path = zcodeSyncSnapshotPath(ledgerDir);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Snapshot;
  } catch {
    return {};
  }
}

function fileMtime(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

function hashFile(path: string): string {
  try {
    return createHash("sha1").update(readFileSync(path)).digest("hex");
  } catch {
    return "missing";
  }
}

function titleCase(name: string): string {
  return name.replace(/-/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export function formatSyncReport(report: SyncReport): string {
  const lines = [
    `[zcode-sync${report.dryRun ? " (dry-run)" : ""}] ledger=${report.ledgerDir} zcode=${report.zcodeDir}`,
  ];
  const section = (label: string, items: string[]) => {
    if (items.length) lines.push(`${label}: ${items.join(", ")}`);
  };
  section("push", report.pushed);
  section("pull", report.pulled);
  section("delete-ledger", report.deletedLedger);
  section("delete-zcode", report.deletedZcode);
  section("conflict-resolved", report.conflicts);
  section("skip-pinned", report.skippedPinned);
  section("unreadable", report.unreadable);
  lines.push(`unchanged: ${report.unchanged}`);
  return lines.join("\n");
}
