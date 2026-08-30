import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, test } from "node:test";
import { rememberRoot, resolveProjectRoot, ROOT_CACHE_TTL_MS, slugify, UnresolvedRootError } from "./core/paths.js";
import { saveEntry } from "./core/store.js";

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

function makeGitRepo(prefix: string): string {
  const dir = tmpDir(prefix);
  execFileSync("git", ["init"], { cwd: dir, stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
  return dir;
}

function cacheFile(): string {
  return join(homedir(), ".project-memory", "last-root.txt");
}

function writeCacheRaw(content: string): void {
  const cache = cacheFile();
  mkdirSync(dirname(cache), { recursive: true });
  writeFileSync(cache, content, "utf8");
}

function ageCache(root: string, ageMs: number): void {
  const at = new Date(Date.now() - ageMs).toISOString();
  writeCacheRaw(`${JSON.stringify({ root, at })}\n`);
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

test("resolveProjectRoot falls back to a fresh cached root when cwd has no git/.memory", (t) => {
  isolateHome();
  delete process.env.PROJECT_MEMORY_ROOT;
  const known = tmpDir("pmem-known-");
  const orphan = tmpDir("pmem-orphan-");
  if (insideGitTree(orphan)) {
    t.skip("temp dir is inside a git tree on this machine; cache fallback not exercised");
    return;
  }
  rememberRoot(known);
  assert.equal(resolveProjectRoot(orphan), known);
  // The same fresh cache also authorizes a cwd-less write.
  assert.equal(resolveProjectRoot(orphan, { forWrite: true }), known);
});

test("PROJECT_MEMORY_ROOT overrides the cache", () => {
  isolateHome();
  const known = tmpDir("pmem-known-");
  const override = tmpDir("pmem-override-");
  rememberRoot(known);
  process.env.PROJECT_MEMORY_ROOT = override;
  assert.equal(resolveProjectRoot(tmpDir("pmem-cwd-")), override);
});

test("PROJECT_MEMORY_ROOT outranks a git-rooted cwd", () => {
  isolateHome();
  const repo = makeGitRepo("pmem-repo-");
  const override = tmpDir("pmem-override-");
  process.env.PROJECT_MEMORY_ROOT = override;
  // Even with a perfectly detectable workspace under cwd, the explicit root wins.
  assert.equal(resolveProjectRoot(repo), resolve(override));
  assert.equal(resolveProjectRoot(repo, { forWrite: true }), resolve(override));
});

test("a stale cached root is refused: no read hint, no write", (t) => {
  isolateHome();
  const known = tmpDir("pmem-known-");
  const orphan = tmpDir("pmem-orphan-");
  if (insideGitTree(orphan)) {
    t.skip("temp dir is inside a git tree on this machine; stale-cache refusal not exercised");
    return;
  }
  ageCache(known, ROOT_CACHE_TTL_MS + 60_000);
  assert.throws(() => resolveProjectRoot(orphan), UnresolvedRootError);
  assert.throws(() => resolveProjectRoot(orphan, { forWrite: true }), UnresolvedRootError);
});

test("a corrupt or legacy plain-path cache is refused for writes", (t) => {
  isolateHome();
  const orphan = tmpDir("pmem-orphan-");
  if (insideGitTree(orphan)) {
    t.skip("temp dir is inside a git tree on this machine; corrupt-cache refusal not exercised");
    return;
  }
  writeCacheRaw("{not json at all");
  assert.throws(() => resolveProjectRoot(orphan, { forWrite: true }), UnresolvedRootError);
  // Legacy format (bare path, no timestamp): no way to judge freshness, so no.
  writeCacheRaw(`${orphan}\n`);
  assert.throws(() => resolveProjectRoot(orphan, { forWrite: true }), UnresolvedRootError);
});

test("with no cwd probe, no explicit root, and no cache, reads and writes refuse", (t) => {
  isolateHome();
  const orphan = tmpDir("pmem-orphan-");
  if (insideGitTree(orphan)) {
    t.skip("temp dir is inside a git tree on this machine; no-root refusal not exercised");
    return;
  }
  assert.throws(() => resolveProjectRoot(orphan), UnresolvedRootError);
  assert.throws(() => resolveProjectRoot(orphan, { forWrite: true }), UnresolvedRootError);
});

test("a successful cwd probe refreshes the cache stamp", () => {
  isolateHome();
  const repo = makeGitRepo("pmem-repo-");
  const resolved = resolveProjectRoot(repo);
  const stamped = JSON.parse(readFileSync(cacheFile(), "utf8")) as { root: string; at: string };
  // git reports forward slashes on Windows; the stamp stores the resolved form.
  assert.equal(stamped.root, resolve(resolved));
  assert.ok(Date.now() - Date.parse(stamped.at) < 5_000);
});

test("switching workspaces stamps and writes the current one, never the previous", () => {
  isolateHome();
  const projectA = makeGitRepo("pmem-switch-a-");
  const projectB = makeGitRepo("pmem-switch-b-");
  // Cache says A (e.g. A's hook ran last)...
  rememberRoot(projectA);
  // ...but a write from B must land in B: the cwd probe outranks the cache.
  saveEntry({ name: "switch-proof", description: "belongs to B", type: "project", body: "written while B was the cwd" }, projectB);
  assert.ok(existsSync(join(projectB, ".memory", "switch-proof.md")));
  assert.ok(!existsSync(join(projectA, ".memory")));
  // And the cache now points at B, so the next cwd-less write also goes to B.
  const stamped = JSON.parse(readFileSync(cacheFile(), "utf8")) as { root: string };
  assert.equal(stamped.root, projectB);
});

test("slugify keeps Han so two Chinese names do not collapse to memory", () => {
  assert.equal(slugify("use-pnpm"), "use-pnpm");
  assert.notEqual(slugify("发布方式"), "memory");
  assert.notEqual(slugify("调研结论"), "memory");
  assert.notEqual(slugify("发布方式"), slugify("调研结论"));
  assert.equal(slugify("カナ 메모 память"), "カナ-메모-память");
  assert.match(slugify("💾"), /^memory-[0-9a-f]{8}$/);
});

test("rememberRoot ignores a non-existent root", (t) => {
  isolateHome();
  const orphan = tmpDir("pmem-orphan-");
  if (insideGitTree(orphan)) {
    t.skip("temp dir is inside a git tree on this machine; refusal not exercised");
    return;
  }
  rememberRoot(join(orphan, "does-not-exist"));
  // No cache written, so nothing authorizes a root: resolution refuses.
  assert.ok(!existsSync(cacheFile()));
  assert.throws(() => resolveProjectRoot(orphan), UnresolvedRootError);
});
