import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Subprocess-level tests for the CLI entry (dist/cli.js) — the process a host
 * actually spawns for hooks, and the one the owner runs by hand. HOME is
 * isolated so the last-root cache and stamping rules can be observed without
 * touching the real one.
 */
const CLI_JS = join(dirnameOf(import.meta.url), "cli.js");

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

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

function childEnv(home: string, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  env.HOME = home;
  env.USERPROFILE = home;
  // Root must come from the cwd probe here, never from an inherited override.
  delete env.PROJECT_MEMORY_ROOT;
  delete env.PROJECT_MEMORY_DIR;
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

function runCli(args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv; input?: string }): string {
  return execFileSync(process.execPath, [CLI_JS, ...args], {
    cwd: opts.cwd,
    env: opts.env,
    input: opts.input ?? "",
    encoding: "utf8",
    timeout: 20_000,
    windowsHide: true,
  });
}

function cacheFile(home: string): string {
  return join(home, ".project-memory", "last-root.txt");
}

test("hook run inside a git workspace stamps the last-root cache with that root", () => {
  const home = tmpDir("pmem-cli-home-");
  const repo = tmpDir("pmem-cli-repo-");
  execFileSync("git", ["init"], { cwd: repo, stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
  const out = runCli(["hook", "--event", "SessionStart", "--plain"], {
    cwd: repo,
    env: childEnv(home),
    input: `${JSON.stringify({ cwd: repo })}\n`,
  });
  assert.match(out, /Project memory/);
  const stamped = JSON.parse(readFileSync(cacheFile(home), "utf8")) as { root: string };
  // git prints forward slashes on Windows; the stamp stores the resolved form.
  assert.equal(stamped.root, resolve(repo));
});

test("hook run outside any workspace must not stamp the last-root cache", (t) => {
  const home = tmpDir("pmem-cli-home-");
  const scratch = tmpDir("pmem-cli-scratch-");
  if (insideGitTree(scratch)) {
    t.skip("temp dir is inside a git tree on this machine; refusal not exercised");
    return;
  }
  const out = runCli(["hook", "--event", "SessionStart", "--plain"], {
    cwd: scratch,
    env: childEnv(home),
    input: `${JSON.stringify({ cwd: scratch })}\n`,
  });
  // The hook still exits cleanly; it just injects nothing and stamps nothing.
  assert.ok(!out.includes(".memory"), out);
  assert.ok(!existsSync(cacheFile(home)), "a non-workspace cwd must not poison the root cache");
});

test("cli write keeps flag values out of the positional body and search skips them", () => {
  const home = tmpDir("pmem-cli-home-");
  const workspace = tmpDir("pmem-cli-ws-");
  const env = childEnv(home, { PROJECT_MEMORY_ROOT: workspace });
  runCli(
    ["write", "--name", "cli-positional", "--type", "project", "--description", "one line", "hello", "world", "body"],
    { cwd: workspace, env },
  );
  const file = readFileSync(join(workspace, ".memory", "cli-positional.md"), "utf8");
  // The body is exactly the positionals: "--type project" must not leak "project".
  assert.match(file, /hello world body/);
  assert.doesNotMatch(file, /project hello world/);

  // search with --cwd placed before the keyword: if the cwd value leaked into
  // the query, "workspace world" would not match and no hit would come back.
  const found = runCli(["search", "--cwd", workspace, "world"], { cwd: workspace, env });
  assert.match(found, /cli-positional/, "the keyword after --cwd <dir> must be searchable");
  assert.doesNotMatch(found, /--cwd/);
});

function dirnameOf(url: string): string {
  return fileURLToPath(new URL(".", url));
}
