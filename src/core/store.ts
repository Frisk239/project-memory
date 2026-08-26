import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { ensureGitignored, isGitRepo } from "./gitignore.js";
import { entryPath, indexPath, memoryDir, slugify } from "./paths.js";
import { BODY_DIVERGE, bodiesAgree, bodyScore, isCloseTopic, titleScore, TITLE_OVERLAP } from "./similarity.js";
import { isMemoryType, type MemoryEntry, type MemoryIndexItem, type MemoryType } from "./types.js";

const INDEX_LINE_LIMIT = 200;
const INDEX_BYTE_LIMIT = 25 * 1024;

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
  if (!existsSync(file)) {
    const fallback = join(memoryDir(cwd), name.endsWith(".md") ? name : `${name}.md`);
    if (!existsSync(fallback)) return null;
    return parseEntry(readFileSync(fallback, "utf8"), basename(fallback, ".md"));
  }
  return parseEntry(readFileSync(file, "utf8"), slugify(name));
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

export function writeEntry(entry: MemoryEntry, cwd?: string): MemoryEntry {
  const dir = memoryDir(cwd);
  const firstCreate = !existsSync(dir);
  mkdirSync(dir, { recursive: true });
  if (firstCreate) ensureLedgerIgnored(dir);
  const name = slugify(entry.name);
  const previous = readEntry(name, cwd);
  const saved: MemoryEntry = {
    ...entry,
    name,
    pin: entry.pin ?? previous?.pin,
    conflictWith: entry.conflictWith ?? previous?.conflictWith,
  };
  writeFileSync(entryPath(name, cwd), renderEntry(saved), "utf8");
  upsertIndex(saved, cwd);
  return saved;
}

/**
 * Result of a write. `conflict` means the incoming fact disagreed with an
 * existing one: both stay on disk, the caller must tell the owner and must not
 * pick a winner. `.name`/`.description`/etc mirror the entry that was written
 * (the sibling on conflict) so existing callers keep working.
 */
export type SaveResult = MemoryEntry & {
  conflict?: { keptSlug: string; newSlug: string };
};

/**
 * Create or update, organizing at write.
 * - Same slug, bodiesAgree (similar, empty previous, or gray containment) → upsert (keep pin).
 * - Same slug, disagreeing body → conflict: keep the old file untouched, write
 *   the incoming under `{slug}-conflict[-n]`, mark both.
 * - New slug, close topic + similar body → SimilarTopicError (use that slug).
 * - New slug, title-overlap + diverging body → conflict: write the new slug,
 *   mark both.
 * - New slug, not close → create.
 * A pinned topic is never overwritten; the incoming still gets a sibling file.
 */
export function saveEntry(entry: MemoryEntry, cwd?: string): SaveResult {
  const name = slugify(entry.name);
  const existing = readEntry(name, cwd);

  if (existing) {
    if (bodiesAgree(existing.body, entry.body)) {
      // Bodies agree (or previous was empty): upsert in place, keep pin.
      return writeEntry(entry, cwd);
    }
    // Disagreeing fact: keep the original (pin or not), write a sibling.
    return conflictWrite(entry, existing, name, cwd);
  }

  // New slug: check nearby topics.
  for (const other of listEntries(cwd)) {
    const bodies = bodyScore(entry.body, other.body);
    const titles = titleScore(entry, other);
    if (bodies >= BODY_DIVERGE) continue; // not a divergence; similar handled below
    if (titles >= TITLE_OVERLAP) {
      // Overlapping title but diverging body → conflict: keep both under the
      // caller's own slug, mark both.
      return conflictWrite(entry, other, name, cwd, name);
    }
  }
  if (!existsSync(entryPath(name, cwd))) {
    const hits = listEntries(cwd).filter((existingEntry) => isCloseTopic(entry, existingEntry));
    if (hits.length) {
      throw new SimilarTopicError(hits.map((item) => ({ name: item.name, description: item.description })));
    }
  }
  return writeEntry(entry, cwd);
}

