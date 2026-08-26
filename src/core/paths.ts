import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

// ponytail: last-resort cache for clients (e.g. Kiro MCP) that spawn the
// server with no cwd and no PROJECT_MEMORY_ROOT. Hook processes DO get the
// workspace root, so they stamp it here; the MCP process reads it only after
// every cwd-based probe fails. Single-project cache: the newest hook wins.
// Ceiling: two projects driven purely through MCP with zero hook activity
// would share one cache slot — upgrade path is a cwd->root map keyed by pid
// or a client-supplied id.
function rootCachePath(): string {
  return join(homedir(), ".project-memory", "last-root.txt");
}

export function resolveProjectRoot(cwd = process.cwd()): string {
  const override = process.env.PROJECT_MEMORY_ROOT;
  if (override) return resolve(override);
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
  const cached = readCachedRoot();
  if (cached) return cached;
  return resolve(cwd);
}

/** Stamp a known-good project root so cwd-less clients can recover it. */
export function rememberRoot(root: string | undefined): void {
  if (!root) return;
  const abs = resolve(root);
  if (!existsSync(abs)) return;
  try {
    const cache = rootCachePath();
    mkdirSync(dirname(cache), { recursive: true });
    writeFileSync(cache, abs, "utf8");
  } catch {
    /* cache is best-effort */
  }
}

function readCachedRoot(): string | undefined {
  try {
    const root = readFileSync(rootCachePath(), "utf8").trim();
    if (root && existsSync(root)) return root;
  } catch {
    /* no cache yet */
  }
  return undefined;
}

export function memoryDir(cwd?: string): string {
  const override = process.env.PROJECT_MEMORY_DIR;
  if (override) return resolve(override);
  return join(resolveProjectRoot(cwd), ".memory");
}

export function indexPath(cwd?: string): string {
  return join(memoryDir(cwd), "MEMORY.md");
}

export function entryPath(name: string, cwd?: string): string {
  return join(memoryDir(cwd), `${slugify(name)}.md`);
}

export function slugify(name: string): string {
  // Keep Han so a Chinese-only name does not collapse to the fallback "memory"
  // (two topics would otherwise share one file and skip conflict). Latin slugs
  // unchanged. Ceiling: other non-latin scripts still drop.
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^\p{Script=Han}a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "memory";
}
