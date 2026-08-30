import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { ensureGitignored, isGitRepo } from "./gitignore.js";
import { entryPath, indexPath, memoryDir, slugify, topicSlug } from "./paths.js";
import { isCloseTopic } from "./similarity.js";
import { isMemoryType, type MemoryEntry, type MemoryIndexItem, type MemoryType } from "./types.js";

const INDEX_LINE_LIMIT = 200;
const INDEX_BYTE_LIMIT = 25 * 1024;
const STORE_LOCK_NAME = ".store.lock";
const STORE_LOCK_TTL_MS = 30_000;
const STORE_LOCK_WAIT_MS = 2_000;

let activeLock: string | undefined;
let activeLockDepth = 0;

export function listIndex(cwd?: string): MemoryIndexItem[] {
  const file = indexPath(cwd);
  if (!existsSync(file)) return [];
  const items: MemoryIndexItem[] = [];
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^- \[([^\]]+)\]\(([^)]+)\)\s*—\s*(.*)$/);
    if (!match) continue;
    const rawDesc = match[3].trim();
    const conflict = rawDesc.match(/^\[conflict:\s*([^\]]+)\]\s*(.*)$/);
    items.push({
      name: match[2].replace(/\.md$/i, ""),
      description: (conflict ? conflict[2].trim() : rawDesc) || match[1],
      conflictWith: conflict ? conflict[1].trim() : undefined,
    });
  }
  return items;
}

export function readIndexText(cwd?: string): string {
  const file = indexPath(cwd);
  if (!existsSync(file)) return "";
  return capIndex(readFileSync(file, "utf8"));
}

export function readEntry(name: string, cwd?: string): MemoryEntry | null {
  const file = entryPath(name, cwd);
  if (!existsSync(file)) return null;
  return parseEntry(readFileSync(file, "utf8"), topicSlug(name));
}

export class SimilarTopicError extends Error {
  readonly candidates: MemoryIndexItem[];

  constructor(candidates: MemoryIndexItem[]) {
    const names = candidates.map((item) => item.name).join(", ");
    super(
      `similar topic already exists: ${names}. write that slug to update, or pick a more distinct name.`,
    );
    this.name = "SimilarTopicError";
    this.candidates = candidates;
  }
}

export class StoreLockError extends Error {
  constructor(message = "project memory store is busy (.memory/.store.lock). retry after the active write finishes, or delete the lock if it is stale.") {
    super(message);
    this.name = "StoreLockError";
  }
}

export class UnsafeMemoryEntryError extends Error {
  constructor(kind: string) {
    super(`refusing to write memory because it looks like it contains a secret (${kind}). Remove or redact the secret, then write again.`);
    this.name = "UnsafeMemoryEntryError";
  }
}

export function writeEntry(entry: MemoryEntry, cwd?: string): MemoryEntry {
  return withStoreLock(cwd, () => writeEntryUnlocked(entry, cwd));
}

function writeEntryUnlocked(entry: MemoryEntry, cwd?: string): MemoryEntry {
  const name = slugify(entry.name);
  assertSafeEntry(entry);
  const previous = readEntry(name, cwd);
  const saved: MemoryEntry = {
    ...entry,
    name,
    description: oneLine(entry.description),
    origin: entry.origin ? oneLine(entry.origin) : undefined,
    pin: entry.pin ?? previous?.pin,
    conflictWith: entry.conflictWith,
  };
  writeFileAtomic(entryPath(name, cwd), renderEntry(saved));
  upsertIndex(saved, cwd);
  return saved;
}

export type SaveResult = MemoryEntry;

/**
 * Create or update, organizing at write.
 * - Same slug → upsert/replace in place (keep pin unless explicitly changed).
 * - New slug close to an existing topic → SimilarTopicError (reuse that slug
 *   to update, or pick a more distinct name).
 * - New slug, not close → create.
 *
 * Updating or deleting memory is an agent judgment, not a human approval
 * boundary. The store stays deterministic: it prevents accidental duplicate
 * topics, but it does not create new conflict siblings that require a person
 * to arbitrate later.
 */
