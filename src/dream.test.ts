import assert from "node:assert/strict";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { applyDream, dreamLockPath, DreamLockError, planDream } from "./core/dream.js";
import { entryPath } from "./core/paths.js";
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

test("dream reports similar non-identical bodies for agent judgment", () => {
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

test("dream apply keeps a pinned topic that would otherwise be forgotten or merged", () => {
  isolated();
  writeEntry({
    name: "keep-pin",
    description: "Pinned",
    type: "project",
    body: "canonical long enough body here",
    pin: true,
  });
  writeEntry({ name: "dup", description: "Dup", type: "project", body: "canonical long enough body here" });
  writeEntry({ name: "pinned-tiny", description: "Tiny pin", type: "feedback", body: "x", pin: true });
  writeEntry({ name: "tiny", description: "Tiny", type: "feedback", body: "x" });
  const report = applyDream({ dryRun: false });
  assert.ok(readEntry("keep-pin"));
  assert.equal(readEntry("keep-pin")?.pin, true);
  assert.equal(readEntry("dup"), null);
  assert.ok(readEntry("pinned-tiny"));
  assert.equal(readEntry("tiny"), null);
  const names = listIndex().map((item) => item.name).sort();
  assert.ok(names.includes("keep-pin"));
  assert.ok(names.includes("pinned-tiny"));
  assert.ok(report.applied.some((op) => op.op === "forget" && op.names.includes("tiny")));
});

test("dream apply fails while a lock is held and proceeds after the lock expires", () => {
  isolated();
  writeEntry({ name: "tiny", description: "Tiny", type: "feedback", body: "x" });
  writeFileSync(dreamLockPath(), `${JSON.stringify({ pid: 1, at: new Date().toISOString() })}\n`);
  assert.throws(() => applyDream({ dryRun: false }), DreamLockError);
  assert.ok(readEntry("tiny"), "held lock must not apply forget");
  writeFileSync(dreamLockPath(), `${JSON.stringify({ pid: 1, at: "2000-01-01T00:00:00.000Z" })}\n`);
  const report = applyDream({ dryRun: false });
  assert.equal(readEntry("tiny"), null);
  assert.ok(report.applied.some((op) => op.op === "forget" && op.names.includes("tiny")));
});

test("dream reports stale TODO/Next older than 14 days for agent judgment", () => {
  isolated();
  writeEntry({
    name: "old-next",
    description: "Leftover next steps",
    type: "project",
    body: "## Next\nShip the ledger after review of the parking-fee cut.\n\nWhy: leftover from last month.",
  });
  const past = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
  utimesSync(entryPath("old-next"), past, past);
  const report = applyDream({ dryRun: false });
  assert.ok(report.proposed.some((op) => op.op === "stale" && op.names.includes("old-next") && !op.safe));
  assert.ok(readEntry("old-next"));
  assert.ok(listIndex().some((item) => item.name === "old-next"));
});

test("dream reports relative dates for agent judgment", () => {
  isolated();
  writeEntry({
    name: "recent-call",
    description: "Call outcome",
    type: "project",
    body: "We decided yesterday to keep markdown files in git so every agent can read the same notes.",
  });
  const report = applyDream({ dryRun: false });
  assert.ok(report.proposed.some((op) => op.op === "relative-date" && op.names.includes("recent-call") && !op.safe));
  assert.match(readEntry("recent-call")?.body ?? "", /yesterday/);
});
