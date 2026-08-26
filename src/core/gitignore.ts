import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const RULE = ".memory/";
const COMMENT = "# project-memory: agent-facing ledger, shared by path not git";

/**
 * Ensure `.memory/` is gitignored in the repo that owns `root`.
 * - No .gitignore → create it with the rule + one comment line.
 * - Present, no .memory rule → append the rule.
 * - Already ignored → no-op.
 * Never runs `git rm --cached`: files the owner already tracks stay tracked
 * until they untrack them.
 * ponytail: literal-line match, not full gitignore-pattern evaluation. Ceiling:
 * an exotic pattern like `[.]memory/` would not be detected and we'd append a
 * duplicate rule (harmless). Upgrade path: shell out to `git check-ignore`.
 */
export function ensureGitignored(root: string): "created" | "appended" | "present" {
  const file = join(root, ".gitignore");
  if (!existsSync(file)) {
    writeFileSync(file, `${COMMENT}\n${RULE}\n`, "utf8");
    return "created";
  }
  const raw = readFileSync(file, "utf8");
  if (alreadyIgnored(raw)) return "present";
  const sep = raw.endsWith("\n") ? "" : "\n";
  writeFileSync(file, `${raw}${sep}${RULE}\n`, "utf8");
  return "appended";
}

function alreadyIgnored(raw: string): boolean {
  for (const line of raw.split(/\r?\n/)) {
    const rule = line.trim();
    if (rule === ".memory/" || rule === ".memory" || rule === "**/.memory/**" || rule === "**/.memory/") {
      return true;
    }
  }
  return false;
}

/** True if `cwd` is inside a git working tree. */
export function isGitRepo(cwd: string): boolean {
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}
