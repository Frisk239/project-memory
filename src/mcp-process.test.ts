import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";

/**
 * Subprocess-level proof of the root rules, run against the real built
 * dist/mcp.js over JSON-RPC — not just the in-process functions. This is the
 * path a host actually exercises: spawn, resolve, write.
 */
const MCP_JS = join(dirnameOf(import.meta.url), "mcp.js");

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

type RpcResponse = {
  id?: number;
  result?: { content?: { type: string; text: string }[]; isError?: boolean };
  error?: { message?: string };
};

type ToolResult = { text: string; isError: boolean };

function startServer(cwd: string, envOverrides: Record<string, string | undefined>) {
  const env = { ...process.env };
  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  const child = spawn(process.execPath, [MCP_JS], { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
  const pending = new Map<number, (response: RpcResponse) => void>();
  let buffer = "";
  child.stdout.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      try {
        const message = JSON.parse(line) as RpcResponse;
        if (message.id != null && pending.has(message.id)) {
          pending.get(message.id)!(message);
          pending.delete(message.id);
        }
      } catch {
        /* non-JSON noise on stdout */
      }
    }
  });
  child.stderr.on("data", () => {}); // drain: MCP SDK logs to stderr
  function request(id: number, method: string, params: unknown): Promise<RpcResponse> {
    return new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => rejectPromise(new Error(`rpc timeout: ${method}`)), 20_000);
      pending.set(id, (response) => {
        clearTimeout(timer);
        resolvePromise(response);
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }
  function notify(method: string): void {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`);
  }
  return { child, request, notify };
}

async function withServer(
  cwd: string,
  envOverrides: Record<string, string | undefined>,
  run: (call: (name: string, args: Record<string, unknown>) => Promise<ToolResult>) => Promise<void>,
): Promise<void> {
  const server = startServer(cwd, envOverrides);
  try {
    await server.request(0, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "pmem-test", version: "0.0.0" },
    });
    server.notify("notifications/initialized");
    let nextId = 1;
    const call = async (name: string, args: Record<string, unknown>): Promise<ToolResult> => {
      const response = await server.request(nextId++, "tools/call", { name, arguments: args });
      if (response.error) throw new Error(`rpc error calling ${name}: ${response.error.message}`);
      return {
        text: response.result?.content?.[0]?.text ?? "",
        isError: Boolean(response.result?.isError),
      };
    };
    await run(call);
  } finally {
    // Await the exit: on Windows the temp cwd stays locked (EPERM on rmSync)
    // until the child is really gone, not just told to die.
    const exited = new Promise<void>((resolveExit) => server.child.on("exit", () => resolveExit()));
    server.child.kill();
    await exited;
  }
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

function firstLine(text: string): string {
  return text.split(/\r?\n/)[0];
}

test("spawned from project A with PROJECT_MEMORY_ROOT=B, every response and write targets B", async () => {
  const projectA = tmpDir("pmem-proc-a-");
  execFileSync("git", ["init"], { cwd: projectA, stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
  const projectB = tmpDir("pmem-proc-b-");

  await withServer(projectA, { PROJECT_MEMORY_ROOT: projectB, PROJECT_MEMORY_DIR: undefined }, async (call) => {
    const written = await call("memory_write", {
      name: "subproc-explicit-root",
      description: "spawned server must honor the explicit root",
      type: "project",
      body: "the release checklist lives in docs/release.md and must be signed by two reviewers",
    });
    assert.ok(!written.isError, written.text);
    assert.equal(firstLine(written.text), `[ledger: ${join(projectB, ".memory")}]`);
    // The write landed in B — the project the cwd would never have guessed.
    assert.ok(existsSync(join(projectB, ".memory", "subproc-explicit-root.md")));
    assert.ok(!existsSync(join(projectA, ".memory")), "must not create a ledger in the cwd project");

    // Updating the same slug also leads with the ledger and replaces in place.
    const updated = await call("memory_write", {
      name: "subproc-explicit-root",
      description: "spawned server must honor the explicit root",
      type: "project",
      body: "the release checklist was deleted entirely; releases now ship straight from the trunk",
    });
    assert.ok(!updated.isError, updated.text);
    assert.equal(firstLine(updated.text), `[ledger: ${join(projectB, ".memory")}]`);
    assert.ok(existsSync(join(projectB, ".memory", "subproc-explicit-root.md")));
    assert.ok(!existsSync(join(projectB, ".memory", "subproc-explicit-root-conflict.md")));
    const updatedRead = await call("memory_read", { name: "subproc-explicit-root" });
    assert.match(updatedRead.text, /deleted entirely/);
    assert.doesNotMatch(updatedRead.text, /signed by two reviewers/);

    // Error response leads with the ledger too.
    const missing = await call("memory_read", { name: "no-such-topic" });
    assert.ok(missing.isError);
    assert.ok(firstLine(missing.text).startsWith("[ledger: "), missing.text);

    const index = await call("memory_index", {});
    assert.ok(!index.isError, index.text);
    assert.equal(firstLine(index.text), `[ledger: ${join(projectB, ".memory")}]`);
    assert.match(index.text, /subproc-explicit-root/);
  });
});

test("with no cwd probe, no explicit root, and no cache, spawned writes fail loudly", async (t) => {
  const nowhere = tmpDir("pmem-proc-nowhere-");
  if (insideGitTree(nowhere)) {
    t.skip("temp dir is inside a git tree on this machine; refusal not exercised");
    return;
  }
  const emptyHome = tmpDir("pmem-proc-home-");

  await withServer(
    nowhere,
    {
      PROJECT_MEMORY_ROOT: undefined,
      PROJECT_MEMORY_DIR: undefined,
      HOME: emptyHome,
      USERPROFILE: emptyHome,
    },
    async (call) => {
      const write = await call("memory_write", {
        name: "must-not-exist",
        description: "this write must be refused",
        type: "project",
        body: "no root to write to",
      });
      assert.ok(write.isError, write.text);
      assert.ok(firstLine(write.text).includes("[ledger: unresolved]"), write.text);
      assert.match(write.text, /cannot resolve the project memory root/);
      assert.ok(!existsSync(join(nowhere, ".memory")), "refused write must not create a ledger");

      const index = await call("memory_index", {});
      assert.ok(index.isError, index.text);
      assert.ok(firstLine(index.text).includes("[ledger: unresolved]"), index.text);
    },
  );
});

function dirnameOf(url: string): string {
  return fileURLToPath(new URL(".", url));
}
