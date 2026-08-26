import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { rememberRoot, resolveProjectRoot } from "./core/paths.js";

const dirs: string[] = [];
let savedHome: string | undefined;
let savedProfile: string | undefined;

afterEach(() => {
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  if (savedProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = savedProfile;
  delete process.env.PROJECT_MEMORY_ROOT;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function isolateHome(): void {
  savedHome = process.env.HOME;
  savedProfile = process.env.USERPROFILE;
  const home = mkdtempSync(join(tmpdir(), "pmem-home-"));
  dirs.push(home);
  process.env.HOME = home;
  process.env.USERPROFILE = home; // Windows: os.homedir() reads USERPROFILE
}

function tmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function insideGitTree(cwd: string): boolean {
  try {
    execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

test("resolveProjectRoot falls back to the cached root when cwd has no git/.memory", (t) => {
  isolateHome();
  delete process.env.PROJECT_MEMORY_ROOT;
  const known = tmpDir("pmem-known-");
  const orphan = tmpDir("pmem-orphan-");
  // The fallback only fires when the probe cwd is not itself inside a git tree.
  if (insideGitTree(orphan)) {
    t.skip("temp dir is inside a git tree on this machine; cache fallback not exercised");
    return;
  }
  rememberRoot(known);
  assert.equal(resolveProjectRoot(orphan), known);
});

test("PROJECT_MEMORY_ROOT overrides the cache", () => {
  isolateHome();
  const known = tmpDir("pmem-known-");
  const override = tmpDir("pmem-override-");
  rememberRoot(known);
  process.env.PROJECT_MEMORY_ROOT = override;
  assert.equal(resolveProjectRoot(tmpDir("pmem-cwd-")), override);
});

test("rememberRoot ignores a non-existent root", () => {
  isolateHome();
  const orphan = tmpDir("pmem-orphan-");
  rememberRoot(join(orphan, "does-not-exist"));
  if (insideGitTree(orphan)) return; // can't assert fallback here
  // No cache written, so resolve falls through to cwd itself.
  assert.equal(resolveProjectRoot(orphan), orphan);
});
