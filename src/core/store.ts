import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { entryPath, indexPath, memoryDir, slugify } from "./paths.js";
import { isCloseTopic } from "./similarity.js";
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
    items.push({ name: match[2].replace(/\.md$/i, ""), description: match[3].trim() || match[1] });
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
  mkdirSync(dir, { recursive: true });
  const name = slugify(entry.name);
  const previous = readEntry(name, cwd);
  const saved: MemoryEntry = {
    ...entry,
    name,
    pin: entry.pin ?? previous?.pin,
  };
  writeFileSync(entryPath(name, cwd), renderEntry(saved), "utf8");
  upsertIndex(saved, cwd);
  return saved;
}

/** Create or update. New slugs that match an existing topic are refused. */
export function saveEntry(entry: MemoryEntry, cwd?: string): MemoryEntry {
  const name = slugify(entry.name);
  if (!existsSync(entryPath(name, cwd))) {
    const hits = listEntries(cwd).filter((existing) => isCloseTopic(entry, existing));
    if (hits.length) {
      throw new SimilarTopicError(hits.map((item) => ({ name: item.name, description: item.description })));
    }
  }
  return writeEntry(entry, cwd);
}

export function forgetEntry(name: string, cwd?: string): boolean {
  const file = entryPath(name, cwd);
  if (!existsSync(file)) return false;
  unlinkSync(file);
  const items = listIndex(cwd).filter((item) => item.name !== slugify(name));
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
  items.unshift({ name: entry.name, description: entry.description });
  writeIndex(items, cwd);
}

function writeIndex(items: MemoryIndexItem[], cwd?: string): void {
  mkdirSync(memoryDir(cwd), { recursive: true });
  const lines = ["# MEMORY.md", "", ...items.map((item) => `- [${titleCase(item.name)}](${item.name}.md) — ${item.description}`), ""];
  writeFileSync(indexPath(cwd), capIndex(lines.join("\n")), "utf8");
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
  return `---
name: ${entry.name}
description: ${entry.description}${pin}
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
  return { name, description, type, body: match[2].trim(), origin, pin: pin || undefined };
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
  const items = listEntries(cwd).map((entry) => ({ name: entry.name, description: entry.description }));
  writeIndex(items, cwd);
  return items;
}

export { INDEX_LINE_LIMIT, INDEX_BYTE_LIMIT };
