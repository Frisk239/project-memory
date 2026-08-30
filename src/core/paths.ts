import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

/**
 * A cached root older than this is treated as unresolved: cwd-less writes
 * fail rather than land in whatever project last stamped the cache. Chosen
 * conservatively; tighten or loosen via this constant only.
 */
export const ROOT_CACHE_TTL_MS = 30 * 60 * 1000;

/**
 * Thrown when no reliable ledger root exists: no PROJECT_MEMORY_ROOT, the cwd
 * is not a workspace (no git root, no .memory ancestor), and the last-root
 * cache is missing, corrupt, or stale. Better to fail loudly than to read or
 * write the wrong project's ledger.
 */
export class UnresolvedRootError extends Error {
  constructor(detail: string) {
    super(
      `cannot resolve the project memory root: ${detail}. ` +
        `Set PROJECT_MEMORY_ROOT to the workspace root, or run from inside the workspace.`,
    );
    this.name = "UnresolvedRootError";
  }
}

export type ResolveOptions = { forWrite?: boolean };

// ponytail: last-resort cache for clients (e.g. Kiro MCP) that spawn the
// server with no cwd and no PROJECT_MEMORY_ROOT. Hook processes DO get the
// workspace root, so they stamp it here as {root, at}; the MCP process reads
// it only after every cwd-based probe fails, and only while fresh (TTL above).
// Ceiling: two projects driven purely through MCP with zero hook activity
// would share one cache slot — the TTL turns that from silent misdirection
// into a refused write.
function rootCachePath(): string {
  return join(homedir(), ".project-memory", "last-root.txt");
}

export function resolveProjectRoot(cwd = process.cwd(), opts: ResolveOptions = {}): string {
  const override = process.env.PROJECT_MEMORY_ROOT;
  if (override) return resolve(override);
  const probed = probeFromCwd(cwd);
  if (probed) {
    // A process that knows its workspace keeps the cache warm for the
    // cwd-less MCP sibling. Never stamped from the env branch: two projects
    // each pinned via PROJECT_MEMORY_ROOT must not fight over this slot.
    rememberRoot(probed);
    return probed;
  }
  const cached = readCachedRoot();
  if (cached) return cached;
  throw new UnresolvedRootError(
    `cwd "${resolve(cwd)}" has no git root or .memory ancestor, and the last-root cache is unusable`,
  );
}

export function probeFromCwd(cwd: string): string | undefined {
  try {
    const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    }).trim();
    if (root) return root;
  } catch {
    /* not a git repo */
  }
  let dir = resolve(cwd);
  while (true) {
    if (existsSync(join(dir, ".memory"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

/** Stamp a known-good project root so cwd-less clients can recover it. */
export function rememberRoot(root: string | undefined): void {
  if (!root) return;
  const abs = resolve(root);
  if (!existsSync(abs)) return;
  try {
    const cache = rootCachePath();
    mkdirSync(dirname(cache), { recursive: true });
    writeFileSync(cache, `${JSON.stringify({ root: abs, at: new Date().toISOString() })}\n`, "utf8");
  } catch {
    /* cache is best-effort */
  }
}

/**
 * The cache counts as usable only when it parses, points at an existing
 * directory, and is younger than ROOT_CACHE_TTL_MS. The legacy plain-path
 * format carries no timestamp and reads as corrupt here — the next hook
 * refresh rewrites it in the new format.
 */
function readCachedRoot(now = Date.now()): string | undefined {
  let raw: string;
  try {
    raw = readFileSync(rootCachePath(), "utf8");
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") return undefined;
  const record = parsed as { root?: unknown; at?: unknown };
  if (typeof record.root !== "string" || typeof record.at !== "string") return undefined;
  const at = Date.parse(record.at);
  if (!Number.isFinite(at) || now - at > ROOT_CACHE_TTL_MS) return undefined;
  if (!existsSync(record.root)) return undefined;
  return record.root;
}

export function memoryDir(cwd?: string, opts: ResolveOptions = {}): string {
  const override = process.env.PROJECT_MEMORY_DIR;
  if (override) return resolve(override);
  return join(resolveProjectRoot(cwd, opts), ".memory");
}

export function indexPath(cwd?: string, opts: ResolveOptions = {}): string {
  return join(memoryDir(cwd, opts), "MEMORY.md");
}

export function entryPath(name: string, cwd?: string, opts: ResolveOptions = {}): string {
  return join(memoryDir(cwd, opts), `${topicSlug(name)}.md`);
}

export function topicSlug(name: string): string {
  return slugify(name.trim().replace(/\.md$/i, ""));
}

export function slugify(name: string): string {
  const raw = name.trim();
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  if (slug) return slug;
  return raw ? `memory-${createHash("sha1").update(raw).digest("hex").slice(0, 8)}` : "memory";
}
