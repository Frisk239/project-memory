import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { applyDream, planDream } from "./core/dream.js";
import { listIndex, readEntry, writeEntry } from "./core/store.js";

const dirs: string[] = [];

afterEach(() => {
  delete process.env.PROJECT_MEMORY_DIR;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function isolated(): string {
  const dir = mkdtempSync(join(tmpdir(), "pmem-dream-"));
  dirs.push(dir);
  process.env.PROJECT_MEMORY_DIR = dir;
  return dir;
}

test("dream dry-run reports exact duplicates without deleting", () => {
  isolated();
  writeEntry({ name: "alpha", description: "A", type: "project", body: "same body text that is long enough" });
  writeEntry({ name: "beta", description: "B", type: "project", body: "same body text that is long enough" });
  const planned = planDream();
  assert.ok(planned.some((op) => op.op === "merge" && op.safe && op.names.includes("alpha") && op.names.includes("beta")));
  const dry = applyDream({ dryRun: true });
  assert.equal(dry.dryRun, true);
  assert.equal(listIndex().length, 2);
});

test("dream apply forgets exact duplicates and empty files", () => {
  isolated();
  writeEntry({ name: "keep-me", description: "Keep", type: "project", body: "canonical long enough body here" });
  writeEntry({ name: "dup", description: "Dup", type: "project", body: "canonical long enough body here" });
  writeEntry({ name: "tiny", description: "Tiny", type: "feedback", body: "x" });
  const report = applyDream({ dryRun: false });
  assert.ok(report.applied.some((op) => op.op === "forget" && op.names.includes("tiny")));
  assert.ok(report.applied.some((op) => op.op === "merge" && op.keep));
  assert.equal(readEntry("tiny"), null);
  const remaining = listIndex().map((item) => item.name).sort();
  assert.deepEqual(remaining, ["keep-me"]);
});

test("dream proposes but does not auto-merge similar non-identical bodies", () => {
  isolated();
  writeEntry({
    name: "use-pnpm",
    description: "Always use pnpm",
    type: "feedback",
    body: "Always use pnpm in this repo for install and scripts because npm lockfiles conflict with the workspace.",
  });
  writeEntry({
    name: "prefer-pnpm",
    description: "Prefer pnpm over npm",
    type: "feedback",
    body: "Always use pnpm in this repository for install and scripts because npm lockfiles conflict with the workspace layout.",
  });
  const report = applyDream({ dryRun: false });
  assert.equal(listIndex().length, 2, "similar files stay until an LLM merge");
  assert.ok(report.proposed.some((op) => op.op === "merge" && !op.safe));
});
