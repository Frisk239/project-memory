import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

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
    if (parent === dir) return resolve(cwd);
    dir = parent;
  }
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
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "memory";
}