export function saveEntry(entry: MemoryEntry, cwd?: string): SaveResult {
  return withStoreLock(cwd, () => saveEntryUnlocked(entry, cwd));
}

function saveEntryUnlocked(entry: MemoryEntry, cwd?: string): SaveResult {
  const name = slugify(entry.name);
  const existing = readEntry(name, cwd);
  if (existing) return writeEntry(entry, cwd);

  // New slug: check nearby topics.
  const entries = listEntries(cwd);
  if (!existsSync(entryPath(name, cwd))) {
    const hits = entries.filter((existingEntry) => isCloseTopic(entry, existingEntry));
    if (hits.length) {
      throw new SimilarTopicError(hits.map((item) => ({ name: item.name, description: item.description })));
    }
  }
  return writeEntry(entry, cwd);
}

/** On first ledger create, gitignore .memory/ in the repo that owns it. */
function ensureLedgerIgnored(memDir: string): void {
  // PROJECT_MEMORY_DIR can point the ledger anywhere; only ignore when the
  // parent is a real git repo. Best-effort: never block a write on this.
  if (process.env.PROJECT_MEMORY_DIR) return;
  const root = dirname(memDir);
  try {
    if (isGitRepo(root)) ensureGitignored(root);
  } catch {
    /* gitignore is best-effort */
  }
}

export function forgetEntry(name: string, cwd?: string): boolean {
  // Deleting is a write: refuse an unresolvable root rather than unlink in a
  // guessed project.
  const file = entryPath(name, cwd, { forWrite: true });
  if (!existsSync(file)) return false;
  return withStoreLock(cwd, () => {
    if (!existsSync(file)) return false;
    const forgotten = slugify(name);
    unlinkSync(file);
    // Clear dangling conflict: pointers so the index does not keep [conflict: deleted].
    for (const entry of listEntries(cwd)) {
      if (entry.conflictWith !== forgotten) continue;
      writeFileAtomic(entryPath(entry.name, cwd), renderEntry({ ...entry, conflictWith: undefined }));
    }
    const items = listIndex(cwd)
      .filter((item) => item.name !== forgotten)
      .map((item) => (item.conflictWith === forgotten ? { ...item, conflictWith: undefined } : item));
    writeIndex(items, cwd);
    return true;
  });
}

export function searchEntries(query: string, cwd?: string): MemoryIndexItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return listIndex(cwd);
  const hits: MemoryIndexItem[] = [];
  for (const item of listIndex(cwd)) {
    const entry = readEntry(item.name, cwd);
    const hay = `${item.name}\n${item.description}\n${entry?.body ?? ""}`.toLowerCase();
    if (hay.includes(needle)) hits.push(item);
  }
  return hits;
}

function upsertIndex(entry: MemoryEntry, cwd?: string): void {
  const items = listIndex(cwd).filter((item) => item.name !== entry.name);
  items.unshift({ name: entry.name, description: entry.description, conflictWith: entry.conflictWith });
  writeIndex(items, cwd);
}

function writeIndex(items: MemoryIndexItem[], cwd?: string): void {
  withStoreLock(cwd, () => writeIndexUnlocked(items, cwd));
}

function writeIndexUnlocked(items: MemoryIndexItem[], cwd?: string): void {
  const lines = renderIndexLines(items);
  writeFileAtomic(indexPath(cwd), lines.join("\n"));
}

function indexLine(item: MemoryIndexItem): string {
  // A conflicting topic is flagged in the description so the next session sees
  // it without opening the file. The link text/target stay the plain slug.
  const desc = item.conflictWith ? `[conflict: ${item.conflictWith}] ${item.description}` : item.description;
  return `- [${titleCase(item.name)}](${item.name}.md) — ${desc}`;
}