/**
 * Persist a disagreeing incoming fact next to `kept` without overwriting it.
 * If `forceSlug` is given (new-slug title-overlap case) the incoming keeps its
 * own slug; otherwise it lands under `{base}-conflict[-n]`.
 */
function conflictWrite(
  entry: MemoryEntry,
  kept: MemoryEntry,
  base: string,
  cwd: string | undefined,
  forceSlug?: string,
): SaveResult {
  const newSlug = forceSlug ?? nextConflictSlug(base, cwd);
  const saved = writeEntry({ ...entry, name: newSlug, conflictWith: kept.name }, cwd);
  // Mark the kept file too, without disturbing its body: re-render with the
  // conflict pointer, and flag its index row.
  writeFileSync(entryPath(kept.name, cwd), renderEntry({ ...kept, conflictWith: newSlug }), "utf8");
  flagIndexConflict(kept.name, newSlug, cwd);
  return { ...saved, conflict: { keptSlug: kept.name, newSlug } };
}

function nextConflictSlug(base: string, cwd?: string): string {
  let slug = `${base}-conflict`;
  let n = 2;
  while (existsSync(entryPath(slug, cwd))) {
    slug = `${base}-conflict-${n}`;
    n += 1;
  }
  return slug;
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
  const file = entryPath(name, cwd);
  if (!existsSync(file)) return false;
  const forgotten = slugify(name);
  unlinkSync(file);
  // Clear dangling conflict: pointers so the index does not keep [conflict: deleted].
  for (const entry of listEntries(cwd)) {
    if (entry.conflictWith !== forgotten) continue;
    writeFileSync(entryPath(entry.name, cwd), renderEntry({ ...entry, conflictWith: undefined }), "utf8");
  }
  const items = listIndex(cwd)
    .filter((item) => item.name !== forgotten)
    .map((item) => (item.conflictWith === forgotten ? { ...item, conflictWith: undefined } : item));
  writeIndex(items, cwd);
  return true;
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

/** Mark an existing index row as conflicting without touching the file body. */
function flagIndexConflict(name: string, conflictWith: string, cwd?: string): void {
  const items = listIndex(cwd).map((item) =>
    item.name === name ? { ...item, conflictWith } : item,
  );
  writeIndex(items, cwd);
}

function writeIndex(items: MemoryIndexItem[], cwd?: string): void {
  mkdirSync(memoryDir(cwd), { recursive: true });
  const lines = ["# MEMORY.md", "", ...items.map(indexLine), ""];
  writeFileSync(indexPath(cwd), capIndex(lines.join("\n")), "utf8");
}

function indexLine(item: MemoryIndexItem): string {
  // A conflicting topic is flagged in the description so the next session sees
  // it without opening the file. The link text/target stay the plain slug.
  const desc = item.conflictWith ? `[conflict: ${item.conflictWith}] ${item.description}` : item.description;
  return `- [${titleCase(item.name)}](${item.name}.md) — ${desc}`;
}

function capIndex(text: string): string {
  const lines = text.split(/\r?\n/);
  let cut = text;
  if (lines.length > INDEX_LINE_LIMIT) cut = lines.slice(0, INDEX_LINE_LIMIT).join("\n");
  const bytes = Buffer.byteLength(cut, "utf8");
  if (bytes > INDEX_BYTE_LIMIT) {
    cut = Buffer.from(cut, "utf8").subarray(0, INDEX_BYTE_LIMIT).toString("utf8");
  }
  return cut;
}

function renderEntry(entry: MemoryEntry): string {
  const origin = entry.origin ? `\n  origin: ${entry.origin}` : "";
  const pin = entry.pin ? "\npin: true" : "";
  const conflict = entry.conflictWith ? `\nconflict: ${entry.conflictWith}` : "";
  return `---
name: ${entry.name}
description: ${entry.description}${pin}${conflict}
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
  const items = listEntries(cwd).map((entry) => ({
    name: entry.name,
    description: entry.description,
    conflictWith: entry.conflictWith,
  }));
  writeIndex(items, cwd);
  return items;
}

export { INDEX_LINE_LIMIT, INDEX_BYTE_LIMIT };
