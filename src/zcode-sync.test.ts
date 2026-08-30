import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { forgetEntry, readEntry, writeEntry } from "./core/store.js";
import { resolveZcodeMemoryDir, syncZcodeMirror } from "./core/zcode-sync.js";

const dirs: string[] = [];
let savedHome: string | undefined;
let savedProfile: string | undefined;
let savedDir: string | undefined;

afterEach(() => {
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  if (savedProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = savedProfile;
  if (savedDir === undefined) delete process.env.PROJECT_MEMORY_DIR;
  else process.env.PROJECT_MEMORY_DIR = savedDir;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function isolateHome(): string {
  savedHome = process.env.HOME;
  savedProfile = process.env.USERPROFILE;
  const home = tmpDir("pmem-zsync-home-");
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  return home;
}

function bindLedger(dir: string): void {
  savedDir = process.env.PROJECT_MEMORY_DIR;
  process.env.PROJECT_MEMORY_DIR = dir;
}

function seedLedger(entry: { name: string; description: string; type: "user" | "feedback" | "project" | "reference"; body: string; pin?: boolean }): void {
  writeEntry(entry);
}

function seedZcode(zcodeDir: string, name: string, description: string, type: string, body: string): void {
  writeFileSync(
    join(zcodeDir, `${name}.md`),
    `---\nname: ${name}\ndescription: ${description}\nmetadata:\n  type: ${type}\n---\n\n${body}\n`,
    "utf8",
  );
}

function zcodeEntry(zcodeDir: string, name: string): string {
  return readFileSync(join(zcodeDir, `${name}.md`), "utf8");
}

test("first sync pushes ledger topics, pulls zcode topics, and leaves a pointer", () => {
  const ledgerDir = tmpDir("pmem-zsync-ledger-");
  const zcodeDir = tmpDir("pmem-zsync-zcode-");
  bindLedger(ledgerDir);
  seedLedger({ name: "ledger-topic", description: "from the ledger", type: "project", body: "ledger fact one" });
  seedZcode(zcodeDir, "zcode-topic", "from zcode", "reference", "zcode fact one");

  const report = syncZcodeMirror({ ledgerDir, zcodeDir });
  assert.deepEqual(report.pushed, ["ledger-topic"]);
  assert.deepEqual(report.pulled, ["zcode-topic"]);

  // Pushed file is ZCode-format: no node_type/origin/pin frontmatter extras.
  const pushed = zcodeEntry(zcodeDir, "ledger-topic");
  assert.match(pushed, /^---\nname: ledger-topic\ndescription: from the ledger\nmetadata:\n  type: project\n---/);
  assert.doesNotMatch(pushed, /node_type/);
  const zcodeIndex = readFileSync(join(zcodeDir, "MEMORY.md"), "utf8");
  // Push maintains the ZCode index; pre-existing ZCode files are its own agent's business.
  assert.match(zcodeIndex, /\[Ledger Topic\]\(ledger-topic\.md\)/);

  // Pulled file landed in the ledger with its type preserved.
  const pulled = readEntry("zcode-topic");
  assert.ok(pulled);
  assert.equal(pulled.type, "reference");
  assert.equal(pulled.body, "zcode fact one");

  // Pointer anchors future discovery and is indexed for ZCode sessions.
  const pointer = readFileSync(join(zcodeDir, "project-memory-ledger.md"), "utf8");
  assert.match(pointer, /^---\nname: project-memory-ledger/);
  assert.ok(pointer.includes(ledgerDir));
  assert.ok(existsSync(join(ledgerDir, ".sync-zcode.json")));
});

test("second sync changes nothing", () => {
  const ledgerDir = tmpDir("pmem-zsync-ledger-");
  const zcodeDir = tmpDir("pmem-zsync-zcode-");
  bindLedger(ledgerDir);
  seedLedger({ name: "topic", description: "d", type: "project", body: "b" });
  syncZcodeMirror({ ledgerDir, zcodeDir });
  const report = syncZcodeMirror({ ledgerDir, zcodeDir });
  assert.deepEqual(
    [report.pushed, report.pulled, report.deletedLedger, report.deletedZcode, report.conflicts],
    [[], [], [], [], []],
  );
  assert.equal(report.unchanged, 1);
});

test("a zcode-side edit pulls back into the ledger", () => {
  const ledgerDir = tmpDir("pmem-zsync-ledger-");
  const zcodeDir = tmpDir("pmem-zsync-zcode-");
  bindLedger(ledgerDir);
  seedLedger({ name: "topic", description: "old description", type: "project", body: "old body" });
  syncZcodeMirror({ ledgerDir, zcodeDir });
  seedZcode(zcodeDir, "topic", "new description", "feedback", "new body from zcode");

  const report = syncZcodeMirror({ ledgerDir, zcodeDir });
  assert.deepEqual(report.pulled, ["topic"]);
  const entry = readEntry("topic");
  assert.ok(entry);
  assert.equal(entry.body, "new body from zcode");
  assert.equal(entry.description, "new description");
  assert.equal(entry.type, "feedback");
});

test("a pinned ledger topic is push-only: zcode edits never overwrite it", () => {
  const ledgerDir = tmpDir("pmem-zsync-ledger-");
  const zcodeDir = tmpDir("pmem-zsync-zcode-");
  bindLedger(ledgerDir);
  seedLedger({ name: "pinned", description: "law", type: "project", body: "pinned law", pin: true });
  syncZcodeMirror({ ledgerDir, zcodeDir });
  seedZcode(zcodeDir, "pinned", "tampered", "project", "tampered body");

  const report = syncZcodeMirror({ ledgerDir, zcodeDir });
  assert.deepEqual(report.skippedPinned, ["pinned"]);
  const entry = readEntry("pinned");
  assert.ok(entry);
  assert.equal(entry.body, "pinned law");
  // The tampered mirror copy is repaired from the ledger, not left behind.
  assert.equal(report.pushed.length, 0);
  assert.match(zcodeEntry(zcodeDir, "pinned"), /pinned law/);
  assert.doesNotMatch(zcodeEntry(zcodeDir, "pinned"), /tampered/);
});

test("ledger deletion propagates to zcode, zcode deletion propagates to the ledger", () => {
  const ledgerDir = tmpDir("pmem-zsync-ledger-");
  const zcodeDir = tmpDir("pmem-zsync-zcode-");
  bindLedger(ledgerDir);
  seedLedger({ name: "gone-from-ledger", description: "d", type: "project", body: "b" });
  syncZcodeMirror({ ledgerDir, zcodeDir });
  seedZcode(zcodeDir, "gone-from-zcode", "d2", "project", "b2");
  syncZcodeMirror({ ledgerDir, zcodeDir });

  // Ledger forgets one topic; ZCode loses one file.
  assert.ok(forgetEntry("gone-from-ledger"));
  rmSync(join(zcodeDir, "gone-from-zcode.md"));

  const report = syncZcodeMirror({ ledgerDir, zcodeDir });
  assert.deepEqual(report.deletedZcode, ["gone-from-ledger"]);
  assert.deepEqual(report.deletedLedger, ["gone-from-zcode"]);
  assert.ok(!existsSync(join(zcodeDir, "gone-from-ledger.md")));
  assert.ok(!existsSync(join(ledgerDir, "gone-from-zcode.md")));
  // The index line for the deleted zcode topic was removed too.
  assert.doesNotMatch(readFileSync(join(zcodeDir, "MEMORY.md"), "utf8"), /gone-from-ledger/);
});

test("a simultaneous both-sides edit is resolved by mtime", () => {
  const ledgerDir = tmpDir("pmem-zsync-ledger-");
  const zcodeDir = tmpDir("pmem-zsync-zcode-");
  bindLedger(ledgerDir);
  seedLedger({ name: "topic", description: "d", type: "project", body: "base body" });
  syncZcodeMirror({ ledgerDir, zcodeDir });

  // Both sides change; the ZCode side is stamped newer.
  writeEntry({ name: "topic", description: "d", type: "project", body: "ledger rewrite" });
  seedZcode(zcodeDir, "topic", "d", "project", "zcode rewrite");
  utimesSync(join(ledgerDir, "topic.md"), new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
  utimesSync(join(zcodeDir, "topic.md"), new Date(), new Date());

  const report = syncZcodeMirror({ ledgerDir, zcodeDir });
  assert.equal(report.conflicts.length, 1);
  assert.match(report.conflicts[0], /zcode newer/);
  assert.equal(readEntry("topic")?.body, "zcode rewrite");
});

test("resolveZcodeMemoryDir prefers snapshot, then pointer, then unique basename", () => {
  const home = isolateHome();
  const parent = tmpDir("pmem-zsync-parent-");
  // Fixed basename: mkdtemp suffixes would otherwise leak into the match.
  const root = join(parent, "proj");
  const ledgerDir = join(root, ".memory");
  mkdirSync(ledgerDir, { recursive: true });
  const projects = join(home, ".zcode", "cli", "memories", "projects");

  // No ZCode projects dir at all: a clear error, not a guess.
  assert.throws(() => resolveZcodeMemoryDir(root), /no ZCode memory projects dir/);

  mkdirSync(join(projects, "other-111111"), { recursive: true });
  assert.throws(() => resolveZcodeMemoryDir(root), /cannot find a ZCode memory dir/);

  // Unique <basename>-<hash> match wins without a pointer.
  const mine = join(projects, "proj-abc123", "memory");
  mkdirSync(mine, { recursive: true });
  assert.equal(resolveZcodeMemoryDir(root), mine);

  // A pointer naming the ledger outranks basename matching.
  const pointed = join(projects, "pointed-999999", "memory");
  mkdirSync(pointed, { recursive: true });
  writeFileSync(join(pointed, "project-memory-ledger.md"), `ledger: ${ledgerDir}\n`, "utf8");
  assert.equal(resolveZcodeMemoryDir(root), pointed);

  // An explicit dir beats everything; an ambiguous basename refuses to guess.
  assert.equal(resolveZcodeMemoryDir(root, { explicit: join(projects, "other-111111") }), join(projects, "other-111111"));
  rmSync(join(pointed, "project-memory-ledger.md"));
  mkdirSync(join(projects, "proj-def456", "memory"), { recursive: true });
  assert.throws(() => resolveZcodeMemoryDir(root), /ambiguous/);
});