function capIndex(text: string): string {
  const lines = text.split(/\r?\n/);
  const kept: string[] = [];
  let omitted = 0;
  for (const line of lines) {
    const candidate = [...kept, line].join("\n");
    if (kept.length + 1 > INDEX_LINE_LIMIT || Buffer.byteLength(candidate, "utf8") > INDEX_BYTE_LIMIT) {
      omitted += 1;
      continue;
    }
    kept.push(line);
  }
  if (omitted) {
    const marker = `- (+${omitted} more index lines; run node dist/cli.js dream --dry-run)`;
    while (
      kept.length + 1 > INDEX_LINE_LIMIT ||
      Buffer.byteLength([...kept, marker].join("\n"), "utf8") > INDEX_BYTE_LIMIT
    ) {
      if (!kept.length) break;
      kept.pop();
      omitted += 1;
    }
    kept.push(`- (+${omitted} more index lines; run node dist/cli.js dream --dry-run)`);
  }
  return kept.join("\n");
}

function renderIndexLines(items: MemoryIndexItem[]): string[] {
  const allRows = items.map(indexLine);
  let keptCount = allRows.length <= INDEX_LINE_LIMIT - 3 ? allRows.length : INDEX_LINE_LIMIT - 4;
  let omitted = allRows.length - keptCount;
  let lines = buildIndexLines(allRows.slice(0, keptCount), omitted);
  while (
    (lines.length > INDEX_LINE_LIMIT || Buffer.byteLength(lines.join("\n"), "utf8") > INDEX_BYTE_LIMIT) &&
    keptCount > 0
  ) {
    keptCount -= 1;
    omitted = allRows.length - keptCount;
    lines = buildIndexLines(allRows.slice(0, keptCount), omitted);
  }
  return lines;
}

function buildIndexLines(rows: string[], omitted: number): string[] {
  const lines = ["# MEMORY.md", "", ...rows];
  if (omitted > 0) lines.push(`- (+${omitted} more topics; run node dist/cli.js dream --dry-run)`);
  lines.push("");
  return lines;
}

function withStoreLock<T>(cwd: string | undefined, fn: () => T): T {
  const dir = memoryDir(cwd, { forWrite: true });
  const firstCreate = !existsSync(dir);
  mkdirSync(dir, { recursive: true });
  if (firstCreate) ensureLedgerIgnored(dir);
  const lockPath = join(dir, STORE_LOCK_NAME);
  const previousDir = process.env.PROJECT_MEMORY_DIR;

  if (activeLock === lockPath) {
    activeLockDepth += 1;
    process.env.PROJECT_MEMORY_DIR = dir;
    try {
      return fn();
    } finally {
      activeLockDepth -= 1;
      restoreMemoryDir(previousDir);
    }
  }

  const release = acquireStoreLock(lockPath);
  activeLock = lockPath;
  activeLockDepth = 1;
  process.env.PROJECT_MEMORY_DIR = dir;
  try {
    return fn();
  } finally {
    activeLockDepth = 0;
    activeLock = undefined;
    restoreMemoryDir(previousDir);
    release();
  }
}

function acquireStoreLock(lockPath: string): () => void {
  const deadline = Date.now() + STORE_LOCK_WAIT_MS;
  while (true) {
    try {
      const fd = openSync(lockPath, "wx");
      writeFileSync(fd, `${JSON.stringify({ pid: process.pid, at: new Date().toISOString() })}\n`, "utf8");
      closeSync(fd);
      return () => {
        try {
          unlinkSync(lockPath);
        } catch {
          /* already gone */
        }
      };
    } catch (error) {
      if (!isFileExistsError(error)) throw error;
      if (storeLockIsStale(lockPath)) {
        try {
          unlinkSync(lockPath);
        } catch {
          /* another process may have won */
        }
        continue;
      }
      if (Date.now() >= deadline) throw new StoreLockError();
      sleepSync(25);
    }
  }
}

