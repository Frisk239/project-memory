import assert from "node:assert/strict";
import { test } from "node:test";
import { conflictMessage, normalizeWriteInput } from "./mcp-write.js";

test("title and content aliases fill description and body", () => {
  const parsed = normalizeWriteInput({
    name: "kiro-hooks",
    title: "Kiro hook contract",
    type: "reference",
    content: "plain stdout",
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.entry.description, "Kiro hook contract");
  assert.equal(parsed.entry.body, "plain stdout");
});

test("canonical fields win over aliases", () => {
  const parsed = normalizeWriteInput({
    name: "x",
    description: "real",
    title: "alias",
    type: "project",
    body: "body-text",
    content: "content-text",
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.entry.description, "real");
  assert.equal(parsed.entry.body, "body-text");
});

test("pin flows through normalizeWriteInput", () => {
  const parsed = normalizeWriteInput({
    name: "keep-pin",
    description: "Pinned",
    type: "project",
    body: "use pnpm",
    pin: true,
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.entry.pin, true);
});

test("missing body lists received keys", () => {
  const parsed = normalizeWriteInput({ name: "x", title: "only title", type: "project" });
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.match(parsed.error, /received: name, title, type/);
  assert.match(parsed.error, /missing: body \(or content\)/);
});

test("conflictMessage names both slugs and orders telling the owner without a winner", () => {
  const text = conflictMessage({ keptSlug: "pkg-mgr", newSlug: "pkg-mgr-conflict" });
  assert.match(text, /pkg-mgr/);
  assert.match(text, /pkg-mgr-conflict/);
  assert.match(text, /tell the owner/i);
  assert.match(text, /do not pick a winner/i);
});