function storeLockIsStale(lockPath: string): boolean {
  try {
    const parsed = JSON.parse(readFileSync(lockPath, "utf8")) as { at?: string };
    const at = parsed.at ? Date.parse(parsed.at) : NaN;
    return !Number.isFinite(at) || Date.now() - at > STORE_LOCK_TTL_MS;
  } catch {
    return true;
  }
}

function writeFileAtomic(file: string, text: string): void {
  const tmp = join(dirname(file), `.${basename(file)}.${process.pid}.${Date.now()}.tmp`);
  try {
    writeFileSync(tmp, text, "utf8");
    renameSync(tmp, file);
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {
      /* no temp to clean */
    }
    throw error;
  }
}

function assertSafeEntry(entry: MemoryEntry): void {
  const text = [entry.name, entry.description, entry.origin ?? "", entry.body].join("\n");
  const patterns: [string, RegExp][] = [
    ["OpenAI API key", /\bsk-[A-Za-z0-9_-]{20,}\b/],
    ["GitHub token", /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/],
    ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
    ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ];
  for (const [kind, pattern] of patterns) {
    if (pattern.test(text)) throw new UnsafeMemoryEntryError(kind);
  }
}

function oneLine(value: string): string {
  return value.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
}

function restoreMemoryDir(value: string | undefined): void {
  if (value === undefined) delete process.env.PROJECT_MEMORY_DIR;
  else process.env.PROJECT_MEMORY_DIR = value;
}

function isFileExistsError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "EEXIST");
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function renderEntry(entry: MemoryEntry): string {
  const origin = entry.origin ? `\n  origin: ${oneLine(entry.origin)}` : "";
  const pin = entry.pin ? "\npin: true" : "";
  const conflict = entry.conflictWith ? `\nconflict: ${entry.conflictWith}` : "";
  return `---
name: ${entry.name}
description: ${oneLine(entry.description)}${pin}${conflict}
metadata:
  node_type: memory
  type: ${entry.type}${origin}
---

${entry.body.trim()}
`;
}

function parseEntry(raw: string, fallbackName: string): MemoryEntry {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { name: fallbackName, description: fallbackName, type: "project", body: raw.trim() };
  }
  const front = match[1];
  const name = pickField(front, "name") || fallbackName;
  const description = pickField(front, "description") || name;
  const typeRaw = pickField(front, "type") || "project";
  const type: MemoryType = isMemoryType(typeRaw) ? typeRaw : "project";
  const origin = pickField(front, "origin");
  const pinRaw = pickField(front, "pin");
  const pin = pinRaw === "true" || pinRaw === "yes";
  const conflictWith = pickField(front, "conflict");
  return { name, description, type, body: match[2].trim(), origin, pin: pin || undefined, conflictWith };
}

function pickField(front: string, key: string): string | undefined {
  const match = front.match(new RegExp(`(?:^|\\n)\\s*${key}:\\s*(.+)$`, "m"));
  return match?.[1]?.trim();
}

function titleCase(name: string): string {
  return name.replace(/-/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export function listEntryFiles(cwd?: string): string[] {
  const dir = memoryDir(cwd);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((file) => file.endsWith(".md") && file !== "MEMORY.md");
}

export function listEntries(cwd?: string): MemoryEntry[] {
  const entries: MemoryEntry[] = [];
  for (const file of listEntryFiles(cwd)) {
    const entry = readEntry(basename(file, ".md"), cwd);
    if (entry) entries.push(entry);
  }
  return entries;
}

/** Rebuild MEMORY.md from topic files on disk. Drops stale index rows and adds orphans. */
export function rebuildIndex(cwd?: string): MemoryIndexItem[] {
  return withStoreLock(cwd, () => {
    const items = listEntries(cwd).map((entry) => ({
      name: entry.name,
      description: entry.description,
      conflictWith: entry.conflictWith,
    }));
    writeIndexUnlocked(items, cwd);
    return items;
  });
}

export { INDEX_LINE_LIMIT, INDEX_BYTE_LIMIT };
